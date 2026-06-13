import time
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from psycopg import Connection

from backend.app.core.auth import get_current_user
from backend.app.core.config import Settings, get_settings
from backend.app.db.crud import fetch_all, fetch_one, require_row
from backend.app.db.session import get_db_connection
from backend.app.routes.chats import (
    default_rag_scope,
    get_note_course_name,
    material_reference_scope_hint,
    normalize_rag_scope,
    rag_scope_search_targets,
    rag_scope_titles,
)
from backend.app.schemas.chats import RagScope, SelectionRectPayload
from backend.app.services.ai_context_builder import build_ai_context, format_context_mode_instruction, select_rag_context_pages
from backend.app.services.ai_context_router import AiContextRoute, route_ai_context
from backend.app.services.ai_page_references import resolve_context_page_number
from backend.app.services.docling_batch_pipeline import (
    cached_pages_from_batches,
    file_sha256,
    load_cached_docling_batches,
)
from backend.app.services.docling_crop_debug import (
    DoclingCropDebugError,
    render_pdf_crop_preview_from_bboxes,
)
from backend.app.services.note_page_content import parse_page_state
from backend.app.services.pdf_image_recheck import ImageRecheckResult, maybe_recheck_pdf_images_for_chat
from backend.app.services.pdf_parser import PdfParsingError, parse_pdf_path
from backend.app.services.pypdf_plain_parser import PypdfPlainParsingError, parse_pdf_pages_with_pypdf_plain
from backend.app.services.rag_chunker import IndexSource, build_text_chunks
from backend.app.services.rag_service import (
    load_page_local_rag_contexts,
    merge_retrieved_contexts,
    retrieve_rag_contexts_with_debug,
    update_rag_debug_for_contexts,
)


router = APIRouter(tags=["rag-debug"])
RAG_DEBUG_ENVS = {"local", "dev", "development", "test"}
MAX_DEBUG_SNIPPET_LENGTH = 420
MAX_DEBUG_RESULTS = 5
PARSER_COMPARE_NAMES = {"pymupdf", "pypdf_plain", "docling"}


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


def _extract_page_rag_extraction(content: object) -> dict[str, Any]:
    state = content if isinstance(content, dict) else parse_page_state(content)
    if state is None:
        return {}
    rag_extraction = state.get("ragExtraction")
    return rag_extraction if isinstance(rag_extraction, dict) else {}


def _rag_extraction_count(rag_extraction: dict[str, Any], key: str) -> int:
    value = rag_extraction.get(key)
    if isinstance(value, (int, float)):
        return max(0, int(value))
    return 0


def _rag_extraction_elements(rag_extraction: dict[str, Any]) -> list[dict[str, Any]]:
    elements = rag_extraction.get("elements")
    if not isinstance(elements, list):
        return []
    return [element for element in elements if isinstance(element, dict)]


def _rag_extraction_visual_blocks(rag_extraction: dict[str, Any]) -> list[dict[str, Any]]:
    visual_blocks = rag_extraction.get("visualBlocks")
    if not isinstance(visual_blocks, list):
        return []
    return [block for block in visual_blocks if isinstance(block, dict)]


def _metadata_bbox(metadata: dict[str, Any], key: str) -> tuple[float, float, float, float]:
    value = metadata.get(key)
    if not isinstance(value, list) or len(value) != 4:
        raise HTTPException(status_code=400, detail=f"{key} metadata is unavailable")
    try:
        bbox = tuple(float(item) for item in value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"{key} metadata is invalid") from exc
    if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
        raise HTTPException(status_code=400, detail=f"{key} metadata is invalid")
    return bbox  # type: ignore[return-value]


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


def _rollback_after_debug_query_error(connection: Connection) -> None:
    try:
        connection.rollback()
    except Exception:
        pass


def _stored_note_pdf_path(note: dict[str, Any], settings: Settings) -> Path:
    file_url = str(note.get("file_url") or "")
    if not file_url:
        raise HTTPException(status_code=400, detail="stored pdf file is required")

    path = urlparse(file_url).path
    if not path.startswith("/uploads/"):
        raise HTTPException(status_code=400, detail="stored pdf file is required")

    upload_root = settings.upload_path.resolve()
    pdf_path = (upload_root / unquote(path.removeprefix("/uploads/"))).resolve()
    if upload_root not in pdf_path.parents or pdf_path.suffix.lower() != ".pdf" or not pdf_path.exists():
        raise HTTPException(status_code=400, detail="stored pdf file is unavailable")
    return pdf_path


