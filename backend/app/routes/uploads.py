import base64
import json
import logging
import mimetypes
import re
import shutil
import threading
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable
from urllib.parse import unquote
from uuid import uuid4

import fitz  # type: ignore[import-untyped]
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from psycopg import Connection
from psycopg.rows import dict_row

from backend.app.core.auth import get_current_user
from backend.app.core.config import Settings, get_settings
from backend.app.db.session import get_db_connection
from backend.app.services.document_matching import build_document_match_key, normalize_subject_key, sha256_file
from backend.app.services.document_chunk_index import extract_pdf_text_and_reindex_background
from backend.app.services.openai_service import generate_capture_image_analysis
from backend.app.services.pdf_parser import PdfParsingError, get_pdf_page_count


router = APIRouter(prefix="/uploads", tags=["uploads"])
EMPTY_PAGE_CONTENT = json.dumps({
    "kind": "bsnap-page-state",
    "version": 1,
    "inkStrokes": [],
    "textAnnotations": [],
    "imageAnnotations": [],
    "bookmarked": False,
    "photoReferenceCount": 0,
    "memoPageCount": 0,
}, separators=(",", ":"))

ALLOWED_CONTENT_TYPES = {
    "application/pdf": "pdf",
    "image/jpeg": "image",
    "image/jpg": "image",
    "image/png": "image",
    "image/heic": "image",
    "image/heif": "image",
}
ALLOWED_EXTENSIONS = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".heic": "image/heic",
    ".heif": "image/heif",
}
DIRECT_PREPROCESS_EXTENSIONS = {".jpg", ".jpeg", ".png"}
DIRECT_PREPROCESS_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png"}
DIRECT_PREPROCESS_CONTENT_TYPE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
}
HEIC_EXTENSIONS = {".heic", ".heif"}
HEIC_CONTENT_TYPES = {"image/heic", "image/heif"}
PREPROCESS_INPUT_DIR_NAME = "preprocess-inputs"
PREPROCESSED_IMAGE_DIR_NAME = "preprocessed-images"
PROCESSED_IMAGE_DIR_NAME = "processed-images"
logger = logging.getLogger("uvicorn.error")


@dataclass
class StoredUpload:
    filename: str
    stored_filename: str
    content_type: str
    size_bytes: int
    sha256: str
    url: str
    page_numbers: list[int]
    thumbnail_url: str | None = None
    processed_url: str | None = None
    preprocessing: dict | None = None
    analysis: dict | None = None


@dataclass
class ImagePreprocessResult:
    processed_path: Path | None
    processed_url: str | None
    thumbnail_url: str | None = None
    preprocessing: dict | None = None


@dataclass
class CaptureUploadJob:
    id: str
    user_id: int
    status: str
    stage: str
    message: str
    created_at: float
    updated_at: float
    upload: dict | None = None
    error: str | None = None


_capture_upload_jobs: dict[str, CaptureUploadJob] = {}
_capture_upload_jobs_lock = threading.Lock()
_MAX_CAPTURE_UPLOAD_JOBS = 120


def _capture_upload_job_response(job: CaptureUploadJob) -> dict:
    return {
        "job_id": job.id,
        "status": job.status,
        "stage": job.stage,
        "message": job.message,
        "upload": job.upload,
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
    }


def _prune_capture_upload_jobs_locked() -> None:
    if len(_capture_upload_jobs) <= _MAX_CAPTURE_UPLOAD_JOBS:
        return

    removable = sorted(
        _capture_upload_jobs.values(),
        key=lambda job: job.updated_at,
    )[: len(_capture_upload_jobs) - _MAX_CAPTURE_UPLOAD_JOBS]
    for job in removable:
        _capture_upload_jobs.pop(job.id, None)


