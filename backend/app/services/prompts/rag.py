"""Prompts for retrieval-augmented generation flows."""

from backend.app.schemas.rag import RetrievedContext


COMMON_STUDY_RULES = """
- 제공된 context를 우선 근거로 답변한다.
- context에 없는 내용은 추측하지 않는다.
- 불확실한 내용은 불확실하다고 명확히 표시한다.
- 대학생이 복습하기 쉬운 형태로 구조화한다.
- 필요한 경우 참고한 sources를 포함한다.
- 한국어로 자연스럽고 명확하게 답변한다.
""".strip()


RAG_QA_PROMPT = f"""
You are B-Snap's RAG-based study assistant.

Rules:
{COMMON_STUDY_RULES}

Return a helpful study answer. Prefer this structure:
1. 핵심 답변
2. 근거
3. 복습 포인트
4. Sources
""".strip()


NOTE_SUMMARY_PROMPT = f"""
You are B-Snap's note summarization assistant.

Rules:
{COMMON_STUDY_RULES}

Summarize the provided context into review-friendly sections:
- 핵심 요약
- 중요 개념
- 헷갈리기 쉬운 부분
- 다음 복습 질문
""".strip()


EXAM_SUMMARY_PROMPT = f"""
You are B-Snap's exam-prep assistant.

Rules:
{COMMON_STUDY_RULES}

Create an exam-focused summary from the context:
- 시험 포인트
- 정의/공식/키워드
- 예상 서술형 포인트
- 빠르게 점검할 체크리스트
""".strip()


QUIZ_GENERATION_PROMPT = f"""
You are B-Snap's quiz generation assistant.

Rules:
{COMMON_STUDY_RULES}

Generate quiz questions only from the provided context. For each question,
include question, answer, explanation, and type.
""".strip()


def build_rag_prompt(question: str, contexts: list[RetrievedContext]) -> str:
    return "\n\n".join(
        [
            "User question:",
            question,
            "Retrieved context:",
            format_contexts_for_prompt(contexts),
        ]
    )


def build_summary_prompt(contexts: list[RetrievedContext], mode: str = "note") -> str:
    summary_type = "시험 대비 요약" if mode == "exam" else "노트 요약"
    return "\n\n".join(
        [
            f"Task: {summary_type}",
            "Retrieved context:",
            format_contexts_for_prompt(contexts),
        ]
    )


def build_quiz_prompt(contexts: list[RetrievedContext], count: int) -> str:
    return "\n\n".join(
        [
            f"Task: Generate {count} quiz questions.",
            "Retrieved context:",
            format_contexts_for_prompt(contexts),
        ]
    )


def format_contexts_for_prompt(contexts: list[RetrievedContext]) -> str:
    if not contexts:
        return "No context was retrieved."

    blocks = []
    for index, context in enumerate(contexts, start=1):
        blocks.append(
            "\n".join(
                [
                    f"[{index}] source_type={context.source_type}",
                    f"source_id={context.source_id}",
                    f"title={context.title}",
                    f"score={context.score:.4f}",
                    "content:",
                    context.content,
                ]
            )
        )
    return "\n\n".join(blocks)
