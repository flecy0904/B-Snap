import re

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
from backend.app.services.ai_context_builder import (
    build_ai_context,
    format_context_mode_instruction,
    select_rag_context_pages,
)
from backend.app.services.ai_context_router import AiContextRoute, route_ai_context
from backend.app.services.ai_page_references import resolve_context_page_number
from backend.app.services.openai_service import (
    CANVAS_RECENT_MESSAGE_LIMIT,
    CHAT_RECENT_MESSAGE_LIMIT,
    CANVAS_RECOMMENDATION_MODE_MEANINGS,
    generate_ai_canvas_intent,
    generate_ai_canvas_operations_from_chat,
    generate_ai_canvas_title,
    generate_chat_session_summary,
    generate_chat_title,
    generate_note_chat_answer,
)
from backend.app.services.docling_batch_pipeline import note_rag_text_ready
from backend.app.services.pdf_image_recheck import ImageRecheckResult, maybe_recheck_pdf_images_for_chat
from backend.app.services.rag_service import (
    load_page_local_rag_contexts,
    merge_retrieved_contexts,
    retrieve_rag_contexts_with_debug,
    update_rag_debug_for_contexts,
)


router = APIRouter(tags=["chats"])

MAX_AI_CANVAS_NOTES_PER_NOTE = 3
DEFAULT_CANVAS_TITLE = "Canvas Note"
DEFAULT_CANVAS_MARKDOWN = ""
DEFAULT_CANVAS_DOCUMENT_JSON = {"type": "doc", "content": []}
RAG_SEARCH_UNAVAILABLE_MESSAGE = "지금은 자료 검색을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
RAG_NO_RESULTS_MESSAGE = "관련된 자료를 찾지 못했습니다."
RAG_TEXT_PROCESSING_MESSAGE = "자료를 읽는 중입니다. 잠시 후 다시 질문해 주세요."
EMPTY_RAG_SCOPE_MATERIAL_HINT = (
    "No pinned reference materials are selected for this chat. "
    "If the user asks about this PDF, this note, selected course material, pages, or searching in materials, "
    "say briefly in Korean that no reference material is selected, so material-specific verification is unavailable. "
    "Then answer generally only when a general answer is useful."
)
MATERIAL_REFERENCE_KEYWORDS = (
    "pdf",
    "문서",
    "자료",
    "노트",
    "페이지",
    "쪽",
    "강의",
    "수업",
    "과목",
    "교수님",
    "시험 범위",
    "중요 페이지",
    "찾아",
    "검색",
    "여기",
    "이 부분",
    "보이는",
    "현재 화면",
)
DEFAULT_CANVAS_TITLE_RE = re.compile(r"^Canvas Note(?:\s+\d+)?$")
CANVAS_PAGE_FALLBACK_TITLE_RE = re.compile(r"^p\.\d+(?:-\d+)?\s+메모$")
GENERIC_CANVAS_TITLES = {
    DEFAULT_CANVAS_TITLE,
    "AI Canvas",
    "Canvas",
    "캔버스",
    "정리",
    "요약",
    "현재 페이지",
    "정리 보강",
}
CANVAS_EVIDENCE_RECOMMENDATION_MODES = {"expand", "mark_uncertain"}

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


def build_default_canvas_title(index: int | None = None) -> str:
    return f"{DEFAULT_CANVAS_TITLE} {index}" if index else DEFAULT_CANVAS_TITLE


def is_default_canvas_title(title: str | None) -> bool:
    normalized = " ".join((title or "").split()).strip()
    if not normalized:
        return True
    if DEFAULT_CANVAS_TITLE_RE.match(normalized):
        return True
    return bool(CANVAS_PAGE_FALLBACK_TITLE_RE.match(normalized))


def extract_canvas_node_text(value: object) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(part for item in value if (part := extract_canvas_node_text(item)))
    if not isinstance(value, dict):
        return ""

    parts: list[str] = []
    text = value.get("text")
    if isinstance(text, str):
        parts.append(text)

    for key in ("content", "node"):
        nested_text = extract_canvas_node_text(value.get(key))
        if nested_text:
            parts.append(nested_text)

    return "\n".join(parts)


