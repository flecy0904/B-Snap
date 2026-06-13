import logging
from pathlib import Path
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from psycopg import Connection

from backend.app.core.auth import get_current_user
from backend.app.core.config import Settings, get_settings
from backend.app.db.crud import execute_commit, execute_returning, fetch_all, fetch_one, require_row
from backend.app.db.session import get_db_connection
from backend.app.schemas.notes import (
    NoteCreate,
    NotePageCreate,
    NotePageRead,
    NotePageUpdate,
    NoteRagStatusRead,
    NoteRead,
    NoteUpdate,
)
from backend.app.services.document_chunk_index import (
    delete_note_page_chunks_background,
    reindex_note_background,
    reindex_note_page_background,
)
from backend.app.services.note_page_content import merge_page_state_content


router = APIRouter(tags=["notes"])
logger = logging.getLogger("uvicorn.error")


def _schedule_note_reindex(background_tasks: BackgroundTasks, note_id: int, user_id: int) -> None:
    background_tasks.add_task(reindex_note_background, note_id, user_id)


def _schedule_note_page_reindex(background_tasks: BackgroundTasks, page_id: int, user_id: int) -> None:
    background_tasks.add_task(reindex_note_page_background, page_id, user_id)


def _schedule_note_page_chunk_delete(background_tasks: BackgroundTasks, page_id: int, user_id: int) -> None:
    background_tasks.add_task(delete_note_page_chunks_background, page_id, user_id)


def get_note_for_user(note_id: int, user_id: int, connection: Connection):
    return require_row(
        fetch_one(
            connection,
            """
            SELECT id, folder_id, title, summary, file_url, thumbnail_url, page_count, created_at, updated_at
            FROM notes
            WHERE id = %s AND user_id = %s
            """,
            (note_id, user_id),
        ),
        "note not found",
    )


def _list_pages_for_note(connection: Connection, note_id: int) -> list[dict]:
    return fetch_all(
        connection,
        """
        SELECT id, note_id, page_number, content, image_url, created_at, updated_at
        FROM note_pages
        WHERE note_id = %s
        ORDER BY page_number ASC, id ASC
        """,
        (note_id,),
    )


def _list_page_refs_for_note(connection: Connection, note_id: int) -> list[dict]:
    return fetch_all(
        connection,
        """
        SELECT id, note_id, page_number, NULL::text AS content, image_url, created_at, updated_at
        FROM note_pages
        WHERE note_id = %s
        ORDER BY page_number ASC, id ASC
        """,
        (note_id,),
    )


def _count_cached_docling_visual_candidates(connection: Connection, *, note_id: int, user_id: int) -> int:
    rows = fetch_all(
        connection,
        """
        SELECT result
        FROM docling_batch_results
        WHERE user_id = %s
          AND note_id = %s
          AND status = 'ready'
        """,
        (user_id, note_id),
    )
    count = 0
    for row in rows:
        result = row.get("result") if isinstance(row.get("result"), dict) else {}
        pages = result.get("pages") if isinstance(result.get("pages"), list) else []
        for page in pages:
            if not isinstance(page, dict):
                continue
            visual_candidates = page.get("visual_candidates")
            if isinstance(visual_candidates, list):
                count += len(visual_candidates)
    return count


def _upload_relative_path(url: str | None) -> str | None:
    if not url:
        return None

    path = urlparse(url).path
    if not path.startswith("/uploads/"):
        return None
    return unquote(path.removeprefix("/uploads/"))


def _delete_upload_file(settings: Settings, relative_path: str | None) -> None:
    if not relative_path:
        return

    upload_root = settings.upload_path.resolve()
    target = (upload_root / relative_path).resolve()
    if upload_root not in target.parents:
        return

    try:
        target.unlink(missing_ok=True)
    except OSError as exc:
        logger.warning("failed to delete upload file %s: %s", target, exc)


