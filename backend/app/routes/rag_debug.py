from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from psycopg import Connection

from backend.app.core.auth import get_current_user
from backend.app.core.config import Settings, get_settings
from backend.app.db.crud import fetch_all, fetch_one, require_row
from backend.app.db.session import get_db_connection
from backend.app.routes.chats import default_rag_scope, normalize_rag_scope, rag_scope_search_targets
from backend.app.schemas.chats import RagScope, SelectionRectPayload
from backend.app.services.ai_context_builder import build_ai_context, format_context_mode_instruction
from backend.app.services.ai_context_router import AiContextRoute, route_ai_context
from backend.app.services.note_page_content import parse_page_state
from backend.app.services.rag_service import retrieve_rag_contexts_with_debug


router = APIRouter(tags=["rag-debug"])
RAG_DEBUG_ENVS = {"local", "dev", "development", "test"}
MAX_DEBUG_SNIPPET_LENGTH = 420
MAX_DEBUG_RESULTS = 5


class RagDebugEvaluateCreate(BaseModel):
    content: str = Field(min_length=1)
    page_number: int | None = Field(default=None, ge=1)
    context_hint: str | None = Field(default=None, max_length=4000)
    selection_image_url: str | None = None
    selection_image: str | None = None
    selection_rect: SelectionRectPayload | None = None
    canvas_block_context: dict[str, Any] | None = None
    rag_scope: RagScope | None = None
    use_rag: bool = False
    top_k: int = Field(default=5, ge=1, le=20)


class RagDebugStatusCreate(BaseModel):
    rag_scope: RagScope | None = None


def _ensure_rag_debug_enabled(settings: Settings) -> None:
    if settings.app_env.strip().lower() not in RAG_DEBUG_ENVS:
        raise HTTPException(status_code=404, detail="not found")