def _create_capture_upload_job(user_id: int) -> CaptureUploadJob:
    now = time.time()
    job = CaptureUploadJob(
        id=uuid4().hex,
        user_id=user_id,
        status="processing",
        stage="target-detecting",
        message="강의자료/칠판 찾기를 준비하고 있습니다.",
        created_at=now,
        updated_at=now,
    )
    with _capture_upload_jobs_lock:
        _capture_upload_jobs[job.id] = job
        _prune_capture_upload_jobs_locked()
    return job


def _get_capture_upload_job(job_id: str, user_id: int) -> CaptureUploadJob:
    with _capture_upload_jobs_lock:
        job = _capture_upload_jobs.get(job_id)
    if job is None or job.user_id != user_id:
        raise HTTPException(status_code=404, detail="업로드 작업을 찾을 수 없습니다.")
    return job


def _update_capture_upload_job(
    job_id: str,
    *,
    status: str | None = None,
    stage: str | None = None,
    message: str | None = None,
    upload: dict | None = None,
    error: str | None = None,
) -> None:
    with _capture_upload_jobs_lock:
        job = _capture_upload_jobs.get(job_id)
        if job is None:
            return
        if status is not None:
            job.status = status
        if stage is not None:
            job.stage = stage
        if message is not None:
            job.message = message
        if upload is not None:
            job.upload = upload
        if error is not None:
            job.error = error
        job.updated_at = time.time()


def _safe_filename(filename: str | None) -> str:
    raw_name = Path(unquote(filename or "upload")).name
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", raw_name).strip(".-")
    return safe_name or "upload"


def _validated_content_type(file: UploadFile, safe_name: str) -> str:
    extension = Path(safe_name).suffix.lower()
    content_type = (file.content_type or "").split(";")[0].strip().lower()

    if content_type in ALLOWED_CONTENT_TYPES:
        return content_type

    if content_type in {"", "application/octet-stream"} and extension in ALLOWED_EXTENSIONS:
        return ALLOWED_EXTENSIONS[extension]

    raise HTTPException(
        status_code=415,
        detail="PDF, JPEG, PNG, HEIC 파일만 업로드할 수 있습니다.",
    )


def _format_bytes(size: int) -> str:
    if size >= 1024 * 1024:
        return f"{size / (1024 * 1024):.0f}MB"
    if size >= 1024:
        return f"{size / 1024:.0f}KB"
    return f"{size}B"


def _build_page_numbers(content_type: str, path: Path) -> list[int]:
    if content_type != "application/pdf":
        return [1]

    try:
        page_count = get_pdf_page_count(path)
    except PdfParsingError as exc:
        raise HTTPException(status_code=400, detail=str(exc) or "failed to read pdf") from exc
    return list(range(1, page_count + 1))


def _render_pdf_first_page_thumbnail(path: Path, upload_root: Path, stored_filename: str) -> str | None:
    thumbnail_dir = upload_root / "pdf-thumbnails"
    thumbnail_dir.mkdir(parents=True, exist_ok=True)
    image_name = f"{Path(stored_filename).stem}.png"
    image_path = thumbnail_dir / image_name

    try:
        with fitz.open(path) as document:
            if document.page_count < 1:
                return None
            page = document.load_page(0)
            rect = page.rect
            scale = max(0.4, min(0.8, 420 / max(float(rect.width), float(rect.height), 1.0)))
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            pixmap.save(image_path)
    except Exception:
        image_path.unlink(missing_ok=True)
        return None

    return f"/uploads/pdf-thumbnails/{image_name}"


@lru_cache(maxsize=1)
def _get_service_segmentation_cropper():
    from img_preprocessing.crop import SegmentationCropConfig, YoloSegmentationCropper

    return YoloSegmentationCropper(SegmentationCropConfig(save_mask=False))


def _run_service_preprocessing(
    input_path: Path,
    output_dir: Path,
    *,
    output_name: str,
    progress_callback: Callable[[str, str], None] | None = None,
) -> dict[str, Any]:
    from img_preprocessing.pipeline import preprocess_for_service

    return preprocess_for_service(
        input_path,
        output_dir,
        output_name=output_name,
        segmentation_cropper=_get_service_segmentation_cropper(),
        save_scan_metrics=False,
        progress_callback=progress_callback,
    )


