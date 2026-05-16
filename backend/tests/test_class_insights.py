import unittest
from collections import defaultdict

from backend.app.routes.class_insights import (
    PageInsightAccumulator,
    _apply_chat_question_signals,
    _apply_page_state,
)


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
        self.assertIn("중요 표시가 남은 페이지", accumulator.reason_tags())

    def test_chat_question_signals_use_explicit_page_references(self):
        accumulators = defaultdict(lambda: PageInsightAccumulator(page_number=0))
        _apply_chat_question_signals(
            accumulators,
            [{"user_id": 3, "note_id": 9, "content": "13페이지와 21쪽 중 어디가 중요한가요?"}],
            {13},
        )

        self.assertEqual(accumulators[13].ai_question_count, 1)
        self.assertNotIn(21, accumulators)


if __name__ == "__main__":
    unittest.main()
