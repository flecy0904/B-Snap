import hashlib
import logging
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
from backend.app.services.embeddings import embedding_to_vector_literal, generate_embedding
from backend.app.services.note_page_content import merge_page_state_content, parse_page_state
from backend.app.services.pdf_text_extractor import extract_pdf_text_pages_from_path
from backend.app.services.rag_chunker import IndexSource, build_text_chunks, is_meaningful_text


logger = logging.getLogger(__name__)
PAGE_SOURCE_TYPES = ("pdf_page", "pdf_text_box", "image_ocr", "image_ai_summary")


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _metadata(value: dict[str, Any] | None) -> dict[str, Any]:
    return {key: item for key, item in (value or {}).items() if item is not None}


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


def _collect_page_index_sources(note: dict, page: dict, *, user_id: int) -> list[IndexSource]:
    page_number = int(page["page_number"])
    page_label = f"{page_number}페이지"
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
                metadata={"note_page_id": page["id"], "page_label": page_label},
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
                        title=f"{note['title']} - {page_label} 이미지 분석",
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
    return _collect_page_index_sources(note, row, user_id=user_id)


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
                Jsonb(chunk.source.metadata),
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
                    Jsonb(chunk.source.metadata),
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


def reindex_note_background(note_id: int, user_id: int) -> None:
    try:
        with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
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
        page_texts = extract_pdf_text_pages_from_path(Path(pdf_path))
        with psycopg.connect(get_database_url(), row_factory=dict_row) as connection:
            note = fetch_one(
                connection,
                "SELECT id FROM notes WHERE id = %s AND user_id = %s",
                (note_id, user_id),
            )
            if not note:
                logger.warning("skipping uploaded pdf text extraction for missing note: note_id=%s user_id=%s", note_id, user_id)
                return
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
                for index, pdf_text in enumerate(page_texts, start=1):
                    current = pages_by_number.get(index)
                    if current:
                        cursor.execute(
                            """
                            UPDATE note_pages
                            SET content = %s, updated_at = now()
                            WHERE id = %s
                            """,
                            (merge_page_state_content(current["content"], None, pdf_text=pdf_text), current["id"]),
                        )
                    else:
                        cursor.execute(
                            """
                            INSERT INTO note_pages (note_id, page_number, content, image_url)
                            VALUES (%s, %s, %s, NULL)
                            """,
                            (note_id, index, merge_page_state_content(None, None, pdf_text=pdf_text)),
                        )
                cursor.execute(
                    "UPDATE notes SET page_count = GREATEST(COALESCE(page_count, 0), %s), updated_at = now() WHERE id = %s",
                    (len(page_texts), note_id),
                )
            replace_note_chunks(connection, note_id=note_id, user_id=user_id)
    except Exception as exc:
        logger.warning(
            "failed to extract uploaded pdf text and reindex: note_id=%s user_id=%s pdf_path=%s error=%s",
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
    return [
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
