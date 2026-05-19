from fastapi import APIRouter, Depends
from psycopg import Connection

from backend.app.core.auth import get_current_user
from backend.app.db.crud import execute_commit, execute_returning, fetch_all, fetch_one, require_row
from backend.app.db.session import get_db_connection
from backend.app.core.config import get_settings
from backend.app.routes.notes import get_note_for_user
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
from backend.app.services.openai_service import generate_chat_title, generate_note_chat_answer
from backend.app.services.rag_service import ask_with_rag, load_note_documents


router = APIRouter(tags=["chats"])


def select_chat_context_pages(pages: list[dict], page_number: int | None) -> list[dict]:
    if not pages:
        return []
    if page_number is None:
        return pages[:3]

    start_page = max(1, page_number - 1)
    end_page = page_number + 1
    selected_pages = [
        page
        for page in pages
        if start_page <= page["page_number"] <= end_page
    ]
    return selected_pages or pages[:3]


@router.post("/notes/{note_id}/chat-sessions", response_model=ChatSessionRead)
def create_chat_session(
    note_id: int,
    payload: ChatSessionCreate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
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
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
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
    current_user: dict = Depends(get_current_user),
):
    return fetch_all(
        connection,
        """
        SELECT s.id, s.note_id, s.title, s.model, s.created_at, s.updated_at
        FROM chat_sessions s
        JOIN notes n ON n.id = s.note_id
        WHERE n.user_id = %s
        ORDER BY s.updated_at DESC, s.id DESC
        """,
        (current_user["id"],),
    )


@router.get("/chat-sessions/{session_id}", response_model=ChatSessionDetail)
def get_chat_session(
    session_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    session = require_row(
        fetch_one(
            connection,
            """
            SELECT s.id, s.note_id, s.title, s.model, s.created_at, s.updated_at
            FROM chat_sessions s
            JOIN notes n ON n.id = s.note_id
            WHERE s.id = %s AND n.user_id = %s
            """,
            (session_id, current_user["id"]),
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
    current_user: dict = Depends(get_current_user),
):
    current = get_chat_session(session_id, connection, current_user)
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
    current_user: dict = Depends(get_current_user),
):
    get_chat_session(session_id, connection, current_user)
    execute_commit(connection, "DELETE FROM chat_sessions WHERE id = %s", (session_id,))


@router.post("/chat-sessions/{session_id}/messages", response_model=ChatMessageRead)
def create_chat_message(
    session_id: int,
    payload: ChatMessageCreate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_chat_session(session_id, connection, current_user)
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
    current_user: dict = Depends(get_current_user),
):
    session = get_chat_session(session_id, connection, current_user)
    note = get_note_for_user(session["note_id"], current_user["id"], connection)
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
    model = payload.model or session.get("model") or get_settings().default_ai_model

    if payload.use_rag:
        documents = load_note_documents(connection, note_ids=[session["note_id"]], user_id=current_user["id"])
        answer = ask_with_rag(
            question=payload.content,
            documents=documents,
            top_k=payload.top_k,
            model=model,
        ).answer
    else:
        context_pages = select_chat_context_pages(pages, payload.page_number)
        answer = generate_note_chat_answer(
            model=model,
            note=note,
            pages=context_pages,
            messages=previous_messages,
            user_content=payload.content,
            selection_image=payload.selection_image,
            selection_rect=payload.selection_rect.model_dump() if payload.selection_rect else None,
            page_number=payload.page_number,
            selection_image_url=payload.selection_image_url,
            context_hint=payload.context_hint,
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
    updated_session = None
    if not previous_messages:
        generated_title = None
        try:
            generated_title = generate_chat_title(
                model=model,
                note=note,
                user_content=payload.content,
                assistant_content=answer,
            )
        except Exception:
            generated_title = None
        if generated_title:
            updated_session = execute_returning(
                connection,
                """
                UPDATE chat_sessions
                SET title = %s, model = %s, updated_at = now()
                WHERE id = %s
                RETURNING id, note_id, title, model, created_at, updated_at
                """,
                (generated_title, model, session_id),
            )

    if updated_session is None:
        execute_commit(connection, "UPDATE chat_sessions SET model = %s, updated_at = now() WHERE id = %s", (model, session_id))
    return {
        "model": model,
        "user_message": user_message,
        "assistant_message": assistant_message,
        "chat_session": updated_session,
    }


@router.get("/chat-sessions/{session_id}/messages", response_model=list[ChatMessageRead])
def list_chat_messages(
    session_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_chat_session(session_id, connection, current_user)
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
