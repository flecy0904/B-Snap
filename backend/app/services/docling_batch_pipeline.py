import hashlib
import logging
import os
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import fitz  # type: ignore[import-untyped]
from psycopg import Connection
from psycopg.types.json import Jsonb

from backend.app.core.config import Settings, get_settings
from backend.app.db.crud import fetch_all, fetch_one


logger = logging.getLogger(__name__)

DoclingCandidateType = Literal["picture", "table", "full_page"]


class DoclingBatchError(ValueError):
    pass


@dataclass(frozen=True)
class CachedDoclingTextBlock:
    page_number: int
    text: str
    bbox: tuple[float, float, float, float] | None
    coord_origin: str

    def to_json(self) -> dict[str, Any]:
        return {
            "page_number": self.page_number,
            "text": self.text,
            "bbox": [round(value, 4) for value in self.bbox] if self.bbox is not None else None,
            "coord_origin": self.coord_origin,
        }


@dataclass(frozen=True)
class CachedDoclingVisualCandidate:
    page_number: int
    candidate_type: DoclingCandidateType
    self_ref: str | None
    bbox: tuple[float, float, float, float]
    coord_origin: str
    text_preview: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "page_number": self.page_number,
            "candidate_type": self.candidate_type,
            "self_ref": self.self_ref,
            "bbox": [round(value, 4) for value in self.bbox],
            "coord_origin": self.coord_origin,
            "text_preview": self.text_preview,
        }


@dataclass(frozen=True)
class CachedDoclingPage:
    page_number: int
    markdown: str
    markdown_length: int
    text_item_count: int
    table_count: int
    picture_count: int
    page_width: float
    page_height: float
    text_blocks: list[CachedDoclingTextBlock] = field(default_factory=list)
    visual_candidates: list[CachedDoclingVisualCandidate] = field(default_factory=list)

    def to_json(self) -> dict[str, Any]:
        return {
            "page_number": self.page_number,
            "markdown": self.markdown,
            "markdown_length": self.markdown_length,
            "text_item_count": self.text_item_count,
            "table_count": self.table_count,
            "picture_count": self.picture_count,
            "page_width": round(self.page_width, 4),
            "page_height": round(self.page_height, 4),
            "text_blocks": [block.to_json() for block in self.text_blocks],
            "visual_candidates": [candidate.to_json() for candidate in self.visual_candidates],
        }


@dataclass(frozen=True)
class CachedDoclingBatch:
    batch_index: int
    page_start: int
    page_end: int
    pages: list[CachedDoclingPage]
    elapsed_ms: int

    def to_json(self) -> dict[str, Any]:
        return {
            "batch_index": self.batch_index,
            "page_start": self.page_start,
            "page_end": self.page_end,
            "pages": [page.to_json() for page in self.pages],
        }


def docling_parser_config(settings: Settings | None = None) -> dict[str, Any]:
    active_settings = settings or get_settings()
    return {
        "parser": "docling",
        "batch_size": max(1, int(active_settings.docling_batch_size or 20)),
        "do_ocr": False,
        "do_table_structure": True,
        "version": 1,
    }


def _docling_fallback_batch_sizes(settings: Settings | None = None) -> list[int]:
    active_settings = settings or get_settings()
    raw_value = str(active_settings.docling_fallback_batch_sizes or "")
    sizes: list[int] = []
    for part in raw_value.split(","):
        value = part.strip()
        if not value:
            continue
        try:
            size = int(value)
        except ValueError:
            logger.warning("ignoring invalid DOCLING_FALLBACK_BATCH_SIZES value: %s", value)
            continue
        if size > 0 and size not in sizes:
            sizes.append(size)
    return sorted(sizes, reverse=True)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def note_rag_text_ready(connection: Connection, *, note_ids: list[int], user_id: int) -> tuple[bool, dict[str, Any] | None]:
    if not note_ids:
        return True, None
    rows = fetch_all(
        connection,
        """
        SELECT note_id, text_status, image_status, overall_status, last_error
        FROM note_rag_jobs
        WHERE user_id = %s AND note_id = ANY(%s::int[])
        """,
        (user_id, note_ids),
    )
    by_note_id = {int(row["note_id"]): row for row in rows}
    for note_id in note_ids:
        row = by_note_id.get(int(note_id))
        if row is None:
            return False, {"note_id": note_id, "reason": "missing_job"}
        if str(row.get("text_status")) != "ready":
            return False, row
    return True, None


