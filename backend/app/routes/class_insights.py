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
from backend.app.services.document_matching import documents_match, normalize_subject_key, subjects_match
from backend.app.services.handwriting_signals import SYMBOL_NAMES, normalize_korean_study_keywords
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
MAX_STROKES_PER_PAGE_STATE = 28
MAX_POINTS_PER_PAGE_STATE = 900
MAX_HIGHLIGHTS_PER_PAGE_STATE = 10
MAX_BOOKMARKS_PER_PAGE_STATE = 1
MAX_KEYWORD_HITS_PER_PAGE_STATE = 6
MAX_PHOTO_REFERENCES_PER_PAGE_STATE = 5
MAX_MEMO_PAGES_PER_PAGE_STATE = 4
CONTENT_HINT_MAX_CHARS = 72
STRONG_SEMANTIC_KEYWORDS = {"중요", "시험", "기말", "중간", "암기", "필수"}
PRIMARY_SEMANTIC_SYMBOLS = {"star"}
SEMANTIC_KEYWORD_WEIGHTS = {
    "시험": 20,
    "중요": 18,
    "기말": 18,
    "중간": 16,
    "암기": 14,
    "필수": 14,
}
SEMANTIC_SYMBOL_WEIGHTS = {
    "star": 22,
}


def _clean_content_hint(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip(" \t\r\n-•·:：")


def _extract_content_hint(content: str | None) -> str | None:
    state = parse_page_state(content)
    if state is None:
        return None
    pdf_text = state.get("pdfText")
    if not isinstance(pdf_text, str) or not pdf_text.strip():
        return None

    fallback = _clean_content_hint(pdf_text)
    for raw_line in pdf_text.splitlines():
        line = _clean_content_hint(raw_line)
        if len(line) < 6:
            continue
        if not re.search(r"[A-Za-z가-힣]", line):
            continue
        if re.fullmatch(r"(?:page|p\.?)?\s*\d{1,3}", line, re.IGNORECASE):
            continue
        return line[:CONTENT_HINT_MAX_CHARS]

    return fallback[:CONTENT_HINT_MAX_CHARS] if fallback else None

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
    handwriting_keyword_hits: int = 0
    handwriting_symbol_count: int = 0
    semantic_keywords: set[str] = field(default_factory=set)
    semantic_symbols: set[str] = field(default_factory=set)
    semantic_confidence_sum: float = 0.0
    semantic_signal_participant_ids: set[int] = field(default_factory=set)
    keyword_participant_counts: dict[str, set[int]] = field(default_factory=lambda: defaultdict(set))
    symbol_participant_counts: dict[str, set[int]] = field(default_factory=lambda: defaultdict(set))
    symbol_participant_weights: dict[str, dict[int, float]] = field(default_factory=lambda: defaultdict(dict))
    semantic_keyword_weight_sum: float = 0.0
    semantic_symbol_weight_sum: float = 0.0
    semantic_symbol_weight_by_symbol: dict[str, float] = field(default_factory=lambda: defaultdict(float))

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
            + self.handwriting_keyword_hits
            + self.handwriting_symbol_count
            + len(self.participant_ids)
        )

    @property
    def ink_density(self) -> float:
        return min(1.0, (self.stroke_count * 0.045) + (self.point_count * 0.0015))

    @property
    def signal_diversity(self) -> int:
        return sum(
            1
            for active in (
                self.bookmark_count > 0,
                self.highlight_count > 0,
                self.keyword_hits > 0,
                self.photo_reference_count > 0,
                self.ai_question_count > 0,
                self.memo_page_count > 0,
                self.handwriting_keyword_hits > 0,
                self.handwriting_symbol_count > 0,
                self.ink_density > 0.25,
            )
            if active
        )

    @property
    def semantic_signal_participant_count(self) -> int:
        return len(self.semantic_signal_participant_ids)

    def add_semantic_signal(
        self,
        *,
        user_id: int,
        note_id: int,
        keywords: set[str],
        symbols: set[str],
        confidence_multiplier: float,
    ) -> None:
        if confidence_multiplier <= 0 or (not keywords and not symbols):
            return
        self.add_activity(user_id=user_id, note_id=note_id)
        self.semantic_signal_participant_ids.add(user_id)
        self.semantic_confidence_sum += confidence_multiplier

        for keyword in keywords:
            if keyword not in STRONG_SEMANTIC_KEYWORDS:
                continue
            self.semantic_keywords.add(keyword)
            self.keyword_participant_counts[keyword].add(user_id)
            self.handwriting_keyword_hits += 1
            self.semantic_keyword_weight_sum += SEMANTIC_KEYWORD_WEIGHTS.get(keyword, 0) * confidence_multiplier

        for symbol in symbols:
            if symbol not in PRIMARY_SEMANTIC_SYMBOLS:
                continue
            self.semantic_symbols.add(symbol)
            self.symbol_participant_counts[symbol].add(user_id)
            self.symbol_participant_weights[symbol][user_id] = max(
                self.symbol_participant_weights[symbol].get(user_id, 0.0),
                confidence_multiplier,
            )
            self.handwriting_symbol_count += 1
            weighted_symbol_score = SEMANTIC_SYMBOL_WEIGHTS.get(symbol, 0) * confidence_multiplier
            self.semantic_symbol_weight_sum += weighted_symbol_score
            self.semantic_symbol_weight_by_symbol[symbol] += weighted_symbol_score

    def semantic_keyword_score(self) -> float:
        return min(60.0, self.semantic_keyword_weight_sum)

    def symbol_score(self) -> float:
        return min(22.0, self.semantic_symbol_weight_by_symbol.get("star", 0.0))

    def group_consensus_score(self) -> float:
        semantic_participants = len(self.semantic_signal_participant_ids)
        if semantic_participants >= 4:
            participant_score = 35.0
        elif semantic_participants == 3:
            participant_score = 24.0
        elif semantic_participants == 2:
            participant_score = 12.0
        else:
            participant_score = 0.0

        star_participants = len(self.symbol_participant_counts.get("star", set()))
        if star_participants >= 3:
            star_consensus_score = 25.0
        elif star_participants >= 2:
            star_consensus_score = 15.0
        else:
            star_consensus_score = 0.0

        return min(60.0, participant_score + star_consensus_score)

    def study_action_score(self) -> float:
        return min(28.0, (
            self.bookmark_count * 8
            + min(10.0, self.highlight_count * 2)
            + self.ai_question_count * 6
            + self.memo_page_count * 7
            + self.photo_reference_count * 4
        ))

    def raw_ink_density_score(self) -> float:
        return min(6.0, self.ink_density * 6)

    def score(self) -> int:
        legacy_text_keyword_score = min(12.0, self.keyword_hits * 4)
        return min(100, round(
            self.semantic_keyword_score()
            + self.symbol_score()
            + self.group_consensus_score()
            + self.study_action_score()
            + self.raw_ink_density_score()
            + legacy_text_keyword_score
        ))

    def reason_tags(self) -> list[str]:
        tags: list[str] = []
        if len(self.participant_ids) >= 4:
            tags.append("복습 우선도가 높게 잡힌 페이지")
        elif len(self.participant_ids) >= 2:
            tags.append("복습 신호가 겹친 페이지")
        if self.semantic_signal_participant_count >= 2:
            tags.append("여러 학생의 중요 표시가 겹친 페이지")
        if self.handwriting_keyword_hits > 0 or self.handwriting_symbol_count > 0:
            tags.append("손필기 중요 표시가 감지된 페이지")
        if "시험" in self.semantic_keywords:
            tags.append("시험 관련 손필기 표시가 있는 페이지")
        if {"중요", "암기", "필수"} & self.semantic_keywords:
            tags.append("중요/암기 표시가 있는 페이지")
        if {"기말", "중간"} & self.semantic_keywords:
            tags.append("기말/중간 대비 표시가 있는 페이지")
        if "star" in self.semantic_symbols:
            tags.append("별표로 중요 표시된 페이지")
        if self.handwriting_keyword_hits > 0 or self.handwriting_symbol_count > 0:
            tags.append("단순 필기량보다 명시적 중요 표시가 강한 페이지")
        if self.signal_diversity >= 3:
            tags.append("여러 학습 신호가 함께 모인 페이지")
        if self.bookmark_count > 0:
            tags.append("중요 표시가 반복된 페이지")
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
        if self.ink_density > 0.45 and not (self.handwriting_keyword_hits or self.handwriting_symbol_count):
            tags.append("표시가 밀집된 페이지")
        return tags or ["복습 우선도가 높은 페이지"]


