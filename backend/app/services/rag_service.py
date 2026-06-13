import json
import logging
import re
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
from backend.app.services.document_chunk_index import retrieve_chunk_contexts
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

logger = logging.getLogger(__name__)
JSON_FENCE_PATTERN = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)
Document = dict[str, Any]
TEXT_RAG_SOURCE_TYPES = ["pdf_page", "canvas_note"]
IMAGE_RAG_SOURCE_TYPES = ["image_ai_summary"]
PAGE_LOCAL_RAG_SOURCE_TYPES = ["pdf_page", "image_ai_summary"]


def load_note_documents(
    connection: Connection,
    *,
    note_ids: list[int] | None = None,
    folder_id: int | None = None,
    subject_id: int | None = None,
    user_id: int | None = None,
    include_canvas_notes: bool = True,
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
    ai_canvas_notes = []
    if include_canvas_notes:
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


def load_canvas_documents(
    connection: Connection,
    *,
    canvas_note_ids: list[int],
    user_id: int | None = None,
) -> list[Document]:
    if not canvas_note_ids:
        return []

    filters = ["c.id = ANY(%s)"]
    params: list[Any] = [canvas_note_ids]
    if user_id is not None:
        filters.append("n.user_id = %s")
        params.append(user_id)

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
        WHERE {' AND '.join(filters)}
        ORDER BY c.updated_at DESC, c.id DESC
        """,
        tuple(params),
    )

    documents: list[Document] = []
    for canvas_note in ai_canvas_notes:
        if not canvas_note.get("markdown"):
            continue
        page_range = _format_page_range(
            canvas_note.get("source_page_start"),
            canvas_note.get("source_page_end"),
        )
        documents.append(
            {
                "source_type": "canvas_note",
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


def answer_with_retrieved_contexts(
    *,
    question: str,
    contexts: list[RetrievedContext],
    model: str | None = None,
) -> RAGAnswer:
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


def retrieve_rag_contexts_with_debug(
    connection: Connection,
    *,
    user_id: int,
    question: str,
    note_ids: list[int] | None = None,
    folder_id: int | None = None,
    canvas_note_ids: list[int] | None = None,
    exclude_canvas_for_notes: bool = False,
    documents: list[Document] | None = None,
    top_k: int = 5,
) -> tuple[list[RetrievedContext], dict[str, Any]]:
    settings = get_settings()
    context_limit = max(1, min(int(top_k or 5), int(settings.rag_context_max_chunks or 5)))
    internal_top_k = max(context_limit, int(settings.rag_internal_top_k or context_limit))
    image_top_k = max(1, int(settings.rag_image_search_top_k or 5))
    image_reserve_count = min(
        context_limit,
        max(0, min(int(settings.rag_image_recheck_judge_top_k or 0), int(settings.rag_image_search_top_k or 0))),
    )
    debug: dict[str, Any] = {
        "fallback": False,
        "fallback_reason": None,
        "retrieved_source_count": 0,
        "retrieved_chunk_count": 0,
        "score_meaning": "similarity_higher_is_better",
        "score_formula": "1 - cosine_distance",
        "thresholds": {
            "text_min_score": settings.rag_text_min_score,
            "image_summary_min_score": settings.rag_image_summary_min_score,
        },
        "retrieval_limits": {
            "requested_top_k": top_k,
            "internal_text_top_k": internal_top_k,
            "internal_image_top_k": image_top_k,
            "context_limit": context_limit,
            "image_reserve_count": image_reserve_count,
        },
    }
    try:
        text_contexts = retrieve_chunk_contexts(
            connection,
            user_id=user_id,
            query=question,
            note_ids=note_ids,
            folder_id=folder_id,
            canvas_note_ids=canvas_note_ids,
            exclude_canvas_for_notes=exclude_canvas_for_notes,
            source_types=TEXT_RAG_SOURCE_TYPES,
            min_score=float(settings.rag_text_min_score),
            top_k=internal_top_k,
        )
        image_contexts = retrieve_chunk_contexts(
            connection,
            user_id=user_id,
            query=question,
            note_ids=note_ids,
            folder_id=folder_id,
            canvas_note_ids=canvas_note_ids,
            exclude_canvas_for_notes=exclude_canvas_for_notes,
            source_types=IMAGE_RAG_SOURCE_TYPES,
            min_score=float(settings.rag_image_summary_min_score),
            top_k=image_top_k,
        )
        contexts = _merge_ranked_contexts(text_contexts, image_contexts, limit=context_limit, image_reserve_count=image_reserve_count)
        if contexts:
            debug["retrieved_source_count"] = len({f"{context.source_type}:{context.source_id}" for context in contexts})
            debug["retrieved_chunk_count"] = len(contexts)
            debug["retrieved_text_chunk_count"] = len([context for context in contexts if context.source_type != "image_ai_summary"])
            debug["retrieved_image_summary_count"] = len([context for context in contexts if context.source_type == "image_ai_summary"])
            return contexts, debug
        debug["fallback_reason"] = "vector_empty"
        debug["no_results"] = True
    except Exception as exc:
        debug["fallback"] = True
        debug["fallback_reason"] = "vector_error"
        debug["rag_unavailable"] = True
        logger.warning(
            "vector RAG retrieval failed: user_id=%s note_ids=%s folder_id=%s canvas_note_ids=%s error=%s",
            user_id,
            note_ids,
            folder_id,
            canvas_note_ids,
            exc,
        )

    return [], debug


def load_page_local_rag_contexts(
    connection: Connection,
    *,
    user_id: int,
    note_ids: list[int],
    page_number: int,
    source_types: list[str] | None = None,
    limit: int = 8,
) -> list[RetrievedContext]:
    if not note_ids or page_number < 1:
        return []
    active_source_types = source_types or PAGE_LOCAL_RAG_SOURCE_TYPES
    rows = fetch_all(
        connection,
        """
        SELECT source_type, source_id, title, content, folder_id, note_id, page_number, chunk_index, metadata
        FROM document_chunks
        WHERE user_id = %s
          AND note_id = ANY(%s::int[])
          AND page_number = %s
          AND source_type = ANY(%s::text[])
          AND content IS NOT NULL
          AND btrim(content) <> ''
        ORDER BY
          CASE source_type
            WHEN 'pdf_page' THEN 0
            WHEN 'image_ai_summary' THEN 1
            ELSE 2
          END,
          chunk_index ASC NULLS LAST,
          source_id ASC
        LIMIT %s
        """,
        (user_id, note_ids, page_number, active_source_types, max(1, int(limit))),
    )
    contexts: list[RetrievedContext] = []
    for row in rows:
        metadata = row.get("metadata") if isinstance(row.get("metadata"), dict) else {}
        contexts.append(
            RetrievedContext(
                source_type=str(row["source_type"]),
                source_id=str(row["source_id"]),
                title=str(row["title"]),
                content=str(row["content"]),
                score=1.0,
                folder_id=row.get("folder_id"),
                note_id=row.get("note_id"),
                page_number=row.get("page_number"),
                chunk_index=row.get("chunk_index"),
                metadata={**metadata, "retrieval_kind": "page_local"},
            )
        )
    return contexts


def merge_retrieved_contexts(*context_groups: list[RetrievedContext], limit: int | None = None) -> list[RetrievedContext]:
    merged: list[RetrievedContext] = []
    seen: set[tuple[str, str, int | None, int | None]] = set()
    for contexts in context_groups:
        for context in contexts:
            key = _context_key(context)
            if key in seen:
                continue
            seen.add(key)
            merged.append(context)
            if limit is not None and len(merged) >= limit:
                return merged
    return merged


def update_rag_debug_for_contexts(
    debug: dict[str, Any],
    contexts: list[RetrievedContext],
    *,
    page_local_contexts: list[RetrievedContext] | None = None,
) -> dict[str, Any]:
    if page_local_contexts:
        debug["page_local_context_count"] = len(page_local_contexts)
        if debug.get("no_results"):
            debug["vector_no_results"] = True
            debug["no_results"] = False
        if debug.get("fallback_reason") == "vector_empty":
            debug["fallback_reason"] = None
    debug["retrieved_source_count"] = len({f"{context.source_type}:{context.source_id}" for context in contexts})
    debug["retrieved_chunk_count"] = len(contexts)
    debug["retrieved_text_chunk_count"] = len([context for context in contexts if context.source_type != "image_ai_summary"])
    debug["retrieved_image_summary_count"] = len([context for context in contexts if context.source_type == "image_ai_summary"])
    return debug


def _context_key(context: RetrievedContext) -> tuple[str, str, int | None, int | None]:
    return (context.source_type, context.source_id, context.page_number, context.chunk_index)


def _dedupe_ranked_contexts(contexts: list[RetrievedContext]) -> list[RetrievedContext]:
    selected: list[RetrievedContext] = []
    seen: set[tuple[str, str, int | None, int | None]] = set()
    for context in sorted(contexts, key=lambda item: item.score, reverse=True):
        key = _context_key(context)
        if key in seen:
            continue
        seen.add(key)
        selected.append(context)
    return selected


def _merge_ranked_contexts(
    text_contexts: list[RetrievedContext],
    image_contexts: list[RetrievedContext],
    *,
    limit: int,
    image_reserve_count: int = 0,
) -> list[RetrievedContext]:
    ranked_text = _dedupe_ranked_contexts(text_contexts)
    ranked_images = _dedupe_ranked_contexts(image_contexts)
    selected: list[RetrievedContext] = []
    seen: set[tuple[str, str, int | None, int | None]] = set()

    for context in ranked_images[:image_reserve_count]:
        key = _context_key(context)
        if key in seen:
            continue
        seen.add(key)
        selected.append(context)
        if len(selected) >= limit:
            return sorted(selected, key=lambda item: item.score, reverse=True)

    for context in sorted([*ranked_text, *ranked_images], key=lambda item: item.score, reverse=True):
        key = _context_key(context)
        if key in seen:
            continue
        seen.add(key)
        selected.append(context)
        if len(selected) >= limit:
            return sorted(selected, key=lambda item: item.score, reverse=True)
    return sorted(selected, key=lambda item: item.score, reverse=True)


def summarize_retrieved_contexts(
    *,
    contexts: list[RetrievedContext],
    mode: str = "note",
    model: str | None = None,
) -> RAGAnswer:
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


def generate_quiz_from_retrieved_contexts(
    *,
    contexts: list[RetrievedContext],
    count: int = 5,
    model: str | None = None,
) -> RAGQuizResponse:
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
    raw_response = _extract_json_payload(raw_response)
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


def _extract_json_payload(raw_response: str) -> str:
    response = raw_response.strip()
    fenced_match = JSON_FENCE_PATTERN.search(response)
    if fenced_match:
        return fenced_match.group(1).strip()

    object_start = response.find("{")
    array_start = response.find("[")
    candidates = [index for index in [object_start, array_start] if index >= 0]
    if not candidates:
        return response

    start = min(candidates)
    end = max(response.rfind("}"), response.rfind("]"))
    if end <= start:
        return response
    return response[start : end + 1]


def _sources_text(contexts: list[RetrievedContext]) -> str:
    if not contexts:
        return "참고한 sources가 없습니다."
    return "\n".join(
        [
            f"- {context.title} ({context.source_type}:{context.source_id}, score={context.score:.4f})"
            for context in contexts
        ]
    )
