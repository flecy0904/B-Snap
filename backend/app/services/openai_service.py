import base64
from typing import Any

from fastapi import HTTPException
from openai import OpenAI, OpenAIError

from backend.app.core.config import get_settings


NOTE_CHAT_INSTRUCTIONS = """
You are B-Snap's study note assistant.
Answer in Korean unless the user explicitly asks for another language.
Use the provided note title, summary, pages, and previous messages as context.
If the context is insufficient, say what is missing and give a useful next step.
Keep the response concise and structured for a student reviewing class notes.
""".strip()


def build_note_context(note: dict, pages: list[dict]) -> str:
    page_lines = []
    for page in pages:
        content = page.get("content") or ""
        image_url = page.get("image_url") or ""
        page_lines.append(
            f"- page {page['page_number']}: content={content!r}, image_url={image_url!r}"
        )

    return "\n".join(
        [
            f"Note title: {note['title']}",
            f"Note summary: {note.get('summary') or ''}",
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
) -> list[dict[str, Any]]:
    input_items: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": "Use this note context when answering:\n\n" + build_note_context(note, pages),
        }
    ]

    for message in messages[-12:]:
        role = message["role"] if message["role"] in {"user", "assistant"} else "user"
        input_items.append({"role": role, "content": message["content"]})

    selection_context = build_selection_context(selection_rect=selection_rect, page_number=page_number)
    if selection_image:
        input_items.append(
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": f"{selection_context}\n\nUser question: {user_content}".strip()},
                    {"type": "input_image", "image_url": selection_image},
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
        ),
    )


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