def start_note_rag_job(
    connection: Connection,
    *,
    note: dict[str, Any],
    user_id: int,
    file_hash: str,
    page_count: int,
    total_batches: int,
    parser_config: dict[str, Any],
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO note_rag_jobs (
                user_id, folder_id, note_id, file_hash, parser, parser_config,
                text_status, image_status, overall_status, page_count,
                processed_page_count, total_batches, completed_batches,
                text_chunk_count, image_candidate_count, image_completed_count, image_indexed_count,
                last_error, started_at, text_ready_at, image_ready_at, created_at, updated_at
            )
            VALUES (
                %s, %s, %s, %s, 'docling', %s,
                'processing', 'processing', 'processing', %s,
                0, %s, 0,
                0, 0, 0, 0,
                NULL, now(), NULL, NULL, now(), now()
            )
            ON CONFLICT (user_id, note_id)
            DO UPDATE SET
                folder_id = EXCLUDED.folder_id,
                file_hash = EXCLUDED.file_hash,
                parser = EXCLUDED.parser,
                parser_config = EXCLUDED.parser_config,
                text_status = 'processing',
                image_status = 'processing',
                overall_status = 'processing',
                page_count = EXCLUDED.page_count,
                processed_page_count = 0,
                total_batches = EXCLUDED.total_batches,
                completed_batches = 0,
                text_chunk_count = 0,
                image_candidate_count = 0,
                image_completed_count = 0,
                image_indexed_count = 0,
                last_error = NULL,
                started_at = now(),
                text_ready_at = NULL,
                image_ready_at = NULL,
                updated_at = now()
            """,
            (
                user_id,
                note.get("folder_id"),
                note["id"],
                file_hash,
                Jsonb(parser_config),
                page_count,
                total_batches,
            ),
        )


def mark_note_rag_text_ready(connection: Connection, *, note_id: int, user_id: int, text_chunk_count: int, processed_page_count: int) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE note_rag_jobs
            SET text_status = 'ready',
                processed_page_count = %s,
                text_chunk_count = %s,
                text_ready_at = now(),
                updated_at = now()
            WHERE note_id = %s AND user_id = %s
            """,
            (processed_page_count, text_chunk_count, note_id, user_id),
        )


def update_note_rag_text_progress(connection: Connection, *, note_id: int, user_id: int, processed_page_count: int) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE note_rag_jobs
            SET processed_page_count = GREATEST(processed_page_count, %s),
                updated_at = now()
            WHERE note_id = %s AND user_id = %s
            """,
            (processed_page_count, note_id, user_id),
        )


def update_note_rag_image_status(
    connection: Connection,
    *,
    note_id: int,
    user_id: int,
    image_status: str,
    image_candidate_count: int,
    image_completed_count: int,
    image_indexed_count: int,
    last_error: str | None = None,
) -> None:
    overall_status = "ready" if image_status == "ready" else ("partial_failed" if image_status == "partial_failed" else "processing")
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE note_rag_jobs
            SET image_status = %s,
                overall_status = %s,
                image_candidate_count = %s,
                image_completed_count = %s,
                image_indexed_count = %s,
                last_error = COALESCE(%s, last_error),
                image_ready_at = CASE WHEN %s IN ('ready', 'partial_failed') THEN now() ELSE image_ready_at END,
                updated_at = now()
            WHERE note_id = %s AND user_id = %s
            """,
            (
                image_status,
                overall_status,
                image_candidate_count,
                image_completed_count,
                image_indexed_count,
                last_error,
                image_status,
                note_id,
                user_id,
            ),
        )


