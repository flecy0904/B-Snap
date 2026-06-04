import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from fastapi import APIRouter, Depends, Query
from psycopg import Connection

from backend.app.core.auth import get_current_user
from backend.app.db.crud import fetch_all, fetch_one, require_row
from backend.app.db.session import get_db_connection
from backend.app.schemas.class_insights import ClassInsightPageSignalRead, ClassInsightRead
from backend.app.services.note_page_content import parse_page_state


router = APIRouter(tags=["class-insights"])

IMPORTANT_NOTE_KEYWORDS = (
    "시험",
    "중요",
    "암기",
    "별표",
    "나온다",
    "나올",
    "퀴즈",
    "중간",
    "기말",
    "외우",
    "필수",
    "강조",
    "체크",
    "복습",
    "정리",
    "공식",
    "주의",
)
PAGE_REFERENCE_PATTERN = re.compile(r"(\d{1,3})\s*(?:페이지|쪽|p(?:age)?\.?)", re.IGNORECASE)
COMPUTER_NETWORK_DEMO_FOLDER_KEYS = {"컴퓨터네트워크", "computernetwork", "computernetworks"}
COMPUTER_NETWORK_DEMO_DOCUMENT_KEYS = {
    "computernetworksch1wide",
    "lecturenotechapter1computernetworksandtheinternetwide",
}
COMPUTER_NETWORK_DEMO_DOCUMENT_MARKERS = (
    "computernetworksch1",
    "computernetworkschapter1",
    "computernetworksandtheinternet",
)


@dataclass
class PageInsightAccumulator:
    page_number: int
    participant_ids: set[int] = field(default_factory=set)
    note_ids: set[int] = field(default_factory=set)
    stroke_count: int = 0
    point_count: int = 0
    highlight_count: int = 0
    bookmark_count: int = 0
    keyword_hits: int = 0
    photo_reference_count: int = 0
    ai_question_count: int = 0
    memo_page_count: int = 0

    def add_activity(self, *, user_id: int, note_id: int) -> None:
        self.participant_ids.add(user_id)
        self.note_ids.add(note_id)

    @property
    def signal_count(self) -> int:
        return (
            self.stroke_count
            + self.highlight_count
            + self.bookmark_count
            + self.keyword_hits
            + self.photo_reference_count
            + self.ai_question_count
            + self.memo_page_count
            + len(self.participant_ids)
        )

    @property
    def ink_density(self) -> float:
        return min(1.0, (self.stroke_count * 0.045) + (self.point_count * 0.0015))

    def score(self) -> int:
        return min(100, round(
            self.bookmark_count * 7
            + self.highlight_count * 2.8
            + self.keyword_hits * 10
            + self.photo_reference_count * 6
            + self.ai_question_count * 5
            + self.memo_page_count * 7
            + self.ink_density * 22
            + max(0, len(self.participant_ids) - 1) * 8
            + max(0, len(self.note_ids) - 1) * 4
        ))

    def reason_tags(self) -> list[str]:
        tags: list[str] = []
        if len(self.participant_ids) >= 4:
            tags.append("여러 수강생 신호가 강하게 겹친 페이지")
        elif len(self.participant_ids) >= 2:
            tags.append("여러 수강생의 필기 흔적이 겹친 페이지")
        if self.bookmark_count > 0:
            tags.append("중요 표시가 남은 페이지")
        if self.highlight_count > 0:
            tags.append("하이라이트가 집중된 구간")
        if self.keyword_hits > 0:
            tags.append("시험/중요 관련 메모가 반복된 구간")
        if self.photo_reference_count > 0:
            tags.append("수업 사진 자료와 함께 복습할 구간")
        if self.ai_question_count > 0:
            tags.append("복습 질문이 모인 페이지")
        if self.memo_page_count > 0:
            tags.append("추가 정리/메모가 붙은 구간")
        if self.ink_density > 0.45:
            tags.append("필기 밀도가 높은 페이지")
        return tags or ["수업 필기 활동이 감지된 페이지"]


def _normalize_match_key(value: str | None) -> str:
    text = (value or "").strip().lower()
    text = re.sub(r"\.pdf$", "", text)
    return re.sub(r"[^0-9a-z가-힣]+", "", text)


def _is_computer_network_demo_document(document_key: str, folder_key: str) -> bool:
    if not document_key:
        return False
    if document_key in COMPUTER_NETWORK_DEMO_DOCUMENT_KEYS:
        return True
    if folder_key not in COMPUTER_NETWORK_DEMO_FOLDER_KEYS:
        return False
    return any(marker in document_key for marker in COMPUTER_NETWORK_DEMO_DOCUMENT_MARKERS)


def _is_same_class_document(row: dict[str, Any], current_document_key: str, current_folder_key: str) -> bool:
    document_key = _normalize_match_key(row.get("title"))
    folder_key = _normalize_match_key(row.get("folder_name"))
    if document_key and document_key == current_document_key:
        return True
    return (
        _is_computer_network_demo_document(current_document_key, current_folder_key)
        and _is_computer_network_demo_document(document_key, folder_key)
    )