def _upload_url_for_path(path: Path, upload_root: Path) -> str | None:
    try:
        relative_path = path.resolve().relative_to(upload_root.resolve())
    except ValueError:
        return None
    return f"/uploads/{relative_path.as_posix()}"


def _guess_image_content_type(path: Path, fallback: str = "image/jpeg") -> str:
    mime_type = mimetypes.guess_type(path.name)[0]
    if mime_type and mime_type.startswith("image/"):
        return mime_type
    return fallback


def _elapsed_ms(started_at: float, ended_at: float | None = None) -> float:
    return round(((ended_at or time.perf_counter()) - started_at) * 1000, 1)


def _format_timings(**timings: float | None) -> str:
    return " ".join(f"{name}={value:.1f}ms" for name, value in timings.items() if value is not None)


def _format_upload_preprocessing_log(event: str, fields: list[tuple[str, Any]]) -> str:
    lines = [f"[upload_preprocessing] {event}"]
    for label, value in fields:
        if value is None or value == "":
            continue
        lines.append(f"  {label}: {value}")
    return "\n".join(lines)


def _convert_heic_to_jpeg(path: Path, upload_root: Path, stored_filename: str) -> Path | None:
    output_dir = upload_root / PREPROCESS_INPUT_DIR_NAME
    output_path = output_dir / f"{Path(stored_filename).stem}.jpg"

    try:
        from PIL import Image, ImageOps

        try:
            from pillow_heif import register_heif_opener

            register_heif_opener()
        except Exception:
            pass

        output_dir.mkdir(parents=True, exist_ok=True)
        with Image.open(path) as image:
            normalized = ImageOps.exif_transpose(image)
            if normalized.mode != "RGB":
                normalized = normalized.convert("RGB")
            normalized.save(output_path, format="JPEG", quality=95)
    except Exception:
        output_path.unlink(missing_ok=True)
        return None

    return output_path


def _copy_direct_image_for_preprocessing(
    path: Path,
    upload_root: Path,
    stored_filename: str,
    content_type: str,
) -> Path | None:
    extension = DIRECT_PREPROCESS_CONTENT_TYPE_EXTENSIONS.get(content_type)
    if extension is None:
        return None

    output_dir = upload_root / PREPROCESS_INPUT_DIR_NAME
    output_path = output_dir / f"{Path(stored_filename).stem}{extension}"
    try:
        output_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(path, output_path)
    except Exception:
        output_path.unlink(missing_ok=True)
        return None
    return output_path


def _prepare_service_preprocessing_input(
    path: Path,
    upload_root: Path,
    stored_filename: str,
    content_type: str,
) -> Path | None:
    extension = path.suffix.lower()
    if extension in DIRECT_PREPROCESS_EXTENSIONS:
        return path
    if content_type in DIRECT_PREPROCESS_CONTENT_TYPES:
        return _copy_direct_image_for_preprocessing(path, upload_root, stored_filename, content_type)
    if content_type in HEIC_CONTENT_TYPES or extension in HEIC_EXTENSIONS:
        return _convert_heic_to_jpeg(path, upload_root, stored_filename)
    return None


