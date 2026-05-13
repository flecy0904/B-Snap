from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection

from backend.app.core.auth import get_current_user
from backend.app.core.config import get_settings
from backend.app.db.crud import execute_commit, execute_returning, fetch_all, fetch_one, require_row
from backend.app.db.session import get_db_connection
from backend.app.routes.notes import get_note_for_user
from backend.app.schemas.ai_canvas_notes import (
    AiCanvasNoteAiEditCreate,
    AiCanvasNoteAiEditRead,
    AiCanvasNoteCreate,
    AiCanvasNoteRead,
    AiCanvasNoteUpdate,
)
from backend.app.services.openai_service import generate_ai_canvas_edit


router = APIRouter(tags=["ai-canvas-notes"])
MAX_AI_CANVAS_NOTES_PER_NOTE = 3


def normalize_title(title: str) -> str:
    normalized = title.strip()
    if not normalized:
        raise HTTPException(status_code=422, detail="title must not be empty")
    return normalized


def get_ai_canvas_note(canvas_note_id: int, connection: Connection, user_id: int):
    return require_row(
        fetch_one(
            connection,
            """
            SELECT ai_canvas_notes.id,
                   ai_canvas_notes.folder_id,
                   ai_canvas_notes.note_id,
                   ai_canvas_notes.title,
                   ai_canvas_notes.markdown,
                   ai_canvas_notes.source_page_start,
                   ai_canvas_notes.source_page_end,
                   ai_canvas_notes.created_at,
                   ai_canvas_notes.updated_at
            FROM ai_canvas_notes
            JOIN notes ON notes.id = ai_canvas_notes.note_id
            WHERE ai_canvas_notes.id = %s AND notes.user_id = %s
            """,
            (canvas_note_id, user_id),
        ),
        "AI canvas note not found",
    )


@router.post("/notes/{note_id}/ai-canvas-notes", response_model=AiCanvasNoteRead)
def create_ai_canvas_note(
    note_id: int,
    payload: AiCanvasNoteCreate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    note = get_note_for_user(note_id, current_user["id"], connection)
    existing_count = fetch_one(
        connection,
        "SELECT COUNT(*) AS count FROM ai_canvas_notes WHERE note_id = %s",
        (note_id,),
    )
    if int(existing_count["count"] if existing_count else 0) >= MAX_AI_CANVAS_NOTES_PER_NOTE:
        raise HTTPException(
            status_code=409,
            detail=f"AI Canvas Notes are limited to {MAX_AI_CANVAS_NOTES_PER_NOTE} per note",
        )

    title = normalize_title(payload.title)
    return execute_returning(
        connection,
        """
        INSERT INTO ai_canvas_notes (folder_id, note_id, title, markdown, source_page_start, source_page_end)
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id, folder_id, note_id, title, markdown, source_page_start, source_page_end, created_at, updated_at
        """,
        (
            note["folder_id"],
            note_id,
            title,
            payload.markdown,
            payload.source_page_start,
            payload.source_page_end,
        ),
    )


@router.get("/notes/{note_id}/ai-canvas-notes", response_model=list[AiCanvasNoteRead])
def list_ai_canvas_notes_for_note(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    return fetch_all(
        connection,
        """
        SELECT id, folder_id, note_id, title, markdown, source_page_start, source_page_end, created_at, updated_at
        FROM ai_canvas_notes
        WHERE note_id = %s
        ORDER BY updated_at DESC, id DESC
        """,
        (note_id,),
    )


@router.get("/folders/{folder_id}/ai-canvas-notes", response_model=list[AiCanvasNoteRead])
def list_ai_canvas_notes_for_folder(
    folder_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    require_row(
        fetch_one(connection, "SELECT id FROM folders WHERE id = %s AND user_id = %s", (folder_id, current_user["id"])),
        "folder not found",
    )
    return fetch_all(
        connection,
        """
        SELECT id, folder_id, note_id, title, markdown, source_page_start, source_page_end, created_at, updated_at
        FROM ai_canvas_notes
        WHERE folder_id = %s
        ORDER BY updated_at DESC, id DESC
        """,
        (folder_id,),
    )


@router.get("/ai-canvas-notes/{canvas_note_id}", response_model=AiCanvasNoteRead)
def read_ai_canvas_note(
    canvas_note_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    return get_ai_canvas_note(canvas_note_id, connection, current_user["id"])


@router.patch("/ai-canvas-notes/{canvas_note_id}", response_model=AiCanvasNoteRead)
def update_ai_canvas_note(
    canvas_note_id: int,
    payload: AiCanvasNoteUpdate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    current = get_ai_canvas_note(canvas_note_id, connection, current_user["id"])
    next_source_page_start = (
        payload.source_page_start
        if "source_page_start" in payload.model_fields_set
        else current["source_page_start"]
    )
    next_source_page_end = (
        payload.source_page_end
        if "source_page_end" in payload.model_fields_set
        else current["source_page_end"]
    )
    if (
        next_source_page_start is not None
        and next_source_page_end is not None
        and next_source_page_end < next_source_page_start
    ):
        raise HTTPException(status_code=422, detail="source_page_end must be greater than or equal to source_page_start")

    return execute_returning(
        connection,
        """
        UPDATE ai_canvas_notes
        SET title = %s,
            markdown = %s,
            source_page_start = %s,
            source_page_end = %s,
            updated_at = now()
        WHERE id = %s
          AND EXISTS (
              SELECT 1
              FROM notes
              WHERE notes.id = ai_canvas_notes.note_id
                AND notes.user_id = %s
          )
        RETURNING id, folder_id, note_id, title, markdown, source_page_start, source_page_end, created_at, updated_at
        """,
        (
            normalize_title(payload.title) if payload.title is not None else current["title"],
            payload.markdown if payload.markdown is not None else current["markdown"],
            next_source_page_start,
            next_source_page_end,
            canvas_note_id,
            current_user["id"],
        ),
    )


@router.delete("/ai-canvas-notes/{canvas_note_id}", status_code=204)
def delete_ai_canvas_note(
    canvas_note_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_ai_canvas_note(canvas_note_id, connection, current_user["id"])
    execute_commit(connection, "DELETE FROM ai_canvas_notes WHERE id = %s", (canvas_note_id,))


@router.post("/ai-canvas-notes/{canvas_note_id}/ai-edit", response_model=AiCanvasNoteAiEditRead)
def create_ai_canvas_edit(
    canvas_note_id: int,
    payload: AiCanvasNoteAiEditCreate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    canvas_note = get_ai_canvas_note(canvas_note_id, connection, current_user["id"])
    model = payload.model or get_settings().default_ai_model
    markdown = generate_ai_canvas_edit(
        model=model,
        title=canvas_note["title"],
        markdown=canvas_note["markdown"],
        instruction=payload.instruction,
    )
    return {
        "markdown": markdown,
        "model": model,
    }
