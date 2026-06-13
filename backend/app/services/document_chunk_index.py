import hashlib
import logging
from concurrent.futures import Future, ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from typing import Any

import psycopg
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from backend.app.core.config import get_settings
from backend.app.db.crud import fetch_all, fetch_one
from backend.app.db.session import get_database_url
from backend.app.schemas.rag import RetrievedContext
from backend.app.services.docling_batch_pipeline import (
    cached_pages_from_batches,
    mark_note_rag_text_ready,
    mark_note_rag_failed,
    parse_and_cache_docling_batches,
    update_note_rag_text_progress,
    update_note_rag_image_status,
)
from backend.app.services.embeddings import embedding_to_vector_literal, generate_embedding
from backend.app.services.note_page_content import merge_page_state_content, parse_page_state
from backend.app.services.pdf_image_summary_index import refresh_note_image_ai_summaries_for_cached_pages, stored_note_pdf_path
from backend.app.services.rag_chunker import IndexSource, build_text_chunks, is_meaningful_text


logger = logging.getLogger(__name__)
PAGE_SOURCE_TYPES = ("pdf_page", "pdf_text_box", "image_ocr", "image_ai_summary")


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _metadata(value: dict[str, Any] | None) -> dict[str, Any]:
    return {key: item for key, item in (value or {}).items() if item is not None}


