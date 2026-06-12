import base64
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import fitz  # type: ignore[import-untyped]
from psycopg import Connection

from backend.app.core.config import Settings, get_settings
from backend.app.db.crud import fetch_all
from backend.app.schemas.rag import RetrievedContext
from backend.app.services.openai_service import judge_pdf_image_recheck
from backend.app.services.pdf_image_summary_index import stored_note_pdf_path


logger = logging.getLogger(__name__)

BBox = tuple[float, float, float, float]
RECHECK_RENDER_SCALE = 2.0


@dataclass(frozen=True)
class ImageRecheckItem:
    image_ai_summary_id: str
    page_number: int | None
    title: str
    image_mode: str
    image_data_uri: str
    image_summary: str


@dataclass(frozen=True)
class ImageRecheckResult:
    context_hint: str | None = None
    answer_sources_text: str | None = None
    debug: dict[str, Any] = field(default_factory=dict)
    items: list[ImageRecheckItem] = field(default_factory=list)
    image_inputs: list[dict[str, Any]] = field(default_factory=list)


def maybe_recheck_pdf_images_for_chat(
    connection: Connection,
    *,
    note: dict[str, Any],
    user_id: int,
    model: str,
    user_question: str,
    current_page_number: int | None = None,
    rag_sources: list[RetrievedContext],
    settings: Settings | None = None,
) -> ImageRecheckResult:
    active_settings = settings or get_settings()
    debug: dict[str, Any] = {
        "enabled": bool(active_settings.rag_image_recheck_enabled),
        "candidate_count": 0,
        "judge_called": False,
        "needed": False,
        "selected_ids": [],
        "rechecked_count": 0,
        "failures": [],
    }
    if not active_settings.rag_image_recheck_enabled:
        return ImageRecheckResult(debug=debug)

    candidates = _image_recheck_candidates(
        rag_sources,
        top_k=max(1, int(active_settings.rag_image_recheck_judge_top_k)),
    )
    debug["candidate_count"] = len(candidates)
    if not candidates:
        return ImageRecheckResult(debug=debug)

    text_contexts = _text_contexts_for_judge(rag_sources)
    try:
        judge = judge_pdf_image_recheck(
            model=model,
            user_question=user_question,
            current_page_number=current_page_number,
            text_contexts=text_contexts,
            image_candidates=[_candidate_for_judge(context) for context in candidates],
        )
    except Exception as exc:
        logger.warning("image recheck judge failed: note_id=%s error=%s", note.get("id"), exc)
        debug["failures"].append({"stage": "judge", "error": str(exc)[:300]})
        return ImageRecheckResult(debug=debug)

    debug["judge_called"] = True
    debug["judge"] = judge
    if not judge.get("needs_image_recheck"):
        return ImageRecheckResult(debug=debug)
    debug["needed"] = True

    selected_contexts = _selected_recheck_contexts(
        candidates,
        selected_ids=judge.get("image_ai_summary_ids") or [],
        allow_multiple=bool(judge.get("allow_multiple")),
        max_images=max(1, int(active_settings.rag_image_recheck_max_images)),
    )
    debug["selected_ids"] = [
        image_summary_id
        for context in selected_contexts
        if (image_summary_id := _image_summary_id(context)) is not None
    ]
    if not selected_contexts:
        return ImageRecheckResult(debug=debug)

    summary_rows = _load_image_summary_rows(connection, user_id=user_id, contexts=selected_contexts)

    same_page_multiple = _has_multiple_selected_on_same_page(selected_contexts)
    items: list[ImageRecheckItem] = []
    for context in selected_contexts:
        image_summary_id = _image_summary_id(context)
        if image_summary_id is None:
            debug["failures"].append({
                "stage": "load",
                "image_ai_summary_id": str(context.source_id),
                "error": "image summary id is unavailable",
            })
            continue
        row = summary_rows.get(image_summary_id)
        if row is None:
            debug["failures"].append({
                "stage": "load",
                "image_ai_summary_id": image_summary_id,
                "error": "image summary row is unavailable",
            })
            continue
        metadata = _merged_metadata(context, row)
        source_note = _note_from_image_summary_row(row)
        pdf_path = stored_note_pdf_path(source_note, active_settings)
        if pdf_path is None:
            debug["failures"].append({
                "stage": "render",
                "image_ai_summary_id": image_summary_id,
                "error": "stored pdf file is unavailable",
            })
            continue
        image_mode = _server_image_mode(
            preferred_mode=str(judge.get("preferred_image_mode") or "context_crop"),
            metadata=metadata,
            same_page_multiple=same_page_multiple,
        )
        page_number = _metadata_page_number(context, metadata)
        try:
            image_data_uri = _render_recheck_image(
                pdf_path,
                page_number=page_number,
                context_bbox=metadata.get("context_bbox"),
                image_mode=image_mode,
            )
        except Exception as exc:
            logger.warning(
                "image recheck failed: note_id=%s image_ai_summary_id=%s error=%s",
                note.get("id"),
                image_summary_id,
                exc,
            )
            debug["failures"].append({
                "stage": "render",
                "image_ai_summary_id": image_summary_id,
                "error": str(exc)[:300],
            })
            continue

        items.append(
            ImageRecheckItem(
                image_ai_summary_id=image_summary_id,
                page_number=page_number,
                title=context.title,
                image_mode=image_mode,
                image_data_uri=image_data_uri,
                image_summary=context.content,
            )
        )

    debug["rechecked_count"] = len(items)
    debug["items"] = [
        {
            "image_ai_summary_id": item.image_ai_summary_id,
            "page_number": item.page_number,
            "image_mode": item.image_mode,
            "title": item.title,
        }
        for item in items
    ]
    return ImageRecheckResult(
        context_hint=_format_recheck_context_hint(items),
        answer_sources_text=_format_recheck_answer_sources(items),
        debug=debug,
        items=items,
        image_inputs=[
            {
                "image_ai_summary_id": item.image_ai_summary_id,
                "page_number": item.page_number,
                "title": item.title,
                "image_mode": item.image_mode,
                "image_data_uri": item.image_data_uri,
                "image_summary": item.image_summary,
            }
            for item in items
        ],
    )


