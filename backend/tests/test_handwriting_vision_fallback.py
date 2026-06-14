import json
import unittest
from unittest.mock import patch

from backend.app.routes.notes import (
    _analyze_page_handwriting_content,
    _consume_note_vision_budget,
    _merge_geometry_and_vision_recognition,
)
from backend.app.services.handwriting_signals import stable_stroke_hash
from backend.app.services.handwriting_vision_fallback import (
    analyze_handwriting_image_with_openai,
    clear_vision_result_cache_for_tests,
    render_ink_cluster_to_png,
)
from backend.app.services.note_page_content import parse_page_state


def _stroke(points, **extra):
    return {
        "id": extra.pop("id", "stroke"),
        "style": extra.pop("style", "pen"),
        "brush": extra.pop("brush", "ballpoint"),
        "width": extra.pop("width", 3),
        "color": extra.pop("color", "#1F2937"),
        "points": [{"x": x, "y": y, "pageNumber": extra.get("pageNumber", 1)} for x, y in points],
        **extra,
    }


def _star_strokes():
    return [
        _stroke([(50, 8), (50, 92)], id="star-vertical"),
        _stroke([(10, 50), (90, 50)], id="star-horizontal"),
        _stroke([(18, 18), (82, 82)], id="star-diagonal-1"),
        _stroke([(18, 82), (82, 18)], id="star-diagonal-2"),
    ]


def _one_stroke_star():
    return _stroke(
        [
            (50, 6),
            (66, 88),
            (6, 34),
            (94, 34),
            (34, 88),
            (50, 6),
        ],
        id="one-stroke-star",
    )


def _keyword_like_strokes(x=180, y=24, *, prefix="text"):
    return [
        _stroke([(x, y + 34), (x + 18, y), (x + 36, y + 34)], id=f"{prefix}-a"),
        _stroke([(x + 48, y), (x + 48, y + 36), (x + 72, y + 36)], id=f"{prefix}-b"),
        _stroke([(x + 4, y + 48), (x + 76, y + 48)], id=f"{prefix}-underline"),
    ]


def _loose_keyword_stroke(x=180, y=24):
    return _stroke(
        [
            (x, y + 34),
            (x + 10, y + 10),
            (x + 22, y + 2),
            (x + 34, y + 28),
            (x + 46, y + 8),
            (x + 58, y + 36),
            (x + 72, y + 20),
            (x + 84, y + 40),
        ],
        id="loose-keyword",
    )


def _content(strokes, recognition=None, **extra_state):
    return json.dumps({
        "kind": "bsnap-page-state",
        "version": 1,
        "inkStrokes": strokes,
        "textAnnotations": [],
        "imageAnnotations": [],
        "bookmarked": False,
        "photoReferenceCount": 0,
        "memoPageCount": 0,
        **extra_state,
        **({"handwritingRecognition": recognition} if recognition else {}),
    }, ensure_ascii=False)


