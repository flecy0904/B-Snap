from typing import Any

from fastapi import HTTPException
from openai import OpenAI, OpenAIError

from backend.app.core.config import get_settings
from backend.app.services.prompts.note_assistant import NOTE_CHAT_INSTRUCTIONS


def build_note_context(note: dict, pages: list[dict], current_page_number: int | None = None) -> str:
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
    current_page_number: int | None = None,
    selection_image_url: str | None = None,
) -> list[dict[str, Any]]:
    input_items: list[dict[str, Any]] = [
        {
            "role": "user",
            "content": "Use this note context when answering:\n\n"
            + build_note_context(note, pages, current_page_number=current_page_number),
        }
    ]

    for message in messages[-12:]:
        role = message["role"] if message["role"] in {"user", "assistant"} else "user"
        input_items.append({"role": role, "content": message["content"]})

    if selection_image_url:
        input_items.append({
            "role": "user",
            "content": [
                {"type": "input_text", "text": user_content},
                {"type": "input_image", "image_url": selection_image_url},
            ],
        })
    else:
        input_items.append({"role": "user", "content": user_content})
    return input_items


def generate_note_chat_answer(
    *,
    model: str,
    note: dict,
    pages: list[dict],
    messages: list[dict],
    user_content: str,
    current_page_number: int | None = None,
    selection_image_url: str | None = None,
) -> str:
    return generate_text_response(
        model=model,
        instructions=NOTE_CHAT_INSTRUCTIONS,
        input_items=build_response_input(
            note,
            pages,
            messages,
            user_content,
            current_page_number=current_page_number,
            selection_image_url=selection_image_url,
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
    if not settings.openai_api_key or settings.openai_api_key == "your_openai_api_key_here":
        if allow_mock and mock_response is not None:
            return mock_response
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    client = OpenAI(api_key=settings.openai_api_key)

    try:
        response = client.responses.create(
            model=model,
            instructions=instructions,
            input=input_items,
        )
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail="OpenAI request failed") from exc

    answer = response.output_text.strip()
    if not answer:
        raise HTTPException(status_code=502, detail="OpenAI returned an empty response")
    return answer
