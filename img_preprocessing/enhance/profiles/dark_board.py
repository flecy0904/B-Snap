"""Enhancement for dark chalkboard or blackboard surfaces."""

from __future__ import annotations

import cv2
import numpy as np

from img_preprocessing.enhance.image_ops import ImageArray, estimate_illumination


def enhance_dark_board_view(image_bgr: ImageArray) -> ImageArray:
    denoised = cv2.fastNlMeansDenoisingColored(image_bgr, None, 3, 3, 7, 15)
    lab = cv2.cvtColor(denoised, cv2.COLOR_BGR2LAB)
    lightness, channel_a, channel_b = cv2.split(lab)

    balanced = _normalize_dark_board_illumination(lightness)
    contrast_enhanced = _enhance_dark_board_contrast(balanced)
    stroke_enhanced = _enhance_bright_board_strokes(contrast_enhanced)

    enhanced_lab = cv2.merge((stroke_enhanced, channel_a, channel_b))
    enhanced_bgr = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)
    blurred = cv2.GaussianBlur(enhanced_bgr, (0, 0), 0.65)
    return cv2.addWeighted(enhanced_bgr, 1.16, blurred, -0.16, 0)


def _normalize_dark_board_illumination(lightness: ImageArray) -> ImageArray:
    illumination = estimate_illumination(lightness).astype(np.float32)
    median_illumination = float(np.median(illumination))
    corrected = lightness.astype(np.float32) - (illumination - median_illumination) * 0.42
    return np.clip(corrected, 0, 255).astype(np.uint8)


def _enhance_dark_board_contrast(lightness: ImageArray) -> ImageArray:
    clahe = cv2.createCLAHE(clipLimit=1.45, tileGridSize=(8, 8))
    clahe_lightness = clahe.apply(lightness)
    blended = cv2.addWeighted(clahe_lightness, 0.55, lightness, 0.45, 0)

    adjusted = blended.astype(np.float32)
    dark_mask = adjusted < 115.0
    adjusted[dark_mask] *= 0.94
    mid_mask = (adjusted >= 115.0) & (adjusted < 180.0)
    adjusted[mid_mask] *= 0.98
    return np.clip(adjusted, 0, 255).astype(np.uint8)


def _enhance_bright_board_strokes(lightness: ImageArray) -> ImageArray:
    channel = lightness.copy()
    stroke_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    tophat = cv2.morphologyEx(channel, cv2.MORPH_TOPHAT, stroke_kernel)
    channel = cv2.addWeighted(channel, 1.0, tophat, 0.9, 0)

    bright_threshold = max(142.0, float(np.percentile(channel, 82)))
    enhanced = channel.astype(np.float32)
    bright_mask = enhanced >= bright_threshold
    enhanced[bright_mask] += (255.0 - enhanced[bright_mask]) * 0.32

    return np.clip(enhanced, 0, 255).astype(np.uint8)