def _rag_extraction_dict(state: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(state, dict):
        return {}
    rag_extraction = state.get("ragExtraction")
    return rag_extraction if isinstance(rag_extraction, dict) else {}


def _layout_blocks_from_rag_extraction(rag_extraction: dict[str, Any]) -> list[dict[str, Any]]:
    visual_blocks = rag_extraction.get("visualBlocks")
    if isinstance(visual_blocks, list):
        return [block for block in visual_blocks if isinstance(block, dict)]
    if rag_extraction.get("readingOrderStrategy") == "pymupdf_native_text":
        return []
    blocks = rag_extraction.get("textBlocks")
    if not isinstance(blocks, list):
        return []
    return [block for block in blocks if isinstance(block, dict)]


def _metadata_list_count(value: Any) -> int:
    return len(value) if isinstance(value, list) else 0


def _pdf_page_source_metadata(page: dict[str, Any], page_label: str, rag_extraction: dict[str, Any]) -> dict[str, Any]:
    return _metadata({
        "note_page_id": page["id"],
        "page_label": page_label,
        "parser": rag_extraction.get("parser"),
        "extraction_strategy": rag_extraction.get("extractionStrategy"),
        "reading_order_strategy": rag_extraction.get("readingOrderStrategy"),
        "column_count": rag_extraction.get("columnCount"),
        "column_confidence": rag_extraction.get("columnConfidence"),
        "text_block_count": rag_extraction.get("textBlockCount"),
        "image_block_count": rag_extraction.get("imageBlockCount"),
        "visual_block_count": rag_extraction.get("visualBlockCount"),
        "header_footer_candidate_count": _metadata_list_count(rag_extraction.get("headerFooterCandidates")),
        "side_label_candidate_count": _metadata_list_count(rag_extraction.get("sideLabelCandidates")),
    })


def _chunk_metadata(chunk: Any) -> dict[str, Any]:
    metadata = dict(chunk.source.metadata)
    chunk_metadata = getattr(chunk, "metadata", None)
    if isinstance(chunk_metadata, dict):
        metadata.update(_metadata(chunk_metadata))
    return metadata


def _extract_canvas_block_ids(document_json: Any) -> list[str]:
    block_ids: list[str] = []

    def walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        attrs = node.get("attrs")
        if isinstance(attrs, dict) and isinstance(attrs.get("blockId"), str):
            block_ids.append(attrs["blockId"])
        content = node.get("content")
        if isinstance(content, list):
            for child in content:
                walk(child)

    walk(document_json)
    return block_ids[:100]


def _image_summary_content(row: dict[str, Any]) -> str:
    parts = [str(row.get("summary") or "").strip()]
    ocr_text = str(row.get("ocr_text") or "").strip()
    if ocr_text:
        parts.append(f"Image Text:\n{ocr_text}")
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    nearby_text = str(metadata.get("nearby_text") or "").strip()
    if nearby_text:
        parts.append(f"Nearby Text:\n{nearby_text}")
    return "\n\n".join(part for part in parts if part).strip()


def _image_ai_summary_index_source_from_row(*, note: dict, row: dict[str, Any], user_id: int) -> IndexSource | None:
    content = _image_summary_content(row)
    if not is_meaningful_text(content):
        return None
    page_label = f"page {int(row['page_number'])}"
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    return IndexSource(
        source_type="image_ai_summary",
        source_id=str(row["id"]),
        title=f"{note['title']} - {page_label} image summary",
        content=content,
        user_id=user_id,
        folder_id=row.get("folder_id") or note.get("folder_id"),
        note_id=row.get("note_id") or note.get("id"),
        page_number=row.get("page_number"),
        source_updated_at=row.get("analyzed_at") or row.get("updated_at"),
        metadata=_metadata({
            **metadata,
            "image_ai_summary_id": row["id"],
            "page_label": page_label,
            "candidate_type": row.get("candidate_type"),
            "crop_hash": row.get("crop_hash"),
            "image_hash": row.get("image_hash"),
            "confidence": row.get("confidence"),
            "importance": row.get("importance"),
            "confidence_reason": row.get("confidence_reason"),
            "importance_reason": row.get("importance_reason"),
        }),
    )


def _collect_image_ai_summary_index_sources(
    connection: Connection,
    *,
    note: dict,
    user_id: int,
    page_number: int | None = None,
) -> list[IndexSource]:
    params: list[Any] = [user_id, note["id"]]
    page_filter = ""
    if page_number is not None:
        page_filter = "AND page_number = %s"
        params.append(page_number)
    rows = fetch_all(
        connection,
        f"""
        SELECT id, folder_id, note_id, page_number, candidate_type, crop_hash, image_hash,
               summary, ocr_text, confidence, importance, confidence_reason, importance_reason,
               metadata, analyzed_at, updated_at
        FROM image_ai_summaries
        WHERE user_id = %s
          AND note_id = %s
          AND status = 'completed'
          AND importance = ANY(%s::text[])
          AND summary IS NOT NULL
          {page_filter}
        ORDER BY page_number ASC, id ASC
        """,
        tuple([*params[:2], list(("high", "medium")), *params[2:]]),
    )
    sources: list[IndexSource] = []
    for row in rows:
        source = _image_ai_summary_index_source_from_row(note=note, row=row, user_id=user_id)
        if source is not None:
            sources.append(source)
    return sources


def _collect_page_index_sources(note: dict, page: dict, *, user_id: int) -> list[IndexSource]:
    page_number = int(page["page_number"])
    page_label = f"page {page_number}"
    state = parse_page_state(page.get("content"))
    sources: list[IndexSource] = []

    if state is None:
        if is_meaningful_text(page.get("content")):
            sources.append(
                IndexSource(
                    source_type="pdf_page",
                    source_id=str(page["id"]),
                    title=f"{note['title']} - {page_label}",
                    content=page["content"],
                    user_id=user_id,
                    folder_id=note["folder_id"],
                    note_id=note["id"],
                    page_number=page_number,
                    source_updated_at=page.get("updated_at"),
                    metadata={"note_page_id": page["id"], "page_label": page_label},
                )
            )
        return sources

    pdf_text = state.get("pdfText")
    if isinstance(pdf_text, str) and is_meaningful_text(pdf_text):
        rag_extraction = _rag_extraction_dict(state)
        sources.append(
            IndexSource(
                source_type="pdf_page",
                source_id=str(page["id"]),
                title=f"{note['title']} - {page_label}",
                content=pdf_text,
                user_id=user_id,
                folder_id=note["folder_id"],
                note_id=note["id"],
                page_number=page_number,
                source_updated_at=page.get("updated_at"),
                metadata=_pdf_page_source_metadata(page, page_label, rag_extraction),
                layout_blocks=_layout_blocks_from_rag_extraction(rag_extraction),
            )
        )

    image_annotations = state.get("imageAnnotations")
    if isinstance(image_annotations, list):
        for index, annotation in enumerate(image_annotations, start=1):
            if not isinstance(annotation, dict):
                continue
            image_id = annotation.get("id") or annotation.get("assetId") or f"image-{index}"
            summary = str(
                annotation.get("analysisSummary")
                or annotation.get("analysis_summary")
                or annotation.get("summary")
                or ""
            ).strip()
            if is_meaningful_text(summary):
                sources.append(
                    IndexSource(
                        source_type="image_ai_summary",
                        source_id=f"{page['id']}:{image_id}:summary",
                        title=f"{note['title']} - {page_label} image analysis",
                        content=summary,
                        user_id=user_id,
                        folder_id=note["folder_id"],
                        note_id=note["id"],
                        page_number=page_number,
                        source_updated_at=page.get("updated_at"),
                        metadata=_metadata({"note_page_id": page["id"], "image_id": image_id, "page_label": page_label}),
                    )
                )

    return sources


def collect_note_index_sources(connection: Connection, *, note_id: int, user_id: int) -> list[IndexSource]:
    note = fetch_one(
        connection,
        """
        SELECT id, user_id, folder_id, title, summary, updated_at
        FROM notes
        WHERE id = %s AND user_id = %s
        """,
        (note_id, user_id),
    )
    if not note:
        return []

    pages = fetch_all(
        connection,
        """
        SELECT id, note_id, page_number, content, image_url, updated_at
        FROM note_pages
        WHERE note_id = %s
        ORDER BY page_number ASC, id ASC
        """,
        (note_id,),
    )
    canvas_notes = fetch_all(
        connection,
        """
        SELECT id, note_id, title, markdown, document_json, source_page_start, source_page_end, updated_at
        FROM ai_canvas_notes
        WHERE note_id = %s
        ORDER BY updated_at DESC, id DESC
        """,
        (note_id,),
    )

    sources: list[IndexSource] = []
    for page in pages:
        sources.extend(_collect_page_index_sources(note, page, user_id=user_id))

    for canvas_note in canvas_notes:
        markdown = str(canvas_note.get("markdown") or "").strip()
        if not is_meaningful_text(markdown):
            continue
        sources.append(
            IndexSource(
                source_type="canvas_note",
                source_id=str(canvas_note["id"]),
                title=f"{note['title']} - {canvas_note['title']}",
                content=markdown,
                user_id=user_id,
                folder_id=note["folder_id"],
                note_id=note_id,
                page_number=canvas_note.get("source_page_start"),
                source_updated_at=canvas_note.get("updated_at"),
                metadata=_metadata({
                    "canvas_note_id": canvas_note["id"],
                    "source_page_start": canvas_note.get("source_page_start"),
                    "source_page_end": canvas_note.get("source_page_end"),
                    "block_ids": _extract_canvas_block_ids(canvas_note.get("document_json")),
                }),
            )
        )

    sources.extend(_collect_image_ai_summary_index_sources(connection, note=note, user_id=user_id))
    return sources


def collect_note_page_index_sources(connection: Connection, *, page_id: int, user_id: int) -> list[IndexSource]:
    row = fetch_one(
        connection,
        """
        SELECT p.id,
               p.note_id,
               p.page_number,
               p.content,
               p.image_url,
               p.updated_at,
               n.folder_id,
               n.title
        FROM note_pages p
        JOIN notes n ON n.id = p.note_id
        WHERE p.id = %s AND n.user_id = %s
        """,
        (page_id, user_id),
    )
    if not row:
        return []

    note = {
        "id": row["note_id"],
        "folder_id": row["folder_id"],
        "title": row["title"],
    }
    sources = _collect_page_index_sources(note, row, user_id=user_id)
    sources.extend(
        _collect_image_ai_summary_index_sources(
            connection,
            note=note,
            user_id=user_id,
            page_number=int(row["page_number"]),
        )
    )
    return sources


def collect_canvas_index_sources(connection: Connection, *, canvas_note_id: int, user_id: int) -> list[IndexSource]:
    canvas_note = fetch_one(
        connection,
        """
        SELECT c.id,
               c.note_id,
               c.title,
               c.markdown,
               c.document_json,
               c.source_page_start,
               c.source_page_end,
               c.updated_at,
               n.folder_id,
               n.title AS note_title
        FROM ai_canvas_notes c
        JOIN notes n ON n.id = c.note_id
        WHERE c.id = %s AND n.user_id = %s
        """,
        (canvas_note_id, user_id),
    )
    if not canvas_note:
        return []

    markdown = str(canvas_note.get("markdown") or "").strip()
    if not is_meaningful_text(markdown):
        return []

    return [
        IndexSource(
            source_type="canvas_note",
            source_id=str(canvas_note["id"]),
            title=f"{canvas_note['note_title']} - {canvas_note['title']}",
            content=markdown,
            user_id=user_id,
            folder_id=canvas_note["folder_id"],
            note_id=canvas_note["note_id"],
            page_number=canvas_note.get("source_page_start"),
            source_updated_at=canvas_note.get("updated_at"),
            metadata=_metadata({
                "canvas_note_id": canvas_note["id"],
                "source_page_start": canvas_note.get("source_page_start"),
                "source_page_end": canvas_note.get("source_page_end"),
                "block_ids": _extract_canvas_block_ids(canvas_note.get("document_json")),
            }),
        )
    ]


def _chunk_key(chunk: Any) -> tuple[int, str, str, int]:
    return (
        int(chunk.source.user_id),
        str(chunk.source.source_type),
        str(chunk.source.source_id),
        int(chunk.chunk_index),
    )


def _fetch_existing_chunk_index(
    connection: Connection,
    chunks: list[Any],
) -> dict[tuple[int, str, str, int], dict[str, Any]]:
    if not chunks:
        return {}

    user_id = int(chunks[0].source.user_id)
    note_ids = sorted({int(chunk.source.note_id) for chunk in chunks if chunk.source.note_id is not None})
    if not note_ids:
        return {}

    rows = fetch_all(
        connection,
        """
        SELECT user_id, source_type, source_id, chunk_index, content_hash, embedding_model
        FROM document_chunks
        WHERE user_id = %s AND note_id = ANY(%s::int[])
        """,
        (user_id, note_ids),
    )
    return {
        (
            int(row["user_id"]),
            str(row["source_type"]),
            str(row["source_id"]),
            int(row["chunk_index"]),
        ): row
        for row in rows
    }


def _update_existing_chunk_metadata(connection: Connection, chunk: Any, *, next_content_hash: str) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE document_chunks
            SET folder_id = %s,
                note_id = %s,
                page_number = %s,
                title = %s,
                content = %s,
                content_hash = %s,
                source_updated_at = %s,
                metadata = %s,
                indexed_at = now(),
                updated_at = now()
            WHERE user_id = %s
              AND source_type = %s
              AND source_id = %s
              AND chunk_index = %s
            """,
            (
                chunk.source.folder_id,
                chunk.source.note_id,
                chunk.source.page_number,
                chunk.source.title,
                chunk.content,
                next_content_hash,
                chunk.source.source_updated_at,
                Jsonb(_chunk_metadata(chunk)),
                chunk.source.user_id,
                chunk.source.source_type,
                chunk.source.source_id,
                chunk.chunk_index,
            ),
        )


def _insert_chunks(connection: Connection, chunks: list[Any], *, embedding_model: str) -> None:
    existing_chunks = _fetch_existing_chunk_index(connection, chunks)
    with connection.cursor() as cursor:
        for chunk in chunks:
            next_content_hash = content_hash(chunk.content)
            existing = existing_chunks.get(_chunk_key(chunk))
            if existing and existing.get("content_hash") == next_content_hash and existing.get("embedding_model") == embedding_model:
                _update_existing_chunk_metadata(connection, chunk, next_content_hash=next_content_hash)
                continue

            embedding = generate_embedding(chunk.content, model=embedding_model)
            cursor.execute(
                """
                INSERT INTO document_chunks (
                    user_id, folder_id, note_id, source_type, source_id, page_number,
                    chunk_index, title, content, content_hash, embedding, embedding_model,
                    source_updated_at, metadata, indexed_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::vector, %s, %s, %s, now(), now())
                ON CONFLICT (user_id, source_type, source_id, chunk_index)
                DO UPDATE SET
                    folder_id = EXCLUDED.folder_id,
                    note_id = EXCLUDED.note_id,
                    page_number = EXCLUDED.page_number,
                    title = EXCLUDED.title,
                    content = EXCLUDED.content,
                    content_hash = EXCLUDED.content_hash,
                    embedding = EXCLUDED.embedding,
                    embedding_model = EXCLUDED.embedding_model,
                    source_updated_at = EXCLUDED.source_updated_at,
                    metadata = EXCLUDED.metadata,
                    indexed_at = now(),
                    updated_at = now()
                """,
                (
                    chunk.source.user_id,
                    chunk.source.folder_id,
                    chunk.source.note_id,
                    chunk.source.source_type,
                    chunk.source.source_id,
                    chunk.source.page_number,
                    chunk.chunk_index,
                    chunk.source.title,
                    chunk.content,
                    next_content_hash,
                    embedding_to_vector_literal(embedding),
                    embedding_model,
                    chunk.source.source_updated_at,
                    Jsonb(_chunk_metadata(chunk)),
                ),
            )


def _delete_obsolete_chunks_for_note(
    connection: Connection,
    *,
    user_id: int,
    note_id: int,
    chunks: list[Any],
) -> None:
    keep_keys = [
        (str(chunk.source.source_type), str(chunk.source.source_id), int(chunk.chunk_index))
        for chunk in chunks
    ]
    with connection.cursor() as cursor:
        if not keep_keys:
            cursor.execute("DELETE FROM document_chunks WHERE user_id = %s AND note_id = %s", (user_id, note_id))
            return

        keep_clauses = []
        params: list[Any] = [user_id, note_id]
        for source_type, source_id, chunk_index in keep_keys:
            keep_clauses.append("(source_type = %s AND source_id = %s AND chunk_index = %s)")
            params.extend([source_type, source_id, chunk_index])
        cursor.execute(
            f"""
            DELETE FROM document_chunks
            WHERE user_id = %s
              AND note_id = %s
              AND NOT ({' OR '.join(keep_clauses)})
            """,
            tuple(params),
        )


def _sync_image_summary_index_flags(connection: Connection, *, note_id: int, user_id: int, chunks: list[Any]) -> None:
    indexed_summary_ids = sorted({
        int(chunk.source.source_id)
        for chunk in chunks
        if str(chunk.source.source_type) == "image_ai_summary" and str(chunk.source.source_id).isdigit()
    })
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE image_ai_summaries
            SET indexed = false,
                indexed_at = NULL,
                updated_at = now()
            WHERE user_id = %s
              AND note_id = %s
            """,
            (user_id, note_id),
        )
        if indexed_summary_ids:
            cursor.execute(
                """
                UPDATE image_ai_summaries
                SET indexed = true,
                    indexed_at = now(),
                    updated_at = now()
                WHERE user_id = %s
                  AND note_id = %s
                  AND id = ANY(%s::bigint[])
                """,
                (user_id, note_id, indexed_summary_ids),
            )


