import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from psycopg import Connection
from psycopg.types.json import Jsonb

from backend.app.core.config import Settings, get_settings
from backend.app.db.crud import fetch_all, fetch_one
from backend.app.services.docling_batch_pipeline import CachedDoclingPage
from backend.app.services.docling_batch_pipeline import cached_pages_from_batches, parse_and_cache_docling_batches
from backend.app.services.docling_crop_debug import extract_docling_crop_candidates_from_cached_pages
from backend.app.services.openai_service import generate_pdf_image_rag_summary


logger = logging.getLogger(__name__)

IMAGE_SUMMARY_MIN_AREA_RATIO = 0.03
IMAGE_SUMMARY_PAGE_MAX_IMAGES = 3
IMAGE_SUMMARY_DOCUMENT_MAX_IMAGES = 60
IMAGE_SUMMARY_EXTRACTION_MAX_CANDIDATES = 240
FINAL_STATUSES = {"completed", "failed", "skipped"}
SELECTED_STATUSES = {"completed", "pending"}


def stored_note_pdf_path(note: dict[str, Any], settings: Settings | None = None) -> Path | None:
    file_url = str(note.get("file_url") or "")
    if not file_url.startswith("/uploads/"):
        return None
    active_settings = settings or get_settings()
    relative = file_url.removeprefix("/uploads/").lstrip("/")
    if not relative:
        return None
    upload_root = active_settings.upload_path.resolve()
    path = (upload_root / relative).resolve()
    try:
        path.relative_to(upload_root)
    except ValueError:
        return None
    return path if path.exists() and path.suffix.lower() == ".pdf" else None


def refresh_note_image_ai_summaries(
    connection: Connection,
    *,
    note_id: int,
    user_id: int,
    pdf_path: Path | str | None = None,
    force: bool = False,
) -> dict[str, int]:
    note = fetch_one(
        connection,
        """
        SELECT id, user_id, folder_id, title, file_url, updated_at
        FROM notes
        WHERE id = %s AND user_id = %s
        """,
        (note_id, user_id),
    )
    if not note:
        return {"candidate_count": 0, "completed": 0, "failed": 0, "skipped": 0, "cached": 0}

    target_path = Path(pdf_path) if pdf_path is not None else stored_note_pdf_path(note)
    if target_path is None or not target_path.exists():
        return {"candidate_count": 0, "completed": 0, "failed": 0, "skipped": 0, "cached": 0}

    settings = get_settings()
    batches = parse_and_cache_docling_batches(
        connection,
        note=note,
        user_id=user_id,
        pdf_path=target_path,
        reset_job=False,
        force=False,
    )
    cached_pages = cached_pages_from_batches(batches)
    return refresh_note_image_ai_summaries_for_cached_pages(
        connection,
        note_id=note_id,
        user_id=user_id,
        pdf_path=target_path,
        cached_pages=cached_pages,
        force=force,
    )


def refresh_note_image_ai_summaries_for_cached_pages(
    connection: Connection,
    *,
    note_id: int,
    user_id: int,
    pdf_path: Path | str,
    cached_pages: list[CachedDoclingPage],
    force: bool = False,
) -> dict[str, int]:
    note = fetch_one(
        connection,
        """
        SELECT id, user_id, folder_id, title, file_url, updated_at
        FROM notes
        WHERE id = %s AND user_id = %s
        """,
        (note_id, user_id),
    )
    if not note or not cached_pages:
        return {"candidate_count": 0, "completed": 0, "failed": 0, "skipped": 0, "cached": 0}

    target_path = Path(pdf_path)
    if not target_path.exists():
        return {"candidate_count": 0, "completed": 0, "failed": 0, "skipped": 0, "cached": 0}

    result = extract_docling_crop_candidates_from_cached_pages(
        target_path,
        cached_pages=cached_pages,
        min_area_ratio=0.0,
        page_max_candidates=IMAGE_SUMMARY_EXTRACTION_MAX_CANDIDATES,
        document_max_candidates=IMAGE_SUMMARY_EXTRACTION_MAX_CANDIDATES,
        use_full_page_context=True,
    )
    return _refresh_note_image_ai_summaries_from_candidates(
        connection,
        note=note,
        candidates=result.candidates,
        force=force,
        refreshed_page_numbers={
            int(page.page_number)
            for page in cached_pages
            if hasattr(page, "page_number")
        },
    )


