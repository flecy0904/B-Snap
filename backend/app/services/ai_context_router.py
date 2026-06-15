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
    "어느 페이지",
    "몇 페이지",
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
GENERAL_KEYWORDS = (
    "공부법",
    "암기법",
    "시간 관리",
    "집중력",
    "학습 방법",
    "효율적으로 공부",
    "마크다운",
    "markdown",
    "플래너",
)
FALLBACK_RAG_HINTS = ("노트", "note", "pdf", "문서", "document", "자료", "페이지", "page")


ROUTER_INSTRUCTIONS = """
Classify the user's Korean study assistant question.
Return JSON only: {"mode":"general|rag","rewritten_query":"short search query or empty string"}.

Definitions:
- general: a question clearly unrelated to the selected course, document, or pinned reference materials.
- rag: a question that may need the selected course, document, or pinned reference materials.

Classification policy:
- Choose rag if the question could be related to the course_name, document_title, or pinned_reference_titles.
- Choose rag for selected region references, PDF/note/document/course material questions, page search, exam scope, important pages, or "find/search in the material" requests.
- Choose general only when the question is clearly independent from the selected course/document/reference materials.
- If unsure, choose rag.

If mode is rag, rewrite the user question into a concise search query.
For Korean technical terms, include common English equivalents when useful for searching English lecture PDFs.
If mode is general, set rewritten_query to an empty string.
Keep rewritten_query concise and remove UI filler words.
""".strip()


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _clean_query(question: str) -> str:
    return re.sub(r"\s+", " ", question).strip()[:300]


def _contains_any(text: str, keywords: tuple[str, ...]) -> bool:
    return any(keyword in text for keyword in keywords)


def _clean_titles(titles: list[str] | None) -> list[str]:
    if not titles:
        return []
    cleaned: list[str] = []
    seen: set[str] = set()
    for title in titles:
        normalized = re.sub(r"\s+", " ", str(title or "")).strip()
        if not normalized or normalized in seen:
            continue
        cleaned.append(normalized[:120])
        seen.add(normalized)
        if len(cleaned) >= 12:
            break
    return cleaned


def _has_explicit_page_reference(text: str) -> bool:
    return bool(
        re.search(r"(?<!\d)\d{1,4}\s*(?:페이지|쪽)", text)
        or re.search(r"(?:\bp\.?\s*|\bpage\s+)\d{1,4}\b", text, flags=re.IGNORECASE)
    )


def route_ai_context(
    *,
    question: str,
    model: str,
    course_name: str | None = None,
    document_title: str | None = None,
    pinned_reference_titles: list[str] | None = None,
    has_selection: bool = False,
    has_canvas_context: bool = False,
    current_page_number: int | None = None,
) -> AiContextRoute:
    normalized = _normalize(question)
    rewritten_query = _clean_query(question)

    if has_selection:
        return AiContextRoute(mode="rag", rewritten_query=rewritten_query, reason="selected_region")
    if _has_explicit_page_reference(normalized):
        return AiContextRoute(mode="rag", rewritten_query=rewritten_query, reason="explicit_page_reference")
    if _contains_any(normalized, RAG_KEYWORDS):
        return AiContextRoute(mode="rag", rewritten_query=rewritten_query, reason="rag_keyword")
    if _contains_any(normalized, CURRENT_CONTEXT_KEYWORDS):
        return AiContextRoute(mode="rag", rewritten_query=rewritten_query, reason="current_context_keyword")

    try:
        raw = generate_text_response(
            model=model,
            instructions=ROUTER_INSTRUCTIONS,
            input_items=[{
                "role": "user",
                "content": json.dumps(
                    {
                        "question": question,
                        "course_name": (course_name or "").strip()[:120],
                        "document_title": (document_title or "").strip()[:120],
                        "pinned_reference_titles": _clean_titles(pinned_reference_titles),
                        "has_selected_region": has_selection,
                    },
                    ensure_ascii=False,
                ),
            }],
        )
        parsed = json.loads(raw)
        mode = parsed.get("mode")
        if mode not in {"general", "rag"}:
            raise ValueError("invalid router mode")
        rewritten = "" if mode == "general" else _clean_query(str(parsed.get("rewritten_query") or question))
        return AiContextRoute(mode=mode, rewritten_query=rewritten, reason="llm")
    except Exception:
        fallback_mode: AiContextMode = (
            "rag"
            if current_page_number is not None or _contains_any(normalized, FALLBACK_RAG_HINTS)
            else "general"
        )
        return AiContextRoute(mode=fallback_mode, rewritten_query=rewritten_query, reason="fallback")