def _parser_compare_page(
    *,
    page_number: int,
    text: str,
    parser: str,
    elapsed_ms: float | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "page_number": page_number,
        "text_length": len(text),
        "text_snippet": _snippet(text, max_length=1200),
        "text": text,
        "elapsed_ms": elapsed_ms,
        "metadata": metadata or {},
        "parser": parser,
    }


def _parser_compare_response(
    *,
    note: dict[str, Any],
    parser: str,
    pages: list[dict[str, Any]],
    chunks: list[dict[str, Any]],
    elapsed_ms: float,
) -> dict[str, Any]:
    return {
        "note": {"id": note["id"], "folder_id": note["folder_id"], "title": note["title"]},
        "summary": {
            "parser": parser,
            "page_count": len(pages),
            "chunk_count": len(chunks),
            "text_length": sum(int(page.get("text_length") or 0) for page in pages),
            "elapsed_ms": elapsed_ms,
            "page_start": pages[0]["page_number"] if pages else None,
            "page_end": pages[-1]["page_number"] if pages else None,
        },
        "pages": pages,
        "chunks": chunks,
    }


def _parser_compare_chunks(
    *,
    note: dict[str, Any],
    parser: str,
    pages: list[dict[str, Any]],
    user_id: int,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for page in pages:
        page_number = int(page["page_number"])
        metadata = page.get("metadata") if isinstance(page.get("metadata"), dict) else {}
        layout_blocks = metadata.get("visualBlocks") if isinstance(metadata.get("visualBlocks"), list) else []
        source = IndexSource(
            source_type="pdf_page",
            source_id=f"parser:{parser}:page:{page_number}",
            title=f"{note['title']} - {page_number}페이지",
            content=str(page.get("text") or ""),
            user_id=user_id,
            folder_id=note.get("folder_id"),
            note_id=note.get("id"),
            page_number=page_number,
            metadata={
                "parser": parser,
                "comparison_only": True,
                "page_label": f"{page_number}페이지",
                "extraction_strategy": metadata.get("extractionStrategy"),
                "reading_order_strategy": metadata.get("readingOrderStrategy"),
            },
            layout_blocks=layout_blocks if parser == "pymupdf" else [],
        )
        for chunk in build_text_chunks(source):
            results.append(
                {
                    "parser": parser,
                    "page_number": page_number,
                    "chunk_index": chunk.chunk_index,
                    "content_length": len(chunk.content),
                    "content_snippet": _snippet(chunk.content, max_length=1200),
                    "content": chunk.content,
                }
            )
    return results


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
    image_recheck: ImageRecheckResult | None = None,
    empty_scope_hint: str | None = None,
) -> dict[str, Any]:
    context_mode_instruction = format_context_mode_instruction(mode, has_rag_sources=bool(contexts))
    built_context = build_ai_context(
        mode=mode,
        pages=pages,
        page_number=page_number,
        base_context_hints=(
            [context_mode_instruction, empty_scope_hint]
            if mode == "general"
            else [context_mode_instruction, payload.context_hint]
        ),
        rag_sources=contexts,
        rag_debug=rag_debug,
        priority_context_hints=[image_recheck.context_hint if image_recheck else None],
        extra_answer_sources_text=image_recheck.answer_sources_text if image_recheck else None,
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
        _context_section(
            "Image Attachments",
            [
                {
                    "title": item.title,
                    "source_type": "image_recheck",
                    "source_id": item.image_ai_summary_id,
                    "page_number": item.page_number,
                    "chunk_index": None,
                    "score": None,
                    "content_length": len(item.image_summary),
                    "content_snippet": _snippet(item.image_summary),
                    "content": item.image_summary,
                }
                for item in (image_recheck.items if image_recheck else [])
            ],
        ),
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
        "vision_image_attached": bool(
            payload.selection_image
            or payload.selection_image_url
            or (image_recheck and image_recheck.items)
        ),
        "image_recheck": image_recheck.debug if image_recheck else None,
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
    index_error = None
    image_summary_error = None
    try:
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
    except Exception as exc:
        _rollback_after_debug_query_error(connection)
        index_error = str(exc)
        chunk_summary_rows = []
        chunks = []

    try:
        image_summary_rows = fetch_all(
            connection,
            """
            SELECT id, page_number, candidate_type, status, skipped_reason, confidence,
                   importance, confidence_reason, importance_reason, indexed, summary,
                   ocr_text, metadata, analyzed_at, indexed_at, updated_at
            FROM image_ai_summaries
            WHERE user_id = %s AND note_id = %s
            ORDER BY page_number ASC, id ASC
            LIMIT %s
            """,
            (current_user["id"], note_id, safe_limit),
        )
    except Exception as exc:
        _rollback_after_debug_query_error(connection)
        image_summary_error = str(exc)
        image_summary_rows = []
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
    page_debug_items = []
    text_block_count = 0
    image_block_count = 0
    visual_block_count = 0
    for page in pages:
        rag_extraction = _extract_page_rag_extraction(page.get("content"))
        page_text_block_count = _rag_extraction_count(rag_extraction, "textBlockCount")
        page_image_block_count = _rag_extraction_count(rag_extraction, "imageBlockCount")
        visual_blocks = _rag_extraction_visual_blocks(rag_extraction)
        header_footer_candidates = rag_extraction.get("headerFooterCandidates")
        side_label_candidates = rag_extraction.get("sideLabelCandidates")
        text_block_count += page_text_block_count
        image_block_count += page_image_block_count
        visual_block_count += len(visual_blocks)
        elements = _rag_extraction_elements(rag_extraction)
        page_debug_items.append(
            {
                "id": page["id"],
                "page_number": page["page_number"],
                "text_length": len(_extract_page_pdf_text(page.get("content"))),
                "text_snippet": _snippet(_extract_page_pdf_text(page.get("content"))),
                "text": _extract_page_pdf_text(page.get("content")),
                "updated_at": page.get("updated_at"),
                "parser": rag_extraction.get("parser"),
                "extraction_strategy": rag_extraction.get("extractionStrategy"),
                "reading_order_strategy": rag_extraction.get("readingOrderStrategy"),
                "column_count": rag_extraction.get("columnCount"),
                "column_confidence": rag_extraction.get("columnConfidence"),
                "text_block_count": page_text_block_count,
                "image_block_count": page_image_block_count,
                "visual_block_count": len(visual_blocks),
                "header_footer_candidate_count": len(header_footer_candidates) if isinstance(header_footer_candidates, list) else 0,
                "side_label_candidate_count": len(side_label_candidates) if isinstance(side_label_candidates, list) else 0,
                "rag_extraction": rag_extraction,
                "elements": elements,
                "elements_returned": len(elements),
            }
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
            "index_status": "unavailable" if index_error else "ready",
            "last_error": index_error,
            "image_summary_error": image_summary_error,
            "parser": "pymupdf" if any(item.get("parser") == "pymupdf" for item in page_debug_items) else None,
            "text_block_count": text_block_count,
            "image_block_count": image_block_count,
            "visual_block_count": visual_block_count,
            "extraction_strategies": sorted({
                str(item["extraction_strategy"])
                for item in page_debug_items
                if item.get("extraction_strategy")
            }),
        },
        "pages": page_debug_items,
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
        "image_ai_summaries": [
            {
                "id": row["id"],
                "page_number": row.get("page_number"),
                "candidate_type": row.get("candidate_type"),
                "status": row.get("status"),
                "skipped_reason": row.get("skipped_reason"),
                "confidence": row.get("confidence"),
                "importance": row.get("importance"),
                "confidence_reason": row.get("confidence_reason"),
                "importance_reason": row.get("importance_reason"),
                "indexed": bool(row.get("indexed")),
                "summary_snippet": _snippet(row.get("summary")),
                "summary": row.get("summary") or "",
                "ocr_text": row.get("ocr_text") or "",
                "metadata": row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
                "analyzed_at": row.get("analyzed_at"),
                "indexed_at": row.get("indexed_at"),
                "updated_at": row.get("updated_at"),
            }
            for row in image_summary_rows
        ],
    }


