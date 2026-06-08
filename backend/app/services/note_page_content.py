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
        "imageAnnotations": [],
        "bookmarked": False,
        "photoReferenceCount": 0,
        "memoPageCount": 0,
    }


def _normalize_count(value: Any) -> int:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return max(0, int(value))
    return 0


def _normalize_handwriting_recognition(value: Any) -> dict[str, Any] | None:
    if not isinstance(value, dict):
        return None

    normalized: dict[str, Any] = {
        "status": value.get("status") if value.get("status") in {"pending", "ready", "failed", "unavailable"} else "unavailable",
        "strokeHash": str(value.get("strokeHash") or ""),
        "engine": value.get("engine") if value.get("engine") in {"geometry", "mlkit-digital-ink", "openai-vision", "hybrid"} else "geometry",
        "text": str(value.get("text") or ""),
        "keywords": [str(keyword) for keyword in value.get("keywords", []) if isinstance(keyword, str)],
        "symbols": [str(symbol) for symbol in value.get("symbols", []) if isinstance(symbol, str)],
        "confidence": 0.0,
        "clusters": [],
    }

    confidence = value.get("confidence")
    if isinstance(confidence, (int, float)):
        normalized["confidence"] = max(0.0, min(1.0, float(confidence)))

    clusters = value.get("clusters")
    if isinstance(clusters, list):
        normalized["clusters"] = [cluster for cluster in clusters if isinstance(cluster, dict)]

    updated_at = value.get("updatedAt")
    if isinstance(updated_at, str) and updated_at:
        normalized["updatedAt"] = updated_at

    for key in ["visionFallbackUsed", "cached", "stale"]:
        if key in value:
            normalized[key] = bool(value.get(key))

    skipped_reason = value.get("visionFallbackSkippedReason")
    if isinstance(skipped_reason, str) and skipped_reason:
        normalized["visionFallbackSkippedReason"] = skipped_reason

    for key in ["analyzedClusterCount", "visionAnalyzedClusterCount"]:
        if key in value:
            normalized[key] = _normalize_count(value.get(key))

    return normalized


def normalize_page_state_for_save(state: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(state)
    normalized["kind"] = PAGE_STATE_KIND
    normalized["version"] = PAGE_STATE_VERSION
    normalized["inkStrokes"] = normalized.get("inkStrokes") if isinstance(normalized.get("inkStrokes"), list) else []
    normalized["textAnnotations"] = (
        normalized.get("textAnnotations") if isinstance(normalized.get("textAnnotations"), list) else []
    )
    normalized["imageAnnotations"] = (
        normalized.get("imageAnnotations") if isinstance(normalized.get("imageAnnotations"), list) else []
    )
    normalized["bookmarked"] = bool(normalized.get("bookmarked", False))
    normalized["photoReferenceCount"] = _normalize_count(normalized.get("photoReferenceCount", 0))
    normalized["memoPageCount"] = _normalize_count(normalized.get("memoPageCount", 0))

    handwriting_recognition = _normalize_handwriting_recognition(normalized.get("handwritingRecognition"))
    if handwriting_recognition is not None:
        normalized["handwritingRecognition"] = handwriting_recognition
    else:
        normalized.pop("handwritingRecognition", None)

    return normalized


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


def merge_handwriting_recognition(content: str | None, recognition: dict[str, Any]) -> str | None:
    state = parse_page_state(content) or _empty_page_state()
    state["handwritingRecognition"] = recognition
    return json.dumps(normalize_page_state_for_save(state), ensure_ascii=False, separators=(",", ":"))


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

    if current_state and current_state.get("handwritingRecognition") and "handwritingRecognition" not in merged:
        merged["handwritingRecognition"] = current_state["handwritingRecognition"]

    return json.dumps(normalize_page_state_for_save(merged), ensure_ascii=False, separators=(",", ":"))


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
