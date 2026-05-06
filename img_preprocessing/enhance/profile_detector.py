"""Choose the crop enhancement profile from image statistics and optional hints."""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from .image_ops import ImageArray, border_pixels, pixel_ratio


DARK_PROFILE_HINTS = {
    "blackboard",
    "chalkboard",
    "green board",
    "dark board",
}
SCAN_PROFILE_HINTS = {
    "whiteboard",
    "projector screen",
    "projection screen",
    "presentation screen",
    "screen",
    "projected slide",
    "paper",
    "document",
    "sheet of paper",
    "notebook page",
    "scan document",
}
PROFILE_PRESET_NAME = "scan_prefer"
PROFILE_PRESET_SCAN_PREFER = {
    "bright_median_min": 170.0,
    "bright_ratio_min": 0.38,
    "bright_dark_ratio_max": 0.32,
    "bright_green_ratio_max": 0.16,
    "dark_mean_max": 105.0,
    "dark_median_max": 105.0,
    "dark_ratio_min": 0.42,
    "dark_bright_ratio_max": 0.35,
    "border_median_max": 95.0,
    "border_dark_ratio_min": 0.50,
    "border_bright_ratio_max": 0.40,
    "green_ratio_min": 0.32,
    "green_median_max": 135.0,
    "green_bright_ratio_max": 0.35,
    "hint_mean_max": 150.0,
    "hint_median_max": 155.0,
    "hint_bright_ratio_max": 0.25,
    "hint_dark_ratio_min": 0.18,
    "hint_border_dark_ratio_min": 0.42,
    "hint_green_ratio_min": 0.22,
}


def detect_enhancement_profile(
    image_bgr: ImageArray,
    *,
    profile_hint: str | None = None,
) -> tuple[str, dict[str, Any]]:
    """Return the enhancement profile and the metrics behind the decision."""

    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    mean_brightness = float(np.mean(gray))
    median_brightness = float(np.median(gray))
    dark_ratio = pixel_ratio(gray < 85)
    bright_ratio = pixel_ratio(gray > 190)

    border = border_pixels(gray)
    border_median = float(np.median(border))
    border_dark_ratio = pixel_ratio(border < 85)

    hsv = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2HSV)
    hue, saturation, value = cv2.split(hsv)
    green_mask = (
        (hue >= 35)
        & (hue <= 95)
        & (saturation >= 35)
        & (value <= 175)
    )
    green_ratio = pixel_ratio(green_mask)
    preset = PROFILE_PRESET_SCAN_PREFER

    dark_luminance_surface = (
        mean_brightness < preset["dark_mean_max"]
        and median_brightness < preset["dark_median_max"]
        and dark_ratio > preset["dark_ratio_min"]
        and bright_ratio < preset["dark_bright_ratio_max"]
    )
    dark_border_surface = (
        border_median < preset["border_median_max"]
        and border_dark_ratio > preset["border_dark_ratio_min"]
        and bright_ratio < preset["border_bright_ratio_max"]
    )
    green_board_surface = (
        green_ratio > preset["green_ratio_min"]
        and median_brightness < preset["green_median_max"]
        and bright_ratio < preset["green_bright_ratio_max"]
    )
    obviously_bright_surface = (
        median_brightness >= preset["bright_median_min"]
        and bright_ratio >= preset["bright_ratio_min"]
        and dark_ratio < preset["bright_dark_ratio_max"]
        and green_ratio < preset["bright_green_ratio_max"]
    )
    pixel_dark_board = dark_luminance_surface or dark_border_surface or green_board_surface
    normalized_hint = normalize_profile_hint(profile_hint)
    hint_dark_board = normalized_hint in DARK_PROFILE_HINTS
    hint_scan_document = normalized_hint in SCAN_PROFILE_HINTS
    dark_hint_supported_by_pixels = (
        pixel_dark_board
        or (
            mean_brightness < preset["hint_mean_max"]
            and median_brightness < preset["hint_median_max"]
            and bright_ratio < preset["hint_bright_ratio_max"]
            and (
                dark_ratio > preset["hint_dark_ratio_min"]
                or border_dark_ratio > preset["hint_border_dark_ratio_min"]
                or green_ratio > preset["hint_green_ratio_min"]
            )
        )
    )

    if obviously_bright_surface:
        profile = "scan_document"
        decision_source = "pixel_bright_scan_document"
    elif hint_dark_board and dark_hint_supported_by_pixels:
        profile = "dark_board"
        decision_source = "hint_dark_board"
    elif pixel_dark_board:
        profile = "dark_board"
        decision_source = "pixel_dark_board"
    elif hint_scan_document:
        profile = "scan_document"
        decision_source = "hint_scan_document"
    else:
        profile = "scan_document"
        decision_source = "pixel_scan_document"

    return profile, {
        "selected_profile": profile,
        "profile_preset": PROFILE_PRESET_NAME,
        "profile_hint": profile_hint,
        "normalized_profile_hint": normalized_hint,
        "decision_source": decision_source,
        "mean_brightness": round(mean_brightness, 4),
        "median_brightness": round(median_brightness, 4),
        "dark_ratio": round(dark_ratio, 4),
        "bright_ratio": round(bright_ratio, 4),
        "border_median": round(border_median, 4),
        "border_dark_ratio": round(border_dark_ratio, 4),
        "green_ratio": round(green_ratio, 4),
        "dark_luminance_surface": dark_luminance_surface,
        "dark_border_surface": dark_border_surface,
        "green_board_surface": green_board_surface,
        "obviously_bright_surface": obviously_bright_surface,
        "dark_hint_supported_by_pixels": dark_hint_supported_by_pixels,
        "hint_dark_board": hint_dark_board,
        "hint_scan_document": hint_scan_document,
    }


def normalize_profile_hint(profile_hint: str | None) -> str | None:
    if profile_hint is None:
        return None
    normalized = profile_hint.strip().lower().replace("_", " ")
    return normalized.split(":", 1)[0]
