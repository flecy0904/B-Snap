import base64
from collections.abc import Callable
from copy import deepcopy
import json
import logging
import mimetypes
import re
from typing import Any
from urllib.parse import unquote, urlparse

from fastapi import HTTPException
from openai import OpenAI, OpenAIError

from backend.app.core.config import get_settings
from backend.app.services.note_page_content import extract_ai_page_text
from backend.app.services.prompts.ai_canvas import AI_CANVAS_EDIT_INSTRUCTIONS
from backend.app.services.prompts.ai_chat import AI_CHAT_INSTRUCTIONS
from backend.app.services.prompts.canvas_intent import CANVAS_INTENT_INSTRUCTIONS
from backend.app.services.prompts.canvas_title import CANVAS_TITLE_INSTRUCTIONS
from backend.app.services.prompts.chat_session_summary import CHAT_SESSION_SUMMARY_INSTRUCTIONS
from backend.app.services.prompts.chat_title import CHAT_TITLE_INSTRUCTIONS
from backend.app.services.prompts.capture_vision import CAPTURE_IMAGE_ANALYSIS_INSTRUCTIONS
from backend.app.services.prompts.pdf_image_rag import PDF_IMAGE_RAG_SUMMARY_INSTRUCTIONS
from backend.app.services.prompts.pdf_image_recheck import PDF_IMAGE_RECHECK_JUDGE_INSTRUCTIONS


logger = logging.getLogger(__name__)


CHAT_RECENT_MESSAGE_LIMIT = 16
CANVAS_RECENT_MESSAGE_LIMIT = 8


def build_note_context(note: dict, pages: list[dict], current_page_number: int | None = None) -> str:
    page_lines = []
    for page in pages:
        content = extract_ai_page_text(page.get("content"))
        attachment_status = "has source file" if page.get("image_url") else "no source file"
        page_lines.append(
            f"- page {page['page_number']} ({attachment_status}): {content or 'no extracted text yet'}"
        )

    return "\n".join(
        [
            f"Note title: {note['title']}",
            f"Note summary: {note.get('summary') or ''}",
            f"Current page: {current_page_number if current_page_number is not None else 'unknown'}",
            "Pages:",
            "\n".join(page_lines) if page_lines else "- no pages yet",
        ]
    )


def build_response_input(
    note: dict,
    pages: list[dict],
    messages: list[dict],
    user_content: str,
    selection_image: str | None = None,
    selection_rect: dict[str, Any] | None = None,
    page_number: int | None = None,
    current_page_number: int | None = None,
    selection_image_url: str | None = None,
    context_hint: str | None = None,
    session_summary: str | None = None,
    canvas_block_context: dict[str, Any] | None = None,
    rag_image_inputs: list[dict[str, Any]] | None = None,
    response_guidance: str | None = None,
) -> list[dict[str, Any]]:
    active_page_number = current_page_number if current_page_number is not None else page_number
    input_items: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": (
                "Local note/page context follows. Use it according to the evidence priority in the system instructions; "
                "when scoped RAG reference context is provided, treat these pages as local support unless the user explicitly asks about the current page.\n\n"
            )
            + build_note_context(note, pages, current_page_number=active_page_number),
        }
    ]

    block_context_text = format_canvas_block_context(canvas_block_context)
    if block_context_text:
        input_items.append({
            "role": "user",
            "content": (
                "Canvas block context follows. Use it as local context for the user's question. "
                "Do not quote this metadata unless it is helpful to answer naturally.\n\n"
                f"{block_context_text}"
            ),
        })

    if session_summary:
        input_items.append({
            "role": "user",
            "content": (
                "Compressed summary of older conversation follows. "
                "Use it only for continuity, user preferences, decisions, and ongoing task state. "
                "Do not treat it as note or PDF source content.\n\n"
                f"{session_summary}"
            ),
        })

    if context_hint:
        input_items.append({
            "role": "user",
            "content": (
                "Internal assistant-only study context follows. "
                "Use it silently only when it is relevant to the user's request. "
                "Do not use this context for page recommendations unless it explicitly contains recommended page priorities. "
                "Never reveal, quote, or describe this internal context or its raw sources to the user.\n\n"
                f"{context_hint}"
            ),
        })

    if response_guidance:
        input_items.append({
            "role": "user",
            "content": (
                "Internal response guidance follows. "
                "Use it only to shape the final answer style and do not mention this guidance.\n\n"
                f"{response_guidance.strip()}"
            ),
        })

    if messages:
        input_items.append({
            "role": "user",
            "content": (
                "Recent conversation below is for continuity only. "
                "Do not treat it as note or PDF source content."
            ),
        })

    for message in messages[-CHAT_RECENT_MESSAGE_LIMIT:]:
        role = message["role"] if message["role"] in {"user", "assistant"} else "user"
        input_items.append({"role": role, "content": message["content"]})

    selection_context = build_selection_context(selection_rect=selection_rect, page_number=page_number)
    final_text = f"{selection_context}\n\n{user_content}".strip()
    content_parts: list[dict[str, Any]] = [{"type": "input_text", "text": final_text}]
    image_url = _prepare_input_image_url(selection_image or selection_image_url)
    if image_url:
        content_parts.append({"type": "input_image", "image_url": image_url})

    for item in rag_image_inputs or []:
        item_image_url = _prepare_input_image_url(str(item.get("image_data_uri") or item.get("image_url") or ""))
        if not item_image_url:
            continue
        page_label = f"page {item.get('page_number')}" if item.get("page_number") else "page unknown"
        content_parts.append({
            "type": "input_text",
            "text": (
                "Original PDF image recheck source for this question. "
                "Use this image directly when it is relevant, and prioritize it over the earlier image summary.\n"
                f"Source: {item.get('title') or 'PDF image'} ({page_label}, mode={item.get('image_mode') or 'context_crop'}, "
                f"image_ai_summary_id={item.get('image_ai_summary_id') or '-'})\n"
                f"Retrieved image summary:\n{item.get('image_summary') or ''}"
            ),
        })
        content_parts.append({"type": "input_image", "image_url": item_image_url})

    if len(content_parts) > 1:
        input_items.append(
            {
                "role": "user",
                "content": content_parts,
            }
        )
    else:
        input_items.append({"role": "user", "content": final_text})
    return input_items


def _prepare_input_image_url(image_url: str | None) -> str | None:
    if not image_url:
        return None
    if image_url.startswith("data:image/"):
        return image_url
    return _local_upload_image_data_uri(image_url) or image_url


def _local_upload_image_data_uri(image_url: str) -> str | None:
    parsed = urlparse(image_url)
    raw_path = parsed.path if parsed.scheme else image_url
    raw_path = unquote(raw_path)
    if not raw_path.startswith("/uploads/"):
        return None

    relative_path = raw_path.removeprefix("/uploads/").lstrip("/")
    if not relative_path:
        return None

    upload_root = get_settings().upload_path.resolve()
    target = (upload_root / relative_path).resolve()
    try:
        target.relative_to(upload_root)
    except ValueError:
        return None

    try:
        if not target.is_file() or target.stat().st_size > get_settings().ai_image_max_bytes:
            return None
        mime_type = mimetypes.guess_type(target.name)[0] or "image/png"
        if not mime_type.startswith("image/"):
            return None
        encoded = base64.b64encode(target.read_bytes()).decode("ascii")
    except Exception:
        return None

    return f"data:{mime_type};base64,{encoded}"


def build_selection_context(
    *,
    selection_rect: dict[str, Any] | None,
    page_number: int | None,
) -> str:
    if not selection_rect and page_number is None:
        return ""

    parts = []
    if page_number is not None:
        parts.append(f"The user's current page is page {page_number}.")
    if selection_rect:
        mode = selection_rect.get("mode")
        selection_label = "freeform lasso region" if mode == "lasso" else "rectangular region"
        parts.append(
            f"The user selected a {selection_label} bounded by "
            f"x={selection_rect.get('x')}, y={selection_rect.get('y')}, "
            f"width={selection_rect.get('width')}, height={selection_rect.get('height')}, "
            f"pageWidth={selection_rect.get('pageWidth')}, pageHeight={selection_rect.get('pageHeight')}."
        )
        parts.append("If an image is attached, focus your explanation on that selected region.")
    return "\n".join(parts)


def format_canvas_block_context(canvas_block_context: dict[str, Any] | None) -> str:
    if not isinstance(canvas_block_context, dict):
        return ""

    def clean(value: Any, limit: int) -> str:
        if value is None:
            return ""
        if isinstance(value, list):
            value = ", ".join(str(item) for item in value)
        return " ".join(str(value).replace("\n", " ").split()).strip()[:limit]

    lines = []
    fields = [
        ("Context scope", "scope", 40),
        ("Block id", "blockId", 120),
        ("Selected block ids", "selectedBlockIds", 1000),
        ("Selection from", "selectionFrom", 40),
        ("Selection to", "selectionTo", 40),
        ("Block type", "type", 40),
        ("Block text", "text", 1200),
        ("Block markdown", "markdown", 1200),
        ("Section heading", "sectionHeading", 300),
        ("Section excerpt", "sectionExcerpt", 1600),
        ("Previous block", "beforeText", 500),
        ("Next block", "afterText", 500),
    ]
    for label, key, limit in fields:
        value = clean(canvas_block_context.get(key), limit)
        if value:
            lines.append(f"{label}: {value}")
    return "\n".join(lines)


def generate_note_chat_answer(
    *,
    model: str,
    note: dict,
    pages: list[dict],
    messages: list[dict],
    user_content: str,
    selection_image: str | None = None,
    selection_rect: dict[str, Any] | None = None,
    page_number: int | None = None,
    current_page_number: int | None = None,
    selection_image_url: str | None = None,
    context_hint: str | None = None,
    session_summary: str | None = None,
    canvas_block_context: dict[str, Any] | None = None,
    rag_image_inputs: list[dict[str, Any]] | None = None,
    response_guidance: str | None = None,
) -> str:
    return generate_text_response(
        model=model,
        instructions=AI_CHAT_INSTRUCTIONS,
        input_items=build_response_input(
            note,
            pages,
            messages,
            user_content,
            selection_image=selection_image,
            selection_rect=selection_rect,
            page_number=page_number,
            current_page_number=current_page_number,
            selection_image_url=selection_image_url,
            context_hint=context_hint,
            session_summary=session_summary,
            canvas_block_context=canvas_block_context,
            rag_image_inputs=rag_image_inputs,
            response_guidance=response_guidance,
        ),
    )