def _delete_obsolete_chunks_for_page(
    connection: Connection,
    *,
    page_id: int,
    user_id: int,
    chunks: list[Any],
) -> None:
    page_source_id = str(page_id)
    page_source_prefix = f"{page_source_id}:%"
    keep_keys = [
        (str(chunk.source.source_type), str(chunk.source.source_id), int(chunk.chunk_index))
        for chunk in chunks
    ]
    with connection.cursor() as cursor:
        params: list[Any] = [user_id, list(PAGE_SOURCE_TYPES), page_source_id, page_source_prefix]
        keep_sql = ""
        if keep_keys:
            keep_clauses = []
            for source_type, source_id, chunk_index in keep_keys:
                keep_clauses.append("(source_type = %s AND source_id = %s AND chunk_index = %s)")
                params.extend([source_type, source_id, chunk_index])
            keep_sql = f"AND NOT ({' OR '.join(keep_clauses)})"
        cursor.execute(
            f"""
            DELETE FROM document_chunks
            WHERE user_id = %s
              AND source_type = ANY(%s::text[])
              AND (
                  source_id = %s
                  OR source_id LIKE %s
              )
              {keep_sql}
            """,
            tuple(params),
        )


def _delete_obsolete_chunks_for_image_summary(
    connection: Connection,
    *,
    image_summary_id: int,
    user_id: int,
    chunks: list[Any],
) -> None:
    source_id = str(image_summary_id)
    keep_indexes = [int(chunk.chunk_index) for chunk in chunks]
    with connection.cursor() as cursor:
        if not keep_indexes:
            cursor.execute(
                """
                DELETE FROM document_chunks
                WHERE user_id = %s
                  AND source_type = 'image_ai_summary'
                  AND source_id = %s
                """,
                (user_id, source_id),
            )
            return
        cursor.execute(
            """
            DELETE FROM document_chunks
            WHERE user_id = %s
              AND source_type = 'image_ai_summary'
              AND source_id = %s
              AND NOT (chunk_index = ANY(%s::int[]))
            """,
            (user_id, source_id, keep_indexes),
        )