def _select_service_preprocessed_path(result: dict[str, Any]) -> Path | None:
    if not result.get("success"):
        return None

    artifacts = result.get("artifacts") if isinstance(result.get("artifacts"), dict) else {}
    candidates = [
        result.get("llm_image_path"),
        artifacts.get("enhanced_color_path"),
        result.get("view_path"),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(str(candidate))
        if path.is_file():
            return path
    return None


def _select_service_thumbnail_path(result: dict[str, Any]) -> Path | None:
    if not result.get("success"):
        return None

    artifacts = result.get("artifacts") if isinstance(result.get("artifacts"), dict) else {}
    crop = result.get("crop") if isinstance(result.get("crop"), dict) else {}
    candidates = [
        result.get("crop_output_path"),
        artifacts.get("crop_path"),
        crop.get("output_path"),
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(str(candidate))
        if path.is_file():
            return path
    return None


def _preprocessing_failure_details(result: dict[str, Any]) -> dict[str, str]:
    details: dict[str, str] = {}
    failure_stage = result.get("failure_stage")
    if failure_stage:
        details["stage"] = str(failure_stage)

    crop = result.get("crop") if isinstance(result.get("crop"), dict) else {}
    scan_enhance = result.get("scan_enhance") if isinstance(result.get("scan_enhance"), dict) else {}
    stage_result = crop if failure_stage == "crop" else scan_enhance if failure_stage == "enhance" else {}

    message = stage_result.get("message") or result.get("message")
    if message:
        details["message"] = str(message)

    if crop:
        segmentation_error = crop.get("segmentation_error")
        if segmentation_error:
            details["segmentation_error"] = str(segmentation_error)

        detections = crop.get("segmentation_detections")
        if isinstance(detections, list):
            details["detections"] = str(len(detections))

        original_size = crop.get("original_size")
        if isinstance(original_size, dict) and original_size.get("width") and original_size.get("height"):
            details["image_size"] = f"{original_size.get('width')}x{original_size.get('height')}"

    write_error = result.get("write_error") or stage_result.get("write_error")
    if write_error:
        details["write_error"] = str(write_error)

    return details


def _preprocessing_failure_reason(result: dict[str, Any]) -> str:
    details = _preprocessing_failure_details(result)
    return "; ".join(f"{key}={value}" for key, value in details.items()) if details else "unknown"


def _preprocessing_detail_code(details: dict[str, str]) -> str:
    message = details.get("message", "")
    if details.get("stage") == "crop" and details.get("detections") == "0":
        return "segmentation_mask_not_found"
    if "No target area segmentation mask was selected" in message:
        return "segmentation_mask_not_found"
    if details.get("stage"):
        return f"{details['stage']}_failed"
    return "preprocessing_failed"


def _fallback_preprocessing_payload(
    *,
    source: str,
    fallback_url: str | None,
    failure_details: dict[str, str] | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    details = failure_details or {}
    return {
        "status": "fallback",
        "fallback_used": True,
        "source": source,
        "detail_code": _preprocessing_detail_code(details) if details else source,
        "failure_stage": details.get("stage"),
        "message": details.get("message") or reason,
        "segmentation_error": details.get("segmentation_error"),
        "detections": int(details["detections"]) if details.get("detections", "").isdigit() else None,
        "image_size": details.get("image_size"),
        "write_error": details.get("write_error"),
        "fallback_url": fallback_url,
    }


def _preprocess_upload_image(
    path: Path,
    upload_root: Path,
    stored_filename: str,
    content_type: str,
    progress_callback: Callable[[str, str], None] | None = None,
) -> ImagePreprocessResult:
    started_at = time.perf_counter()
    fallback_preprocessing: dict[str, Any] | None = None
    pipeline_input = _prepare_service_preprocessing_input(
        path,
        upload_root,
        stored_filename,
        content_type,
    )
    input_ready_at = time.perf_counter()

    if pipeline_input is not None:
        try:
            pipeline_started_at = time.perf_counter()
            result = _run_service_preprocessing(
                pipeline_input,
                upload_root / PREPROCESSED_IMAGE_DIR_NAME,
                output_name=Path(stored_filename).stem,
                progress_callback=progress_callback,
            )
            pipeline_done_at = time.perf_counter()
            processed_path = _select_service_preprocessed_path(result)
            if processed_path is not None:
                processed_url = _upload_url_for_path(processed_path, upload_root)
                if processed_url is not None:
                    thumbnail_path = _select_service_thumbnail_path(result)
                    thumbnail_url = (
                        _upload_url_for_path(thumbnail_path, upload_root)
                        if thumbnail_path is not None
                        else processed_url
                    )
                    logger.info(
                        _format_upload_preprocessing_log(
                            "service_completed",
                            [
                                ("file", stored_filename),
                                (
                                    "timings",
                                    _format_timings(
                                        input_prepare=_elapsed_ms(started_at, input_ready_at),
                                        pipeline=_elapsed_ms(pipeline_started_at, pipeline_done_at),
                                        total=_elapsed_ms(started_at),
                                    ),
                                ),
                                ("processed", processed_url),
                                ("thumbnail", thumbnail_url),
                            ],
                        )
                    )
                    return ImagePreprocessResult(
                        processed_path=processed_path,
                        processed_url=processed_url,
                        thumbnail_url=thumbnail_url,
                        preprocessing={
                            "status": "completed",
                            "fallback_used": False,
                            "processed_url": processed_url,
                            "thumbnail_url": thumbnail_url,
                        },
                    )

            failure_details = _preprocessing_failure_details(result)
            fallback_preprocessing = _fallback_preprocessing_payload(
                source="service_failed",
                fallback_url=None,
                failure_details=failure_details,
            )
            logger.info(
                _format_upload_preprocessing_log(
                    "service_failed",
                    [
                        ("file", stored_filename),
                        ("stage", failure_details.get("stage")),
                        ("message", failure_details.get("message")),
                        ("segmentation_error", failure_details.get("segmentation_error")),
                        ("detections", failure_details.get("detections")),
                        ("image_size", failure_details.get("image_size")),
                        ("write_error", failure_details.get("write_error")),
                        (
                            "timings",
                            _format_timings(
                                input_prepare=_elapsed_ms(started_at, input_ready_at),
                                pipeline=_elapsed_ms(pipeline_started_at, pipeline_done_at),
                                total=_elapsed_ms(started_at),
                            ),
                        ),
                    ],
                )
            )
        except Exception as exc:
            fallback_preprocessing = _fallback_preprocessing_payload(
                source="service_exception",
                fallback_url=None,
                reason=str(exc),
            )
            logger.warning(
                _format_upload_preprocessing_log(
                    "service_exception",
                    [
                        ("file", stored_filename),
                        ("error", exc),
                        (
                            "timings",
                            _format_timings(
                                input_prepare=_elapsed_ms(started_at, input_ready_at),
                                total=_elapsed_ms(started_at),
                            ),
                        ),
                    ],
                )
            )
    else:
        if progress_callback is not None:
            progress_callback("target-detecting", "강의자료/칠판 영역을 찾을 수 있는지 확인하고 있습니다.")
        fallback_preprocessing = _fallback_preprocessing_payload(
            source="service_skipped",
            fallback_url=None,
            reason="unsupported content type or HEIC conversion failed",
        )
        logger.info(
            _format_upload_preprocessing_log(
                "service_skipped",
                [
                    ("file", stored_filename),
                    ("content_type", content_type),
                    ("reason", "unsupported content type or HEIC conversion failed"),
                    (
                        "timings",
                        _format_timings(
                            input_prepare=_elapsed_ms(started_at, input_ready_at),
                            total=_elapsed_ms(started_at),
                        ),
                    ),
                ],
            )
        )

    fallback_detail_code = fallback_preprocessing.get("detail_code") if fallback_preprocessing else None
    if progress_callback is not None and fallback_detail_code != "segmentation_mask_not_found":
        progress_callback("preprocessing", "원본 이미지를 기준으로 보정하고 있습니다.")
    fallback_started_at = time.perf_counter()
    fallback_path, fallback_url = _preprocess_image(path, upload_root, stored_filename)
    if fallback_preprocessing is not None:
        fallback_preprocessing["fallback_url"] = fallback_url
    logger.info(
        _format_upload_preprocessing_log(
            "fallback_used",
            [
                ("file", stored_filename),
                (
                    "timings",
                    _format_timings(
                        fallback=_elapsed_ms(fallback_started_at),
                        total=_elapsed_ms(started_at),
                    ),
                ),
                ("fallback", fallback_url),
            ],
        )
    )
    return ImagePreprocessResult(
        processed_path=fallback_path,
        processed_url=fallback_url,
        thumbnail_url=fallback_url,
        preprocessing=fallback_preprocessing,
    )


def _preprocess_image(path: Path, upload_root: Path, stored_filename: str) -> tuple[Path | None, str | None]:
    processed_dir = upload_root / PROCESSED_IMAGE_DIR_NAME
    processed_dir.mkdir(parents=True, exist_ok=True)
    output_name = f"{Path(stored_filename).stem}.png"
    output_path = processed_dir / output_name

    try:
        with fitz.open(path) as document:
            if document.page_count < 1:
                return None, None
            page = document.load_page(0)
            rect = page.rect
            scale = max(1.0, min(2.5, 1600 / max(float(rect.width), float(rect.height), 1.0)))
            pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
            pixmap.save(output_path)
    except Exception:
        output_path.unlink(missing_ok=True)
        return None, None

    return output_path, f"/uploads/{PROCESSED_IMAGE_DIR_NAME}/{output_name}"


def _image_data_uri(path: Path, content_type: str, max_bytes: int) -> str | None:
    try:
        data = path.read_bytes()
    except Exception:
        return None
    if not data or len(data) > max_bytes:
        return None
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def _build_upload_analysis_image_data_uri(
    *,
    source_path: Path,
    source_content_type: str,
    processed_path: Path | None,
    max_bytes: int,
) -> str | None:
    candidates: list[tuple[Path, str]] = []
    if processed_path is not None:
        candidates.append((processed_path, _guess_image_content_type(processed_path)))
    candidates.append((source_path, source_content_type))

    for path, content_type in candidates:
        image_data_uri = _image_data_uri(path, content_type, max_bytes=max_bytes)
        if image_data_uri:
            return image_data_uri
    return None


def _fallback_image_analysis(filename: str, status: str = "ready") -> dict:
    return {
        "status": status,
        "title": "수업 자료 사진",
        "summary": "수업 중 촬영한 원본 사진입니다. PDF 페이지와 연결해 복습 자료로 활용할 수 있습니다.",
        "keywords": ["수업사진", "판서", "복습자료"],
        "confidence": 0.3,
    }


def _analyze_image_upload(
    upload: StoredUpload,
    source_path: Path,
    settings: Settings,
    progress_callback: Callable[[str, str], None] | None = None,
) -> None:
    if ALLOWED_CONTENT_TYPES.get(upload.content_type) != "image":
        return

    preprocess_result = _preprocess_upload_image(
        source_path,
        settings.upload_path,
        upload.stored_filename,
        upload.content_type,
        progress_callback=progress_callback,
    )
    upload.processed_url = preprocess_result.processed_url
    upload.thumbnail_url = preprocess_result.thumbnail_url
    upload.preprocessing = preprocess_result.preprocessing
    image_data_uri = _build_upload_analysis_image_data_uri(
        source_path=source_path,
        source_content_type=upload.content_type,
        processed_path=preprocess_result.processed_path,
        max_bytes=settings.ai_image_max_bytes,
    )

    if not image_data_uri:
        upload.analysis = _fallback_image_analysis(upload.filename, status="failed")
        return

    preprocessing_detail_code = (
        preprocess_result.preprocessing.get("detail_code")
        if isinstance(preprocess_result.preprocessing, dict)
        else None
    )
    if progress_callback is not None and preprocessing_detail_code != "segmentation_mask_not_found":
        progress_callback("ai-commenting", "AI가 사진 설명을 작성하고 있습니다.")
    try:
        upload.analysis = generate_capture_image_analysis(
            model=settings.default_ai_model,
            image_data_uri=image_data_uri,
            filename=upload.filename,
        )
    except Exception:
        upload.analysis = _fallback_image_analysis(upload.filename, status="failed")


def _cleanup_stored_upload(upload: StoredUpload, settings: Settings) -> None:
    (settings.upload_path / upload.stored_filename).unlink(missing_ok=True)
    (settings.upload_path / "pdf-thumbnails" / f"{Path(upload.stored_filename).stem}.png").unlink(missing_ok=True)
    (settings.upload_path / PROCESSED_IMAGE_DIR_NAME / f"{Path(upload.stored_filename).stem}.png").unlink(missing_ok=True)
    (settings.upload_path / PREPROCESS_INPUT_DIR_NAME / f"{Path(upload.stored_filename).stem}.jpg").unlink(missing_ok=True)
    (settings.upload_path / PREPROCESS_INPUT_DIR_NAME / f"{Path(upload.stored_filename).stem}.png").unlink(missing_ok=True)
    for output_dir in (settings.upload_path / PREPROCESSED_IMAGE_DIR_NAME).glob(f"{Path(upload.stored_filename).stem}_*"):
        if output_dir.is_dir():
            shutil.rmtree(output_dir, ignore_errors=True)


async def _store_upload(file: UploadFile, settings: Settings, *, analyze_images: bool = True) -> StoredUpload:
    upload_root = settings.upload_path
    upload_root.mkdir(parents=True, exist_ok=True)

    safe_name = _safe_filename(file.filename)
    content_type = _validated_content_type(file, safe_name)
    stored_name = f"{uuid4().hex}-{safe_name}"
    target = upload_root / stored_name
    total_bytes = 0

    try:
        with target.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                total_bytes += len(chunk)
                if total_bytes > settings.upload_max_bytes:
                    output.close()
                    target.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"파일은 최대 {_format_bytes(settings.upload_max_bytes)}까지 업로드할 수 있습니다.",
                    )
                output.write(chunk)
    finally:
        await file.close()

    try:
        page_numbers = _build_page_numbers(content_type, target)
        file_sha256 = sha256_file(target)
        thumbnail_url = _render_pdf_first_page_thumbnail(target, upload_root, stored_name) if content_type == "application/pdf" else None
    except Exception:
        target.unlink(missing_ok=True)
        (upload_root / "pdf-thumbnails" / f"{Path(stored_name).stem}.png").unlink(missing_ok=True)
        raise

    upload = StoredUpload(
        filename=safe_name,
        stored_filename=stored_name,
        content_type=content_type,
        size_bytes=total_bytes,
        sha256=file_sha256,
        url=f"/uploads/{stored_name}",
        page_numbers=page_numbers,
        thumbnail_url=thumbnail_url,
    )
    if analyze_images:
        _analyze_image_upload(upload, target, settings)
    return upload


def _upload_response(upload: StoredUpload) -> dict:
    return {
        "filename": upload.filename,
        "stored_filename": upload.stored_filename,
        "content_type": upload.content_type,
        "size_bytes": upload.size_bytes,
        "sha256": upload.sha256,
        "page_count": len(upload.page_numbers),
        "page_numbers": upload.page_numbers,
        "thumbnail_url": upload.thumbnail_url,
        "url": upload.url,
        "processed_url": upload.processed_url,
        "preprocessing": upload.preprocessing,
        "analysis": upload.analysis,
    }


def _run_capture_upload_job(job_id: str, upload: StoredUpload, source_path: Path, settings: Settings) -> None:
    try:
        if ALLOWED_CONTENT_TYPES.get(upload.content_type) != "image":
            raise ValueError("이미지 파일만 촬영 처리 작업으로 사용할 수 있습니다.")

        def progress(stage: str, message: str) -> None:
            _update_capture_upload_job(job_id, stage=stage, message=message)

        _analyze_image_upload(upload, source_path, settings, progress_callback=progress)
        _update_capture_upload_job(
            job_id,
            status="completed",
            stage="completed",
            message="촬영 이미지 처리가 완료되었습니다.",
            upload=_upload_response(upload),
        )
    except Exception as exc:
        logger.exception("Capture upload job failed: %s", job_id)
        _update_capture_upload_job(
            job_id,
            status="failed",
            stage="failed",
            message="촬영 이미지 처리 중 문제가 발생했습니다.",
            error=str(exc),
        )


@router.post("/capture-jobs")
async def create_capture_upload_job(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
    current_user: dict = Depends(get_current_user),
):
    upload = await _store_upload(file, settings, analyze_images=False)
    if ALLOWED_CONTENT_TYPES.get(upload.content_type) != "image":
        _cleanup_stored_upload(upload, settings)
        raise HTTPException(status_code=415, detail="이미지 파일만 촬영 처리 작업으로 업로드할 수 있습니다.")

    job = _create_capture_upload_job(int(current_user["id"]))
    source_path = settings.upload_path / upload.stored_filename
    background_tasks.add_task(_run_capture_upload_job, job.id, upload, source_path, settings)
    return _capture_upload_job_response(job)


@router.get("/capture-jobs/{job_id}")
async def get_capture_upload_job(
    job_id: str,
    current_user: dict = Depends(get_current_user),
):
    job = _get_capture_upload_job(job_id, int(current_user["id"]))
    return _capture_upload_job_response(job)


@router.post("")
async def upload_file(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
    current_user: dict = Depends(get_current_user),
):
    upload = await _store_upload(file, settings)
    return _upload_response(upload)


@router.post("/pdf-note")
async def upload_pdf_note(
    background_tasks: BackgroundTasks,
    folder_id: int = Form(...),
    title: str = Form(...),
    summary: str | None = Form(default=None),
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    upload = await _store_upload(file, settings)
    if upload.content_type != "application/pdf":
        _cleanup_stored_upload(upload, settings)
        raise HTTPException(status_code=415, detail="PDF 파일만 노트로 업로드할 수 있습니다.")

    try:
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "SELECT id, name FROM folders WHERE id = %s AND user_id = %s",
                (folder_id, current_user["id"]),
            )
            folder = cursor.fetchone()
            if folder is None:
                raise HTTPException(status_code=404, detail="folder not found")
            note_title = title.strip() or upload.filename
            subject_match_key = normalize_subject_key(folder["name"])
            document_match_key = build_document_match_key(upload.filename, len(upload.page_numbers))

            cursor.execute(
                """
                INSERT INTO notes (
                    user_id,
                    folder_id,
                    title,
                    summary,
                    file_url,
                    thumbnail_url,
                    page_count,
                    original_filename,
                    file_size_bytes,
                    file_sha256,
                    subject_match_key,
                    document_match_key
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id, folder_id, title, summary, file_url, thumbnail_url, page_count,
                          original_filename, file_size_bytes, file_sha256, subject_match_key, document_match_key,
                          created_at, updated_at
                """,
                (
                    current_user["id"],
                    folder_id,
                    note_title,
                    summary,
                    upload.url,
                    upload.thumbnail_url,
                    len(upload.page_numbers),
                    upload.filename,
                    upload.size_bytes,
                    upload.sha256,
                    subject_match_key,
                    document_match_key,
                ),
            )
            note = cursor.fetchone()
            if note is None:
                raise HTTPException(status_code=500, detail="노트 생성에 실패했습니다.")

            cursor.execute(
                """
                INSERT INTO note_pages (note_id, page_number, content, image_url)
                SELECT %s, pages.page_number, %s, NULL
                FROM unnest(%s::int[]) AS pages(page_number)
                RETURNING id, note_id, page_number, content, image_url, created_at, updated_at
                """,
                (
                    note["id"],
                    EMPTY_PAGE_CONTENT,
                    upload.page_numbers,
                ),
            )
            pages = sorted(cursor.fetchall(), key=lambda page: page["page_number"])
        connection.commit()
    except Exception:
        connection.rollback()
        _cleanup_stored_upload(upload, settings)
        raise

    background_tasks.add_task(
        extract_pdf_text_and_reindex_background,
        int(note["id"]),
        int(current_user["id"]),
        str(settings.upload_path / upload.stored_filename),
    )

    return {
        "upload": _upload_response(upload),
        "note": note,
        "pages": pages,
    }
