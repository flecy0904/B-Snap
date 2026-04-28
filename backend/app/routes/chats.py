from fastapi import APIRouter, Depends
from psycopg import Connection

from backend.app.db.crud import execute_commit, execute_returning, fetch_all, fetch_one, require_row
from backend.app.db.session import get_db_connection
from backend.app.core.config import get_settings
from backend.app.routes.notes import get_note
from backend.app.schemas.chats import (
    ChatAiMessageCreate,
    ChatAiMessageRead,
    ChatMessageCreate,
    ChatMessageRead,
    ChatSessionCreate,
    ChatSessionDetail,
    ChatSessionRead,
    ChatSessionUpdate,
)
from backend.app.services.openai_service import generate_note_chat_answer


router = APIRouter(tags=["chats"])


@router.post("/notes/{note_id}/chat-sessions", response_model=ChatSessionRead)
def create_chat_session(
    note_id: int,
    payload: ChatSessionCreate,
    connection: Connection = Depends(get_db_connection),
):
    get_note(note_id, connection)
    return execute_returning(
        connection,
        """
        INSERT INTO chat_sessions (note_id, title, model)
        VALUES (%s, %s, %s)
        RETURNING id, note_id, title, model, created_at, updated_at
        """,
        (note_id, payload.title, payload.model),
    )


@router.get("/notes/{note_id}/chat-sessions", response_model=list[ChatSessionRead])
def list_chat_sessions(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
):
    get_note(note_id, connection)
    return fetch_all(
        connection,
        """
        SELECT id, note_id, title, model, created_at, updated_at
        FROM chat_sessions
        WHERE note_id = %s
        ORDER BY updated_at DESC, id DESC
        """,
        (note_id,),
    )


@router.get("/chat-sessions", response_model=list[ChatSessionRead])
def list_all_chat_sessions(
    connection: Connection = Depends(get_db_connection),
):
    return fetch_all(
        connection,
        """
        SELECT id, note_id, title, model, created_at, updated_at
        FROM chat_sessions
        ORDER BY updated_at DESC, id DESC
        """,
    )


@router.get("/chat-sessions/{session_id}", response_model=ChatSessionDetail)
def get_chat_session(
    session_id: int,
    connection: Connection = Depends(get_db_connection),
):
    session = require_row(
        fetch_one(
            connection,
            """
            SELECT id, note_id, title, model, created_at, updated_at
            FROM chat_sessions
            WHERE id = %s
            """,
            (session_id,),
        ),
        "chat session not found",
    )
    session["messages"] = fetch_all(
        connection,
        """
        SELECT id, session_id, role, content, model, created_at
        FROM chat_messages
        WHERE session_id = %s
        ORDER BY created_at ASC, id ASC
        """,
        (session_id,),
    )
    return session


@router.patch("/chat-sessions/{session_id}", response_model=ChatSessionRead)
def update_chat_session(
    session_id: int,
    payload: ChatSessionUpdate,
    connection: Connection = Depends(get_db_connection),
):
    current = get_chat_session(session_id, connection)
    return execute_returning(
        connection,
        """
        UPDATE chat_sessions
        SET title = %s, model = %s, updated_at = now()
        WHERE id = %s
        RETURNING id, note_id, title, model, created_at, updated_at
        """,
        (
            payload.title if payload.title is not None else current["title"],
            payload.model if payload.model is not None else current["model"],
            session_id,
        ),
    )


@router.delete("/chat-sessions/{session_id}", status_code=204)
def delete_chat_session(
    session_id: int,
    connection: Connection = Depends(get_db_connection),
):
    get_chat_session(session_id, connection)
    execute_commit(connection, "DELETE FROM chat_sessions WHERE id = %s", (session_id,))


@router.post("/chat-sessions/{session_id}/messages", response_model=ChatMessageRead)
def create_chat_message(
    session_id: int,
    payload: ChatMessageCreate,
    connection: Connection = Depends(get_db_connection),
):
    get_chat_session(session_id, connection)
    message = execute_returning(
        connection,
        """
        INSERT INTO chat_messages (session_id, role, content, model)
        VALUES (%s, %s, %s, %s)
        RETURNING id, session_id, role, content, model, created_at
        """,
        (session_id, payload.role, payload.content, payload.model),
    )
    execute_commit(connection, "UPDATE chat_sessions SET updated_at = now() WHERE id = %s", (session_id,))
    return message


@router.post("/chat-sessions/{session_id}/ai-messages", response_model=ChatAiMessageRead)
def create_ai_chat_message(
    session_id: int,
    payload: ChatAiMessageCreate,
    connection: Connection = Depends(get_db_connection),
):
    session = get_chat_session(session_id, connection)
    note = get_note(session["note_id"], connection)
    pages = fetch_all(
        connection,
        """
        SELECT id, note_id, page_number, content, image_url, created_at, updated_at
        FROM note_pages
        WHERE note_id = %s
        ORDER BY page_number ASC, id ASC
        """,
        (session["note_id"],),
    )
    previous_messages = fetch_all(
        connection,
        """
        SELECT id, session_id, role, content, model, created_at
        FROM chat_messages
        WHERE session_id = %s
        ORDER BY created_at ASC, id ASC
        """,
        (session_id,),
    )
    model = payload.model or session.get("model") or get_settings().openai_default_model

    answer = generate_note_chat_answer(
        model=model,
        note=note,
        pages=pages,
        messages=previous_messages,
        user_content=payload.content,
    )
    user_message = execute_returning(
        connection,
        """
        INSERT INTO chat_messages (session_id, role, content, model)
        VALUES (%s, 'user', %s, %s)
        RETURNING id, session_id, role, content, model, created_at
        """,
        (session_id, payload.content, model),
    )
    assistant_message = execute_returning(
        connection,
        """
        INSERT INTO chat_messages (session_id, role, content, model)
        VALUES (%s, 'assistant', %s, %s)
        RETURNING id, session_id, role, content, model, created_at
        """,
        (session_id, answer, model),
    )
    execute_commit(connection, "UPDATE chat_sessions SET model = %s, updated_at = now() WHERE id = %s", (model, session_id))
    return {
        "model": model,
        "user_message": user_message,
        "assistant_message": assistant_message,
    }


@router.get("/chat-sessions/{session_id}/messages", response_model=list[ChatMessageRead])
def list_chat_messages(
    session_id: int,
    connection: Connection = Depends(get_db_connection),
):
    get_chat_session(session_id, connection)
    return fetch_all(
        connection,
        """
        SELECT id, session_id, role, content, model, created_at
        FROM chat_messages
        WHERE session_id = %s
        ORDER BY created_at ASC, id ASC
        """,
        (session_id,),
    )
