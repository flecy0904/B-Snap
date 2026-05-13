from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection

from backend.app.db.crud import execute_commit, execute_returning, fetch_all, fetch_one, require_row
from backend.app.db.session import get_db_connection
from backend.app.routes.folders import get_folder
from backend.app.routes.notes import get_note
from backend.app.schemas.ai_canvas_notes import AiCanvasNoteCreate, AiCanvasNoteRead, AiCanvasNoteUpdate


router = APIRouter(tags=["ai-canvas-notes"])


def normalize_title(title: str) -> str:
    normalized = title.strip()
    if not normalized:
        raise HTTPException(status_code=422, detail="title must not be empty")
    return normalized


def get_ai_canvas_note(canvas_note_id: int, connection: Connection):
    return require_row(
        fetch_one(
            connection,
            """
            SELECT id, folder_id, note_id, title, markdown, source_page_start, source_page_end, created_at, updated_at
            FROM ai_canvas_notes
            WHERE id = %s
            """,
            (canvas_note_id,),
        ),
        "AI canvas note not found",
    )


@router.post("/notes/{note_id}/ai-canvas-notes", response_model=AiCanvasNoteRead)
def create_ai_canvas_note(
    note_id: int,
    payload: AiCanvasNoteCreate,
    connection: Connection = Depends(get_db_connection),
):
    note = get_note(note_id, connection)
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
):
    get_note(note_id, connection)
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
):
    get_folder(folder_id, connection)
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
):
    return get_ai_canvas_note(canvas_note_id, connection)


@router.patch("/ai-canvas-notes/{canvas_note_id}", response_model=AiCanvasNoteRead)
def update_ai_canvas_note(
    canvas_note_id: int,
    payload: AiCanvasNoteUpdate,
    connection: Connection = Depends(get_db_connection),
):
    current = get_ai_canvas_note(canvas_note_id, connection)
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
        RETURNING id, folder_id, note_id, title, markdown, source_page_start, source_page_end, created_at, updated_at
        """,
        (
            normalize_title(payload.title) if payload.title is not None else current["title"],
            payload.markdown if payload.markdown is not None else current["markdown"],
            next_source_page_start,
            next_source_page_end,
            canvas_note_id,
        ),
    )


@router.delete("/ai-canvas-notes/{canvas_note_id}", status_code=204)
def delete_ai_canvas_note(
    canvas_note_id: int,
    connection: Connection = Depends(get_db_connection),
):
    get_ai_canvas_note(canvas_note_id, connection)
    execute_commit(connection, "DELETE FROM ai_canvas_notes WHERE id = %s", (canvas_note_id,))
