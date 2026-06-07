from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection
from psycopg.types.json import Jsonb

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
from backend.app.services.openai_service import (
    generate_ai_canvas_intent,
    generate_ai_canvas_operations_from_chat,
    generate_ai_canvas_title,
    generate_chat_title,
    generate_note_chat_answer,
)
from backend.app.services.rag_service import ask_with_hybrid_rag, build_hybrid_rag_context_hint, load_note_documents


router = APIRouter(tags=["chats"])

MAX_AI_CANVAS_NOTES_PER_NOTE = 3
DEFAULT_CANVAS_TITLE = "Canvas Note"
DEFAULT_CANVAS_MARKDOWN = ""
DEFAULT_CANVAS_DOCUMENT_JSON = {"type": "doc", "content": []}

CANVAS_TARGET_KEYWORDS = (
    "canvas",
    "캔버스",
    "정리노트",
    "정리 노트",
)
CANVAS_EDIT_KEYWORDS = (
    "add",
    "rewrite",
    "revise",
    "shorten",
    "lengthen",
    "simplify",
    "polish",
    "delete",
    "remove",
    "정리",
    "요약",
    "추가",
    "반영",
    "작성",
    "넣어",
    "적어",
    "수정",
    "고쳐",
    "만들",
    "다듬",
    "바꿔",
    "바꾸",
    "변경",
    "줄여",
    "줄이",
    "짧게",
    "늘려",
    "길게",
    "쉽게",
    "전문적",
    "삭제",
    "빼줘",
)
CANVAS_EXPLICIT_EDIT_KEYWORDS = (
    "rewrite",
    "revise",
    "shorten",
    "lengthen",
    "simplify",
    "polish",
    "delete",
    "remove",
    "고쳐줘",
    "고쳐 줘",
    "수정해",
    "수정해줘",
    "수정해 줘",
    "다듬어",
    "다듬어줘",
    "다듬어 줘",
    "바꿔",
    "바꿔줘",
    "바꿔 줘",
    "변경해",
    "변경해줘",
    "변경해 줘",
    "줄여",
    "줄여줘",
    "줄여 줘",
    "짧게",
    "늘려",
    "늘려줘",
    "늘려 줘",
    "길게",
    "쉽게",
    "전문적",
    "삭제해",
    "삭제해줘",
    "삭제해 줘",
    "빼줘",
    "빼 줘",
    "추가해",
    "추가해줘",
    "추가해 줘",
    "넣어",
    "넣어줘",
    "넣어 줘",
)
CANVAS_EXPLANATION_KEYWORDS = (
    "what",
    "why",
    "how",
    "explain",
    "meaning",
    "definition",
    "이유",
    "왜",
    "어떻게",
    "무슨",
    "뭐야",
    "뭔지",
    "뜻",
    "의미",
    "설명",
    "알려줘",
    "알려 줘",
    "이해",
    "해석",
    "정의",
    "예시",
)
CANVAS_CREATE_KEYWORDS = (
    "new canvas",
    "새 canvas",
    "새 캔버스",
    "새로운 canvas",
    "새로운 캔버스",
    "별도 canvas",
    "별도 캔버스",
    "다른 canvas",
    "다른 캔버스",
    "새 정리본",
    "새 요약본",
    "새 정리 노트",
    "새 노트",
)


def keyword_canvas_action(content: str, *, target_implied: bool = False) -> str | None:
    normalized = content.lower()
    if any(keyword in normalized for keyword in CANVAS_CREATE_KEYWORDS):
        return "canvas_create"

    has_canvas_target = any(keyword in normalized for keyword in CANVAS_TARGET_KEYWORDS)
    has_canvas_edit = any(keyword in normalized for keyword in CANVAS_EDIT_KEYWORDS)
    has_explicit_edit = any(keyword in normalized for keyword in CANVAS_EXPLICIT_EDIT_KEYWORDS)
    has_explanation = any(keyword in normalized for keyword in CANVAS_EXPLANATION_KEYWORDS)
    if target_implied and has_explicit_edit and not has_explanation:
        return "canvas_edit"
    if has_canvas_target and has_canvas_edit:
        return "canvas_edit"
    return None