def _delete_obsolete_chunks_for_canvas(
    connection: Connection,
    *,
    canvas_note_id: int,
    user_id: int,
    chunks: list[Any],
) -> None:
    keep_indexes = [int(chunk.chunk_index) for chunk in chunks]
    with connection.cursor() as cursor:
        if not keep_indexes:
            cursor.execute(
                "DELETE FROM document_chunks WHERE user_id = %s AND source_type = 'canvas_note' AND source_id = %s",
                (user_id, str(canvas_note_id)),
            )
            return
        cursor.execute(
            """
            DELETE FROM document_chunks
            WHERE user_id = %s
              AND source_type = 'canvas_note'
              AND source_id = %s
              AND NOT (chunk_index = ANY(%s::int[]))
            """,
            (user_id, str(canvas_note_id), keep_indexes),
        )


def replace_note_chunks(connection: Connection, *, note_id: int, user_id: int) -> int:
    sources = collect_note_index_sources(connection, note_id=note_id, user_id=user_id)
    chunks = [chunk for source in sources for chunk in build_text_chunks(source)]
    embedding_model = get_settings().openai_embedding_model

    try:
        _delete_obsolete_chunks_for_note(connection, user_id=user_id, note_id=note_id, chunks=chunks)
        _insert_chunks(connection, chunks, embedding_model=embedding_model)
        _sync_image_summary_index_flags(connection, note_id=note_id, user_id=user_id, chunks=chunks)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return len(chunks)