def _is_same_class_document(row: dict[str, Any], current_note: dict[str, Any]) -> bool:
    if not subjects_match(
        current_note.get("folder_name"),
        row.get("folder_name"),
        current_note.get("subject_match_key"),
        row.get("subject_match_key"),
    ):
        return False
    return documents_match(current_note, row)


def _count_keyword_hits(text: str) -> int:
    return sum(1 for keyword in IMPORTANT_NOTE_KEYWORDS if keyword in text)


def _confidence_multiplier(value: Any) -> float:
    if not isinstance(value, (int, float)):
        return 0.0
    confidence = float(value)
    if confidence >= 0.80:
        return 1.0
    if confidence >= 0.60:
        return 0.75
    if confidence >= 0.40:
        return 0.45
    return 0.0


def _collect_keywords_from_recognition(value: dict[str, Any]) -> set[str]:
    keywords: set[str] = set()
    raw_keywords = value.get("keywords")
    if isinstance(raw_keywords, list):
        for keyword in raw_keywords:
            if isinstance(keyword, str):
                keywords.update(normalize_korean_study_keywords(keyword))

    text = value.get("text")
    candidates: list[str] = []
    raw_candidates = value.get("candidates")
    if isinstance(raw_candidates, list):
        for candidate in raw_candidates:
            if isinstance(candidate, str):
                candidates.append(candidate)
            elif isinstance(candidate, dict) and isinstance(candidate.get("text"), str):
                candidates.append(candidate["text"])
    if isinstance(text, str):
        keywords.update(normalize_korean_study_keywords(text, candidates))
    return keywords


