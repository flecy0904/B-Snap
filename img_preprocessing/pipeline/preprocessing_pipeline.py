"""Service-ready raw-image preprocessing pipeline.

This module is the stable orchestration layer for production callers. It runs
YOLO segmentation crop and applies scan-style color enhancement as the final
LLM image.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from img_preprocessing.crop.yolo_segmentation_cropper import (
    DEFAULT_SEGMENTATION_MODEL,
    YoloSegmentationCropper,
    run_yolo_segmentation_preprocess,
)
from img_preprocessing.enhance import preprocess_image_file


SUPPORTED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def preprocess_for_service(
    input_path: str | Path,
    output_dir: str | Path,
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
    segmentation_cropper: YoloSegmentationCropper | None = None,
    save_debug: bool = False,
    save_scan_metrics: bool = True,
    output_name: str | None = None,
) -> dict[str, Any]:
    """Run raw image segmentation crop and return a service-friendly result."""

    path = Path(input_path)
    root = Path(output_dir)
    output_id = _safe_output_id(path, output_name=output_name)
    work_dir = root / output_id
    crop_dir = work_dir / "crop"
    scan_enhance_dir = work_dir / "scan_enhance"
    debug_dir = work_dir / "debug" if save_debug else None
    pipeline_summary_path = work_dir / f"{output_id}_summary.json"

    try:
        crop_dir.mkdir(parents=True, exist_ok=True)
        scan_enhance_dir.mkdir(parents=True, exist_ok=True)
        if debug_dir is not None:
            debug_dir.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        return _pipeline_failure(
            f"Failed to create pipeline output directories: {work_dir} ({exc})",
            path,
            work_dir,
        )

    crop_output_path = crop_dir / f"{output_id}_crop.jpg"
    if segmentation_cropper is not None:
        crop_result = segmentation_cropper.preprocess(
            path,
            output_path=crop_output_path,
            debug_dir=debug_dir,
        )
    else:
        crop_result = run_yolo_segmentation_preprocess(
            path,
            output_path=crop_output_path,
            debug_dir=debug_dir,
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
        )

    scan_enhance_result = _run_scan_enhancement(
        crop_result,
        output_dir=scan_enhance_dir,
        save_metrics=save_scan_metrics,
    )

    result = _build_pipeline_result(
        input_path=path,
        work_dir=work_dir,
        crop_result=crop_result,
        scan_enhance_result=scan_enhance_result,
        debug_dir=debug_dir,
        pipeline_summary_path=pipeline_summary_path,
    )

    try:
        pipeline_summary_path.write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except Exception as exc:
        summary_error = f"Failed to save pipeline summary JSON: {pipeline_summary_path} ({exc})"
        result["success"] = False
        result["message"] = "Preprocessing completed with write errors."
        result["summary_path"] = None
        result["write_error"] = _join_errors(result.get("write_error"), summary_error)
        result["failure_stage"] = "summary"

    return result


def preprocess_directory_for_service(
    input_dir: str | Path,
    output_dir: str | Path,
    *,
    recursive: bool = False,
    **kwargs: Any,
) -> list[dict[str, Any]]:
    """Run the service pipeline for each supported image in a directory."""

    path = Path(input_dir)
    if not path.is_dir():
        return [
            _pipeline_failure(
                f"Input directory does not exist or is not a directory: {path}",
                path,
                Path(output_dir),
            )
        ]

    return [
        preprocess_for_service(image_path, output_dir, **kwargs)
        for image_path in iter_image_files(path, recursive=recursive)
    ]


def iter_image_files(input_dir: str | Path, *, recursive: bool = False) -> list[Path]:
    root = Path(input_dir)
    iterator = root.rglob("*") if recursive else root.iterdir()
    return sorted(
        path
        for path in iterator
        if path.is_file() and path.suffix.lower() in SUPPORTED_IMAGE_SUFFIXES
    )


def _build_pipeline_result(
    *,
    input_path: Path,
    work_dir: Path,
    crop_result: dict[str, Any],
    scan_enhance_result: dict[str, Any] | None,
    debug_dir: Path | None,
    pipeline_summary_path: Path,
) -> dict[str, Any]:
    crop_success = bool(crop_result.get("success"))
    enhance_success = bool(scan_enhance_result and scan_enhance_result.get("success"))
    success = crop_success and enhance_success
    failure_stage = _failure_stage(crop_success, enhance_success)
    write_error = _join_errors(
        crop_result.get("write_error"),
        scan_enhance_result.get("write_error") if scan_enhance_result else None,
    )
    view_path = (
        scan_enhance_result.get("enhanced_color_path")
        if scan_enhance_result and enhance_success
        else None
    )

    return {
        "success": success,
        "message": (
            "Preprocessing completed successfully."
            if success
            else "Preprocessing did not complete successfully."
        ),
        "failure_stage": failure_stage,
        "input_path": str(input_path),
        "output_dir": str(work_dir),
        "crop_output_path": crop_result.get("output_path"),
        "view_path": view_path,
        "llm_image_path": view_path,
        "llm_image_type": "enhanced_color" if view_path else None,
        "summary_path": str(pipeline_summary_path),
        "write_error": write_error,
        "debug_dir": str(debug_dir) if debug_dir is not None else None,
        "crop": crop_result,
        "scan_enhance": scan_enhance_result,
        "artifacts": {
            "crop_path": crop_result.get("output_path"),
            "mask_path": crop_result.get("mask_path"),
            "view_path": view_path,
            "enhanced_color_path": (
                scan_enhance_result.get("enhanced_color_path") if scan_enhance_result else None
            ),
            "ocr_bw_path": scan_enhance_result.get("ocr_bw_path") if scan_enhance_result else None,
            "scan_metrics_path": (
                scan_enhance_result.get("metrics_path") if scan_enhance_result else None
            ),
            "pipeline_summary_path": str(pipeline_summary_path),
        },
    }


def _run_scan_enhancement(
    crop_result: dict[str, Any],
    *,
    output_dir: Path,
    save_metrics: bool = True,
) -> dict[str, Any] | None:
    if not crop_result.get("success"):
        return None

    crop_path_value = crop_result.get("output_path")
    if not crop_path_value:
        return {
            "success": False,
            "message": "Crop output path is missing.",
            "enhanced_color_path": None,
            "ocr_bw_path": None,
            "metrics_path": None,
            "metrics": None,
            "write_error": "Crop output path is missing.",
        }

    crop_path = Path(str(crop_path_value))
    try:
        scan_result = preprocess_image_file(
            crop_path,
            output_dir,
            basename=crop_path.stem,
            options={"save_metrics": save_metrics},
        )
    except Exception as exc:
        return {
            "success": False,
            "message": f"Scan enhancement failed: {exc}",
            "enhanced_color_path": None,
            "ocr_bw_path": None,
            "metrics_path": None,
            "metrics": None,
            "write_error": str(exc),
        }

    write_error = scan_result.metrics.get("write_error")
    return {
        "success": write_error is None,
        "message": (
            "Scan enhancement completed successfully."
            if write_error is None
            else "Scan enhancement completed with write errors."
        ),
        "enhanced_color_path": scan_result.enhanced_color_path,
        "ocr_bw_path": scan_result.ocr_bw_path,
        "metrics_path": scan_result.metrics_path,
        "metrics": scan_result.metrics,
        "write_error": write_error,
    }


def _safe_output_id(input_path: Path, *, output_name: str | None = None) -> str:
    raw_name = output_name or input_path.stem or "input"
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", raw_name).strip("._") or "input"
    identity = str(input_path.resolve() if input_path.exists() else input_path.absolute())
    digest = hashlib.sha1(identity.encode("utf-8")).hexdigest()[:10]
    return f"{safe_name[:96]}_{digest}"


def _failure_stage(crop_success: bool, enhance_success: bool) -> str | None:
    if not crop_success:
        return "crop"
    if not enhance_success:
        return "enhance"
    return None


def _join_errors(*errors: str | None) -> str | None:
    messages = [error for error in errors if error]
    return "; ".join(messages) if messages else None


def _pipeline_failure(message: str, input_path: Path, output_dir: Path) -> dict[str, Any]:
    return {
        "success": False,
        "message": message,
        "failure_stage": "setup",
        "input_path": str(input_path),
        "output_dir": str(output_dir),
        "crop_output_path": None,
        "view_path": None,
        "llm_image_path": None,
        "llm_image_type": None,
        "summary_path": None,
        "write_error": None,
        "debug_dir": None,
        "crop": None,
        "scan_enhance": None,
        "artifacts": {},
    }