def generate_note_chat_answer_stream(
    *,
    model: str,
    note: dict,
    pages: list[dict],
    messages: list[dict],
    user_content: str,
    on_delta: Callable[[str], None],
    selection_image: str | None = None,
    selection_rect: dict[str, Any] | None = None,
    page_number: int | None = None,
    current_page_number: int | None = None,
    selection_image_url: str | None = None,
    context_hint: str | None = None,
    session_summary: str | None = None,
    canvas_block_context: dict[str, Any] | None = None,
    rag_image_inputs: list[dict[str, Any]] | None = None,
    response_guidance: str | None = None,
) -> str:
    return generate_text_response_stream(
        model=model,
        instructions=AI_CHAT_INSTRUCTIONS,
        input_items=build_response_input(
            note,
            pages,
            messages,
            user_content,
            selection_image=selection_image,
            selection_rect=selection_rect,
            page_number=page_number,
            current_page_number=current_page_number,
            selection_image_url=selection_image_url,
            context_hint=context_hint,
            session_summary=session_summary,
            canvas_block_context=canvas_block_context,
            rag_image_inputs=rag_image_inputs,
            response_guidance=response_guidance,
        ),
        on_delta=on_delta,
    )


def normalize_chat_title(title: str, fallback: str) -> str:
    normalized = " ".join(title.replace("\n", " ").split()).strip()
    normalized = normalized.strip("\"'`“”‘’[](){}")
    if not normalized:
        return fallback
    return normalized[:30]


def generate_chat_title(
    *,
    model: str,
    note: dict,
    user_content: str,
    assistant_content: str | None = None,
) -> str:
    fallback = normalize_chat_title(user_content, "AI 채팅")
    title = generate_text_response(
        model=model,
        instructions=CHAT_TITLE_INSTRUCTIONS,
        input_items=[{
            "role": "user",
            "content": "\n".join([
                f"Note title: {note['title']}",
                "Create a chat title from this first user question only:",
                user_content,
            ]),
        }],
    )
    return normalize_chat_title(title, fallback)


def generate_ai_canvas_title(
    *,
    model: str,
    note: dict,
    user_content: str,
    canvas_markdown: str,
) -> str:
    fallback = normalize_chat_title(user_content, "AI Canvas")
    title = generate_text_response(
        model=model,
        instructions=CANVAS_TITLE_INSTRUCTIONS,
        input_items=[{
            "role": "user",
            "content": "\n".join([
                f"Note title: {note['title']}",
                "",
                "User request:",
                user_content,
                "",
                "Canvas markdown:",
                canvas_markdown[:2000],
            ]),
        }],
    )
    return normalize_chat_title(title, fallback)


def generate_ai_canvas_intent(
    *,
    model: str,
    user_content: str,
    canvas_block_context: dict[str, Any] | None = None,
) -> str:
    context_text = format_canvas_block_context(canvas_block_context)
    intent = generate_text_response(
        model=model,
        instructions=CANVAS_INTENT_INSTRUCTIONS,
        input_items=[{
            "role": "user",
            "content": "\n\n".join(
                part for part in [
                    "User request:",
                    user_content,
                    "Canvas block context:",
                    context_text,
                ] if part
            ),
        }],
    ).strip().lower()
    if intent in {"chat_only", "canvas_edit", "canvas_create"}:
        return intent
    return "chat_only"


def format_chat_messages_for_summary(messages: list[dict[str, Any]], max_chars: int = 12000) -> str:
    lines: list[str] = []
    used_chars = 0
    for message in messages:
        role = message.get("role") if message.get("role") in {"user", "assistant"} else "user"
        source = message.get("source") or "chat"
        content = " ".join(str(message.get("content") or "").split())
        if not content:
            continue
        line = f"{role} ({source}, id={message.get('id')}): {content[:1800]}"
        if used_chars + len(line) > max_chars:
            remaining = max_chars - used_chars
            if remaining > 200:
                lines.append(line[:remaining])
            break
        lines.append(line)
        used_chars += len(line)
    return "\n".join(lines)


def generate_chat_session_summary(
    *,
    model: str,
    previous_summary: str | None,
    messages: list[dict[str, Any]],
) -> str:
    conversation_text = format_chat_messages_for_summary(messages)
    if not conversation_text:
        return previous_summary or ""
    raw = generate_text_response(
        model=model,
        instructions=CHAT_SESSION_SUMMARY_INSTRUCTIONS,
        input_items=[{
            "role": "user",
            "content": "\n\n".join([
                "Previous session summary:",
                previous_summary or "(none)",
                "New older conversation messages to fold into the summary:",
                conversation_text,
                "Update the session summary now.",
            ]),
        }],
    )
    return raw.strip()[:4000]

ALLOWED_CANVAS_OPERATION_TYPES = {"insert_after", "insert_before", "replace", "delete"}
ALLOWED_CANVAS_ROOT_NODE_TYPES = {
    "paragraph",
    "heading",
    "bulletList",
    "orderedList",
    "listItem",
    "codeBlock",
    "horizontalRule",
}
ALLOWED_CANVAS_NODE_TYPES = ALLOWED_CANVAS_ROOT_NODE_TYPES | {"text"}
ALLOWED_CANVAS_MARK_TYPES = {"bold", "italic", "strike", "code", "aiCanvasUncertain"}
CANVAS_RECOMMENDATION_MODE_MEANINGS = {
    "polish": "마무리 다듬기",
    "simplify": "수준 조정 - 쉽게",
    "professionalize": "수준 조정 - 전문적으로",
    "shorten": "길이 조절 - 짧게",
    "expand": "길이 조절 - 길게",
    "restructure": "정리 보강 - 구조화",
    "extract_key_points": "정리 보강 - 핵심만",
    "mark_uncertain": "정리 보강 - 오류 의심 표시",
}
CANVAS_RECOMMENDATION_MARKDOWN_LIMIT = 6000
CANVAS_SELECTION_MARKDOWN_LIMIT = 2600
CANVAS_COMPACT_BLOCK_TEXT_LIMIT = 1800


def _validate_canvas_node(node: Any, *, allow_text: bool = True) -> dict[str, Any]:
    if not isinstance(node, dict):
        raise HTTPException(status_code=502, detail="AI returned an invalid Canvas node")
    node_type = node.get("type")
    allowed_node_types = ALLOWED_CANVAS_NODE_TYPES if allow_text else ALLOWED_CANVAS_ROOT_NODE_TYPES
    if node_type not in allowed_node_types:
        raise HTTPException(status_code=502, detail="AI returned an unsupported Canvas node")

    validated: dict[str, Any] = {"type": node_type}
    attrs = node.get("attrs")
    if isinstance(attrs, dict):
        clean_attrs: dict[str, Any] = {}
        if "blockId" in attrs and isinstance(attrs["blockId"], str):
            clean_attrs["blockId"] = attrs["blockId"][:80]
        if node_type in {"paragraph", "bulletList", "orderedList"}:
            indent_level = attrs.get("indentLevel")
            if isinstance(indent_level, int) and not isinstance(indent_level, bool):
                if 1 <= indent_level <= 6:
                    clean_attrs["indentLevel"] = indent_level
        if node_type == "listItem" and attrs.get("markerless") is True:
            clean_attrs["markerless"] = True
        if node_type == "heading":
            level = attrs.get("level")
            clean_attrs["level"] = level if level in {1, 2, 3} else 2
        if clean_attrs:
            validated["attrs"] = clean_attrs
    elif node_type == "heading":
        validated["attrs"] = {"level": 2}

    if node_type == "text":
        text = node.get("text")
        validated["text"] = text if isinstance(text, str) else ""
        marks = node.get("marks")
        if isinstance(marks, list):
            clean_marks = [
                {"type": mark.get("type")}
                for mark in marks
                if isinstance(mark, dict) and mark.get("type") in ALLOWED_CANVAS_MARK_TYPES
            ]
            if clean_marks:
                validated["marks"] = clean_marks
        return validated

    content = node.get("content")
    if isinstance(content, list):
        validated["content"] = [_validate_canvas_node(child, allow_text=True) for child in content]
    return validated


def _validate_canvas_operations(raw: Any) -> list[dict[str, Any]]:
    payload = raw.get("operations") if isinstance(raw, dict) else raw
    if not isinstance(payload, list):
        raise HTTPException(status_code=502, detail="AI returned invalid Canvas operations")

    operations: list[dict[str, Any]] = []
    for item in payload[:12]:
        if not isinstance(item, dict):
            continue
        op = item.get("op")
        if op not in ALLOWED_CANVAS_OPERATION_TYPES:
            continue
        target_block_id = item.get("targetBlockId")
        if op == "insert_after" and isinstance(target_block_id, str) and target_block_id.strip().lower() in {"", "null", "none", "undefined"}:
            target_block_id = None
        if op != "insert_after" and not isinstance(target_block_id, str):
            continue
        if op == "insert_after" and target_block_id is not None and not isinstance(target_block_id, str):
            continue

        operation: dict[str, Any] = {"op": op, "targetBlockId": target_block_id}
        if op != "delete":
            node = _prune_empty_canvas_list_artifacts(_validate_canvas_node(item.get("node"), allow_text=False))
            if node is None:
                continue
            operation["node"] = node
        operations.append(operation)

    return operations


def _parse_and_validate_canvas_operations(raw: str) -> list[dict[str, Any]]:
    parsed = _parse_json_object(raw)
    if parsed is None:
        try:
            parsed = json.loads(raw)
        except Exception as exc:
            raise HTTPException(status_code=502, detail="AI returned invalid Canvas JSON") from exc
    return _validate_canvas_operations(parsed)


def _parse_validate_and_normalize_canvas_operations(
    raw: str,
    canvas_document_json: dict[str, Any],
) -> list[dict[str, Any]]:
    operations = _normalize_canvas_operations_for_existing_targets(
        _parse_and_validate_canvas_operations(raw),
        canvas_document_json,
    )
    return _drop_noop_replace_canvas_operations(operations, canvas_document_json)


def _iter_canvas_nodes(node: Any):
    if isinstance(node, dict):
        yield node
        content = node.get("content")
        if isinstance(content, list):
            for child in content:
                yield from _iter_canvas_nodes(child)
    elif isinstance(node, list):
        for item in node:
            yield from _iter_canvas_nodes(item)


def _canvas_node_text(node: Any) -> str:
    if not isinstance(node, dict):
        return ""
    if node.get("type") == "text":
        return str(node.get("text") or "")
    content = node.get("content")
    if not isinstance(content, list):
        return ""
    return "".join(_canvas_node_text(child) for child in content)


def _canvas_operations_text(operations: list[dict[str, Any]]) -> str:
    return "\n".join(_canvas_node_text(operation.get("node")) for operation in operations)