def delete_note_page_chunks(connection: Connection, *, page_id: int, user_id: int) -> None:
    page_source_id = str(page_id)
    page_source_prefix = f"{page_source_id}:%"
    with connection.cursor() as cursor:
        cursor.execute(
            """
            DELETE FROM document_chunks
            WHERE user_id = %s
              AND source_type = ANY(%s)
              AND (
                  source_id = %s
                  OR source_id LIKE %s
              )
            """,
            (user_id, list(PAGE_SOURCE_TYPES), page_source_id, page_source_prefix),
        )


def replace_note_page_chunks(connection: Connection, *, page_id: int, user_id: int) -> int:
    sources = collect_note_page_index_sources(connection, page_id=page_id, user_id=user_id)
    chunks = [chunk for source in sources for chunk in build_text_chunks(source)]
    embedding_model = get_settings().openai_embedding_model

    try:
        _delete_obsolete_chunks_for_page(connection, page_id=page_id, user_id=user_id, chunks=chunks)
        _insert_chunks(connection, chunks, embedding_model=embedding_model)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return len(chunks)


def replace_note_pages_chunks(
    connection: Connection,
    *,
    note_id: int,
    user_id: int,
    page_numbers: list[int],
) -> int:
    target_page_numbers = sorted({int(page_number) for page_number in page_numbers if int(page_number) > 0})
    if not target_page_numbers:
        return 0

    note = fetch_one(
        connection,
        """
        SELECT id, user_id, folder_id, title, summary, updated_at
        FROM notes
        WHERE id = %s AND user_id = %s
        """,
        (note_id, user_id),
    )
    if not note:
        return 0

    pages = fetch_all(
        connection,
        """
        SELECT id, note_id, page_number, content, image_url, updated_at
        FROM note_pages
        WHERE note_id = %s
          AND page_number = ANY(%s::int[])
        ORDER BY page_number ASC, id ASC
        """,
        (note_id, target_page_numbers),
    )
    sources = [source for page in pages for source in _collect_page_index_sources(note, page, user_id=user_id)]
    chunks = [chunk for source in sources for chunk in build_text_chunks(source)]
    chunks_by_page_id: dict[int, list[Any]] = {}
    for chunk in chunks:
        metadata = getattr(chunk.source, "metadata", {}) if chunk.source else {}
        page_id = metadata.get("note_page_id") if isinstance(metadata, dict) else None
        if page_id is not None:
            chunks_by_page_id.setdefault(int(page_id), []).append(chunk)
    embedding_model = get_settings().openai_embedding_model

    try:
        for page in pages:
            page_id = int(page["id"])
            _delete_obsolete_chunks_for_page(
                connection,
                page_id=page_id,
                user_id=user_id,
                chunks=chunks_by_page_id.get(page_id, []),
            )
        _insert_chunks(connection, chunks, embedding_model=embedding_model)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return len(chunks)


