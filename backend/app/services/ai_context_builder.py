from dataclasses import dataclass
from typing import Any

from backend.app.schemas.rag import RetrievedContext


@dataclass(frozen=True)
class BuiltAiContext:
    context_pages: list[dict]
    context_hint: str | None
    answer_sources_text: str | None
    debug: dict[str, Any]


def format_context_mode_instruction(mode: str, *, has_rag_sources: bool) -> str:
    if mode == "general":
        return (
            "Router mode: general.\n"
            "Answer as a general study question. Do not invent PDF-, page-, Canvas-, or subject-specific facts unless they are explicitly provided."
        )
    return (
        "Router mode: rag.\n"
        "Answer from the chat's pinned reference scope. Prioritize selected region, Canvas/block, current page, and adjacent pages first, "
        "then use scoped RAG support context as secondary evidence."
        if has_rag_sources
        else
        "Router mode: rag.\n"
        "The scoped RAG search returned no support context. Prioritize selected region, Canvas/block, current page, and adjacent pages; "
        "if those are not enough, say the pinned reference materials are not enough to verify the answer."
    )


def select_rag_context_pages(pages: list[dict], page_number: int | None) -> list[dict]:
    if not pages:
        return []
    if page_number is None:
        return pages[:3]

    pages_by_number = {int(page["page_number"]): page for page in pages}
    ordered_numbers = [page_number, page_number - 1, page_number + 1]
    selected = [
        pages_by_number[number]
        for number in ordered_numbers
        if number in pages_by_number
    ]
    return selected or pages[:3]


def format_rag_support_context(contexts: list[RetrievedContext]) -> str | None:
    if not contexts:
        return None

    lines = ["RAG support context. Use only as supporting material after current selection/page/Canvas/current page context:"]
    for index, context in enumerate(contexts, start=1):
        page_label = f", page {context.page_number}" if context.page_number else ""
        lines.append(
            f"[{index}] {context.title} ({context.source_type}:{context.source_id}{page_label}, score={context.score:.4f})\n"
            f"{context.content}"
        )
    return "\n\n".join(lines)


def format_answer_sources(contexts: list[RetrievedContext], *, max_sources: int = 4) -> str | None:
    if not contexts:
        return None

    source_lines = []
    seen: set[str] = set()
    for context in contexts:
        label = context.title.strip()
        page_label = f"{context.page_number}페이지" if context.page_number else ""
        if page_label and page_label not in label:
            label = f"{label} {page_label}".strip()
        key = f"{context.source_type}:{context.source_id}:{context.page_number}"
        if key in seen:
            continue
        seen.add(key)
        source_lines.append(f"- {label}")
        if len(source_lines) >= max_sources:
            break

    if not source_lines:
        return None
    return "참고 자료\n" + "\n".join(source_lines)


def build_ai_context(
    *,
    mode: str,
    pages: list[dict],
    page_number: int | None,
    base_context_hints: list[str | None],
    rag_sources: list[RetrievedContext],
    rag_debug: dict[str, Any] | None = None,
) -> BuiltAiContext:
    context_pages = [] if mode == "general" else select_rag_context_pages(pages, page_number)
    rag_support_hint = format_rag_support_context(rag_sources) if mode == "rag" else None
    context_hint = "\n\n".join(
        hint
        for hint in [*base_context_hints, rag_support_hint]
        if hint
    ) or None
    debug = {
        "retrieved_source_count": len({f"{context.source_type}:{context.source_id}" for context in rag_sources}),
        "retrieved_chunk_count": len(rag_sources),
        "fallback": False,
        "fallback_reason": None,
    }
    if rag_debug:
        debug.update(rag_debug)
    return BuiltAiContext(
        context_pages=context_pages,
        context_hint=context_hint,
        answer_sources_text=format_answer_sources(rag_sources, max_sources=4) if mode == "rag" else None,
        debug=debug,
    )
