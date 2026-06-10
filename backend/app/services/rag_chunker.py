from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


DEFAULT_CHUNK_SIZE = 800
DEFAULT_CHUNK_OVERLAP = 100
DEFAULT_BLOCK_OVERLAP_CHARS = 180
MIN_MEANINGFUL_TEXT_CHARS = 12


@dataclass(frozen=True)
class IndexSource:
    source_type: str
    source_id: str
    title: str
    content: str
    user_id: int
    folder_id: int | None = None
    note_id: int | None = None
    page_number: int | None = None
    source_updated_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    layout_blocks: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class TextChunk:
    source: IndexSource
    chunk_index: int
    content: str
    metadata: dict[str, Any] = field(default_factory=dict)


def is_meaningful_text(text: str | None) -> bool:
    if not text:
        return False
    normalized = " ".join(text.split())
    if len(normalized) < MIN_MEANINGFUL_TEXT_CHARS:
        return False
    useful_chars = sum(1 for char in normalized if char.isalnum())
    return useful_chars >= 8


def _has_useful_chunk_content(text: str) -> bool:
    return sum(1 for char in text if char.isalnum()) >= 3


def split_text_into_chunks(
    text: str,
    *,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> list[str]:
    if not text:
        return []
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("overlap must be greater than or equal to 0 and smaller than chunk_size")

    normalized = " ".join(text.split())
    if not is_meaningful_text(normalized):
        return []

    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = _chunk_end_at_word_boundary(normalized, start, chunk_size)
        chunk = normalized[start:end].strip()
        if _has_useful_chunk_content(chunk):
            chunks.append(chunk)
        if end >= len(normalized):
            break
        next_start = _next_chunk_start_at_word_boundary(normalized, start, end, overlap)
        if next_start <= start:
            next_start = _next_word_start(normalized, end)
        if next_start >= len(normalized):
            break
        start = next_start
    return chunks


def _chunk_end_at_word_boundary(text: str, start: int, chunk_size: int) -> int:
    target = min(len(text), start + chunk_size)
    if target >= len(text):
        return len(text)

    boundary = text.rfind(" ", start + 1, target + 1)
    if boundary > start:
        return boundary

    next_boundary = text.find(" ", target)
    if next_boundary >= 0:
        return next_boundary
    return len(text)


def _next_chunk_start_at_word_boundary(text: str, start: int, end: int, overlap: int) -> int:
    if overlap <= 0:
        return _next_word_start(text, end)

    approximate = max(start, end - overlap)
    boundary = text.rfind(" ", start, approximate + 1)
    if boundary >= start:
        return _next_word_start(text, boundary + 1)
    return start


def _next_word_start(text: str, index: int) -> int:
    while index < len(text) and text[index] == " ":
        index += 1
    while index < len(text) and index > 0 and text[index - 1] != " ":
        index += 1
    while index < len(text) and text[index] == " ":
        index += 1
    return index


def build_text_chunks(source: IndexSource) -> list[TextChunk]:
    if source.source_type == "pdf_page" and source.layout_blocks:
        block_chunks = build_block_aware_text_chunks(source)
        if block_chunks:
            return block_chunks
    return [
        TextChunk(source=source, chunk_index=index, content=content)
        for index, content in enumerate(split_text_into_chunks(source.content), start=1)
    ]


def build_block_aware_text_chunks(
    source: IndexSource,
    *,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    block_overlap_chars: int = DEFAULT_BLOCK_OVERLAP_CHARS,
) -> list[TextChunk]:
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")

    prepared_blocks = _prepare_layout_blocks(source.layout_blocks)
    if not prepared_blocks:
        return []

    chunks: list[TextChunk] = []
    current: list[dict[str, Any]] = []
    last_flushed_block: dict[str, Any] | None = None

    def flush() -> None:
        nonlocal current, last_flushed_block
        content = _join_block_texts(current)
        if _has_useful_chunk_content(content):
            chunks.append(
                TextChunk(
                    source=source,
                    chunk_index=len(chunks) + 1,
                    content=content,
                    metadata=_build_block_chunk_metadata(source, current),
                )
            )
            actual_blocks = [block for block in current if not block.get("is_overlap")]
            if actual_blocks:
                last_flushed_block = actual_blocks[-1]
        current = []

    for block in prepared_blocks:
        text = str(block.get("text") or "").strip()
        if not text:
            continue

        if len(text) > chunk_size:
            if current:
                flush()
            for segment_index, segment in enumerate(_split_long_block_text(text, chunk_size), start=1):
                segment_block = {**block, "text": segment, "segment_index": segment_index}
                chunks.append(
                    TextChunk(
                        source=source,
                        chunk_index=len(chunks) + 1,
                        content=segment,
                        metadata=_build_block_chunk_metadata(source, [segment_block]),
                    )
                )
            last_flushed_block = block
            continue

        next_blocks = [*current, block]
        if current and len(_join_block_texts(next_blocks)) > chunk_size:
            flush()
            if last_flushed_block:
                overlap_block = _make_overlap_block(last_flushed_block, block_overlap_chars)
                if overlap_block:
                    current.append(overlap_block)
        current.append(block)

    if current:
        flush()

    return chunks


def _prepare_layout_blocks(blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    main_blocks: list[dict[str, Any]] = []
    side_label_blocks: list[dict[str, Any]] = []
    for block in blocks:
        if not isinstance(block, dict):
            continue
        role = str(block.get("role") or "main_text")
        if role == "header_footer_candidate":
            continue
        if role == "image":
            continue
        text = _clean_block_text(block.get("text"))
        if not text:
            continue
        next_block = {
            "text": _format_layout_block_text(role, text),
            "role": role,
            "readingOrder": _safe_int(block.get("readingOrder")),
            "blockIndex": _safe_int(block.get("blockIndex")),
            "bbox": block.get("bbox") if isinstance(block.get("bbox"), list) else None,
            "textPreview": block.get("textPreview"),
        }
        if role == "side_label_candidate":
            side_label_blocks.append(next_block)
        else:
            main_blocks.append(next_block)

    ordered = sorted(main_blocks, key=_layout_block_sort_key)
    if side_label_blocks:
        ordered.append({
            "text": "[Figure labels]",
            "role": "figure_labels_heading",
            "readingOrder": None,
            "blockIndex": None,
            "bbox": None,
            "textPreview": "[Figure labels]",
        })
        ordered.extend(sorted(side_label_blocks, key=_layout_block_sort_key))
    return ordered


def _format_layout_block_text(role: str, text: str) -> str:
    labels = {
        "title": "Title",
        "content": "Content",
        "figure": "Figure",
        "image": "Image",
        "other": "Block",
    }
    label = labels.get(role)
    if not label:
        return text
    if text.startswith(f"[{label}]"):
        return text
    return f"[{label}]\n{text}"


def _layout_block_sort_key(block: dict[str, Any]) -> tuple[int, int]:
    reading_order = block.get("readingOrder")
    block_index = block.get("blockIndex")
    return (
        int(reading_order) if isinstance(reading_order, int) and reading_order >= 0 else 1_000_000,
        int(block_index) if isinstance(block_index, int) and block_index >= 0 else 1_000_000,
    )


def _clean_block_text(value: Any) -> str:
    if value is None:
        return ""
    lines = [line.strip() for line in str(value).replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(line for line in lines if line).strip()


def _join_block_texts(blocks: list[dict[str, Any]]) -> str:
    return "\n\n".join(str(block.get("text") or "").strip() for block in blocks if str(block.get("text") or "").strip()).strip()


def _split_long_block_text(text: str, chunk_size: int) -> list[str]:
    normalized = " ".join(text.split())
    if len(normalized) <= chunk_size:
        return [normalized]

    words = [word for word in normalized.split(" ") if word]
    if not words:
        return []

    segments: list[str] = []
    current_words: list[str] = []
    current_length = 0
    for word in words:
        if len(word) > chunk_size:
            if current_words:
                segments.append(" ".join(current_words))
                current_words = []
                current_length = 0
            segments.append(word)
            continue

        next_length = len(word) if not current_words else current_length + 1 + len(word)
        if current_words and next_length > chunk_size:
            segments.append(" ".join(current_words))
            current_words = [word]
            current_length = len(word)
            continue

        current_words.append(word)
        current_length = next_length

    if current_words:
        segments.append(" ".join(current_words))
    return segments


def _make_overlap_block(block: dict[str, Any], max_chars: int) -> dict[str, Any] | None:
    text = " ".join(str(block.get("text") or "").split())
    if not text or max_chars <= 0:
        return None
    if len(text) > max_chars:
        start = len(text) - max_chars
        boundary = text.find(" ", start)
        if boundary >= 0:
            text = text[boundary + 1 :].strip()
        else:
            return None
    if not text:
        return None
    return {
        **block,
        "text": text,
        "is_overlap": True,
    }


def _build_block_chunk_metadata(source: IndexSource, blocks: list[dict[str, Any]]) -> dict[str, Any]:
    actual_blocks = [block for block in blocks if not block.get("is_overlap") and block.get("role") != "figure_labels_heading"]
    included_blocks = [block for block in blocks if block.get("role") != "figure_labels_heading"]
    reading_orders = [
        int(block["readingOrder"])
        for block in actual_blocks
        if isinstance(block.get("readingOrder"), int) and int(block["readingOrder"]) >= 0
    ]
    bbox_preview = [
        block.get("bbox")
        for block in included_blocks
        if isinstance(block.get("bbox"), list)
    ][:8]
    block_previews = [
        _metadata_preview(block.get("text"))
        for block in actual_blocks
        if str(block.get("text") or "").strip()
    ][:5]
    return {
        "chunking_strategy": "block_aware_v2",
        "extraction_strategy": source.metadata.get("extraction_strategy"),
        "reading_order_strategy": source.metadata.get("reading_order_strategy"),
        "block_start_order": min(reading_orders) if reading_orders else None,
        "block_end_order": max(reading_orders) if reading_orders else None,
        "block_count": len(actual_blocks),
        "overlap_block_count": sum(1 for block in blocks if block.get("is_overlap")),
        "block_roles": sorted({str(block.get("role") or "") for block in actual_blocks if block.get("role")}),
        "bbox_preview": bbox_preview,
        "block_previews": block_previews,
        "header_footer_candidate_count": source.metadata.get("header_footer_candidate_count"),
        "side_label_candidate_count": source.metadata.get("side_label_candidate_count"),
    }


def _metadata_preview(value: Any, max_length: int = 120) -> str:
    text = " ".join(str(value or "").split())
    if len(text) <= max_length:
        return text
    return f"{text[:max_length].rstrip()}..."


def _safe_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number
