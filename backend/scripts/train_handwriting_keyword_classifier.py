"""Train the closed-set handwriting keyword classifier.

The classifier is a pure-numpy multinomial logistic regression over the fixed
study-keyword vocabulary (see ``handwriting_keyword_classifier``). It needs no
heavy ML dependency and produces a small ``.npz`` artifact loaded at inference.

Usage:
    # Train from a real labelled dataset (one JSON object per line)
    python -m backend.scripts.train_handwriting_keyword_classifier --dataset data/handwriting_clusters.jsonl

    # Validate the full pipeline end-to-end with a synthetic smoke dataset
    python -m backend.scripts.train_handwriting_keyword_classifier --synthetic

Dataset format (JSONL), each line is one of:
    {"label": "시험", "cluster": { ...cluster_ink_strokes output... }}
    {"label": "none", "features": [<float>, ...]}   # already-extracted FEATURE_NAMES order

Labels must be in MODEL_LABELS. Anything not a study keyword should be "none".
"""

import argparse
import json
import os
import sys

import numpy as np

from backend.app.services.handwriting_keyword_classifier import (
    FEATURE_NAMES,
    MODEL_LABELS,
    _model_path,
    extract_cluster_features,
)


def _load_dataset(path: str) -> tuple[np.ndarray, np.ndarray]:
    features: list[list[float]] = []
    labels: list[int] = []
    label_index = {label: index for index, label in enumerate(MODEL_LABELS)}
    with open(path, encoding="utf-8") as handle:
        for line_number, raw_line in enumerate(handle, start=1):
            line = raw_line.strip()
            if not line:
                continue
            record = json.loads(line)
            label = record.get("label")
            if label not in label_index:
                raise ValueError(f"line {line_number}: unknown label {label!r}; must be one of {MODEL_LABELS}")
            if "features" in record:
                vector = [float(value) for value in record["features"]]
                if len(vector) != len(FEATURE_NAMES):
                    raise ValueError(f"line {line_number}: expected {len(FEATURE_NAMES)} features, got {len(vector)}")
            else:
                vector = extract_cluster_features(record["cluster"])
            features.append(vector)
            labels.append(label_index[label])
    if not features:
        raise ValueError("dataset is empty")
    return np.asarray(features, dtype=np.float64), np.asarray(labels, dtype=np.int64)


def _synthetic_dataset(samples_per_label: int = 120, seed: int = 7) -> tuple[np.ndarray, np.ndarray]:
    """Separable-ish synthetic data to smoke-test the train→infer pipeline."""
    rng = np.random.default_rng(seed)
    feature_count = len(FEATURE_NAMES)
    features: list[np.ndarray] = []
    labels: list[int] = []
    for label_index in range(len(MODEL_LABELS)):
        center = rng.normal(loc=label_index * 0.8, scale=0.4, size=feature_count)
        block = center + rng.normal(loc=0.0, scale=0.25, size=(samples_per_label, feature_count))
        features.append(block)
        labels.extend([label_index] * samples_per_label)
    return np.vstack(features), np.asarray(labels, dtype=np.int64)


def _train(features: np.ndarray, labels: np.ndarray, *, epochs: int = 400, learning_rate: float = 0.5):
    mean = features.mean(axis=0)
    std = features.std(axis=0)
    safe_std = np.where(std == 0, 1.0, std)
    normalized = (features - mean) / safe_std

    sample_count, feature_count = normalized.shape
    class_count = len(MODEL_LABELS)
    weights = np.zeros((feature_count, class_count), dtype=np.float64)
    bias = np.zeros(class_count, dtype=np.float64)
    one_hot = np.eye(class_count)[labels]

    for _ in range(epochs):
        logits = normalized @ weights + bias
        logits -= logits.max(axis=1, keepdims=True)
        exp = np.exp(logits)
        probabilities = exp / exp.sum(axis=1, keepdims=True)
        gradient = probabilities - one_hot
        weights -= learning_rate * (normalized.T @ gradient) / sample_count
        bias -= learning_rate * gradient.mean(axis=0)

    logits = normalized @ weights + bias
    accuracy = float((logits.argmax(axis=1) == labels).mean())
    return weights, bias, mean, std, accuracy


def main() -> int:
    parser = argparse.ArgumentParser(description="Train the handwriting keyword classifier.")
    parser.add_argument("--dataset", help="Path to a JSONL training dataset.")
    parser.add_argument("--synthetic", action="store_true", help="Use a synthetic smoke dataset instead of --dataset.")
    parser.add_argument("--out", default=_model_path(), help="Output .npz artifact path.")
    parser.add_argument("--epochs", type=int, default=400)
    args = parser.parse_args()

    if not args.synthetic and not args.dataset:
        parser.error("provide --dataset PATH or --synthetic")

    if args.synthetic:
        features, labels = _synthetic_dataset()
        print(f"synthetic dataset: {features.shape[0]} samples, {features.shape[1]} features")
    else:
        features, labels = _load_dataset(args.dataset)
        print(f"loaded {features.shape[0]} samples from {args.dataset}")

    weights, bias, mean, std, accuracy = _train(features, labels, epochs=args.epochs)
    print(f"train accuracy: {accuracy:.3f}")

    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    np.savez(
        args.out,
        weights=weights,
        bias=bias,
        mean=mean,
        std=std,
        labels=np.asarray(MODEL_LABELS),
        feature_names=np.asarray(FEATURE_NAMES),
    )
    print(f"saved model artifact to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
