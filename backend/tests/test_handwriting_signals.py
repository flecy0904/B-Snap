import json
import unittest

from backend.app.services.handwriting_signals import (
    build_handwriting_recognition_from_geometry,
    classify_ink_cluster,
    cluster_ink_strokes,
    compute_geometry_symbols,
    extract_page_ink_strokes,
    merge_handwriting_recognition_results,
    normalize_korean_study_keywords,
    stable_stroke_hash,
)
from backend.app.services.note_page_content import (
    merge_handwriting_recognition,
    merge_page_state_content,
    parse_page_state,
)


def _stroke(points, **extra):
    return {
        "id": extra.pop("id", "stroke"),
        "style": extra.pop("style", "pen"),
        "brush": extra.pop("brush", "ballpoint"),
        "width": extra.pop("width", 2),
        "color": extra.pop("color", "#111111"),
        "points": [{"x": x, "y": y, "pageNumber": extra.get("pageNumber", 1)} for x, y in points],
        **extra,
    }


def _korean_like_important_strokes():
    # Synthetic two-syllable "중요"-like handwriting: many short horizontal/vertical
    # strokes distributed left-to-right. It is intentionally not a symbol.
    return [
        _stroke([(0, 2), (28, 2)], id="jung-top"),
        _stroke([(14, 2), (14, 34)], id="jung-vertical"),
        _stroke([(2, 16), (26, 16)], id="jung-middle"),
        _stroke([(4, 34), (26, 34)], id="jung-bottom"),
        _stroke([(50, 2), (82, 2)], id="yo-top"),
        _stroke([(66, 2), (66, 36)], id="yo-vertical"),
        _stroke([(52, 18), (80, 18)], id="yo-middle"),
        _stroke([(50, 36), (84, 36)], id="yo-bottom"),
    ]


def _clear_star_strokes():
    return [
        _stroke([(50, 8), (50, 92)], id="star-vertical"),
        _stroke([(10, 50), (90, 50)], id="star-horizontal"),
        _stroke([(18, 18), (82, 82)], id="star-diagonal-1"),
        _stroke([(18, 82), (82, 18)], id="star-diagonal-2"),
        _stroke([(30, 10), (70, 90)], id="star-diagonal-3"),
    ]


def _three_stroke_star_strokes():
    return [
        _stroke([(50, 8), (50, 92)], id="asterisk-vertical"),
        _stroke([(12, 52), (88, 48)], id="asterisk-horizontal"),
        _stroke([(20, 86), (82, 16)], id="asterisk-diagonal"),
    ]


def _four_stroke_star_strokes():
    return [
        *_three_stroke_star_strokes(),
        _stroke([(18, 18), (84, 82)], id="asterisk-diagonal-2"),
    ]


def _one_stroke_pentagram_points():
    return [
        (50, 6),
        (66, 88),
        (6, 34),
        (94, 34),
        (34, 88),
        (50, 6),
    ]


def _one_stroke_radial_asterisk_points():
    return [
        (50, 8),
        (52, 48),
        (88, 44),
        (52, 50),
        (82, 84),
        (50, 52),
        (18, 84),
        (48, 52),
        (12, 46),
        (48, 48),
        (34, 10),
    ]