def _canvas_direct_list_item_text(node: dict[str, Any]) -> str:
    content = node.get("content")
    if not isinstance(content, list):
        return _canvas_node_text(node).strip()
    direct_parts: list[str] = []
    for child in content:
        if isinstance(child, dict) and child.get("type") == "paragraph":
            direct_parts.append(_canvas_node_text(child))
    return " ".join(part.strip() for part in direct_parts if part.strip()).strip()


def _nested_canvas_list_items(node: dict[str, Any]) -> list[dict[str, Any]]:
    content = node.get("content")
    if not isinstance(content, list):
        return []

    items: list[dict[str, Any]] = []
    for child in content:
        if not isinstance(child, dict) or child.get("type") not in {"bulletList", "orderedList"}:
            continue
        child_content = child.get("content")
        if not isinstance(child_content, list):
            continue
        items.extend(
            item
            for item in child_content
            if isinstance(item, dict) and item.get("type") == "listItem" and _canvas_node_text(item).strip()
        )
    return items


def _prune_empty_canvas_list_artifacts(node: dict[str, Any]) -> dict[str, Any] | None:
    node_type = node.get("type")
    next_node = dict(node)

    content = next_node.get("content")
    if isinstance(content, list):
        next_content: list[dict[str, Any]] = []
        for child in content:
            if not isinstance(child, dict):
                continue
            next_child = _prune_empty_canvas_list_artifacts(child)
            if next_child is not None:
                next_content.append(next_child)

        if node_type in {"bulletList", "orderedList"}:
            list_items: list[dict[str, Any]] = []
            for child in next_content:
                if child.get("type") != "listItem":
                    continue
                if _canvas_direct_list_item_text(child):
                    list_items.append(child)
                    continue
                list_items.extend(_nested_canvas_list_items(child))
            next_content = list_items

        if next_content:
            next_node["content"] = next_content
        else:
            next_node.pop("content", None)

    if node_type in {"bulletList", "orderedList"}:
        content = next_node.get("content")
        if not isinstance(content, list) or not any(
            isinstance(child, dict) and child.get("type") == "listItem" and _canvas_node_text(child).strip()
            for child in content
        ):
            return None

    if node_type == "listItem" and not _canvas_node_text(next_node).strip():
        return None

    return next_node


def _count_canvas_operation_nodes(operations: list[dict[str, Any]], node_type: str) -> int:
    return sum(1 for operation in operations for node in _iter_canvas_nodes(operation.get("node")) if node.get("type") == node_type)


def _has_canvas_operation_node(operations: list[dict[str, Any]], node_types: set[str]) -> bool:
    return any(
        node.get("type") in node_types
        for operation in operations
        for node in _iter_canvas_nodes(operation.get("node"))
    )


def _has_canvas_uncertain_mark(operations: list[dict[str, Any]]) -> bool:
    for operation in operations:
        for node in _iter_canvas_nodes(operation.get("node")):
            marks = node.get("marks")
            if isinstance(marks, list):
                if any(isinstance(mark, dict) and mark.get("type") == "aiCanvasUncertain" for mark in marks):
                    return True
    return False


def _text_node_has_uncertain_mark(node: dict[str, Any]) -> bool:
    marks = node.get("marks")
    return isinstance(marks, list) and any(
        isinstance(mark, dict) and mark.get("type") == "aiCanvasUncertain"
        for mark in marks
    )


def _node_has_uncertain_mark(node: Any) -> bool:
    return any(_text_node_has_uncertain_mark(child) for child in _iter_canvas_nodes(node) if child.get("type") == "text")


def _with_uncertain_prefix_and_mark(node: Any, *, only_marked: bool = False) -> Any:
    if not isinstance(node, dict):
        return node
    node = dict(node)
    if node.get("type") == "text":
        has_uncertain_mark = _text_node_has_uncertain_mark(node)
        if only_marked and not has_uncertain_mark:
            return node
        text = str(node.get("text") or "")
        if text and not text.strip().startswith("확인 필요"):
            node["text"] = f"확인 필요: {text}"
        marks = node.get("marks")
        clean_marks = [mark for mark in marks if isinstance(mark, dict)] if isinstance(marks, list) else []
        if not any(mark.get("type") == "aiCanvasUncertain" for mark in clean_marks):
            clean_marks.append({"type": "aiCanvasUncertain"})
        node["marks"] = clean_marks
        return node

    content = node.get("content")
    if isinstance(content, list):
        node["content"] = [_with_uncertain_prefix_and_mark(child, only_marked=only_marked) for child in content]
    return node


def _normalize_mark_uncertain_operations(operations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for operation in operations:
        next_operation = dict(operation)
        if "node" in next_operation:
            node = next_operation["node"]
            next_operation["node"] = _with_uncertain_prefix_and_mark(
                node,
                only_marked=_node_has_uncertain_mark(node),
            )
        normalized.append(next_operation)
    return normalized


def _canvas_body_block_ids_ordered(canvas_document_json: dict[str, Any]) -> list[str]:
    content = canvas_document_json.get("content") if isinstance(canvas_document_json, dict) else None
    if not isinstance(content, list):
        return []

    block_ids: list[str] = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") == "heading":
            continue
        attrs = block.get("attrs")
        if isinstance(attrs, dict) and isinstance(attrs.get("blockId"), str):
            block_ids.append(attrs["blockId"])
    return block_ids


def _canvas_body_block_ids(canvas_document_json: dict[str, Any]) -> set[str]:
    return set(_canvas_body_block_ids_ordered(canvas_document_json))


def _canvas_block_ids_ordered(canvas_document_json: dict[str, Any]) -> list[str]:
    content = canvas_document_json.get("content") if isinstance(canvas_document_json, dict) else None
    if not isinstance(content, list):
        return []

    block_ids: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            continue
        attrs = block.get("attrs")
        if isinstance(attrs, dict) and isinstance(attrs.get("blockId"), str):
            block_ids.append(attrs["blockId"])
    return block_ids


def _selection_scoped_block_ids(canvas_block_context: dict[str, Any] | None) -> list[str]:
    if not isinstance(canvas_block_context, dict) or canvas_block_context.get("scope") != "selection":
        return []
    raw_ids = canvas_block_context.get("selectedBlockIds")
    if isinstance(raw_ids, list):
        return [block_id for block_id in raw_ids if isinstance(block_id, str) and block_id.strip()]
    block_id = canvas_block_context.get("blockId")
    return [block_id] if isinstance(block_id, str) and block_id.strip() else []


def _trim_canvas_context_text(value: str, limit: int) -> str:
    text = value.strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + "\n...[truncated for faster Canvas recommendation request]"


def _canvas_request_markdown(
    canvas_markdown: str,
    canvas_block_context: dict[str, Any] | None,
    canvas_recommendation_mode: str | None,
) -> str:
    if canvas_recommendation_mode not in CANVAS_RECOMMENDATION_MODE_MEANINGS:
        return canvas_markdown

    if _selection_scoped_block_ids(canvas_block_context):
        for key in ("markdown", "text", "sectionExcerpt"):
            value = canvas_block_context.get(key) if isinstance(canvas_block_context, dict) else None
            if isinstance(value, str) and value.strip():
                return _trim_canvas_context_text(value, CANVAS_SELECTION_MARKDOWN_LIMIT)

    return _trim_canvas_context_text(canvas_markdown, CANVAS_RECOMMENDATION_MARKDOWN_LIMIT)


def _filter_canvas_node_to_block_ids(node: Any, scoped_ids: set[str]) -> dict[str, Any] | None:
    if not isinstance(node, dict):
        return None

    attrs = node.get("attrs")
    node_block_id = attrs.get("blockId") if isinstance(attrs, dict) else None
    if isinstance(node_block_id, str) and node_block_id in scoped_ids:
        return deepcopy(node)

    content = node.get("content")
    if not isinstance(content, list):
        return None

    filtered_content = [
        filtered_child
        for child in content
        if (filtered_child := _filter_canvas_node_to_block_ids(child, scoped_ids)) is not None
    ]
    if not filtered_content:
        return None

    filtered_node = dict(node)
    filtered_node["content"] = filtered_content
    return filtered_node


def _compact_canvas_block_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) <= CANVAS_COMPACT_BLOCK_TEXT_LIMIT:
        return text
    return text[:CANVAS_COMPACT_BLOCK_TEXT_LIMIT].rstrip() + "..."


def _compact_canvas_attrs_for_request(node: dict[str, Any]) -> dict[str, Any] | None:
    attrs = node.get("attrs")
    if not isinstance(attrs, dict):
        return None

    compact_attrs: dict[str, Any] = {}
    block_id = attrs.get("blockId")
    if isinstance(block_id, str):
        compact_attrs["blockId"] = block_id

    node_type = node.get("type")
    if node_type == "heading" and attrs.get("level") in {1, 2, 3}:
        compact_attrs["level"] = attrs["level"]
    if node_type in {"paragraph", "bulletList", "orderedList"}:
        indent_level = attrs.get("indentLevel")
        if isinstance(indent_level, int) and not isinstance(indent_level, bool):
            compact_attrs["indentLevel"] = indent_level
    if node_type == "listItem" and attrs.get("markerless") is True:
        compact_attrs["markerless"] = True

    return compact_attrs or None


def _direct_canvas_node_text_for_request(node: dict[str, Any]) -> str:
    node_type = node.get("type")
    if node_type == "listItem":
        return _canvas_direct_list_item_text(node)
    if node_type in {"bulletList", "orderedList", "doc"}:
        return ""
    return _canvas_node_text(node)


def _compact_canvas_node_for_request(node: Any) -> dict[str, Any] | None:
    if not isinstance(node, dict):
        return None

    node_type = node.get("type")
    if not isinstance(node_type, str):
        return None

    compact_node: dict[str, Any] = {"type": node_type}
    compact_attrs = _compact_canvas_attrs_for_request(node)
    if compact_attrs:
        compact_node["attrs"] = compact_attrs

    text = _direct_canvas_node_text_for_request(node)
    if text.strip():
        compact_node["text"] = _compact_canvas_block_text(text)

    if _node_has_uncertain_mark(node):
        compact_node["marks"] = ["aiCanvasUncertain"]

    content = node.get("content")
    if isinstance(content, list) and node_type in {"doc", "bulletList", "orderedList", "listItem"}:
        child_nodes = content
        if node_type == "listItem":
            child_nodes = [
                child
                for child in content
                if isinstance(child, dict) and child.get("type") in {"bulletList", "orderedList"}
            ]
        compact_content = [
            child
            for item in child_nodes
            if (child := _compact_canvas_node_for_request(item)) is not None
            and (child.get("type") != "text" or child.get("text"))
        ]
        if compact_content:
            compact_node["content"] = compact_content

    if node_type == "text":
        text = str(node.get("text") or "").strip()
        if not text:
            return None
        compact_node["text"] = _compact_canvas_block_text(text)

    return compact_node