def extract_canvas_operations_text(operations: object) -> str:
    if not isinstance(operations, list):
        return ""

    parts: list[str] = []
    for operation in operations:
        if not isinstance(operation, dict):
            text = extract_canvas_node_text(operation)
            if text:
                parts.append(text)
            continue

        for key in ("node", "content", "text"):
            text = extract_canvas_node_text(operation.get(key))
            if text:
                parts.append(text)

    return "\n".join(" ".join(part.split()) for part in parts if part.strip())[:4000]


def normalize_generated_canvas_title(title: str | None, fallback_title: str | None = None) -> str:
    normalized = " ".join((title or "").replace("\n", " ").split()).strip()
    normalized = normalized.strip("\"'`“”‘’[](){}")
    fallback = " ".join(str(fallback_title or DEFAULT_CANVAS_TITLE).replace("\n", " ").split()).strip()
    fallback = fallback.strip("\"'`“”‘’[](){}") or DEFAULT_CANVAS_TITLE
    if CANVAS_PAGE_FALLBACK_TITLE_RE.match(fallback):
        fallback = DEFAULT_CANVAS_TITLE
    if not normalized or normalized in GENERIC_CANVAS_TITLES or is_default_canvas_title(normalized):
        return fallback[:30]
    return normalized[:30]


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
    existing_count = int(count_row["count"] if count_row else 0)
    if existing_count >= MAX_AI_CANVAS_NOTES_PER_NOTE:
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
            build_default_canvas_title(existing_count + 1),
            DEFAULT_CANVAS_MARKDOWN,
            Jsonb(DEFAULT_CANVAS_DOCUMENT_JSON),
            None,
            None,
        ),
    )


def select_chat_context_pages(pages: list[dict], page_number: int | None) -> list[dict]:
    return select_rag_context_pages(pages, page_number)


def default_rag_scope(note: dict) -> dict:
    return {
        "sourceIds": [f"note:{note['id']}"],
        "sources": [{
            "id": str(note["id"]),
            "type": "note",
            "title": str(note["title"]),
        }],
    }


def _scope_to_dict(scope: object | None) -> dict | None:
    if scope is None:
        return None
    if hasattr(scope, "model_dump"):
        return scope.model_dump()
    return scope if isinstance(scope, dict) else None


def normalize_rag_scope(
    connection: Connection,
    *,
    requested_scope: object | None,
    default_note: dict,
    user_id: int,
) -> dict:
    raw_scope = _scope_to_dict(requested_scope) or {}
    if requested_scope is None:
        return default_rag_scope(default_note)
    raw_sources = raw_scope.get("sources")
    if not isinstance(raw_sources, list):
        return default_rag_scope(default_note)

    note_ids: list[int] = []
    canvas_note_ids: list[int] = []
    for raw_source in raw_sources:
        if not isinstance(raw_source, dict):
            continue
        source_type = raw_source.get("type")
        try:
            source_id = int(str(raw_source.get("id")))
        except (TypeError, ValueError):
            continue
        if source_type == "note":
            note_ids.append(source_id)
        elif source_type == "canvas_note":
            canvas_note_ids.append(source_id)

    note_rows = []
    if note_ids:
        note_rows = fetch_all(
            connection,
            """
            SELECT id, title
            FROM notes
            WHERE user_id = %s
              AND folder_id = %s
              AND id = ANY(%s)
            """,
            (user_id, default_note["folder_id"], note_ids),
        )
    canvas_rows = []
    if canvas_note_ids:
        canvas_rows = fetch_all(
            connection,
            """
            SELECT c.id, c.title, n.title AS note_title
            FROM ai_canvas_notes c
            JOIN notes n ON n.id = c.note_id
            WHERE n.user_id = %s
              AND c.folder_id = %s
              AND c.id = ANY(%s)
            """,
            (user_id, default_note["folder_id"], canvas_note_ids),
        )

    notes_by_id = {int(row["id"]): row for row in note_rows}
    canvas_by_id = {int(row["id"]): row for row in canvas_rows}
    sources = []
    seen: set[str] = set()
    for raw_source in raw_sources:
        if not isinstance(raw_source, dict):
            continue
        source_type = raw_source.get("type")
        try:
            source_id = int(str(raw_source.get("id")))
        except (TypeError, ValueError):
            continue
        key = f"{source_type}:{source_id}"
        if key in seen:
            continue
        if source_type == "note" and source_id in notes_by_id:
            seen.add(key)
            sources.append({"id": str(source_id), "type": "note", "title": str(notes_by_id[source_id]["title"])})
        elif source_type == "canvas_note" and source_id in canvas_by_id:
            canvas = canvas_by_id[source_id]
            seen.add(key)
            sources.append({
                "id": str(source_id),
                "type": "canvas_note",
                "title": f"{canvas['note_title']} - {canvas['title']}",
            })

    return {
        "sourceIds": [f"{source['type']}:{source['id']}" for source in sources],
        "sources": sources,
    }


