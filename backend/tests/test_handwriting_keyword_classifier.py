import os
import tempfile
import unittest

import numpy as np

from backend.app.services import handwriting_keyword_classifier as classifier
from backend.app.services.handwriting_keyword_classifier import (
    FEATURE_NAMES,
    MODEL_LABELS,
    classifier_available,
    classify_cluster_keyword,
    extract_cluster_features,
    reset_model_cache_for_tests,
)
from backend.app.services.handwriting_signals import build_handwriting_recognition_from_geometry


def _stroke(points):
    return {
        "id": "stroke",
        "style": "pen",
        "brush": "ballpoint",
        "width": 2,
        "color": "#111111",
        "points": [{"x": x, "y": y, "pageNumber": 1} for x, y in points],
    }


def _page_state(strokes):
    return {"kind": "bsnap-page-state", "version": 1, "inkStrokes": strokes}


def _write_constant_model(path: str, keyword: str) -> None:
    """Artifact that always predicts ``keyword`` regardless of input."""
    feature_count = len(FEATURE_NAMES)
    class_count = len(MODEL_LABELS)
    bias = np.zeros(class_count, dtype=np.float64)
    bias[MODEL_LABELS.index(keyword)] = 12.0
    np.savez(
        path,
        weights=np.zeros((feature_count, class_count), dtype=np.float64),
        bias=bias,
        mean=np.zeros(feature_count, dtype=np.float64),
        std=np.ones(feature_count, dtype=np.float64),
        labels=np.asarray(MODEL_LABELS),
        feature_names=np.asarray(FEATURE_NAMES),
    )


class HandwritingKeywordClassifierTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._prev_env = os.environ.get("HANDWRITING_KEYWORD_CLASSIFIER_PATH")
        reset_model_cache_for_tests()

    def tearDown(self):
        if self._prev_env is None:
            os.environ.pop("HANDWRITING_KEYWORD_CLASSIFIER_PATH", None)
        else:
            os.environ["HANDWRITING_KEYWORD_CLASSIFIER_PATH"] = self._prev_env
        reset_model_cache_for_tests()
        self._tmp.cleanup()

    def _use_model_path(self, name: str) -> str:
        path = os.path.join(self._tmp.name, name)
        os.environ["HANDWRITING_KEYWORD_CLASSIFIER_PATH"] = path
        reset_model_cache_for_tests()
        return path

    def test_no_op_when_model_missing(self):
        self._use_model_path("missing.npz")
        self.assertFalse(classifier_available())
        cluster = {"strokeCount": 4, "pointCount": 20, "bbox": {"x": 0, "y": 0, "width": 80, "height": 24}}
        self.assertIsNone(classify_cluster_keyword(cluster))

    def test_feature_vector_is_stable_length(self):
        cluster = {"strokeCount": 4, "pointCount": 20, "bbox": {"width": 80, "height": 24}, "classification": {}}
        self.assertEqual(len(extract_cluster_features(cluster)), len(FEATURE_NAMES))

    def test_constant_model_predicts_keyword(self):
        path = self._use_model_path("constant.npz")
        _write_constant_model(path, "시험")
        reset_model_cache_for_tests()

        self.assertTrue(classifier_available())
        prediction = classify_cluster_keyword({"strokeCount": 5, "pointCount": 30, "bbox": {"width": 90, "height": 26}})
        self.assertIsNotNone(prediction)
        self.assertEqual(prediction["keyword"], "시험")
        self.assertGreater(prediction["confidence"], 0.9)

    def test_geometry_builder_injects_classifier_keyword(self):
        path = self._use_model_path("constant.npz")
        _write_constant_model(path, "중요")
        reset_model_cache_for_tests()

        state = _page_state([_stroke([(0, 0), (10, 8), (20, 0), (30, 8)])])
        recognition = build_handwriting_recognition_from_geometry(state)
        self.assertIn("중요", recognition["keywords"])

    def test_geometry_builder_no_keywords_without_model(self):
        self._use_model_path("missing.npz")
        state = _page_state([_stroke([(0, 0), (10, 8), (20, 0), (30, 8)])])
        recognition = build_handwriting_recognition_from_geometry(state)
        self.assertEqual(recognition["keywords"], [])

    def test_training_pipeline_produces_usable_artifact(self):
        from backend.scripts.train_handwriting_keyword_classifier import _synthetic_dataset, _train

        path = self._use_model_path("trained.npz")
        features, labels = _synthetic_dataset(samples_per_label=80)
        weights, bias, mean, std, accuracy = _train(features, labels, epochs=200)
        self.assertGreater(accuracy, 0.8)
        np.savez(
            path,
            weights=weights,
            bias=bias,
            mean=mean,
            std=std,
            labels=np.asarray(MODEL_LABELS),
            feature_names=np.asarray(FEATURE_NAMES),
        )
        reset_model_cache_for_tests()
        self.assertTrue(classifier_available())


if __name__ == "__main__":
    unittest.main()
