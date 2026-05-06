"""Service-ready raw-image preprocessing pipeline.

This module is the stable orchestration layer for production callers. It keeps
the crop and enhancement modules focused on their own jobs while exposing one
entry point that turns a raw uploaded image into the final LLM-ready view image.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from img_preprocessing.crop.hybrid_preprocessor import run_hybrid_preprocess
from img_preprocessing.crop.yolo_world_detector import DEFAULT_MODEL, YoloWorldDetector
from img_preprocessing.enhance.crop_enhancer import enhance_cropped_image


SUPPORTED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def preprocess_for_service(
    input_path: str | Path,
    output_dir: str | Path,
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
    refine_yolo_with_opencv: bool = True,
    enable_quality_check: bool = True,
    jpeg_quality: int = 90,
    max_side: int = 1600,
    save_debug: bool = False,
    output_name: str | None = None,
) -> dict[str, Any]:
    """Run raw image crop + enhancement and return a service-friendly result."""

    path = Path(input_path)
    root = Path(output_dir)
    output_id = _safe_output_id(path, output_name=output_name)
    work_dir = root / output_id
    crop_dir = work_dir / "crop"
    enhance_dir = work_dir / "enhanced"
    debug_dir = work_dir / "debug" if save_debug else None
    pipeline_summary_path = work_dir / f"{output_id}_summary.json"

    try:
        crop_dir.mkdir(parents=True, exist_ok=True)
        enhance_dir.mkdir(parents=True, exist_ok=True)
        if debug_dir is not None:
            debug_dir.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        return _pipeline_failure(
            f"Failed to create pipeline output directories: {work_dir} ({exc})",
            path,
            work_dir,
        )

    crop_output_path = crop_dir / f"{output_id}_crop.jpg"
    crop_result = run_hybrid_preprocess(
        path,
        output_path=crop_output_path,
        debug_dir=debug_dir,
        model_name=model_name,
        yolo_classes=yolo_classes,
        yolo_conf=yolo_conf,
        yolo_iou=yolo_iou,
        max_det=max_det,
        yolo_imgsz=yolo_imgsz,
        device=device,
        yolo_margin_ratio=yolo_margin_ratio,
        no_yolo=no_yolo,
        yolo_detector=yolo_detector,
        refine_yolo_with_opencv=refine_yolo_with_opencv,
        enable_quality_check=enable_quality_check,
    )

    profile_hint = _profile_hint_from_crop_result(crop_result)
    enhance_result: dict[str, Any] | None = None
    if crop_result.get("success") and crop_result.get("output_path"):
        enhance_result = enhance_cropped_image(
            crop_result["output_path"],
            enhance_dir,
            jpeg_quality=jpeg_quality,
            max_side=max_side,
            profile_hint=profile_hint,
        )

    result = _build_pipeline_result(
        input_path=path,
        work_dir=work_dir,
        crop_result=crop_result,
        enhance_result=enhance_result,
        profile_hint=profile_hint,
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
    enhance_result: dict[str, Any] | None,
    profile_hint: str | None,
    debug_dir: Path | None,
    pipeline_summary_path: Path,
) -> dict[str, Any]:
    crop_success = bool(crop_result.get("success"))
    enhance_success = bool(enhance_result and enhance_result.get("success"))
    success = crop_success and enhance_success
    failure_stage = _failure_stage(crop_success, enhance_success)
    write_error = _join_errors(
        crop_result.get("write_error"),
        enhance_result.get("write_error") if enhance_result else None,
    )
    view_path = enhance_result.get("view_path") if enhance_result else None

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
        "llm_image_path": enhance_result.get("llm_image_path") if enhance_result else None,
        "llm_image_type": enhance_result.get("llm_image_type") if enhance_result else None,
        "enhancement_profile": (
            enhance_result.get("enhancement_profile") if enhance_result else None
        ),
        "profile_hint": profile_hint,
        "summary_path": str(pipeline_summary_path),
        "write_error": write_error,
        "debug_dir": str(debug_dir) if debug_dir is not None else None,
        "crop": crop_result,
        "enhance": enhance_result,
        "artifacts": {
            "crop_path": crop_result.get("output_path"),
            "view_path": view_path,
            "enhance_summary_path": enhance_result.get("summary_path") if enhance_result else None,
            "pipeline_summary_path": str(pipeline_summary_path),
        },
    }


def _profile_hint_from_crop_result(crop_result: dict[str, Any]) -> str | None:
    selected = crop_result.get("selected_candidate")
    if not isinstance(selected, dict):
        return None

    yolo_detection = selected.get("yolo_detection")
    if isinstance(yolo_detection, dict) and yolo_detection.get("class_name"):
        return str(yolo_detection["class_name"])

    mode = selected.get("mode")
    return str(mode) if mode else None


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
        "enhancement_profile": None,
        "profile_hint": None,
        "summary_path": None,
        "write_error": None,
        "debug_dir": None,
        "crop": None,
        "enhance": None,
        "artifacts": {},
    }