class HandwritingVisionFallbackTest(unittest.TestCase):
    def setUp(self):
        clear_vision_result_cache_for_tests()

    def test_render_ink_cluster_to_png_returns_non_empty_png_bytes(self):
        png = render_ink_cluster_to_png({
            "bbox": {"x": 0, "y": 0, "width": 80, "height": 40},
            "strokes": [_stroke([(0, 0), (40, 30), (80, 4)])],
        })

        self.assertTrue(png.startswith(b"\x89PNG"))
        self.assertGreater(len(png), 64)

    def test_disabled_fallback_returns_unavailable_without_exception(self):
        with patch.dict("os.environ", {"HANDWRITING_VISION_FALLBACK_ENABLED": "false"}, clear=False):
            result = analyze_handwriting_image_with_openai(b"image", stroke_hash="hash")

        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["engine"], "openai-vision")

    def test_disabled_fallback_records_skipped_reason_on_recognition(self):
        strokes = [
            _stroke([(0, 0), (40, 20), (80, 0)], id="a"),
            _stroke([(4, 30), (44, 44), (84, 32)], id="b"),
        ]
        with patch.dict("os.environ", {"HANDWRITING_VISION_FALLBACK_ENABLED": "false"}, clear=False):
            next_content, status = _analyze_page_handwriting_content(
                _content(strokes),
                force=True,
                use_vision_fallback=True,
            )

        state = parse_page_state(next_content)
        recognition = state["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        self.assertFalse(recognition["visionFallbackUsed"])
        self.assertEqual(recognition["visionFallbackSkippedReason"], "disabled")
        self.assertGreaterEqual(recognition["analyzedClusterCount"], 1)

    def test_enabled_fallback_without_api_key_records_missing_key(self):
        strokes = [
            _stroke([(0, 0), (40, 20), (80, 0)], id="a"),
            _stroke([(4, 30), (44, 44), (84, 32)], id="b"),
        ]
        with patch.dict("os.environ", {"HANDWRITING_VISION_FALLBACK_ENABLED": "true"}, clear=True):
            next_content, status = _analyze_page_handwriting_content(
                _content(strokes),
                force=True,
                use_vision_fallback=True,
            )

        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        self.assertFalse(recognition["visionFallbackUsed"])
        self.assertEqual(recognition["visionFallbackSkippedReason"], "missing-api-key")

    def test_invalid_openai_json_is_handled_safely(self):
        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.services.handwriting_vision_fallback._call_openai_vision", return_value="not json"):
                result = analyze_handwriting_image_with_openai(b"invalid-json-image", stroke_hash="hash-json")

        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["keywords"], [])

    def test_same_stroke_hash_uses_cached_openai_result(self):
        raw = json.dumps({"text": "중요", "keywords": ["중요"], "symbols": [], "confidence": 0.84})
        with patch.dict("os.environ", {"HANDWRITING_VISION_FALLBACK_ENABLED": "true", "OPENAI_API_KEY": "test"}, clear=False):
            with patch("backend.app.services.handwriting_vision_fallback._call_openai_vision", return_value=raw) as openai_mock:
                first = analyze_handwriting_image_with_openai(b"same-image", stroke_hash="same-hash")
                second = analyze_handwriting_image_with_openai(b"same-image", stroke_hash="same-hash")

        self.assertEqual(first["status"], "ready")
        self.assertFalse(first["cached"])
        self.assertTrue(second["cached"])
        self.assertEqual(openai_mock.call_count, 1)

    def test_openai_exception_does_not_break_analyze_handwriting(self):
        strokes = [*_star_strokes(), *_keyword_like_strokes()]
        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai", side_effect=RuntimeError("boom")):
                next_content, status = _analyze_page_handwriting_content(
                    _content(strokes),
                    force=True,
                    use_vision_fallback=True,
                )

        state = parse_page_state(next_content)
        self.assertEqual(status, "failed")
        self.assertIsNotNone(state)
        self.assertEqual(state["handwritingRecognition"]["status"], "failed")

    def test_starless_page_skips_vision_without_openai_call(self):
        strokes = [
            _stroke([(0, 0), (18, 34), (36, 0)], id="text-a"),
            _stroke([(48, 0), (48, 36), (72, 36)], id="text-b"),
            _stroke([(4, 48), (76, 48)], id="text-c"),
        ]
        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai") as openai_mock:
                next_content, status = _analyze_page_handwriting_content(
                    _content(strokes),
                    force=True,
                    use_vision_fallback=True,
                )

        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        openai_mock.assert_not_called()
        self.assertFalse(recognition["visionFallbackUsed"])
        self.assertEqual(recognition["visionFallbackSkippedReason"], "no-star-anchor")

    def test_starless_page_with_strong_auxiliary_signals_uses_vision(self):
        strokes = [
            *_keyword_like_strokes(180, 24, prefix="aux-text"),
            _stroke([(12, 120), (120, 120)], id="highlight-1", style="highlight", brush="highlighter"),
            _stroke([(12, 138), (120, 138)], id="highlight-2", style="highlight", brush="highlighter"),
        ]
        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MAX_CLUSTERS_PER_PAGE": "4",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai", return_value={
                "status": "ready",
                "text": "중요",
                "keywords": ["중요"],
                "symbols": [],
                "confidence": 0.9,
            }) as openai_mock:
                next_content, status = _analyze_page_handwriting_content(
                    _content(
                        strokes,
                        bookmarked=True,
                        photoReferenceCount=5,
                    ),
                    use_vision_fallback=True,
                )

        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        self.assertGreaterEqual(openai_mock.call_count, 1)
        self.assertTrue(recognition["visionFallbackUsed"])
        self.assertIn("중요", recognition["keywords"])

    def test_strong_auxiliary_signals_retry_previous_no_star_skip(self):
        strokes = [
            *_keyword_like_strokes(180, 24, prefix="retry-text"),
            _stroke([(12, 120), (120, 120)], id="retry-highlight-1", style="highlight", brush="highlighter"),
            _stroke([(12, 138), (120, 138)], id="retry-highlight-2", style="highlight", brush="highlighter"),
        ]
        stroke_hash = stable_stroke_hash(strokes)
        content = _content(
            strokes,
            {
                "status": "ready",
                "strokeHash": stroke_hash,
                "engine": "geometry",
                "text": "",
                "keywords": [],
                "symbols": [],
                "confidence": 0.0,
                "clusters": [],
                "visionFallbackUsed": False,
                "visionFallbackSkippedReason": "no-star-anchor",
            },
            bookmarked=True,
            photoReferenceCount=5,
        )

        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MAX_CLUSTERS_PER_PAGE": "4",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai", return_value={
                "status": "ready",
                "text": "시험",
                "keywords": ["시험"],
                "symbols": [],
                "confidence": 0.9,
            }) as openai_mock:
                next_content, status = _analyze_page_handwriting_content(
                    content,
                    use_vision_fallback=True,
                )

        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        self.assertGreaterEqual(openai_mock.call_count, 1)
        self.assertTrue(recognition["visionFallbackUsed"])
        self.assertIn("시험", recognition["keywords"])

    def test_star_page_sends_handwriting_clusters_to_vision(self):
        strokes = [
            *_star_strokes(),
            *_keyword_like_strokes(190, 24, prefix="near"),
            *_keyword_like_strokes(620, 24, prefix="far"),
        ]
        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MAX_CLUSTERS_PER_PAGE": "5",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai", return_value={
                "status": "ready",
                "text": "중요",
                "keywords": ["중요"],
                "symbols": [],
                "confidence": 0.9,
            }) as openai_mock:
                next_content, status = _analyze_page_handwriting_content(
                    _content(strokes),
                    force=True,
                    use_vision_fallback=True,
                )

        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        self.assertEqual(openai_mock.call_count, 2)
        self.assertTrue(recognition["visionFallbackUsed"])
        self.assertEqual(recognition["visionAnalyzedClusterCount"], 2)
        self.assertIn("중요", recognition["keywords"])

    def test_star_page_sends_loose_near_handwriting_cluster_to_vision(self):
        strokes = [
            *_star_strokes(),
            _loose_keyword_stroke(190, 24),
        ]
        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MAX_CLUSTERS_PER_PAGE": "5",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai", return_value={
                "status": "ready",
                "text": "시험",
                "keywords": ["시험"],
                "symbols": [],
                "confidence": 0.9,
            }) as openai_mock:
                next_content, status = _analyze_page_handwriting_content(
                    _content(strokes),
                    force=True,
                    use_vision_fallback=True,
                )

        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        self.assertEqual(openai_mock.call_count, 1)
        self.assertTrue(recognition["visionFallbackUsed"])
        self.assertIn("시험", recognition["keywords"])

    def test_pure_star_page_does_not_call_vision_when_not_needed(self):
        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai") as openai_mock:
                next_content, status = _analyze_page_handwriting_content(
                    _content(_star_strokes()),
                    use_vision_fallback=True,
                )

        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        openai_mock.assert_not_called()
        self.assertFalse(recognition["visionFallbackUsed"])
        self.assertEqual(recognition["visionFallbackSkippedReason"], "not-needed")

    def test_text_like_cluster_with_star_like_crossing_can_trigger_vision(self):
        strokes = [
            *_star_strokes(),
            *_keyword_like_strokes(90, 24, prefix="attached"),
        ]
        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MAX_CLUSTERS_PER_PAGE": "2",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai", return_value={
                "status": "ready",
                "text": "중요",
                "keywords": ["중요"],
                "symbols": [],
                "confidence": 0.9,
            }) as openai_mock:
                next_content, status = _analyze_page_handwriting_content(
                    _content(strokes),
                    force=True,
                    use_vision_fallback=True,
                )

        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        self.assertEqual(openai_mock.call_count, 1)
        self.assertTrue(recognition["visionFallbackUsed"])
        self.assertEqual(recognition["visionAnalyzedClusterCount"], 1)
        self.assertNotIn("star", recognition["symbols"])
        self.assertIn("중요", recognition["keywords"])

    def test_text_like_cluster_with_one_stroke_star_can_trigger_vision(self):
        strokes = [
            _one_stroke_star(),
            *_keyword_like_strokes(92, 24, prefix="attached-one-stroke"),
        ]
        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MAX_CLUSTERS_PER_PAGE": "2",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai", return_value={
                "status": "ready",
                "text": "중요",
                "keywords": ["중요"],
                "symbols": [],
                "confidence": 0.9,
            }) as openai_mock:
                next_content, status = _analyze_page_handwriting_content(
                    _content(strokes),
                    force=True,
                    use_vision_fallback=True,
                )

        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        self.assertEqual(openai_mock.call_count, 1)
        self.assertTrue(recognition["visionFallbackUsed"])
        self.assertEqual(recognition["visionAnalyzedClusterCount"], 1)
        self.assertIn("중요", recognition["keywords"])

    def test_force_bypasses_stroke_hash_skip(self):
        strokes = [_stroke([(0, 0), (40, 20), (80, 0)])]
        stroke_hash = stable_stroke_hash(strokes)
        content = _content(strokes, {
            "status": "ready",
            "strokeHash": stroke_hash,
            "engine": "geometry",
            "text": "",
            "keywords": [],
            "symbols": [],
            "confidence": 0.0,
            "clusters": [],
        })

        skipped_content, skipped_status = _analyze_page_handwriting_content(content)
        forced_content, forced_status = _analyze_page_handwriting_content(content, force=True)

        self.assertEqual(skipped_status, "skipped")
        self.assertEqual(skipped_content, content)
        self.assertEqual(forced_status, "analyzed")
        self.assertNotEqual(forced_content, content)

    def test_backend_analysis_replaces_existing_mlkit_result_for_same_strokes(self):
        strokes = [_stroke([(0, 0), (40, 20), (80, 0)], id="plain-ink")]
        stroke_hash = stable_stroke_hash(strokes)
        content = _content(strokes, {
            "status": "ready",
            "strokeHash": stroke_hash,
            "engine": "mlkit-digital-ink",
            "text": "중요",
            "keywords": ["중요"],
            "symbols": [],
            "confidence": 0.82,
            "clusters": [{
                "id": "mlkit-cluster-1",
                "pageNumber": 1,
                "bbox": {"x": 0, "y": 0, "width": 80, "height": 20},
                "text": "중요",
                "candidates": [{"text": "중요", "confidence": 0.82}],
                "keywords": ["중요"],
                "symbols": [],
                "confidence": 0.82,
                "source": "mlkit-digital-ink",
            }],
        })

        next_content, status = _analyze_page_handwriting_content(content)

        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        self.assertEqual(recognition["engine"], "geometry")
        self.assertEqual(recognition["text"], "")
        self.assertNotIn("중요", recognition["keywords"])
        self.assertTrue(all(cluster.get("source") == "geometry" for cluster in recognition["clusters"]))

    def test_vision_request_retries_same_hash_when_previous_result_was_geometry_only(self):
        strokes = [
            *_star_strokes(),
            *_keyword_like_strokes(190, 24, prefix="near"),
        ]
        stroke_hash = stable_stroke_hash(strokes)
        content = _content(strokes, {
            "status": "ready",
            "strokeHash": stroke_hash,
            "engine": "geometry",
            "text": "",
            "keywords": [],
            "symbols": ["star"],
            "confidence": 0.9,
            "clusters": [],
            "visionFallbackUsed": False,
            "visionFallbackSkippedReason": "not-requested",
        })

        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MAX_CLUSTERS_PER_PAGE": "2",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai", return_value={
                "status": "ready",
                "text": "중요",
                "keywords": ["중요"],
                "symbols": [],
                "confidence": 0.9,
            }) as openai_mock:
                next_content, status = _analyze_page_handwriting_content(
                    content,
                    use_vision_fallback=True,
                )

        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        self.assertEqual(openai_mock.call_count, 1)
        self.assertTrue(recognition["visionFallbackUsed"])
        self.assertIn("중요", recognition["keywords"])

    def test_successful_vision_result_skips_second_same_hash_analysis(self):
        strokes = [
            *_star_strokes(),
            *_keyword_like_strokes(190, 24, prefix="converged"),
        ]

        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MAX_CLUSTERS_PER_PAGE": "1",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai", return_value={
                "status": "ready",
                "text": "중요",
                "keywords": ["중요"],
                "symbols": [],
                "confidence": 0.9,
            }) as openai_mock:
                next_content, first_status = _analyze_page_handwriting_content(
                    _content(strokes),
                    use_vision_fallback=True,
                )
                final_content, second_status = _analyze_page_handwriting_content(
                    next_content,
                    use_vision_fallback=True,
                )

        recognition = parse_page_state(final_content)["handwritingRecognition"]
        self.assertEqual(first_status, "analyzed")
        self.assertEqual(second_status, "skipped")
        self.assertEqual(openai_mock.call_count, 1)
        self.assertTrue(recognition["visionFallbackUsed"])
        self.assertIn("중요", recognition["keywords"])

    def test_use_vision_fallback_false_never_calls_openai(self):
        with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai") as openai_mock:
            _analyze_page_handwriting_content(
                _content([_stroke([(0, 0), (40, 20), (80, 0)])]),
                force=True,
                use_vision_fallback=False,
            )

        openai_mock.assert_not_called()

    def test_cluster_limit_prevents_excessive_openai_calls(self):
        strokes = [
            *_star_strokes(),
            *_keyword_like_strokes(190, 24, prefix="near-a"),
            *_keyword_like_strokes(190, 172, prefix="near-b"),
            *_keyword_like_strokes(640, 24, prefix="far"),
        ]
        with patch.dict(
            "os.environ",
            {
                "HANDWRITING_VISION_FALLBACK_ENABLED": "true",
                "OPENAI_API_KEY": "test",
                "HANDWRITING_VISION_MAX_CLUSTERS_PER_PAGE": "1",
                "HANDWRITING_VISION_MIN_CLUSTER_STROKES": "1",
            },
            clear=False,
        ):
            with patch("backend.app.routes.notes.analyze_handwriting_image_with_openai", return_value={
                "status": "ready",
                "text": "중요",
                "keywords": ["중요"],
                "symbols": [],
                "confidence": 0.9,
            }) as openai_mock:
                next_content, status = _analyze_page_handwriting_content(
                    _content(strokes),
                    force=True,
                    use_vision_fallback=True,
                )

        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(status, "analyzed")
        self.assertEqual(openai_mock.call_count, 1)
        self.assertEqual(recognition["visionAnalyzedClusterCount"], 1)
        self.assertEqual(recognition["visionFallbackSkippedReason"], "cluster-limit")

    def test_note_wide_analysis_respects_max_pages_limit(self):
        with patch.dict("os.environ", {"HANDWRITING_VISION_MAX_PAGES_PER_NOTE": "1"}, clear=False):
            first_allowed, first_reason, used_pages = _consume_note_vision_budget(True, 0)
            second_allowed, second_reason, used_pages = _consume_note_vision_budget(True, used_pages)

        self.assertTrue(first_allowed)
        self.assertIsNone(first_reason)
        self.assertFalse(second_allowed)
        self.assertEqual(second_reason, "page-limit")
        self.assertEqual(used_pages, 1)

    def test_hybrid_merge_preserves_geometry_symbols_and_adds_vision_keywords(self):
        merged = _merge_geometry_and_vision_recognition(
            {
                "status": "ready",
                "strokeHash": "hash",
                "engine": "geometry",
                "text": "",
                "keywords": [],
                "symbols": ["star"],
                "confidence": 0.82,
                "clusters": [],
            },
            [{
                "status": "ready",
                "text": "중요 시험",
                "keywords": ["중요", "시험"],
                "symbols": ["check"],
                "confidence": 0.88,
            }],
        )

        self.assertEqual(merged["engine"], "hybrid")
        self.assertIn("star", merged["symbols"])
        self.assertIn("check", merged["symbols"])
        self.assertIn("중요", merged["keywords"])
        self.assertEqual(merged["strokeHash"], "hash")

    def test_old_page_state_still_works(self):
        next_content, status = _analyze_page_handwriting_content(
            _content([_stroke([(0, 0), (40, 20), (80, 0)])]),
        )
        state = parse_page_state(next_content)

        self.assertEqual(status, "analyzed")
        self.assertIsNotNone(state)
        self.assertIn("handwritingRecognition", state)
        self.assertIn("visionFallbackUsed", state["handwritingRecognition"])

    def test_handwriting_metadata_backward_compatibility(self):
        legacy = _content([_stroke([(0, 0), (40, 20), (80, 0)])], {
            "status": "ready",
            "strokeHash": "old",
            "engine": "geometry",
            "text": "",
            "keywords": [],
            "symbols": [],
            "confidence": 0.0,
            "clusters": [],
        })
        state = parse_page_state(legacy)

        self.assertIsNotNone(state)
        self.assertNotIn("visionFallbackUsed", state["handwritingRecognition"])


if __name__ == "__main__":
    unittest.main()