def _image_recheck_candidates(contexts: list[RetrievedContext], *, top_k: int) -> list[RetrievedContext]:
    candidates: list[RetrievedContext] = []
    for context in contexts:
        if context.source_type != "image_ai_summary":
            continue
        metadata = context.metadata if isinstance(context.metadata, dict) else {}
        if _image_summary_id(context) is None:
            continue
        if str(metadata.get("importance") or "").strip().lower() == "low":
            continue
        candidates.append(context)
        if len(candidates) >= top_k:
            break
    return candidates


def _text_contexts_for_judge(contexts: list[RetrievedContext], *, limit: int = 3) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for context in contexts:
        if context.source_type == "image_ai_summary":
            continue
        items.append({
            "source_type": context.source_type,
            "title": context.title,
            "page_number": context.page_number,
            "score": round(float(context.score), 4),
            "content": context.content[:900],
        })
        if len(items) >= limit:
            break
    return items


def _candidate_for_judge(context: RetrievedContext) -> dict[str, Any]:
    metadata = context.metadata if isinstance(context.metadata, dict) else {}
    image_summary_id = _image_summary_id(context) or str(context.source_id)
    return {
        "image_ai_summary_id": image_summary_id,
        "source_id": context.source_id,
        "title": context.title,
        "page_number": context.page_number,
        "score": round(float(context.score), 4),
        "confidence": metadata.get("confidence"),
        "importance": metadata.get("importance"),
        "crop_mode": metadata.get("crop_mode"),
        "summary": context.content[:1200],
    }


def _selected_recheck_contexts(
    candidates: list[RetrievedContext],
    *,
    selected_ids: list[str],
    allow_multiple: bool,
    max_images: int,
) -> list[RetrievedContext]:
    by_id: dict[str, RetrievedContext] = {}
    for context in candidates:
        by_id[str(context.source_id)] = context
        image_summary_id = _image_summary_id(context)
        if image_summary_id is not None:
            by_id[image_summary_id] = context
    ordered: list[RetrievedContext] = []
    for selected_id in selected_ids:
        context = by_id.get(str(selected_id))
        if context is not None and context not in ordered:
            ordered.append(context)
    if selected_ids and not ordered:
        return []
    if not ordered and candidates:
        ordered.append(candidates[0])
    limit = min(max_images, 2 if allow_multiple else 1)
    return ordered[:limit]


def _load_image_summary_rows(
    connection: Connection,
    *,
    user_id: int,
    contexts: list[RetrievedContext],
) -> dict[str, dict[str, Any]]:
    ids = [int(image_summary_id) for context in contexts if (image_summary_id := _image_summary_id(context)) is not None]
    if not ids:
        return {}
    rows = fetch_all(
        connection,
        """
        SELECT s.id, s.folder_id, s.note_id, s.page_number, s.metadata,
               s.confidence, s.importance, s.crop_hash, s.image_hash,
               n.title AS note_title, n.file_url
        FROM image_ai_summaries s
        JOIN notes n ON n.id = s.note_id
        WHERE s.user_id = %s
          AND s.id = ANY(%s::int[])
          AND s.status = 'completed'
        """,
        (user_id, ids),
    )
    return {str(row["id"]): row for row in rows}


def _image_summary_id(context: RetrievedContext) -> str | None:
    metadata = context.metadata if isinstance(context.metadata, dict) else {}
    candidate = metadata.get("image_ai_summary_id") or context.source_id
    text = str(candidate or "").strip()
    return text if text.isdigit() else None


