"""Shared image helpers for crop enhancement."""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from numpy.typing import NDArray


ImageArray = NDArray[np.uint8]


def resize_max_side(image_bgr: ImageArray, max_side: int) -> ImageArray:
    height, width = image_bgr.shape[:2]
    longest = max(height, width)
    if longest <= max_side:
        return image_bgr.copy()

    scale = max_side / float(longest)
    resized_width = max(1, int(round(width * scale)))
    resized_height = max(1, int(round(height * scale)))
    return cv2.resize(image_bgr, (resized_width, resized_height), interpolation=cv2.INTER_AREA)


def image_size(image: ImageArray) -> dict[str, int]:
    return {"width": int(image.shape[1]), "height": int(image.shape[0])}


def file_size(path: str | None) -> int | None:
    if path is None:
        return None
    return int(Path(path).stat().st_size)


def clamp_int(value: int, min_value: int, max_value: int) -> int:
    return max(min_value, min(max_value, int(value)))


def clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def pixel_ratio(mask: NDArray[np.bool_]) -> float:
    return float(np.count_nonzero(mask)) / float(mask.size)


def border_pixels(gray: ImageArray) -> ImageArray:
    height, width = gray.shape[:2]
    margin = max(1, int(round(min(height, width) * 0.08)))
    return np.concatenate(
        [
            gray[:margin, :].reshape(-1),
            gray[-margin:, :].reshape(-1),
            gray[:, :margin].reshape(-1),
            gray[:, -margin:].reshape(-1),
        ]
    )


def estimate_illumination(lightness: ImageArray) -> ImageArray:
    shortest_side = min(lightness.shape[:2])
    sigma = max(15.0, shortest_side / 8.0)
    return cv2.GaussianBlur(lightness, (0, 0), sigmaX=sigma, sigmaY=sigma)
