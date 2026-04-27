"""OpenCV-based board detection, cropping, and perspective correction.

This module is intentionally independent from FastAPI or any server framework.
It can run in a backend process, a CLI job, or later in a local/mobile-side
preprocessing pipeline.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray


MAX_DETECTION_WIDTH = 1280
BLUR_KERNEL_SIZE = (5, 5)
CANNY_SIGMA = 0.33
MORPH_KERNEL_SIZE = (7, 7)
MIN_AREA_RATIO = 0.04
ASPECT_RATIO_RANGE = (0.65, 8.0)
MAX_WARP_SIDE = 2400
VALID_MODES = ("auto", "board", "document", "writing")
WRITING_MORPH_KERNEL_SIZE = (17, 17)
WRITING_MARGIN_RATIO = 0.045
WRITING_MIN_INK_RATIO = 0.0008

PointList = list[list[float]]
ImageArray = NDArray[np.uint8]


@dataclass
class BoardCropResult:
    """Structured result for board detection and crop operations."""

    success: bool
    message: str
    corners: PointList = field(default_factory=list)
    confidence: float = 0.0
    original_size: dict[str, int] = field(default_factory=dict)
    warped_size: dict[str, int] | None = None
    output_path: str | None = None
    debug_paths: dict[str, str] = field(default_factory=dict)
    fallback: str | None = None
    mode_requested: str | None = None
    mode_used: str | None = None
    crop_box: dict[str, int] | None = None
    candidates: list[dict[str, Any]] = field(default_factory=list)
    needs_review: bool = False
    warped_image: ImageArray | None = field(default=None, repr=False, compare=False)
    debug_images: dict[str, ImageArray] = field(default_factory=dict, repr=False, compare=False)
    perspective_matrix: NDArray[np.float32] | None = field(default=None, repr=False, compare=False)

    def to_dict(self, include_images: bool = False) -> dict[str, Any]:
        """Return a JSON-friendly dictionary.

        Images are omitted by default because numpy arrays are not JSON
        serializable and can be very large.
        """

        payload: dict[str, Any] = {
            "success": self.success,
            "message": self.message,
            "corners": self.corners,
            "confidence": round(float(self.confidence), 4),
            "original_size": self.original_size,
            "warped_size": self.warped_size,
            "output_path": self.output_path,
            "debug_paths": self.debug_paths,
            "fallback": self.fallback,
            "mode_requested": self.mode_requested,
            "mode_used": self.mode_used,
            "crop_box": self.crop_box,
            "candidates": self.candidates,
            "needs_review": self.needs_review,
        }
        if include_images:
            payload["warped_image"] = self.warped_image
            payload["debug_images"] = self.debug_images
            payload["perspective_matrix"] = self.perspective_matrix
        return payload


def order_points(points: NDArray[np.float32] | list[list[float]] | list[tuple[float, float]]) -> NDArray[np.float32]:
    """Order 4 points as top-left, top-right, bottom-right, bottom-left."""

    pts = np.asarray(points, dtype=np.float32).reshape(-1, 2)
    if pts.shape != (4, 2):
        raise ValueError("order_points requires exactly four 2D points")

    center = pts.mean(axis=0)
    angles = np.arctan2(pts[:, 1] - center[1], pts[:, 0] - center[0])
    ordered = pts[np.argsort(angles)]

    # Start at the visual top-left corner. The angle sort gives clockwise order
    # in image coordinates, then this rotation normalizes the first point.
    top_left_index = int(np.argmin(ordered.sum(axis=1)))
    ordered = np.roll(ordered, -top_left_index, axis=0)

    return ordered.astype(np.float32)


def detect_board_corners(
    image_bgr: ImageArray | None,
    debug: bool = False,
    *,
    max_detection_width: int = MAX_DETECTION_WIDTH,
    blur_kernel_size: tuple[int, int] = BLUR_KERNEL_SIZE,
    canny_thresholds: tuple[int, int] | None = None,
    canny_sigma: float = CANNY_SIGMA,
    morph_kernel_size: tuple[int, int] = MORPH_KERNEL_SIZE,
    min_area_ratio: float = MIN_AREA_RATIO,
    aspect_ratio_range: tuple[float, float] = ASPECT_RATIO_RANGE,
    dilation_iterations: int = 0,
) -> BoardCropResult:
    """Detect the four corners of the main board/writing area."""

    validation_error = _validate_bgr_image(image_bgr)
    if validation_error:
        return BoardCropResult(False, validation_error)

    assert image_bgr is not None
    original_height, original_width = image_bgr.shape[:2]
    original_size = {"width": int(original_width), "height": int(original_height)}

    try:
        resized, scale_to_original = _resize_for_detection(image_bgr, max_detection_width)

        # cvtColor -> GaussianBlur -> Canny -> morphologyEx
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, blur_kernel_size, 0)
        lower, upper = _auto_canny_thresholds(blur, canny_sigma, canny_thresholds)
        edges = cv2.Canny(blur, lower, upper)

        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, morph_kernel_size)
        morph = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
        if dilation_iterations > 0:
            morph = cv2.dilate(morph, kernel, iterations=dilation_iterations)

        contours, _ = cv2.findContours(morph, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        selected = _select_best_quad(
            contours=contours,
            image_shape=resized.shape,
            min_area_ratio=min_area_ratio,
            aspect_ratio_range=aspect_ratio_range,
        )

        debug_images: dict[str, ImageArray] = {}
        if debug:
            debug_images = _build_detection_debug_images(
                resized=resized,
                gray=gray,
                blur=blur,
                edges=edges,
                morph=morph,
                contours=contours,
                selected_points=selected["points"] if selected else None,
            )

        if selected is None:
            return BoardCropResult(
                success=False,
                message="Board corners could not be detected.",
                confidence=0.0,
                original_size=original_size,
                debug_images=debug_images,
            )

        corners_resized = order_points(selected["points"])
        corners_original = corners_resized * float(scale_to_original)
        corners_list = _points_to_list(corners_original)

        confidence = _clamp(float(selected["confidence"]), 0.0, 1.0)
        return BoardCropResult(
            success=True,
            message="Board corners detected.",
            corners=corners_list,
            confidence=confidence,
            original_size=original_size,
            debug_images=debug_images,
            fallback=selected.get("fallback"),
        )
    except Exception as exc:  # pragma: no cover - defensive server-safe guard
        return BoardCropResult(
            success=False,
            message=f"Board detection failed unexpectedly: {exc}",
            confidence=0.0,
            original_size=original_size,
        )


def crop_and_warp_board(
    image_bgr: ImageArray | None,
    debug: bool = False,
    *,
    mode: str = "auto",
    max_warp_side: int = MAX_WARP_SIDE,
    **detection_options: Any,
) -> BoardCropResult:
    """Crop an input image using the requested strategy.

    Modes:
    - auto: choose between perspective board crop and writing-region crop.
    - board/document: prefer 4-corner detection and perspective correction.
    - writing: crop the dense handwriting region with a rectangular crop.
    """

    validation_error = _validate_bgr_image(image_bgr)
    if validation_error:
        return BoardCropResult(False, validation_error)

    assert image_bgr is not None
    selected_mode = _normalize_mode(mode)

    if selected_mode == "writing":
        result = crop_writing_region(image_bgr, debug=debug)
        result.mode_requested = selected_mode
        return result

    if selected_mode in ("board", "document"):
        result = _crop_and_warp_by_corners(
            image_bgr,
            debug=debug,
            max_warp_side=max_warp_side,
            mode_requested=selected_mode,
            mode_used=selected_mode,
            **detection_options,
        )
        return result

    board_result = _crop_and_warp_by_corners(
        image_bgr,
        debug=debug,
        max_warp_side=max_warp_side,
        mode_requested="auto",
        mode_used="board",
        **detection_options,
    )
    writing_result = crop_writing_region(image_bgr, debug=debug)
    writing_result.mode_requested = "auto"

    candidates = _build_auto_candidate_summaries(board_result, writing_result)

    if _should_select_writing_result(board_result, writing_result):
        writing_result.candidates = candidates
        writing_result.debug_images = {**board_result.debug_images, **writing_result.debug_images}
        writing_result.message = "Writing region crop selected by auto mode."
        return writing_result

    if board_result.success:
        board_result.candidates = candidates
        board_result.debug_images = {**board_result.debug_images, **writing_result.debug_images}
        if board_result.needs_review:
            board_result.message = "Board crop selected by auto mode, but result should be reviewed."
        else:
            board_result.message = "Board crop selected by auto mode."
        return board_result

    if writing_result.success:
        writing_result.candidates = candidates
        writing_result.message = "Writing region crop selected because board corners were not reliable."
        return writing_result

    board_result.candidates = candidates
    board_result.message = "Neither board corners nor writing region could be detected."
    return board_result


def detect_writing_region(
    image_bgr: ImageArray | None,
    debug: bool = False,
    *,
    max_detection_width: int = MAX_DETECTION_WIDTH,
    margin_ratio: float = WRITING_MARGIN_RATIO,
) -> BoardCropResult:
    """Detect a rectangular region containing dense handwriting strokes."""

    validation_error = _validate_bgr_image(image_bgr)
    if validation_error:
        return BoardCropResult(False, validation_error, mode_requested="writing", mode_used="writing")

    assert image_bgr is not None
    original_height, original_width = image_bgr.shape[:2]
    original_size = {"width": int(original_width), "height": int(original_height)}

    try:
        resized, scale_to_original = _resize_for_detection(image_bgr, max_detection_width)
        gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray, BLUR_KERNEL_SIZE, 0)
        stroke_mask = _build_writing_stroke_mask(blur)
        selected_mask, crop_box_resized, stats = _select_writing_box(
            stroke_mask,
            resized.shape,
            margin_ratio=margin_ratio,
        )

        debug_images: dict[str, ImageArray] = {}
        if debug:
            crop_debug = resized.copy()
            if crop_box_resized is not None:
                x, y, w, h = crop_box_resized
                cv2.rectangle(crop_debug, (x, y), (x + w, y + h), (0, 255, 0), 3)
            debug_images = {
                "09_writing_mask.jpg": stroke_mask,
                "10_writing_components.jpg": selected_mask,
                "11_writing_crop_box.jpg": crop_debug,
            }

        if crop_box_resized is None:
            return BoardCropResult(
                success=False,
                message="Writing region could not be detected.",
                confidence=0.0,
                original_size=original_size,
                mode_requested="writing",
                mode_used="writing",
                debug_images=debug_images,
            )

        x, y, w, h = crop_box_resized
        box_original = {
            "x": int(round(x * scale_to_original)),
            "y": int(round(y * scale_to_original)),
            "width": int(round(w * scale_to_original)),
            "height": int(round(h * scale_to_original)),
        }
        box_original = _clip_crop_box(box_original, original_width, original_height)
        confidence = _score_writing_box(box_original, original_size, stats)

        return BoardCropResult(
            success=True,
            message="Writing region detected.",
            confidence=confidence,
            original_size=original_size,
            warped_size={"width": box_original["width"], "height": box_original["height"]},
            mode_requested="writing",
            mode_used="writing",
            crop_box=box_original,
            debug_images=debug_images,
        )
    except Exception as exc:  # pragma: no cover - defensive server-safe guard
        return BoardCropResult(
            success=False,
            message=f"Writing region detection failed unexpectedly: {exc}",
            confidence=0.0,
            original_size=original_size,
            mode_requested="writing",
            mode_used="writing",
        )


def crop_writing_region(
    image_bgr: ImageArray | None,
    debug: bool = False,
    *,
    max_detection_width: int = MAX_DETECTION_WIDTH,
    margin_ratio: float = WRITING_MARGIN_RATIO,
) -> BoardCropResult:
    """Crop the dense handwriting region without forcing perspective warp."""

    detection = detect_writing_region(
        image_bgr,
        debug=debug,
        max_detection_width=max_detection_width,
        margin_ratio=margin_ratio,
    )
    if not detection.success:
        return detection

    validation_error = _validate_bgr_image(image_bgr)
    if validation_error:
        return BoardCropResult(False, validation_error)

    assert image_bgr is not None
    assert detection.crop_box is not None

    x = detection.crop_box["x"]
    y = detection.crop_box["y"]
    w = detection.crop_box["width"]
    h = detection.crop_box["height"]
    cropped = image_bgr[y : y + h, x : x + w].copy()

    debug_images = dict(detection.debug_images)
    if debug:
        final_debug = image_bgr.copy()
        cv2.rectangle(final_debug, (x, y), (x + w, y + h), (0, 255, 0), 4)
        debug_images["07_selected_corners.jpg"] = final_debug
        debug_images["08_warped.jpg"] = cropped

    return BoardCropResult(
        success=True,
        message="Writing region cropped.",
        confidence=detection.confidence,
        original_size=detection.original_size,
        warped_size={"width": int(w), "height": int(h)},
        mode_requested=detection.mode_requested,
        mode_used="writing",
        crop_box=detection.crop_box,
        warped_image=cropped,
        debug_images=debug_images,
    )


def _crop_and_warp_by_corners(
    image_bgr: ImageArray,
    debug: bool,
    *,
    max_warp_side: int,
    mode_requested: str,
    mode_used: str,
    **detection_options: Any,
) -> BoardCropResult:
    detection = detect_board_corners(image_bgr, debug=debug, **detection_options)
    detection.mode_requested = mode_requested
    detection.mode_used = mode_used
    if not detection.success:
        return detection

    try:
        src = order_points(detection.corners)
        target_width, target_height = _compute_warp_size(src, max_warp_side)
        if target_width < 2 or target_height < 2:
            return BoardCropResult(
                success=False,
                message="Detected board is too small to warp.",
                corners=detection.corners,
                confidence=detection.confidence,
                original_size=detection.original_size,
                debug_images=detection.debug_images,
                fallback=detection.fallback,
                mode_requested=mode_requested,
                mode_used=mode_used,
            )

        dst = np.array(
            [
                [0, 0],
                [target_width - 1, 0],
                [target_width - 1, target_height - 1],
                [0, target_height - 1],
            ],
            dtype=np.float32,
        )
        matrix = cv2.getPerspectiveTransform(src.astype(np.float32), dst)
        warped = cv2.warpPerspective(image_bgr, matrix, (target_width, target_height))

        debug_images = dict(detection.debug_images)
        if debug:
            selected = image_bgr.copy()
            _draw_ordered_corners(selected, src)
            debug_images["07_selected_corners.jpg"] = selected
            debug_images["08_warped.jpg"] = warped

        needs_review = detection.fallback is not None or detection.confidence < 0.68

        return BoardCropResult(
            success=True,
            message="Board cropped and perspective-corrected.",
            corners=detection.corners,
            confidence=detection.confidence,
            original_size=detection.original_size,
            warped_size={"width": int(target_width), "height": int(target_height)},
            fallback=detection.fallback,
            mode_requested=mode_requested,
            mode_used=mode_used,
            needs_review=needs_review,
            warped_image=warped,
            debug_images=debug_images,
            perspective_matrix=matrix,
        )
    except Exception as exc:  # pragma: no cover - defensive server-safe guard
        return BoardCropResult(
            success=False,
            message=f"Perspective correction failed unexpectedly: {exc}",
            corners=detection.corners,
            confidence=detection.confidence,
            original_size=detection.original_size,
            debug_images=detection.debug_images,
            fallback=detection.fallback,
            mode_requested=mode_requested,
            mode_used=mode_used,
        )


def preprocess_board_image(
    input_path: str | Path,
    output_path: str | Path | None = None,
    debug_dir: str | Path | None = None,
    mode: str = "auto",
) -> BoardCropResult:
    """Load an image from disk, run the full pipeline, and optionally save files."""

    path = Path(input_path)
    if not path.exists():
        return BoardCropResult(False, f"Input image does not exist: {path}")
    if not path.is_file():
        return BoardCropResult(False, f"Input path is not a file: {path}")

    image_bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image_bgr is None:
        return BoardCropResult(False, f"Input image could not be decoded: {path}")

    result = crop_and_warp_board(image_bgr, debug=bool(debug_dir), mode=mode)

    if output_path and result.success and result.warped_image is not None:
        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        if not cv2.imwrite(str(output), result.warped_image):
            result.success = False
            result.message = f"Failed to save warped image: {output}"
        else:
            result.output_path = str(output)

    if debug_dir and result.debug_images:
        result.debug_paths = _save_debug_images(Path(debug_dir), result.debug_images)

    return result


def _validate_bgr_image(image_bgr: ImageArray | None) -> str | None:
    if image_bgr is None:
        return "Input image is None."
    if not isinstance(image_bgr, np.ndarray):
        return "Input image must be a numpy ndarray."
    if image_bgr.size == 0:
        return "Input image is empty."
    if image_bgr.ndim != 3 or image_bgr.shape[2] != 3:
        return "Input image must be a BGR image with 3 channels."
    return None


def _resize_for_detection(image_bgr: ImageArray, max_detection_width: int) -> tuple[ImageArray, float]:
    height, width = image_bgr.shape[:2]
    if width <= max_detection_width:
        return image_bgr.copy(), 1.0

    scale = max_detection_width / float(width)
    resized_height = max(1, int(round(height * scale)))
    resized = cv2.resize(image_bgr, (max_detection_width, resized_height), interpolation=cv2.INTER_AREA)
    return resized, 1.0 / scale


def _auto_canny_thresholds(
    image_gray: ImageArray,
    sigma: float,
    manual_thresholds: tuple[int, int] | None,
) -> tuple[int, int]:
    if manual_thresholds is not None:
        low, high = manual_thresholds
        return int(_clamp(low, 0, 255)), int(_clamp(high, 0, 255))

    median = float(np.median(image_gray))
    if median < 1.0:
        return 50, 150

    lower = int(max(0, (1.0 - sigma) * median))
    upper = int(min(255, (1.0 + sigma) * median))
    if lower == upper:
        upper = min(255, lower + 1)
    return lower, upper


def _normalize_mode(mode: str) -> str:
    normalized = mode.strip().lower()
    if normalized not in VALID_MODES:
        raise ValueError(f"Unsupported mode '{mode}'. Expected one of: {', '.join(VALID_MODES)}")
    return normalized


def _build_auto_candidate_summaries(
    board_result: BoardCropResult,
    writing_result: BoardCropResult,
) -> list[dict[str, Any]]:
    return [
        {
            "mode": "board",
            "success": board_result.success,
            "confidence": round(float(board_result.confidence), 4),
            "fallback": board_result.fallback,
            "needs_review": board_result.needs_review,
            "warped_size": board_result.warped_size,
        },
        {
            "mode": "writing",
            "success": writing_result.success,
            "confidence": round(float(writing_result.confidence), 4),
            "crop_box": writing_result.crop_box,
            "warped_size": writing_result.warped_size,
        },
    ]


def _should_select_writing_result(
    board_result: BoardCropResult,
    writing_result: BoardCropResult,
) -> bool:
    if not writing_result.success:
        return False
    if not board_result.success:
        return True

    board_score = float(board_result.confidence)
    writing_score = float(writing_result.confidence)
    if board_result.fallback is not None:
        board_score -= 0.18
    if board_result.needs_review:
        board_score -= 0.08

    # A reliable four-corner crop is still preferred. Writing crop takes over
    # when the board crop was built from a risky fallback or has clearly lower
    # score.
    if board_result.fallback is None and board_result.confidence >= 0.82:
        return False
    return writing_score >= board_score - 0.02


def _build_writing_stroke_mask(gray_blur: ImageArray) -> ImageArray:
    stroke_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 15))
    light_strokes = cv2.morphologyEx(gray_blur, cv2.MORPH_TOPHAT, stroke_kernel)
    dark_strokes = cv2.morphologyEx(gray_blur, cv2.MORPH_BLACKHAT, stroke_kernel)

    _, light_mask = cv2.threshold(light_strokes, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    _, dark_mask = cv2.threshold(dark_strokes, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mask = cv2.bitwise_or(light_mask, dark_mask)

    cleanup_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    return cv2.morphologyEx(mask, cv2.MORPH_OPEN, cleanup_kernel)


def _select_writing_box(
    stroke_mask: ImageArray,
    image_shape: tuple[int, ...],
    *,
    margin_ratio: float,
) -> tuple[ImageArray, tuple[int, int, int, int] | None, dict[str, float]]:
    image_height, image_width = image_shape[:2]
    image_area = float(image_width * image_height)
    connect_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, WRITING_MORPH_KERNEL_SIZE)
    connected = cv2.dilate(stroke_mask, connect_kernel, iterations=1)
    label_count, labels, stats, _ = cv2.connectedComponentsWithStats(connected, connectivity=8)

    components: list[dict[str, Any]] = []
    for label in range(1, label_count):
        x, y, width, height, area = [int(value) for value in stats[label]]
        if area < max(20, int(image_area * 0.00018)):
            continue
        if width < 8 or height < 5:
            continue

        component_mask = stroke_mask[y : y + height, x : x + width]
        ink = int(cv2.countNonZero(component_mask))
        if ink < max(6, int(image_area * 0.00002)):
            continue

        rect_area = float(width * height)
        density = ink / rect_area if rect_area else 0.0
        center_y = y + (height / 2.0)
        score = float(ink) * (1.0 + min(density * 18.0, 2.0))

        # Ceiling lights, projector edges, desks, and monitors often live near
        # the very top/bottom. Penalize them instead of removing them outright,
        # because some notes can genuinely be close to the page boundary.
        if y < image_height * 0.12 and width > image_width * 0.18 and height < image_height * 0.08:
            score *= 0.2
        if center_y > image_height * 0.78:
            score *= 0.22
        if center_y > image_height * 0.88:
            score *= 0.35
        if y > image_height * 0.72 and height > image_height * 0.12:
            score *= 0.35
        if width > image_width * 0.92 and height < image_height * 0.08:
            score *= 0.15

        components.append(
            {
                "label": label,
                "x": x,
                "y": y,
                "width": width,
                "height": height,
                "ink": ink,
                "density": density,
                "score": score,
            }
        )

    selected_mask = np.zeros_like(stroke_mask)
    if not components:
        return selected_mask, None, {"ink_ratio": 0.0, "density": 0.0, "component_count": 0.0}

    components.sort(key=lambda item: item["score"], reverse=True)
    max_score = float(components[0]["score"])
    selected = [
        component
        for component in components[:30]
        if component["score"] >= max(max_score * 0.24, 12.0)
    ]
    selected = [
        component
        for component in selected
        if not (
            component["y"] + component["height"] / 2.0 > image_height * 0.82
            and component["score"] < max_score * 0.55
        )
    ]
    if not selected:
        return selected_mask, None, {"ink_ratio": 0.0, "density": 0.0, "component_count": 0.0}

    x1 = min(component["x"] for component in selected)
    y1 = min(component["y"] for component in selected)
    x2 = max(component["x"] + component["width"] for component in selected)
    y2 = max(component["y"] + component["height"] for component in selected)

    for component in selected:
        selected_mask[labels == component["label"]] = 255

    selected_ink = int(cv2.countNonZero(cv2.bitwise_and(stroke_mask, selected_mask)))
    if selected_ink / image_area < WRITING_MIN_INK_RATIO:
        return selected_mask, None, {"ink_ratio": selected_ink / image_area, "density": 0.0, "component_count": 0.0}

    margin_x = max(8, int(round(image_width * margin_ratio)))
    margin_y = max(8, int(round(image_height * margin_ratio)))
    x1 = max(0, x1 - margin_x)
    y1 = max(0, y1 - margin_y)
    x2 = min(image_width, x2 + margin_x)
    y2 = min(image_height, y2 + margin_y)
    box_width = max(1, x2 - x1)
    box_height = max(1, y2 - y1)
    box_area = float(box_width * box_height)
    density = selected_ink / box_area if box_area else 0.0

    stats_payload = {
        "ink_ratio": selected_ink / image_area,
        "density": density,
        "component_count": float(len(selected)),
        "box_area_ratio": box_area / image_area,
    }
    return selected_mask, (x1, y1, box_width, box_height), stats_payload


def _clip_crop_box(crop_box: dict[str, int], image_width: int, image_height: int) -> dict[str, int]:
    x = int(_clamp(crop_box["x"], 0, max(0, image_width - 1)))
    y = int(_clamp(crop_box["y"], 0, max(0, image_height - 1)))
    width = int(_clamp(crop_box["width"], 1, image_width - x))
    height = int(_clamp(crop_box["height"], 1, image_height - y))
    return {"x": x, "y": y, "width": width, "height": height}


def _score_writing_box(
    crop_box: dict[str, int],
    original_size: dict[str, int],
    stats: dict[str, float],
) -> float:
    image_area = float(original_size["width"] * original_size["height"])
    box_area = float(crop_box["width"] * crop_box["height"])
    box_area_ratio = box_area / image_area if image_area else 0.0
    ink_score = min(stats.get("ink_ratio", 0.0) / 0.018, 1.0)
    density_score = min(stats.get("density", 0.0) / 0.08, 1.0)
    area_score = 1.0 - min(abs(box_area_ratio - 0.42) / 0.42, 1.0)

    confidence = 0.34 + (ink_score * 0.32) + (density_score * 0.2) + (area_score * 0.14)
    bottom = crop_box["y"] + crop_box["height"]
    if bottom > original_size["height"] * 0.94 and box_area_ratio > 0.55:
        confidence -= 0.16
    return _clamp(confidence, 0.0, 0.88)


def _select_best_quad(
    contours: tuple[NDArray[np.int32], ...] | list[NDArray[np.int32]],
    image_shape: tuple[int, ...],
    min_area_ratio: float,
    aspect_ratio_range: tuple[float, float],
) -> dict[str, Any] | None:
    image_height, image_width = image_shape[:2]
    image_area = float(image_width * image_height)
    sorted_contours = sorted(contours, key=cv2.contourArea, reverse=True)

    best: dict[str, Any] | None = None
    for contour in sorted_contours[:30]:
        candidate = _candidate_from_contour(
            contour,
            image_shape=image_shape,
            image_area=image_area,
            min_area_ratio=min_area_ratio,
            aspect_ratio_range=aspect_ratio_range,
            fallback=None,
        )
        best = _choose_higher_confidence(best, candidate)

    if best is not None:
        return best

    for contour in sorted_contours[:30]:
        hull = cv2.convexHull(contour)
        candidate = _candidate_from_contour(
            hull,
            image_shape=image_shape,
            image_area=image_area,
            min_area_ratio=min_area_ratio,
            aspect_ratio_range=aspect_ratio_range,
            fallback="convex_hull",
        )
        best = _choose_higher_confidence(best, candidate)

    if best is not None:
        return best

    for contour in sorted_contours[:10]:
        area = cv2.contourArea(contour)
        area_ratio = area / image_area if image_area else 0.0
        if area_ratio < min_area_ratio:
            continue

        rect = cv2.minAreaRect(contour)
        box = cv2.boxPoints(rect).astype(np.float32)
        if not _passes_shape_filters(box, area, image_area, min_area_ratio, aspect_ratio_range):
            continue

        confidence = _score_candidate(area_ratio, box, fallback="min_area_rect", image_shape=image_shape)
        best = _choose_higher_confidence(
            best,
            {"points": box, "confidence": min(confidence, 0.48), "fallback": "min_area_rect"},
        )

    return best


def _candidate_from_contour(
    contour: NDArray[np.int32],
    *,
    image_shape: tuple[int, ...],
    image_area: float,
    min_area_ratio: float,
    aspect_ratio_range: tuple[float, float],
    fallback: str | None,
) -> dict[str, Any] | None:
    area = cv2.contourArea(contour)
    area_ratio = area / image_area if image_area else 0.0
    if area_ratio < min_area_ratio:
        return None

    perimeter = cv2.arcLength(contour, True)
    if perimeter <= 0:
        return None

    epsilon_factors = (0.02, 0.01, 0.015, 0.03, 0.04, 0.05, 0.06, 0.08)
    for epsilon_factor in epsilon_factors:
        approx = cv2.approxPolyDP(contour, epsilon_factor * perimeter, True)
        if len(approx) != 4:
            continue

        points = approx.reshape(4, 2).astype(np.float32)
        if not _passes_shape_filters(points, area, image_area, min_area_ratio, aspect_ratio_range):
            continue

        confidence = _score_candidate(area_ratio, points, fallback=fallback, image_shape=image_shape)
        return {"points": points, "confidence": confidence, "fallback": fallback}

    return None


def _passes_shape_filters(
    points: NDArray[np.float32],
    contour_area: float,
    image_area: float,
    min_area_ratio: float,
    aspect_ratio_range: tuple[float, float],
) -> bool:
    if len(points) != 4:
        return False

    ordered = order_points(points)
    polygon_area = abs(float(cv2.contourArea(ordered)))
    area_ratio = polygon_area / image_area if image_area else 0.0
    if area_ratio < min_area_ratio:
        return False

    if contour_area <= 0 or polygon_area <= 0:
        return False

    if polygon_area < contour_area * 0.65:
        return False

    if not cv2.isContourConvex(ordered.reshape(-1, 1, 2).astype(np.float32)):
        return False

    width, height = _quad_width_height(ordered)
    if width < 20 or height < 20:
        return False

    aspect_ratio = width / height if height else 0.0
    min_aspect, max_aspect = aspect_ratio_range
    return min_aspect <= aspect_ratio <= max_aspect


def _score_candidate(
    area_ratio: float,
    points: NDArray[np.float32],
    fallback: str | None,
    image_shape: tuple[int, ...],
) -> float:
    ordered = order_points(points)
    width, height = _quad_width_height(ordered)
    aspect_ratio = width / height if height else 0.0

    area_score = min(area_ratio / 0.45, 1.0)
    aspect_score = 1.0 - min(abs(aspect_ratio - 2.0) / 4.0, 1.0)
    base = 0.48 + (area_score * 0.34) + (aspect_score * 0.12)
    base -= _edge_touch_penalty(ordered, image_shape)

    if fallback == "convex_hull":
        base = min(base, 0.62)
    elif fallback == "min_area_rect":
        base = min(base, 0.48)
    else:
        base += 0.05

    return _clamp(base, 0.0, 0.95)


def _edge_touch_penalty(points: NDArray[np.float32], image_shape: tuple[int, ...]) -> float:
    image_height, image_width = image_shape[:2]
    margin_x = max(3.0, image_width * 0.025)
    margin_y = max(3.0, image_height * 0.025)
    penalty = 0.0

    for x, y in order_points(points):
        if x <= margin_x or x >= image_width - 1 - margin_x:
            penalty += 0.045
        if y >= image_height - 1 - margin_y:
            penalty += 0.055
        if y <= margin_y:
            penalty += 0.02

    top_y = float(np.min(points[:, 1]))
    bottom_y = float(np.max(points[:, 1]))
    if bottom_y > image_height * 0.9:
        penalty += 0.08
    if top_y > image_height * 0.45:
        penalty += 0.12

    return min(penalty, 0.35)


def _choose_higher_confidence(
    current: dict[str, Any] | None,
    candidate: dict[str, Any] | None,
) -> dict[str, Any] | None:
    if candidate is None:
        return current
    if current is None:
        return candidate
    return candidate if candidate["confidence"] > current["confidence"] else current


def _compute_warp_size(points: NDArray[np.float32], max_warp_side: int) -> tuple[int, int]:
    width, height = _quad_width_height(points)
    target_width = max(1, int(round(width)))
    target_height = max(1, int(round(height)))

    # Very large photos can produce huge warps. Clamp the longest side while
    # preserving the board aspect ratio so server/mobile memory use stays sane.
    longest_side = max(target_width, target_height)
    if longest_side > max_warp_side:
        scale = max_warp_side / float(longest_side)
        target_width = max(1, int(round(target_width * scale)))
        target_height = max(1, int(round(target_height * scale)))

    return target_width, target_height


def _quad_width_height(points: NDArray[np.float32]) -> tuple[float, float]:
    top_left, top_right, bottom_right, bottom_left = order_points(points)
    width_top = np.linalg.norm(top_right - top_left)
    width_bottom = np.linalg.norm(bottom_right - bottom_left)
    height_right = np.linalg.norm(bottom_right - top_right)
    height_left = np.linalg.norm(bottom_left - top_left)
    return float(max(width_top, width_bottom)), float(max(height_right, height_left))


def _points_to_list(points: NDArray[np.float32]) -> PointList:
    return [[round(float(x), 2), round(float(y), 2)] for x, y in points]


def _build_detection_debug_images(
    *,
    resized: ImageArray,
    gray: ImageArray,
    blur: ImageArray,
    edges: ImageArray,
    morph: ImageArray,
    contours: tuple[NDArray[np.int32], ...] | list[NDArray[np.int32]],
    selected_points: NDArray[np.float32] | None,
) -> dict[str, ImageArray]:
    contours_debug = resized.copy()
    cv2.drawContours(contours_debug, list(contours)[:30], -1, (0, 180, 255), 2)
    if selected_points is not None:
        _draw_ordered_corners(contours_debug, order_points(selected_points))

    return {
        "01_resized_input.jpg": resized,
        "02_gray.jpg": gray,
        "03_blur.jpg": blur,
        "04_edges.jpg": edges,
        "05_morph.jpg": morph,
        "06_contours.jpg": contours_debug,
    }


def _draw_ordered_corners(image: ImageArray, points: NDArray[np.float32]) -> None:
    ordered = order_points(points)
    contour = ordered.reshape(-1, 1, 2).astype(np.int32)
    cv2.polylines(image, [contour], isClosed=True, color=(0, 255, 0), thickness=3)

    labels = ("TL", "TR", "BR", "BL")
    for label, point in zip(labels, ordered, strict=True):
        x, y = int(round(point[0])), int(round(point[1]))
        cv2.circle(image, (x, y), 8, (0, 0, 255), -1)
        cv2.putText(image, label, (x + 8, y - 8), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)


def _save_debug_images(debug_dir: Path, debug_images: dict[str, ImageArray]) -> dict[str, str]:
    debug_dir.mkdir(parents=True, exist_ok=True)
    debug_paths: dict[str, str] = {}
    ordered_names = [
        "01_resized_input.jpg",
        "02_gray.jpg",
        "03_blur.jpg",
        "04_edges.jpg",
        "05_morph.jpg",
        "06_contours.jpg",
        "07_selected_corners.jpg",
        "08_warped.jpg",
        "09_writing_mask.jpg",
        "10_writing_components.jpg",
        "11_writing_crop_box.jpg",
    ]
    for name in ordered_names:
        image = debug_images.get(name)
        if image is None:
            continue
        path = debug_dir / name
        if cv2.imwrite(str(path), image):
            debug_paths[name] = str(path)
    for name, image in sorted(debug_images.items()):
        if name in debug_paths:
            continue
        path = debug_dir / name
        if cv2.imwrite(str(path), image):
            debug_paths[name] = str(path)
    return debug_paths


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Detect, crop, and perspective-correct a board image.")
    parser.add_argument("--input", required=True, help="Input image path.")
    parser.add_argument("--output", help="Optional output path for the warped board image.")
    parser.add_argument("--debug-dir", help="Optional directory for intermediate debug images.")
    parser.add_argument(
        "--mode",
        choices=VALID_MODES,
        default="auto",
        help="Preprocessing strategy. auto chooses between board/document warp and writing crop.",
    )
    return parser


def main() -> int:
    parser = _build_arg_parser()
    args = parser.parse_args()

    try:
        result = preprocess_board_image(args.input, output_path=args.output, debug_dir=args.debug_dir, mode=args.mode)
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:  # pragma: no cover - CLI severe error guard
        print(json.dumps({"success": False, "message": f"Severe execution error: {exc}"}, ensure_ascii=False, indent=2))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