def mark_note_rag_failed(connection: Connection, *, note_id: int, user_id: int, stage: str, error: str) -> None:
    text_status = "failed" if stage == "text" else None
    image_status = "failed" if stage == "image" else None
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE note_rag_jobs
            SET text_status = COALESCE(%s, text_status),
                image_status = COALESCE(%s, image_status),
                overall_status = CASE WHEN %s = 'text' THEN 'failed' ELSE 'partial_failed' END,
                last_error = %s,
                updated_at = now()
            WHERE note_id = %s AND user_id = %s
            """,
            (text_status, image_status, stage, error[:1000], note_id, user_id),
        )


def parse_and_cache_docling_batches(
    connection: Connection,
    *,
    note: dict[str, Any],
    user_id: int,
    pdf_path: Path,
    batch_size: int | None = None,
    force: bool = False,
    reset_job: bool = True,
    on_batch_ready: Callable[[CachedDoclingBatch], None] | None = None,
) -> list[CachedDoclingBatch]:
    if not pdf_path.exists() or pdf_path.suffix.lower() != ".pdf":
        raise DoclingBatchError("stored pdf file is unavailable")

    settings = get_settings()
    parser_config = docling_parser_config(settings)
    safe_batch_size = max(1, int(batch_size or parser_config["batch_size"]))
    parser_config["batch_size"] = safe_batch_size
    current_file_hash = file_sha256(pdf_path)
    with fitz.open(pdf_path) as pdf_document:
        page_count = int(pdf_document.page_count)
    if page_count < 1:
        raise DoclingBatchError("pdf has no pages")

    total_batches = (page_count + safe_batch_size - 1) // safe_batch_size
    if reset_job:
        start_note_rag_job(
            connection,
            note=note,
            user_id=user_id,
            file_hash=current_file_hash,
            page_count=page_count,
            total_batches=total_batches,
            parser_config=parser_config,
        )
        connection.commit()

    batches: list[CachedDoclingBatch] = []
    for batch_index in range(total_batches):
        page_start = batch_index * safe_batch_size + 1
        page_end = min(page_count, page_start + safe_batch_size - 1)
        cached = None if force else _load_cached_batch(
            connection,
            user_id=user_id,
            note_id=note["id"],
            file_hash=current_file_hash,
            batch_index=batch_index,
            parser_config=parser_config,
        )
        if cached is not None:
            batches.append(cached)
            if reset_job:
                _mark_batch_completed(connection, note_id=note["id"], user_id=user_id)
                connection.commit()
            if on_batch_ready:
                on_batch_ready(cached)
            continue

        try:
            batch = _parse_docling_batch(
                pdf_path=pdf_path,
                batch_index=batch_index,
                page_start=page_start,
                page_end=page_end,
            )
            _store_batch(
                connection,
                note=note,
                user_id=user_id,
                file_hash=current_file_hash,
                parser_config=parser_config,
                batch=batch,
            )
            if reset_job:
                _mark_batch_completed(connection, note_id=note["id"], user_id=user_id)
            connection.commit()
            batches.append(batch)
        except Exception as exc:
            connection.rollback()
            _store_failed_batch(
                connection,
                note=note,
                user_id=user_id,
                file_hash=current_file_hash,
                parser_config=parser_config,
                batch_index=batch_index,
                page_start=page_start,
                page_end=page_end,
                error=str(exc),
            )
            if reset_job:
                mark_note_rag_failed(connection, note_id=note["id"], user_id=user_id, stage="text", error=str(exc))
            connection.commit()
            raise
        if on_batch_ready:
            on_batch_ready(batch)

    return batches


def load_cached_docling_batches(connection: Connection, *, note_id: int, user_id: int, file_hash: str | None = None) -> list[CachedDoclingBatch]:
    filters = ["user_id = %s", "note_id = %s", "status = 'ready'"]
    params: list[Any] = [user_id, note_id]
    if file_hash:
        filters.append("file_hash = %s")
        params.append(file_hash)
    rows = fetch_all(
        connection,
        f"""
        SELECT batch_index, page_start, page_end, result, elapsed_ms
        FROM docling_batch_results
        WHERE {' AND '.join(filters)}
        ORDER BY batch_index ASC
        """,
        tuple(params),
    )
    return [_batch_from_row(row) for row in rows]


def cached_pages_from_batches(batches: list[CachedDoclingBatch]) -> list[CachedDoclingPage]:
    pages: list[CachedDoclingPage] = []
    for batch in batches:
        pages.extend(batch.pages)
    return sorted(pages, key=lambda page: page.page_number)


def _parse_docling_batch(*, pdf_path: Path, batch_index: int, page_start: int, page_end: int) -> CachedDoclingBatch:
    started_at = time.perf_counter()
    pages = _parse_docling_pages_with_fallback(
        pdf_path=pdf_path,
        page_start=page_start,
        page_end=page_end,
        fallback_sizes=_docling_fallback_batch_sizes(),
    )
    return CachedDoclingBatch(
        batch_index=batch_index,
        page_start=page_start,
        page_end=page_end,
        pages=sorted(pages, key=lambda page: page.page_number),
        elapsed_ms=round((time.perf_counter() - started_at) * 1000),
    )


def _parse_docling_pages_with_fallback(
    *,
    pdf_path: Path,
    page_start: int,
    page_end: int,
    fallback_sizes: list[int],
) -> list[CachedDoclingPage]:
    try:
        return _parse_docling_pages_once(pdf_path=pdf_path, page_start=page_start, page_end=page_end)
    except DoclingBatchError:
        raise
    except Exception as exc:
        page_count = page_end - page_start + 1
        next_size = next((size for size in fallback_sizes if size < page_count), None)
        if next_size is None:
            raise

        logger.warning(
            "docling batch parse failed; retrying with smaller chunks: pages=%s-%s next_batch_size=%s error=%s",
            page_start,
            page_end,
            next_size,
            exc,
        )
        pages: list[CachedDoclingPage] = []
        for sub_start in range(page_start, page_end + 1, next_size):
            sub_end = min(page_end, sub_start + next_size - 1)
            pages.extend(
                _parse_docling_pages_with_fallback(
                    pdf_path=pdf_path,
                    page_start=sub_start,
                    page_end=sub_end,
                    fallback_sizes=fallback_sizes,
                )
            )
        return pages


def _parse_docling_pages_once(*, pdf_path: Path, page_start: int, page_end: int) -> list[CachedDoclingPage]:
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter
        from docling.document_converter import PdfFormatOption
    except Exception as exc:
        raise DoclingBatchError("docling dependency is not installed") from exc

    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = False
    pipeline_options.do_table_structure = True
    converter = DocumentConverter(
        allowed_formats=[InputFormat.PDF],
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)},
    )
    conversion = converter.convert(str(pdf_path), page_range=(page_start, page_end))
    document_dict = _export_docling_document_dict(conversion.document)

    with fitz.open(pdf_path) as pdf_document:
        return [
            _page_from_docling_dict(document_dict, pdf_document=pdf_document, page_number=page_number)
            for page_number in range(page_start, page_end + 1)
            if page_number <= pdf_document.page_count
        ]


def _page_from_docling_dict(document_dict: dict[str, Any], *, pdf_document: fitz.Document, page_number: int) -> CachedDoclingPage:
    page = pdf_document.load_page(page_number - 1)
    page_width, page_height = _docling_page_size(document_dict, page_number, page.rect.width, page.rect.height)
    text_items = _extract_page_text_items(document_dict, page_number)
    text_blocks = _text_blocks_from_items(text_items, page_number)
    markdown = _page_markdown_from_text_blocks(text_blocks)
    visual_candidates = _extract_page_visual_candidates(document_dict, page_number)
    return CachedDoclingPage(
        page_number=page_number,
        markdown=markdown,
        markdown_length=len(markdown),
        text_item_count=len(text_items),
        table_count=sum(1 for item in visual_candidates if item.candidate_type == "table"),
        picture_count=sum(1 for item in visual_candidates if item.candidate_type == "picture"),
        page_width=float(page_width),
        page_height=float(page_height),
        text_blocks=text_blocks,
        visual_candidates=visual_candidates,
    )


def _store_batch(
    connection: Connection,
    *,
    note: dict[str, Any],
    user_id: int,
    file_hash: str,
    parser_config: dict[str, Any],
    batch: CachedDoclingBatch,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO docling_batch_results (
                user_id, folder_id, note_id, file_hash, parser, parser_config,
                batch_index, page_start, page_end, page_count, status, result, elapsed_ms, error,
                created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, 'docling', %s, %s, %s, %s, %s, 'ready', %s, %s, NULL, now(), now())
            ON CONFLICT (user_id, note_id, file_hash, batch_index)
            DO UPDATE SET
                folder_id = EXCLUDED.folder_id,
                parser = EXCLUDED.parser,
                parser_config = EXCLUDED.parser_config,
                page_start = EXCLUDED.page_start,
                page_end = EXCLUDED.page_end,
                page_count = EXCLUDED.page_count,
                status = 'ready',
                result = EXCLUDED.result,
                elapsed_ms = EXCLUDED.elapsed_ms,
                error = NULL,
                updated_at = now()
            """,
            (
                user_id,
                note.get("folder_id"),
                note["id"],
                file_hash,
                Jsonb(parser_config),
                batch.batch_index,
                batch.page_start,
                batch.page_end,
                len(batch.pages),
                Jsonb(batch.to_json()),
                batch.elapsed_ms,
            ),
        )


