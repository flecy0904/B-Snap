import json
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from fastapi import HTTPException
from fastapi.testclient import TestClient

from backend.app.core.auth import get_current_user
from backend.app.db.session import get_db_connection
from backend.app.main import app
from backend.app.routes.class_insights import PageInsightAccumulator, _apply_page_state
from backend.app.routes.notes import _analyze_page_handwriting_content
from backend.app.services.handwriting_signals import stable_stroke_hash
from backend.app.services.note_page_content import parse_page_state


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


def _content(strokes, recognition=None):
    return json.dumps({
        "kind": "bsnap-page-state",
        "version": 1,
        "inkStrokes": strokes,
        "textAnnotations": [],
        "imageAnnotations": [],
        "bookmarked": False,
        "photoReferenceCount": 0,
        "memoPageCount": 0,
        **({"handwritingRecognition": recognition} if recognition else {}),
    }, ensure_ascii=False)


def _page(content: str, *, note_id=20, page_number=3):
    now = datetime.now(timezone.utc)
    return {
        "id": 101,
        "note_id": note_id,
        "page_number": page_number,
        "content": content,
        "image_url": None,
        "created_at": now,
        "updated_at": now,
    }


class HandwritingRecognitionPersistenceEndpointTest(unittest.TestCase):
    def setUp(self):
        app.dependency_overrides[get_current_user] = lambda: {"id": 1, "email": "owner@example.com"}
        app.dependency_overrides[get_db_connection] = lambda: object()
        self.client = TestClient(app)

    def tearDown(self):
        app.dependency_overrides.clear()

    def _post_with_page(self, content: str, payload: dict):
        page = _page(content)

        def fake_execute_returning(_connection, _query, params=()):
            return {
                **page,
                "content": params[0],
                "updated_at": datetime.now(timezone.utc),
            }

        with patch("backend.app.routes.notes._get_note_page_for_user", return_value=page):
            with patch("backend.app.routes.notes.execute_returning", side_effect=fake_execute_returning):
                return self.client.post(f"/note-pages/{page['id']}/handwriting-recognition", json=payload)

    def test_post_handwriting_recognition_rejects_page_not_owned_by_user(self):
        with patch(
            "backend.app.routes.notes._get_note_page_for_user",
            side_effect=HTTPException(status_code=404, detail="note page not found"),
        ):
            response = self.client.post("/note-pages/999/handwriting-recognition", json={"text": "중요"})

        self.assertEqual(response.status_code, 404)

    def test_stale_stroke_hash_returns_conflict(self):
        content = _content([_stroke([(0, 0), (20, 20)])])

        response = self._post_with_page(content, {"stroke_hash": "old-hash", "text": "중요"})

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "stale handwriting recognition result")

    def test_incoming_keywords_are_normalized_by_backend(self):
        strokes = [_stroke([(0, 0), (20, 20)])]
        response = self._post_with_page(
            _content(strokes),
            {
                "stroke_hash": stable_stroke_hash(strokes),
                "engine": "mlkit-digital-ink",
                "text": "기말고사",
                "keywords": ["강의실"],
                "confidence": 0.82,
                "clusters": [{
                    "id": "mlkit-cluster",
                    "pageNumber": 3,
                    "bbox": {"x": 0, "y": 0, "width": 80, "height": 30},
                    "text": "기말고사",
                    "candidates": [{"text": "기말고사", "confidence": 0.82}],
                    "keywords": ["강의실"],
                    "symbols": [],
                    "confidence": 0.82,
                    "source": "mlkit-digital-ink",
                }],
            },
        )

        self.assertEqual(response.status_code, 200)
        recognition = parse_page_state(response.json()["content"])["handwritingRecognition"]
        self.assertIn("기말", recognition["keywords"])
        self.assertNotIn("강의실", recognition["keywords"])

    def test_geometry_star_is_preserved_and_engine_becomes_hybrid(self):
        strokes = [_stroke([(0, 0), (20, 20)])]
        content = _content(strokes, {
            "status": "ready",
            "strokeHash": stable_stroke_hash(strokes),
            "engine": "geometry",
            "text": "",
            "keywords": [],
            "symbols": ["star"],
            "confidence": 0.84,
            "clusters": [{
                "id": "geometry-star",
                "pageNumber": 3,
                "bbox": {"x": 0, "y": 0, "width": 24, "height": 24},
                "text": "",
                "candidates": [],
                "keywords": [],
                "symbols": ["star"],
                "confidence": 0.84,
                "source": "geometry",
            }],
        })

        response = self._post_with_page(content, {
            "stroke_hash": stable_stroke_hash(strokes),
            "engine": "mlkit-digital-ink",
            "text": "중요",
            "confidence": 0.81,
            "clusters": [{
                "id": "mlkit-text",
                "pageNumber": 3,
                "bbox": {"x": 40, "y": 0, "width": 80, "height": 28},
                "text": "중요",
                "candidates": [{"text": "중요", "confidence": 0.81}],
                "confidence": 0.81,
                "source": "mlkit-digital-ink",
            }],
        })

        self.assertEqual(response.status_code, 200)
        recognition = parse_page_state(response.json()["content"])["handwritingRecognition"]
        self.assertEqual(recognition["engine"], "hybrid")
        self.assertIn("star", recognition["symbols"])
        self.assertIn("중요", recognition["keywords"])

    def test_duplicate_clusters_do_not_explode_result(self):
        strokes = [_stroke([(0, 0), (20, 20)])]
        content = _content(strokes, {
            "status": "ready",
            "strokeHash": stable_stroke_hash(strokes),
            "engine": "geometry",
            "text": "",
            "keywords": [],
            "symbols": ["star"],
            "confidence": 0.84,
            "clusters": [{
                "id": "same",
                "pageNumber": 3,
                "bbox": {"x": 0, "y": 0, "width": 24, "height": 24},
                "text": "",
                "candidates": [],
                "keywords": [],
                "symbols": ["star"],
                "confidence": 0.84,
                "source": "geometry",
            }],
        })

        response = self._post_with_page(content, {
            "stroke_hash": stable_stroke_hash(strokes),
            "engine": "mlkit-digital-ink",
            "text": "시험범위",
            "confidence": 0.81,
            "clusters": [{
                "id": "same",
                "pageNumber": 3,
                "bbox": {"x": 0, "y": 0, "width": 24, "height": 24},
                "text": "시험범위",
                "candidates": [{"text": "시험범위", "confidence": 0.81}],
                "confidence": 0.81,
                "source": "mlkit-digital-ink",
            }],
        })

        recognition = parse_page_state(response.json()["content"])["handwritingRecognition"]
        self.assertEqual(len(recognition["clusters"]), 1)
        self.assertIn("시험", recognition["clusters"][0]["keywords"])
        self.assertIn("star", recognition["clusters"][0]["symbols"])

    def test_old_page_state_without_existing_recognition_works(self):
        strokes = [_stroke([(0, 0), (20, 20)])]
        response = self._post_with_page(
            _content(strokes),
            {
                "stroke_hash": stable_stroke_hash(strokes),
                "engine": "mlkit-digital-ink",
                "text": "중요",
                "confidence": 0.8,
            },
        )

        self.assertEqual(response.status_code, 200)
        recognition = parse_page_state(response.json()["content"])["handwritingRecognition"]
        self.assertEqual(recognition["engine"], "mlkit-digital-ink")
        self.assertEqual(recognition["strokeHash"], stable_stroke_hash(strokes))
        self.assertIn("중요", recognition["keywords"])

    def test_class_insights_uses_persisted_mlkit_keywords_after_merge(self):
        strokes = [_stroke([(0, 0), (20, 20)])]
        response = self._post_with_page(
            _content(strokes),
            {
                "stroke_hash": stable_stroke_hash(strokes),
                "engine": "mlkit-digital-ink",
                "text": "중요 시험",
                "confidence": 0.86,
            },
        )
        state = parse_page_state(response.json()["content"])
        accumulator = PageInsightAccumulator(page_number=3)

        _apply_page_state(accumulator, state, user_id=8, note_id=20)

        self.assertEqual(accumulator.handwriting_keyword_hits, 2)
        self.assertIn("중요", accumulator.semantic_keywords)
        self.assertIn("시험", accumulator.semantic_keywords)
        self.assertGreater(accumulator.score(), 30)

    def test_persisted_mlkit_keyword_affects_class_insights_ranking(self):
        semantic_strokes = [_stroke([(0, 0), (20, 20)])]
        semantic_response = self._post_with_page(
            _content(semantic_strokes),
            {
                "stroke_hash": stable_stroke_hash(semantic_strokes),
                "engine": "mlkit-digital-ink",
                "text": "중요 시험",
                "confidence": 0.86,
            },
        )
        semantic_state = parse_page_state(semantic_response.json()["content"])
        noisy_state = parse_page_state(_content([
            _stroke([(index, index), (index + 1, index + 2)], id=f"random-{index}")
            for index in range(200)
        ]))
        semantic = PageInsightAccumulator(page_number=3)
        noisy = PageInsightAccumulator(page_number=75)

        _apply_page_state(semantic, semantic_state, user_id=8, note_id=20)
        _apply_page_state(noisy, noisy_state, user_id=9, note_id=21)

        self.assertGreater(semantic.score(), noisy.score())
        self.assertLess(noisy.score(), 35)


