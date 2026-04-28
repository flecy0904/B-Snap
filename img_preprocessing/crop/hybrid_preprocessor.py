"""Hybrid YOLO-World + OpenCV preprocessing selector for B-SNAP.

The OpenCV-only module remains the baseline. This wrapper adds an optional
YOLO-World surface detector for classroom boards and projector screens, then
compares YOLO and OpenCV candidates before saving one final image.
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
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

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "mode": self.mode,
            "confidence": round(float(self.confidence), 4),
            "score": round(float(self.score), 4),
            "message": self.message,
            "crop_box": self.crop_box,
            "corners": self.corners or [],
            "yolo_detection": self.yolo_detection,
            "opencv_result": self.opencv_result,
        }


@dataclass
class HybridPreprocessorConfig:
    model_name: str = DEFAULT_MODEL
    yolo_classes: list[str] | None = None
    yolo_conf: float = 0.05
    yolo_iou: float = 0.5
    max_det: int = 20
    device: str | None = None
    yolo_margin_ratio: float = 0.035
    use_yolo: bool = True


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
            device=self.config.device,
            yolo_margin_ratio=self.config.yolo_margin_ratio,
            no_yolo=not self.config.use_yolo,
            yolo_detector=detector,
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
    device: str | None = None,
    yolo_margin_ratio: float = 0.035,
    no_yolo: bool = False,
    yolo_detector: YoloWorldDetector | None = None,
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

    opencv_result = crop_and_warp_board(image, debug=bool(debug_output), mode="auto")
    candidates: list[HybridCandidate] = []
    if opencv_result.success and opencv_result.warped_image is not None:
        candidates.append(_candidate_from_opencv(opencv_result, image.shape))

    yolo_error: str | None = None
    yolo_detections: list[DetectionBox] = []
    yolo_annotated_path: str | None = None
    if not no_yolo:
        try:
            detector = yolo_detector or YoloWorldDetector(model_name)
            yolo_detections = detector.detect(
                path,
                image.shape,
                classes=yolo_classes or HYBRID_YOLO_CLASSES,
                conf=yolo_conf,
                iou=yolo_iou,
                max_det=max_det,
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
                )
                if candidate is not None:
                    candidates.append(candidate)
        except RuntimeError as exc:
            yolo_error = str(exc)
        except Exception as exc:  # pragma: no cover - external model/runtime guard
            yolo_error = f"YOLO-World detection failed: {exc}"

    selected = _select_best_candidate(candidates)

    debug_paths: dict[str, str] = {}
    if debug_output:
        debug_paths = _save_hybrid_debug_images(debug_output, image, opencv_result, candidates, selected)
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
        "output_path": saved_output_path,
        "debug_paths": debug_paths,
    }

    if debug_output:
        summary_path = debug_output / "hybrid_summary.json"
        summary["debug_paths"]["hybrid_summary.json"] = str(summary_path)
        summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    return summary


def _candidate_from_opencv(result: BoardCropResult, image_shape: tuple[int, ...]) -> HybridCandidate:
    score = _score_opencv_result(result, image_shape)
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
) -> HybridCandidate | None:
    crop_box = _xyxy_to_margin_crop_box(detection.xyxy, image.shape, margin_ratio)
    if crop_box is None:
        return None
    cropped = image[
        crop_box["y"] : crop_box["y"] + crop_box["height"],
        crop_box["x"] : crop_box["x"] + crop_box["width"],
    ].copy()
    score = _score_yolo_surface(detection, crop_box, image.shape)
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


def _score_opencv_result(result: BoardCropResult, image_shape: tuple[int, ...]) -> float:
    score = float(result.confidence)
    if result.mode_used in ("board", "document") and result.fallback is None:
        score += 0.06
    if result.needs_review or result.fallback is not None:
        score -= 0.22
    if result.mode_used == "writing" and result.crop_box:
        image_height, image_width = image_shape[:2]
        crop = result.crop_box
        top_touches = crop["y"] <= image_height * 0.02
        area_ratio = (crop["width"] * crop["height"]) / float(image_width * image_height)
        if top_touches and area_ratio < 0.55:
            score -= 0.34
        elif top_touches:
            score -= 0.12
    return _clamp(score, 0.0, 0.95)


def _score_yolo_surface(
    detection: DetectionBox,
    crop_box: dict[str, int],
    image_shape: tuple[int, ...],
) -> float:
    image_height, image_width = image_shape[:2]
    area_ratio = (crop_box["width"] * crop_box["height"]) / float(image_width * image_height)
    score = float(detection.score)

    if detection.class_name in SCREEN_CLASSES:
        score += 0.23
    elif detection.class_name in BOARD_CLASSES:
        score += 0.18

    if detection.confidence >= 0.3:
        score += 0.15
    elif detection.confidence < 0.12:
        score -= 0.18

    if 0.12 <= area_ratio <= 0.78:
        score += 0.08
    if area_ratio < 0.04:
        score -= 0.3
    if area_ratio > 0.92:
        score -= 0.18

    top = crop_box["y"] / float(image_height)
    bottom = (crop_box["y"] + crop_box["height"]) / float(image_height)
    if top > 0.28 and bottom > 0.55:
        score += 0.08
    if bottom < 0.35:
        score -= 0.22

    return _clamp(score, 0.0, 0.96)


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
    opencv_result: BoardCropResult,
    candidates: list[HybridCandidate],
    selected: HybridCandidate | None,
) -> dict[str, str]:
    debug_paths: dict[str, str] = {}

    original_path = debug_dir / "00_original.jpg"
    cv2.imwrite(str(original_path), original)
    debug_paths["00_original.jpg"] = str(original_path)

    for name, image in opencv_result.debug_images.items():
        path = debug_dir / f"opencv_{name}"
        if cv2.imwrite(str(path), image):
            debug_paths[f"opencv_{name}"] = str(path)

    if opencv_result.warped_image is not None:
        path = debug_dir / "02_opencv_result.jpg"
        if cv2.imwrite(str(path), opencv_result.warped_image):
            debug_paths["02_opencv_result.jpg"] = str(path)

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
        help="YOLO class prompts. Defaults to board/screen classes only.",
    )
    parser.add_argument("--conf", type=float, default=0.05, help="YOLO confidence threshold.")
    parser.add_argument("--iou", type=float, default=0.5, help="YOLO NMS IoU threshold.")
    parser.add_argument("--max-det", type=int, default=20, help="Maximum YOLO detections to keep.")
    parser.add_argument("--device", help="Optional YOLO device, e.g. cpu, mps, cuda:0.")
    parser.add_argument("--no-yolo", action="store_true", help="Disable YOLO and use OpenCV candidate only.")
    return parser


def main() -> int:
    parser = _build_arg_parser()
    args = parser.parse_args()
    try:
        result = run_hybrid_preprocess(
            args.input,
            output_path=args.output,
            debug_dir=args.debug_dir,
            model_name=args.model,
            yolo_classes=parse_classes(args.classes),
            yolo_conf=args.conf,
            yolo_iou=args.iou,
            max_det=args.max_det,
            device=args.device,
            no_yolo=args.no_yolo,
        )
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:  # pragma: no cover - CLI severe error guard
        print(json.dumps(_failure(f"Severe execution error: {exc}"), ensure_ascii=False, indent=2))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