def _compact_canvas_document_json_for_request(canvas_document_json: dict[str, Any]) -> dict[str, Any]:
    compact_document_json = _compact_canvas_node_for_request(canvas_document_json)
    if not isinstance(compact_document_json, dict):
        return {"type": "doc", "content": []}
    return _annotate_compact_canvas_sections(compact_document_json)


def _annotate_compact_canvas_sections(compact_document_json: dict[str, Any]) -> dict[str, Any]:
    if compact_document_json.get("type") != "doc":
        return compact_document_json
    content = compact_document_json.get("content")
    if not isinstance(content, list):
        return compact_document_json

    annotated_content: list[dict[str, Any]] = []
    current_section: str | None = None
    for block in content:
        if not isinstance(block, dict):
            continue
        next_block = deepcopy(block)
        block_text = str(next_block.get("text") or "").strip()
        if next_block.get("type") == "heading":
            current_section = block_text or current_section
            if current_section:
                next_block["section"] = current_section
        elif current_section:
            next_block["section"] = current_section
        annotated_content.append(next_block)

    next_document = dict(compact_document_json)
    next_document["content"] = annotated_content
    return next_document


def _canvas_request_document_json(
    canvas_document_json: dict[str, Any],
    canvas_block_context: dict[str, Any] | None,
    canvas_recommendation_mode: str | None,
) -> dict[str, Any]:
    document_json = canvas_document_json or {"type": "doc", "content": []}
    if canvas_recommendation_mode not in CANVAS_RECOMMENDATION_MODE_MEANINGS:
        return document_json

    scoped_ids = set(_selection_scoped_block_ids(canvas_block_context))
    if not scoped_ids:
        return _compact_canvas_document_json_for_request(document_json)

    filtered_document_json = _filter_canvas_node_to_block_ids(document_json, scoped_ids)
    content = filtered_document_json.get("content") if isinstance(filtered_document_json, dict) else None
    if isinstance(content, list) and content:
        return _compact_canvas_document_json_for_request(filtered_document_json)
    return _compact_canvas_document_json_for_request(document_json)


def _should_return_noop_for_canvas_recommendation(
    *,
    canvas_recommendation_mode: str | None,
    canvas_document_json: dict[str, Any],
    canvas_block_context: dict[str, Any] | None,
) -> bool:
    if canvas_recommendation_mode != "restructure":
        return False
    if _selection_scoped_block_ids(canvas_block_context):
        return False

    content = canvas_document_json.get("content") if isinstance(canvas_document_json, dict) else None
    if not isinstance(content, list) or not content:
        return False

    meaningful_blocks = [
        block
        for block in content
        if isinstance(block, dict)
        and (
            block.get("type") == "horizontalRule"
            or _canvas_node_text(block).strip()
            or block.get("type") in {"bulletList", "orderedList"}
        )
    ]
    if not meaningful_blocks:
        return False

    heading_count = sum(1 for block in meaningful_blocks if block.get("type") == "heading")
    list_count = sum(1 for block in meaningful_blocks if block.get("type") in {"bulletList", "orderedList"})
    paragraph_texts = [
        _canvas_node_text(block).strip()
        for block in meaningful_blocks
        if block.get("type") == "paragraph" and _canvas_node_text(block).strip()
    ]
    unsupported_body_count = sum(
        1
        for block in meaningful_blocks
        if block.get("type") not in {"heading", "bulletList", "orderedList", "horizontalRule", "paragraph"}
    )
    long_paragraph_count = sum(1 for text in paragraph_texts if len(text) > 90)

    return (
        heading_count >= 1
        and list_count >= 1
        and unsupported_body_count == 0
        and long_paragraph_count == 0
        and len(paragraph_texts) <= max(1, heading_count)
        and list_count >= heading_count
    )


def _scoped_body_block_ids_ordered(
    canvas_document_json: dict[str, Any],
    canvas_block_context: dict[str, Any] | None,
) -> list[str]:
    scoped_ids = _selection_scoped_block_ids(canvas_block_context)
    if not scoped_ids:
        return _canvas_body_block_ids_ordered(canvas_document_json)

    scoped_set = set(scoped_ids)
    body_ids = [block_id for block_id in _canvas_body_block_ids_ordered(canvas_document_json) if block_id in scoped_set]
    if body_ids:
        return body_ids
    return [block_id for block_id in _canvas_block_ids_ordered(canvas_document_json) if block_id in scoped_set]


def _operation_target_is_in_selection_scope(operation: dict[str, Any], scoped_ids: set[str]) -> bool:
    target = operation.get("targetBlockId")
    return isinstance(target, str) and target in scoped_ids


def _filter_operations_to_selection_scope(
    operations: list[dict[str, Any]],
    canvas_block_context: dict[str, Any] | None,
) -> list[dict[str, Any]]:
    scoped_ids = set(_selection_scoped_block_ids(canvas_block_context))
    if not scoped_ids:
        return operations
    return [operation for operation in operations if _operation_target_is_in_selection_scope(operation, scoped_ids)]


def _canvas_quality_target_text(canvas_markdown: str, canvas_block_context: dict[str, Any] | None) -> str:
    if isinstance(canvas_block_context, dict) and canvas_block_context.get("scope") == "selection":
        for key in ("markdown", "text", "sectionExcerpt"):
            value = canvas_block_context.get(key)
            if isinstance(value, str) and value.strip():
                return value
    return canvas_markdown


def _canvas_block_text_by_id(canvas_document_json: dict[str, Any]) -> dict[str, str]:
    by_id: dict[str, str] = {}

    def visit(node: Any) -> None:
        if not isinstance(node, dict):
            return
        attrs = node.get("attrs")
        if isinstance(attrs, dict) and isinstance(attrs.get("blockId"), str):
            by_id[attrs["blockId"]] = _canvas_node_text(node)
        content = node.get("content")
        if isinstance(content, list):
            for child in content:
                visit(child)

    visit(canvas_document_json)
    return by_id


def _canvas_block_records_by_id(canvas_document_json: dict[str, Any]) -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}

    def visit(node: Any, parent_type: str | None = None) -> None:
        if not isinstance(node, dict):
            return
        node_type = node.get("type")
        attrs = node.get("attrs")
        if isinstance(node_type, str) and isinstance(attrs, dict) and isinstance(attrs.get("blockId"), str):
            records[attrs["blockId"]] = {
                "type": node_type,
                "parentType": parent_type,
                "attrs": attrs,
                "node": node,
            }
        content = node.get("content")
        if isinstance(content, list):
            for child in content:
                visit(child, node_type if isinstance(node_type, str) else parent_type)

    visit(canvas_document_json)
    return records


def _strip_canvas_node_identity(node: Any) -> Any:
    if isinstance(node, list):
        return [_strip_canvas_node_identity(child) for child in node]
    if not isinstance(node, dict):
        return node

    next_node: dict[str, Any] = {}
    for key, value in node.items():
        if key == "attrs" and isinstance(value, dict):
            attrs = {attr_key: attr_value for attr_key, attr_value in value.items() if attr_key != "blockId"}
            if attrs:
                next_node[key] = attrs
            continue
        if key == "content":
            next_node[key] = _strip_canvas_node_identity(value)
            continue
        next_node[key] = value
    return next_node


def _canvas_nodes_semantically_equal(left: Any, right: Any) -> bool:
    return _strip_canvas_node_identity(left) == _strip_canvas_node_identity(right)


def _canvas_node_block_id(node: Any) -> str | None:
    attrs = node.get("attrs") if isinstance(node, dict) else None
    block_id = attrs.get("blockId") if isinstance(attrs, dict) else None
    return block_id if isinstance(block_id, str) and block_id else None


def _with_canvas_node_block_id(node: dict[str, Any], block_id: str) -> dict[str, Any]:
    next_node = deepcopy(node)
    attrs = dict(next_node.get("attrs")) if isinstance(next_node.get("attrs"), dict) else {}
    attrs["blockId"] = block_id
    next_node["attrs"] = attrs
    return next_node


def _plain_paragraph_node(text: str, block_id: str) -> dict[str, Any]:
    paragraph: dict[str, Any] = {
        "type": "paragraph",
        "attrs": {"blockId": block_id},
    }
    if text.strip():
        paragraph["content"] = [{"type": "text", "text": text.strip()}]
    return paragraph


def _list_node_to_plain_text(node: dict[str, Any]) -> str:
    content = node.get("content")
    if not isinstance(content, list):
        return _canvas_node_text(node)
    parts: list[str] = []
    for index, item in enumerate(content, start=1):
        if not isinstance(item, dict) or item.get("type") != "listItem":
            continue
        text = _canvas_direct_list_item_text(item) or _canvas_node_text(item)
        if text.strip():
            parts.append(f"{index}. {text.strip()}" if node.get("type") == "orderedList" else text.strip())
    return " / ".join(parts) or _canvas_node_text(node)


def _coerce_canvas_node_to_list_item_for_target(
    node: dict[str, Any],
    *,
    operation: dict[str, Any],
    target_record: dict[str, Any],
) -> dict[str, Any]:
    op = operation.get("op")
    target_block_id = operation.get("targetBlockId")
    replacing = op == "replace" and isinstance(target_block_id, str)
    target_attrs = target_record.get("attrs") if isinstance(target_record.get("attrs"), dict) else {}

    if node.get("type") == "listItem":
        next_node = deepcopy(node)
        attrs = dict(next_node.get("attrs")) if isinstance(next_node.get("attrs"), dict) else {}
        if replacing:
            attrs["blockId"] = target_block_id
        elif not isinstance(attrs.get("blockId"), str):
            attrs["blockId"] = f"{target_block_id}_item" if isinstance(target_block_id, str) else "ai_canvas_list_item"
        if replacing and target_attrs.get("markerless") is True and attrs.get("markerless") is not False:
            attrs["markerless"] = True
        next_node["attrs"] = attrs
        return next_node

    node_type = node.get("type")
    list_item_block_id = (
        target_block_id
        if replacing and isinstance(target_block_id, str)
        else _canvas_node_block_id(node) or (f"{target_block_id}_item" if isinstance(target_block_id, str) else "ai_canvas_list_item")
    )
    list_item_attrs: dict[str, Any] = {"blockId": list_item_block_id}
    if replacing and target_attrs.get("markerless") is True:
        list_item_attrs["markerless"] = True

    if node_type in {"paragraph", "heading", "codeBlock"}:
        child_node = deepcopy(node)
        if replacing and _canvas_node_block_id(child_node) == list_item_block_id:
            child_node = _with_canvas_node_block_id(child_node, f"{list_item_block_id}_text")
        return {
            "type": "listItem",
            "attrs": list_item_attrs,
            "content": [child_node],
        }

    if node_type in {"bulletList", "orderedList"}:
        return {
            "type": "listItem",
            "attrs": list_item_attrs,
            "content": [_plain_paragraph_node(_list_node_to_plain_text(node), f"{list_item_block_id}_text")],
        }

    return node