def _store_failed_batch(
    connection: Connection,
    *,
    note: dict[str, Any],
    user_id: int,
    file_hash: str,
    parser_config: dict[str, Any],
    batch_index: int,
    page_start: int,
    page_end: int,
    error: str,
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO docling_batch_results (
                user_id, folder_id, note_id, file_hash, parser, parser_config,
                batch_index, page_start, page_end, page_count, status, result, elapsed_ms, error,
                created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, 'docling', %s, %s, %s, %s, 0, 'failed', '{}'::jsonb, NULL, %s, now(), now())
            ON CONFLICT (user_id, note_id, file_hash, batch_index)
            DO UPDATE SET
                status = 'failed',
                error = EXCLUDED.error,
                updated_at = now()
            """,
            (user_id, note.get("folder_id"), note["id"], file_hash, Jsonb(parser_config), batch_index, page_start, page_end, error[:1000]),
        )


def _mark_batch_completed(connection: Connection, *, note_id: int, user_id: int) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE note_rag_jobs
            SET completed_batches = LEAST(total_batches, completed_batches + 1),
                updated_at = now()
            WHERE note_id = %s AND user_id = %s
            """,
            (note_id, user_id),
        )


def _load_cached_batch(
    connection: Connection,
    *,
    user_id: int,
    note_id: int,
    file_hash: str,
    batch_index: int,
    parser_config: dict[str, Any],
) -> CachedDoclingBatch | None:
    row = fetch_one(
        connection,
        """
        SELECT batch_index, page_start, page_end, result, elapsed_ms, parser_config
        FROM docling_batch_results
        WHERE user_id = %s
          AND note_id = %s
          AND file_hash = %s
          AND batch_index = %s
          AND status = 'ready'
        """,
        (user_id, note_id, file_hash, batch_index),
    )
    if not row:
        return None
    if row.get("parser_config") != parser_config:
        return None
    return _batch_from_row(row)