def _count_keyword_hits(text: str) -> int:
    return sum(1 for keyword in IMPORTANT_NOTE_KEYWORDS if keyword in text)


def _coerce_count(value: Any) -> int:
    if isinstance(value, bool):
        return 1 if value else 0
    if isinstance(value, (int, float)):
        return max(0, int(value))
    if isinstance(value, list):
        return len(value)
    return 0


def _sum_state_counts(state: dict[str, Any], keys: tuple[str, ...]) -> int:
    return sum(_coerce_count(state.get(key)) for key in keys)


def _page_placeholders(values: set[int]) -> tuple[str, tuple[int, ...]]:
    ordered_values = tuple(sorted(values))
    placeholders = ", ".join(["%s"] * len(ordered_values))
    return placeholders, ordered_values


def _table_exists(connection: Connection, table_name: str) -> bool:
    row = fetch_one(connection, "SELECT to_regclass(%s) AS table_name", (table_name,))
    return bool(row and row.get("table_name"))


def _apply_page_state(accumulator: PageInsightAccumulator, state: dict[str, Any], *, user_id: int, note_id: int) -> None:
    had_activity = False

    ink_strokes = state.get("inkStrokes")
    if isinstance(ink_strokes, list):
        for stroke in ink_strokes:
            if not isinstance(stroke, dict):
                continue
            points = stroke.get("points")
            point_count = len(points) if isinstance(points, list) else 0
            accumulator.stroke_count += 1
            accumulator.point_count += point_count
            if stroke.get("style") == "highlight" or stroke.get("brush") == "highlighter":
                accumulator.highlight_count += 1
            had_activity = True

    text_annotations = state.get("textAnnotations")
    if isinstance(text_annotations, list):
        for annotation in text_annotations:
            if not isinstance(annotation, dict):
                continue
            text = str(annotation.get("text") or "")
            hits = _count_keyword_hits(text)
            if hits > 0:
                accumulator.keyword_hits += hits
                had_activity = True

    bookmark_count = _sum_state_counts(state, ("bookmarked", "bookmarkCount", "bookmark_count", "bookmarks"))
    photo_reference_count = _sum_state_counts(
        state,
        (
            "photoReferenceCount",
            "photo_reference_count",
            "captureReferenceCount",
            "capture_reference_count",
            "pageCaptureReferences",
            "captureReferences",
            "photoReferences",
        ),
    )
    memo_page_count = _sum_state_counts(state, ("memoPageCount", "memo_page_count", "memoPages", "generatedMemoPages"))
    if bookmark_count:
        accumulator.bookmark_count += bookmark_count
        had_activity = True
    if photo_reference_count:
        accumulator.photo_reference_count += photo_reference_count
        had_activity = True
    if memo_page_count:
        accumulator.memo_page_count += memo_page_count
        had_activity = True

    if had_activity:
        accumulator.add_activity(user_id=user_id, note_id=note_id)


def _extract_page_references(text: str) -> set[int]:
    return {
        int(match.group(1))
        for match in PAGE_REFERENCE_PATTERN.finditer(text)
        if int(match.group(1)) >= 1
    }


def _apply_ai_canvas_signals(
    accumulators: dict[int, PageInsightAccumulator],
    rows: list[dict[str, Any]],
    valid_page_numbers: set[int],
) -> None:
    for row in rows:
        start = row.get("source_page_start")
        end = row.get("source_page_end") or start
        if start is None or end is None:
            continue
        start_page = max(1, int(start))
        end_page = max(start_page, int(end))
        for page_number in range(start_page, end_page + 1):
            if page_number not in valid_page_numbers:
                continue
            accumulator = accumulators[page_number]
            accumulator.page_number = page_number
            accumulator.memo_page_count += 1
            accumulator.add_activity(user_id=int(row["user_id"]), note_id=int(row["note_id"]))


def _apply_chat_question_signals(
    accumulators: dict[int, PageInsightAccumulator],
    rows: list[dict[str, Any]],
    valid_page_numbers: set[int],
) -> None:
    for row in rows:
        for page_number in _extract_page_references(str(row.get("content") or "")):
            if page_number not in valid_page_numbers:
                continue
            accumulator = accumulators[page_number]
            accumulator.page_number = page_number
            accumulator.ai_question_count += 1
            accumulator.add_activity(user_id=int(row["user_id"]), note_id=int(row["note_id"]))


def _priority(score: int) -> str:
    if score >= 80:
        return "very-high"
    if score >= 58:
        return "high"
    return "medium"


