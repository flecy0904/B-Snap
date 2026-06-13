import json
import re
from dataclasses import dataclass
from typing import Literal

from backend.app.services.openai_service import generate_text_response


AiContextMode = Literal["general", "rag"]


@dataclass(frozen=True)
class AiContextRoute:
    mode: AiContextMode
    rewritten_query: str
    reason: str = "rule"


RAG_KEYWORDS = (
    "과목 전체",
    "수업 전체",
    "전체 노트",
    "전체 자료",
    "시험 범위",
    "이 과목",
    "이 수업",
    "강의 전체",
    "pdf 전체",
    "문서 전체",
    "이 pdf",
    "이 문서",
    "다른 페이지",
    "앞 페이지",
    "뒤 페이지",
    "전체에서",
    "찾아",
    "검색",
    "페이지 추천",
    "중요 페이지",
)
CURRENT_CONTEXT_KEYWORDS = (
    "이 페이지",
    "현재 페이지",
    "여기",
    "이 부분",
    "선택한",
    "선택 영역",
    "보이는",
    "방금",
    "현재 화면",
)
NOTE_CONTEXT_HINT_KEYWORDS = (
    "pdf",
    "페이지",
    "노트",
    "자료",
    "수업",
    "과목",
    "캔버스",
    "canvas",
)


ROUTER_INSTRUCTIONS = """
Classify the user's Korean study assistant question.
Return JSON only: {"mode":"general|rag","rewritten_query":"short Korean search query"}.

Definitions:
- general: independent concept/study question that does not need the current PDF or course material.
- rag: answer using the selected region, current Canvas/block, current page, nearby pages, and the chat's pinned reference scope.

Prefer rag for "this page", "here", "selected part", current screen references, PDF/note/document/course material questions, or page search.
Keep rewritten_query concise and remove UI filler words.
""".strip()


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _clean_query(question: str) -> str:
    return re.sub(r"\s+", " ", question).strip()[:300]


def _contains_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in text for keyword in keywords)


def route_ai_context(
    *,
    question: str,
    model: str,
    has_selection: bool = False,
    has_canvas_context: bool = False,
    current_page_number: int | None = None,
) -> AiContextRoute:
    normalized = _normalize(question)
    rewritten_query = _clean_query(question)

    if _contains_any(normalized, RAG_KEYWORDS):
        return AiContextRoute(mode="rag", rewritten_query=rewritten_query, reason="rag_keyword")
    if has_selection or has_canvas_context:
        return AiContextRoute(mode="rag", rewritten_query=rewritten_query, reason="selection_or_canvas")
    if _contains_any(normalized, CURRENT_CONTEXT_KEYWORDS):
        return AiContextRoute(mode="rag", rewritten_query=rewritten_query, reason="current_context_keyword")
    if not _contains_any(normalized, NOTE_CONTEXT_HINT_KEYWORDS):
        return AiContextRoute(mode="general", rewritten_query=rewritten_query, reason="general_keyword")

    try:
        raw = generate_text_response(
            model=model,
            instructions=ROUTER_INSTRUCTIONS,
            input_items=[{
                "role": "user",
                "content": json.dumps(
                    {
                        "question": question,
                        "has_current_page": current_page_number is not None,
                    },
                    ensure_ascii=False,
                ),
            }],
        )
        parsed = json.loads(raw)
        mode = parsed.get("mode")
        if mode not in {"general", "rag"}:
            raise ValueError("invalid router mode")
        rewritten = _clean_query(str(parsed.get("rewritten_query") or question))
        return AiContextRoute(mode=mode, rewritten_query=rewritten, reason="llm")
    except Exception:
        return AiContextRoute(mode="rag", rewritten_query=rewritten_query, reason="fallback")