def _coerce_canvas_node_to_paragraph_for_target(
    node: dict[str, Any],
    *,
    operation: dict[str, Any],
) -> dict[str, Any]:
    target_block_id = operation.get("targetBlockId")
    if not isinstance(target_block_id, str):
        return node

    if node.get("type") == "paragraph":
        return _with_canvas_node_block_id(node, target_block_id)

    text = _list_node_to_plain_text(node) if node.get("type") in {"bulletList", "orderedList"} else _canvas_node_text(node)
    return _plain_paragraph_node(text, target_block_id)


def _normalize_canvas_operations_for_existing_targets(
    operations: list[dict[str, Any]],
    canvas_document_json: dict[str, Any],
) -> list[dict[str, Any]]:
    target_records = _canvas_block_records_by_id(canvas_document_json)
    normalized: list[dict[str, Any]] = []

    for operation in operations:
        if operation.get("op") == "delete" or "node" not in operation:
            normalized.append(operation)
            continue

        target = operation.get("targetBlockId")
        target_record = target_records.get(target) if isinstance(target, str) else None
        if not target_record:
            normalized.append(operation)
            continue

        node = operation.get("node")
        if not isinstance(node, dict):
            normalized.append(operation)
            continue

        target_is_paragraph_inside_list_item = (
            operation.get("op") == "replace"
            and target_record.get("type") == "paragraph"
            and target_record.get("parentType") == "listItem"
        )
        if target_is_paragraph_inside_list_item:
            next_operation = dict(operation)
            next_operation["node"] = _coerce_canvas_node_to_paragraph_for_target(
                node,
                operation=operation,
            )
            normalized.append(next_operation)
            continue

        target_is_list_item = target_record.get("type") == "listItem"
        target_parent_is_list = target_record.get("parentType") in {"bulletList", "orderedList"}
        if not target_is_list_item and not target_parent_is_list:
            normalized.append(operation)
            continue

        next_operation = dict(operation)
        next_operation["node"] = _coerce_canvas_node_to_list_item_for_target(
            node,
            operation=operation,
            target_record=target_record,
        )
        normalized.append(next_operation)

    return normalized


def _drop_noop_replace_canvas_operations(
    operations: list[dict[str, Any]],
    canvas_document_json: dict[str, Any],
) -> list[dict[str, Any]]:
    target_records = _canvas_block_records_by_id(canvas_document_json)
    normalized: list[dict[str, Any]] = []

    for operation in operations:
        if operation.get("op") != "replace":
            normalized.append(operation)
            continue

        target = operation.get("targetBlockId")
        node = operation.get("node")
        target_record = target_records.get(target) if isinstance(target, str) else None
        target_node = target_record.get("node") if isinstance(target_record, dict) else None
        if isinstance(node, dict) and isinstance(target_node, dict) and _canvas_nodes_semantically_equal(target_node, node):
            continue

        normalized.append(operation)

    return normalized


def _canvas_heading_count(canvas_document_json: dict[str, Any]) -> int:
    content = canvas_document_json.get("content") if isinstance(canvas_document_json, dict) else None
    if not isinstance(content, list):
        return 0
    return sum(1 for block in content if isinstance(block, dict) and block.get("type") == "heading")


def _scoped_heading_count(canvas_document_json: dict[str, Any], canvas_block_context: dict[str, Any] | None) -> int:
    scoped_ids = set(_selection_scoped_block_ids(canvas_block_context))
    if not scoped_ids:
        return _canvas_heading_count(canvas_document_json)
    content = canvas_document_json.get("content") if isinstance(canvas_document_json, dict) else None
    if not isinstance(content, list):
        return 0
    return sum(
        1
        for block in content
        if isinstance(block, dict)
        and block.get("type") == "heading"
        and isinstance(block.get("attrs"), dict)
        and block["attrs"].get("blockId") in scoped_ids
    )


def _canvas_section_heading_by_block_id(canvas_document_json: dict[str, Any]) -> dict[str, str]:
    content = canvas_document_json.get("content") if isinstance(canvas_document_json, dict) else None
    if not isinstance(content, list):
        return {}

    section_by_id: dict[str, str] = {}
    current_heading = ""

    def record(node: Any, section_heading: str) -> None:
        if not isinstance(node, dict):
            return
        attrs = node.get("attrs")
        if isinstance(attrs, dict) and isinstance(attrs.get("blockId"), str):
            section_by_id[attrs["blockId"]] = section_heading
        children = node.get("content")
        if isinstance(children, list):
            for child in children:
                record(child, section_heading)

    for block in content:
        if not isinstance(block, dict):
            continue
        if block.get("type") == "heading":
            current_heading = _canvas_node_text(block).strip()
            record(block, current_heading)
        else:
            record(block, current_heading)

    return section_by_id


