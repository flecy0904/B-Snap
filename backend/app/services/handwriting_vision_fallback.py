import base64
import hashlib
import json
import os
import time
from functools import lru_cache
from io import BytesIO
from typing import Any

from backend.app.services.handwriting_signals import SYMBOL_NAMES, normalize_korean_study_keywords


VISION_PROMPT = """You are analyzing an image that contains only handwritten annotations written by a student on top of a lecture PDF.
The original PDF content is not included.
Extract only study-importance signals.
Return strict JSON only.

Detect Korean handwritten keywords:
중요, 시험, 시험범위, 중간, 중간고사, 기말, 기말고사, 퀴즈, 암기, 필수, 공식, 주의, 체크, 별표, 복습, 정리, 나옴, 나온다.

Detect visual symbols:
star, check, circle, box, underline, bracket, arrow, exclamation.

Return:
{
  "text": "...",
  "keywords": ["중요", "시험"],
  "symbols": ["star", "check"],
  "confidence": 0.0
}

Do not summarize the lecture content.
Do not infer concepts from the PDF.
Only analyze the handwriting marks visible in the image."""

_VISION_RESULT_CACHE: dict[str, dict[str, Any]] = {}


def _get_env_int(name: str, default: int, minimum: int = 0) -> int:
    try:
        return max(minimum, int(os.getenv(name, str(default))))
    except (TypeError, ValueError):
        return default


def vision_fallback_enabled() -> bool:
    return os.getenv("HANDWRITING_VISION_FALLBACK_ENABLED", "").strip().lower() == "true"


def vision_api_key_available() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def vision_max_clusters_per_page() -> int:
    return _get_env_int("HANDWRITING_VISION_MAX_CLUSTERS_PER_PAGE", 6, 0)


def vision_max_pages_per_note() -> int:
    return _get_env_int("HANDWRITING_VISION_MAX_PAGES_PER_NOTE", 8, 0)


def vision_min_cluster_strokes() -> int:
    return _get_env_int("HANDWRITING_VISION_MIN_CLUSTER_STROKES", 2, 1)


def vision_cache_ttl_days() -> int:
    return _get_env_int("HANDWRITING_VISION_CACHE_TTL_DAYS", 14, 0)


def clear_vision_result_cache_for_tests() -> None:
    _VISION_RESULT_CACHE.clear()
    _cached_unavailable.cache_clear()


def _cache_ttl_seconds() -> int:
    return vision_cache_ttl_days() * 24 * 60 * 60


def _cache_result(cache_key: str, result: dict[str, Any]) -> dict[str, Any]:
    cached_result = dict(result)
    cached_result["cached"] = False
    _VISION_RESULT_CACHE[cache_key] = {
        "cachedAt": time.time(),
        "result": dict(cached_result),
    }
    return cached_result


def _get_cached_result(cache_key: str) -> dict[str, Any] | None:
    entry = _VISION_RESULT_CACHE.get(cache_key)
    if not isinstance(entry, dict):
        return None
    cached_at = entry.get("cachedAt")
    result = entry.get("result")
    if not isinstance(cached_at, (int, float)) or not isinstance(result, dict):
        _VISION_RESULT_CACHE.pop(cache_key, None)
        return None
    ttl_seconds = _cache_ttl_seconds()
    if ttl_seconds <= 0 or time.time() - float(cached_at) > ttl_seconds:
        _VISION_RESULT_CACHE.pop(cache_key, None)
        return None
    cached = dict(result)
    cached["cached"] = True
    return cached


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return default


def _stroke_points(stroke: dict[str, Any]) -> list[dict[str, Any]]:
    points = stroke.get("points")
    return [point for point in points if isinstance(point, dict)] if isinstance(points, list) else []


def _point_xy(point: dict[str, Any]) -> tuple[float, float] | None:
    if not isinstance(point.get("x"), (int, float)) or not isinstance(point.get("y"), (int, float)):
        return None
    return float(point["x"]), float(point["y"])


def _stroke_color(stroke: dict[str, Any]) -> tuple[int, int, int, int]:
    value = str(stroke.get("color") or "#111827").strip()
    if value.startswith("#"):
        raw = value[1:]
        if len(raw) == 3:
            raw = "".join(char * 2 for char in raw)
        if len(raw) >= 6:
            try:
                return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16), 255
            except ValueError:
                pass
    return 17, 24, 39, 255


