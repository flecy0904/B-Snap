import json
from typing import Any

from psycopg import Connection

from backend.app.core.config import get_settings
from backend.app.db.crud import fetch_all
from backend.app.schemas.rag import (
    NoteSummarySection,
    QuizQuestion,
    RAGAnswer,
    RAGQuizResponse,
    RetrievedContext,
)
from backend.app.services.note_page_content import extract_ai_page_text
from backend.app.services.openai_service import generate_text_response
from backend.app.services.prompts.rag import (
    EXAM_SUMMARY_PROMPT,
    NOTE_SUMMARY_PROMPT,
    QUIZ_GENERATION_PROMPT,
    RAG_QA_PROMPT,
    build_quiz_prompt,
    build_rag_prompt,
    build_summary_prompt,
    format_contexts_for_prompt,
)
from backend.app.services.rag_retriever import (
    Document,
    build_mock_contexts,
    retrieve_relevant_contexts,
    split_text_into_chunks,
)


def load_note_documents(
    connection: Connection,
    *,
    note_ids: list[int] | None = None,
    folder_id: int | None = None,
    subject_id: int | None = None,
    user_id: int | None = None,
) -> list[Document]:
    current_folder_id = folder_id if folder_id is not None else subject_id
    where_clause, params = _build_note_filters(note_ids=note_ids, folder_id=current_folder_id, user_id=user_id)

    notes = fetch_all(
        connection,
        f"""
        SELECT n.id, n.title, n.summary
        FROM notes n
        {where_clause}
        ORDER BY n.updated_at DESC, n.id DESC
        """,
        params,
    )
    pages = fetch_all(
        connection,
        f"""
        SELECT p.id, p.note_id, p.page_number, p.content, n.title AS note_title
        FROM note_pages p
        JOIN notes n ON n.id = p.note_id
        {where_clause}
        ORDER BY n.updated_at DESC, n.id DESC, p.page_number ASC, p.id ASC
        """,
        params,
    )
    ai_canvas_notes = fetch_all(
        connection,
        f"""
        SELECT c.id,
               c.note_id,
               c.title,
               c.markdown,
               c.source_page_start,
               c.source_page_end,
               n.title AS note_title
        FROM ai_canvas_notes c
        JOIN notes n ON n.id = c.note_id
        {where_clause}
        ORDER BY c.updated_at DESC, c.id DESC
        """,
        params,
    )

    documents: list[Document] = []
    for note in notes:
        if note.get("summary"):
            documents.append(
                {
                    "source_type": "note",
                    "source_id": str(note["id"]),
                    "title": note["title"],
                    "content": note["summary"],
                }
            )

    for page in pages:
        content = extract_ai_page_text(page.get("content"))
        if content:
            documents.append(
                {
                    "source_type": "note_page",
                    "source_id": str(page["id"]),
                    "title": f"{page['note_title']} - page {page['page_number']}",
                    "content": content,
                }
            )

    for canvas_note in ai_canvas_notes:
        if canvas_note.get("markdown"):
            page_range = _format_page_range(
                canvas_note.get("source_page_start"),
                canvas_note.get("source_page_end"),
            )
            documents.append(
                {
                    "source_type": "ai_canvas_note",
                    "source_id": str(canvas_note["id"]),
                    "title": f"{canvas_note['note_title']} - {canvas_note['title']}",
                    "content": "\n".join(
                        part
                        for part in [
                            f"Source pages: {page_range}" if page_range else "",
                            canvas_note["markdown"],
                        ]
                        if part
                    ),
                }
            )

    return documents


def ask_with_rag(
    *,
    question: str,
    documents: list[Document],
    top_k: int = 5,
    model: str | None = None,
) -> RAGAnswer:
    contexts = _retrieve_or_mock(question, documents, top_k)
    prompt = build_rag_prompt(question, contexts)
    selected_model = model or get_settings().default_ai_model
    mock_response = _mock_answer(question, contexts)
    answer = generate_text_response(
        model=selected_model,
        instructions=RAG_QA_PROMPT,
        input_items=[{"role": "user", "content": prompt}],
        allow_mock=True,
        mock_response=mock_response,
    )
    return RAGAnswer(
        answer=answer,
        sections=[
            NoteSummarySection(title="핵심 답변", body=answer, tone="default"),
            NoteSummarySection(title="참고 자료", body=_sources_text(contexts), tone="muted"),
        ],
        sources=contexts,
    )


def build_rag_context_hint(
    *,
    question: str,
    documents: list[Document],
    top_k: int = 5,
) -> str | None:
    contexts = retrieve_relevant_contexts(question, documents, top_k=top_k)
    if not contexts:
        return None

    return "\n\n".join(
        [
            "Retrieved study context for this user question:",
            format_contexts_for_prompt(contexts),
        ]
    )


def summarize_note_with_prompt(
    *,
    documents: list[Document],
    top_k: int = 5,
    mode: str = "note",
    model: str | None = None,
) -> RAGAnswer:
    query = "시험 대비 핵심 개념 예상 문제" if mode == "exam" else "노트 핵심 요약 중요 개념"
    contexts = _retrieve_or_mock(query, documents, top_k, fallback_to_documents=True)
    selected_model = model or get_settings().default_ai_model
    instructions = EXAM_SUMMARY_PROMPT if mode == "exam" else NOTE_SUMMARY_PROMPT
    mock_response = _mock_summary(contexts, mode)
    answer = generate_text_response(
        model=selected_model,
        instructions=instructions,
        input_items=[{"role": "user", "content": build_summary_prompt(contexts, mode)}],
        allow_mock=True,
        mock_response=mock_response,
    )
    tone = "highlight" if mode == "exam" else "default"
    return RAGAnswer(
        answer=answer,
        sections=[
            NoteSummarySection(title="요약", body=answer, tone=tone),
            NoteSummarySection(title="참고 자료", body=_sources_text(contexts), tone="muted"),
        ],
        sources=contexts,
    )