def _normalized_section_heading(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def _restructure_cross_section_issue(
    operations: list[dict[str, Any]],
    canvas_document_json: dict[str, Any],
) -> str | None:
    section_by_id = _canvas_section_heading_by_block_id(canvas_document_json)
    section_headings = {
        _normalized_section_heading(heading): heading
        for heading in section_by_id.values()
        if len(_normalized_section_heading(heading)) >= 3
    }
    if len(section_headings) < 2:
        return None

    for operation in operations:
        target = operation.get("targetBlockId")
        target_heading = section_by_id.get(target) if isinstance(target, str) else None
        normalized_target_heading = _normalized_section_heading(target_heading or "")
        if not normalized_target_heading:
            continue
        node_text = _normalized_section_heading(_canvas_node_text(operation.get("node")))
        if not node_text:
            continue
        for normalized_heading, heading in section_headings.items():
            if normalized_heading == normalized_target_heading:
                continue
            if normalized_heading in node_text:
                return f"restructure mixed another section heading into '{target_heading}': {heading}"
    return None


def _canvas_recommendation_quality_issue(
    *,
    canvas_recommendation_mode: str | None,
    operations: list[dict[str, Any]],
    canvas_document_json: dict[str, Any],
    canvas_markdown: str,
    canvas_block_context: dict[str, Any] | None = None,
) -> str | None:
    target_text = _canvas_quality_target_text(canvas_markdown, canvas_block_context)
    scoped_ids = set(_selection_scoped_block_ids(canvas_block_context))
    if scoped_ids:
        for operation in operations:
            if not _operation_target_is_in_selection_scope(operation, scoped_ids):
                return f"selection scope operation targeted an unselected block: {operation.get('targetBlockId')}"

    if not operations:
        return None

    if canvas_recommendation_mode == "shorten":
        operation_text = _canvas_operations_text(operations)
        if len(target_text) > 350 and len(operation_text) / max(len(target_text), 1) > 0.72:
            return "shorten did not reduce the target enough"

    if canvas_recommendation_mode == "expand":
        operation_text = _canvas_operations_text(operations)
        if len(target_text) > 120 and len(operation_text) / max(len(target_text), 1) > 2.80:
            return "expand added too much content relative to the target"

    if canvas_recommendation_mode == "restructure":
        if len(target_text) > 180 and not _has_canvas_operation_node(operations, {"bulletList", "orderedList", "horizontalRule"}):
            return "restructure returned no real list or section structure"
        body_block_ids = set(_scoped_body_block_ids_ordered(canvas_document_json, canvas_block_context))
        touched_body_ids = {
            operation.get("targetBlockId")
            for operation in operations
            if operation.get("targetBlockId") in body_block_ids
        }
        if _scoped_heading_count(canvas_document_json, canvas_block_context) >= 2 and len(body_block_ids) >= 2 and len(touched_body_ids) < 2:
            return "restructure touched only one body section in a multi-section target"
        cross_section_issue = _restructure_cross_section_issue(operations, canvas_document_json)
        if cross_section_issue:
            return cross_section_issue

    if canvas_recommendation_mode == "extract_key_points":
        if len(target_text) > 160 and not _has_canvas_operation_node(operations, {"bulletList", "orderedList"}):
            return "extract_key_points returned no bulletList or orderedList node"
        list_item_count = _count_canvas_operation_nodes(operations, "listItem")
        if list_item_count > 6:
            return f"extract_key_points returned too many list items ({list_item_count})"
        single_topic_target = _scoped_heading_count(canvas_document_json, canvas_block_context) <= 1
        if single_topic_target and _count_canvas_operation_nodes(operations, "bulletList") > 1:
            return "extract_key_points split one topic into multiple bulletList nodes"
        body_block_ids = set(_scoped_body_block_ids_ordered(canvas_document_json, canvas_block_context))
        if single_topic_target and any(
            isinstance(operation.get("node"), dict)
            and operation["node"].get("type") == "paragraph"
            and operation.get("targetBlockId") in body_block_ids
            for operation in operations
        ):
            return "extract_key_points returned a body paragraph for a single-topic key-points result"
        touched_body_ids = {
            operation.get("targetBlockId")
            for operation in operations
            if operation.get("targetBlockId") in body_block_ids
        }
        if len(body_block_ids) >= 3 and _has_canvas_operation_node(operations, {"bulletList", "orderedList"}) and len(touched_body_ids) < 2:
            return "extract_key_points appears to summarize only one body block while leaving other body blocks unchanged"

    if canvas_recommendation_mode == "mark_uncertain":
        operation_text = _canvas_operations_text(operations)
        if "확인 필요" not in operation_text:
            return "mark_uncertain returned no explicit 확인 필요 marker"
        if any(operation.get("op") == "delete" for operation in operations):
            return "mark_uncertain used delete even though uncertain content should be preserved"
        original_blocks = _canvas_block_text_by_id(canvas_document_json)
        uncertain_keywords = ("항상", "모든 경우", "절대", "무조건", "반드시")
        for operation in operations:
            if operation.get("op") != "replace":
                continue
            target = operation.get("targetBlockId")
            original_text = original_blocks.get(target) if isinstance(target, str) else None
            if not original_text:
                continue
            replacement_text = _canvas_node_text(operation.get("node"))
            missing = [keyword for keyword in uncertain_keywords if keyword in original_text and keyword not in replacement_text]
            if missing:
                return f"mark_uncertain removed uncertain source wording: {', '.join(missing)}"

    return None


def _canvas_list_item_groups(operations: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    groups: list[list[dict[str, Any]]] = []
    for operation in operations:
        node = operation.get("node")
        for child in _iter_canvas_nodes(node):
            if child.get("type") not in {"bulletList", "orderedList"}:
                continue
            content = child.get("content")
            if not isinstance(content, list):
                continue
            items = [deepcopy(item) for item in content if isinstance(item, dict) and item.get("type") == "listItem"]
            if items:
                groups.append(items)
    return groups


def _normalize_compact_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip(" -0123456789.").strip()


def _direct_list_item_text(item: dict[str, Any]) -> str:
    content = item.get("content")
    if not isinstance(content, list):
        return _canvas_node_text(item).strip()
    direct_parts: list[str] = []
    for child in content:
        if isinstance(child, dict) and child.get("type") == "paragraph":
            direct_parts.append(_canvas_node_text(child))
    return " ".join(part.strip() for part in direct_parts if part.strip()).strip()


def _compact_list_item(text: str, index: int) -> dict[str, Any]:
    return {
        "type": "listItem",
        "attrs": {"blockId": f"key_point_{index}"},
        "content": [
            {
                "type": "paragraph",
                "attrs": {"blockId": f"key_point_{index}_text"},
                "content": [{"type": "text", "text": text}],
            }
        ],
    }


def _select_compact_list_items(groups: list[list[dict[str, Any]]], limit: int = 6) -> list[dict[str, Any]]:
    selected_texts: list[str] = []
    seen: set[str] = set()

    for group in groups:
        for item in group:
            text = _direct_list_item_text(item)
            normalized = _normalize_compact_text(text)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)
            selected_texts.append(text)
            if len(selected_texts) >= limit:
                return [_compact_list_item(value, index) for index, value in enumerate(selected_texts, start=1)]

    return [_compact_list_item(value, index) for index, value in enumerate(selected_texts, start=1)]


def _source_uncertain_sentences(text: str) -> list[str]:
    keywords = ("항상", "모든 경우", "절대", "무조건", "반드시")
    sentences = [
        part.strip()
        for part in re.split(r"(?<=[.!?。！？])\s+", text)
        if part.strip()
    ]
    if not sentences:
        sentences = [text.strip()] if text.strip() else []
    return [sentence for sentence in sentences if any(keyword in sentence for keyword in keywords)]


def _uncertain_list_node(target_block_id: str, sentences: list[str]) -> dict[str, Any]:
    return {
        "type": "bulletList",
        "attrs": {"blockId": f"{target_block_id}_uncertain"},
        "content": [
            {
                "type": "listItem",
                "attrs": {"blockId": f"{target_block_id}_uncertain_{index}"},
                "content": [
                    {
                        "type": "paragraph",
                        "attrs": {"blockId": f"{target_block_id}_uncertain_{index}_text"},
                        "content": [
                            {
                                "type": "text",
                                "text": f"확인 필요: {sentence}",
                                "marks": [{"type": "aiCanvasUncertain"}],
                            }
                        ],
                    }
                ],
            }
            for index, sentence in enumerate(sentences, start=1)
        ],
    }


def _preserve_mark_uncertain_operations(
    *,
    operations: list[dict[str, Any]],
    canvas_document_json: dict[str, Any],
) -> list[dict[str, Any]]:
    original_blocks = _canvas_block_text_by_id(canvas_document_json)
    risky_targets: list[str] = []
    seen_risky_targets: set[str] = set()
    for operation in operations:
        if operation.get("op") not in {"replace", "delete"}:
            continue
        target = operation.get("targetBlockId")
        original_text = original_blocks.get(target) if isinstance(target, str) else None
        if not original_text or not _source_uncertain_sentences(original_text):
            continue
        if target not in seen_risky_targets:
            seen_risky_targets.add(target)
            risky_targets.append(target)

    if risky_targets:
        return [
            {
                "op": "insert_after",
                "targetBlockId": target,
                "node": _uncertain_list_node(target, _source_uncertain_sentences(original_blocks[target])),
            }
            for target in risky_targets
        ]

    fallback: list[dict[str, Any]] = []
    for operation in operations:
        if operation.get("op") not in {"replace", "delete"}:
            fallback.append(operation)
            continue
        target = operation.get("targetBlockId")
        original_text = original_blocks.get(target) if isinstance(target, str) else None
        if not original_text:
            continue
        # mark_uncertain must never remove original note content. Convert risky
        # destructive edits into non-destructive markers near the source block.
        if operation.get("op") == "delete":
            sentences = _source_uncertain_sentences(original_text)
            if sentences:
                fallback.append({
                    "op": "insert_after",
                    "targetBlockId": target,
                    "node": _uncertain_list_node(target, sentences),
                })
            continue
        sentences = _source_uncertain_sentences(original_text)
        if not sentences:
            continue
        fallback.append({
            "op": "insert_after",
            "targetBlockId": target,
            "node": _uncertain_list_node(target, sentences),
        })
    return fallback


def _normalize_extract_key_point_operations(
    *,
    operations: list[dict[str, Any]],
    canvas_document_json: dict[str, Any],
    canvas_block_context: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    body_block_ids = _scoped_body_block_ids_ordered(canvas_document_json, canvas_block_context)
    target_block_id = body_block_ids[0] if body_block_ids else None
    if target_block_id is None:
        for operation in _filter_operations_to_selection_scope(operations, canvas_block_context):
            target = operation.get("targetBlockId")
            if isinstance(target, str):
                target_block_id = target
                break
    if target_block_id is None:
        return operations

    selected_items = _select_compact_list_items(_canvas_list_item_groups(operations), limit=6)
    if not selected_items:
        return operations

    normalized: list[dict[str, Any]] = [
        {
            "op": "replace",
            "targetBlockId": target_block_id,
            "node": {
                "type": "bulletList",
                "attrs": {"blockId": target_block_id},
                "content": selected_items,
            },
        }
    ]
    for block_id in body_block_ids[1:]:
        normalized.append({"op": "delete", "targetBlockId": block_id})
    return normalized


def format_canvas_recommendation_mode(canvas_recommendation_mode: str | None) -> str:
    if not canvas_recommendation_mode:
        return ""
    if canvas_recommendation_mode not in CANVAS_RECOMMENDATION_MODE_MEANINGS:
        return ""
    return "\n".join([
        "Canvas recommendation mode:",
        canvas_recommendation_mode,
        "",
        "Recommendation mode meaning:",
        "- polish = 마무리 다듬기",
        "- simplify = 수준 조정 - 쉽게",
        "- professionalize = 수준 조정 - 전문적으로",
        "- shorten = 길이 조절 - 짧게",
        "- expand = 길이 조절 - 길게",
        "- restructure = 정리 보강 - 구조화",
        "- extract_key_points = 정리 보강 - 핵심만",
        "- mark_uncertain = 정리 보강 - 오류 의심 표시",
    ])


def generate_ai_canvas_operations_from_chat(
    *,
    model: str,
    note: dict,
    pages: list[dict],
    messages: list[dict],
    user_content: str,
    canvas_title: str,
    canvas_markdown: str,
    canvas_document_json: dict[str, Any],
    current_page_number: int | None = None,
    selection_image: str | None = None,
    selection_image_url: str | None = None,
    context_hint: str | None = None,
    session_summary: str | None = None,
    canvas_block_context: dict[str, Any] | None = None,
    canvas_recommendation_mode: str | None = None,
) -> list[dict[str, Any]]:
    block_context_text = format_canvas_block_context(canvas_block_context)
    recommendation_mode_text = format_canvas_recommendation_mode(canvas_recommendation_mode)
    source_canvas_document_json = canvas_document_json or {"type": "doc", "content": []}
    if _should_return_noop_for_canvas_recommendation(
        canvas_recommendation_mode=canvas_recommendation_mode,
        canvas_document_json=source_canvas_document_json,
        canvas_block_context=canvas_block_context,
    ):
        return []
    request_canvas_document_json = _canvas_request_document_json(
        source_canvas_document_json,
        canvas_block_context,
        canvas_recommendation_mode,
    )
    request_canvas_markdown = _canvas_request_markdown(
        canvas_markdown or "",
        canvas_block_context,
        canvas_recommendation_mode,
    )
    request_messages = (
        []
        if canvas_recommendation_mode in CANVAS_RECOMMENDATION_MODE_MEANINGS
        else messages
    )
    canvas_document_context_label = (
        "Current Canvas compact block map JSON:"
        if canvas_recommendation_mode in CANVAS_RECOMMENDATION_MODE_MEANINGS
        else "Current Canvas document JSON:"
    )
    support_context_text = context_hint.strip() if context_hint else "(none)"
    input_items: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": "\n".join(part for part in [
                "Canvas edit context follows. Apply the priority rules from the system instructions.",
                "",
                "User request:",
                user_content,
                "",
                recommendation_mode_text,
                "" if recommendation_mode_text else None,
                f"Canvas title: {canvas_title}",
                "",
                canvas_document_context_label,
                json.dumps(request_canvas_document_json, ensure_ascii=False),
                (
                    "The compact block map omits verbose Tiptap text-node nesting for speed. "
                    "Use its attrs.blockId values as valid operation targets; returned nodes must still follow the supported Tiptap output contract."
                    if canvas_recommendation_mode in CANVAS_RECOMMENDATION_MODE_MEANINGS
                    else None
                ),
                "",
                "Current Canvas Markdown cache:",
                request_canvas_markdown or "(empty)",
                "",
                "Canvas block context:",
                block_context_text or "(none)",
                "",
                "Note/PDF context:",
                build_note_context(note, pages, current_page_number=current_page_number),
                "",
                "Support context from scoped RAG routing:",
                support_context_text,
                "",
                "Return Canvas operations JSON only.",
            ] if part is not None),
        }
    ]

    if session_summary:
        input_items.append({
            "role": "user",
            "content": (
                "Compressed summary of older conversation follows. "
                "Use it only for continuity, user preferences, decisions, and ongoing task state. "
                "Do not treat it as note, PDF, or Canvas source content.\n\n"
                f"{session_summary}"
            ),
        })

    if context_hint:
        input_items.append({
            "role": "user",
            "content": (
                "Internal assistant-only study context follows. "
                "Use it silently only when it is relevant to the user's Canvas edit request. "
                "Never reveal, quote, or describe this internal context or its raw sources to the user.\n\n"
                f"{context_hint}"
            ),
        })

    if request_messages:
        input_items.append({
            "role": "user",
            "content": (
                "Recent conversation below is for continuity only. "
                "Use it to understand the user's intent and preferred format."
            ),
        })
        for message in request_messages[-CANVAS_RECENT_MESSAGE_LIMIT:]:
            role = message["role"] if message["role"] in {"user", "assistant"} else "user"
            input_items.append({"role": role, "content": message["content"]})

    input_items.append({
        "role": "user",
        "content": "\n".join([
            "Current user request:",
            user_content,
            "",
            "Return Canvas operations JSON only.",
        ]),
    })

    image_url = _prepare_input_image_url(selection_image or selection_image_url)
    if image_url:
        input_items.append({
            "role": "user",
            "content": [
                {"type": "input_text", "text": "Selected region image for the user's request:"},
                {"type": "input_image", "image_url": image_url},
            ],
        })

    raw = generate_text_response(
        model=model,
        instructions=AI_CANVAS_EDIT_INSTRUCTIONS,
        input_items=input_items,
        temperature=0.1,
    )
    try:
        operations = _parse_validate_and_normalize_canvas_operations(raw, source_canvas_document_json)
    except HTTPException as exc:
        if exc.status_code != 502:
            raise

        retry_input_items = input_items + [{
            "role": "user",
            "content": (
                "Your previous Canvas edit response was not valid for the app. "
                "Regenerate the same edit now. Return only a valid JSON object with an operations array. "
                "Do not include Markdown fences, comments, or any text outside JSON. "
                "Use only supported Tiptap operation and node shapes from the instructions."
            ),
        }]
        retry_raw = generate_text_response(
            model=model,
            instructions=AI_CANVAS_EDIT_INSTRUCTIONS,
            input_items=retry_input_items,
            temperature=0.1,
        )
        try:
            operations = _parse_validate_and_normalize_canvas_operations(retry_raw, source_canvas_document_json)
        except HTTPException:
            second_retry_input_items = input_items + [{
                "role": "user",
                "content": (
                    "The previous Canvas edit retry was still invalid JSON. "
                    "Return only valid JSON with this exact top-level shape: {\"operations\":[...]}. "
                    "No Markdown fences. No explanation. No text outside JSON."
                ),
            }]
            second_retry_raw = generate_text_response(
                model=model,
                instructions=AI_CANVAS_EDIT_INSTRUCTIONS,
                input_items=second_retry_input_items,
                temperature=0.1,
            )
            operations = _parse_validate_and_normalize_canvas_operations(second_retry_raw, source_canvas_document_json)

    for quality_retry_index in range(2):
        quality_issue = _canvas_recommendation_quality_issue(
            canvas_recommendation_mode=canvas_recommendation_mode,
            operations=operations,
            canvas_document_json=canvas_document_json or {"type": "doc", "content": []},
            canvas_markdown=canvas_markdown or "",
            canvas_block_context=canvas_block_context,
        )
        if not quality_issue:
            return operations

        quality_retry_input_items = input_items + [{
            "role": "user",
            "content": (
                "Your previous Canvas edit JSON was syntactically valid but failed the Canvas recommendation quality check: "
                f"{quality_issue}. Regenerate the same edit and fix that issue. "
                "Return JSON only. Keep the same recommendation mode and obey all operation/node rules. "
                "If this is extract_key_points for one topic, return one compact bulletList with at most 6 listItem nodes, "
                "merge related facts, and delete or replace original body paragraphs already covered by the bullets. "
                "If this is shorten, compress harder: use 3-5 compact bullets or 1-2 short body blocks, "
                "merge related details, and avoid preserving the same paragraph-by-paragraph shape. "
                "If this is expand, keep the expansion concise: add only 2-4 grounded bullets or 1-2 concise paragraphs, "
                "and do not introduce named algorithms, protocols, models, formulas, examples, or page claims absent from the provided context. "
                "If this is restructure, use real heading/list/horizontalRule nodes, preserve each useful section heading, "
                "keep each section's content under its own heading, and do not move one section's content into another section. "
                f"This is quality retry {quality_retry_index + 1} of 2."
            ),
        }]
        try:
            quality_retry_raw = generate_text_response(
                model=model,
                instructions=AI_CANVAS_EDIT_INSTRUCTIONS,
                input_items=quality_retry_input_items,
                temperature=0.1,
            )
            operations = _parse_validate_and_normalize_canvas_operations(quality_retry_raw, source_canvas_document_json)
        except HTTPException:
            if quality_issue.startswith("selection scope operation targeted an unselected block"):
                scoped_operations = _filter_operations_to_selection_scope(operations, canvas_block_context)
                if canvas_recommendation_mode == "extract_key_points":
                    return _normalize_extract_key_point_operations(
                        operations=scoped_operations,
                        canvas_document_json=canvas_document_json or {"type": "doc", "content": []},
                        canvas_block_context=canvas_block_context,
                    )
                return scoped_operations
            if canvas_recommendation_mode == "extract_key_points":
                return _normalize_extract_key_point_operations(
                    operations=operations,
                    canvas_document_json=canvas_document_json or {"type": "doc", "content": []},
                    canvas_block_context=canvas_block_context,
                )
            if (
                canvas_recommendation_mode == "mark_uncertain"
                and (
                    quality_issue == "mark_uncertain returned no explicit 확인 필요 marker"
                    or quality_issue.startswith("mark_uncertain removed uncertain source wording")
                    or quality_issue == "mark_uncertain used delete even though uncertain content should be preserved"
                )
            ):
                if quality_issue != "mark_uncertain returned no explicit 확인 필요 marker":
                    return _preserve_mark_uncertain_operations(
                        operations=operations,
                        canvas_document_json=canvas_document_json or {"type": "doc", "content": []},
                    )
                return _normalize_mark_uncertain_operations(operations)
            return operations

    final_issue = _canvas_recommendation_quality_issue(
        canvas_recommendation_mode=canvas_recommendation_mode,
        operations=operations,
        canvas_document_json=canvas_document_json or {"type": "doc", "content": []},
        canvas_markdown=canvas_markdown or "",
        canvas_block_context=canvas_block_context,
    )
    if final_issue and final_issue.startswith("selection scope operation targeted an unselected block"):
        scoped_operations = _filter_operations_to_selection_scope(operations, canvas_block_context)
        if canvas_recommendation_mode == "extract_key_points":
            return _normalize_extract_key_point_operations(
                operations=scoped_operations,
                canvas_document_json=canvas_document_json or {"type": "doc", "content": []},
                canvas_block_context=canvas_block_context,
            )
        return scoped_operations
    if canvas_recommendation_mode == "mark_uncertain" and final_issue:
        if final_issue == "mark_uncertain returned no explicit 확인 필요 marker":
            return _normalize_mark_uncertain_operations(operations)
        if (
            final_issue.startswith("mark_uncertain removed uncertain source wording")
            or final_issue == "mark_uncertain used delete even though uncertain content should be preserved"
        ):
            return _preserve_mark_uncertain_operations(
                operations=operations,
                canvas_document_json=canvas_document_json or {"type": "doc", "content": []},
            )
    if canvas_recommendation_mode == "extract_key_points" and final_issue:
        return _normalize_extract_key_point_operations(
            operations=operations,
            canvas_document_json=canvas_document_json or {"type": "doc", "content": []},
            canvas_block_context=canvas_block_context,
        )
    return operations