class AnalyzePageReplacesOnDeviceRecognitionTest(unittest.TestCase):
    def test_geometry_reanalysis_replaces_mlkit_recognition(self):
        # ML Kit is no longer part of the product flow; a server re-analysis is
        # authoritative and replaces any persisted ML Kit recognition for the same
        # strokes (geometry + star-gated Vision), rather than merging it back in.
        strokes = [_stroke([(0, 0), (20, 20)])]
        content = _content(strokes, {
            "status": "ready",
            "strokeHash": stable_stroke_hash(strokes),
            "engine": "mlkit-digital-ink",
            "text": "중요",
            "keywords": ["중요"],
            "symbols": [],
            "confidence": 0.82,
            "clusters": [{
                "id": "mlkit-text",
                "pageNumber": 3,
                "bbox": {"x": 0, "y": 0, "width": 80, "height": 28},
                "text": "중요",
                "candidates": [{"text": "중요", "confidence": 0.82}],
                "keywords": ["중요"],
                "symbols": [],
                "confidence": 0.82,
                "source": "mlkit-digital-ink",
            }],
        })

        next_content, status = _analyze_page_handwriting_content(
            content,
            force=True,
            use_vision_fallback=False,
        )

        self.assertEqual(status, "analyzed")
        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(recognition["engine"], "geometry")
        self.assertNotIn("중요", recognition["keywords"])

    def test_mlkit_recognition_is_not_skipped_on_reanalysis(self):
        # A persisted ML Kit result must not short-circuit re-analysis even when the
        # stroke hash matches, so geometry/Vision can take over.
        strokes = [_stroke([(0, 0), (20, 20)])]
        content = _content(strokes, {
            "status": "ready",
            "strokeHash": stable_stroke_hash(strokes),
            "engine": "mlkit-digital-ink",
            "text": "중요",
            "keywords": ["중요"],
            "symbols": [],
            "confidence": 0.82,
            "clusters": [],
        })

        _next_content, status = _analyze_page_handwriting_content(
            content,
            force=False,
            use_vision_fallback=False,
        )

        self.assertEqual(status, "analyzed")

    def test_geometry_only_page_has_no_text_keywords(self):
        strokes = [_stroke([(0, 0), (20, 20)])]
        next_content, status = _analyze_page_handwriting_content(
            _content(strokes),
            force=True,
            use_vision_fallback=False,
        )

        self.assertEqual(status, "analyzed")
        recognition = parse_page_state(next_content)["handwritingRecognition"]
        self.assertEqual(recognition["engine"], "geometry")
        self.assertEqual(recognition["keywords"], [])


if __name__ == "__main__":
    unittest.main()
