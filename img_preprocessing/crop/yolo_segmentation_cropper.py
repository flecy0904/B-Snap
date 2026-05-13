"""YOLO segmentation based cropper for B-SNAP preprocessing."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

import cv2
import numpy as np
from numpy.typing import NDArray


DEFAULT_SEGMENTATION_MODEL_PATH = Path(__file__).resolve().parent / "best.pt"
DEFAULT_SEGMENTATION_MODEL = str(DEFAULT_SEGMENTATION_MODEL_PATH)
DEFAULT_TARGET_CLASS = "target_area"
VALID_CROP_MODES = {"bbox", "perspective"}

ImageArray = NDArray[np.uint8]
BoolMask = NDArray[np.bool_]
_MODEL_CACHE: dict[str, Any] = {}


@dataclass
class SegmentationCropConfig:
    model_name: str = DEFAULT_SEGMENTATION_MODEL
    seg_conf: float = 0.25
    seg_iou: float = 0.7
    max_det: int = 5
    seg_imgsz: int | None = 640
    device: str | None = None
    mask_margin_ratio: float = 0.02
    min_mask_area_ratio: float = 0.0005
    crop_mode: str = "perspective"
    save_mask: bool = True
    retina_masks: bool = True


@dataclass
class SegmentationCandidate:
    class_id: int | None
    class_name: str
    confidence: float
    score: float
    crop_box: dict[str, int]
    xyxy: list[float]
    mask_area: int
    mask_area_ratio: float
    image: ImageArray
    mask: BoolMask
    crop_mode: str
    corners: list[list[float]] | None = None
    fallback: str | None = None
    quality_warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "source": "yolo_segmentation",
            "mode": self.class_name,
            "class_id": self.class_id,
            "class_name": self.class_name,
            "confidence": round(float(self.confidence), 4),
            "score": round(float(self.score), 4),
            "crop_box": self.crop_box,
            "xyxy": [round(float(value), 2) for value in self.xyxy],
            "crop_mode": self.crop_mode,
            "corners": self.corners or [],
            "fallback": self.fallback,
            "mask_area": int(self.mask_area),
            "mask_area_ratio": round(float(self.mask_area_ratio), 6),
            "quality_warnings": self.quality_warnings,
            "segmentation": {
                "class_id": self.class_id,
                "class_name": self.class_name,
                "confidence": round(float(self.confidence), 4),
            },
        }


class YoloSegmentationCropper:
    """Reusable YOLO segmentation cropper with lazy model loading."""

    def __init__(
        self,
        config: SegmentationCropConfig | None = None,
        model: Any | None = None,
    ) -> None:
        self.config = config or SegmentationCropConfig()
        self._model = model

    def preprocess(
        self,
        input_path: str | Path,
        output_path: str | Path | None = None,
        debug_dir: str | Path | None = None,
    ) -> dict[str, Any]:
        return run_yolo_segmentation_preprocess(
            input_path,
            output_path=output_path,
            debug_dir=debug_dir,
            model_name=self.config.model_name,
            seg_conf=self.config.seg_conf,
            seg_iou=self.config.seg_iou,
            max_det=self.config.max_det,
            seg_imgsz=self.config.seg_imgsz,
            device=self.config.device,
            mask_margin_ratio=self.config.mask_margin_ratio,
            min_mask_area_ratio=self.config.min_mask_area_ratio,
            crop_mode=self.config.crop_mode,
            save_mask=self.config.save_mask,
            retina_masks=self.config.retina_masks,
            model=self._model,
            model_loader=self._get_model,
        )

    def _get_model(self) -> Any:
        if self._model is None:
            self._model = load_yolo_segmentation_model(self.config.model_name)
        return self._model


def run_yolo_segmentation_preprocess(
    input_path: str | Path,
    output_path: str | Path | None = None,
    debug_dir: str | Path | None = None,
    *,
    model_name: str = DEFAULT_SEGMENTATION_MODEL,
    seg_conf: float = 0.25,
    seg_iou: float = 0.7,
    max_det: int = 5,
    seg_imgsz: int | None = 640,
    device: str | None = None,
    mask_margin_ratio: float = 0.02,
    min_mask_area_ratio: float = 0.0005,
    crop_mode: str = "perspective",
    save_mask: bool = True,
    retina_masks: bool = True,
    model: Any | None = None,
    model_loader: Callable[[], Any] | None = None,
) -> dict[str, Any]:
    """Run YOLO segmentation and save a crop around the best mask."""

    path = Path(input_path)
    if not path.exists():
        return _failure(f"Input image does not exist: {path}")
    if not path.is_file():
        return _failure(f"Input path is not a file: {path}")

    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        return _failure(f"Input image could not be decoded by OpenCV: {path}")

    try:
        crop_mode = _normalize_crop_mode(crop_mode)
    except ValueError as exc:
        return _failure(str(exc))

    debug_output = Path(debug_dir) if debug_dir else None
    if debug_output:
        debug_output.mkdir(parents=True, exist_ok=True)

    original_size = {"width": int(image.shape[1]), "height": int(image.shape[0])}
    settings = {
        "model_name": str(model_name),
        "seg_conf": seg_conf,
        "seg_iou": seg_iou,
        "max_det": max_det,
        "seg_imgsz": seg_imgsz,
        "device": device,
        "mask_margin_ratio": mask_margin_ratio,
        "min_mask_area_ratio": min_mask_area_ratio,
        "crop_mode": crop_mode,
        "save_mask": save_mask,
        "retina_masks": retina_masks,
    }

    segmentation_error: str | None = None
    candidates: list[SegmentationCandidate] = []
    selected: SegmentationCandidate | None = None

    try:
        active_model = model or (
            model_loader() if model_loader else load_yolo_segmentation_model(model_name)
        )
        prediction = _predict(
            active_model,
            path,
            conf=seg_conf,
            iou=seg_iou,
            max_det=max_det,
            imgsz=seg_imgsz,
            device=device,
            retina_masks=retina_masks,
        )
        candidates = _extract_candidates(
            prediction,
            image=image,
            margin_ratio=mask_margin_ratio,
            min_mask_area_ratio=min_mask_area_ratio,
            crop_mode=crop_mode,
        )
        selected = _select_best_candidate(candidates)
    except RuntimeError as exc:
        segmentation_error = str(exc)
    except Exception as exc:  # pragma: no cover - external model/runtime guard
        segmentation_error = f"YOLO segmentation failed: {exc}"

    debug_paths: dict[str, str] = {}
    mask_path: str | None = None
    saved_output_path: str | None = None
    write_error: str | None = None

    if selected is not None and output_path is not None:
        output = Path(output_path)
        try:
            output.parent.mkdir(parents=True, exist_ok=True)
            if cv2.imwrite(str(output), selected.image):
                saved_output_path = str(output)
            else:
                write_error = f"Failed to save output image: cv2.imwrite returned False for {output}"
        except Exception as exc:
            write_error = f"Failed to save output image: {output} ({exc})"

        if save_mask and saved_output_path is not None:
            mask_output = output.with_name(f"{output.stem}_mask.png")
            if cv2.imwrite(str(mask_output), _mask_to_uint8(selected.mask)):
                mask_path = str(mask_output)
            else:
                write_error = _join_errors(
                    write_error,
                    f"Failed to save mask image: cv2.imwrite returned False for {mask_output}",
                )

    if debug_output:
        debug_paths = _save_debug_images(debug_output, image, candidates, selected)
        summary_path = debug_output / "segmentation_summary.json"
        debug_paths["segmentation_summary.json"] = str(summary_path)

    success = (
        selected is not None
        and selected.image is not None
        and (output_path is None or saved_output_path is not None)
        and write_error is None
    )
    summary = {
        "success": success,
        "message": _summary_message(selected, segmentation_error),
        "input_path": str(path),
        "original_size": original_size,
        "selected_size": _image_size(selected.image) if selected is not None else None,
        "selected_candidate": selected.to_dict() if selected is not None else None,
        "candidates": [
            candidate.to_dict()
            for candidate in sorted(candidates, key=lambda item: item.score, reverse=True)
        ],
        "segmentation_error": segmentation_error,
        "segmentation_detections": [
            candidate.to_dict()
            for candidate in sorted(candidates, key=lambda item: item.score, reverse=True)
        ],
        "settings": settings,
        "output_path": saved_output_path,
        "mask_path": mask_path,
        "write_error": write_error,
        "debug_paths": debug_paths,
    }

    if debug_output:
        Path(debug_paths["segmentation_summary.json"]).write_text(
            json.dumps(summary, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    return summary


def load_yolo_segmentation_model(model_name: str | Path) -> Any:
    model_key = str(model_name)
    if model_key in _MODEL_CACHE:
        return _MODEL_CACHE[model_key]

    try:
        from ultralytics import YOLO
    except ImportError as exc:
        raise RuntimeError(
            "ultralytics is not installed. Install ML dependencies with: "
            "pip install -r requirements.txt"
        ) from exc

    model = YOLO(model_key)
    _MODEL_CACHE[model_key] = model
    return model


def clear_model_cache() -> None:
    _MODEL_CACHE.clear()


def _predict(
    model: Any,
    image_path: Path,
    *,
    conf: float,
    iou: float,
    max_det: int,
    imgsz: int | None,
    device: str | None,
    retina_masks: bool,
) -> Any:
    predict_kwargs: dict[str, Any] = {
        "source": str(image_path),
        "conf": conf,
        "iou": iou,
        "max_det": max_det,
        "retina_masks": retina_masks,
        "verbose": False,
    }
    if imgsz is not None:
        predict_kwargs["imgsz"] = imgsz
    if device:
        predict_kwargs["device"] = device
    return model.predict(**predict_kwargs)


def _extract_candidates(
    prediction: Any,
    *,
    image: ImageArray,
    margin_ratio: float,
    min_mask_area_ratio: float,
    crop_mode: str,
) -> list[SegmentationCandidate]:
    result = _first_result(prediction)
    if result is None:
        return []

    masks = getattr(result, "masks", None)
    mask_data = getattr(masks, "data", None)
    if mask_data is None:
        return []

    masks_array = _to_numpy(mask_data)
    if masks_array.ndim == 2:
        masks_array = masks_array[np.newaxis, ...]
    if masks_array.ndim != 3:
        return []

    boxes = getattr(result, "boxes", None)
    names = getattr(result, "names", {}) or {}
    orig_h, orig_w = _original_shape(result, image)
    image_area = max(1, orig_h * orig_w)

    candidates: list[SegmentationCandidate] = []
    for index, raw_mask in enumerate(masks_array):
        binary_mask = _resize_mask(raw_mask, width=orig_w, height=orig_h) > 0.5
        mask_area = int(np.count_nonzero(binary_mask))
        mask_area_ratio = mask_area / float(image_area)
        if mask_area == 0 or mask_area_ratio < min_mask_area_ratio:
            continue

        crop_box = _crop_box_from_mask(binary_mask, image.shape, margin_ratio)
        if crop_box is None:
            continue

        confidence = _box_confidence(boxes, index)
        class_id = _box_class_id(boxes, index)
        class_name = _class_name(class_id, names)
        xyxy = _box_xyxy(boxes, index, binary_mask)
        crop_result = _make_candidate_crop(image, binary_mask, crop_box, crop_mode)
        warnings = _candidate_warnings(crop_box, image.shape)
        score = _score_candidate(confidence, mask_area_ratio, warnings)

        candidates.append(
            SegmentationCandidate(
                class_id=class_id,
                class_name=class_name,
                confidence=confidence,
                score=score,
                crop_box=crop_box,
                xyxy=xyxy,
                mask_area=mask_area,
                mask_area_ratio=mask_area_ratio,
                image=crop_result["image"],
                mask=binary_mask,
                crop_mode=str(crop_result["crop_mode"]),
                corners=crop_result["corners"],
                fallback=crop_result["fallback"],
                quality_warnings=warnings,
            )
        )

    return candidates


def _first_result(prediction: Any) -> Any | None:
    if prediction is None:
        return None
    if isinstance(prediction, (list, tuple)):
        return prediction[0] if prediction else None
    return prediction


def _to_numpy(value: Any) -> np.ndarray:
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    if hasattr(value, "numpy"):
        return value.numpy()
    return np.asarray(value)


def _original_shape(result: Any, image: ImageArray) -> tuple[int, int]:
    shape = getattr(result, "orig_shape", None)
    if isinstance(shape, (list, tuple)) and len(shape) >= 2:
        return int(shape[0]), int(shape[1])
    return int(image.shape[0]), int(image.shape[1])


def _resize_mask(mask: np.ndarray, *, width: int, height: int) -> np.ndarray:
    if mask.shape == (height, width):
        return mask.astype(np.float32)
    return cv2.resize(mask.astype(np.float32), (width, height), interpolation=cv2.INTER_NEAREST)


def _make_candidate_crop(
    image: ImageArray,
    mask: BoolMask,
    crop_box: dict[str, int],
    crop_mode: str,
) -> dict[str, Any]:
    if crop_mode == "perspective":
        corners = _quad_from_mask(mask)
        if corners is not None:
            warped = _warp_perspective(image, corners)
            if warped is not None:
                return {
                    "image": warped,
                    "crop_mode": "perspective",
                    "corners": _corners_to_list(corners),
                    "fallback": None,
                }
        return {
            "image": _bbox_crop(image, crop_box),
            "crop_mode": "bbox",
            "corners": _corners_to_list(corners) if corners is not None else None,
            "fallback": "perspective_warp_failed" if corners is not None else "perspective_quad_not_found",
        }

    return {
        "image": _bbox_crop(image, crop_box),
        "crop_mode": "bbox",
        "corners": None,
        "fallback": None,
    }


def _bbox_crop(image: ImageArray, crop_box: dict[str, int]) -> ImageArray:
    return image[
        crop_box["y"] : crop_box["y"] + crop_box["height"],
        crop_box["x"] : crop_box["x"] + crop_box["width"],
    ].copy()


def _quad_from_mask(mask: BoolMask) -> NDArray[np.float32] | None:
    mask_uint8 = _mask_to_uint8(mask)
    contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < 16.0:
        return None

    perimeter = cv2.arcLength(contour, True)
    if perimeter <= 0.0:
        return None

    for epsilon_ratio in (0.01, 0.015, 0.02, 0.03, 0.04, 0.06, 0.08):
        approx = cv2.approxPolyDP(contour, epsilon_ratio * perimeter, True)
        if len(approx) == 4:
            return _order_points(approx.reshape(4, 2).astype(np.float32))

    hull = cv2.convexHull(contour)
    hull_perimeter = cv2.arcLength(hull, True)
    if hull_perimeter > 0.0:
        for epsilon_ratio in (0.01, 0.02, 0.03, 0.04, 0.06, 0.08):
            approx = cv2.approxPolyDP(hull, epsilon_ratio * hull_perimeter, True)
            if len(approx) == 4:
                return _order_points(approx.reshape(4, 2).astype(np.float32))

    rect = cv2.minAreaRect(contour)
    width, height = rect[1]
    if width < 2.0 or height < 2.0:
        return None
    box = cv2.boxPoints(rect).astype(np.float32)
    return _order_points(box)


def _order_points(points: NDArray[np.float32]) -> NDArray[np.float32]:
    pts = np.asarray(points, dtype=np.float32).reshape(4, 2)
    ordered = np.zeros((4, 2), dtype=np.float32)

    sums = pts.sum(axis=1)
    ordered[0] = pts[np.argmin(sums)]
    ordered[2] = pts[np.argmax(sums)]

    diffs = np.diff(pts, axis=1).reshape(4)
    ordered[1] = pts[np.argmin(diffs)]
    ordered[3] = pts[np.argmax(diffs)]
    return ordered


def _warp_perspective(image: ImageArray, corners: NDArray[np.float32]) -> ImageArray | None:
    top_left, top_right, bottom_right, bottom_left = corners
    width_top = np.linalg.norm(top_right - top_left)
    width_bottom = np.linalg.norm(bottom_right - bottom_left)
    height_right = np.linalg.norm(bottom_right - top_right)
    height_left = np.linalg.norm(bottom_left - top_left)

    output_width = int(round(max(width_top, width_bottom)))
    output_height = int(round(max(height_right, height_left)))
    if output_width < 2 or output_height < 2:
        return None

    destination = np.array(
        [
            [0.0, 0.0],
            [float(output_width - 1), 0.0],
            [float(output_width - 1), float(output_height - 1)],
            [0.0, float(output_height - 1)],
        ],
        dtype=np.float32,
    )
    transform = cv2.getPerspectiveTransform(corners.astype(np.float32), destination)
    return cv2.warpPerspective(image, transform, (output_width, output_height))


def _corners_to_list(corners: NDArray[np.float32] | None) -> list[list[float]] | None:
    if corners is None:
        return None
    return [[round(float(x), 2), round(float(y), 2)] for x, y in corners.reshape(4, 2)]


def _crop_box_from_mask(
    mask: BoolMask,
    image_shape: tuple[int, ...],
    margin_ratio: float,
) -> dict[str, int] | None:
    ys, xs = np.where(mask)
    if len(xs) == 0 or len(ys) == 0:
        return None

    image_height, image_width = image_shape[:2]
    x1 = float(xs.min())
    x2 = float(xs.max() + 1)
    y1 = float(ys.min())
    y2 = float(ys.max() + 1)
    width = max(1.0, x2 - x1)
    height = max(1.0, y2 - y1)
    margin_x = width * max(0.0, margin_ratio)
    margin_y = height * max(0.0, margin_ratio)

    left = int(round(max(0.0, x1 - margin_x)))
    top = int(round(max(0.0, y1 - margin_y)))
    right = int(round(min(float(image_width), x2 + margin_x)))
    bottom = int(round(min(float(image_height), y2 + margin_y)))
    if right <= left or bottom <= top:
        return None
    return {"x": left, "y": top, "width": right - left, "height": bottom - top}


def _box_confidence(boxes: Any, index: int) -> float:
    conf = getattr(boxes, "conf", None)
    if conf is None:
        return 1.0
    values = _to_numpy(conf).reshape(-1)
    if index >= len(values):
        return 1.0
    return float(values[index])


def _box_class_id(boxes: Any, index: int) -> int | None:
    cls = getattr(boxes, "cls", None)
    if cls is None:
        return None
    values = _to_numpy(cls).reshape(-1)
    if index >= len(values):
        return None
    return int(values[index])


def _box_xyxy(boxes: Any, index: int, mask: BoolMask) -> list[float]:
    xyxy = getattr(boxes, "xyxy", None)
    if xyxy is not None:
        values = _to_numpy(xyxy)
        if values.ndim == 2 and index < values.shape[0] and values.shape[1] >= 4:
            return [float(value) for value in values[index, :4]]

    ys, xs = np.where(mask)
    return [float(xs.min()), float(ys.min()), float(xs.max() + 1), float(ys.max() + 1)]


def _class_name(class_id: int | None, names: dict[int, str] | dict[str, str]) -> str:
    if class_id is None:
        return DEFAULT_TARGET_CLASS
    if class_id in names:
        return str(names[class_id])
    if str(class_id) in names:
        return str(names[str(class_id)])
    return f"class_{class_id}"


def _normalize_crop_mode(crop_mode: str) -> str:
    normalized = crop_mode.strip().lower()
    if normalized not in VALID_CROP_MODES:
        options = ", ".join(sorted(VALID_CROP_MODES))
        raise ValueError(f"Unsupported crop mode: {crop_mode}. Expected one of: {options}")
    return normalized


def _candidate_warnings(crop_box: dict[str, int], image_shape: tuple[int, ...]) -> list[str]:
    image_height, image_width = image_shape[:2]
    image_area = max(1.0, float(image_width * image_height))
    crop_area = float(crop_box["width"] * crop_box["height"])
    aspect_ratio = crop_box["width"] / float(max(1, crop_box["height"]))
    warnings: list[str] = []

    if crop_area / image_area < 0.01:
        warnings.append("small_crop")
    if aspect_ratio < 0.25 or aspect_ratio > 8.0:
        warnings.append("extreme_aspect_ratio")
    return warnings


def _score_candidate(confidence: float, mask_area_ratio: float, warnings: list[str]) -> float:
    area_score = min(mask_area_ratio / 0.45, 1.0)
    score = float(confidence) * (0.65 + 0.35 * area_score)
    if "small_crop" in warnings:
        score -= 0.20
    if "extreme_aspect_ratio" in warnings:
        score -= 0.10
    return _clamp(score, 0.0, 1.0)


def _select_best_candidate(candidates: list[SegmentationCandidate]) -> SegmentationCandidate | None:
    if not candidates:
        return None
    return max(candidates, key=lambda item: item.score)


def _save_debug_images(
    debug_dir: Path,
    original: ImageArray,
    candidates: list[SegmentationCandidate],
    selected: SegmentationCandidate | None,
) -> dict[str, str]:
    debug_paths: dict[str, str] = {}

    original_path = debug_dir / "00_original.jpg"
    if cv2.imwrite(str(original_path), original):
        debug_paths[original_path.name] = str(original_path)

    if selected is not None:
        mask_path = debug_dir / "01_selected_mask.png"
        if cv2.imwrite(str(mask_path), _mask_to_uint8(selected.mask)):
            debug_paths[mask_path.name] = str(mask_path)

        overlay_path = debug_dir / "02_segmentation_overlay.jpg"
        overlay = _draw_overlay(original, candidates, selected)
        if cv2.imwrite(str(overlay_path), overlay):
            debug_paths[overlay_path.name] = str(overlay_path)

        selected_path = debug_dir / "99_selected_crop.jpg"
        if cv2.imwrite(str(selected_path), selected.image):
            debug_paths[selected_path.name] = str(selected_path)

    return debug_paths


def _draw_overlay(
    image: ImageArray,
    candidates: list[SegmentationCandidate],
    selected: SegmentationCandidate,
) -> ImageArray:
    overlay = image.copy()
    color_layer = np.zeros_like(overlay)
    color_layer[selected.mask] = (0, 200, 255)
    overlay = cv2.addWeighted(overlay, 1.0, color_layer, 0.35, 0.0)

    for index, candidate in enumerate(sorted(candidates, key=lambda item: item.score, reverse=True), start=1):
        box = candidate.crop_box
        color = (0, 255, 0) if candidate is selected else (0, 180, 255)
        x1, y1 = box["x"], box["y"]
        x2, y2 = x1 + box["width"], y1 + box["height"]
        cv2.rectangle(overlay, (x1, y1), (x2, y2), color, 4)
        if candidate.corners:
            points = np.asarray(candidate.corners, dtype=np.int32).reshape(-1, 1, 2)
            cv2.polylines(overlay, [points], isClosed=True, color=(255, 0, 255), thickness=4)
        label = f"{index}. {candidate.class_name} {candidate.confidence:.2f}"
        cv2.putText(
            overlay,
            label,
            (x1, max(30, y1 - 12)),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            color,
            3,
            cv2.LINE_AA,
        )
    return overlay


def _mask_to_uint8(mask: BoolMask) -> ImageArray:
    return (mask.astype(np.uint8) * 255)


def _summary_message(selected: SegmentationCandidate | None, error: str | None) -> str:
    if selected is None:
        if error:
            return f"No target area selected. {error}"
        return "No target area segmentation mask was selected."
    return f"Selected YOLO segmentation mask for {selected.class_name}."


def _failure(message: str) -> dict[str, Any]:
    return {
        "success": False,
        "message": message,
        "original_size": None,
        "selected_size": None,
        "selected_candidate": None,
        "candidates": [],
        "segmentation_error": None,
        "segmentation_detections": [],
        "settings": {},
        "output_path": None,
        "mask_path": None,
        "write_error": None,
        "debug_paths": {},
    }


def _image_size(image: ImageArray) -> dict[str, int]:
    return {"width": int(image.shape[1]), "height": int(image.shape[0])}


def _join_errors(*errors: str | None) -> str | None:
    messages = [error for error in errors if error]
    return "; ".join(messages) if messages else None


def _clamp(value: float, min_value: float, max_value: float) -> float:
    return max(min_value, min(max_value, value))


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run YOLO segmentation crop preprocessing.")
    parser.add_argument("--input", required=True, help="Input image path.")
    parser.add_argument("--output", help="Optional output path for the cropped image.")
    parser.add_argument("--debug-dir", help="Optional directory for debug artifacts.")
    parser.add_argument("--model", default=DEFAULT_SEGMENTATION_MODEL, help="YOLO segmentation .pt path.")
    parser.add_argument("--conf", type=float, default=0.25, help="Segmentation confidence threshold.")
    parser.add_argument("--iou", type=float, default=0.7, help="NMS IoU threshold.")
    parser.add_argument("--max-det", type=int, default=5, help="Maximum detections to keep.")
    parser.add_argument("--imgsz", type=int, default=640, help="Inference image size.")
    parser.add_argument("--device", help="Optional YOLO device, e.g. cpu, mps, cuda:0.")
    parser.add_argument("--mask-margin", type=float, default=0.02, help="Crop margin ratio around selected mask.")
    parser.add_argument("--min-mask-area", type=float, default=0.0005, help="Minimum mask area ratio.")
    parser.add_argument(
        "--crop-mode",
        choices=sorted(VALID_CROP_MODES),
        default="perspective",
        help="Crop strategy. perspective uses mask contour warping and falls back to bbox.",
    )
    parser.add_argument("--no-save-mask", action="store_true", help="Do not save the selected binary mask.")
    parser.add_argument("--no-retina-masks", action="store_true", help="Disable Ultralytics retina masks.")
    return parser


def main() -> int:
    args = _build_arg_parser().parse_args()
    result = run_yolo_segmentation_preprocess(
        args.input,
        output_path=args.output,
        debug_dir=args.debug_dir,
        model_name=args.model,
        seg_conf=args.conf,
        seg_iou=args.iou,
        max_det=args.max_det,
        seg_imgsz=args.imgsz,
        device=args.device,
        mask_margin_ratio=args.mask_margin,
        min_mask_area_ratio=args.min_mask_area,
        crop_mode=args.crop_mode,
        save_mask=not args.no_save_mask,
        retina_masks=not args.no_retina_masks,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get("success") else 1


if __name__ == "__main__":
    raise SystemExit(main())