def generate_capture_image_analysis(
    *,
    model: str,
    image_data_uri: str,
    filename: str,
) -> dict[str, Any]:
    mock_response = json.dumps({
        "title": "수업 자료 사진",
        "summary": "수업 중 촬영한 원본 사진입니다. 슬라이드나 판서 내용을 PDF 페이지와 연결해 복습 자료로 활용할 수 있습니다.",
        "keywords": ["수업사진", "판서", "복습자료"],
        "confidence": 0.35,
    }, ensure_ascii=False)
    raw = generate_text_response(
        model=model,
        instructions=CAPTURE_IMAGE_ANALYSIS_INSTRUCTIONS,
        input_items=[{
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": (
                        f"Filename: {filename}\n"
                        "The filename is metadata only. Do not include it in the JSON summary.\n"
                        "Analyze this classroom capture image and return the JSON shape exactly."
                    ),
                },
                {"type": "input_image", "image_url": image_data_uri},
            ],
        }],
        allow_mock=True,
        mock_response=mock_response,
    )

    parsed = _parse_json_object(raw) or json.loads(mock_response)

    title = str(parsed.get("title") or "").replace("\n", " ").strip()
    if not title:
        title = json.loads(mock_response)["title"]
    title = " ".join(title.split())[:40]
    summary = str(parsed.get("summary") or "").strip() or json.loads(mock_response)["summary"]
    keywords = parsed.get("keywords")
    if not isinstance(keywords, list):
        keywords = json.loads(mock_response)["keywords"]
    normalized_keywords = [str(keyword).strip() for keyword in keywords if str(keyword).strip()][:5]
    confidence = parsed.get("confidence", 0.35)
    try:
        confidence_value = max(0.0, min(1.0, float(confidence)))
    except Exception:
        confidence_value = 0.35

    return {
        "status": "ready",
        "title": title,
        "summary": summary[:500],
        "keywords": normalized_keywords,
        "confidence": confidence_value,
    }


def generate_pdf_image_rag_summary(
    *,
    model: str,
    image_data_uri: str,
    note_title: str,
    page_number: int,
    candidate_type: str,
) -> dict[str, Any]:
    image_url = _prepare_input_image_url(image_data_uri)
    if not image_url:
        raise HTTPException(status_code=400, detail="invalid image crop for summary")

    raw = generate_text_response(
        model=model,
        instructions=PDF_IMAGE_RAG_SUMMARY_INSTRUCTIONS,
        input_items=[{
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": (
                        f"Note title: {note_title}\n"
                        f"PDF page: {page_number}\n"
                        f"Candidate type: {candidate_type}\n"
                        "Summarize this context crop for RAG indexing. Return JSON only."
                    ),
                },
                {"type": "input_image", "image_url": image_url},
            ],
        }],
        allow_mock=False,
    )
    parsed = _parse_json_object(raw)
    if parsed is None:
        raise HTTPException(status_code=502, detail="AI returned invalid image summary JSON")

    confidence = _normalize_level(parsed.get("confidence"), default="low")
    importance = _normalize_level(parsed.get("importance"), default="medium")
    summary = " ".join(str(parsed.get("summary") or "").split()).strip()
    ocr_text = str(parsed.get("ocr_text") or "").strip()
    confidence_reason = " ".join(str(parsed.get("confidence_reason") or "").split()).strip()
    importance_reason = " ".join(str(parsed.get("importance_reason") or "").split()).strip()
    if not summary:
        raise HTTPException(status_code=502, detail="AI returned empty image summary")
    return {
        "summary": summary[:1400],
        "ocr_text": ocr_text[:1000],
        "confidence": confidence,
        "importance": importance,
        "confidence_reason": confidence_reason[:500],
        "importance_reason": importance_reason[:500],
    }