def rag_scope_search_targets(scope: dict) -> tuple[list[int], list[int]]:
    note_ids: list[int] = []
    canvas_note_ids: list[int] = []
    for source in scope.get("sources", []):
        if not isinstance(source, dict):
            continue
        try:
            source_id = int(str(source.get("id")))
        except (TypeError, ValueError):
            continue
        if source.get("type") == "note":
            note_ids.append(source_id)
        elif source.get("type") == "canvas_note":
            canvas_note_ids.append(source_id)
    return note_ids, canvas_note_ids


def rag_scope_titles(scope: dict) -> list[str]:
    titles: list[str] = []
    seen: set[str] = set()
    for source in scope.get("sources", []):
        if not isinstance(source, dict):
            continue
        title = " ".join(str(source.get("title") or "").split()).strip()
        if title and title not in seen:
            titles.append(title)
            seen.add(title)
    return titles


def get_note_course_name(connection: Connection, note: dict, user_id: int) -> str | None:
    folder_id = note.get("folder_id")
    if folder_id is None:
        return None
    row = fetch_one(
        connection,
        "SELECT name FROM folders WHERE id = %s AND user_id = %s",
        (folder_id, user_id),
    )
    if not isinstance(row, dict):
        return None
    name = " ".join(str(row.get("name") or "").split()).strip()
    return name or None


def material_reference_scope_hint(question: str, *, has_empty_scope: bool) -> str | None:
    if not has_empty_scope:
        return None
    normalized = question.lower()
    if any(keyword in normalized for keyword in MATERIAL_REFERENCE_KEYWORDS):
        return EMPTY_RAG_SCOPE_MATERIAL_HINT
    if re.search(r"(?<!\d)\d{1,4}\s*(?:페이지|쪽)", normalized):
        return EMPTY_RAG_SCOPE_MATERIAL_HINT
    return None


def get_rag_failure_answer(debug: dict | None, *, has_local_context: bool) -> str | None:
    if has_local_context or not debug:
        return None
    if debug.get("rag_unavailable"):
        return RAG_SEARCH_UNAVAILABLE_MESSAGE
    if debug.get("no_results"):
        return RAG_NO_RESULTS_MESSAGE
    return None


def maybe_update_chat_session_summary(
    connection: Connection,
    *,
    session: dict,
    messages: list[dict],
    model: str,
    recent_message_limit: int,
) -> str | None:
    eligible_messages = [
        message
        for message in messages
        if message.get("role") in {"user", "assistant"} and str(message.get("content") or "").strip()
    ]
    if len(eligible_messages) <= recent_message_limit:
        return session.get("summary")

    older_messages = eligible_messages[:-recent_message_limit]
    if not older_messages:
        return session.get("summary")

    previous_summary = session.get("summary")
    summarized_message_id = session.get("summarized_message_id")
    latest_older_message_id = older_messages[-1]["id"]
    if summarized_message_id is not None and summarized_message_id >= latest_older_message_id:
        return previous_summary

    if summarized_message_id is None:
        messages_to_summarize = older_messages
    else:
        messages_to_summarize = [
            message
            for message in older_messages
            if message["id"] > summarized_message_id
        ]
    if not messages_to_summarize:
        return previous_summary

    try:
        next_summary = generate_chat_session_summary(
            model=model,
            previous_summary=previous_summary,
            messages=messages_to_summarize,
        )
    except Exception:
        return previous_summary

    if not next_summary:
        return previous_summary

    execute_commit(
        connection,
        """
        UPDATE chat_sessions
        SET summary = %s,
            summarized_message_id = %s,
            summary_updated_at = now(),
            updated_at = now()
        WHERE id = %s
        """,
        (next_summary, latest_older_message_id, session["id"]),
    )
    session["summary"] = next_summary
    session["summarized_message_id"] = latest_older_message_id
    return next_summary