def _refresh_note_image_ai_summaries_from_candidates(
    connection: Connection,
    *,
    note: dict[str, Any],
    candidates: list[Any],
    force: bool,
    refreshed_page_numbers: set[int] | None = None,
) -> dict[str, int]:
    settings = get_settings()
    user_id = int(note["user_id"])
    note_id = int(note["id"])
    existing = _fetch_existing_summaries(connection, user_id=user_id, note_id=note_id)
    current_keys = {(int(candidate.page_number), str(candidate.crop_hash)) for candidate in candidates}
    refreshed_pages = refreshed_page_numbers or {int(candidate.page_number) for candidate in candidates}
    stale_count = _mark_stale_existing_summaries(
        connection,
        note=note,
        existing=existing,
        refreshed_page_numbers=refreshed_pages,
        current_keys=current_keys,
    )
    if stale_count:
        connection.commit()
    existing = {
        key: row
        for key, row in existing.items()
        if not (key[0] in refreshed_pages and key not in current_keys)
    }
    page_selected_counts, selected_total, seen_hashes = _initial_selected_summary_state(existing)
    stats = {"candidate_count": len(candidates), "completed": 0, "failed": 0, "skipped": 0, "cached": 0, "stale": stale_count}
    pending_candidates: list[tuple[Any, dict[str, Any]]] = []

    for candidate in candidates:
        key = (candidate.page_number, candidate.crop_hash)
        existing_row = existing.get(key)
        existing_status = str(existing_row.get("status")) if existing_row else ""
        existing_skip_reason = str(existing_row.get("skipped_reason") or "") if existing_row else ""
        if existing_row and not force and existing_status in FINAL_STATUSES and existing_skip_reason != "stale_candidate":
            if (
                existing_status == "completed"
                and existing_row.get("indexed") is not True
                and str(existing_row.get("importance") or "") in {"high", "medium"}
            ):
                from backend.app.services.document_chunk_index import replace_image_summary_chunks

                replace_image_summary_chunks(connection, image_summary_id=int(existing_row["id"]), user_id=user_id)
            stats["cached"] += 1
            continue
        if existing_row and not force and existing_status == "pending":
            stats["cached"] += 1
            continue

        metadata = _candidate_metadata(candidate)
        skipped_reason = _skip_reason(
            candidate=candidate,
            selected_total=selected_total,
            page_selected_count=page_selected_counts.get(candidate.page_number, 0),
            seen_hashes=seen_hashes,
            document_max_images=int(settings.document_max_vision_jobs or IMAGE_SUMMARY_DOCUMENT_MAX_IMAGES),
            page_max_images=int(settings.page_max_image_crops or IMAGE_SUMMARY_PAGE_MAX_IMAGES),
        )
        if skipped_reason:
            _upsert_image_summary_status(
                connection,
                note=note,
                candidate=candidate,
                status="skipped",
                skipped_reason=skipped_reason,
                metadata=metadata,
            )
            connection.commit()
            stats["skipped"] += 1
            continue

        seen_hashes.add(candidate.crop_hash)
        page_selected_counts[candidate.page_number] = page_selected_counts.get(candidate.page_number, 0) + 1
        selected_total += 1
        _upsert_image_summary_status(
            connection,
            note=note,
            candidate=candidate,
            status="pending",
            skipped_reason=None,
            metadata=metadata,
        )
        connection.commit()
        pending_candidates.append((candidate, metadata))

    max_workers = max(1, int(settings.vision_concurrency or 1))
    if pending_candidates:
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {
                executor.submit(_generate_summary_for_candidate, note=note, candidate=candidate): (candidate, metadata)
                for candidate, metadata in pending_candidates
            }
            for future in as_completed(futures):
                candidate, metadata = futures[future]
                try:
                    summary = future.result()
                except HTTPException as exc:
                    _mark_image_summary_failed(
                        connection,
                        note=note,
                        candidate=candidate,
                        metadata=metadata,
                        reason=str(exc.detail),
                    )
                    connection.commit()
                    stats["failed"] += 1
                    continue
                except Exception as exc:
                    _mark_image_summary_failed(
                        connection,
                        note=note,
                        candidate=candidate,
                        metadata=metadata,
                        reason=str(exc),
                    )
                    connection.commit()
                    stats["failed"] += 1
                    continue

                image_summary_id = _mark_image_summary_completed(
                    connection,
                    note=note,
                    candidate=candidate,
                    metadata=metadata,
                    summary=summary,
                )
                connection.commit()
                if image_summary_id is not None:
                    from backend.app.services.document_chunk_index import replace_image_summary_chunks

                    replace_image_summary_chunks(connection, image_summary_id=image_summary_id, user_id=user_id)
                stats["completed"] += 1

    return stats


