from fastapi import APIRouter, Depends
from psycopg import Connection

from backend.app.db.session import get_db_connection
from backend.app.schemas.rag import (
    RAGAnswer,
    RAGAskRequest,
    RAGQuizRequest,
    RAGQuizResponse,
    RAGSummaryRequest,
)
from backend.app.services.rag_service import (
    ask_with_rag,
    generate_quiz_from_context,
    load_note_documents,
    summarize_note_with_prompt,
)


router = APIRouter(prefix="/ai/rag", tags=["rag"])


@router.post("/ask", response_model=RAGAnswer)
def ask_rag(
    payload: RAGAskRequest,
    connection: Connection = Depends(get_db_connection),
):
    documents = load_note_documents(
        connection,
        note_ids=payload.note_ids,
        folder_id=payload.folder_id,
        subject_id=payload.subject_id,
    )
    return ask_with_rag(
        question=payload.question,
        documents=documents,
        top_k=payload.top_k,
        model=payload.model,
    )


@router.post("/summary", response_model=RAGAnswer)
def summarize_rag(
    payload: RAGSummaryRequest,
    connection: Connection = Depends(get_db_connection),
):
    documents = load_note_documents(
        connection,
        note_ids=payload.note_ids,
        folder_id=payload.folder_id,
        subject_id=payload.subject_id,
    )
    return summarize_note_with_prompt(
        documents=documents,
        top_k=payload.top_k,
        mode=payload.mode,
        model=payload.model,
    )


@router.post("/quiz", response_model=RAGQuizResponse)
def quiz_rag(
    payload: RAGQuizRequest,
    connection: Connection = Depends(get_db_connection),
):
    documents = load_note_documents(
        connection,
        note_ids=payload.note_ids,
        folder_id=payload.folder_id,
        subject_id=payload.subject_id,
    )
    return generate_quiz_from_context(
        documents=documents,
        top_k=payload.top_k,
        count=payload.count,
        model=payload.model,
    )