def _cleanup_note_upload_files(note: dict, settings: Settings) -> None:
    file_relative_path = _upload_relative_path(note.get("file_url"))
    thumbnail_relative_path = _upload_relative_path(note.get("thumbnail_url"))

    _delete_upload_file(settings, file_relative_path)
    _delete_upload_file(settings, thumbnail_relative_path)

    if file_relative_path and file_relative_path.lower().endswith(".pdf"):
        thumbnail_name = f"{Path(file_relative_path).stem}.png"
        _delete_upload_file(settings, f"pdf-thumbnails/{thumbnail_name}")


@router.post("/notes", response_model=NoteRead)
def create_note(
    payload: NoteCreate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    require_row(
        fetch_one(connection, "SELECT id FROM folders WHERE id = %s AND user_id = %s", (payload.folder_id, current_user["id"])),
        "folder not found",
    )
    return execute_returning(
        connection,
        """
        INSERT INTO notes (user_id, folder_id, title, summary)
        VALUES (%s, %s, %s, %s)
        RETURNING id, folder_id, title, summary, file_url, thumbnail_url, page_count, created_at, updated_at
        """,
        (current_user["id"], payload.folder_id, payload.title, payload.summary),
    )


@router.get("/notes", response_model=list[NoteRead])
def list_notes(
    folder_id: int | None = Query(default=None),
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    if folder_id is None:
        return fetch_all(
            connection,
            """
            SELECT id, folder_id, title, summary, file_url, thumbnail_url, page_count, created_at, updated_at
            FROM notes
            WHERE user_id = %s
            ORDER BY updated_at DESC, id DESC
            """,
            (current_user["id"],),
        )

    return fetch_all(
        connection,
        """
        SELECT id, folder_id, title, summary, file_url, thumbnail_url, page_count, created_at, updated_at
        FROM notes
        WHERE folder_id = %s AND user_id = %s
        ORDER BY updated_at DESC, id DESC
        """,
        (folder_id, current_user["id"]),
    )


@router.get("/notes/{note_id}", response_model=NoteRead)
def get_note(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    return get_note_for_user(note_id, current_user["id"], connection)


@router.get("/notes/{note_id}/rag-status", response_model=NoteRagStatusRead)
def get_note_rag_status(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    rag_job = fetch_one(
        connection,
        """
        SELECT text_status, image_status, overall_status, page_count, processed_page_count,
               total_batches, completed_batches, text_chunk_count, image_candidate_count,
               image_completed_count, image_indexed_count, last_error, started_at,
               text_ready_at, image_ready_at, updated_at
        FROM note_rag_jobs
        WHERE user_id = %s AND note_id = %s
        """,
        (current_user["id"], note_id),
    )
    chunk_row = fetch_one(
        connection,
        """
        SELECT COUNT(*) AS count
        FROM document_chunks
        WHERE user_id = %s
          AND note_id = %s
          AND source_type <> 'canvas_note'
        """,
        (current_user["id"], note_id),
    )
    image_count_row = fetch_one(
        connection,
        """
        SELECT COUNT(*) AS candidate_count,
               COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'skipped')) AS processed_count,
               COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
               COUNT(*) FILTER (WHERE indexed = true) AS indexed_count
        FROM image_ai_summaries
        WHERE user_id = %s
          AND note_id = %s
        """,
        (current_user["id"], note_id),
    ) or {}
    cached_visual_candidate_count = _count_cached_docling_visual_candidates(
        connection,
        note_id=note_id,
        user_id=current_user["id"],
    )
    image_candidate_count = max(
        int(image_count_row.get("candidate_count") or 0),
        cached_visual_candidate_count,
    )
    image_error_row = fetch_one(
        connection,
        """
        SELECT skipped_reason
        FROM image_ai_summaries
        WHERE user_id = %s
          AND note_id = %s
          AND status = 'failed'
          AND skipped_reason IS NOT NULL
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1
        """,
        (current_user["id"], note_id),
    )
    return {
        "rag_job": (
            {
                "text_status": rag_job.get("text_status"),
                "image_status": rag_job.get("image_status"),
                "overall_status": rag_job.get("overall_status"),
                "page_count": int(rag_job.get("page_count") or 0),
                "processed_page_count": int(rag_job.get("processed_page_count") or 0),
                "total_batches": int(rag_job.get("total_batches") or 0),
                "completed_batches": int(rag_job.get("completed_batches") or 0),
                "text_chunk_count": int(rag_job.get("text_chunk_count") or 0),
                "image_candidate_count": image_candidate_count,
                "image_processed_count": int(image_count_row.get("processed_count") or 0),
                "image_completed_count": int(image_count_row.get("completed_count") or 0),
                "image_indexed_count": int(image_count_row.get("indexed_count") or 0),
                "last_error": rag_job.get("last_error"),
                "started_at": rag_job.get("started_at"),
                "text_ready_at": rag_job.get("text_ready_at"),
                "image_ready_at": rag_job.get("image_ready_at"),
                "updated_at": rag_job.get("updated_at"),
            }
            if rag_job
            else None
        ),
        "current_note_chunk_count": int(chunk_row["count"]) if chunk_row else 0,
        "image_summary_error": image_error_row.get("skipped_reason") if image_error_row else None,
    }


@router.patch("/notes/{note_id}", response_model=NoteRead)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    current = get_note_for_user(note_id, current_user["id"], connection)
    next_folder_id = payload.folder_id if payload.folder_id is not None else current["folder_id"]
    require_row(
        fetch_one(connection, "SELECT id FROM folders WHERE id = %s AND user_id = %s", (next_folder_id, current_user["id"])),
        "folder not found",
    )
    updated = execute_returning(
        connection,
        """
        UPDATE notes
        SET folder_id = %s, title = %s, summary = %s, updated_at = now()
        WHERE id = %s AND user_id = %s
        RETURNING id, folder_id, title, summary, file_url, thumbnail_url, page_count, created_at, updated_at
        """,
        (
            next_folder_id,
            payload.title if payload.title is not None else current["title"],
            payload.summary if payload.summary is not None else current["summary"],
            note_id,
            current_user["id"],
        ),
    )
    _schedule_note_reindex(background_tasks, note_id, current_user["id"])
    return updated


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
    settings: Settings = Depends(get_settings),
    current_user: dict = Depends(get_current_user),
):
    note = get_note_for_user(note_id, current_user["id"], connection)
    execute_commit(connection, "DELETE FROM notes WHERE id = %s AND user_id = %s", (note_id, current_user["id"]))
    _cleanup_note_upload_files(note, settings)


@router.post("/notes/{note_id}/pages", response_model=NotePageRead)
def create_note_page(
    note_id: int,
    payload: NotePageCreate,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    created = execute_returning(
        connection,
        """
        INSERT INTO note_pages (note_id, page_number, content, image_url)
        VALUES (%s, %s, %s, %s)
        RETURNING id, note_id, page_number, content, image_url, created_at, updated_at
        """,
        (note_id, payload.page_number, payload.content, payload.image_url),
    )
    _schedule_note_page_reindex(background_tasks, int(created["id"]), current_user["id"])
    return created


@router.get("/notes/{note_id}/pages", response_model=list[NotePageRead])
def list_note_pages(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    return _list_pages_for_note(connection, note_id)


@router.post("/notes/{note_id}/pages/{page_number}/duplicate", response_model=list[NotePageRead])
def duplicate_note_page(
    note_id: int,
    page_number: int,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    target = require_row(
        fetch_one(
            connection,
            """
            SELECT id, note_id, page_number, content, image_url
            FROM note_pages
            WHERE note_id = %s AND page_number = %s
            ORDER BY id ASC
            LIMIT 1
            """,
            (note_id, page_number),
        ),
        "note page not found",
    )

    try:
        with connection.cursor() as cursor:
            cursor.execute(
                """
                UPDATE note_pages
                SET page_number = page_number + 1, updated_at = now()
                WHERE note_id = %s AND page_number > %s
                """,
                (note_id, page_number),
            )
            cursor.execute(
                """
                INSERT INTO note_pages (note_id, page_number, content, image_url)
                VALUES (%s, %s, %s, %s)
                """,
                (note_id, page_number + 1, target["content"], target["image_url"]),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise

    _schedule_note_reindex(background_tasks, note_id, current_user["id"])
    return _list_pages_for_note(connection, note_id)


@router.delete("/notes/{note_id}/pages/by-number/{page_number}", response_model=list[NotePageRead])
def delete_note_page_by_number(
    note_id: int,
    page_number: int,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    pages = _list_pages_for_note(connection, note_id)
    if len(pages) <= 1:
        raise HTTPException(status_code=400, detail="마지막 페이지는 삭제할 수 없어요.")
    target = require_row(
        next((page for page in pages if int(page["page_number"]) == page_number), None),
        "note page not found",
    )

    try:
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM note_pages WHERE id = %s", (target["id"],))
            cursor.execute(
                """
                UPDATE note_pages
                SET page_number = page_number - 1, updated_at = now()
                WHERE note_id = %s AND page_number > %s
                """,
                (note_id, page_number),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise

    _schedule_note_reindex(background_tasks, note_id, current_user["id"])
    return _list_pages_for_note(connection, note_id)


@router.post("/notes/{note_id}/pages/{page_number}/move", response_model=list[NotePageRead])
def move_note_page_by_number(
    note_id: int,
    page_number: int,
    background_tasks: BackgroundTasks,
    delta: int = Query(..., ge=-1, le=1),
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    if delta == 0:
        return _list_pages_for_note(connection, note_id)

    pages = _list_pages_for_note(connection, note_id)
    target = require_row(
        next((page for page in pages if int(page["page_number"]) == page_number), None),
        "note page not found",
    )
    next_page_number = page_number + delta
    swap_target = require_row(
        next((page for page in pages if int(page["page_number"]) == next_page_number), None),
        "target page not found",
    )

    try:
        with connection.cursor() as cursor:
            cursor.execute("UPDATE note_pages SET page_number = -1 WHERE id = %s", (target["id"],))
            cursor.execute(
                "UPDATE note_pages SET page_number = %s, updated_at = now() WHERE id = %s",
                (page_number, swap_target["id"]),
            )
            cursor.execute(
                "UPDATE note_pages SET page_number = %s, updated_at = now() WHERE id = %s",
                (next_page_number, target["id"]),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise

    _schedule_note_reindex(background_tasks, note_id, current_user["id"])
    return _list_pages_for_note(connection, note_id)


@router.patch("/note-pages/{page_id}", response_model=NotePageRead)
def update_note_page(
    page_id: int,
    payload: NotePageUpdate,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    current = require_row(
        fetch_one(
            connection,
            """
            SELECT p.id, p.note_id, p.page_number, p.content, p.image_url, p.created_at, p.updated_at
            FROM note_pages p
            JOIN notes n ON n.id = p.note_id
            WHERE p.id = %s AND n.user_id = %s
            """,
            (page_id, current_user["id"]),
        ),
        "note page not found",
    )
    updated = execute_returning(
        connection,
        """
        UPDATE note_pages
        SET page_number = %s, content = %s, image_url = %s, updated_at = now()
        WHERE id = %s
        RETURNING id, note_id, page_number, content, image_url, created_at, updated_at
        """,
        (
            payload.page_number if payload.page_number is not None else current["page_number"],
            merge_page_state_content(current["content"], payload.content)
            if payload.content is not None
            else current["content"],
            payload.image_url if payload.image_url is not None else current["image_url"],
            page_id,
        ),
    )
    _schedule_note_page_reindex(background_tasks, int(updated["id"]), current_user["id"])
    return updated


@router.delete("/note-pages/{page_id}", status_code=204)
def delete_note_page(
    page_id: int,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    current = require_row(
        fetch_one(
            connection,
            """
            SELECT p.id, p.note_id
            FROM note_pages p
            JOIN notes n ON n.id = p.note_id
            WHERE p.id = %s AND n.user_id = %s
            """,
            (page_id, current_user["id"]),
        ),
        "note page not found",
    )
    execute_commit(connection, "DELETE FROM note_pages WHERE id = %s", (page_id,))
    _schedule_note_page_chunk_delete(background_tasks, page_id, current_user["id"])