def _collect_symbols_from_recognition(value: dict[str, Any]) -> set[str]:
    raw_symbols = value.get("symbols")
    if not isinstance(raw_symbols, list):
        return set()
    symbols: set[str] = set()
    for symbol in raw_symbols:
        if isinstance(symbol, str) and symbol in SYMBOL_NAMES:
            symbols.add(symbol)
        elif isinstance(symbol, dict) and isinstance(symbol.get("symbol"), str) and symbol["symbol"] in SYMBOL_NAMES:
            symbols.add(symbol["symbol"])
    return symbols


def _apply_handwriting_recognition(
    accumulator: PageInsightAccumulator,
    state: dict[str, Any],
    *,
    user_id: int,
    note_id: int,
) -> bool:
    recognition = state.get("handwritingRecognition")
    if not isinstance(recognition, dict) or recognition.get("status") != "ready":
        return False

    keyword_multipliers: dict[str, float] = {}
    symbol_multipliers: dict[str, float] = {}

    def merge_semantics(source: dict[str, Any], fallback_multiplier: float | None = None) -> None:
        multiplier = fallback_multiplier if fallback_multiplier is not None else _confidence_multiplier(source.get("confidence"))
        if multiplier <= 0:
            return
        for keyword in _collect_keywords_from_recognition(source):
            keyword_multipliers[keyword] = max(keyword_multipliers.get(keyword, 0.0), multiplier)
        for symbol in _collect_symbols_from_recognition(source):
            symbol_multipliers[symbol] = max(symbol_multipliers.get(symbol, 0.0), multiplier)

    page_multiplier = _confidence_multiplier(recognition.get("confidence"))
    merge_semantics(recognition, page_multiplier)
    clusters = recognition.get("clusters")
    if isinstance(clusters, list):
        for cluster in clusters:
            if isinstance(cluster, dict):
                cluster_multiplier = (
                    _confidence_multiplier(cluster.get("confidence"))
                    if "confidence" in cluster
                    else page_multiplier
                )
                merge_semantics(cluster, cluster_multiplier)

    applied = False
    for keyword, multiplier in keyword_multipliers.items():
        if keyword not in STRONG_SEMANTIC_KEYWORDS:
            continue
        accumulator.add_semantic_signal(
            user_id=user_id,
            note_id=note_id,
            keywords={keyword},
            symbols=set(),
            confidence_multiplier=multiplier,
        )
        applied = True
    for symbol, multiplier in symbol_multipliers.items():
        if symbol not in PRIMARY_SEMANTIC_SYMBOLS:
            continue
        accumulator.add_semantic_signal(
            user_id=user_id,
            note_id=note_id,
            keywords=set(),
            symbols={symbol},
            confidence_multiplier=multiplier,
        )
        applied = True
    return applied


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
    stroke_count = 0
    point_count = 0
    highlight_count = 0

    ink_strokes = state.get("inkStrokes")
    if isinstance(ink_strokes, list):
        for stroke in ink_strokes:
            if not isinstance(stroke, dict):
                continue
            points = stroke.get("points")
            stroke_point_count = len(points) if isinstance(points, list) else 0
            stroke_count += 1
            point_count += stroke_point_count
            if stroke.get("style") == "highlight" or stroke.get("brush") == "highlighter":
                highlight_count += 1
            had_activity = True
        accumulator.stroke_count += min(stroke_count, MAX_STROKES_PER_PAGE_STATE)
        accumulator.point_count += min(point_count, MAX_POINTS_PER_PAGE_STATE)
        accumulator.highlight_count += min(highlight_count, MAX_HIGHLIGHTS_PER_PAGE_STATE)

    keyword_hits = 0
    text_annotations = state.get("textAnnotations")
    if isinstance(text_annotations, list):
        for annotation in text_annotations:
            if not isinstance(annotation, dict):
                continue
            text = str(annotation.get("text") or "")
            hits = _count_keyword_hits(text)
            if hits > 0:
                keyword_hits += hits
                had_activity = True
        accumulator.keyword_hits += min(keyword_hits, MAX_KEYWORD_HITS_PER_PAGE_STATE)

    had_activity = _apply_handwriting_recognition(accumulator, state, user_id=user_id, note_id=note_id) or had_activity

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
        accumulator.bookmark_count += min(bookmark_count, MAX_BOOKMARKS_PER_PAGE_STATE)
        had_activity = True
    if photo_reference_count:
        accumulator.photo_reference_count += min(photo_reference_count, MAX_PHOTO_REFERENCES_PER_PAGE_STATE)
        had_activity = True
    if memo_page_count:
        accumulator.memo_page_count += min(memo_page_count, MAX_MEMO_PAGES_PER_PAGE_STATE)
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