def _note_from_image_summary_row(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("note_id"),
        "folder_id": row.get("folder_id"),
        "title": row.get("note_title") or "",
        "file_url": row.get("file_url"),
    }


def _merged_metadata(context: RetrievedContext, row: dict[str, Any] | None) -> dict[str, Any]:
    metadata = dict(context.metadata if isinstance(context.metadata, dict) else {})
    if row:
        row_metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        metadata.update(row_metadata)
        metadata["page_number"] = row.get("page_number") or metadata.get("page_number")
        metadata["confidence"] = row.get("confidence") or metadata.get("confidence")
        metadata["importance"] = row.get("importance") or metadata.get("importance")
        metadata["crop_hash"] = row.get("crop_hash") or metadata.get("crop_hash")
        metadata["image_hash"] = row.get("image_hash") or metadata.get("image_hash")
    return metadata


def _metadata_page_number(context: RetrievedContext, metadata: dict[str, Any]) -> int:
    try:
        page_number = int(context.page_number or metadata.get("page_number") or 0)
    except (TypeError, ValueError):
        page_number = 0
    return page_number


def _server_image_mode(*, preferred_mode: str, metadata: dict[str, Any], same_page_multiple: bool) -> str:
    context_bbox = _metadata_bbox(metadata.get("context_bbox"))
    crop_mode = str(metadata.get("crop_mode") or "")
    if context_bbox is None:
        return "page_image"
    if crop_mode == "full_page_context":
        return "page_image"
    if same_page_multiple:
        return "page_image"
    return "context_crop"


def _render_recheck_image(
    path: Path,
    *,
    page_number: int,
    context_bbox: Any,
    image_mode: str,
) -> str:
    if page_number < 1:
        raise ValueError("invalid page number for image recheck")
    with fitz.open(path) as pdf_document:
        if page_number > pdf_document.page_count:
            raise ValueError("page number is out of range for image recheck")
        page = pdf_document.load_page(page_number - 1)
        page_width = float(page.rect.width)
        page_height = float(page.rect.height)
        bbox = (0.0, 0.0, page_width, page_height) if image_mode == "page_image" else _metadata_bbox(context_bbox)
        if bbox is None:
            bbox = (0.0, 0.0, page_width, page_height)
        safe_bbox = _clamp_bbox(bbox, page_width, page_height)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(RECHECK_RENDER_SCALE, RECHECK_RENDER_SCALE), clip=fitz.Rect(*safe_bbox), alpha=False)
        return "data:image/png;base64," + base64.b64encode(pixmap.tobytes("png")).decode("ascii")


def _metadata_bbox(value: Any) -> BBox | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        bbox = tuple(float(item) for item in value)
    except Exception:
        return None
    if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
        return None
    return bbox  # type: ignore[return-value]


def _clamp_bbox(bbox: BBox, page_width: float, page_height: float) -> BBox:
    x0 = max(0.0, min(page_width, bbox[0]))
    y0 = max(0.0, min(page_height, bbox[1]))
    x1 = max(0.0, min(page_width, bbox[2]))
    y1 = max(0.0, min(page_height, bbox[3]))
    if x1 <= x0 or y1 <= y0:
        return (0.0, 0.0, page_width, page_height)
    return (x0, y0, x1, y1)


def _has_multiple_selected_on_same_page(contexts: list[RetrievedContext]) -> bool:
    seen: set[tuple[int | None, int]] = set()
    for context in contexts:
        if context.page_number is None:
            continue
        page_number = int(context.page_number)
        key = (context.note_id, page_number)
        if key in seen:
            return True
        seen.add(key)
    return False


def _format_recheck_context_hint(items: list[ImageRecheckItem]) -> str | None:
    if not items:
        return None
    lines = ["Original PDF image attachments. The final answer model receives these crop/page images directly and should prioritize them over image summary chunks when relevant:"]
    for index, item in enumerate(items, start=1):
        page_label = f"page {item.page_number}" if item.page_number else "page unknown"
        lines.append(
            f"[{index}] {item.title} ({page_label}, image_recheck:{item.image_ai_summary_id}, mode={item.image_mode})\n"
            f"Retrieved image summary:\n{item.image_summary}"
        )
    return "\n\n".join(lines)


def _format_recheck_answer_sources(items: list[ImageRecheckItem]) -> str | None:
    if not items:
        return None
    lines = []
    seen: set[str] = set()
    for item in items:
        key = f"{item.image_ai_summary_id}:{item.page_number}"
        if key in seen:
            continue
        seen.add(key)
        page_label = f"p.{item.page_number}" if item.page_number else "page unknown"
        lines.append(f"- {page_label} 이미지 재확인")
    return "\n".join(lines) if lines else None
