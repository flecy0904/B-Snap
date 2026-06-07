import hashlib
import logging
from typing import Any

from psycopg import Connection
from psycopg.types.json import Jsonb

from backend.app.core.config import get_settings
from backend.app.db.crud import fetch_all, fetch_one
from backend.app.schemas.rag import RetrievedContext
from backend.app.services.embeddings import embedding_to_vector_literal, generate_embedding
from backend.app.services.note_page_content import extract_ai_page_text
from backend.app.services.rag_chunker import IndexSource, build_text_chunks, is_meaningful_text
from backend.app.services.rag_retriever import Document, retrieve_relevant_contexts


logger = logging.getLogger(__name__)
VECTOR_WEIGHT = 0.7
KEYWORD_WEIGHT = 0.3


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


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
        SELECT id, note_id, page_number, content, updated_at
        FROM note_pages
        WHERE note_id = %s
        ORDER BY page_number ASC, id ASC
        """,
        (note_id,),
    )
    canvas_notes = fetch_all(
        connection,
        """
        SELECT id, note_id, title, markdown, source_page_start, source_page_end, updated_at
        FROM ai_canvas_notes
        WHERE note_id = %s
        ORDER BY updated_at DESC, id DESC
        """,
        (note_id,),
    )

    sources: list[IndexSource] = []
    if is_meaningful_text(note.get("summary")):
        sources.append(
            IndexSource(
                source_type="note",
                source_id=str(note["id"]),
                title=str(note["title"]),
                content=str(note["summary"]),
                user_id=user_id,
                folder_id=note.get("folder_id"),
                note_id=note_id,
                source_updated_at=note.get("updated_at"),
                metadata={"note_id": note_id},
            )
        )

    for page in pages:
        content = extract_ai_page_text(page.get("content"))
        if not is_meaningful_text(content):
            continue
        page_number = int(page["page_number"])
        sources.append(
            IndexSource(
                source_type="note_page",
                source_id=str(page["id"]),
                title=f"{note['title']} - page {page_number}",
                content=content,
                user_id=user_id,
                folder_id=note.get("folder_id"),
                note_id=note_id,
                page_number=page_number,
                source_updated_at=page.get("updated_at"),
                metadata={"note_page_id": page["id"], "page_number": page_number},
            )
        )

    for canvas_note in canvas_notes:
        markdown = str(canvas_note.get("markdown") or "").strip()
        if not is_meaningful_text(markdown):
            continue
        sources.append(
            IndexSource(
                source_type="ai_canvas_note",
                source_id=str(canvas_note["id"]),
                title=f"{note['title']} - {canvas_note['title']}",
                content="\n".join(
                    part
                    for part in [
                        _format_page_range(canvas_note.get("source_page_start"), canvas_note.get("source_page_end")),
                        markdown,
                    ]
                    if part
                ),
                user_id=user_id,
                folder_id=note.get("folder_id"),
                note_id=note_id,
                page_number=canvas_note.get("source_page_start"),
                source_updated_at=canvas_note.get("updated_at"),
                metadata={
                    "canvas_note_id": canvas_note["id"],
                    "source_page_start": canvas_note.get("source_page_start"),
                    "source_page_end": canvas_note.get("source_page_end"),
                },
            )
        )

    return sources


def index_note_documents(connection: Connection, *, note_id: int, user_id: int) -> int:
    sources = collect_note_index_sources(connection, note_id=note_id, user_id=user_id)
    if not _document_chunks_table_exists(connection):
        raise RuntimeError("document_chunks table is not available")

    indexed_count = index_sources(connection, sources)
    _delete_stale_note_chunks(connection, user_id=user_id, note_id=note_id, sources=sources)
    return indexed_count


def index_sources(connection: Connection, sources: list[IndexSource]) -> int:
    if not sources:
        return 0
    if not _document_chunks_table_exists(connection):
        raise RuntimeError("document_chunks table is not available")

    indexed_count = 0
    embedding_model = get_settings().openai_embedding_model
    try:
        with connection.cursor() as cursor:
            for source in sources:
                chunks = build_text_chunks(source)
                valid_chunk_indexes = {chunk.chunk_index for chunk in chunks}
                for chunk in chunks:
                    chunk_hash = content_hash(chunk.content)
                    existing = fetch_one(
                        connection,
                        """
                        SELECT id, content_hash, embedding_model
                        FROM document_chunks
                        WHERE user_id = %s
                          AND source_type = %s
                          AND source_id = %s
                          AND chunk_index = %s
                        """,
                        (source.user_id, source.source_type, source.source_id, chunk.chunk_index),
                    )
                    if (
                        existing
                        and existing.get("content_hash") == chunk_hash
                        and existing.get("embedding_model") == embedding_model
                    ):
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
                            source.user_id,
                            source.folder_id,
                            source.note_id,
                            source.source_type,
                            source.source_id,
                            source.page_number,
                            chunk.chunk_index,
                            source.title,
                            chunk.content,
                            chunk_hash,
                            embedding_to_vector_literal(embedding),
                            embedding_model,
                            source.source_updated_at,
                            Jsonb({key: value for key, value in source.metadata.items() if value is not None}),
                        ),
                    )
                    indexed_count += 1

                if valid_chunk_indexes:
                    cursor.execute(
                        """
                        DELETE FROM document_chunks
                        WHERE user_id = %s
                          AND source_type = %s
                          AND source_id = %s
                          AND NOT (chunk_index = ANY(%s))
                        """,
                        (source.user_id, source.source_type, source.source_id, list(valid_chunk_indexes)),
                    )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return indexed_count


def retrieve_vector_contexts(
    connection: Connection,
    *,
    user_id: int,
    query: str,
    note_ids: list[int] | None = None,
    folder_id: int | None = None,
    top_k: int = 5,
) -> list[RetrievedContext]:
    if not _document_chunks_table_exists(connection):
        return []

    embedding = generate_embedding(query)
    vector_literal = embedding_to_vector_literal(embedding)
    filters = ["user_id = %s"]
    params: list[Any] = [user_id]
    if note_ids:
        filters.append("note_id = ANY(%s)")
        params.append(note_ids)
    if folder_id is not None:
        filters.append("folder_id = %s")
        params.append(folder_id)

    rows = fetch_all(
        connection,
        f"""
        SELECT source_type,
               source_id,
               title,
               content,
               chunk_index,
               GREATEST(0.0, 1 - (embedding <=> %s::vector)) AS score
        FROM document_chunks
        WHERE {" AND ".join(filters)}
        ORDER BY embedding <=> %s::vector
        LIMIT %s
        """,
        (vector_literal, *params, vector_literal, top_k),
    )
    return [
        RetrievedContext(
            source_type=str(row["source_type"]),
            source_id=_chunk_source_id(str(row["source_id"]), row.get("chunk_index")),
            title=str(row["title"]),
            content=str(row["content"]),
            score=round(float(row["score"]), 4),
        )
        for row in rows
    ]


def retrieve_hybrid_contexts(
    connection: Connection,
    *,
    user_id: int,
    query: str,
    documents: list[Document],
    note_ids: list[int] | None = None,
    folder_id: int | None = None,
    top_k: int = 5,
) -> list[RetrievedContext]:
    vector_contexts: list[RetrievedContext] = []
    try:
        vector_contexts = retrieve_vector_contexts(
            connection,
            user_id=user_id,
            query=query,
            note_ids=note_ids,
            folder_id=folder_id,
            top_k=max(top_k, 8),
        )
    except Exception as exc:
        logger.info("vector retrieval unavailable; using keyword fallback: %s", exc)
        try:
            connection.rollback()
        except Exception:
            pass

    keyword_contexts = retrieve_relevant_contexts(query, documents, top_k=max(top_k, 8))
    return merge_hybrid_contexts(vector_contexts=vector_contexts, keyword_contexts=keyword_contexts, top_k=top_k)


def merge_hybrid_contexts(
    *,
    vector_contexts: list[RetrievedContext],
    keyword_contexts: list[RetrievedContext],
    top_k: int,
) -> list[RetrievedContext]:
    if not vector_contexts:
        return keyword_contexts[:top_k]
    if not keyword_contexts:
        return vector_contexts[:top_k]

    candidates: dict[tuple[str, str], RetrievedContext] = {}
    scores: dict[tuple[str, str], float] = {}

    for context in vector_contexts:
        key = _context_key(context)
        candidates[key] = context.model_copy()
        scores[key] = scores.get(key, 0.0) + _clamp_score(context.score) * VECTOR_WEIGHT

    for context in keyword_contexts:
        key = _context_key(context)
        if key not in candidates:
            candidates[key] = context.model_copy()
        scores[key] = scores.get(key, 0.0) + _clamp_score(context.score) * KEYWORD_WEIGHT

    ranked = []
    for key, context in candidates.items():
        context.score = round(scores[key], 4)
        ranked.append(context)
    ranked.sort(key=lambda context: context.score, reverse=True)
    return ranked[:top_k]


def _delete_stale_note_chunks(
    connection: Connection,
    *,
    user_id: int,
    note_id: int,
    sources: list[IndexSource],
) -> None:
    current_keys = sorted(
        {
            (source.source_type, source.source_id)
            for source in sources
            if source.note_id == note_id
        }
    )

    try:
        with connection.cursor() as cursor:
            if not current_keys:
                cursor.execute(
                    """
                    DELETE FROM document_chunks
                    WHERE user_id = %s
                      AND note_id = %s
                    """,
                    (user_id, note_id),
                )
            else:
                values_clause = ", ".join(["(%s, %s)"] * len(current_keys))
                current_key_params = [
                    value
                    for source_type, source_id in current_keys
                    for value in (source_type, source_id)
                ]
                cursor.execute(
                    f"""
                    DELETE FROM document_chunks
                    WHERE user_id = %s
                      AND note_id = %s
                      AND NOT EXISTS (
                          SELECT 1
                          FROM (VALUES {values_clause}) AS current_sources(source_type, source_id)
                          WHERE current_sources.source_type = document_chunks.source_type
                            AND current_sources.source_id = document_chunks.source_id
                      )
                    """,
                    (user_id, note_id, *current_key_params),
                )
        connection.commit()
    except Exception:
        connection.rollback()
        raise


def _document_chunks_table_exists(connection: Connection) -> bool:
    row = fetch_one(connection, "SELECT to_regclass('public.document_chunks') AS table_name")
    return bool(row and row.get("table_name"))


def _chunk_source_id(source_id: str, chunk_index: Any) -> str:
    if chunk_index in (None, 1, "1"):
        return source_id
    return f"{source_id}#chunk-{chunk_index}"


def _context_key(context: RetrievedContext) -> tuple[str, str]:
    return (context.source_type, context.source_id.split("#chunk-", 1)[0])


def _clamp_score(score: float) -> float:
    return max(0.0, min(1.0, float(score)))


def _format_page_range(start: int | None, end: int | None) -> str:
    if start is None:
        return ""
    if end is None or end == start:
        return f"Source pages: {start}"
    return f"Source pages: {start}-{end}"
