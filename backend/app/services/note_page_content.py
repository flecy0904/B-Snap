import json
from typing import Any


PAGE_STATE_KIND = "bsnap-page-state"
PAGE_STATE_VERSION = 1


def _empty_page_state() -> dict[str, Any]:
    return {
        "kind": PAGE_STATE_KIND,
        "version": PAGE_STATE_VERSION,
        "inkStrokes": [],
        "textAnnotations": [],
    }


def parse_page_state(content: str | None) -> dict[str, Any] | None:
    if not content:
        return None

    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return None

    if not isinstance(parsed, dict):
        return None
    if parsed.get("kind") != PAGE_STATE_KIND or parsed.get("version") != PAGE_STATE_VERSION:
        return None

    return parsed


def merge_page_state_content(
    current_content: str | None,
    next_content: str | None,
    *,
    pdf_text: str | None = None,
) -> str | None:
    if next_content is None and pdf_text is None:
        return current_content

    current_state = parse_page_state(current_content)
    next_state = parse_page_state(next_content)

    if next_content is not None and next_state is None and pdf_text is None:
        return next_content

    merged = next_state or current_state or _empty_page_state()
    if current_state and current_state.get("pdfText") and "pdfText" not in merged:
        merged["pdfText"] = current_state["pdfText"]
    if pdf_text is not None:
        merged["pdfText"] = pdf_text

    merged["inkStrokes"] = merged.get("inkStrokes") if isinstance(merged.get("inkStrokes"), list) else []
    merged["textAnnotations"] = (
        merged.get("textAnnotations") if isinstance(merged.get("textAnnotations"), list) else []
    )

    return json.dumps(merged, ensure_ascii=False, separators=(",", ":"))


def extract_ai_page_text(content: str | None) -> str:
    if not content:
        return ""

    state = parse_page_state(content)
    if state is None:
        return content

    parts: list[str] = []
    pdf_text = state.get("pdfText")
    if isinstance(pdf_text, str) and pdf_text.strip():
        parts.append(f"PDF text:\n{pdf_text.strip()}")

    text_annotations = state.get("textAnnotations")
    if isinstance(text_annotations, list):
        annotation_texts = [
            str(annotation.get("text", "")).strip()
            for annotation in text_annotations
            if isinstance(annotation, dict) and str(annotation.get("text", "")).strip()
        ]
        if annotation_texts:
            parts.append("User text notes:\n" + "\n".join(annotation_texts))

    return "\n\n".join(parts)
