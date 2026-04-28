"""Hybrid YOLO-World + OpenCV preprocessing selector for B-SNAP.

The OpenCV-only module remains the baseline. This wrapper adds an optional
YOLO-World surface detector for classroom boards and projector screens, then
compares YOLO and OpenCV candidates before saving one final image.
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

from .board_cropper import BoardCropResult, crop_and_warp_board
from .yolo_world_detector import (
    DEFAULT_MODEL,
    DetectionBox,
    SURFACE_CLASSES,
    YoloWorldDetector,
    draw_detections,
    parse_classes,
)


HYBRID_YOLO_CLASSES = SURFACE_CLASSES
SCREEN_CLASSES = {
    "projector screen",
    "projection screen",
    "presentation screen",
    "screen",
    "projected slide",
}
BOARD_CLASSES = {
    "whiteboard",
    "blackboard",
    "chalkboard",
    "green board",
    "classroom board",
}

ImageArray = NDArray[np.uint8]


@dataclass
class HybridCandidate:
    source: str
    mode: str
    confidence: float
    score: float
    message: str
    image: ImageArray | None = None
    crop_box: dict[str, int] | None = None
    corners: list[list[float]] | None = None
    yolo_detection: dict[str, Any] | None = None
    opencv_result: dict[str, Any] | None = None
    base_score: float | None = None
    quality_score: float = 1.0
    quality_warnings: list[str] = field(default_factory=list)
    quality_metrics: dict[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.base_score is None:
            self.base_score = float(self.score)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "mode": self.mode,
            "confidence": round(float(self.confidence), 4),
            "base_score": round(float(self.base_score or 0.0), 4),
            "score": round(float(self.score), 4),
            "quality_score": round(float(self.quality_score), 4),
            "quality_warnings": self.quality_warnings,
            "quality_metrics": {
                key: round(float(value), 4) for key, value in self.quality_metrics.items()
            },
            "message": self.message,
            "crop_box": self.crop_box,
            "corners": self.corners or [],
            "yolo_detection": self.yolo_detection,
            "opencv_result": self.opencv_result,
        }


@dataclass
class HybridScoringConfig:
    opencv_corner_bonus: float = 0.06
    opencv_unstable_penalty: float = 0.22
    opencv_score_cap: float = 0.95
    writing_top_touch_ratio: float = 0.02
    writing_top_small_area_ratio: float = 0.55
    writing_top_small_penalty: float = 0.34
    writing_top_penalty: float = 0.12

    yolo_screen_bonus: float = 0.23
    yolo_board_bonus: float = 0.18
    yolo_high_conf_threshold: float = 0.3
    yolo_high_conf_bonus: float = 0.15
    yolo_low_conf_threshold: float = 0.12
    yolo_low_conf_penalty: float = 0.18
    yolo_good_area_min: float = 0.12
    yolo_good_area_max: float = 0.78
    yolo_good_area_bonus: float = 0.08
    yolo_tiny_area_ratio: float = 0.04
    yolo_tiny_area_penalty: float = 0.30
    yolo_huge_area_ratio: float = 0.92
    yolo_huge_area_penalty: float = 0.18
    yolo_good_position_top_ratio: float = 0.28
    yolo_good_position_bottom_ratio: float = 0.55
    yolo_good_position_bonus: float = 0.08
    yolo_top_only_bottom_ratio: float = 0.35
    yolo_top_only_penalty: float = 0.22
    yolo_score_cap: float = 0.96

    yolo_refined_yolo_weight: float = 0.45
    yolo_refined_opencv_weight: float = 0.55
    yolo_refined_bonus: float = 0.10
    yolo_refined_min_area_ratio: float = 0.25
    max_yolo_refined_score: float = 0.98

    quality_min_width: int = 96
    quality_min_height: int = 64
    quality_min_area_ratio: float = 0.015
    quality_min_aspect_ratio: float = 0.35
    quality_max_aspect_ratio: float = 8.0
    quality_blur_threshold: float = 18.0
    quality_contrast_threshold: float = 8.0
    quality_min_brightness: float = 18.0
    quality_max_brightness: float = 245.0
    small_crop_penalty: float = 0.25
    extreme_aspect_penalty: float = 0.15
    blur_penalty: float = 0.12
    low_contrast_penalty: float = 0.12
    bad_brightness_penalty: float = 0.08


@dataclass
class HybridPreprocessorConfig:
    model_name: str = DEFAULT_MODEL
    yolo_classes: list[str] | None = field(default_factory=lambda: list(HYBRID_YOLO_CLASSES))
    yolo_conf: float = 0.05
    yolo_iou: float = 0.5
    max_det: int = 20
    yolo_imgsz: int | None = None
    device: str | None = None
    yolo_margin_ratio: float = 0.06
    use_yolo: bool = True
    scoring: HybridScoringConfig = field(default_factory=HybridScoringConfig)
    refine_yolo_with_opencv: bool = True
    enable_quality_check: bool = True


class HybridBoardPreprocessor:
    """Reusable hybrid preprocessor for server or batch workflows.

    The detector instance is created lazily and then reused, so a FastAPI server
    can keep one preprocessor around instead of rebuilding the YOLO wrapper for
    every request.
    """

    def __init__(self, config: HybridPreprocessorConfig | None = None) -> None:
        self.config = config or HybridPreprocessorConfig()
        self._yolo_detector: YoloWorldDetector | None = None

    def preprocess(
        self,
        input_path: str | Path,
        output_path: str | Path | None = None,
        debug_dir: str | Path | None = None,
    ) -> dict[str, Any]:
        detector = self._get_yolo_detector() if self.config.use_yolo else None
        return run_hybrid_preprocess(
            input_path,
            output_path=output_path,
            debug_dir=debug_dir,
            model_name=self.config.model_name,
            yolo_classes=self.config.yolo_classes,
            yolo_conf=self.config.yolo_conf,
            yolo_iou=self.config.yolo_iou,
            max_det=self.config.max_det,
            yolo_imgsz=self.config.yolo_imgsz,
            device=self.config.device,
            yolo_margin_ratio=self.config.yolo_margin_ratio,
            no_yolo=not self.config.use_yolo,
            yolo_detector=detector,
            scoring_config=self.config.scoring,
            refine_yolo_with_opencv=self.config.refine_yolo_with_opencv,
            enable_quality_check=self.config.enable_quality_check,
        )

    def _get_yolo_detector(self) -> YoloWorldDetector:
        if self._yolo_detector is None:
            self._yolo_detector = YoloWorldDetector(self.config.model_name)
        return self._yolo_detector


def run_hybrid_preprocess(
    input_path: str | Path,
    output_path: str | Path | None = None,
    debug_dir: str | Path | None = None,
    *,
    model_name: str = DEFAULT_MODEL,
    yolo_classes: list[str] | None = None,
    yolo_conf: float = 0.05,
    yolo_iou: float = 0.5,
    max_det: int = 20,
    yolo_imgsz: int | None = None,
    device: str | None = None,
    yolo_margin_ratio: float = 0.06,
    no_yolo: bool = False,
    yolo_detector: YoloWorldDetector | None = None,
    scoring_config: HybridScoringConfig | None = None,
    refine_yolo_with_opencv: bool = True,
    enable_quality_check: bool = True,
) -> dict[str, Any]:
    """Run YOLO and OpenCV candidates, then save the best final result."""

    path = Path(input_path)
    if not path.exists():
        return _failure(f"Input image does not exist: {path}")
    if not path.is_file():
        return _failure(f"Input path is not a file: {path}")

    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        return _failure(f"Input image could not be decoded by OpenCV: {path}")

    original_size = {"width": int(image.shape[1]), "height": int(image.shape[0])}
    debug_output = Path(debug_dir) if debug_dir else None
    if debug_output:
        debug_output.mkdir(parents=True, exist_ok=True)

    scoring = scoring_config or HybridScoringConfig()
    effective_yolo_classes = yolo_classes or HYBRID_YOLO_CLASSES
    opencv_results = _build_opencv_results(image, debug=bool(debug_output))
    candidates: list[HybridCandidate] = []
    opencv_candidate_pairs: list[tuple[BoardCropResult, HybridCandidate]] = []
    for result in opencv_results:
        if result.success and result.warped_image is not None:
            candidate = _candidate_from_opencv(result, image.shape, scoring)
            candidates.append(candidate)
            opencv_candidate_pairs.append((result, candidate))

    yolo_error: str | None = None
    yolo_detections: list[DetectionBox] = []
    yolo_annotated_path: str | None = None
    if not no_yolo:
        try:
            detector = yolo_detector or YoloWorldDetector(model_name)
            yolo_detections = detector.detect(
                path,
                image.shape,
                classes=effective_yolo_classes,
                conf=yolo_conf,
                iou=yolo_iou,
                max_det=max_det,
                imgsz=yolo_imgsz,
                device=device,
            )
            yolo_detections.sort(key=lambda item: item.score, reverse=True)
            if debug_output:
                annotated = draw_detections(image, yolo_detections)
                yolo_annotated = debug_output / "01_yolo_annotated.jpg"
                cv2.imwrite(str(yolo_annotated), annotated)
                yolo_annotated_path = str(yolo_annotated)
            for detection in yolo_detections[:5]:
                candidate = _candidate_from_yolo_detection(
                    image,
                    detection,
                    margin_ratio=yolo_margin_ratio,
                    scoring=scoring,
                )
                if candidate is not None:
                    candidates.append(candidate)
                    if refine_yolo_with_opencv:
                        refined = _candidate_from_yolo_refined(
                            candidate,
                            detection,
                            scoring=scoring,
                        )
                        if refined is not None:
                            candidates.append(refined)
        except RuntimeError as exc:
            yolo_error = str(exc)
        except Exception as exc:  # pragma: no cover - external model/runtime guard
            yolo_error = f"YOLO-World detection failed: {exc}"

    if enable_quality_check:
        _apply_quality_checks(candidates, image.shape, scoring)

    selected = _select_best_candidate(candidates)
    opencv_result = _select_best_opencv_result(opencv_results, opencv_candidate_pairs)

    debug_paths: dict[str, str] = {}
    if debug_output:
        debug_paths = _save_hybrid_debug_images(debug_output, image, opencv_results, candidates, selected)
        if yolo_annotated_path:
            debug_paths["01_yolo_annotated.jpg"] = yolo_annotated_path

    saved_output_path: str | None = None
    if selected is not None and output_path and selected.image is not None:
        output = Path(output_path)
        output.parent.mkdir(parents=True, exist_ok=True)
        if cv2.imwrite(str(output), selected.image):
            saved_output_path = str(output)

    success = selected is not None and selected.image is not None
    summary = {
        "success": success,
        "message": _summary_message(selected, yolo_error),
        "input_path": str(path),
        "original_size": original_size,
        "selected_size": _image_size(selected.image) if selected and selected.image is not None else None,
        "selected_candidate": selected.to_dict() if selected else None,
        "candidates": [candidate.to_dict() for candidate in sorted(candidates, key=lambda item: item.score, reverse=True)],
        "yolo_error": yolo_error,
        "yolo_detections": [detection.to_dict() for detection in yolo_detections],
        "opencv_result": opencv_result.to_dict(),
        "opencv_candidates": [result.to_dict() for result in opencv_results],
        "settings": {
            "yolo_classes": effective_yolo_classes,
            "yolo_conf": yolo_conf,
            "yolo_iou": yolo_iou,
            "max_det": max_det,
            "yolo_imgsz": yolo_imgsz,
            "yolo_margin_ratio": yolo_margin_ratio,
            "refine_yolo_with_opencv": refine_yolo_with_opencv,
            "enable_quality_check": enable_quality_check,
        },
        "output_path": saved_output_path,
        "debug_paths": debug_paths,
    }

    if debug_output:
        summary_path = debug_output / "hybrid_summary.json"
        summary["debug_paths"]["hybrid_summary.json"] = str(summary_path)
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    return summary


def _build_opencv_results(image: ImageArray, debug: bool) -> list[BoardCropResult]:
    return [
        crop_and_warp_board(image, debug=debug, mode="board"),
        crop_and_warp_board(image, debug=debug, mode="writing"),
    ]


def _select_best_opencv_result(
    opencv_results: list[BoardCropResult],
    opencv_candidate_pairs: list[tuple[BoardCropResult, HybridCandidate]],
) -> BoardCropResult:
    if opencv_candidate_pairs:
        return max(opencv_candidate_pairs, key=lambda item: item[1].score)[0]
    if opencv_results:
        return opencv_results[0]
    return BoardCropResult(False, "No OpenCV candidates were generated.")


def _candidate_from_opencv(
    result: BoardCropResult,
    image_shape: tuple[int, ...],
    scoring: HybridScoringConfig,
) -> HybridCandidate:
    score = _score_opencv_result(result, image_shape, scoring)
    return HybridCandidate(
        source="opencv",
        mode=str(result.mode_used or result.mode_requested or "auto"),
        confidence=float(result.confidence),
        score=score,
        message=result.message,
        image=result.warped_image,
        crop_box=result.crop_box,
        corners=result.corners,
        opencv_result=result.to_dict(),
    )


def _candidate_from_yolo_detection(
    image: ImageArray,
    detection: DetectionBox,
    *,
    margin_ratio: float,
    scoring: HybridScoringConfig,
) -> HybridCandidate | None:
    crop_box = _xyxy_to_margin_crop_box(detection.xyxy, image.shape, margin_ratio)
    if crop_box is None:
        return None
    cropped = image[
        crop_box["y"] : crop_box["y"] + crop_box["height"],
        crop_box["x"] : crop_box["x"] + crop_box["width"],
    ].copy()
    score = _score_yolo_surface(detection, crop_box, image.shape, scoring)
    return HybridCandidate(
        source="yolo_world",
        mode=detection.class_name,
        confidence=float(detection.confidence),
        score=score,
        message=f"YOLO-World {detection.class_name} region selected.",
        image=cropped,
        crop_box=crop_box,
        yolo_detection=detection.to_dict(),
    )


def _candidate_from_yolo_refined(
    yolo_candidate: HybridCandidate,
    detection: DetectionBox,
    *,
    scoring: HybridScoringConfig,
) -> HybridCandidate | None:
    if yolo_candidate.image is None or yolo_candidate.crop_box is None:
        return None

    refined_result = crop_and_warp_board(yolo_candidate.image, debug=False, mode="board")
    if not refined_result.success or refined_result.warped_image is None:
        return None
    corner_area_ratio = _corner_area_ratio(refined_result.corners, yolo_candidate.image.shape)
    if corner_area_ratio < scoring.yolo_refined_min_area_ratio:
        return None

    opencv_score = _score_opencv_result(refined_result, yolo_candidate.image.shape, scoring)
    yolo_score = float(yolo_candidate.base_score or yolo_candidate.score)
    score = (
        yolo_score * scoring.yolo_refined_yolo_weight
        + opencv_score * scoring.yolo_refined_opencv_weight
        + scoring.yolo_refined_bonus
    )
    score = _clamp(score, 0.0, scoring.max_yolo_refined_score)

    return HybridCandidate(
        source="yolo_world_opencv",
        mode=f"{detection.class_name}:corner_refined",
        confidence=float(detection.confidence),
        score=score,
        message=f"YOLO-World {detection.class_name} region refined by OpenCV corners.",
        image=refined_result.warped_image,
        crop_box=yolo_candidate.crop_box,
        corners=_offset_corners(refined_result.corners, yolo_candidate.crop_box),
        yolo_detection=detection.to_dict(),
        opencv_result=refined_result.to_dict(),
    )


def _score_opencv_result(
    result: BoardCropResult,
    image_shape: tuple[int, ...],
    scoring: HybridScoringConfig,
) -> float:
    score = float(result.confidence)
    if result.mode_used in ("board", "document") and result.fallback is None:
        score += scoring.opencv_corner_bonus
    if result.needs_review or result.fallback is not None:
        score -= scoring.opencv_unstable_penalty
    if result.mode_used == "writing" and result.crop_box:
        image_height, image_width = image_shape[:2]
        crop = result.crop_box
        top_touches = crop["y"] <= image_height * scoring.writing_top_touch_ratio
        area_ratio = (crop["width"] * crop["height"]) / float(image_width * image_height)
        if top_touches and area_ratio < scoring.writing_top_small_area_ratio:
            score -= scoring.writing_top_small_penalty
        elif top_touches:
            score -= scoring.writing_top_penalty
    return _clamp(score, 0.0, scoring.opencv_score_cap)


def _score_yolo_surface(
    detection: DetectionBox,
    crop_box: dict[str, int],
    image_shape: tuple[int, ...],
    scoring: HybridScoringConfig,
) -> float:
    image_height, image_width = image_shape[:2]
    area_ratio = (crop_box["width"] * crop_box["height"]) / float(image_width * image_height)
    score = float(detection.score)

    if detection.class_name in SCREEN_CLASSES:
        score += scoring.yolo_screen_bonus
    elif detection.class_name in BOARD_CLASSES:
        score += scoring.yolo_board_bonus

    if detection.confidence >= scoring.yolo_high_conf_threshold:
        score += scoring.yolo_high_conf_bonus
    elif detection.confidence < scoring.yolo_low_conf_threshold:
        score -= scoring.yolo_low_conf_penalty

    if scoring.yolo_good_area_min <= area_ratio <= scoring.yolo_good_area_max:
        score += scoring.yolo_good_area_bonus
    if area_ratio < scoring.yolo_tiny_area_ratio:
        score -= scoring.yolo_tiny_area_penalty
    if area_ratio > scoring.yolo_huge_area_ratio:
        score -= scoring.yolo_huge_area_penalty

    top = crop_box["y"] / float(image_height)
    bottom = (crop_box["y"] + crop_box["height"]) / float(image_height)
    if top > scoring.yolo_good_position_top_ratio and bottom > scoring.yolo_good_position_bottom_ratio:
        score += scoring.yolo_good_position_bonus
    if bottom < scoring.yolo_top_only_bottom_ratio:
        score -= scoring.yolo_top_only_penalty

    return _clamp(score, 0.0, scoring.yolo_score_cap)


def _apply_quality_checks(
    candidates: list[HybridCandidate],
    original_shape: tuple[int, ...],
    scoring: HybridScoringConfig,
) -> None:
    for candidate in candidates:
        if candidate.image is None:
            continue
        metrics, warnings, penalty = _inspect_crop_quality(candidate.image, original_shape, scoring)
        base_score = float(candidate.base_score if candidate.base_score is not None else candidate.score)
        candidate.base_score = base_score
        candidate.quality_metrics = metrics
        candidate.quality_warnings = warnings
        candidate.quality_score = _clamp(1.0 - penalty, 0.0, 1.0)
        candidate.score = _clamp(base_score - penalty, 0.0, 0.98)


def _inspect_crop_quality(
    image: ImageArray,
    original_shape: tuple[int, ...],
    scoring: HybridScoringConfig,
) -> tuple[dict[str, float], list[str], float]:
    crop_height, crop_width = image.shape[:2]
    original_height, original_width = original_shape[:2]
    crop_area = float(crop_width * crop_height)
    original_area = float(original_width * original_height)
    area_ratio = crop_area / original_area if original_area else 0.0
    aspect_ratio = crop_width / float(crop_height) if crop_height else 0.0

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    blur_score = float(cv2.Laplacian(gray, cv2.CV_64F).var()) if gray.size else 0.0
    contrast = float(np.std(gray)) if gray.size else 0.0
    brightness = float(np.mean(gray)) if gray.size else 0.0

    metrics = {
        "width": float(crop_width),
        "height": float(crop_height),
        "area_ratio": area_ratio,
        "aspect_ratio": aspect_ratio,
        "laplacian_variance": blur_score,
        "contrast": contrast,
        "brightness": brightness,
    }

    warnings: list[str] = []
    penalty = 0.0
    if (
        crop_width < scoring.quality_min_width
        or crop_height < scoring.quality_min_height
        or area_ratio < scoring.quality_min_area_ratio
    ):
        warnings.append("small_crop")
        penalty += scoring.small_crop_penalty
    if aspect_ratio < scoring.quality_min_aspect_ratio or aspect_ratio > scoring.quality_max_aspect_ratio:
        warnings.append("extreme_aspect_ratio")
        penalty += scoring.extreme_aspect_penalty
    if blur_score < scoring.quality_blur_threshold:
        warnings.append("blurry_crop")
        penalty += scoring.blur_penalty
    if contrast < scoring.quality_contrast_threshold:
        warnings.append("low_contrast")
        penalty += scoring.low_contrast_penalty
    if brightness < scoring.quality_min_brightness or brightness > scoring.quality_max_brightness:
        warnings.append("bad_brightness")
        penalty += scoring.bad_brightness_penalty

    return metrics, warnings, penalty


def _offset_corners(corners: list[list[float]], crop_box: dict[str, int]) -> list[list[float]]:
    return [
        [round(float(x) + crop_box["x"], 2), round(float(y) + crop_box["y"], 2)]
        for x, y in corners
    ]


def _corner_area_ratio(corners: list[list[float]], image_shape: tuple[int, ...]) -> float:
    if len(corners) < 3:
        return 0.0
    image_height, image_width = image_shape[:2]
    image_area = max(1.0, float(image_width * image_height))
    try:
        points = np.asarray(corners, dtype=np.float32).reshape(-1, 2)
    except ValueError:
        return 0.0
    return float(cv2.contourArea(points)) / image_area


def _select_best_candidate(candidates: list[HybridCandidate]) -> HybridCandidate | None:
    if not candidates:
        return None
    return max(candidates, key=lambda item: item.score)


def _xyxy_to_margin_crop_box(
    xyxy: list[float],
    image_shape: tuple[int, ...],
    margin_ratio: float,
) -> dict[str, int] | None:
    image_height, image_width = image_shape[:2]
    x1, y1, x2, y2 = xyxy
    width = max(1.0, x2 - x1)
    height = max(1.0, y2 - y1)
    margin_x = width * margin_ratio
    margin_y = height * margin_ratio
    x1 = int(round(max(0.0, x1 - margin_x)))
    y1 = int(round(max(0.0, y1 - margin_y)))
    x2 = int(round(min(float(image_width), x2 + margin_x)))
    y2 = int(round(min(float(image_height), y2 + margin_y)))
    if x2 <= x1 or y2 <= y1:
        return None
    return {"x": x1, "y": y1, "width": x2 - x1, "height": y2 - y1}


def _save_hybrid_debug_images(
    debug_dir: Path,
    original: ImageArray,
    opencv_results: list[BoardCropResult],
    candidates: list[HybridCandidate],
    selected: HybridCandidate | None,
) -> dict[str, str]:
    debug_paths: dict[str, str] = {}

    original_path = debug_dir / "00_original.jpg"
    cv2.imwrite(str(original_path), original)
    debug_paths["00_original.jpg"] = str(original_path)

    for result in opencv_results:
        mode = str(result.mode_used or result.mode_requested or "opencv").replace(" ", "_")
        for name, image in result.debug_images.items():
            debug_name = f"opencv_{mode}_{name}"
            path = debug_dir / debug_name
            if cv2.imwrite(str(path), image):
                debug_paths[debug_name] = str(path)

        if result.warped_image is not None:
            debug_name = f"02_opencv_{mode}_result.jpg"
            path = debug_dir / debug_name
            if cv2.imwrite(str(path), result.warped_image):
                debug_paths[debug_name] = str(path)

    for index, candidate in enumerate(sorted(candidates, key=lambda item: item.score, reverse=True), start=1):
        if candidate.image is None:
            continue
        path = debug_dir / f"candidate_{index:02d}_{candidate.source}_{candidate.mode.replace(' ', '_')}.jpg"
        if cv2.imwrite(str(path), candidate.image):
            debug_paths[path.name] = str(path)

    if selected is not None and selected.image is not None:
        selected_path = debug_dir / "99_selected.jpg"
        if cv2.imwrite(str(selected_path), selected.image):
            debug_paths["99_selected.jpg"] = str(selected_path)

    return debug_paths


def _summary_message(selected: HybridCandidate | None, yolo_error: str | None) -> str:
    if selected is None:
        if yolo_error:
            return f"No reliable candidate selected. YOLO error: {yolo_error}"
        return "No reliable candidate selected."
    return f"Selected {selected.source}:{selected.mode} candidate."


def _failure(message: str) -> dict[str, Any]:
    return {
        "success": False,
        "message": message,
        "original_size": None,
        "selected_size": None,
        "selected_candidate": None,
        "candidates": [],
        "yolo_error": None,
        "yolo_detections": [],
        "opencv_result": None,
        "opencv_candidates": [],
        "settings": {},
        "output_path": None,
        "debug_paths": {},
    }


def _image_size(image: ImageArray) -> dict[str, int]:
    return {"width": int(image.shape[1]), "height": int(image.shape[0])}


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run hybrid YOLO-World + OpenCV preprocessing.")
    parser.add_argument("--input", required=True, help="Input image path.")
    parser.add_argument("--output", help="Optional output path for the selected image.")
    parser.add_argument("--debug-dir", help="Optional directory for debug artifacts.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="YOLO-World weight name or local path.")
    parser.add_argument(
        "--classes",
        nargs="*",
        help="YOLO class prompts. Defaults to all surface prompts.",
    )
    parser.add_argument("--conf", type=float, default=0.05, help="YOLO confidence threshold.")
    parser.add_argument("--iou", type=float, default=0.5, help="YOLO NMS IoU threshold.")
    parser.add_argument("--max-det", type=int, default=20, help="Maximum YOLO detections to keep.")
    parser.add_argument("--imgsz", type=int, help="Optional YOLO inference image size.")
    parser.add_argument("--device", help="Optional YOLO device, e.g. cpu, mps, cuda:0.")
    parser.add_argument("--no-yolo", action="store_true", help="Disable YOLO and use OpenCV candidate only.")
    parser.add_argument(
        "--no-refine-yolo",
        action="store_true",
        help="Disable OpenCV corner refinement inside YOLO crop boxes.",
    )
    parser.add_argument(
        "--no-quality-check",
        action="store_true",
        help="Disable final crop quality score penalties.",
    )
    return parser


def main() -> int:
    parser = _build_arg_parser()
    args = parser.parse_args()
    try:
        cli_classes = parse_classes(args.classes)
        result = run_hybrid_preprocess(
            args.input,
            output_path=args.output,
            debug_dir=args.debug_dir,
            model_name=args.model,
            yolo_classes=cli_classes,
            yolo_conf=args.conf,
            yolo_iou=args.iou,
            max_det=args.max_det,
            yolo_imgsz=args.imgsz,
            device=args.device,
            no_yolo=args.no_yolo,
            refine_yolo_with_opencv=not args.no_refine_yolo,
            enable_quality_check=not args.no_quality_check,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:  # pragma: no cover - CLI severe error guard
        print(json.dumps(_failure(f"Severe execution error: {exc}"), ensure_ascii=False, indent=2))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
