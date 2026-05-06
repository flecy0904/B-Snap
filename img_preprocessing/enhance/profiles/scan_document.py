"""Scan-like enhancement for bright paper, whiteboard, and projection surfaces."""

from __future__ import annotations

import cv2
import numpy as np

from img_preprocessing.enhance.image_ops import ImageArray, estimate_illumination


def enhance_scan_document_view(image_bgr: ImageArray) -> ImageArray:
    denoised = cv2.fastNlMeansDenoisingColored(image_bgr, None, 4, 4, 7, 21)
    lab = cv2.cvtColor(denoised, cv2.COLOR_BGR2LAB)
    lightness, channel_a, channel_b = cv2.split(lab)

    illumination = estimate_illumination(lightness)
    normalized = _normalize_illumination(lightness, illumination)
    stretched = _percentile_stretch(normalized)
    lifted = _lift_document_background(stretched)
    enhanced_lightness = _enhance_document_strokes(lifted)

    channel_a = _reduce_lab_chroma(channel_a, strength=0.88)
    channel_b = _reduce_lab_chroma(channel_b, strength=0.88)
    enhanced_lab = cv2.merge((enhanced_lightness, channel_a, channel_b))
    enhanced_bgr = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)

    blurred = cv2.GaussianBlur(enhanced_bgr, (0, 0), 0.85)
    return cv2.addWeighted(enhanced_bgr, 1.25, blurred, -0.25, 0)


def _normalize_illumination(lightness: ImageArray, illumination: ImageArray) -> ImageArray:
    lightness_float = lightness.astype(np.float32)
    illumination_float = np.maximum(illumination.astype(np.float32), 1.0)
    normalized = lightness_float / illumination_float * 232.0
    normalized = np.clip(normalized, 0, 255).astype(np.uint8)
    return cv2.addWeighted(normalized, 0.9, lightness, 0.1, 0)


def _percentile_stretch(
    channel: ImageArray,
    low_percentile: float = 2.0,
    high_percentile: float = 98.0,
) -> ImageArray:
    low, high = np.percentile(channel, [low_percentile, high_percentile])
    if high - low < 1.0:
        return channel.copy()

    stretched = (channel.astype(np.float32) - float(low)) * (255.0 / float(high - low))
    return np.clip(stretched, 0, 255).astype(np.uint8)


def _lift_document_background(lightness: ImageArray) -> ImageArray:
    lifted = lightness.astype(np.float32)
    bright_threshold = max(150.0, float(np.percentile(lightness, 62)))
    mid_threshold = max(105.0, bright_threshold - 50.0)

    bright_mask = lifted >= bright_threshold
    lifted[bright_mask] += (246.0 - lifted[bright_mask]) * 0.62

    mid_mask = (lifted >= mid_threshold) & (lifted < bright_threshold)
    lifted[mid_mask] += (232.0 - lifted[mid_mask]) * 0.28

    return np.clip(lifted, 0, 250).astype(np.uint8)


def _enhance_document_strokes(lightness: ImageArray) -> ImageArray:
    enhanced = lightness.astype(np.float32)
    dark_threshold = min(150.0, max(90.0, float(np.percentile(lightness, 35))))
    dark_mask = enhanced < dark_threshold
    enhanced[dark_mask] *= 0.74

    channel = np.clip(enhanced, 0, 255).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    blackhat = cv2.morphologyEx(channel, cv2.MORPH_BLACKHAT, kernel)
    channel = cv2.subtract(channel, cv2.convertScaleAbs(blackhat, alpha=0.65))

    blurred = cv2.GaussianBlur(channel, (0, 0), 0.75)
    return cv2.addWeighted(channel, 1.18, blurred, -0.18, 0)


def _reduce_lab_chroma(channel: ImageArray, *, strength: float) -> ImageArray:
    centered = channel.astype(np.float32) - 128.0
    reduced = 128.0 + centered * strength
    return np.clip(reduced, 0, 255).astype(np.uint8)