@router.get("/notes/{note_id}/rag-debug/image-summaries/{summary_id}/preview")
def get_note_rag_debug_image_summary_preview(
    note_id: int,
    summary_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    _ensure_rag_debug_enabled(settings)
    row = require_row(
        fetch_one(
            connection,
            """
            SELECT s.id, s.page_number, s.candidate_type, s.status, s.skipped_reason,
                   s.confidence, s.importance, s.confidence_reason, s.importance_reason,
                   s.indexed, s.summary, s.ocr_text, s.metadata, s.analyzed_at,
                   s.indexed_at, s.updated_at,
                   n.id AS note_id, n.folder_id, n.title AS note_title, n.file_url
            FROM image_ai_summaries s
            JOIN notes n ON n.id = s.note_id
            WHERE s.id = %s
              AND s.note_id = %s
              AND s.user_id = %s
            """,
            (summary_id, note_id, current_user["id"]),
        ),
        "image summary not found",
    )
    metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
    page_number = row.get("page_number")
    if not isinstance(page_number, int) or page_number < 1:
        raise HTTPException(status_code=400, detail="image summary page_number is unavailable")
    pdf_path = _stored_note_pdf_path(
        {
            "id": row["note_id"],
            "folder_id": row["folder_id"],
            "title": row["note_title"],
            "file_url": row["file_url"],
        },
        settings,
    )
    try:
        preview = render_pdf_crop_preview_from_bboxes(
            pdf_path,
            page_number=page_number,
            image_bbox=_metadata_bbox(metadata, "image_bbox"),
            context_bbox=_metadata_bbox(metadata, "context_bbox"),
            render_scale=1.2,
        )
    except DoclingCropDebugError as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "failed to render image summary preview") from exc
    return {
        "id": row["id"],
        "page_number": row.get("page_number"),
        "candidate_type": row.get("candidate_type"),
        "status": row.get("status"),
        "skipped_reason": row.get("skipped_reason"),
        "confidence": row.get("confidence"),
        "importance": row.get("importance"),
        "confidence_reason": row.get("confidence_reason"),
        "importance_reason": row.get("importance_reason"),
        "indexed": bool(row.get("indexed")),
        "summary": row.get("summary") or "",
        "summary_snippet": _snippet(row.get("summary")),
        "ocr_text": row.get("ocr_text") or "",
        "metadata": metadata,
        "analyzed_at": row.get("analyzed_at"),
        "indexed_at": row.get("indexed_at"),
        "updated_at": row.get("updated_at"),
        **preview,
    }