def _fetch_existing_summaries(connection: Connection, *, user_id: int, note_id: int) -> dict[tuple[int, str], dict[str, Any]]:
    rows = fetch_all(
        connection,
        """
        SELECT id, page_number, crop_hash, status, skipped_reason, indexed, importance
        FROM image_ai_summaries
        WHERE user_id = %s AND note_id = %s
        """,
        (user_id, note_id),
    )
    return {(int(row["page_number"]), str(row["crop_hash"])): row for row in rows}


def _mark_stale_existing_summaries(
    connection: Connection,
    *,
    note: dict[str, Any],
    existing: dict[tuple[int, str], dict[str, Any]],
    refreshed_page_numbers: set[int],
    current_keys: set[tuple[int, str]],
) -> int:
    stale_keys = [
        key
        for key, row in existing.items()
        if key[0] in refreshed_page_numbers
        and key not in current_keys
        and str(row.get("status")) != "skipped"
    ]
    if not stale_keys:
        return 0

    conditions: list[str] = []
    params: list[Any] = [note["user_id"], note["id"]]
    for page_number, crop_hash in stale_keys:
        conditions.append("(page_number = %s AND crop_hash = %s)")
        params.extend([page_number, crop_hash])

    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            UPDATE image_ai_summaries
            SET status = 'skipped',
                skipped_reason = 'stale_candidate',
                indexed = false,
                indexed_at = NULL,
                updated_at = now()
            WHERE user_id = %s
              AND note_id = %s
              AND ({' OR '.join(conditions)})
            RETURNING id
            """,
            tuple(params),
        )
        stale_ids = [
            str(row["id"] if isinstance(row, dict) else row[0])
            for row in cursor.fetchall()
        ]
        if stale_ids:
            cursor.execute(
                """
                DELETE FROM document_chunks
                WHERE user_id = %s
                  AND note_id = %s
                  AND source_type = 'image_ai_summary'
                  AND source_id = ANY(%s::text[])
                """,
                (note["user_id"], note["id"], stale_ids),
            )
    return len(stale_keys)


def _initial_selected_summary_state(existing: dict[tuple[int, str], dict[str, Any]]) -> tuple[dict[int, int], int, set[str]]:
    page_selected_counts: dict[int, int] = {}
    seen_hashes: set[str] = set()
    for (_page_number, crop_hash), row in existing.items():
        if str(row.get("status")) not in SELECTED_STATUSES:
            continue
        if crop_hash in seen_hashes:
            continue
        seen_hashes.add(crop_hash)
        page_number = int(row["page_number"])
        page_selected_counts[page_number] = page_selected_counts.get(page_number, 0) + 1
    return page_selected_counts, len(seen_hashes), seen_hashes


def _candidate_metadata(candidate: Any) -> dict[str, Any]:
    return {
        "candidate_type": candidate.candidate_type,
        "docling_ref": candidate.self_ref,
        "docling_bbox": list(candidate.docling_bbox),
        "docling_coord_origin": candidate.docling_coord_origin,
        "pdf_bbox": list(candidate.pdf_bbox),
        "image_bbox": list(candidate.image_bbox),
        "context_bbox": list(candidate.context_bbox),
        "crop_mode": candidate.crop_mode,
        "page_width": candidate.page_width,
        "page_height": candidate.page_height,
        "image_area_ratio": candidate.area_ratio,
        "image_crop_width": candidate.image_crop_width,
        "image_crop_height": candidate.image_crop_height,
        "context_crop_width": candidate.context_crop_width,
        "context_crop_height": candidate.context_crop_height,
        "image_hash": candidate.image_crop_hash,
        "crop_hash": candidate.crop_hash,
        "nearby_text": candidate.nearby_text,
    }


def _skip_reason(
    *,
    candidate: Any,
    selected_total: int,
    page_selected_count: int,
    seen_hashes: set[str],
    document_max_images: int,
    page_max_images: int,
) -> str | None:
    if candidate.area_ratio < IMAGE_SUMMARY_MIN_AREA_RATIO:
        return "small_image"
    if candidate.crop_hash in seen_hashes:
        return "duplicate_hash"
    if page_selected_count >= page_max_images:
        return "page_limit"
    if selected_total >= document_max_images:
        return "document_limit"
    return None


def _generate_summary_for_candidate(*, note: dict[str, Any], candidate: Any) -> dict[str, Any]:
    return generate_pdf_image_rag_summary(
        model=get_settings().default_ai_model,
        image_data_uri=candidate.context_crop_data_uri,
        note_title=str(note["title"]),
        page_number=candidate.page_number,
        candidate_type=candidate.candidate_type,
    )


def _upsert_image_summary_status(
    connection: Connection,
    *,
    note: dict[str, Any],
    candidate: Any,
    status: str,
    skipped_reason: str | None,
    metadata: dict[str, Any],
) -> None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO image_ai_summaries (
                user_id, folder_id, note_id, page_number, candidate_type, docling_ref,
                crop_hash, image_hash, status, skipped_reason, indexed, metadata,
                created_at, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, false, %s, now(), now())
            ON CONFLICT (user_id, note_id, page_number, crop_hash)
            DO UPDATE SET
                folder_id = EXCLUDED.folder_id,
                candidate_type = EXCLUDED.candidate_type,
                docling_ref = EXCLUDED.docling_ref,
                image_hash = EXCLUDED.image_hash,
                status = EXCLUDED.status,
                skipped_reason = EXCLUDED.skipped_reason,
                summary = NULL,
                ocr_text = NULL,
                confidence = NULL,
                importance = NULL,
                confidence_reason = NULL,
                importance_reason = NULL,
                indexed = false,
                metadata = EXCLUDED.metadata,
                analyzed_at = NULL,
                indexed_at = NULL,
                updated_at = now()
            """,
            (
                note["user_id"],
                note["folder_id"],
                note["id"],
                candidate.page_number,
                candidate.candidate_type,
                candidate.self_ref,
                candidate.crop_hash,
                candidate.image_crop_hash,
                status,
                skipped_reason,
                Jsonb(metadata),
            ),
        )


