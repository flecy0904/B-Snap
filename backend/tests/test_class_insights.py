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
from backend.scripts.seed_handwriting_semantic_demo import build_demo_page_state
from backend.app.services.note_page_content import merge_page_state_content, parse_page_state


def _recognition_state(*, keywords=None, symbols=None, confidence=0.91, text=""):
    return {
        "kind": "bsnap-page-state",
        "version": 1,
        "inkStrokes": [],
        "textAnnotations": [],
        "handwritingRecognition": {
            "status": "ready",
            "strokeHash": "hash",
            "engine": "geometry",
            "text": text,
            "keywords": keywords or [],
            "symbols": symbols or [],
            "confidence": confidence,
            "clusters": [],
        },
    }


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

    def test_handwriting_keywords_increase_semantic_hits(self):
        accumulator = PageInsightAccumulator(page_number=3)
        _apply_page_state(
            accumulator,
            _recognition_state(keywords=["중요", "시험"]),
            user_id=8,
            note_id=12,
        )

        self.assertEqual(accumulator.handwriting_keyword_hits, 2)
        self.assertIn("중요", accumulator.semantic_keywords)
        self.assertGreater(accumulator.score(), 30)

    def test_handwriting_symbols_increase_symbol_count(self):
        accumulator = PageInsightAccumulator(page_number=3)
        _apply_page_state(
            accumulator,
            _recognition_state(symbols=["star", "check"]),
            user_id=8,
            note_id=12,
        )

        self.assertEqual(accumulator.handwriting_symbol_count, 1)
        self.assertIn("star", accumulator.semantic_symbols)
        self.assertNotIn("check", accumulator.semantic_symbols)
        self.assertIn("손필기 중요 표시가 감지된 페이지", accumulator.reason_tags())

    def test_star_scores_higher_than_check_and_circle(self):
        star = PageInsightAccumulator(page_number=1)
        check_circle = PageInsightAccumulator(page_number=1)
        _apply_page_state(star, _recognition_state(symbols=["star"]), user_id=8, note_id=12)
        _apply_page_state(check_circle, _recognition_state(symbols=["check", "circle"]), user_id=8, note_id=12)

        self.assertGreater(star.score(), check_circle.score())
        self.assertLess(check_circle.score(), 35)

    def test_check_circle_box_underline_do_not_significantly_increase_score(self):
        weak_symbols = PageInsightAccumulator(page_number=1)
        _apply_page_state(
            weak_symbols,
            _recognition_state(symbols=["check", "circle", "box", "underline"]),
            user_id=8,
            note_id=12,
        )

        self.assertEqual(weak_symbols.handwriting_symbol_count, 0)
        self.assertEqual(weak_symbols.symbol_score(), 0)
        self.assertLess(weak_symbols.score(), 35)

    def test_page_with_star_outranks_check_circle_only_page(self):
        star = PageInsightAccumulator(page_number=1)
        weak = PageInsightAccumulator(page_number=2)
        _apply_page_state(star, _recognition_state(symbols=["star"]), user_id=8, note_id=12)
        for user_id in (8, 9, 10):
            _apply_page_state(weak, _recognition_state(symbols=["check", "circle", "underline"]), user_id=user_id, note_id=user_id + 20)

        self.assertGreater(star.score(), weak.score())
        self.assertLess(weak.score(), 35)

    def test_random_raw_strokes_do_not_outrank_semantic_page(self):
        noisy = PageInsightAccumulator(page_number=1)
        semantic = PageInsightAccumulator(page_number=2)
        _apply_page_state(
            noisy,
            {
                "kind": "bsnap-page-state",
                "version": 1,
                "inkStrokes": [
                    {"points": [{"x": index, "y": index}], "style": "pen"}
                    for index in range(200)
                ],
                "textAnnotations": [],
            },
            user_id=8,
            note_id=12,
        )
        for user_id in (8, 9, 10):
            _apply_page_state(
                semantic,
                _recognition_state(keywords=["중요", "시험"], symbols=["star"]),
                user_id=user_id,
                note_id=user_id + 20,
            )

        self.assertLess(noisy.score(), 35)
        self.assertGreater(semantic.score(), noisy.score())
        self.assertEqual(semantic.score(), 100)

    def test_multiple_participants_with_same_keyword_get_consensus_boost(self):
        one = PageInsightAccumulator(page_number=1)
        three = PageInsightAccumulator(page_number=1)
        _apply_page_state(one, _recognition_state(keywords=["중요"]), user_id=8, note_id=12)
        for user_id in (8, 9, 10):
            _apply_page_state(three, _recognition_state(keywords=["중요"]), user_id=user_id, note_id=user_id + 20)

        self.assertGreater(three.group_consensus_score(), one.group_consensus_score())
        self.assertGreater(three.score(), one.score())

    def test_multiple_participants_with_star_get_strong_star_consensus(self):
        one = PageInsightAccumulator(page_number=1)
        three = PageInsightAccumulator(page_number=1)
        _apply_page_state(one, _recognition_state(symbols=["star"]), user_id=8, note_id=12)
        for user_id in (8, 9, 10):
            _apply_page_state(three, _recognition_state(symbols=["star"]), user_id=user_id, note_id=user_id + 20)

        self.assertEqual(three.symbol_score(), 22)
        self.assertGreaterEqual(three.group_consensus_score(), 49)
        self.assertGreater(three.score(), one.score())

    def test_raw_stroke_density_alone_cannot_produce_very_high_priority(self):
        noisy = PageInsightAccumulator(page_number=1)
        _apply_page_state(
            noisy,
            {
                "kind": "bsnap-page-state",
                "version": 1,
                "inkStrokes": [
                    {"points": [{"x": index, "y": index}], "style": "pen"}
                    for index in range(400)
                ],
                "textAnnotations": [],
            },
            user_id=8,
            note_id=12,
        )

        self.assertLess(noisy.score(), 35)

    def test_check_circle_underline_only_cannot_produce_very_high_priority(self):
        weak = PageInsightAccumulator(page_number=1)
        for user_id in (8, 9, 10, 11):
            _apply_page_state(
                weak,
                _recognition_state(symbols=["check", "circle", "underline"], confidence=0.95),
                user_id=user_id,
                note_id=user_id + 20,
            )

        self.assertLess(weak.score(), 35)

    def test_persisted_mlkit_keyword_important_is_strong_semantic_signal(self):
        accumulator = PageInsightAccumulator(page_number=1)
        _apply_page_state(
            accumulator,
            _recognition_state(keywords=[], text="중요", confidence=0.87),
            user_id=8,
            note_id=12,
        )

        self.assertIn("중요", accumulator.semantic_keywords)
        self.assertGreaterEqual(accumulator.semantic_keyword_score(), 18)

    def test_low_confidence_recognition_has_reduced_impact(self):
        high = PageInsightAccumulator(page_number=1)
        low = PageInsightAccumulator(page_number=1)
        _apply_page_state(high, _recognition_state(keywords=["시험"], confidence=0.91), user_id=8, note_id=12)
        _apply_page_state(low, _recognition_state(keywords=["시험"], confidence=0.45), user_id=8, note_id=12)

        self.assertGreater(high.score(), low.score())

    def test_old_page_state_without_handwriting_recognition_still_works(self):
        accumulator = PageInsightAccumulator(page_number=1)
        _apply_page_state(
            accumulator,
            {
                "kind": "bsnap-page-state",
                "version": 1,
                "inkStrokes": [{"points": [{"x": 1, "y": 1}], "style": "pen"}],
                "textAnnotations": [],
            },
            user_id=8,
            note_id=12,
        )

        self.assertEqual(accumulator.handwriting_keyword_hits, 0)
        self.assertEqual(accumulator.handwriting_symbol_count, 0)
        self.assertGreaterEqual(accumulator.stroke_count, 1)

    def test_reason_tags_include_semantic_handwriting_reasons(self):
        accumulator = PageInsightAccumulator(page_number=1)
        for user_id in (8, 9, 10):
            _apply_page_state(
                accumulator,
                _recognition_state(keywords=["기말"], symbols=["star"]),
                user_id=user_id,
                note_id=user_id + 20,
            )

        tags = accumulator.reason_tags()
        self.assertIn("기말/중간 대비 표시가 있는 페이지", tags)
        self.assertIn("별표로 중요 표시된 페이지", tags)
        self.assertIn("여러 학생의 중요 표시가 겹친 페이지", tags)

    def test_semantic_demo_data_ranks_explicit_signals_above_random_strokes(self):
        page_13 = PageInsightAccumulator(page_number=13)
        page_75 = PageInsightAccumulator(page_number=75)
        for participant_index, user_id in enumerate((8, 9, 10), start=1):
            _apply_page_state(
                page_13,
                parse_page_state(build_demo_page_state(13, participant_index)),
                user_id=user_id,
                note_id=user_id + 20,
            )
            _apply_page_state(
                page_75,
                parse_page_state(build_demo_page_state(75, participant_index)),
                user_id=user_id,
                note_id=user_id + 30,
            )

        self.assertGreater(page_13.score(), page_75.score())
        self.assertEqual(page_13.symbol_score(), 22)
        self.assertGreaterEqual(page_13.group_consensus_score(), 49)
        self.assertLess(page_75.score(), 35)

    def test_semantic_demo_cluster_bbox_shape_is_valid_for_debug_overlay(self):
        state = parse_page_state(build_demo_page_state(13, 1))
        cluster = state["handwritingRecognition"]["clusters"][0]

        self.assertEqual(cluster["pageNumber"], 13)
        self.assertGreater(cluster["bbox"]["width"], 0)
        self.assertGreater(cluster["bbox"]["height"], 0)
        self.assertIn(cluster["source"], {"geometry", "openai-vision", "hybrid"})


if __name__ == "__main__":
    unittest.main()