@router.get("/notes/{note_id}/class-insights", response_model=ClassInsightRead)
def get_class_insights(
    note_id: int,
    limit: int = Query(default=5, ge=1, le=12),
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    current_note = require_row(
        fetch_one(
            connection,
            """
            SELECT n.id, n.title, f.name AS folder_name
            FROM notes n
            JOIN folders f ON f.id = n.folder_id
            WHERE n.id = %s AND n.user_id = %s
            """,
            (note_id, current_user["id"]),
        ),
        "note not found",
    )
    current_document_key = _normalize_match_key(current_note["title"])
    current_folder_key = _normalize_match_key(current_note["folder_name"])

    if _is_computer_network_demo_document(current_document_key, current_folder_key):
        candidate_rows = fetch_all(
            connection,
            """
            SELECT n.id AS note_id,
                   n.user_id,
                   n.title,
                   f.name AS folder_name,
                   p.page_number,
                   p.content
            FROM notes n
            JOIN folders f ON f.id = n.folder_id
            JOIN note_pages p ON p.note_id = n.id
            WHERE lower(n.title) = lower(%s)
               OR lower(f.name) = lower(%s)
               OR n.title ILIKE '%%computer%%network%%'
               OR n.title ILIKE '%%lecture note%%chapter 1%%'
               OR n.title ILIKE '%%computer-networks-ch1%%'
               OR f.name ILIKE '%%컴퓨터네트워크%%'
               OR f.name ILIKE '%%computer%%network%%'
            ORDER BY p.page_number ASC, p.id ASC
            """,
            (current_note["title"], current_note["folder_name"]),
        )
    else:
        candidate_rows = fetch_all(
            connection,
            """
            SELECT n.id AS note_id,
                   n.user_id,
                   n.title,
                   f.name AS folder_name,
                   p.page_number,
                   p.content
            FROM notes n
            JOIN folders f ON f.id = n.folder_id
            JOIN note_pages p ON p.note_id = n.id
            WHERE lower(n.title) = lower(%s)
               OR lower(f.name) = lower(%s)
            ORDER BY p.page_number ASC, p.id ASC
            """,
            (current_note["title"], current_note["folder_name"]),
        )

    accumulators: dict[int, PageInsightAccumulator] = defaultdict(lambda: PageInsightAccumulator(page_number=0))
    matched_note_ids: set[int] = set()
    participant_ids: set[int] = set()
    valid_page_numbers: set[int] = set()

    for row in candidate_rows:
        if not _is_same_class_document(row, current_document_key, current_folder_key):
            continue
        matched_note_ids.add(int(row["note_id"]))
        participant_ids.add(int(row["user_id"]))

        page_number = int(row["page_number"])
        valid_page_numbers.add(page_number)
        state = parse_page_state(row.get("content"))
        if state is None:
            continue

        accumulator = accumulators[page_number]
        accumulator.page_number = page_number
        _apply_page_state(accumulator, state, user_id=int(row["user_id"]), note_id=int(row["note_id"]))

    if matched_note_ids:
        note_placeholders, note_values = _page_placeholders(matched_note_ids)
        if _table_exists(connection, "ai_canvas_notes"):
            ai_canvas_rows = fetch_all(
                connection,
                f"""
                SELECT c.note_id,
                       n.user_id,
                       c.source_page_start,
                       c.source_page_end
                FROM ai_canvas_notes c
                JOIN notes n ON n.id = c.note_id
                WHERE c.note_id IN ({note_placeholders})
                  AND c.source_page_start IS NOT NULL
                """,
                note_values,
            )
            _apply_ai_canvas_signals(accumulators, ai_canvas_rows, valid_page_numbers)

        if _table_exists(connection, "chat_sessions") and _table_exists(connection, "chat_messages"):
            chat_rows = fetch_all(
                connection,
                f"""
                SELECT s.note_id,
                       n.user_id,
                       m.content
                FROM chat_sessions s
                JOIN notes n ON n.id = s.note_id
                JOIN chat_messages m ON m.session_id = s.id
                WHERE s.note_id IN ({note_placeholders})
                  AND m.role = 'user'
                  AND COALESCE(m.source, 'chat') <> 'canvas-mini'
                """,
                note_values,
            )
            _apply_chat_question_signals(accumulators, chat_rows, valid_page_numbers)

    pages = [
        ClassInsightPageSignalRead(
            page_number=accumulator.page_number,
            importance_score=score,
            priority=_priority(score),
            reason_tags=accumulator.reason_tags(),
            signal_count=accumulator.signal_count,
            bookmark_count=accumulator.bookmark_count,
            highlight_count=accumulator.highlight_count,
            keyword_hits=accumulator.keyword_hits,
            photo_reference_count=accumulator.photo_reference_count,
            ai_question_count=accumulator.ai_question_count,
            memo_page_count=accumulator.memo_page_count,
        )
        for accumulator in accumulators.values()
        if (score := accumulator.score()) >= 18
    ]
    pages.sort(key=lambda page: page.importance_score, reverse=True)

    return ClassInsightRead(
        note_id=note_id,
        matched_note_count=len(matched_note_ids),
        participant_count=len(participant_ids),
        pages=pages[:limit],
    )