def _batch_from_row(row: dict[str, Any]) -> CachedDoclingBatch:
    result = row.get("result") if isinstance(row.get("result"), dict) else {}
    pages = [_page_from_json(page) for page in result.get("pages", []) if isinstance(page, dict)]
    return CachedDoclingBatch(
        batch_index=int(row.get("batch_index") or result.get("batch_index") or 0),
        page_start=int(row.get("page_start") or result.get("page_start") or 0),
        page_end=int(row.get("page_end") or result.get("page_end") or 0),
        pages=pages,
        elapsed_ms=int(row.get("elapsed_ms") or 0),
    )


def _page_from_json(value: dict[str, Any]) -> CachedDoclingPage:
    return CachedDoclingPage(
        page_number=int(value.get("page_number") or 0),
        markdown=str(value.get("markdown") or ""),
        markdown_length=int(value.get("markdown_length") or len(str(value.get("markdown") or ""))),
        text_item_count=int(value.get("text_item_count") or 0),
        table_count=int(value.get("table_count") or 0),
        picture_count=int(value.get("picture_count") or 0),
        page_width=float(value.get("page_width") or 0),
        page_height=float(value.get("page_height") or 0),
        text_blocks=[
            _text_block_from_json(block, int(value.get("page_number") or 0))
            for block in value.get("text_blocks", [])
            if isinstance(block, dict)
        ],
        visual_candidates=[
            _candidate_from_json(candidate, int(value.get("page_number") or 0))
            for candidate in value.get("visual_candidates", [])
            if isinstance(candidate, dict)
        ],
    )