def replace_image_summary_chunks(connection: Connection, *, image_summary_id: int, user_id: int) -> int:
    row = fetch_one(
        connection,
        """
        SELECT s.id, s.folder_id, s.note_id, s.page_number, s.candidate_type, s.crop_hash,
               s.image_hash, s.summary, s.ocr_text, s.confidence, s.importance,
               s.confidence_reason, s.importance_reason, s.metadata, s.analyzed_at, s.updated_at,
               n.title, n.folder_id AS note_folder_id
        FROM image_ai_summaries s
        JOIN notes n ON n.id = s.note_id
        WHERE s.id = %s
          AND s.user_id = %s
          AND n.user_id = %s
          AND s.status = 'completed'
          AND s.importance = ANY(%s::text[])
          AND s.summary IS NOT NULL
        """,
        (image_summary_id, user_id, user_id, list(("high", "medium"))),
    )
    note = None
    sources: list[IndexSource] = []
    if row:
        note = {
            "id": row["note_id"],
            "folder_id": row.get("note_folder_id") or row.get("folder_id"),
            "title": row["title"],
        }
        source = _image_ai_summary_index_source_from_row(note=note, row=row, user_id=user_id)
        if source is not None:
            sources.append(source)
    chunks = [chunk for source in sources for chunk in build_text_chunks(source)]
    embedding_model = get_settings().openai_embedding_model

    try:
        _delete_obsolete_chunks_for_image_summary(
            connection,
            image_summary_id=image_summary_id,
            user_id=user_id,
            chunks=chunks,
        )
        _insert_chunks(connection, chunks, embedding_model=embedding_model)
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE image_ai_summaries
                SET indexed = %s,
                    indexed_at = CASE WHEN %s THEN now() ELSE NULL END,
                    updated_at = now()
                WHERE id = %s
                  AND user_id = %s
                """,
                (bool(chunks), bool(chunks), image_summary_id, user_id),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return len(chunks)


def replace_canvas_chunks(connection: Connection, *, canvas_note_id: int, user_id: int) -> int:
    sources = collect_canvas_index_sources(connection, canvas_note_id=canvas_note_id, user_id=user_id)
    chunks = [chunk for source in sources for chunk in build_text_chunks(source)]
    embedding_model = get_settings().openai_embedding_model

    try:
        _delete_obsolete_chunks_for_canvas(connection, canvas_note_id=canvas_note_id, user_id=user_id, chunks=chunks)
        _insert_chunks(connection, chunks, embedding_model=embedding_model)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return len(chunks)


def _docling_page_rag_extraction(page: Any) -> dict[str, Any]:
    return {
        "parser": "docling",
        "extractionStrategy": "docling_batch_markdown_v1",
        "readingOrderStrategy": "docling_document_order",
        "pageNumber": page.page_number,
        "textBlockCount": page.text_item_count,
        "imageBlockCount": page.picture_count,
        "tableCount": page.table_count,
        "visualCandidateCount": len(page.visual_candidates),
        "textBlocks": [
            {
                "bbox": list(block.bbox) if block.bbox else None,
                "coordOrigin": block.coord_origin,
                "textPreview": block.text[:240],
            }
            for block in page.text_blocks[:80]
        ],
        "visualCandidates": [
            {
                "type": candidate.candidate_type,
                "bbox": list(candidate.bbox),
                "coordOrigin": candidate.coord_origin,
                "selfRef": candidate.self_ref,
                "textPreview": candidate.text_preview,
            }
            for candidate in page.visual_candidates[:80]
        ],
    }


def _upsert_note_pages_from_docling_batches(connection: Connection, *, note_id: int, batches: list[Any]) -> int:
    pages = cached_pages_from_batches(batches)
    existing_pages = fetch_all(
        connection,
        """
        SELECT id, note_id, page_number, content, image_url, created_at, updated_at
        FROM note_pages
        WHERE note_id = %s
        ORDER BY page_number ASC, id ASC
        """,
        (note_id,),
    )
    pages_by_number = {int(page["page_number"]): page for page in existing_pages}
    with connection.cursor() as cursor:
        for parsed_page in pages:
            current = pages_by_number.get(parsed_page.page_number)
            next_content = merge_page_state_content(
                current["content"] if current else None,
                None,
                pdf_text=parsed_page.markdown,
                rag_extraction=_docling_page_rag_extraction(parsed_page),
            )
            if current:
                cursor.execute(
                    """
                    UPDATE note_pages
                    SET content = %s, updated_at = now()
                    WHERE id = %s
                    """,
                    (next_content, current["id"]),
                )
            else:
                cursor.execute(
                    """
                    INSERT INTO note_pages (note_id, page_number, content, image_url)
                    VALUES (%s, %s, %s, NULL)
                    """,
                    (note_id, parsed_page.page_number, next_content),
                )
    return len(pages)


def _upsert_note_pages_from_docling_batch(connection: Connection, *, note_id: int, batch: Any) -> int:
    return _upsert_note_pages_from_docling_batches(connection, note_id=note_id, batches=[batch])


def _refresh_note_image_status_from_db(connection: Connection, *, note_id: int, user_id: int, last_error: str | None = None) -> None:
    row = fetch_one(
        connection,
        """
        SELECT COUNT(*) AS candidate_count,
               COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
               COUNT(*) FILTER (WHERE indexed = true) AS indexed_count,
               COUNT(*) FILTER (WHERE status = 'failed') AS failed_count
        FROM image_ai_summaries
        WHERE note_id = %s AND user_id = %s
        """,
        (note_id, user_id),
    ) or {}
    failed_count = int(row.get("failed_count") or 0)
    image_status = "partial_failed" if failed_count > 0 or last_error else "ready"
    update_note_rag_image_status(
        connection,
        note_id=note_id,
        user_id=user_id,
        image_status=image_status,
        image_candidate_count=int(row.get("candidate_count") or 0),
        image_completed_count=int(row.get("completed_count") or 0),
        image_indexed_count=int(row.get("indexed_count") or 0),
        last_error=last_error,
    )


def _refresh_image_ai_summaries_for_docling_batch_background(note_id: int, user_id: int, pdf_path: str, batch: Any) -> dict[str, int]:
    with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
        return refresh_note_image_ai_summaries_for_cached_pages(
            connection,
            note_id=note_id,
            user_id=user_id,
            pdf_path=Path(pdf_path),
            cached_pages=list(batch.pages),
        )


def _run_docling_note_reindex_pipeline(
    connection: Connection,
    *,
    note: dict[str, Any],
    note_id: int,
    user_id: int,
    pdf_path: Path,
    update_note_page_count: bool,
) -> None:
    image_futures: list[Future] = []
    text_chunk_count = 0

    with ThreadPoolExecutor(max_workers=1) as image_executor:
        def on_batch_ready(batch: Any) -> None:
            nonlocal text_chunk_count
            _upsert_note_pages_from_docling_batch(connection, note_id=note_id, batch=batch)
            update_note_rag_text_progress(connection, note_id=note_id, user_id=user_id, processed_page_count=batch.page_end)
            if update_note_page_count:
                with connection.cursor() as cursor:
                    cursor.execute(
                        "UPDATE notes SET page_count = GREATEST(COALESCE(page_count, 0), %s), updated_at = now() WHERE id = %s",
                        (batch.page_end, note_id),
                    )
            connection.commit()
            batch_page_numbers = [int(page.page_number) for page in batch.pages]
            text_chunk_count += replace_note_pages_chunks(
                connection,
                note_id=note_id,
                user_id=user_id,
                page_numbers=batch_page_numbers,
            )
            image_futures.append(
                image_executor.submit(
                    _refresh_image_ai_summaries_for_docling_batch_background,
                    note_id,
                    user_id,
                    str(pdf_path),
                    batch,
                )
            )

        batches = parse_and_cache_docling_batches(
            connection,
            note=note,
            user_id=user_id,
            pdf_path=pdf_path,
            on_batch_ready=on_batch_ready,
        )
        page_count = len(cached_pages_from_batches(batches))
        if update_note_page_count:
            with connection.cursor() as cursor:
                cursor.execute(
                    "UPDATE notes SET page_count = GREATEST(COALESCE(page_count, 0), %s), updated_at = now() WHERE id = %s",
                    (page_count, note_id),
                )
        mark_note_rag_text_ready(
            connection,
            note_id=note_id,
            user_id=user_id,
            text_chunk_count=text_chunk_count,
            processed_page_count=page_count,
        )
        connection.commit()

        image_errors: list[str] = []
        for future in as_completed(image_futures):
            try:
                future.result()
            except Exception as exc:
                image_errors.append(str(exc))

        if image_errors:
            mark_note_rag_failed(connection, note_id=note_id, user_id=user_id, stage="image", error=image_errors[0])
            connection.commit()
            logger.warning(
                "failed to refresh one or more image AI summary batches: note_id=%s user_id=%s errors=%s",
                note_id,
                user_id,
                image_errors[:3],
            )
        _refresh_note_image_status_from_db(connection, note_id=note_id, user_id=user_id, last_error=image_errors[0] if image_errors else None)
        connection.commit()


def reindex_note_background(note_id: int, user_id: int) -> None:
    try:
        with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
            note = fetch_one(
                connection,
                "SELECT id, user_id, folder_id, title, file_url FROM notes WHERE id = %s AND user_id = %s",
                (note_id, user_id),
            )
            pdf_path = stored_note_pdf_path(note) if note else None
            if pdf_path is not None:
                try:
                    _run_docling_note_reindex_pipeline(
                        connection,
                        note=note,
                        note_id=note_id,
                        user_id=user_id,
                        pdf_path=pdf_path,
                        update_note_page_count=False,
                    )
                except Exception as exc:
                    try:
                        mark_note_rag_failed(connection, note_id=note_id, user_id=user_id, stage="text", error=str(exc))
                        connection.commit()
                    except Exception:
                        connection.rollback()
                    logger.warning(
                        "failed to refresh docling text index during note reindex: note_id=%s user_id=%s error=%s",
                        note_id,
                        user_id,
                        exc,
                    )
                    return
                return
            replace_note_chunks(connection, note_id=note_id, user_id=user_id)
    except Exception as exc:
        logger.warning("failed to reindex note chunks: note_id=%s user_id=%s error=%s", note_id, user_id, exc)


def reindex_note_page_background(page_id: int, user_id: int) -> None:
    try:
        with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
            replace_note_page_chunks(connection, page_id=page_id, user_id=user_id)
    except Exception as exc:
        logger.warning("failed to reindex note page chunks: page_id=%s user_id=%s error=%s", page_id, user_id, exc)


def delete_note_page_chunks_background(page_id: int, user_id: int) -> None:
    try:
        with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
            delete_note_page_chunks(connection, page_id=page_id, user_id=user_id)
            connection.commit()
    except Exception as exc:
        logger.warning("failed to delete note page chunks: page_id=%s user_id=%s error=%s", page_id, user_id, exc)


def extract_pdf_text_and_reindex_background(note_id: int, user_id: int, pdf_path: str) -> None:
    try:
        with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
            note = fetch_one(
                connection,
                "SELECT id, user_id, folder_id, title, file_url FROM notes WHERE id = %s AND user_id = %s",
                (note_id, user_id),
            )
            if not note:
                logger.warning("skipping uploaded pdf text extraction for missing note: note_id=%s user_id=%s", note_id, user_id)
                return
            _run_docling_note_reindex_pipeline(
                connection,
                note=note,
                note_id=note_id,
                user_id=user_id,
                pdf_path=Path(pdf_path),
                update_note_page_count=True,
            )
    except Exception as exc:
        try:
            with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
                mark_note_rag_failed(connection, note_id=note_id, user_id=user_id, stage="text", error=str(exc))
                connection.commit()
        except Exception:
            pass
        logger.warning(
            "failed to extract uploaded pdf with docling and reindex: note_id=%s user_id=%s pdf_path=%s error=%s",
            note_id,
            user_id,
            pdf_path,
            exc,
        )


def reindex_canvas_background(canvas_note_id: int, user_id: int) -> None:
    try:
        with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
            replace_canvas_chunks(connection, canvas_note_id=canvas_note_id, user_id=user_id)
    except Exception as exc:
        logger.warning(
            "failed to reindex canvas chunks: canvas_note_id=%s user_id=%s error=%s",
            canvas_note_id,
            user_id,
            exc,
        )


def retrieve_chunk_contexts(
    connection: Connection,
    *,
    user_id: int,
    query: str,
    note_ids: list[int] | None = None,
    folder_id: int | None = None,
    canvas_note_ids: list[int] | None = None,
    exclude_canvas_for_notes: bool = False,
    source_types: list[str] | None = None,
    min_score: float | None = None,
    top_k: int = 5,
) -> list[RetrievedContext]:
    embedding_model = get_settings().openai_embedding_model
    embedding = generate_embedding(query, model=embedding_model)
    vector = embedding_to_vector_literal(embedding)

    filters = ["user_id = %s"]
    params: list[Any] = [user_id]
    source_filters: list[str] = []
    source_params: list[Any] = []
    if note_ids:
        if exclude_canvas_for_notes:
            source_filters.append("(note_id = ANY(%s) AND source_type <> 'canvas_note')")
        else:
            source_filters.append("note_id = ANY(%s)")
        source_params.append(note_ids)
    if canvas_note_ids:
        source_filters.append("(source_type = 'canvas_note' AND source_id = ANY(%s))")
        source_params.append([str(canvas_note_id) for canvas_note_id in canvas_note_ids])
    if folder_id is not None:
        filters.append("folder_id = %s")
        params.append(folder_id)
    if source_types:
        filters.append("source_type = ANY(%s::text[])")
        params.append(source_types)
    if source_filters:
        filters.append("(" + " OR ".join(source_filters) + ")")
        params.extend(source_params)

    filter_params = params
    rows = fetch_all(
        connection,
        f"""
        SELECT source_type,
               source_id,
               title,
               content,
               1 - (embedding <=> %s::vector) AS score,
               folder_id,
               note_id,
               page_number,
               chunk_index,
               metadata
        FROM document_chunks
        WHERE {' AND '.join(filters)}
        ORDER BY embedding <=> %s::vector
        LIMIT %s
        """,
        tuple([vector, *filter_params, vector, top_k]),
    )
    contexts = [
        RetrievedContext(
            source_type=str(row["source_type"]),
            source_id=str(row["source_id"]),
            title=str(row["title"]),
            content=str(row["content"]),
            score=float(row.get("score") or 0.0),
            folder_id=row.get("folder_id"),
            note_id=row.get("note_id"),
            page_number=row.get("page_number"),
            chunk_index=row.get("chunk_index"),
            metadata=row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
        )
        for row in rows
    ]
    if min_score is None:
        return contexts
    return [context for context in contexts if context.score >= min_score]

__all__ = [
    "collect_canvas_index_sources",
    "collect_note_index_sources",
    "collect_note_page_index_sources",
    "delete_note_page_chunks",
    "delete_note_page_chunks_background",
    "extract_pdf_text_and_reindex_background",
    "reindex_canvas_background",
    "reindex_note_background",
    "reindex_note_page_background",
    "replace_canvas_chunks",
    "replace_note_chunks",
    "replace_note_page_chunks",
    "retrieve_chunk_contexts",
]
