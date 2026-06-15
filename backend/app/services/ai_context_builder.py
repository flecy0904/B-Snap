import re
from dataclasses import dataclass
from typing import Any

from backend.app.core.config import get_settings
from backend.app.schemas.rag import RetrievedContext


@dataclass(frozen=True)
class BuiltAiContext:
    context_pages: list[dict]
    context_hint: str | None
    answer_sources_text: str | None
    debug: dict[str, Any]


def format_context_mode_instruction(mode: str, *, has_rag_sources: bool) -> str:
    if mode == "general":
        return (
            "Router mode: general.\n"
            "Answer as a general study question. Do not invent PDF-, page-, Canvas-, or subject-specific facts unless they are explicitly provided."
        )
    return (
        "Router mode: rag.\n"
        "Answer mainly from the chat's pinned reference scope and scoped RAG support context. "
        "Use selected region or Canvas/block first when the user directly asks about them. "
        "Use current page and adjacent pages as local support, not as the main basis, unless the user explicitly asks about the current page."
        if has_rag_sources
        else
        "Router mode: rag.\n"
        "The scoped RAG search returned no support context. Prioritize selected region, Canvas/block, current page, and adjacent pages; "
        "if those are not enough, say the pinned reference materials are not enough to verify the answer."
    )


def select_rag_context_pages(pages: list[dict], page_number: int | None) -> list[dict]:
    if not pages:
        return []
    if page_number is None:
        return pages[:3]

    pages_by_number = {int(page["page_number"]): page for page in pages}
    ordered_numbers = [page_number, page_number - 1, page_number + 1]
    selected = [
        pages_by_number[number]
        for number in ordered_numbers
        if number in pages_by_number
    ]
    return selected or pages[:3]


def format_rag_support_context(contexts: list[RetrievedContext]) -> str | None:
    if not contexts:
        return None

    lines = [
        "Scoped RAG reference context from the user's selected materials. "
        "Use this as the main study evidence for RAG questions unless the user specifically asks about a selected image, Canvas block, or current page:"
    ]
    for index, context in enumerate(contexts, start=1):
        page_label = f", page {context.page_number}" if context.page_number else ""
        lines.append(
            f"[{index}] {context.title} ({context.source_type}:{context.source_id}{page_label}, score={context.score:.4f})\n"
            f"{context.content}"
        )
    return "\n\n".join(lines)


def _answer_source_title(title: str, page_number: int | None) -> str:
    label = " ".join(title.split()).strip()
    if not page_number:
        return label

    page_pattern = re.escape(str(page_number))
    suffix_patterns = (
        rf"\s*[-–—]?\s*{page_pattern}\s*페이지\s*(?:이미지\s*요약|이미지|본문)?\s*$",
        rf"\s*[-–—]?\s*(?:p\.?|page)\s*{page_pattern}\s*(?:image\s*summary|image|text|body)?\s*$",
    )
    for pattern in suffix_patterns:
        next_label = re.sub(pattern, "", label, flags=re.IGNORECASE).strip()
        if next_label != label:
            label = next_label
            break
    label = label.rstrip(" -–—·").strip()
    return f"{label} · {page_number}페이지" if label else f"{page_number}페이지"


def _answer_source_kind(source_type: str) -> str:
    return "image" if source_type == "image_ai_summary" else "text"


def _format_answer_source_kinds(kinds: set[str]) -> str:
    if kinds == {"text"}:
        return ""
    labels = []
    if "text" in kinds:
        labels.append("본문")
    if "image" in kinds or "image_recheck" in kinds:
        labels.append("이미지")
    return f" ({', '.join(labels)})" if labels else ""


def format_answer_sources(
    contexts: list[RetrievedContext],
    *,
    max_sources: int = 4,
    rechecked_image_sources: list[Any] | None = None,
) -> str | None:
    source_groups: dict[tuple[str, int | None], dict[str, Any]] = {}

    for context in contexts:
        label = _answer_source_title(context.title, context.page_number)
        key = (label, context.page_number)
        if key not in source_groups:
            source_groups[key] = {"label": label, "kinds": set()}
        source_groups[key]["kinds"].add(_answer_source_kind(context.source_type))

    for item in rechecked_image_sources or []:
        page_number = getattr(item, "page_number", None)
        label = _answer_source_title(str(getattr(item, "title", "")), page_number)
        key = (label, page_number)
        if key not in source_groups:
            source_groups[key] = {"label": label, "kinds": set()}
        source_groups[key]["kinds"].add("image_recheck")

    source_lines = [
        f"- {group['label']}{_format_answer_source_kinds(group['kinds'])}"
        for group in source_groups.values()
    ][:max_sources]

    if not source_lines:
        return None
    return "참고 자료\n" + "\n".join(source_lines)


def build_ai_context(
    *,
    mode: str,
    pages: list[dict],
    page_number: int | None,
    base_context_hints: list[str | None],
    rag_sources: list[RetrievedContext],
    rag_debug: dict[str, Any] | None = None,
    priority_context_hints: list[str | None] | None = None,
    extra_answer_sources_text: str | None = None,
    rechecked_image_sources: list[Any] | None = None,
) -> BuiltAiContext:
    context_pages = [] if mode == "general" else select_rag_context_pages(pages, page_number)
    rag_support_hint = format_rag_support_context(rag_sources) if mode == "rag" else None
    context_hint = "\n\n".join(
        hint
        for hint in [*base_context_hints, *(priority_context_hints or []), rag_support_hint]
        if hint
    ) or None
    debug = {
        "retrieved_source_count": len({f"{context.source_type}:{context.source_id}" for context in rag_sources}),
        "retrieved_chunk_count": len(rag_sources),
        "context_page_count": len(context_pages),
        "context_page_number": page_number,
        "fallback": False,
        "fallback_reason": None,
    }
    if rag_debug:
        debug.update(rag_debug)
    source_display_max = max(1, int(get_settings().rag_source_display_max or 4))
    answer_sources_text = format_answer_sources(
        rag_sources,
        max_sources=source_display_max,
        rechecked_image_sources=rechecked_image_sources,
    ) if mode == "rag" else None
    if extra_answer_sources_text and mode == "rag":
        answer_sources_text = "\n".join(
            part
            for part in [answer_sources_text, extra_answer_sources_text]
            if part
        )
    return BuiltAiContext(
        context_pages=context_pages,
        context_hint=context_hint,
        answer_sources_text=answer_sources_text,
        debug=debug,
    )