def select_current_page_context_pages(pages: list[dict], page_number: int | None) -> list[dict]:
    if not pages:
        return []
    if page_number is None:
        return pages[:1]
    selected_pages = [page for page in pages if page["page_number"] == page_number]
    return selected_pages or pages[:1]


def select_ai_canvas_context_pages(
    pages: list[dict],
    page_number: int | None,
    *,
    canvas_markdown: str | None,
    canvas_document_json: object,
    canvas_recommendation_mode: str | None,
    has_selection_image: bool = False,
) -> list[dict]:
    if canvas_recommendation_mode not in CANVAS_RECOMMENDATION_MODE_MEANINGS:
        return select_chat_context_pages(pages, page_number)

    canvas_text = "\n".join(
        part
        for part in [
            canvas_markdown or "",
            extract_canvas_node_text(canvas_document_json),
        ]
        if part.strip()
    )
    if has_selection_image or not canvas_text.strip() or canvas_recommendation_mode in CANVAS_EVIDENCE_RECOMMENDATION_MODES:
        return select_current_page_context_pages(pages, page_number)
    return []


def select_ai_canvas_messages(messages: list[dict], canvas_recommendation_mode: str | None) -> list[dict]:
    if canvas_recommendation_mode in CANVAS_RECOMMENDATION_MODE_MEANINGS:
        return []
    return messages


