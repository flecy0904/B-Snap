from fastapi import APIRouter, Depends, Query
from psycopg import Connection

from backend.app.db.crud import execute_commit, execute_returning, fetch_all, fetch_one, require_row
from backend.app.db.session import get_db_connection
from backend.app.schemas.notes import NoteCreate, NotePageCreate, NotePageRead, NotePageUpdate, NoteRead, NoteUpdate


router = APIRouter(tags=["notes"])


@router.post("/notes", response_model=NoteRead)
def create_note(
    payload: NoteCreate,
    connection: Connection = Depends(get_db_connection),
):
    return execute_returning(
        connection,
        """
        INSERT INTO notes (folder_id, title, summary)
        VALUES (%s, %s, %s)
        RETURNING id, folder_id, title, summary, created_at, updated_at
        """,
        (payload.folder_id, payload.title, payload.summary),
    )


@router.get("/notes", response_model=list[NoteRead])
def list_notes(
    folder_id: int | None = Query(default=None),
    connection: Connection = Depends(get_db_connection),
):
    if folder_id is None:
        return fetch_all(
            connection,
            """
            SELECT id, folder_id, title, summary, created_at, updated_at
            FROM notes
            ORDER BY updated_at DESC, id DESC
            """,
        )

    return fetch_all(
        connection,
        """
        SELECT id, folder_id, title, summary, created_at, updated_at
        FROM notes
        WHERE folder_id = %s
        ORDER BY updated_at DESC, id DESC
        """,
        (folder_id,),
    )


@router.get("/notes/{note_id}", response_model=NoteRead)
def get_note(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
):
    return require_row(
        fetch_one(
            connection,
            """
            SELECT id, folder_id, title, summary, created_at, updated_at
            FROM notes
            WHERE id = %s
            """,
            (note_id,),
        ),
        "note not found",
    )


@router.patch("/notes/{note_id}", response_model=NoteRead)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    connection: Connection = Depends(get_db_connection),
):
    current = get_note(note_id, connection)
    return execute_returning(
        connection,
        """
        UPDATE notes
        SET folder_id = %s, title = %s, summary = %s, updated_at = now()
        WHERE id = %s
        RETURNING id, folder_id, title, summary, created_at, updated_at
        """,
        (
            payload.folder_id if payload.folder_id is not None else current["folder_id"],
            payload.title if payload.title is not None else current["title"],
            payload.summary if payload.summary is not None else current["summary"],
            note_id,
        ),
    )


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
):
    get_note(note_id, connection)
    execute_commit(connection, "DELETE FROM notes WHERE id = %s", (note_id,))


@router.post("/notes/{note_id}/pages", response_model=NotePageRead)
def create_note_page(
    note_id: int,
    payload: NotePageCreate,
    connection: Connection = Depends(get_db_connection),
):
    get_note(note_id, connection)
    return execute_returning(
        connection,
        """
        INSERT INTO note_pages (note_id, page_number, content, image_url)
        VALUES (%s, %s, %s, %s)
        RETURNING id, note_id, page_number, content, image_url, created_at, updated_at
        """,
        (note_id, payload.page_number, payload.content, payload.image_url),
    )


@router.get("/notes/{note_id}/pages", response_model=list[NotePageRead])
def list_note_pages(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
):
    get_note(note_id, connection)
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


@router.patch("/note-pages/{page_id}", response_model=NotePageRead)
def update_note_page(
    page_id: int,
    payload: NotePageUpdate,
    connection: Connection = Depends(get_db_connection),
):
    current = require_row(
        fetch_one(
            connection,
            """
            SELECT id, note_id, page_number, content, image_url, created_at, updated_at
            FROM note_pages
            WHERE id = %s
            """,
            (page_id,),
        ),
        "note page not found",
    )
    return execute_returning(
        connection,
        """
        UPDATE note_pages
        SET page_number = %s, content = %s, image_url = %s, updated_at = now()
        WHERE id = %s
        RETURNING id, note_id, page_number, content, image_url, created_at, updated_at
        """,
        (
            payload.page_number if payload.page_number is not None else current["page_number"],
            payload.content if payload.content is not None else current["content"],
            payload.image_url if payload.image_url is not None else current["image_url"],
            page_id,
        ),
    )


@router.delete("/note-pages/{page_id}", status_code=204)
def delete_note_page(
    page_id: int,
    connection: Connection = Depends(get_db_connection),
):
    require_row(
        fetch_one(connection, "SELECT id FROM note_pages WHERE id = %s", (page_id,)),
        "note page not found",
    )
    execute_commit(connection, "DELETE FROM note_pages WHERE id = %s", (page_id,))
