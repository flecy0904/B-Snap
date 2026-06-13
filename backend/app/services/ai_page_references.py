import re


_KOREAN_PAGE_RE = re.compile(r"(?<!\d)(\d{1,4})\s*(?:\ud398\uc774\uc9c0|\ucabd)")
_ENGLISH_PAGE_RE = re.compile(r"(?:\bp\.?\s*|\bpage\s+)(\d{1,4})\b", re.IGNORECASE)


def extract_explicit_page_number(question: str, *, max_page_number: int | None = None) -> int | None:
    """Return a page number explicitly mentioned by the user, if it is in range.

    Page references are structural context, not semantic search terms. Keeping
    this parsing separate prevents page-only questions from depending on vector
    similarity for the page number itself.
    """
    for pattern in (_KOREAN_PAGE_RE, _ENGLISH_PAGE_RE):
        match = pattern.search(question or "")
        if not match:
            continue
        page_number = int(match.group(1))
        if page_number < 1:
            continue
        if max_page_number is not None and page_number > max_page_number:
            continue
        return page_number
    return None


def resolve_context_page_number(
    *,
    question: str,
    payload_page_number: int | None,
    available_pages: list[dict],
) -> tuple[int | None, dict]:
    max_page_number = None
    if available_pages:
        page_numbers = [
            int(page["page_number"])
            for page in available_pages
            if page.get("page_number") is not None
        ]
        max_page_number = max(page_numbers) if page_numbers else None

    explicit_page_number = extract_explicit_page_number(
        question,
        max_page_number=max_page_number,
    )
    resolved_page_number = explicit_page_number or payload_page_number
    return resolved_page_number, {
        "payload_page_number": payload_page_number,
        "explicit_page_number": explicit_page_number,
        "resolved_page_number": resolved_page_number,
    }