class HandwritingSignalsTest(unittest.TestCase):
    def test_stable_stroke_hash_returns_same_hash_for_same_strokes(self):
        strokes = [_stroke([(1, 1), (2, 2)], pageNumber=1)]

        self.assertEqual(stable_stroke_hash(strokes), stable_stroke_hash(json.loads(json.dumps(strokes))))

    def test_stable_stroke_hash_changes_when_coordinates_change(self):
        left = [_stroke([(1, 1), (2, 2)], pageNumber=1)]
        right = [_stroke([(1, 1), (2, 3)], pageNumber=1)]

        self.assertNotEqual(stable_stroke_hash(left), stable_stroke_hash(right))

    def test_stable_stroke_hash_works_with_old_points_without_t(self):
        strokes = [{"points": [{"x": 1, "y": 1}], "style": "pen"}]

        self.assertIsInstance(stable_stroke_hash(strokes), str)

    def test_extract_page_ink_strokes_filters_by_page_number(self):
        state = {
            "inkStrokes": [
                _stroke([(1, 1)], id="one", pageNumber=1),
                _stroke([(1, 1)], id="two", pageNumber=2),
            ],
        }

        self.assertEqual([stroke["id"] for stroke in extract_page_ink_strokes(state, 2)], ["two"])

    def test_normalize_korean_study_keywords_maps_variants(self):
        self.assertEqual(normalize_korean_study_keywords("기말고사"), ["기말"])
        self.assertEqual(normalize_korean_study_keywords("중간고사"), ["중간"])
        self.assertEqual(normalize_korean_study_keywords("시험범위"), ["시험"])
        self.assertEqual(normalize_korean_study_keywords("외우기"), ["암기"])
        self.assertEqual(normalize_korean_study_keywords("별표시"), ["별표"])

    def test_normalize_korean_study_keywords_corrects_close_mlkit_candidates(self):
        self.assertEqual(normalize_korean_study_keywords("", ["중오"]), ["중요"])
        self.assertEqual(normalize_korean_study_keywords("", ["즁요"]), ["중요"])
        self.assertEqual(normalize_korean_study_keywords("", ["쥬요"]), ["중요"])
        self.assertEqual(normalize_korean_study_keywords("", ["시혐"]), ["시험"])
        self.assertEqual(normalize_korean_study_keywords("", ["시헙"]), ["시험"])
        self.assertEqual(normalize_korean_study_keywords("", ["기맣"]), ["기말"])
        self.assertEqual(normalize_korean_study_keywords("", ["기마"]), ["기말"])
        self.assertEqual(normalize_korean_study_keywords("", ["가말"]), ["기말"])
        self.assertEqual(normalize_korean_study_keywords("", ["중칸"]), ["중간"])
        self.assertEqual(normalize_korean_study_keywords("", ["암키"]), ["암기"])
        self.assertEqual(normalize_korean_study_keywords("", ["필쑤"]), ["필수"])

    def test_normalize_korean_study_keywords_does_not_overmatch_unrelated_text(self):
        self.assertEqual(normalize_korean_study_keywords("강의실 위치와 점심 메뉴"), [])
        self.assertEqual(normalize_korean_study_keywords("", ["필기", "중앙", "시점", "말", "매", "마"]), [])

    def test_geometry_symbol_detection_works_for_simple_check(self):
        clusters = cluster_ink_strokes([_stroke([(0, 30), (20, 55), (70, 0)])])
        symbols = compute_geometry_symbols(clusters[0])

        self.assertIn("check", {symbol["symbol"] for symbol in symbols})

    def test_geometry_symbol_detection_works_for_simple_circle(self):
        points = [
            (50, 10),
            (78, 20),
            (90, 50),
            (78, 80),
            (50, 90),
            (20, 78),
            (10, 50),
            (20, 22),
            (50, 10),
        ]
        clusters = cluster_ink_strokes([_stroke(points)])
        symbols = compute_geometry_symbols(clusters[0])

        self.assertIn("circle", {symbol["symbol"] for symbol in symbols})

    def test_geometry_symbol_detection_works_for_simple_underline(self):
        clusters = cluster_ink_strokes([_stroke([(0, 10), (120, 12)])])
        symbols = compute_geometry_symbols(clusters[0])

        self.assertIn("underline", {symbol["symbol"] for symbol in symbols})

    def test_korean_like_important_strokes_do_not_produce_star(self):
        clusters = cluster_ink_strokes(_korean_like_important_strokes())
        symbols = compute_geometry_symbols(clusters[0])

        self.assertNotIn("star", {symbol["symbol"] for symbol in symbols})
        self.assertEqual(clusters[0]["clusterKind"], "text_like")

    def test_korean_like_multi_stroke_text_cluster_is_text_like(self):
        clusters = cluster_ink_strokes(_korean_like_important_strokes())
        classification = classify_ink_cluster(clusters[0])

        self.assertEqual(classification["clusterKind"], "text_like")
        self.assertGreaterEqual(classification["textLikeScore"], 0.62)
        self.assertLess(classification["symbolLikeScore"], classification["textLikeScore"])

    def test_clear_five_stroke_star_produces_star(self):
        clusters = cluster_ink_strokes(_clear_star_strokes())
        symbols = compute_geometry_symbols(clusters[0])

        self.assertIn("star", {symbol["symbol"] for symbol in symbols})
        self.assertEqual(clusters[0]["clusterKind"], "symbol_like")

    def test_three_stroke_asterisk_is_not_strong_star(self):
        clusters = cluster_ink_strokes(_three_stroke_star_strokes())
        symbols = compute_geometry_symbols(clusters[0])

        self.assertNotIn("star", {symbol["symbol"] for symbol in symbols})

    def test_four_stroke_asterisk_star_produces_star(self):
        clusters = cluster_ink_strokes(_four_stroke_star_strokes())
        symbols = compute_geometry_symbols(clusters[0])

        self.assertIn("star", {symbol["symbol"] for symbol in symbols})

    def test_one_stroke_pentagram_star_produces_star(self):
        clusters = cluster_ink_strokes([_stroke(_one_stroke_pentagram_points())])
        symbols = compute_geometry_symbols(clusters[0])

        self.assertIn("star", {symbol["symbol"] for symbol in symbols})

    def test_one_stroke_radial_asterisk_star_produces_star(self):
        clusters = cluster_ink_strokes([_stroke(_one_stroke_radial_asterisk_points())])
        symbols = compute_geometry_symbols(clusters[0])

        self.assertIn("star", {symbol["symbol"] for symbol in symbols})

    def test_clear_circle_produces_circle_and_not_star(self):
        points = [
            (50, 10),
            (78, 20),
            (90, 50),
            (78, 80),
            (50, 90),
            (20, 78),
            (10, 50),
            (20, 22),
            (50, 10),
        ]
        clusters = cluster_ink_strokes([_stroke(points)])
        symbols = {symbol["symbol"] for symbol in compute_geometry_symbols(clusters[0])}

        self.assertIn("circle", symbols)
        self.assertNotIn("star", symbols)

    def test_random_dense_strokes_do_not_produce_star(self):
        strokes = [
            _stroke([(0, 5), (18, 9)], id="random-1"),
            _stroke([(8, 25), (24, 12)], id="random-2"),
            _stroke([(30, 4), (36, 30)], id="random-3"),
            _stroke([(42, 18), (60, 22)], id="random-4"),
            _stroke([(14, 42), (26, 34)], id="random-5"),
            _stroke([(64, 8), (82, 28)], id="random-6"),
            _stroke([(72, 42), (90, 36)], id="random-7"),
            _stroke([(38, 46), (46, 10)], id="random-8"),
        ]
        clusters = cluster_ink_strokes(strokes)
        symbols = compute_geometry_symbols(clusters[0])

        self.assertNotIn("star", {symbol["symbol"] for symbol in symbols})

    def test_arrow_scribble_does_not_produce_star(self):
        clusters = cluster_ink_strokes([
            _stroke([(0, 30), (80, 30)], id="arrow-line", shape="arrow"),
            _stroke([(64, 18), (80, 30), (64, 42)], id="arrow-head", shape="arrow"),
        ])
        symbols = {symbol["symbol"] for symbol in compute_geometry_symbols(clusters[0])}

        self.assertIn("arrow", symbols)
        self.assertNotIn("star", symbols)

    def test_geometry_recognition_builds_symbol_summary(self):
        state = {"inkStrokes": [_stroke([(0, 10), (120, 12)])]}

        recognition = build_handwriting_recognition_from_geometry(state)

        self.assertEqual(recognition["status"], "ready")
        self.assertIn("underline", recognition["symbols"])
        self.assertTrue(recognition["strokeHash"])

    def test_geometry_recognition_includes_cluster_debug_metadata(self):
        state = {"inkStrokes": _korean_like_important_strokes()}

        recognition = build_handwriting_recognition_from_geometry(state)
        cluster = recognition["clusters"][0]
        star_candidate = next(candidate for candidate in cluster["symbolCandidates"] if candidate["symbol"] == "star")

        self.assertEqual(cluster["clusterKind"], "text_like")
        self.assertGreaterEqual(cluster["textLikeScore"], 0.62)
        self.assertFalse(star_candidate["accepted"])
        self.assertEqual(star_candidate["rejectionReason"], "text-like cluster")

    def test_merge_handwriting_recognition_preserves_existing_page_state(self):
        content = merge_page_state_content(
            None,
            json.dumps({
                "kind": "bsnap-page-state",
                "version": 1,
                "inkStrokes": [_stroke([(1, 1)])],
                "textAnnotations": [{"text": "memo"}],
                "imageAnnotations": [{"id": "image-1"}],
                "bookmarked": True,
                "photoReferenceCount": 2,
                "memoPageCount": 1,
            }),
            pdf_text="network core",
        )
        merged = merge_handwriting_recognition(content, {
            "status": "ready",
            "strokeHash": "hash",
            "engine": "geometry",
            "text": "중요",
            "keywords": ["중요"],
            "symbols": ["star"],
            "confidence": 0.91,
            "clusters": [],
            "visionFallbackUsed": False,
            "visionFallbackSkippedReason": "not-requested",
            "analyzedClusterCount": 2,
            "visionAnalyzedClusterCount": 0,
            "cached": False,
            "stale": False,
        })
        state = parse_page_state(merged)

        self.assertIsNotNone(state)
        self.assertEqual(state["pdfText"], "network core")
        self.assertEqual(len(state["inkStrokes"]), 1)
        self.assertEqual(len(state["textAnnotations"]), 1)
        self.assertEqual(len(state["imageAnnotations"]), 1)
        self.assertTrue(state["bookmarked"])
        self.assertEqual(state["photoReferenceCount"], 2)
        self.assertEqual(state["memoPageCount"], 1)
        self.assertEqual(state["handwritingRecognition"]["keywords"], ["중요"])
        self.assertEqual(state["handwritingRecognition"]["visionFallbackSkippedReason"], "not-requested")
        self.assertEqual(state["handwritingRecognition"]["analyzedClusterCount"], 2)

    def test_merge_page_state_content_preserves_recognition_when_strokes_unchanged(self):
        strokes = [_stroke([(1, 1), (4, 4)], id="same")]
        stroke_hash = stable_stroke_hash(strokes)
        current = json.dumps({
            "kind": "bsnap-page-state",
            "version": 1,
            "inkStrokes": strokes,
            "textAnnotations": [],
            "imageAnnotations": [],
            "handwritingRecognition": {
                "status": "ready",
                "strokeHash": stroke_hash,
                "engine": "geometry",
                "text": "",
                "keywords": [],
                "symbols": ["star"],
                "confidence": 0.9,
                "clusters": [],
            },
        })
        next_content = json.dumps({
            "kind": "bsnap-page-state",
            "version": 1,
            "inkStrokes": strokes,
            "textAnnotations": [],
            "imageAnnotations": [],
        })

        merged = merge_page_state_content(current, next_content)
        recognition = parse_page_state(merged)["handwritingRecognition"]

        self.assertEqual(recognition["status"], "ready")
        self.assertEqual(recognition["symbols"], ["star"])
        self.assertFalse(recognition.get("stale", False))

    def test_merge_page_state_content_marks_recognition_stale_when_strokes_change(self):
        old_strokes = [_stroke([(1, 1), (4, 4)], id="old")]
        new_strokes = [_stroke([(10, 10), (14, 14)], id="new")]
        current = json.dumps({
            "kind": "bsnap-page-state",
            "version": 1,
            "inkStrokes": old_strokes,
            "textAnnotations": [],
            "imageAnnotations": [],
            "handwritingRecognition": {
                "status": "ready",
                "strokeHash": stable_stroke_hash(old_strokes),
                "engine": "geometry",
                "text": "중요",
                "keywords": ["중요"],
                "symbols": ["star"],
                "confidence": 0.9,
                "clusters": [{"id": "old-cluster", "symbols": ["star"]}],
            },
        })
        next_content = json.dumps({
            "kind": "bsnap-page-state",
            "version": 1,
            "inkStrokes": new_strokes,
            "textAnnotations": [],
            "imageAnnotations": [],
        })

        merged = merge_page_state_content(current, next_content)
        recognition = parse_page_state(merged)["handwritingRecognition"]

        self.assertEqual(recognition["status"], "unavailable")
        self.assertTrue(recognition["stale"])
        self.assertEqual(recognition["keywords"], [])
        self.assertEqual(recognition["symbols"], [])
        self.assertEqual(recognition["clusters"], [])

    def test_merge_mlkit_result_preserves_geometry_symbol_and_becomes_hybrid(self):
        merged = merge_handwriting_recognition_results(
            {
                "status": "ready",
                "strokeHash": "hash",
                "engine": "geometry",
                "text": "",
                "keywords": [],
                "symbols": ["star"],
                "confidence": 0.82,
                "clusters": [{
                    "id": "geometry-cluster",
                    "pageNumber": 3,
                    "bbox": {"x": 10, "y": 10, "width": 20, "height": 20},
                    "text": "",
                    "candidates": [],
                    "keywords": [],
                    "symbols": ["star"],
                    "confidence": 0.82,
                    "source": "geometry",
                }],
            },
            {
                "engine": "mlkit-digital-ink",
                "text": "중요",
                "keywords": ["untrusted"],
                "symbols": [],
                "confidence": 0.78,
                "clusters": [{
                    "id": "mlkit-cluster",
                    "pageNumber": 3,
                    "bbox": {"x": 30, "y": 10, "width": 80, "height": 32},
                    "text": "중요",
                    "candidates": [{"text": "중요", "confidence": 0.78}],
                    "keywords": ["untrusted"],
                    "symbols": [],
                    "confidence": 0.78,
                    "source": "mlkit-digital-ink",
                }],
            },
            "hash",
        )

        self.assertEqual(merged["engine"], "hybrid")
        self.assertIn("star", merged["symbols"])
        self.assertIn("중요", merged["keywords"])
        self.assertNotIn("untrusted", merged["keywords"])

    def test_merge_duplicate_clusters_by_id(self):
        merged = merge_handwriting_recognition_results(
            {
                "status": "ready",
                "strokeHash": "hash",
                "engine": "geometry",
                "text": "",
                "keywords": [],
                "symbols": ["star"],
                "confidence": 0.82,
                "clusters": [{
                    "id": "same",
                    "pageNumber": 1,
                    "bbox": {"x": 0, "y": 0, "width": 20, "height": 20},
                    "text": "",
                    "candidates": [],
                    "keywords": [],
                    "symbols": ["star"],
                    "confidence": 0.82,
                    "source": "geometry",
                }],
            },
            {
                "engine": "mlkit-digital-ink",
                "text": "시험범위",
                "keywords": ["시험범위"],
                "symbols": [],
                "confidence": 0.86,
                "clusters": [{
                    "id": "same",
                    "pageNumber": 1,
                    "bbox": {"x": 0, "y": 0, "width": 20, "height": 20},
                    "text": "시험범위",
                    "candidates": [{"text": "시험범위", "confidence": 0.86}],
                    "keywords": ["시험범위"],
                    "symbols": [],
                    "confidence": 0.86,
                    "source": "mlkit-digital-ink",
                }],
            },
            "hash",
        )

        self.assertEqual(len(merged["clusters"]), 1)
        self.assertIn("star", merged["clusters"][0]["symbols"])
        self.assertIn("시험", merged["clusters"][0]["keywords"])

    def test_merge_mlkit_close_candidate_corrects_strong_keyword(self):
        merged = merge_handwriting_recognition_results(
            None,
            {
                "engine": "mlkit-digital-ink",
                "text": "",
                "keywords": [],
                "symbols": [],
                "confidence": 0.74,
                "clusters": [{
                    "id": "mlkit-cluster-1",
                    "pageNumber": 1,
                    "bbox": {"x": 20, "y": 20, "width": 60, "height": 28},
                    "text": "",
                    "candidates": [{"text": "중오", "confidence": 0.74}],
                    "keywords": [],
                    "symbols": [],
                    "confidence": 0.74,
                    "source": "mlkit-digital-ink",
                }],
            },
            "hash",
        )

        self.assertIn("중요", merged["keywords"])
        self.assertIn("중요", merged["clusters"][0]["keywords"])


if __name__ == "__main__":
    unittest.main()
