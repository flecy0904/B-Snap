"""Reusable YOLO-World detector utilities for B-SNAP preprocessing.

This module owns the ML-specific code path. The hybrid preprocessor imports this
module instead of depending on the experimental probe script, which keeps the
final preprocessing entry point cleaner and lets long-running processes reuse a
loaded YOLO model.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray


DEFAULT_MODEL = "yolov8s-world.pt"
DEFAULT_CLASSES = [
    "whiteboard",
    "blackboard",
    "chalkboard",
    "green board",
    "classroom board",
    "projector screen",
    "projection screen",
    "presentation screen",
    "screen",
    "projected slide",
    "paper",
    "document",
    "sheet of paper",
    "notebook page",
]

SURFACE_CLASSES = [
    "whiteboard",
    "blackboard",
    "chalkboard",
    "green board",
    "classroom board",
    "projector screen",
    "projection screen",
    "presentation screen",
    "screen",
    "projected slide",
]

CLASS_PRIORITY = {
    "projector screen": 1.25,
    "projection screen": 1.25,
    "presentation screen": 1.2,
    "projected slide": 1.18,
    "whiteboard": 1.15,
    "blackboard": 1.15,
    "chalkboard": 1.15,
    "green board": 1.08,
    "classroom board": 1.08,
    "paper": 1.05,
    "document": 1.05,
    "sheet of paper": 1.05,
    "notebook page": 1.03,
    "screen": 1.0,
}

ImageArray = NDArray[np.uint8]
_MODEL_CACHE: dict[str, Any] = {}


@dataclass
class DetectionBox:
    class_name: str
    confidence: float
    xyxy: list[float]
    score: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "class_name": self.class_name,
            "confidence": round(float(self.confidence), 4),
            "xyxy": [round(float(value), 2) for value in self.xyxy],
            "score": round(float(self.score), 4),
        }


class YoloWorldDetector:
    """Small wrapper around Ultralytics YOLO-World with model reuse."""

    def __init__(self, model_name: str = DEFAULT_MODEL) -> None:
        self.model_name = model_name
        self.model = load_yolo_world_model(model_name)

    def detect(
        self,
        image_path: str | Path,
        image_shape: tuple[int, ...],
        *,
        classes: list[str] | None = None,
        conf: float = 0.05,
        iou: float = 0.5,
        max_det: int = 20,
        device: str | None = None,
    ) -> list[DetectionBox]:
        selected_classes = classes or DEFAULT_CLASSES
        if hasattr(self.model, "set_classes"):
            self.model.set_classes(selected_classes)

        predict_kwargs: dict[str, Any] = {
            "source": str(image_path),
            "conf": conf,
            "iou": iou,
            "max_det": max_det,
            "verbose": False,
        }
        if device:
            predict_kwargs["device"] = device

        results = self.model.predict(**predict_kwargs)
        detections = extract_detections(results, selected_classes, image_shape)
        detections.sort(key=lambda item: item.score, reverse=True)
        return detections


def get_yolo_world_detector(model_name: str = DEFAULT_MODEL) -> YoloWorldDetector:
    """Return a detector whose underlying model is cached by model name."""

    return YoloWorldDetector(model_name)


def load_yolo_world_model(model_name: str) -> Any:
    if model_name in _MODEL_CACHE:
        return _MODEL_CACHE[model_name]

    try:
        from ultralytics import YOLO, YOLOWorld
    except ImportError as exc:
        raise RuntimeError(
            "ultralytics is not installed. Install ML dependencies with: "
            "pip install -r requirements.txt"
        ) from exc

    try:
        model = YOLOWorld(model_name)
    except Exception:
        # Some ultralytics versions expose YOLO-World through YOLO(...). Keep a
        # fallback so the detector is less brittle across package versions.
        model = YOLO(model_name)

    _MODEL_CACHE[model_name] = model
    return model


def extract_detections(
    results: Any,
    configured_classes: list[str],
    image_shape: tuple[int, ...],
) -> list[DetectionBox]:
    if not results:
        return []

    result = results[0]
    names = getattr(result, "names", {}) or {}
    boxes = getattr(result, "boxes", None)
    if boxes is None or len(boxes) == 0:
        return []

    xyxy_values = boxes.xyxy.cpu().numpy()
    conf_values = boxes.conf.cpu().numpy()
    cls_values = boxes.cls.cpu().numpy().astype(int)

    detections: list[DetectionBox] = []
    for xyxy, confidence, class_id in zip(xyxy_values, conf_values, cls_values, strict=True):
        class_name = _class_name_for_id(class_id, names, configured_classes)
        xyxy_list = clip_xyxy([float(value) for value in xyxy], image_shape)
        score = score_detection(class_name, float(confidence), xyxy_list, image_shape)
        detections.append(
            DetectionBox(
                class_name=class_name,
                confidence=float(confidence),
                xyxy=xyxy_list,
                score=score,
            )
        )
    return detections


def score_detection(
    class_name: str,
    confidence: float,
    xyxy: list[float],
    image_shape: tuple[int, ...],
) -> float:
    image_height, image_width = image_shape[:2]
    x1, y1, x2, y2 = xyxy
    area = max(1.0, (x2 - x1) * (y2 - y1))
    image_area = float(image_width * image_height)
    area_ratio = area / image_area
    priority = CLASS_PRIORITY.get(class_name, 1.0)

    # Favor meaningful large surfaces but avoid making full-image accidental
    # detections dominate every prompt.
    area_score = min(area_ratio / 0.45, 1.0)
    too_large_penalty = 0.75 if area_ratio > 0.92 else 1.0
    return float(confidence) * priority * (0.7 + 0.3 * area_score) * too_large_penalty


def clip_xyxy(xyxy: list[float], image_shape: tuple[int, ...]) -> list[float]:
    image_height, image_width = image_shape[:2]
    x1, y1, x2, y2 = xyxy
    x1 = max(0.0, min(float(image_width - 1), x1))
    y1 = max(0.0, min(float(image_height - 1), y1))
    x2 = max(0.0, min(float(image_width - 1), x2))
    y2 = max(0.0, min(float(image_height - 1), y2))
    return [x1, y1, x2, y2]


def crop_xyxy(image: ImageArray, xyxy: list[float]) -> ImageArray | None:
    x1, y1, x2, y2 = [int(round(value)) for value in xyxy]
    if x2 <= x1 or y2 <= y1:
        return None
    return image[y1:y2, x1:x2].copy()


def draw_detections(image: ImageArray, detections: list[DetectionBox]) -> ImageArray:
    annotated = image.copy()
    for index, detection in enumerate(detections):
        x1, y1, x2, y2 = [int(round(value)) for value in detection.xyxy]
        color = (0, 255, 0) if index == 0 else (0, 180, 255)
        cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 4)
        label = f"{index + 1}. {detection.class_name} {detection.confidence:.2f}"
        cv2.putText(
            annotated,
            label,
            (x1, max(30, y1 - 12)),
            cv2.FONT_HERSHEY_SIMPLEX,
            1.0,
            color,
            3,
            cv2.LINE_AA,
        )
    return annotated


def parse_classes(raw_classes: list[str] | None) -> list[str] | None:
    if not raw_classes:
        return None

    parsed: list[str] = []
    for item in raw_classes:
        parsed.extend(part.strip() for part in item.split(",") if part.strip())
    return parsed or None


def clear_model_cache() -> None:
    _MODEL_CACHE.clear()


def _class_name_for_id(class_id: int, names: dict[int, str] | dict[str, str], configured_classes: list[str]) -> str:
    if class_id in names:
        return str(names[class_id])
    if str(class_id) in names:
        return str(names[str(class_id)])
    if 0 <= class_id < len(configured_classes):
        return configured_classes[class_id]
    return f"class_{class_id}"