def _snippet(value: object, *, max_length: int = MAX_DEBUG_SNIPPET_LENGTH) -> str:
    text = str(value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    text = " ".join(text.split())
    if len(text) <= max_length:
        return text
    return f"{text[:max_length].rstrip()}..."


def _extract_page_pdf_text(content: object) -> str:
    if isinstance(content, dict):
        pdf_text = content.get("pdfText")
        return pdf_text if isinstance(pdf_text, str) else ""
    state = parse_page_state(content)
    if state is not None:
        pdf_text = state.get("pdfText")
        return pdf_text if isinstance(pdf_text, str) else ""
    return content if isinstance(content, str) else ""


def _format_debug_contexts(contexts: list[Any]) -> list[dict[str, Any]]:
    return [
        {
            "source_type": context.source_type,
            "source_id": context.source_id,
            "title": context.title,
            "score": context.score,
            "folder_id": context.folder_id,
            "note_id": context.note_id,
            "page_number": context.page_number,
            "chunk_index": context.chunk_index,
            "metadata": context.metadata,
            "content_length": len(context.content or ""),
            "content_snippet": _snippet(context.content),
            "content": context.content or "",
        }
        for context in contexts[:MAX_DEBUG_RESULTS]
    ]


def _context_section(title: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "title": title,
        "count": len(items),
        "items": items,
    }


def _format_context_page_item(page: dict[str, Any]) -> dict[str, Any]:
    text = _extract_page_pdf_text(page.get("content"))
    return {
        "title": f"Page {page.get('page_number')}",
        "source_type": "pdf_page",
        "page_number": page.get("page_number"),
        "content_length": len(text),
        "content_snippet": _snippet(text),
        "content": text,
    }


def _format_rag_context_item(context: Any) -> dict[str, Any]:
    return {
        "title": context.title,
        "source_type": context.source_type,
        "source_id": context.source_id,
        "page_number": context.page_number,
        "chunk_index": context.chunk_index,
        "score": context.score,
        "content_length": len(context.content or ""),
        "content_snippet": _snippet(context.content),
        "content": context.content or "",
    }


def _format_debug_context_preview(
    *,
    mode: str,
    pages: list[dict[str, Any]],
    page_number: int | None,
    payload: RagDebugEvaluateCreate,
    rag_scope: dict[str, Any],
    contexts: list[Any],
    rag_debug: dict[str, Any],
) -> dict[str, Any]:
    context_mode_instruction = format_context_mode_instruction(mode, has_rag_sources=bool(contexts))
    built_context = build_ai_context(
        mode=mode,
        pages=pages,
        page_number=page_number,
        base_context_hints=[context_mode_instruction] if mode == "general" else [context_mode_instruction, payload.context_hint],
        rag_sources=contexts,
        rag_debug=rag_debug,
    )
    current_page_items = [
        _format_context_page_item(page)
        for page in built_context.context_pages
        if page_number is not None and page.get("page_number") == page_number
    ]
    nearby_page_items = [
        _format_context_page_item(page)
        for page in built_context.context_pages
        if page_number is None or page.get("page_number") != page_number
    ]
    rag_items = [_format_rag_context_item(context) for context in contexts if context.source_type != "canvas_note"]
    canvas_items = [_format_rag_context_item(context) for context in contexts if context.source_type == "canvas_note"]
    if payload.canvas_block_context:
        block_text = str(payload.canvas_block_context.get("text") or payload.canvas_block_context.get("markdown") or "").strip()
        canvas_items.insert(
            0,
            {
                "title": str(payload.canvas_block_context.get("title") or "Selected Canvas block"),
                "source_type": "canvas_block",
                "source_id": payload.canvas_block_context.get("blockId"),
                "page_number": None,
                "chunk_index": None,
                "score": None,
                "content_length": len(block_text),
                "content_snippet": _snippet(block_text),
                "content": block_text,
            },
        )
    selection_items = []
    if payload.selection_rect or payload.selection_image or payload.selection_image_url:
        selection_items.append(
            {
                "title": "Current selection",
                "source_type": "selection",
                "source_id": None,
                "page_number": page_number,
                "content_length": len(str(payload.selection_rect or "")),
                "content_snippet": _snippet(payload.selection_rect or payload.selection_image_url or payload.selection_image),
                "content": str(payload.selection_rect or payload.selection_image_url or payload.selection_image or ""),
            }
        )
    source_reference_items = [
        {
            "title": item["title"],
            "source_type": item["source_type"],
            "source_id": item.get("source_id"),
            "page_number": item.get("page_number"),
            "chunk_index": item.get("chunk_index"),
            "score": item.get("score"),
            "content_length": item.get("content_length", 0),
            "content_snippet": item.get("content_snippet", ""),
            "content": item.get("content", ""),
        }
        for item in _format_debug_contexts(contexts)
    ]
    sections = [
        _context_section("Selection", selection_items),
        _context_section("Current Page", current_page_items),
        _context_section("Nearby Pages", nearby_page_items),
        _context_section("RAG Results", rag_items),
        _context_section("Canvas Notes", canvas_items),
        _context_section("Source References", source_reference_items),
    ]
    return {
        "mode": mode,
        "scope_count": len((rag_scope or {}).get("sources", [])),
        "source_count": built_context.debug.get("retrieved_source_count", 0),
        "retrieved_chunk_count": built_context.debug.get("retrieved_chunk_count", 0),
        "current_page_included": bool(current_page_items),
        "nearby_pages_included": bool(nearby_page_items),
        "canvas_context_included": bool(canvas_items),
        "vision_image_attached": bool(payload.selection_image or payload.selection_image_url),
        "fallback": bool(built_context.debug.get("fallback")),
        "fallback_reason": built_context.debug.get("fallback_reason"),
        "context_preview": built_context.context_hint or "",
        "sections": sections,
    }


@router.get("/notes/{note_id}/rag-debug/index")
def get_note_rag_debug_index(
    note_id: int,
    limit: int = 200,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    _ensure_rag_debug_enabled(settings)
    note = require_row(
        fetch_one(
            connection,
            "SELECT id, folder_id, title FROM notes WHERE id = %s AND user_id = %s",
            (note_id, current_user["id"]),
        ),
        "note not found",
    )
    pages = fetch_all(
        connection,
        """
        SELECT id, page_number, content, updated_at
        FROM note_pages
        WHERE note_id = %s
        ORDER BY page_number ASC, id ASC
        """,
        (note_id,),
    )
    safe_limit = max(1, min(int(limit or 200), 500))
    chunk_summary_rows = fetch_all(
        connection,
        """
        SELECT source_type, COUNT(*) AS count
        FROM document_chunks
        WHERE user_id = %s AND note_id = %s
        GROUP BY source_type
        ORDER BY source_type ASC
        """,
        (current_user["id"], note_id),
    )
    chunks = fetch_all(
        connection,
        """
        SELECT source_type,
               source_id,
               title,
               content,
               folder_id,
               note_id,
               page_number,
               chunk_index,
               embedding_model,
               metadata,
               indexed_at,
               updated_at
        FROM document_chunks
        WHERE user_id = %s AND note_id = %s
        ORDER BY source_type ASC, page_number ASC NULLS LAST, source_id ASC, chunk_index ASC
        LIMIT %s
        """,
        (current_user["id"], note_id, safe_limit),
    )
    source_counts = {str(row["source_type"]): int(row["count"]) for row in chunk_summary_rows}
    embedding_models = sorted({
        str(chunk["embedding_model"])
        for chunk in chunks
        if chunk.get("embedding_model")
    })
    last_indexed_at = max(
        (chunk.get("indexed_at") for chunk in chunks if chunk.get("indexed_at")),
        default=None,
    )
    return {
        "note": {"id": note["id"], "folder_id": note["folder_id"], "title": note["title"]},
        "summary": {
            "page_count": len(pages),
            "chunk_count": sum(source_counts.values()),
            "chunks_returned": len(chunks),
            "chunk_limit": safe_limit,
            "source_counts": source_counts,
            "embedding_model": embedding_models[0] if embedding_models else None,
            "embedding_models": embedding_models,
            "last_indexed_at": last_indexed_at,
        },
        "pages": [
            {
                "id": page["id"],
                "page_number": page["page_number"],
                "text_length": len(_extract_page_pdf_text(page.get("content"))),
                "text_snippet": _snippet(_extract_page_pdf_text(page.get("content"))),
                "text": _extract_page_pdf_text(page.get("content")),
                "updated_at": page.get("updated_at"),
            }
            for page in pages
        ],
        "chunks": [
            {
                "source_type": chunk["source_type"],
                "source_id": chunk["source_id"],
                "title": chunk["title"],
                "folder_id": chunk.get("folder_id"),
                "note_id": chunk.get("note_id"),
                "page_number": chunk.get("page_number"),
                "chunk_index": chunk.get("chunk_index"),
                "metadata": chunk.get("metadata") if isinstance(chunk.get("metadata"), dict) else {},
                "content_length": len(chunk.get("content") or ""),
                "content_snippet": _snippet(chunk.get("content")),
                "content": chunk.get("content") or "",
                "embedding_model": chunk.get("embedding_model"),
                "indexed_at": chunk.get("indexed_at"),
                "updated_at": chunk.get("updated_at"),
            }
            for chunk in chunks
        ],
    }


@router.post("/chat-sessions/{session_id}/rag-debug/evaluate")
def evaluate_chat_session_rag_debug(
    session_id: int,
    payload: RagDebugEvaluateCreate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    _ensure_rag_debug_enabled(settings)
    session = require_row(
        fetch_one(
            connection,
            """
            SELECT s.id, s.note_id, s.title, s.model, s.rag_scope, n.folder_id, n.title AS note_title
            FROM chat_sessions s
            JOIN notes n ON n.id = s.note_id
            WHERE s.id = %s AND n.user_id = %s
            """,
            (session_id, current_user["id"]),
        ),
        "chat session not found",
    )
    note = {
        "id": session["note_id"],
        "folder_id": session["folder_id"],
        "title": session["note_title"],
    }
    pages = fetch_all(
        connection,
        """
        SELECT id, page_number, content, updated_at
        FROM note_pages
        WHERE note_id = %s
        ORDER BY page_number ASC, id ASC
        """,
        (session["note_id"],),
    )
    model = session.get("model") or settings.default_ai_model
    has_selection_context = bool(payload.selection_image or payload.selection_image_url or payload.selection_rect)
    context_route = route_ai_context(
        question=payload.content,
        model=model,
        has_selection=has_selection_context,
        has_canvas_context=bool(payload.canvas_block_context),
        current_page_number=payload.page_number,
    )
    if payload.use_rag and context_route.mode == "general":
        context_route = AiContextRoute(
            mode="rag",
            rewritten_query=context_route.rewritten_query,
            reason="explicit_use_rag",
        )
    rag_scope = normalize_rag_scope(
        connection,
        requested_scope=payload.rag_scope if payload.rag_scope is not None else session.get("rag_scope"),
        default_note=note,
        user_id=current_user["id"],
    )
    note_ids, canvas_note_ids = rag_scope_search_targets(rag_scope)
    contexts = []
    rag_debug: dict[str, Any] = {
        "fallback": False,
        "fallback_reason": None,
        "retrieved_source_count": 0,
        "retrieved_chunk_count": 0,
    }
    if context_route.mode == "rag":
        contexts, rag_debug = retrieve_rag_contexts_with_debug(
            connection,
            user_id=current_user["id"],
            question=context_route.rewritten_query,
            note_ids=note_ids,
            canvas_note_ids=canvas_note_ids,
            exclude_canvas_for_notes=True,
            documents=None,
            top_k=payload.top_k,
        )
    return {
        "mode": context_route.mode,
        "rewritten_query": context_route.rewritten_query,
        "router_reason": context_route.reason,
        "rag_scope": rag_scope or default_rag_scope(note),
        "search_targets": {
            "note_ids": note_ids,
            "canvas_note_ids": canvas_note_ids,
        },
        "debug": {
            **rag_debug,
            "scope_count": len((rag_scope or {}).get("sources", [])),
        },
        "context": _format_debug_context_preview(
            mode=context_route.mode,
            pages=pages,
            page_number=payload.page_number,
            payload=payload,
            rag_scope=rag_scope or default_rag_scope(note),
            contexts=contexts,
            rag_debug=rag_debug,
        ),
        "results": _format_debug_contexts(contexts),
    }


@router.post("/chat-sessions/{session_id}/rag-debug/status")
def get_chat_session_rag_debug_status(
    session_id: int,
    payload: RagDebugStatusCreate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    _ensure_rag_debug_enabled(settings)
    session = require_row(
        fetch_one(
            connection,
            """
            SELECT s.id, s.note_id, s.rag_scope, n.folder_id, n.title AS note_title
            FROM chat_sessions s
            JOIN notes n ON n.id = s.note_id
            WHERE s.id = %s AND n.user_id = %s
            """,
            (session_id, current_user["id"]),
        ),
        "chat session not found",
    )
    note = {
        "id": session["note_id"],
        "folder_id": session["folder_id"],
        "title": session["note_title"],
    }
    rag_scope = normalize_rag_scope(
        connection,
        requested_scope=payload.rag_scope if payload.rag_scope is not None else session.get("rag_scope"),
        default_note=note,
        user_id=current_user["id"],
    )
    note_ids, canvas_note_ids = rag_scope_search_targets(rag_scope)
    vector_row = fetch_one(
        connection,
        "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS available",
        (),
    )
    total_row = fetch_one(
        connection,
        "SELECT COUNT(*) AS count FROM document_chunks WHERE user_id = %s",
        (current_user["id"],),
    )
    current_note_row = fetch_one(
        connection,
        "SELECT COUNT(*) AS count FROM document_chunks WHERE user_id = %s AND note_id = %s",
        (current_user["id"], session["note_id"]),
    )
    scope_count = 0
    if note_ids:
        row = fetch_one(
            connection,
            """
            SELECT COUNT(*) AS count
            FROM document_chunks
            WHERE user_id = %s
              AND note_id = ANY(%s::int[])
              AND source_type <> 'canvas_note'
            """,
            (current_user["id"], note_ids),
        )
        scope_count += int(row["count"]) if row else 0
    if canvas_note_ids:
        row = fetch_one(
            connection,
            """
            SELECT COUNT(*) AS count
            FROM document_chunks
            WHERE user_id = %s
              AND source_type = 'canvas_note'
              AND source_id = ANY(%s::text[])
            """,
            (current_user["id"], [str(item) for item in canvas_note_ids]),
        )
        scope_count += int(row["count"]) if row else 0
    recent_rows = fetch_all(
        connection,
        """
        SELECT note_id, source_type, COUNT(*) AS chunk_count, MAX(indexed_at) AS last_indexed_at
        FROM document_chunks
        WHERE user_id = %s
        GROUP BY note_id, source_type
        ORDER BY MAX(indexed_at) DESC NULLS LAST
        LIMIT 8
        """,
        (current_user["id"],),
    )
    model_rows = fetch_all(
        connection,
        """
        SELECT embedding_model, COUNT(*) AS count
        FROM document_chunks
        WHERE user_id = %s AND embedding_model IS NOT NULL
        GROUP BY embedding_model
        ORDER BY count DESC
        """,
        (current_user["id"],),
    )
    return {
        "pgvector_available": bool(vector_row and vector_row.get("available")),
        "document_chunks_total_count": int(total_row["count"]) if total_row else 0,
        "current_note_chunk_count": int(current_note_row["count"]) if current_note_row else 0,
        "current_scope_chunk_count": scope_count,
        "embedding_models": [
            {"model": row["embedding_model"], "count": int(row["count"])}
            for row in model_rows
        ],
        "recent_index_status": [
            {
                "note_id": row.get("note_id"),
                "source_type": row.get("source_type"),
                "chunk_count": int(row["chunk_count"]),
                "last_indexed_at": row.get("last_indexed_at"),
            }
            for row in recent_rows
        ],
        "failed_indexes": [],
        "last_error": None,
        "rag_scope": rag_scope or default_rag_scope(note),
    }
