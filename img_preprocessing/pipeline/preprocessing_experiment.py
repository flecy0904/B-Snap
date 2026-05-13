"""CLI wrapper for the service-ready YOLO segmentation + scan enhancement pipeline."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from img_preprocessing.crop.yolo_segmentation_cropper import DEFAULT_SEGMENTATION_MODEL, VALID_CROP_MODES

from .preprocessing_pipeline import preprocess_directory_for_service, preprocess_for_service


def run_experiment(
    input_path: str | Path,
    output_dir: str | Path,
    *,
    recursive: bool = False,
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
    save_debug: bool = False,
) -> dict[str, Any] | list[dict[str, Any]]:
    path = Path(input_path)
    if path.is_dir():
        return preprocess_directory_for_service(
            path,
            output_dir,
            recursive=recursive,
            model_name=model_name,
            seg_conf=seg_conf,
            seg_iou=seg_iou,
            max_det=max_det,
            seg_imgsz=seg_imgsz,
            device=device,
            mask_margin_ratio=mask_margin_ratio,
            min_mask_area_ratio=min_mask_area_ratio,
            crop_mode=crop_mode,
            save_mask=save_mask,
            retina_masks=retina_masks,
            save_debug=save_debug,
        )

    return preprocess_for_service(
        path,
        output_dir,
        model_name=model_name,
        seg_conf=seg_conf,
        seg_iou=seg_iou,
        max_det=max_det,
        seg_imgsz=seg_imgsz,
        device=device,
        mask_margin_ratio=mask_margin_ratio,
        min_mask_area_ratio=min_mask_area_ratio,
        crop_mode=crop_mode,
        save_mask=save_mask,
        retina_masks=retina_masks,
        save_debug=save_debug,
    )


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run YOLO segmentation crop and scan enhancement preprocessing.")
    parser.add_argument("--input", required=True, help="Input raw image file or directory.")
    parser.add_argument("--output-dir", required=True, help="Directory where service outputs are saved.")
    parser.add_argument("--recursive", action="store_true", help="Process image files recursively for directory input.")
    parser.add_argument("--model", default=DEFAULT_SEGMENTATION_MODEL, help="YOLO segmentation .pt path.")
    parser.add_argument("--conf", type=float, default=0.25, help="Segmentation confidence threshold.")
    parser.add_argument("--iou", type=float, default=0.7, help="YOLO NMS IoU threshold.")
    parser.add_argument("--max-det", type=int, default=5, help="Maximum segmentation detections to keep.")
    parser.add_argument("--imgsz", type=int, default=640, help="Optional YOLO inference image size.")
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
    parser.add_argument("--debug", action="store_true", help="Save crop debug artifacts.")
    return parser


def main() -> int:
    args = _build_arg_parser().parse_args()
    result = run_experiment(
        args.input,
        args.output_dir,
        recursive=args.recursive,
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
        save_debug=args.debug,
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if isinstance(result, list):
        return 0 if all(item.get("success") for item in result) else 1
    return 0 if result.get("success") else 1


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    raise SystemExit(main())