@router.post("/notes/{note_id}/chat-sessions", response_model=ChatSessionRead)
def create_chat_session(
    note_id: int,
    payload: ChatSessionCreate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    note = get_note_for_user(note_id, current_user["id"], connection)
    rag_scope = normalize_rag_scope(
        connection,
        requested_scope=payload.rag_scope,
        default_note=note,
        user_id=current_user["id"],
    )
    return execute_returning(
        connection,
        """
        INSERT INTO chat_sessions (note_id, title, model, rag_scope)
        VALUES (%s, %s, %s, %s)
        RETURNING id, note_id, title, model, rag_scope, created_at, updated_at
        """,
        (note_id, payload.title, payload.model, Jsonb(rag_scope)),
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
        SELECT id, note_id, title, model, rag_scope, created_at, updated_at
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
        SELECT s.id, s.note_id, s.title, s.model, s.rag_scope, s.created_at, s.updated_at
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
            SELECT s.id, s.note_id, s.title, s.model, s.rag_scope, s.created_at, s.updated_at,
                   s.summary, s.summarized_message_id, s.summary_updated_at
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
        SET title = %s, model = %s, rag_scope = %s, updated_at = now()
        WHERE id = %s
        RETURNING id, note_id, title, model, rag_scope, created_at, updated_at
        """,
        (
            payload.title if payload.title is not None else current["title"],
            payload.model if payload.model is not None else current["model"],
            Jsonb(
                normalize_rag_scope(
                    connection,
                    requested_scope=payload.rag_scope if payload.rag_scope is not None else current.get("rag_scope"),
                    default_note=get_note_for_user(current["note_id"], current_user["id"], connection),
                    user_id=current_user["id"],
                )
            ),
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
    effective_page_number, page_reference_debug = resolve_context_page_number(
        question=payload.content,
        payload_page_number=payload.page_number,
        available_pages=pages,
    )
    has_selection_context = bool(payload.selection_image or payload.selection_image_url or payload.selection_rect)
    rag_scope = normalize_rag_scope(
        connection,
        requested_scope=payload.rag_scope if payload.rag_scope is not None else session.get("rag_scope"),
        default_note=note,
        user_id=current_user["id"],
    )
    if rag_scope != (session.get("rag_scope") or None):
        execute_commit(
            connection,
            "UPDATE chat_sessions SET rag_scope = %s, updated_at = now() WHERE id = %s",
            (Jsonb(rag_scope), session_id),
        )
        session["rag_scope"] = rag_scope

    empty_scope_hint = material_reference_scope_hint(
        payload.content,
        has_empty_scope=not bool(rag_scope.get("sources")),
    )
    if not rag_scope.get("sources"):
        context_route = AiContextRoute(
            mode="general",
            rewritten_query="",
            reason="empty_rag_scope",
        )
    else:
        context_route = route_ai_context(
            question=payload.content,
            model=model,
            course_name=get_note_course_name(connection, note, current_user["id"]),
            document_title=str(note.get("title") or ""),
            pinned_reference_titles=rag_scope_titles(rag_scope),
            has_selection=has_selection_context,
        )

    if rag_scope.get("sources") and payload.use_rag and context_route.mode == "general":
        context_route = AiContextRoute(
            mode="rag",
            rewritten_query=context_route.rewritten_query or payload.content,
            reason="explicit_use_rag",
        )
    rag_sources = []
    rag_debug = None
    rag_processing_answer = None
    image_recheck = ImageRecheckResult()
    if context_route.mode == "rag":
        note_ids, canvas_note_ids = rag_scope_search_targets(rag_scope)
        text_ready, pending_job = note_rag_text_ready(connection, note_ids=note_ids, user_id=current_user["id"])
        if not text_ready:
            rag_debug = {
                "fallback": True,
                "fallback_reason": "text_processing",
                "retrieved_source_count": 0,
                "retrieved_chunk_count": 0,
                "rag_job": pending_job,
            }
            rag_processing_answer = RAG_TEXT_PROCESSING_MESSAGE
        else:
            rag_sources, rag_debug = retrieve_rag_contexts_with_debug(
                connection,
                user_id=current_user["id"],
                question=context_route.rewritten_query,
                note_ids=note_ids,
                canvas_note_ids=canvas_note_ids,
                exclude_canvas_for_notes=True,
                documents=None,
                top_k=payload.top_k,
            )
            page_local_contexts = (
                load_page_local_rag_contexts(
                    connection,
                    user_id=current_user["id"],
                    note_ids=note_ids,
                    page_number=effective_page_number,
                )
                if effective_page_number is not None
                and (
                    context_route.reason in {"explicit_page_reference", "current_context_keyword"}
                    or page_reference_debug.get("explicit_page_number") is not None
                )
                else []
            )
            if page_local_contexts:
                rag_sources = merge_retrieved_contexts(page_local_contexts, rag_sources)
                rag_debug = rag_debug or {}
                update_rag_debug_for_contexts(rag_debug, rag_sources, page_local_contexts=page_local_contexts)
    preliminary_context_pages = [] if context_route.mode == "general" else select_rag_context_pages(pages, effective_page_number)
    rag_failure_answer = get_rag_failure_answer(
        rag_debug,
        has_local_context=bool(
            has_selection_context
            or payload.context_hint
            or payload.canvas_block_context
            or preliminary_context_pages
        ),
    )
    if rag_failure_answer:
        canvas_action = "chat_only"
    if rag_processing_answer:
        canvas_action = "chat_only"

    if canvas_origin_request and canvas_action == "canvas_create":
        canvas_action = "chat_only"

    recent_message_limit = (
        CANVAS_RECENT_MESSAGE_LIMIT
        if canvas_action in {"canvas_edit", "canvas_create"}
        else CHAT_RECENT_MESSAGE_LIMIT
    )
    session_summary = maybe_update_chat_session_summary(
        connection,
        session=session,
        messages=previous_messages,
        model=model,
        recent_message_limit=recent_message_limit,
    )

    if canvas_action in {"canvas_edit", "canvas_create"}:
        if canvas_origin_request and not payload.canvas_note_id:
            canvas_action = "chat_only"
        elif canvas_action == "canvas_create" or not payload.canvas_note_id:
            canvas_note = create_canvas_note_for_chat(note, connection)
            created_canvas_note = True
            canvas_action = "canvas_create"
        else:
            canvas_note = get_canvas_note_for_chat(payload.canvas_note_id, session["note_id"], connection)

    if context_route.mode == "rag" and canvas_action == "chat_only" and not rag_processing_answer and not rag_failure_answer:
        image_recheck = maybe_recheck_pdf_images_for_chat(
            connection,
            note=note,
            user_id=current_user["id"],
            model=model,
            user_question=payload.content,
            current_page_number=effective_page_number,
            rag_sources=rag_sources,
        )

    context_mode_instruction = format_context_mode_instruction(
        context_route.mode,
        has_rag_sources=bool(rag_sources),
    )
    built_context = build_ai_context(
        mode=context_route.mode,
        pages=pages,
        page_number=effective_page_number,
        base_context_hints=(
            [context_mode_instruction, empty_scope_hint]
            if context_route.mode == "general"
            else [context_mode_instruction, payload.context_hint]
        ),
        rag_sources=rag_sources,
        rag_debug=rag_debug,
        priority_context_hints=[image_recheck.context_hint],
        extra_answer_sources_text=image_recheck.answer_sources_text,
    )
    built_context.debug["page_reference"] = page_reference_debug

    if rag_processing_answer:
        answer = rag_processing_answer
    elif rag_failure_answer:
        answer = rag_failure_answer
    elif canvas_action in {"canvas_edit", "canvas_create"} and canvas_note is not None:
        try:
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
            context_pages = select_ai_canvas_context_pages(
                pages,
                payload.page_number,
                canvas_markdown=current_canvas_markdown,
                canvas_document_json=current_canvas_document_json,
                canvas_recommendation_mode=payload.canvas_recommendation_mode,
                has_selection_image=bool(payload.selection_image or payload.selection_image_url),
            )
            context_messages = select_ai_canvas_messages(previous_messages, payload.canvas_recommendation_mode)
            operations = generate_ai_canvas_operations_from_chat(
                model=model,
                note=note,
                pages=context_pages,
                messages=context_messages,
                user_content=payload.content,
                canvas_title=canvas_note["title"],
                canvas_markdown=current_canvas_markdown,
                canvas_document_json=current_canvas_document_json,
                current_page_number=effective_page_number,
                selection_image=payload.selection_image,
                selection_image_url=payload.selection_image_url,
                context_hint=built_context.context_hint,
                session_summary=session_summary,
                canvas_block_context=payload.canvas_block_context,
                canvas_recommendation_mode=payload.canvas_recommendation_mode,
            )
            if not operations and canvas_action == "canvas_create" and created_canvas_note:
                execute_commit(connection, "DELETE FROM ai_canvas_notes WHERE id = %s", (canvas_note["id"],))
                created_canvas_note = False
                canvas_note = None
                canvas_action = "chat_only"

            if canvas_note is not None:
                canvas_title = canvas_note["title"]
                should_generate_canvas_title = canvas_action == "canvas_create" or (
                    payload.canvas_note_needs_title and is_default_canvas_title(canvas_note["title"])
                )
                if should_generate_canvas_title:
                    try:
                        operations_text = extract_canvas_operations_text(operations)
                        title_source_markdown = "\n\n".join(
                            part for part in (current_canvas_markdown, operations_text) if part.strip()
                        )
                        generated_canvas_title = generate_ai_canvas_title(
                            model=model,
                            note=note,
                            user_content=payload.content,
                            canvas_markdown=title_source_markdown,
                        )
                        canvas_title = normalize_generated_canvas_title(generated_canvas_title, canvas_note["title"])
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
        if operations:
            answer = (
                "새 Canvas를 만들고 반영했습니다. Canvas 패널에서 확인해 주세요."
                if canvas_action == "canvas_create"
                else "Canvas에 반영했습니다."
            )
        elif canvas_note is None:
            answer = "적용할 만한 Canvas 변경이 없어 새 Canvas를 만들지 않았습니다."
        else:
            answer = "적용할 만한 Canvas 변경이 없어 현재 내용을 유지했습니다."
        if canvas_note is not None:
            canvas_edit = {
                "action": canvas_action,
                "canvas_note_id": canvas_note["id"],
                "title": canvas_note["title"],
                "canvas_note": canvas_note,
                "operations": operations,
            }
    else:
        answer = generate_note_chat_answer(
            model=model,
            note=note,
            pages=built_context.context_pages,
            messages=previous_messages,
            user_content=payload.content,
            selection_image=payload.selection_image,
            selection_rect=payload.selection_rect.model_dump() if payload.selection_rect else None,
            page_number=effective_page_number,
            selection_image_url=payload.selection_image_url,
            context_hint=built_context.context_hint,
            session_summary=session_summary,
            canvas_block_context=payload.canvas_block_context,
            rag_image_inputs=image_recheck.image_inputs,
        )
        if built_context.answer_sources_text:
            answer = f"{answer.rstrip()}\n\n{built_context.answer_sources_text}"
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
                    RETURNING id, note_id, title, model, rag_scope, created_at, updated_at
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
        "context_mode": context_route.mode,
        "rewritten_query": context_route.rewritten_query,
        "rag_scope": rag_scope,
        "sources": rag_sources,
        "debug": {
            **built_context.debug,
            "mode": context_route.mode,
            "scope_count": len(rag_scope.get("sources", [])),
            "router_reason": context_route.reason,
            "image_recheck": image_recheck.debug,
        },
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
