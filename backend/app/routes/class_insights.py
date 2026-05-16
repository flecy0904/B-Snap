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

IMPORTANT_NOTE_KEYWORDS = ("시험", "중요", "암기", "별표", "나온다", "나올", "퀴즈", "중간", "기말", "외우", "필수")


@dataclass
class PageInsightAccumulator:
    page_number: int
    participant_ids: set[int] = field(default_factory=set)
    note_ids: set[int] = field(default_factory=set)
    stroke_count: int = 0
    point_count: int = 0
    highlight_count: int = 0
    keyword_hits: int = 0

    def add_activity(self, *, user_id: int, note_id: int) -> None:
        self.participant_ids.add(user_id)
        self.note_ids.add(note_id)

    @property
    def signal_count(self) -> int:
        return self.stroke_count + self.highlight_count + self.keyword_hits + len(self.participant_ids)

    @property
    def ink_density(self) -> float:
        return min(1.0, (self.stroke_count * 0.045) + (self.point_count * 0.0015))

    def score(self) -> int:
        return min(100, round(
            self.highlight_count * 2.4
            + self.keyword_hits * 9
            + self.ink_density * 20
            + max(0, len(self.participant_ids) - 1) * 7
            + max(0, len(self.note_ids) - 1) * 4
        ))

    def reason_tags(self) -> list[str]:
        tags: list[str] = []
        if len(self.participant_ids) >= 2:
            tags.append("여러 수강생의 필기 흔적이 겹친 페이지")
        if self.highlight_count > 0:
            tags.append("하이라이트가 집중된 구간")
        if self.keyword_hits > 0:
            tags.append("시험/중요 관련 메모가 반복된 구간")
        if self.ink_density > 0.45:
            tags.append("필기 밀도가 높은 페이지")
        return tags or ["수업 필기 활동이 감지된 페이지"]


def _normalize_match_key(value: str | None) -> str:
    text = (value or "").strip().lower()
    text = re.sub(r"\.pdf$", "", text)
    return re.sub(r"[^0-9a-z가-힣]+", "", text)


def _is_same_class_document(row: dict[str, Any], current_document_key: str, current_folder_key: str) -> bool:
    document_key = _normalize_match_key(row.get("title"))
    folder_key = _normalize_match_key(row.get("folder_name"))
    if document_key and document_key == current_document_key:
        return True
    return bool(current_folder_key and folder_key == current_folder_key and document_key == current_document_key)


def _count_keyword_hits(text: str) -> int:
    return sum(1 for keyword in IMPORTANT_NOTE_KEYWORDS if keyword in text)


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

    if had_activity:
        accumulator.add_activity(user_id=user_id, note_id=note_id)


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

    for row in candidate_rows:
        if not _is_same_class_document(row, current_document_key, current_folder_key):
            continue
        matched_note_ids.add(int(row["note_id"]))
        participant_ids.add(int(row["user_id"]))

        page_number = int(row["page_number"])
        state = parse_page_state(row.get("content"))
        if state is None:
            continue

        accumulator = accumulators[page_number]
        accumulator.page_number = page_number
        _apply_page_state(accumulator, state, user_id=int(row["user_id"]), note_id=int(row["note_id"]))

    pages = [
        ClassInsightPageSignalRead(
            page_number=accumulator.page_number,
            importance_score=score,
            priority=_priority(score),
            reason_tags=accumulator.reason_tags(),
            signal_count=accumulator.signal_count,
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
