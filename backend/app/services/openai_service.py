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
) -> list[dict[str, str]]:
    input_items: list[dict[str, str]] = [
        {
            "role": "user",
            "content": "Use this note context when answering:\n\n" + build_note_context(note, pages),
        }
    ]

    for message in messages[-12:]:
        role = message["role"] if message["role"] in {"user", "assistant"} else "user"
        input_items.append({"role": role, "content": message["content"]})

    input_items.append({"role": "user", "content": user_content})
    return input_items


def generate_note_chat_answer(
    *,
    model: str,
    note: dict,
    pages: list[dict],
    messages: list[dict],
    user_content: str,
) -> str:
    settings = get_settings()
    if not settings.openai_api_key or settings.openai_api_key == "your_openai_api_key_here":
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")

    client = OpenAI(api_key=settings.openai_api_key)

    try:
        response = client.responses.create(
            model=model,
            instructions=NOTE_CHAT_INSTRUCTIONS,
            input=build_response_input(note, pages, messages, user_content),
        )
    except OpenAIError as exc:
        raise HTTPException(status_code=502, detail="OpenAI request failed") from exc

    answer = response.output_text.strip()
    if not answer:
        raise HTTPException(status_code=502, detail="OpenAI returned an empty response")
    return answer