def generate_quiz_from_context(
    *,
    documents: list[Document],
    top_k: int = 5,
    count: int = 5,
    model: str | None = None,
) -> RAGQuizResponse:
    contexts = _retrieve_or_mock("퀴즈 문제 정답 설명 핵심 개념", documents, top_k, fallback_to_documents=True)
    selected_model = model or get_settings().default_ai_model
    mock_questions = _mock_quiz_questions(contexts, count)
    mock_response = json.dumps(
        {"questions": [question.model_dump() for question in mock_questions]},
        ensure_ascii=False,
    )
    raw_response = generate_text_response(
        model=selected_model,
        instructions=QUIZ_GENERATION_PROMPT + "\n\nReturn JSON with a questions array.",
        input_items=[{"role": "user", "content": build_quiz_prompt(contexts, count)}],
        allow_mock=True,
        mock_response=mock_response,
    )
    return RAGQuizResponse(
        questions=_parse_quiz_questions(raw_response, fallback=mock_questions),
        sources=contexts,
    )


def _build_note_filters(
    *,
    note_ids: list[int] | None,
    folder_id: int | None,
    user_id: int | None,
) -> tuple[str, tuple[Any, ...]]:
    filters = []
    params: list[Any] = []

    if note_ids:
        placeholders = ", ".join(["%s"] * len(note_ids))
        filters.append(f"n.id IN ({placeholders})")
        params.extend(note_ids)

    if folder_id is not None:
        filters.append("n.folder_id = %s")
        params.append(folder_id)

    if user_id is not None:
        filters.append("n.user_id = %s")
        params.append(user_id)

    if not filters:
        return "", ()
    return "WHERE " + " AND ".join(filters), tuple(params)


def _format_page_range(start: int | None, end: int | None) -> str:
    if start is None:
        return ""
    if end is None or end == start:
        return str(start)
    return f"{start}-{end}"


def _retrieve_or_mock(
    question: str,
    documents: list[Document],
    top_k: int,
    *,
    fallback_to_documents: bool = False,
) -> list[RetrievedContext]:
    contexts = retrieve_relevant_contexts(question, documents, top_k=top_k)
    if contexts:
        return contexts
    if not documents:
        return build_mock_contexts(question)
    if fallback_to_documents:
        return _first_contexts(documents, top_k)
    return []


def _first_contexts(documents: list[Document], top_k: int) -> list[RetrievedContext]:
    contexts = []
    for document in documents:
        chunks = split_text_into_chunks(document.get("content") or "")
        for chunk_index, chunk in enumerate(chunks):
            source_id = str(document.get("source_id") or document.get("id") or "")
            if len(chunks) > 1:
                source_id = f"{source_id}#chunk-{chunk_index + 1}"
            contexts.append(
                RetrievedContext(
                    source_type=str(document.get("source_type") or "document"),
                    source_id=source_id,
                    title=str(document.get("title") or "Untitled"),
                    content=chunk,
                    score=0.0,
                )
            )
            if len(contexts) >= top_k:
                return contexts
    return contexts


def _mock_answer(question: str, contexts: list[RetrievedContext]) -> str:
    if not contexts:
        return (
            "관련 context를 찾지 못했습니다. 현재 저장된 노트나 페이지 텍스트 안에서 근거를 찾을 수 없어 "
            "답변을 확정하기 어렵습니다."
        )

    return "\n".join(
        [
            "OPENAI_API_KEY가 설정되지 않아 mock 응답을 반환합니다.",
            f"질문: {question}",
            "검색된 context를 기준으로 보면 다음 내용을 우선 확인할 수 있습니다.",
            contexts[0].content[:500],
            "",
            "불확실한 내용은 실제 모델 응답에서 context 근거와 함께 다시 확인해주세요.",
        ]
    )


def _mock_summary(contexts: list[RetrievedContext], mode: str) -> str:
    title = "시험 대비 요약" if mode == "exam" else "노트 요약"
    if not contexts:
        return f"{title}: 관련 context를 찾지 못했습니다. 저장된 노트/페이지 텍스트를 먼저 확인해주세요."
    return f"{title}: {contexts[0].content[:700]}"


def _mock_quiz_questions(contexts: list[RetrievedContext], count: int) -> list[QuizQuestion]:
    content = contexts[0].content if contexts else "관련 context 없음"
    return [
        QuizQuestion(
            question=f"다음 context의 핵심 개념을 설명하세요. ({index + 1})",
            answer=content[:200],
            explanation="OPENAI_API_KEY가 없을 때 반환되는 mock 퀴즈입니다. 실제 답은 context 기반으로 생성됩니다.",
            type="short_answer",
        )
        for index in range(count)
    ]


def _parse_quiz_questions(raw_response: str, fallback: list[QuizQuestion]) -> list[QuizQuestion]:
    try:
        payload = json.loads(raw_response)
    except json.JSONDecodeError:
        return fallback

    questions = payload.get("questions") if isinstance(payload, dict) else payload
    if not isinstance(questions, list):
        return fallback

    parsed = []
    for question in questions:
        if not isinstance(question, dict):
            continue
        try:
            parsed.append(QuizQuestion(**question))
        except ValueError:
            continue
    return parsed or fallback


def _sources_text(contexts: list[RetrievedContext]) -> str:
    if not contexts:
        return "참고한 sources가 없습니다."
    return "\n".join(
        [
            f"- {context.title} ({context.source_type}:{context.source_id}, score={context.score:.4f})"
            for context in contexts
        ]
    )