def judge_pdf_image_recheck(
    *,
    model: str,
    user_question: str,
    current_page_number: int | None = None,
    text_contexts: list[dict[str, Any]],
    image_candidates: list[dict[str, Any]],
) -> dict[str, Any]:
    raw = generate_text_response(
        model=model,
        instructions=PDF_IMAGE_RECHECK_JUDGE_INSTRUCTIONS,
        input_items=[{
            "role": "user",
            "content": (
                  "Decide whether original PDF image recheck is needed.\n\n"
                  f"User question:\n{user_question}\n\n"
                  f"Current visible PDF page: {current_page_number if current_page_number is not None else 'unknown'}\n\n"
                  "Top text chunks:\n"
                f"{json.dumps(text_contexts, ensure_ascii=False)}\n\n"
                "Image summary candidates:\n"
                f"{json.dumps(image_candidates, ensure_ascii=False)}"
            ),
        }],
        allow_mock=False,
    )
    parsed = _parse_json_object(raw)
    if parsed is None:
        raise HTTPException(status_code=502, detail="AI returned invalid image recheck judge JSON")

    selected_ids = parsed.get("image_ai_summary_ids")
    if not isinstance(selected_ids, list):
        selected_ids = []
    preferred_mode = str(parsed.get("preferred_image_mode") or "context_crop").strip()
    if preferred_mode not in {"context_crop", "page_image"}:
        preferred_mode = "context_crop"

    return {
        "needs_image_recheck": bool(parsed.get("needs_image_recheck")),
        "image_ai_summary_ids": [str(item).strip() for item in selected_ids if str(item).strip()],
        "allow_multiple": bool(parsed.get("allow_multiple")),
        "preferred_image_mode": preferred_mode,
        "reason": " ".join(str(parsed.get("reason") or "").split()).strip()[:500],
    }


def _normalize_level(value: Any, *, default: str) -> str:
    text = str(value or "").strip().lower()
    return text if text in {"high", "medium", "low"} else default


def _parse_json_object(raw: str) -> dict[str, Any] | None:
    text = raw.strip()
    if not text:
        return None

    candidates = [text]
    if text.startswith("```"):
        stripped = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        stripped = re.sub(r"\s*```$", "", stripped)
        candidates.append(stripped.strip())

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        candidates.append(text[start:end + 1])

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except Exception:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def generate_text_response(
    *,
    model: str,
    instructions: str,
    input_items: list[dict[str, Any]],
    allow_mock: bool = False,
    mock_response: str | None = None,
    temperature: float | None = None,
) -> str:
    settings = get_settings()
    provider = settings.ai_provider.strip().lower()
    requested_model = (model or "").strip()
    if requested_model.startswith("gemini-") or (not requested_model and provider == "gemini"):
        return _generate_gemini_text_response(
            model=model,
            instructions=instructions,
            input_items=input_items,
            allow_mock=allow_mock,
            mock_response=mock_response,
            temperature=temperature,
        )
    if requested_model and not requested_model.startswith("gemini-"):
        provider = "openai"
    if provider != "openai":
        raise HTTPException(status_code=503, detail=f"Unsupported AI_PROVIDER: {settings.ai_provider}")

    selected_model = requested_model or settings.openai_default_model
    if not settings.openai_api_key or settings.openai_api_key == "your_openai_api_key_here":
        if allow_mock and mock_response is not None:
            return mock_response
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    client = OpenAI(api_key=settings.openai_api_key)

    create_kwargs: dict[str, Any] = {
        "model": selected_model,
        "instructions": instructions,
        "input": input_items,
    }
    if temperature is not None:
        create_kwargs["temperature"] = temperature

    try:
        response = client.responses.create(**create_kwargs)
    except OpenAIError as exc:
        if "temperature" in create_kwargs and _is_unsupported_temperature_error(exc):
            logger.info("Retrying OpenAI request without temperature: model=%s", selected_model)
            retry_kwargs = dict(create_kwargs)
            retry_kwargs.pop("temperature", None)
            try:
                response = client.responses.create(**retry_kwargs)
            except OpenAIError as retry_exc:
                logger.exception("OpenAI request failed: model=%s", selected_model)
                raise HTTPException(status_code=502, detail="OpenAI request failed") from retry_exc
        else:
            logger.exception("OpenAI request failed: model=%s", selected_model)
            raise HTTPException(status_code=502, detail="OpenAI request failed") from exc

    answer = response.output_text.strip()
    if not answer:
        logger.warning("OpenAI returned an empty response: model=%s", selected_model)
        raise HTTPException(status_code=502, detail="OpenAI returned an empty response")
    return answer


def generate_text_response_stream(
    *,
    model: str,
    instructions: str,
    input_items: list[dict[str, Any]],
    on_delta: Callable[[str], None],
    temperature: float | None = None,
) -> str:
    settings = get_settings()
    provider = settings.ai_provider.strip().lower()
    requested_model = (model or "").strip()
    if requested_model.startswith("gemini-") or (not requested_model and provider == "gemini"):
        answer = _generate_gemini_text_response(
            model=model,
            instructions=instructions,
            input_items=input_items,
            allow_mock=False,
            mock_response=None,
            temperature=temperature,
        )
        if answer:
            on_delta(answer)
        return answer
    if requested_model and not requested_model.startswith("gemini-"):
        provider = "openai"
    if provider != "openai":
        raise HTTPException(status_code=503, detail=f"Unsupported AI_PROVIDER: {settings.ai_provider}")

    selected_model = requested_model or settings.openai_default_model
    if not settings.openai_api_key or settings.openai_api_key == "your_openai_api_key_here":
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    client = OpenAI(api_key=settings.openai_api_key)
    create_kwargs: dict[str, Any] = {
        "model": selected_model,
        "instructions": instructions,
        "input": input_items,
    }
    if temperature is not None:
        create_kwargs["temperature"] = temperature

    emitted_delta = False
    try:
        with client.responses.stream(**create_kwargs) as stream:
            for event in stream:
                if getattr(event, "type", None) != "response.output_text.delta":
                    continue
                delta = getattr(event, "delta", None)
                if isinstance(delta, str) and delta:
                    emitted_delta = True
                    on_delta(delta)
            response = stream.get_final_response()
    except OpenAIError as exc:
        if "temperature" in create_kwargs and not emitted_delta and _is_unsupported_temperature_error(exc):
            logger.info("Retrying OpenAI streaming request without temperature: model=%s", selected_model)
            retry_kwargs = dict(create_kwargs)
            retry_kwargs.pop("temperature", None)
            try:
                with client.responses.stream(**retry_kwargs) as stream:
                    for event in stream:
                        if getattr(event, "type", None) != "response.output_text.delta":
                            continue
                        delta = getattr(event, "delta", None)
                        if isinstance(delta, str) and delta:
                            on_delta(delta)
                    response = stream.get_final_response()
            except OpenAIError as retry_exc:
                logger.exception("OpenAI streaming request failed: model=%s", selected_model)
                raise HTTPException(status_code=502, detail="OpenAI request failed") from retry_exc
        else:
            logger.exception("OpenAI streaming request failed: model=%s", selected_model)
            raise HTTPException(status_code=502, detail="OpenAI request failed") from exc

    answer = response.output_text.strip()
    if not answer:
        logger.warning("OpenAI returned an empty streaming response: model=%s", selected_model)
        raise HTTPException(status_code=502, detail="OpenAI returned an empty response")
    return answer


def _is_unsupported_temperature_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return "temperature" in message and ("unsupported" in message or "not supported" in message)


def _generate_gemini_text_response(
    *,
    model: str,
    instructions: str,
    input_items: list[dict[str, Any]],
    allow_mock: bool,
    mock_response: str | None,
    temperature: float | None,
) -> str:
    settings = get_settings()
    if not settings.gemini_api_key or settings.gemini_api_key == "your_gemini_api_key_here":
        if allow_mock and mock_response is not None:
            return mock_response
        raise HTTPException(status_code=503, detail="GEMINI_API_KEY is not configured")

    selected_model = model if model and model.startswith("gemini-") else settings.gemini_default_model
    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=settings.gemini_api_key)
        config_kwargs: dict[str, Any] = {"system_instruction": instructions}
        if temperature is not None:
            config_kwargs["temperature"] = temperature
        contents = _build_gemini_contents(input_items, types)
        try:
            response = client.models.generate_content(
                model=selected_model,
                contents=contents,
                config=types.GenerateContentConfig(**config_kwargs),
            )
        except Exception as exc:
            if "temperature" in config_kwargs and _is_unsupported_temperature_error(exc):
                logger.info("Retrying Gemini request without temperature: model=%s", selected_model)
                retry_config_kwargs = dict(config_kwargs)
                retry_config_kwargs.pop("temperature", None)
                response = client.models.generate_content(
                    model=selected_model,
                    contents=contents,
                    config=types.GenerateContentConfig(**retry_config_kwargs),
                )
            else:
                raise
    except Exception as exc:
        logger.exception("Gemini request failed: model=%s", selected_model)
        raise HTTPException(status_code=502, detail="Gemini request failed") from exc

    answer = (response.text or "").strip()
    if not answer:
        logger.warning("Gemini returned an empty response: model=%s", selected_model)
        raise HTTPException(status_code=502, detail="Gemini returned an empty response")
    return answer


def _build_gemini_contents(input_items: list[dict[str, Any]], types: Any) -> list[Any]:
    role_labels = {
        "assistant": "Assistant",
        "model": "Assistant",
        "user": "User",
    }
    parts: list[Any] = []
    for item in input_items:
        role = role_labels.get(item.get("role", "user"), "User")
        content = item.get("content", "")
        if isinstance(content, list):
            text_parts = []
            for part in content:
                if part.get("type") == "input_text" and part.get("text"):
                    text_parts.append(part["text"])
                if part.get("type") == "input_image" and part.get("image_url"):
                    image_part = _build_gemini_image_part(part["image_url"], types)
                    if image_part is not None:
                        if text_parts:
                            parts.append(f"{role}: {' '.join(text_parts)}")
                            text_parts = []
                        parts.append(image_part)
            if text_parts:
                parts.append(f"{role}: {' '.join(text_parts)}")
        elif content:
            parts.append(f"{role}: {content}")
    return parts


def _build_gemini_image_part(image_url: str, types: Any) -> Any | None:
    if not image_url.startswith("data:image/"):
        return None

    header, _, encoded = image_url.partition(",")
    if not encoded:
        return None
    mime_type = header.removeprefix("data:").split(";")[0] or "image/png"
    try:
        data = base64.b64decode(encoded)
    except Exception:
        return None
    return types.Part.from_bytes(data=data, mime_type=mime_type)