def _text_block_from_json(value: dict[str, Any], fallback_page_number: int) -> CachedDoclingTextBlock:
    raw_bbox = value.get("bbox")
    bbox = tuple(float(item) for item in raw_bbox) if isinstance(raw_bbox, list) and len(raw_bbox) == 4 else None
    return CachedDoclingTextBlock(
        page_number=int(value.get("page_number") or fallback_page_number),
        text=str(value.get("text") or ""),
        bbox=bbox,
        coord_origin=str(value.get("coord_origin") or "UNKNOWN").upper(),
    )


def _candidate_from_json(value: dict[str, Any], fallback_page_number: int) -> CachedDoclingVisualCandidate:
    bbox = value.get("bbox")
    safe_bbox = tuple(float(item) for item in bbox) if isinstance(bbox, list) and len(bbox) == 4 else (0.0, 0.0, 0.0, 0.0)
    raw_type = str(value.get("candidate_type") or "picture")
    candidate_type: DoclingCandidateType = "full_page" if raw_type == "full_page" else ("table" if raw_type == "table" else "picture")
    return CachedDoclingVisualCandidate(
        page_number=int(value.get("page_number") or fallback_page_number),
        candidate_type=candidate_type,
        self_ref=_clean_optional_string(value.get("self_ref")),
        bbox=safe_bbox,
        coord_origin=str(value.get("coord_origin") or "UNKNOWN").upper(),
        text_preview=_clean_optional_string(value.get("text_preview")),
    )


def _export_docling_document_dict(document: Any) -> dict[str, Any]:
    for method_name in ("export_to_dict", "dict", "model_dump"):
        method = getattr(document, method_name, None)
        if not callable(method):
            continue
        try:
            value = method()
        except Exception:
            continue
        if isinstance(value, dict):
            return value
    return {}


def _docling_page_size(document_dict: dict[str, Any], page_number: int, fallback_width: float, fallback_height: float) -> tuple[float, float]:
    pages = document_dict.get("pages")
    page_info = None
    if isinstance(pages, dict):
        page_info = pages.get(str(page_number)) or pages.get(page_number)
    if isinstance(page_info, dict):
        size = page_info.get("size")
        if isinstance(size, dict):
            width = _safe_float(size.get("width"))
            height = _safe_float(size.get("height"))
            if width > 0 and height > 0:
                return width, height
    return float(fallback_width), float(fallback_height)


def _extract_page_text_items(document_dict: dict[str, Any], page_number: int) -> list[dict[str, Any]]:
    labels = {"text", "paragraph", "section_header", "title", "list_item", "caption", "code", "table"}
    items = _collect_items_for_page(document_dict, page_number, labels=labels)
    return sorted(items, key=_docling_item_sort_key)


