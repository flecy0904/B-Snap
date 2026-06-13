from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


DEFAULT_CHUNK_SIZE = 800
DEFAULT_CHUNK_OVERLAP = 100
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


@dataclass(frozen=True)
class TextChunk:
    source: IndexSource
    chunk_index: int
    content: str


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
        end = start + chunk_size
        chunk = normalized[start:end].strip()
        if _has_useful_chunk_content(chunk):
            chunks.append(chunk)
        if end >= len(normalized):
            break
        start = end - overlap
    return chunks


def build_text_chunks(source: IndexSource) -> list[TextChunk]:
    return [
        TextChunk(source=source, chunk_index=index, content=content)
        for index, content in enumerate(split_text_into_chunks(source.content), start=1)
    ]
