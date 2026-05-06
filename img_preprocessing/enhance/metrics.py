"""Quality and enhancement metrics for view images."""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from .image_ops import ImageArray, clamp, estimate_illumination


def score_view_image(image_bgr: ImageArray) -> dict[str, Any]:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    brightness = float(np.mean(gray))
    contrast = float(np.std(gray))
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    edges = cv2.Canny(gray, 80, 160)
    edge_density = float(cv2.countNonZero(edges)) / float(gray.size)

    brightness_score = _range_score(brightness, 45.0, 95.0, 215.0, 245.0)
    contrast_score = _linear_score(contrast, 18.0, 70.0)
    sharpness_score = _linear_score(np.log1p(sharpness), np.log1p(35.0), np.log1p(650.0))
    detail_score = _range_score(edge_density, 0.002, 0.012, 0.18, 0.32)

    score = (
        brightness_score * 0.25
        + contrast_score * 0.32
        + sharpness_score * 0.28
        + detail_score * 0.15
    )
    return {
        "score": round(float(score), 4),
        "brightness": round(brightness, 4),
        "contrast": round(contrast, 4),
        "sharpness": round(sharpness, 4),
        "edge_density": round(edge_density, 4),
        "components": {
            "brightness": round(brightness_score, 4),
            "contrast": round(contrast_score, 4),
            "sharpness": round(sharpness_score, 4),
            "detail": round(detail_score, 4),
        },
    }


def quality_metrics(image_bgr: ImageArray) -> dict[str, float]:
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    return {
        "brightness": round(float(np.mean(gray)), 4),
        "contrast": round(float(np.std(gray)), 4),
        "sharpness": round(float(cv2.Laplacian(gray, cv2.CV_64F).var()), 4),
    }


def enhancement_metrics(
    before_bgr: ImageArray,
    after_bgr: ImageArray,
    profile: str,
) -> dict[str, float | str]:
    before_gray = cv2.cvtColor(before_bgr, cv2.COLOR_BGR2GRAY)
    after_gray = cv2.cvtColor(after_bgr, cv2.COLOR_BGR2GRAY)
    background_threshold = float(np.percentile(after_gray, 68))
    background_mask = after_gray >= background_threshold
    background_values = after_gray[background_mask] if np.any(background_mask) else after_gray
    before_illumination = estimate_illumination(before_gray)

    return {
        "selected_profile": profile,
        "background_brightness": round(float(np.mean(background_values)), 4),
        "background_white_ratio": round(
            float(np.count_nonzero(after_gray >= 235)) / float(after_gray.size),
            4,
        ),
        "shadow_estimate": round(float(np.std(before_illumination)), 4),
        "contrast_before": round(float(np.std(before_gray)), 4),
        "contrast_after": round(float(np.std(after_gray)), 4),
        "sharpness_before": round(float(cv2.Laplacian(before_gray, cv2.CV_64F).var()), 4),
        "sharpness_after": round(float(cv2.Laplacian(after_gray, cv2.CV_64F).var()), 4),
    }


def _linear_score(value: float, low: float, high: float) -> float:
    if high <= low:
        return 0.0
    return float(clamp((value - low) / (high - low), 0.0, 1.0))


def _range_score(
    value: float,
    low_bad: float,
    low_good: float,
    high_good: float,
    high_bad: float,
) -> float:
    if value <= low_bad or value >= high_bad:
        return 0.0
    if low_good <= value <= high_good:
        return 1.0
    if value < low_good:
        return _linear_score(value, low_bad, low_good)
    return 1.0 - _linear_score(value, high_good, high_bad)
