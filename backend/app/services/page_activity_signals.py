from typing import Any


MAX_STROKES_PER_PAGE_STATE = 28
MAX_POINTS_PER_PAGE_STATE = 900
MAX_HIGHLIGHTS_PER_PAGE_STATE = 10
MAX_BOOKMARKS_PER_PAGE_STATE = 1
MAX_PHOTO_REFERENCES_PER_PAGE_STATE = 5
MAX_MEMO_PAGES_PER_PAGE_STATE = 4

BOOKMARK_COUNT_KEYS = ("bookmarked", "bookmarkCount", "bookmark_count", "bookmarks")
PHOTO_REFERENCE_COUNT_KEYS = (
    "photoReferenceCount",
    "photo_reference_count",
    "captureReferenceCount",
    "capture_reference_count",
    "pageCaptureReferences",
    "captureReferences",
    "photoReferences",
)
MEMO_PAGE_COUNT_KEYS = ("memoPageCount", "memo_page_count", "memoPages", "generatedMemoPages")


def coerce_signal_count(value: Any) -> int:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return max(0, int(value))
    if isinstance(value, list):
        return len(value)
    return 0


def sum_state_counts(state: dict[str, Any], keys: tuple[str, ...]) -> int:
    return sum(coerce_signal_count(state.get(key)) for key in keys)


def page_ink_activity_counts(state: dict[str, Any]) -> tuple[int, int, int]:
    stroke_count = 0
    point_count = 0
    highlight_count = 0
    ink_strokes = state.get("inkStrokes")
    if not isinstance(ink_strokes, list):
        return 0, 0, 0
    for stroke in ink_strokes:
        if not isinstance(stroke, dict):
            continue
        points = stroke.get("points")
        stroke_count += 1
        point_count += len(points) if isinstance(points, list) else 0
        if stroke.get("style") == "highlight" or stroke.get("brush") == "highlighter":
            highlight_count += 1
    return (
        min(stroke_count, MAX_STROKES_PER_PAGE_STATE),
        min(point_count, MAX_POINTS_PER_PAGE_STATE),
        min(highlight_count, MAX_HIGHLIGHTS_PER_PAGE_STATE),
    )


def raw_ink_density_score(stroke_count: int, point_count: int) -> float:
    ink_density = min(1.0, (stroke_count * 0.045) + (point_count * 0.0015))
    return min(6.0, ink_density * 6)


def study_action_score(
    *,
    bookmark_count: int = 0,
    highlight_count: int = 0,
    photo_reference_count: int = 0,
    ai_question_count: int = 0,
    memo_page_count: int = 0,
) -> float:
    return min(28.0, (
        max(0, int(bookmark_count)) * 8
        + min(10.0, max(0, int(highlight_count)) * 2)
        + max(0, int(photo_reference_count)) * 4
        + max(0, int(ai_question_count)) * 6
        + max(0, int(memo_page_count)) * 7
    ))


def capped_bookmark_count(state: dict[str, Any]) -> int:
    return min(sum_state_counts(state, BOOKMARK_COUNT_KEYS), MAX_BOOKMARKS_PER_PAGE_STATE)


def capped_photo_reference_count(state: dict[str, Any]) -> int:
    return min(sum_state_counts(state, PHOTO_REFERENCE_COUNT_KEYS), MAX_PHOTO_REFERENCES_PER_PAGE_STATE)


def capped_memo_page_count(state: dict[str, Any]) -> int:
    return min(sum_state_counts(state, MEMO_PAGE_COUNT_KEYS), MAX_MEMO_PAGES_PER_PAGE_STATE)
