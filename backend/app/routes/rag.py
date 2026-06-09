from fastapi import APIRouter, BackgroundTasks, Depends
from psycopg import Connection

from backend.app.core.auth import get_current_user
from backend.app.db.crud import fetch_all, fetch_one, require_row
from backend.app.db.session import get_db_connection
from backend.app.schemas.rag import (
    NoteSummarySection,
    QuizQuestion,
    RAGAnswer,
    RAGAskRequest,
    RAGQuizRequest,
    RAGQuizResponse,
    RAGSummaryRequest,
)
from backend.app.services.rag_service import (
    answer_with_retrieved_contexts,
    generate_quiz_from_retrieved_contexts,
    retrieve_rag_contexts_with_debug,
    summarize_retrieved_contexts,
)
from backend.app.services.document_chunk_index import reindex_note_background


router = APIRouter(prefix="/ai/rag", tags=["rag"])
RAG_SEARCH_UNAVAILABLE_MESSAGE = "지금은 자료 검색을 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."
RAG_NO_RESULTS_MESSAGE = "관련된 자료를 찾지 못했습니다."


def _rag_status_message(debug: dict) -> str | None:
    if debug.get("rag_unavailable"):
        return RAG_SEARCH_UNAVAILABLE_MESSAGE
    if debug.get("no_results"):
        return RAG_NO_RESULTS_MESSAGE
    return None


def _rag_status_answer(message: str) -> RAGAnswer:
    return RAGAnswer(
        answer=message,
        sections=[NoteSummarySection(title="안내", body=message, tone="muted")],
        sources=[],
    )


@router.post("/reindex/notes/{note_id}")
def reindex_note_rag(
    note_id: int,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    require_row(
        fetch_one(connection, "SELECT id FROM notes WHERE id = %s AND user_id = %s", (note_id, current_user["id"])),
        "note not found",
    )
    background_tasks.add_task(reindex_note_background, note_id, current_user["id"])
    return {"status": "queued", "note_count": 1}


@router.post("/reindex/folders/{folder_id}")
def reindex_folder_rag(
    folder_id: int,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    require_row(
        fetch_one(connection, "SELECT id FROM folders WHERE id = %s AND user_id = %s", (folder_id, current_user["id"])),
        "folder not found",
    )
    notes = fetch_all(
        connection,
        "SELECT id FROM notes WHERE folder_id = %s AND user_id = %s ORDER BY id ASC",
        (folder_id, current_user["id"]),
    )
    for note in notes:
        background_tasks.add_task(reindex_note_background, int(note["id"]), current_user["id"])
    return {"status": "queued", "note_count": len(notes)}


@router.post("/ask", response_model=RAGAnswer)
def ask_rag(
    payload: RAGAskRequest,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    contexts, debug = retrieve_rag_contexts_with_debug(
        connection,
        user_id=current_user["id"],
        question=payload.question,
        note_ids=payload.note_ids,
        folder_id=payload.folder_id or payload.subject_id,
        top_k=payload.top_k,
    )
    status_message = _rag_status_message(debug)
    if status_message:
        return _rag_status_answer(status_message)
    return answer_with_retrieved_contexts(
        question=payload.question,
        contexts=contexts,
        model=payload.model,
    )


@router.post("/summary", response_model=RAGAnswer)
def summarize_rag(
    payload: RAGSummaryRequest,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    query = (
        "exam preparation key concepts likely questions"
        if payload.mode == "exam"
        else "note summary key concepts"
    )
    contexts, debug = retrieve_rag_contexts_with_debug(
        connection,
        user_id=current_user["id"],
        question=query,
        note_ids=payload.note_ids,
        folder_id=payload.folder_id or payload.subject_id,
        top_k=payload.top_k,
    )
    status_message = _rag_status_message(debug)
    if status_message:
        return _rag_status_answer(status_message)
    return summarize_retrieved_contexts(
        contexts=contexts,
        mode=payload.mode,
        model=payload.model,
    )


@router.post("/quiz", response_model=RAGQuizResponse)
def quiz_rag(
    payload: RAGQuizRequest,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    contexts, debug = retrieve_rag_contexts_with_debug(
        connection,
        user_id=current_user["id"],
        question="quiz questions answers explanations key concepts",
        note_ids=payload.note_ids,
        folder_id=payload.folder_id or payload.subject_id,
        top_k=payload.top_k,
    )
    status_message = _rag_status_message(debug)
    if status_message:
        return RAGQuizResponse(
            questions=[
                QuizQuestion(
                    question="자료 검색 상태",
                    answer=status_message,
                    explanation=status_message,
                    type="short_answer",
                )
            ],
            sources=[],
        )
    return generate_quiz_from_retrieved_contexts(
        contexts=contexts,
        count=payload.count,
        model=payload.model,
    )
