"""Enhance already-cropped images into a single LLM-ready view output."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import cv2

from .image_ops import ImageArray, clamp_int, file_size, image_size, resize_max_side
from .metrics import enhancement_metrics, quality_metrics, score_view_image
from .profile_detector import detect_enhancement_profile
from .profiles import enhance_dark_board_view, enhance_scan_document_view


def enhance_cropped_image(
    input_path: str | Path,
    output_dir: str | Path,
    *,
    jpeg_quality: int = 90,
    max_side: int = 1600,
    profile_hint: str | None = None,
) -> dict[str, Any]:
    """Create a view-enhanced variant from an already-cropped image."""

    path = Path(input_path)
    if not path.exists():
        return _failure(f"Input image does not exist: {path}", path)
    if not path.is_file():
        return _failure(f"Input path is not a file: {path}", path)
    if max_side <= 0:
        return _failure(f"max_side must be positive: {max_side}", path)

    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        return _failure(f"Input image could not be decoded by OpenCV: {path}", path)

    output_root = Path(output_dir)
    try:
        output_root.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        return _failure(f"Failed to create output directory: {output_root} ({exc})", path)

    base_image = resize_max_side(image, max_side)
    enhancement_profile, profile_metrics = detect_enhancement_profile(
        base_image,
        profile_hint=profile_hint,
    )
    view_image = _enhance_for_view(base_image, profile=enhancement_profile)
    view_score = score_view_image(view_image)
    view_metrics = enhancement_metrics(base_image, view_image, enhancement_profile)

    stem = path.stem
    quality = clamp_int(jpeg_quality, 1, 100)
    view_path, view_error = _write_image(
        output_root / f"{stem}_view.jpg",
        view_image,
        [cv2.IMWRITE_JPEG_QUALITY, quality],
    )

    write_errors = [error for error in (view_error,) if error is not None]
    summary_path = output_root / f"{stem}_summary.json"

    metrics = {
        "original_size": image_size(image),
        "view_size": image_size(view_image),
        "input_bytes": int(path.stat().st_size),
        "view_bytes": file_size(view_path),
        "ocr_bytes": None,
        **quality_metrics(base_image),
        "profile_metrics": profile_metrics,
        "enhancement_metrics": view_metrics,
        "scan_metrics": view_metrics,
    }
    llm_image_type = "view" if view_path else None
    result = {
        "success": not write_errors,
        "message": (
            "Crop image enhanced successfully."
            if not write_errors
            else "Crop image enhancement completed with write errors."
        ),
        "input_path": str(path),
        "view_path": view_path,
        "ocr_path": None,
        "comparison_path": None,
        "llm_image_path": view_path,
        "llm_image_type": llm_image_type,
        "llm_image_reason": (
            "view selected by policy because OCR output is disabled and visual context is preserved."
            if view_path
            else "no LLM image selected because the view output was not saved."
        ),
        "llm_image_scores": {"view": view_score["score"]},
        "llm_image_score_details": {"view": view_score},
        "llm_selection_visual_path": None,
        "enhancement_profile": enhancement_profile,
        "profile_hint": profile_hint,
        "summary_path": str(summary_path),
        "write_error": "; ".join(write_errors) if write_errors else None,
        "metrics": metrics,
    }

    try:
        summary_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as exc:
        summary_error = f"Failed to save summary JSON: {summary_path} ({exc})"
        result["success"] = False
        result["message"] = "Crop image enhancement completed with write errors."
        result["summary_path"] = None
        result["write_error"] = (
            f"{result['write_error']}; {summary_error}"
            if result["write_error"]
            else summary_error
        )

    return result


def _enhance_for_view(image_bgr: ImageArray, *, profile: str) -> ImageArray:
    if profile == "dark_board":
        return enhance_dark_board_view(image_bgr)
    return enhance_scan_document_view(image_bgr)


def _write_image(
    output_path: Path,
    image: ImageArray,
    params: list[int] | None = None,
) -> tuple[str | None, str | None]:
    try:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        saved = cv2.imwrite(str(output_path), image, params or [])
        if saved:
            return str(output_path), None
        return None, f"Failed to save image: cv2.imwrite returned False for {output_path}"
    except Exception as exc:
        return None, f"Failed to save image: {output_path} ({exc})"


def _failure(message: str, input_path: Path) -> dict[str, Any]:
    return {
        "success": False,
        "message": message,
        "input_path": str(input_path),
        "view_path": None,
        "ocr_path": None,
        "comparison_path": None,
        "llm_image_path": None,
        "llm_image_type": None,
        "llm_image_reason": None,
        "llm_image_scores": {},
        "llm_image_score_details": {},
        "llm_selection_visual_path": None,
        "enhancement_profile": None,
        "profile_hint": None,
        "summary_path": None,
        "write_error": None,
        "metrics": {},
    }
