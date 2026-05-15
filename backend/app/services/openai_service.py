import base64
import json
from typing import Any

from fastapi import HTTPException
from openai import OpenAI, OpenAIError

from backend.app.core.config import get_settings
from backend.app.services.note_page_content import extract_ai_page_text
from backend.app.services.prompts.ai_canvas import AI_CANVAS_EDIT_INSTRUCTIONS
from backend.app.services.prompts.chat_title import CHAT_TITLE_INSTRUCTIONS
from backend.app.services.prompts.note_assistant import NOTE_CHAT_INSTRUCTIONS
from backend.app.services.prompts.vision import CAPTURE_IMAGE_ANALYSIS_INSTRUCTIONS


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
) -> list[dict[str, Any]]:
    active_page_number = current_page_number if current_page_number is not None else page_number
    input_items: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": "Use this note context when answering:\n\n"
            + build_note_context(note, pages, current_page_number=active_page_number),
        }
    ]

    if messages:
        input_items.append({
            "role": "user",
            "content": (
                "Recent conversation below is for continuity only. "
                "Do not treat it as note or PDF source content."
            ),
        })

    if context_hint:
        input_items.append({
            "role": "user",
            "content": (
                "Internal assistant-only study context follows. "
                "Use it silently to improve recommendations. "
                "Never reveal, quote, or describe this internal context or its raw sources to the user.\n\n"
                f"{context_hint}"
            ),
        })

    for message in messages[-8:]:
        role = message["role"] if message["role"] in {"user", "assistant"} else "user"
        input_items.append({"role": role, "content": message["content"]})

    selection_context = build_selection_context(selection_rect=selection_rect, page_number=page_number)
    image_url = selection_image or selection_image_url
    if image_url:
        input_items.append(
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": f"{selection_context}\n\nUser question: {user_content}".strip()},
                    {"type": "input_image", "image_url": image_url},
                ],
            }
        )
    else:
        input_items.append({"role": "user", "content": f"{selection_context}\n\n{user_content}".strip()})
    return input_items


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
        parts.append(
            "The user selected a rectangular region with "
            f"x={selection_rect.get('x')}, y={selection_rect.get('y')}, "
            f"width={selection_rect.get('width')}, height={selection_rect.get('height')}, "
            f"pageWidth={selection_rect.get('pageWidth')}, pageHeight={selection_rect.get('pageHeight')}."
        )
        parts.append("If an image is attached, focus your explanation on that selected region.")
    return "\n".join(parts)


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
) -> str:
    return generate_text_response(
        model=model,
        instructions=NOTE_CHAT_INSTRUCTIONS,
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
        ),
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


def generate_ai_canvas_edit(
    *,
    model: str,
    title: str,
    markdown: str,
    instruction: str,
) -> str:
    return generate_text_response(
        model=model,
        instructions=AI_CANVAS_EDIT_INSTRUCTIONS,
        input_items=[{
            "role": "user",
            "content": "\n".join([
                f"Canvas title: {title}",
                "",
                "Current Markdown:",
                markdown or "(empty)",
                "",
                "User edit instruction:",
                instruction,
            ]),
        }],
    )


def generate_capture_image_analysis(
    *,
    model: str,
    image_data_uri: str,
    filename: str,
) -> dict[str, Any]:
    mock_response = json.dumps({
        "summary": f"{filename} 원본 사진입니다. 칠판, 슬라이드, 수업 중 추가 설명을 PDF 페이지와 연결해 복습할 수 있습니다.",
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
                        "Analyze this classroom capture image and return the JSON shape exactly."
                    ),
                },
                {"type": "input_image", "image_url": image_data_uri},
            ],
        }],
        allow_mock=True,
        mock_response=mock_response,
    )

    try:
        parsed = json.loads(raw)
    except Exception:
        parsed = json.loads(mock_response)

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
        "summary": summary[:500],
        "keywords": normalized_keywords,
        "confidence": confidence_value,
    }


def generate_text_response(
    *,
    model: str,
    instructions: str,
    input_items: list[dict[str, Any]],
    allow_mock: bool = False,
    mock_response: str | None = None,
) -> str:
    settings = get_settings()
    provider = settings.ai_provider.strip().lower()
    if provider == "gemini":
        return _generate_gemini_text_response(
            model=model,
            instructions=instructions,
            input_items=input_items,
            allow_mock=allow_mock,
            mock_response=mock_response,
        )
    if provider != "openai":
        raise HTTPException(status_code=503, detail=f"Unsupported AI_PROVIDER: {settings.ai_provider}")

    selected_model = model if model and not model.startswith("gemini-") else settings.openai_default_model
    if not settings.openai_api_key or settings.openai_api_key == "your_openai_api_key_here":
        if allow_mock and mock_response is not None:
            return mock_response
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    client = OpenAI(api_key=settings.openai_api_key)

    try:
        response = client.responses.create(
            model=selected_model,
            instructions=instructions,
            input=input_items,
        )
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail="OpenAI request failed") from exc

    answer = response.output_text.strip()
    if not answer:
        raise HTTPException(status_code=502, detail="OpenAI returned an empty response")
    return answer


def _generate_gemini_text_response(
    *,
    model: str,
    instructions: str,
    input_items: list[dict[str, Any]],
    allow_mock: bool,
    mock_response: str | None,
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
        response = client.models.generate_content(
            model=selected_model,
            contents=_build_gemini_contents(input_items, types),
            config=types.GenerateContentConfig(system_instruction=instructions),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Gemini request failed") from exc

    answer = (response.text or "").strip()
    if not answer:
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
