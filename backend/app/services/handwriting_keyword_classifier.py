"""Closed-set handwriting keyword classifier.

This is intentionally tiny: the target vocabulary is a fixed set of study
keywords, so we do not need general handwriting OCR. We classify an already
clustered ink blob into one of a few keywords (or ``none``) using a pure-numpy
multinomial logistic regression. Inference depends only on numpy (already a
backend dependency) and is a safe no-op when no trained model artifact exists,
so geometry / ML Kit / Vision keep working unchanged.

Train an artifact with ``backend/scripts/train_handwriting_keyword_classifier.py``.
"""

import math
import os
from functools import lru_cache
from typing import Any

import numpy as np


# Closed keyword set the classifier can emit. ``none`` is the reject class and
# is never returned as a keyword. Kept in sync with STRONG_STUDY_KEYWORDS.
KEYWORD_LABELS: tuple[str, ...] = ("중요", "시험", "중간", "기말", "암기", "필수")
NONE_LABEL = "none"
MODEL_LABELS: tuple[str, ...] = (*KEYWORD_LABELS, NONE_LABEL)

# Stable feature order. Training and inference MUST agree on this list.
FEATURE_NAMES: tuple[str, ...] = (
    "log_stroke_count",
    "log_point_count",
    "aspect_ratio",
    "text_like_score",
    "symbol_like_score",
    "center_x_span_ratio",
    "center_y_span_ratio",
    "mean_center_distance_ratio",
    "center_crossing_ratio",
    "centered_ratio",
    "orientation_count",
    "x_bins",
    "y_bins",
    "width_over_height",
)

DEFAULT_MIN_CONFIDENCE = 0.6


def _model_path() -> str:
    return os.getenv(
        "HANDWRITING_KEYWORD_CLASSIFIER_PATH",
        os.path.join(os.path.dirname(__file__), "models", "handwriting_keyword_classifier.npz"),
    )


def _to_float(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return number


def extract_cluster_features(cluster: dict[str, Any]) -> list[float]:
    """Deterministic numeric features for a cluster produced by ``cluster_ink_strokes``."""
    classification = cluster.get("classification") if isinstance(cluster.get("classification"), dict) else {}
    bbox = cluster.get("bbox") if isinstance(cluster.get("bbox"), dict) else {}
    width = max(1.0, _to_float(bbox.get("width"), 1.0))
    height = max(1.0, _to_float(bbox.get("height"), 1.0))
    stroke_count = _to_float(cluster.get("strokeCount") or classification.get("strokeCount"))
    point_count = _to_float(cluster.get("pointCount"))
    aspect = _to_float(classification.get("aspectRatio"), max(width, height) / min(width, height))

    return [
        math.log1p(max(0.0, stroke_count)),
        math.log1p(max(0.0, point_count)),
        aspect,
        _to_float(cluster.get("textLikeScore")),
        _to_float(cluster.get("symbolLikeScore")),
        _to_float(classification.get("centerXSpanRatio")),
        _to_float(classification.get("centerYSpanRatio")),
        _to_float(classification.get("meanCenterDistanceRatio")),
        _to_float(classification.get("centerCrossingRatio")),
        _to_float(classification.get("centeredRatio")),
        _to_float(classification.get("orientationCount")),
        _to_float(classification.get("xBins")),
        _to_float(classification.get("yBins")),
        width / height,
    ]


@lru_cache(maxsize=1)
def _load_model() -> dict[str, Any] | None:
    path = _model_path()
    if not os.path.exists(path):
        return None
    try:
        data = np.load(path, allow_pickle=False)
        labels = [str(label) for label in data["labels"]]
        feature_names = [str(name) for name in data["feature_names"]]
        if feature_names != list(FEATURE_NAMES):
            # Feature schema drifted from the trained artifact; refuse to use it.
            return None
        return {
            "weights": np.asarray(data["weights"], dtype=np.float64),
            "bias": np.asarray(data["bias"], dtype=np.float64),
            "mean": np.asarray(data["mean"], dtype=np.float64),
            "std": np.asarray(data["std"], dtype=np.float64),
            "labels": labels,
        }
    except Exception:
        return None


def reset_model_cache_for_tests() -> None:
    _load_model.cache_clear()


def classifier_available() -> bool:
    return _load_model() is not None


def classify_cluster_keyword(
    cluster: dict[str, Any],
    *,
    min_confidence: float = DEFAULT_MIN_CONFIDENCE,
) -> dict[str, Any] | None:
    """Return ``{"keyword", "confidence"}`` for a cluster, or ``None``.

    Safe no-op when no model artifact is present or anything goes wrong.
    """
    model = _load_model()
    if model is None:
        return None
    try:
        features = np.asarray(extract_cluster_features(cluster), dtype=np.float64)
        std = np.where(model["std"] == 0, 1.0, model["std"])
        normalized = (features - model["mean"]) / std
        logits = normalized @ model["weights"] + model["bias"]
        logits = logits - np.max(logits)
        probabilities = np.exp(logits)
        probabilities = probabilities / np.sum(probabilities)
        best_index = int(np.argmax(probabilities))
        label = model["labels"][best_index]
        confidence = float(probabilities[best_index])
    except Exception:
        return None

    if label == NONE_LABEL or label not in KEYWORD_LABELS:
        return None
    if confidence < min_confidence:
        return None
    return {"keyword": label, "confidence": round(confidence, 3)}
