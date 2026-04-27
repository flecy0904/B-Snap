"""YOLO-World probe CLI for B-SNAP preprocessing experiments.

The reusable detection code lives in ``yolo_world_detector.py``. This file only
loads an image, runs the detector, and writes inspection artifacts.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import cv2

from .yolo_world_detector import (
    DEFAULT_CLASSES,
    DEFAULT_MODEL,
    DetectionBox,
    YoloWorldDetector,
    clip_xyxy,
    crop_xyxy,
    draw_detections,
    extract_detections,
    load_yolo_world_model,
    parse_classes,
    score_detection,
)

# Backward-compatible aliases for earlier experimental imports. New code should
# import these utilities from yolo_world_detector.py directly.
_clip_xyxy = clip_xyxy
_crop_box = crop_xyxy
_draw_detections = draw_detections
_extract_detections = extract_detections
_load_yolo_world_model = load_yolo_world_model
_parse_classes = parse_classes
_score_detection = score_detection


def run_yolo_world_probe(
    input_path: str | Path,
    output_dir: str | Path,
    *,
    model_name: str = DEFAULT_MODEL,
    classes: list[str] | None = None,
    conf: float = 0.05,
    iou: float = 0.5,
    max_det: int = 20,
    device: str | None = None,
    save_best_crop: bool = True,
) -> dict[str, Any]:
    """Run YOLO-World detection and save visual inspection artifacts."""

    image_path = Path(input_path)
    output = Path(output_dir)
    output.mkdir(parents=True, exist_ok=True)

    if not image_path.exists():
        return _failure(f"Input image does not exist: {image_path}")
    if not image_path.is_file():
        return _failure(f"Input path is not a file: {image_path}")

    image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
    if image is None:
        return _failure(f"Input image could not be decoded by OpenCV: {image_path}")

    selected_classes = classes or DEFAULT_CLASSES

    try:
        detector = YoloWorldDetector(model_name)
        detections = detector.detect(
            image_path,
            image.shape,
            classes=selected_classes,
            conf=conf,
            iou=iou,
            max_det=max_det,
            device=device,
        )
    except RuntimeError as exc:
        return _failure(str(exc))
    except Exception as exc:  # pragma: no cover - depends on external model/runtime
        return _failure(f"YOLO-World prediction failed: {exc}")

    best = detections[0] if detections else None

    annotated = draw_detections(image, detections)
    annotated_path = output / f"{image_path.stem}_yolo_world_annotated.jpg"
    cv2.imwrite(str(annotated_path), annotated)

    best_crop_path: Path | None = None
    if save_best_crop and best is not None:
        best_crop = crop_xyxy(image, best.xyxy)
        if best_crop is not None:
            best_crop_path = output / f"{image_path.stem}_yolo_world_best_crop.jpg"
            cv2.imwrite(str(best_crop_path), best_crop)

    summary = {
        "success": bool(detections),
        "message": "YOLO-World detections found." if detections else "No YOLO-World detections found.",
        "input_path": str(image_path),
        "original_size": {"width": int(image.shape[1]), "height": int(image.shape[0])},
        "model": model_name,
        "classes": selected_classes,
        "conf": conf,
        "iou": iou,
        "max_det": max_det,
        "best_detection": best.to_dict() if best else None,
        "detections": [detection.to_dict() for detection in detections],
        "output_paths": {
            "annotated": str(annotated_path),
            "best_crop": str(best_crop_path) if best_crop_path else None,
        },
    }

    summary_path = output / f"{image_path.stem}_yolo_world_summary.json"
    summary["output_paths"]["summary"] = str(summary_path)
    summary_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    return summary


def _failure(message: str) -> dict[str, Any]:
    return {
        "success": False,
        "message": message,
        "best_detection": None,
        "detections": [],
        "output_paths": {},
    }


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Probe YOLO-World detections for B-SNAP images.")
    parser.add_argument("--input", required=True, help="Input image path.")
    parser.add_argument("--output-dir", default="outputs/yolo_world_probe", help="Directory for probe outputs.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="YOLO-World weight name or local path.")
    parser.add_argument(
        "--classes",
        nargs="*",
        help="Open-vocabulary class prompts. Accepts space-separated values or comma-separated groups.",
    )
    parser.add_argument("--conf", type=float, default=0.05, help="Detection confidence threshold.")
    parser.add_argument("--iou", type=float, default=0.5, help="NMS IoU threshold.")
    parser.add_argument("--max-det", type=int, default=20, help="Maximum detections to keep.")
    parser.add_argument("--device", help="Optional device, e.g. cpu, mps, cuda:0.")
    parser.add_argument("--no-best-crop", action="store_true", help="Do not save the highest-scoring crop.")
    return parser


def main() -> int:
    parser = _build_arg_parser()
    args = parser.parse_args()

    try:
        summary = run_yolo_world_probe(
            args.input,
            args.output_dir,
            model_name=args.model,
            classes=parse_classes(args.classes),
            conf=args.conf,
            iou=args.iou,
            max_det=args.max_det,
            device=args.device,
            save_best_crop=not args.no_best_crop,
        )
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return 0
    except Exception as exc:  # pragma: no cover - CLI severe error guard
        print(json.dumps(_failure(f"Severe execution error: {exc}"), ensure_ascii=False, indent=2))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