def _mark_image_summary_completed(
    connection: Connection,
    *,
    note: dict[str, Any],
    candidate: Any,
    metadata: dict[str, Any],
    summary: dict[str, Any],
) -> int | None:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE image_ai_summaries
            SET status = 'completed',
                skipped_reason = NULL,
                summary = %s,
                ocr_text = %s,
                confidence = %s,
                importance = %s,
                confidence_reason = %s,
                importance_reason = %s,
                indexed = false,
                indexed_at = NULL,
                metadata = %s,
                analyzed_at = now(),
                updated_at = now()
            WHERE user_id = %s
              AND note_id = %s
              AND page_number = %s
              AND crop_hash = %s
            RETURNING id
            """,
            (
                summary.get("summary"),
                summary.get("ocr_text"),
                summary.get("confidence"),
                summary.get("importance"),
                summary.get("confidence_reason"),
                summary.get("importance_reason"),
                Jsonb(metadata),
                note["user_id"],
                note["id"],
                candidate.page_number,
                candidate.crop_hash,
            ),
        )
        if hasattr(cursor, "fetchone"):
            row = cursor.fetchone()
        else:
            rows = cursor.fetchall()
            row = rows[0] if rows else None
    if row is None:
        return None
    return int(row["id"] if isinstance(row, dict) else row[0])


def _mark_image_summary_failed(
    connection: Connection,
    *,
    note: dict[str, Any],
    candidate: Any,
    metadata: dict[str, Any],
    reason: str,
) -> None:
    next_metadata = {**metadata, "error": reason[:500]}
    with connection.cursor() as cursor:
        cursor.execute(
            """
            UPDATE image_ai_summaries
            SET status = 'failed',
                skipped_reason = NULL,
                indexed = false,
                metadata = %s,
                analyzed_at = now(),
                updated_at = now()
            WHERE user_id = %s
              AND note_id = %s
              AND page_number = %s
              AND crop_hash = %s
            """,
            (
                Jsonb(next_metadata),
                note["user_id"],
                note["id"],
                candidate.page_number,
                candidate.crop_hash,
            ),
        )