def resolve_canvas_action(
    content: str,
    requested_action: str,
    model: str,
    *,
    canvas_origin_request: bool = False,
    canvas_block_context: dict | None = None,
) -> str:
    if requested_action in {"chat_only", "canvas_edit", "canvas_create"}:
        return requested_action

    keyword_action = keyword_canvas_action(content, target_implied=canvas_origin_request)
    if keyword_action:
        return keyword_action

    if canvas_origin_request:
        try:
            return generate_ai_canvas_intent(
                model=model,
                user_content=content,
                canvas_block_context=canvas_block_context,
            )
        except Exception:
            return "chat_only"

    return "chat_only"


def get_canvas_note_for_chat(canvas_note_id: int, note_id: int, connection: Connection) -> dict:
    return require_row(
        fetch_one(
            connection,
            """
            SELECT id, folder_id, note_id, title, markdown, document_json, revision, source_page_start, source_page_end, created_at, updated_at
            FROM ai_canvas_notes
            WHERE id = %s AND note_id = %s
            """,
            (canvas_note_id, note_id),
        ),
        "AI canvas note not found",
    )


def create_canvas_note_for_chat(note: dict, connection: Connection) -> dict:
    count_row = fetch_one(
        connection,
        "SELECT COUNT(*) AS count FROM ai_canvas_notes WHERE note_id = %s",
        (note["id"],),
    )
    if count_row and count_row["count"] >= MAX_AI_CANVAS_NOTES_PER_NOTE:
        raise HTTPException(
            status_code=409,
            detail=f"AI Canvas Notes are limited to {MAX_AI_CANVAS_NOTES_PER_NOTE} per note",
        )

    return execute_returning(
        connection,
        """
        INSERT INTO ai_canvas_notes (folder_id, note_id, title, markdown, document_json, source_page_start, source_page_end)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
        RETURNING id, folder_id, note_id, title, markdown, document_json, revision, source_page_start, source_page_end, created_at, updated_at
        """,
        (
            note["folder_id"],
            note["id"],
            DEFAULT_CANVAS_TITLE,
            DEFAULT_CANVAS_MARKDOWN,
            Jsonb(DEFAULT_CANVAS_DOCUMENT_JSON),
            None,
            None,
        ),
    )


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
        SELECT id, session_id, role, content, COALESCE(source, 'chat') AS source, model, created_at
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
        INSERT INTO chat_messages (session_id, role, content, source, model)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id, session_id, role, content, COALESCE(source, 'chat') AS source, model, created_at
        """,
        (session_id, payload.role, payload.content, payload.source, payload.model),
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
        SELECT id, session_id, role, content, COALESCE(source, 'chat') AS source, model, created_at
        FROM chat_messages
        WHERE session_id = %s
          AND COALESCE(source, 'chat') <> 'canvas-mini'
        ORDER BY created_at ASC, id ASC
        """,
        (session_id,),
    )
    model = payload.model or session.get("model") or get_settings().default_ai_model
    canvas_edit = None
    canvas_note = None
    created_canvas_note = False
    canvas_origin_request = payload.source in {"canvas-mini", "canvas-block"}
    canvas_action = resolve_canvas_action(
        payload.content,
        payload.canvas_action,
        model,
        canvas_origin_request=canvas_origin_request,
        canvas_block_context=payload.canvas_block_context,
    )

    if canvas_origin_request and canvas_action == "canvas_create":
        canvas_action = "chat_only"

    if canvas_action in {"canvas_edit", "canvas_create"}:
        if canvas_origin_request and not payload.canvas_note_id:
            canvas_action = "chat_only"
        elif canvas_action == "canvas_create" or not payload.canvas_note_id:
            canvas_note = create_canvas_note_for_chat(note, connection)
            created_canvas_note = True
            canvas_action = "canvas_create"
        else:
            canvas_note = get_canvas_note_for_chat(payload.canvas_note_id, session["note_id"], connection)

    if canvas_action in {"canvas_edit", "canvas_create"} and canvas_note is not None:
        try:
            context_pages = select_chat_context_pages(pages, payload.page_number)
            current_canvas_markdown = (
                payload.canvas_markdown
                if canvas_action == "canvas_edit" and payload.canvas_markdown is not None
                else canvas_note["markdown"]
            )
            current_canvas_document_json = (
                payload.canvas_document_json
                if canvas_action == "canvas_edit" and payload.canvas_document_json is not None
                else canvas_note["document_json"]
            )
            operations = generate_ai_canvas_operations_from_chat(
                model=model,
                note=note,
                pages=context_pages,
                messages=previous_messages,
                user_content=payload.content,
                canvas_title=canvas_note["title"],
                canvas_markdown=current_canvas_markdown,
                canvas_document_json=current_canvas_document_json,
                current_page_number=payload.page_number,
                selection_image=payload.selection_image,
                selection_image_url=payload.selection_image_url,
                canvas_block_context=payload.canvas_block_context,
            )
            canvas_title = canvas_note["title"]
            if canvas_action == "canvas_create" or payload.canvas_note_needs_title:
                try:
                    canvas_title = generate_ai_canvas_title(
                        model=model,
                        note=note,
                        user_content=payload.content,
                        canvas_markdown=current_canvas_markdown,
                    )
                except Exception:
                    canvas_title = canvas_note["title"]

            if canvas_title != canvas_note["title"]:
                canvas_note = execute_returning(
                    connection,
                    """
                    UPDATE ai_canvas_notes
                    SET title = %s, updated_at = now()
                    WHERE id = %s
                    RETURNING id, folder_id, note_id, title, markdown, document_json, revision, source_page_start, source_page_end, created_at, updated_at
                    """,
                    (
                        canvas_title,
                        canvas_note["id"],
                    ),
                )
        except Exception:
            if created_canvas_note:
                try:
                    execute_commit(connection, "DELETE FROM ai_canvas_notes WHERE id = %s", (canvas_note["id"],))
                except Exception:
                    pass
            raise
        answer = (
            "새 Canvas를 만들고 반영했습니다. Canvas 패널에서 확인해 주세요."
            if canvas_action == "canvas_create"
            else "Canvas에 반영했습니다."
        )
        canvas_edit = {
            "action": canvas_action,
            "canvas_note_id": canvas_note["id"],
            "title": canvas_note["title"],
            "canvas_note": canvas_note,
            "operations": operations,
        }
    elif payload.use_rag:
        documents = load_note_documents(connection, note_ids=[session["note_id"]], user_id=current_user["id"])
        answer = ask_with_hybrid_rag(
            connection,
            user_id=current_user["id"],
            question=payload.content,
            documents=documents,
            note_ids=[session["note_id"]],
            top_k=payload.top_k,
            model=model,
        ).answer
    else:
        context_pages = select_chat_context_pages(pages, payload.page_number)
        documents = load_note_documents(connection, note_ids=[session["note_id"]], user_id=current_user["id"])
        rag_context_hint = build_hybrid_rag_context_hint(
            connection,
            user_id=current_user["id"],
            question=payload.content,
            documents=documents,
            note_ids=[session["note_id"]],
            top_k=payload.top_k,
        )
        context_hint = "\n\n".join(
            hint
            for hint in [payload.context_hint, rag_context_hint]
            if hint
        ) or None
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
            context_hint=context_hint,
            canvas_block_context=payload.canvas_block_context,
        )
    user_message = execute_returning(
        connection,
        """
        INSERT INTO chat_messages (session_id, role, content, source, model)
        VALUES (%s, 'user', %s, %s, %s)
        RETURNING id, session_id, role, content, COALESCE(source, 'chat') AS source, model, created_at
        """,
        (session_id, payload.content, payload.source, model),
    )
    assistant_message = execute_returning(
        connection,
        """
        INSERT INTO chat_messages (session_id, role, content, source, model)
        VALUES (%s, 'assistant', %s, %s, %s)
        RETURNING id, session_id, role, content, COALESCE(source, 'chat') AS source, model, created_at
        """,
        (session_id, answer, payload.source, model),
    )
    updated_session = None
    if payload.source != "canvas-mini" and not previous_messages:
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
        "canvas_edit": canvas_edit,
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
        SELECT id, session_id, role, content, COALESCE(source, 'chat') AS source, model, created_at
        FROM chat_messages
        WHERE session_id = %s
        ORDER BY created_at ASC, id ASC
        """,
        (session_id,),
    )