def _extract_page_visual_candidates(document_dict: dict[str, Any], page_number: int) -> list[CachedDoclingVisualCandidate]:
    items: list[tuple[str, dict[str, Any]]] = []
    for key, candidate_type in (("pictures", "picture"), ("tables", "table")):
        values = document_dict.get(key)
        if not isinstance(values, list):
            continue
        for item in values:
            if isinstance(item, dict) and _item_matches_page(item, page_number):
                items.append((candidate_type, item))
    candidates: list[CachedDoclingVisualCandidate] = []
    for candidate_type, item in sorted(items, key=lambda item: _docling_item_sort_key(item[1])):
        bbox, coord_origin = _item_docling_bbox(item)
        if bbox is None:
            continue
        safe_type: DoclingCandidateType = "table" if candidate_type == "table" else "picture"
        candidates.append(
            CachedDoclingVisualCandidate(
                page_number=page_number,
                candidate_type=safe_type,
                self_ref=_clean_optional_string(item.get("self_ref")),
                bbox=bbox,
                coord_origin=coord_origin,
                text_preview=_item_text_preview(item),
            )
        )
    return candidates


def _collect_items_for_page(value: Any, page_number: int, *, labels: set[str]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    stack = [value]
    seen: set[int] = set()
    while stack:
        item = stack.pop()
        if id(item) in seen:
            continue
        seen.add(id(item))
        if isinstance(item, dict):
            label = str(item.get("label") or item.get("type") or item.get("name") or "").lower()
            if label in labels and _item_matches_page(item, page_number):
                items.append(item)
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
    return items


def _text_blocks_from_items(items: list[dict[str, Any]], page_number: int) -> list[CachedDoclingTextBlock]:
    blocks: list[CachedDoclingTextBlock] = []
    parts: list[str] = []
    for item in items:
        text = _item_text_preview(item, max_length=5000)
        if not text:
            continue
        if parts and parts[-1] == text:
            continue
        bbox, coord_origin = _item_docling_bbox(item)
        blocks.append(
            CachedDoclingTextBlock(
                page_number=page_number,
                text=text,
                bbox=bbox,
                coord_origin=coord_origin,
            )
        )
        parts.append(text)
    return blocks


def _page_markdown_from_text_blocks(blocks: list[CachedDoclingTextBlock]) -> str:
    return "\n\n".join(block.text for block in blocks if block.text.strip()).strip()


def _item_matches_page(item: dict[str, Any], page_number: int) -> bool:
    prov = item.get("prov")
    if not isinstance(prov, list):
        return False
    return any(isinstance(entry, dict) and int(entry.get("page_no") or 0) == page_number for entry in prov)


def _docling_item_sort_key(item: dict[str, Any]) -> tuple[float, float, str]:
    bbox, _origin = _item_docling_bbox(item)
    if bbox is None:
        return (float("inf"), float("inf"), str(item.get("self_ref") or ""))
    left, _bottom, _right, top = bbox
    return (-top, left, str(item.get("self_ref") or ""))


def _item_docling_bbox(item: dict[str, Any]) -> tuple[tuple[float, float, float, float] | None, str]:
    prov = item.get("prov")
    if not isinstance(prov, list) or not prov:
        return None, "UNKNOWN"
    first = next((entry for entry in prov if isinstance(entry, dict) and isinstance(entry.get("bbox"), dict)), None)
    if first is None:
        return None, "UNKNOWN"
    bbox = first.get("bbox")
    if not isinstance(bbox, dict):
        return None, "UNKNOWN"
    left = _safe_float(bbox.get("l"))
    right = _safe_float(bbox.get("r"))
    top = _safe_float(bbox.get("t"))
    bottom = _safe_float(bbox.get("b"))
    if right <= left or abs(top - bottom) <= 0:
        return None, str(bbox.get("coord_origin") or "UNKNOWN").upper()
    return (left, bottom, right, top), str(bbox.get("coord_origin") or "UNKNOWN").upper()


def _item_text_preview(item: dict[str, Any], *, max_length: int = 240) -> str | None:
    for key in ("text", "orig", "caption", "name"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return _preview(value, max_length=max_length)
    return None


def _preview(text: str, max_length: int = 240) -> str:
    normalized = " ".join(str(text or "").split()).strip()
    if len(normalized) <= max_length:
        return normalized
    return f"{normalized[:max_length].rstrip()}..."


def _safe_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _clean_optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None