def _collect_active_signal_sources(
    accumulators: dict[int, PageInsightAccumulator],
) -> tuple[set[int], set[int]]:
    active_participant_ids: set[int] = set()
    active_note_ids: set[int] = set()
    for accumulator in accumulators.values():
        active_participant_ids.update(accumulator.participant_ids)
        active_note_ids.update(accumulator.note_ids)
    return active_participant_ids, active_note_ids


def _is_other_user_signal(row: dict[str, Any], current_user_id: int) -> bool:
    try:
        return int(row["user_id"]) != int(current_user_id)
    except (KeyError, TypeError, ValueError):
        return False


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
            SELECT n.id,
                   n.title,
                   n.page_count,
                   n.original_filename,
                   n.file_size_bytes,
                   n.file_sha256,
                   n.subject_match_key,
                   n.document_match_key,
                   f.name AS folder_name
            FROM notes n
            JOIN folders f ON f.id = n.folder_id
            WHERE n.id = %s AND n.user_id = %s
            """,
            (note_id, current_user["id"]),
        ),
        "note not found",
    )
    current_note["subject_match_key"] = current_note.get("subject_match_key") or normalize_subject_key(current_note.get("folder_name"))
    current_page_rows = fetch_all(
        connection,
        """
        SELECT page_number,
               content
        FROM note_pages
        WHERE note_id = %s
        ORDER BY page_number ASC
        """,
        (note_id,),
    )
    content_hints_by_page = {
        int(row["page_number"]): hint
        for row in current_page_rows
        if (hint := _extract_content_hint(row.get("content")))
    }

    candidate_rows = fetch_all(
        connection,
        """
        SELECT n.id AS note_id,
               n.user_id,
               n.title,
               n.page_count,
               n.original_filename,
               n.file_size_bytes,
               n.file_sha256,
               n.subject_match_key,
               n.document_match_key,
               f.name AS folder_name,
               p.page_number,
               p.content
        FROM notes n
        JOIN folders f ON f.id = n.folder_id
        JOIN note_pages p ON p.note_id = n.id
        WHERE COALESCE(n.page_count, 0) = COALESCE(%s, 0)
           OR n.document_match_key = %s
           OR lower(n.title) = lower(%s)
        ORDER BY p.page_number ASC, p.id ASC
        """,
        (
            current_note.get("page_count"),
            current_note.get("document_match_key"),
            current_note["title"],
        ),
    )

    accumulators: dict[int, PageInsightAccumulator] = defaultdict(lambda: PageInsightAccumulator(page_number=0))
    matched_note_ids: set[int] = set()
    valid_page_numbers: set[int] = set()

    for row in candidate_rows:
        if not _is_other_user_signal(row, int(current_user["id"])):
            continue
        if not _is_same_class_document(row, current_note):
            continue
        matched_note_ids.add(int(row["note_id"]))

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
            content_hint=content_hints_by_page.get(accumulator.page_number),
            signal_count=accumulator.signal_count,
            bookmark_count=accumulator.bookmark_count,
            highlight_count=accumulator.highlight_count,
            keyword_hits=accumulator.keyword_hits,
            photo_reference_count=accumulator.photo_reference_count,
            ai_question_count=accumulator.ai_question_count,
            memo_page_count=accumulator.memo_page_count,
            handwriting_keyword_hits=accumulator.handwriting_keyword_hits,
            handwriting_symbol_count=accumulator.handwriting_symbol_count,
            semantic_keywords=sorted(accumulator.semantic_keywords),
            semantic_symbols=sorted(accumulator.semantic_symbols),
        )
        for accumulator in accumulators.values()
        if (score := accumulator.score()) >= 35
    ]
    pages.sort(key=lambda page: page.importance_score, reverse=True)
    active_participant_ids, active_note_ids = _collect_active_signal_sources(accumulators)

    return ClassInsightRead(
        note_id=note_id,
        matched_note_count=len(active_note_ids),
        participant_count=len(active_participant_ids),
        pages=pages[:limit],
    )
