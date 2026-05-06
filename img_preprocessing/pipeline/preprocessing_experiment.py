"""CLI wrapper for the service-ready raw-image preprocessing pipeline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from img_preprocessing.crop.yolo_world_detector import DEFAULT_MODEL, parse_classes

from .preprocessing_pipeline import preprocess_directory_for_service, preprocess_for_service


def run_experiment(
    input_path: str | Path,
    output_dir: str | Path,
    *,
    recursive: bool = False,
    model_name: str = DEFAULT_MODEL,
    yolo_classes: list[str] | None = None,
    yolo_conf: float = 0.05,
    yolo_iou: float = 0.5,
    max_det: int = 20,
    yolo_imgsz: int | None = None,
    device: str | None = None,
    no_yolo: bool = False,
    save_debug: bool = False,
    jpeg_quality: int = 90,
    max_side: int = 1600,
) -> dict[str, Any] | list[dict[str, Any]]:
    path = Path(input_path)
    if path.is_dir():
        return preprocess_directory_for_service(
            path,
            output_dir,
            recursive=recursive,
            model_name=model_name,
            yolo_classes=yolo_classes,
            yolo_conf=yolo_conf,
            yolo_iou=yolo_iou,
            max_det=max_det,
            yolo_imgsz=yolo_imgsz,
            device=device,
            no_yolo=no_yolo,
            save_debug=save_debug,
            jpeg_quality=jpeg_quality,
            max_side=max_side,
        )

    return preprocess_for_service(
        path,
        output_dir,
        model_name=model_name,
        yolo_classes=yolo_classes,
        yolo_conf=yolo_conf,
        yolo_iou=yolo_iou,
        max_det=max_det,
        yolo_imgsz=yolo_imgsz,
        device=device,
        no_yolo=no_yolo,
        save_debug=save_debug,
        jpeg_quality=jpeg_quality,
        max_side=max_side,
    )


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run raw-image crop + enhancement preprocessing.")
    parser.add_argument("--input", required=True, help="Input raw image file or directory.")
    parser.add_argument("--output-dir", required=True, help="Directory where service outputs are saved.")
    parser.add_argument("--recursive", action="store_true", help="Process image files recursively for directory input.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="YOLO-World weight name or local path.")
    parser.add_argument("--classes", nargs="*", help="YOLO class prompts.")
    parser.add_argument("--conf", type=float, default=0.05, help="YOLO confidence threshold.")
    parser.add_argument("--iou", type=float, default=0.5, help="YOLO NMS IoU threshold.")
    parser.add_argument("--max-det", type=int, default=20, help="Maximum YOLO detections to keep.")
    parser.add_argument("--imgsz", type=int, help="Optional YOLO inference image size.")
    parser.add_argument("--device", help="Optional YOLO device, e.g. cpu, mps, cuda:0.")
    parser.add_argument("--no-yolo", action="store_true", help="Disable YOLO and use OpenCV candidates only.")
    parser.add_argument("--debug", action="store_true", help="Save crop debug artifacts.")
    parser.add_argument("--jpeg-quality", type=int, default=90, help="JPEG quality for final view output.")
    parser.add_argument("--max-side", type=int, default=1600, help="Resize longest side before enhancement.")
    return parser


def main() -> int:
    args = _build_arg_parser().parse_args()
    result = run_experiment(
        args.input,
        args.output_dir,
        recursive=args.recursive,
        model_name=args.model,
        yolo_classes=parse_classes(args.classes),
        yolo_conf=args.conf,
        yolo_iou=args.iou,
        max_det=args.max_det,
        yolo_imgsz=args.imgsz,
        device=args.device,
        no_yolo=args.no_yolo,
        save_debug=args.debug,
        jpeg_quality=args.jpeg_quality,
        max_side=args.max_side,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if isinstance(result, list):
        return 0 if all(item.get("success") for item in result) else 1
    return 0 if result.get("success") else 1


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(main())