@router.get("/notes/{note_id}/rag-debug/parser/{parser_name}")
def get_note_rag_debug_parser_compare(
    note_id: int,
    parser_name: str,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    _ensure_rag_debug_enabled(settings)
    parser = parser_name.strip().lower()
    if parser not in PARSER_COMPARE_NAMES:
        raise HTTPException(status_code=400, detail="unsupported parser")
    note = require_row(
        fetch_one(
            connection,
            "SELECT id, folder_id, title, file_url FROM notes WHERE id = %s AND user_id = %s",
            (note_id, current_user["id"]),
        ),
        "note not found",
    )
    pdf_path = _stored_note_pdf_path(note, settings)

    if parser == "pymupdf":
        started_at = time.perf_counter()
        try:
            result = parse_pdf_path(pdf_path)
        except PdfParsingError as exc:
            raise HTTPException(status_code=400, detail=str(exc) or "failed to parse pdf with pymupdf") from exc
        elapsed_ms = round((time.perf_counter() - started_at) * 1000, 1)
        pages = [
            _parser_compare_page(
                page_number=page.page_number,
                text=page.text,
                parser="pymupdf",
                metadata={
                    "extractionStrategy": page.extraction_strategy,
                    "readingOrderStrategy": page.reading_order_strategy,
                    "columnCount": page.column_count,
                    "columnConfidence": round(page.column_confidence, 3),
                    "textBlockCount": page.text_block_count,
                    "imageBlockCount": page.image_block_count,
                    "visualBlockCount": len(page.visual_blocks),
                    "visualBlocks": [block.to_metadata() for block in page.visual_blocks],
                    "elements": [element.to_metadata() for element in page.elements],
                },
            )
            for page in result.pages
        ]
        chunks = _parser_compare_chunks(note=note, parser="pymupdf", pages=pages, user_id=current_user["id"])
        return _parser_compare_response(note=note, parser="pymupdf", pages=pages, chunks=chunks, elapsed_ms=elapsed_ms)

    if parser == "pypdf_plain":
        try:
            result = parse_pdf_pages_with_pypdf_plain(pdf_path)
        except PypdfPlainParsingError as exc:
            raise HTTPException(status_code=400, detail=str(exc) or "failed to parse pdf with pypdf plain") from exc
        pages = [
            _parser_compare_page(
                page_number=page.page_number,
                text=page.text,
                parser="pypdf_plain",
                elapsed_ms=page.elapsed_ms,
                metadata={"extractionMode": "plain"},
            )
            for page in result.pages
        ]
        chunks = _parser_compare_chunks(note=note, parser=result.parser, pages=pages, user_id=current_user["id"])
        return _parser_compare_response(note=note, parser=result.parser, pages=pages, chunks=chunks, elapsed_ms=result.elapsed_ms)

    try:
        started_at = time.perf_counter()
        file_hash = file_sha256(pdf_path)
        batches = load_cached_docling_batches(
            connection,
            note_id=note["id"],
            user_id=current_user["id"],
            file_hash=file_hash,
        )
        if not batches:
            raise HTTPException(status_code=400, detail="Docling cache is not ready. Run current note RAG reprocess first.")
        docling_pages = cached_pages_from_batches(batches)
        elapsed_ms = round(sum(batch.elapsed_ms for batch in batches) or ((time.perf_counter() - started_at) * 1000), 1)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "failed to parse pdf with docling") from exc
    pages = [
        _parser_compare_page(
            page_number=page.page_number,
            text=page.markdown,
            parser="docling",
            elapsed_ms=None,
            metadata={
                "textItemCount": page.text_item_count,
                "tableCount": page.table_count,
                "pictureCount": page.picture_count,
                "format": "markdown",
                "source": "docling_batch_cache",
            },
        )
        for page in docling_pages
    ]
    chunks = _parser_compare_chunks(note=note, parser="docling", pages=pages, user_id=current_user["id"])
    return _parser_compare_response(note=note, parser="docling", pages=pages, chunks=chunks, elapsed_ms=elapsed_ms)


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
            SELECT s.id, s.note_id, s.title, s.model, s.rag_scope,
                   n.folder_id, n.title AS note_title, n.file_url AS note_file_url
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
        "file_url": session.get("note_file_url"),
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
    effective_page_number, page_reference_debug = resolve_context_page_number(
        question=payload.content,
        payload_page_number=payload.page_number,
        available_pages=pages,
    )
    has_selection_context = bool(payload.selection_image or payload.selection_image_url or payload.selection_rect)
    rag_scope = normalize_rag_scope(
        connection,
        requested_scope=payload.rag_scope if payload.rag_scope is not None else session.get("rag_scope"),
        default_note=note,
        user_id=current_user["id"],
    )
    empty_scope_hint = material_reference_scope_hint(
        payload.content,
        has_empty_scope=not bool(rag_scope.get("sources")),
    )
    if not rag_scope.get("sources"):
        context_route = AiContextRoute(
            mode="general",
            rewritten_query="",
            reason="empty_rag_scope",
        )
    else:
        context_route = route_ai_context(
            question=payload.content,
            model=model,
            course_name=get_note_course_name(connection, note, current_user["id"]),
            document_title=str(note.get("title") or ""),
            pinned_reference_titles=rag_scope_titles(rag_scope),
            has_selection=has_selection_context,
        )
    if rag_scope.get("sources") and payload.use_rag and context_route.mode == "general":
        context_route = AiContextRoute(
            mode="rag",
            rewritten_query=context_route.rewritten_query or payload.content,
            reason="explicit_use_rag",
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
        page_local_contexts = (
            load_page_local_rag_contexts(
                connection,
                user_id=current_user["id"],
                note_ids=note_ids,
                page_number=effective_page_number,
            )
            if effective_page_number is not None
            and (
                context_route.reason in {"explicit_page_reference", "current_context_keyword"}
                or page_reference_debug.get("explicit_page_number") is not None
            )
            else []
        )
        if page_local_contexts:
            contexts = merge_retrieved_contexts(page_local_contexts, contexts)
            update_rag_debug_for_contexts(rag_debug, contexts, page_local_contexts=page_local_contexts)
    image_recheck = ImageRecheckResult()
    if context_route.mode == "rag":
        image_recheck = maybe_recheck_pdf_images_for_chat(
            connection,
            note=note,
            user_id=current_user["id"],
            model=model,
            user_question=payload.content,
            current_page_number=effective_page_number,
            rag_sources=contexts,
            settings=settings,
        )
    context_page_count = len(select_rag_context_pages(pages, effective_page_number)) if context_route.mode == "rag" else 0
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
            "context_page_count": context_page_count,
            "context_page_number": effective_page_number,
            "page_reference": page_reference_debug,
            "image_recheck": image_recheck.debug,
        },
        "context": _format_debug_context_preview(
            mode=context_route.mode,
            pages=pages,
            page_number=effective_page_number,
            payload=payload,
            rag_scope=rag_scope or default_rag_scope(note),
            contexts=contexts,
            rag_debug=rag_debug,
            image_recheck=image_recheck,
            empty_scope_hint=empty_scope_hint,
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
    scope_count = 0
    status_error = None
    image_summary_error = None
    rag_job_row = None
    batch_status_rows = []
    try:
        rag_job_row = fetch_one(
            connection,
            """
            SELECT text_status, image_status, overall_status, page_count, processed_page_count,
                   total_batches, completed_batches, text_chunk_count, image_candidate_count,
                   image_completed_count, image_indexed_count, last_error, started_at,
                   text_ready_at, image_ready_at, updated_at
            FROM note_rag_jobs
            WHERE user_id = %s AND note_id = %s
            """,
            (current_user["id"], session["note_id"]),
        )
        batch_status_rows = fetch_all(
            connection,
            """
            SELECT status, COUNT(*) AS count, MIN(page_start) AS page_start, MAX(page_end) AS page_end, MAX(updated_at) AS updated_at
            FROM docling_batch_results
            WHERE user_id = %s AND note_id = %s
            GROUP BY status
            ORDER BY status ASC
            """,
            (current_user["id"], session["note_id"]),
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
    except Exception as exc:
        _rollback_after_debug_query_error(connection)
        status_error = str(exc)
        total_row = {"count": 0}
        current_note_row = {"count": 0}
        recent_rows = []
        model_rows = []
        rag_job_row = None
        batch_status_rows = []

    try:
        image_summary_status_rows = fetch_all(
            connection,
            """
            SELECT status, importance, indexed, COUNT(*) AS count
            FROM image_ai_summaries
            WHERE user_id = %s AND note_id = %s
            GROUP BY status, importance, indexed
            ORDER BY status ASC, importance ASC, indexed ASC
            """,
            (current_user["id"], session["note_id"]),
        )
        recent_image_summary_rows = fetch_all(
            connection,
            """
            SELECT id, page_number, candidate_type, status, skipped_reason,
                   confidence, importance, indexed, summary, updated_at
            FROM image_ai_summaries
            WHERE user_id = %s AND note_id = %s
            ORDER BY updated_at DESC NULLS LAST, id DESC
            LIMIT 8
            """,
            (current_user["id"], session["note_id"]),
        )
    except Exception as exc:
        _rollback_after_debug_query_error(connection)
        image_summary_error = str(exc)
        image_summary_status_rows = []
        recent_image_summary_rows = []
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
        "rag_job": (
            {
                "text_status": rag_job_row.get("text_status"),
                "image_status": rag_job_row.get("image_status"),
                "overall_status": rag_job_row.get("overall_status"),
                "page_count": int(rag_job_row.get("page_count") or 0),
                "processed_page_count": int(rag_job_row.get("processed_page_count") or 0),
                "total_batches": int(rag_job_row.get("total_batches") or 0),
                "completed_batches": int(rag_job_row.get("completed_batches") or 0),
                "text_chunk_count": int(rag_job_row.get("text_chunk_count") or 0),
                "image_candidate_count": int(rag_job_row.get("image_candidate_count") or 0),
                "image_completed_count": int(rag_job_row.get("image_completed_count") or 0),
                "image_indexed_count": int(rag_job_row.get("image_indexed_count") or 0),
                "last_error": rag_job_row.get("last_error"),
                "started_at": rag_job_row.get("started_at"),
                "text_ready_at": rag_job_row.get("text_ready_at"),
                "image_ready_at": rag_job_row.get("image_ready_at"),
                "updated_at": rag_job_row.get("updated_at"),
            }
            if rag_job_row
            else None
        ),
        "docling_batches": [
            {
                "status": row.get("status"),
                "count": int(row.get("count") or 0),
                "page_start": row.get("page_start"),
                "page_end": row.get("page_end"),
                "updated_at": row.get("updated_at"),
            }
            for row in batch_status_rows
        ],
        "image_summary_status": [
            {
                "status": row.get("status"),
                "importance": row.get("importance"),
                "indexed": bool(row.get("indexed")),
                "count": int(row["count"]),
            }
            for row in image_summary_status_rows
        ],
        "recent_image_summaries": [
            {
                "id": row.get("id"),
                "page_number": row.get("page_number"),
                "candidate_type": row.get("candidate_type"),
                "status": row.get("status"),
                "skipped_reason": row.get("skipped_reason"),
                "confidence": row.get("confidence"),
                "importance": row.get("importance"),
                "indexed": bool(row.get("indexed")),
                "summary_snippet": _snippet(row.get("summary")),
                "updated_at": row.get("updated_at"),
            }
            for row in recent_image_summary_rows
        ],
        "failed_indexes": [],
        "last_error": status_error,
        "image_summary_error": image_summary_error,
        "rag_scope": rag_scope or default_rag_scope(note),
    }