def render_ink_cluster_to_png(cluster: dict[str, Any], page_size: dict[str, Any] | None = None) -> bytes:
    try:
        from PIL import Image, ImageDraw
    except Exception:
        return b""

    strokes = [stroke for stroke in cluster.get("strokes", []) if isinstance(stroke, dict)]
    points = [xy for stroke in strokes for point in _stroke_points(stroke) if (xy := _point_xy(point)) is not None]
    if not points:
        return b""

    bbox = cluster.get("bbox") if isinstance(cluster.get("bbox"), dict) else None
    min_x = float(bbox.get("x")) if bbox and isinstance(bbox.get("x"), (int, float)) else min(point[0] for point in points)
    min_y = float(bbox.get("y")) if bbox and isinstance(bbox.get("y"), (int, float)) else min(point[1] for point in points)
    max_x = (
        min_x + float(bbox.get("width"))
        if bbox and isinstance(bbox.get("width"), (int, float))
        else max(point[0] for point in points)
    )
    max_y = (
        min_y + float(bbox.get("height"))
        if bbox and isinstance(bbox.get("height"), (int, float))
        else max(point[1] for point in points)
    )

    if page_size:
        page_width = page_size.get("width") or page_size.get("pageWidth")
        page_height = page_size.get("height") or page_size.get("pageHeight")
        if isinstance(page_width, (int, float)) and isinstance(page_height, (int, float)):
            min_x = max(0.0, min(min_x, float(page_width)))
            min_y = max(0.0, min(min_y, float(page_height)))
            max_x = max(min_x, min(max_x, float(page_width)))
            max_y = max(min_y, min(max_y, float(page_height)))

    padding = 28
    raw_width = max(1.0, max_x - min_x)
    raw_height = max(1.0, max_y - min_y)
    canvas_width = max(96, int(raw_width + padding * 2))
    canvas_height = max(96, int(raw_height + padding * 2))
    scale = max(1.0, min(5.0, 280 / max(canvas_width, canvas_height)))
    image = Image.new("RGBA", (int(canvas_width * scale), int(canvas_height * scale)), (255, 255, 255, 255))
    draw = ImageDraw.Draw(image)

    for stroke in strokes:
        is_highlighter = stroke.get("style") == "highlight" or stroke.get("brush") == "highlighter"
        color = _stroke_color(stroke)
        if is_highlighter:
            color = color[:3] + (92,)
        stroke_points = [
            ((xy[0] - min_x + padding) * scale, (xy[1] - min_y + padding) * scale)
            for point in _stroke_points(stroke)
            if (xy := _point_xy(point)) is not None
        ]
        if len(stroke_points) >= 2:
            width = max(2, int(float(stroke.get("width") or 2) * scale))
            draw.line(stroke_points, fill=color, width=width, joint="curve")
        elif len(stroke_points) == 1:
            radius = max(2, int(float(stroke.get("width") or 2) * scale))
            x, y = stroke_points[0]
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)

    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


@lru_cache(maxsize=256)
def _cached_unavailable(stroke_hash: str) -> str:
    return json.dumps({
        "status": "unavailable",
        "strokeHash": stroke_hash,
        "engine": "openai-vision",
        "text": "",
        "keywords": [],
        "symbols": [],
        "confidence": 0.0,
    })


def _safe_result(
    *,
    status: str,
    stroke_hash: str,
    text: str = "",
    keywords: list[str] | None = None,
    symbols: list[str] | None = None,
    confidence: float = 0.0,
) -> dict[str, Any]:
    normalized_keywords = normalize_korean_study_keywords(text, keywords or [])
    normalized_symbols = [
        symbol
        for symbol in dict.fromkeys(symbols or [])
        if isinstance(symbol, str) and symbol in SYMBOL_NAMES
    ]
    return {
        "status": status,
        "strokeHash": stroke_hash,
        "engine": "openai-vision",
        "text": text,
        "keywords": normalized_keywords,
        "symbols": normalized_symbols,
        "confidence": _coerce_float(confidence),
    }


def _extract_response_text(response: Any) -> str:
    output_text = getattr(response, "output_text", None)
    if isinstance(output_text, str):
        return output_text.strip()

    output = getattr(response, "output", None)
    if isinstance(output, list):
        for item in output:
            content = getattr(item, "content", None)
            if isinstance(content, list):
                for part in content:
                    text = getattr(part, "text", None)
                    if isinstance(text, str):
                        return text.strip()
                    if isinstance(part, dict) and isinstance(part.get("text"), str):
                        return part["text"].strip()
    return ""


def _call_openai_vision(image_payload: str) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    response = client.responses.create(
        model=os.getenv("HANDWRITING_VISION_MODEL", "gpt-4.1-mini"),
        input=[{
            "role": "user",
            "content": [
                {"type": "input_text", "text": VISION_PROMPT},
                {"type": "input_image", "image_url": f"data:image/png;base64,{image_payload}"},
            ],
        }],
        text={"format": {"type": "json_object"}},
    )
    return _extract_response_text(response)


def analyze_handwriting_image_with_openai(image_bytes: bytes, *, stroke_hash: str = "") -> dict[str, Any]:
    cache_key = hashlib.sha256(image_bytes + stroke_hash.encode("utf-8")).hexdigest()
    cached_result = _get_cached_result(cache_key)
    if cached_result is not None:
        return cached_result

    if not vision_fallback_enabled() or not os.getenv("OPENAI_API_KEY") or not image_bytes:
        unavailable = json.loads(_cached_unavailable(stroke_hash))
        unavailable["cached"] = False
        return unavailable

    try:
        image_payload = base64.b64encode(image_bytes).decode("ascii")
        raw_text = _call_openai_vision(image_payload)
        parsed = json.loads(raw_text)
        result = _safe_result(
            status="ready",
            stroke_hash=stroke_hash,
            text=str(parsed.get("text") or ""),
            keywords=[str(value) for value in parsed.get("keywords", []) if isinstance(value, str)],
            symbols=[str(value) for value in parsed.get("symbols", []) if isinstance(value, str)],
            confidence=_coerce_float(parsed.get("confidence")),
        )
        return _cache_result(cache_key, result)
    except (json.JSONDecodeError, TypeError, ValueError):
        return _cache_result(cache_key, _safe_result(status="failed", stroke_hash=stroke_hash))
    except Exception:
        return _cache_result(cache_key, _safe_result(status="failed", stroke_hash=stroke_hash))
