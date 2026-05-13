from fastapi import APIRouter, Depends
from psycopg import Connection

from backend.app.core.auth import get_current_user
from backend.app.db.crud import execute_commit, execute_returning, fetch_all, fetch_one, require_row
from backend.app.db.session import get_db_connection
from backend.app.schemas.folders import FolderCreate, FolderRead, FolderUpdate


router = APIRouter(prefix="/folders", tags=["folders"])


@router.post("", response_model=FolderRead)
def create_folder(
    payload: FolderCreate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    return execute_returning(
        connection,
        """
        INSERT INTO folders (user_id, name, color)
        VALUES (%s, %s, %s)
        RETURNING id, name, color, created_at, updated_at
        """,
        (current_user["id"], payload.name, payload.color),
    )


@router.get("", response_model=list[FolderRead])
def list_folders(
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    return fetch_all(
        connection,
        """
        SELECT id, name, color, created_at, updated_at
        FROM folders
        WHERE user_id = %s
        ORDER BY updated_at DESC, id DESC
        """,
        (current_user["id"],),
    )


@router.get("/{folder_id}", response_model=FolderRead)
def get_folder(
    folder_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    return require_row(
        fetch_one(
            connection,
            """
            SELECT id, name, color, created_at, updated_at
            FROM folders
            WHERE id = %s AND user_id = %s
            """,
            (folder_id, current_user["id"]),
        ),
        "folder not found",
    )


@router.patch("/{folder_id}", response_model=FolderRead)
def update_folder(
    folder_id: int,
    payload: FolderUpdate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    current = get_folder(folder_id, connection, current_user)
    return execute_returning(
        connection,
        """
        UPDATE folders
        SET name = %s, color = %s, updated_at = now()
        WHERE id = %s AND user_id = %s
        RETURNING id, name, color, created_at, updated_at
        """,
        (
            payload.name if payload.name is not None else current["name"],
            payload.color if payload.color is not None else current["color"],
            folder_id,
            current_user["id"],
        ),
    )


@router.delete("/{folder_id}", status_code=204)
def delete_folder(
    folder_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_folder(folder_id, connection, current_user)
    execute_commit(connection, "DELETE FROM folders WHERE id = %s AND user_id = %s", (folder_id, current_user["id"]))
