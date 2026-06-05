import unittest
from collections import defaultdict

from backend.app.routes.class_insights import (
    MAX_HIGHLIGHTS_PER_PAGE_STATE,
    MAX_STROKES_PER_PAGE_STATE,
    PageInsightAccumulator,
    _apply_chat_question_signals,
    _apply_page_state,
    _collect_active_signal_sources,
    _extract_content_hint,
    _is_other_user_signal,
)
from backend.app.services.note_page_content import merge_page_state_content, parse_page_state


class ClassInsightSignalTest(unittest.TestCase):
    def test_page_state_counts_multiple_signal_types(self):
        accumulator = PageInsightAccumulator(page_number=13)
        _apply_page_state(
            accumulator,
            {
                "kind": "bsnap-page-state",
                "version": 1,
                "inkStrokes": [
                    {"points": [{"x": 1, "y": 1}], "style": "pen"},
                    {"points": [{"x": 1, "y": 1}, {"x": 2, "y": 2}], "style": "highlight"},
                ],
                "textAnnotations": [{"text": "시험 중요 암기"}],
                "bookmarked": True,
                "photoReferences": [{"id": "capture-1"}],
                "memoPageCount": 2,
            },
            user_id=7,
            note_id=11,
        )

        self.assertEqual(accumulator.stroke_count, 2)
        self.assertEqual(accumulator.highlight_count, 1)
        self.assertEqual(accumulator.keyword_hits, 3)
        self.assertEqual(accumulator.bookmark_count, 1)
        self.assertEqual(accumulator.photo_reference_count, 1)
        self.assertEqual(accumulator.memo_page_count, 2)
        self.assertIn(7, accumulator.participant_ids)
        self.assertGreater(accumulator.score(), 0)
        self.assertIn("중요 표시가 반복된 페이지", accumulator.reason_tags())

    def test_page_state_caps_single_user_noisy_signals(self):
        accumulator = PageInsightAccumulator(page_number=7)
        _apply_page_state(
            accumulator,
            {
                "kind": "bsnap-page-state",
                "version": 1,
                "inkStrokes": [
                    {"points": [{"x": index, "y": index}], "style": "highlight"}
                    for index in range(80)
                ],
                "textAnnotations": [
                    {"text": "시험 중요 암기 별표 나온다 퀴즈 중간 기말 외우 필수"},
                    {"text": "시험 중요 암기 별표 나온다 퀴즈 중간 기말 외우 필수"},
                ],
                "bookmarks": [1, 2, 3],
                "photoReferences": [{"id": str(index)} for index in range(20)],
                "memoPages": list(range(20)),
            },
            user_id=7,
            note_id=11,
        )

        self.assertEqual(accumulator.stroke_count, MAX_STROKES_PER_PAGE_STATE)
        self.assertEqual(accumulator.highlight_count, MAX_HIGHLIGHTS_PER_PAGE_STATE)
        self.assertEqual(accumulator.bookmark_count, 1)
        self.assertEqual(accumulator.keyword_hits, 6)
        self.assertEqual(accumulator.photo_reference_count, 5)
        self.assertEqual(accumulator.memo_page_count, 4)
        self.assertIn("여러 학습 신호가 함께 모인 페이지", accumulator.reason_tags())

    def test_chat_question_signals_use_explicit_page_references(self):
        accumulators = defaultdict(lambda: PageInsightAccumulator(page_number=0))
        _apply_chat_question_signals(
            accumulators,
            [{"user_id": 3, "note_id": 9, "content": "13페이지와 21쪽 중 어디가 중요한가요?"}],
            {13},
        )

        self.assertEqual(accumulators[13].ai_question_count, 1)
        self.assertNotIn(21, accumulators)

    def test_extract_content_hint_uses_pdf_text(self):
        content = merge_page_state_content(
            None,
            None,
            pdf_text="\n3\n\nBellman Expectation Equation\n상태 가치 함수를 계산하는 핵심 식입니다.",
        )

        self.assertEqual(_extract_content_hint(content), "Bellman Expectation Equation")

    def test_active_signal_sources_ignore_empty_uploads(self):
        accumulators = {
            1: PageInsightAccumulator(page_number=1),
            2: PageInsightAccumulator(page_number=2),
        }
        accumulators[2].add_activity(user_id=7, note_id=11)

        participant_ids, note_ids = _collect_active_signal_sources(accumulators)

        self.assertEqual(participant_ids, {7})
        self.assertEqual(note_ids, {11})

    def test_current_user_signals_are_not_used_for_class_insights(self):
        self.assertFalse(_is_other_user_signal({"user_id": 7}, 7))
        self.assertTrue(_is_other_user_signal({"user_id": 8}, 7))

    def test_page_state_merge_preserves_importance_signal_summary(self):
        content = merge_page_state_content(
            None,
            """
            {
              "kind": "bsnap-page-state",
              "version": 1,
              "inkStrokes": [],
              "textAnnotations": [],
              "bookmarked": true,
              "photoReferenceCount": 2,
              "memoPageCount": 1
            }
            """,
            pdf_text="network core",
        )
        state = parse_page_state(content)

        self.assertIsNotNone(state)
        self.assertTrue(state["bookmarked"])
        self.assertEqual(state["photoReferenceCount"], 2)
        self.assertEqual(state["memoPageCount"], 1)
        self.assertEqual(state["pdfText"], "network core")


if __name__ == "__main__":
    unittest.main()
