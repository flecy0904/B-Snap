import re
import base64
import json
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from psycopg import Connection
from psycopg.rows import dict_row
from pypdf import PdfReader

from backend.app.core.auth import get_current_user
from backend.app.core.config import Settings, get_settings
from backend.app.db.session import get_db_connection
from backend.app.services.openai_service import generate_capture_image_analysis

try:
    import fitz  # type: ignore[import-untyped]
except Exception:  # pragma: no cover - optional acceleration dependency
    fitz = None


router = APIRouter(prefix="/uploads", tags=["uploads"])
EMPTY_PAGE_CONTENT = json.dumps({
    "kind": "bsnap-page-state",
    "version": 1,
    "inkStrokes": [],
    "textAnnotations": [],
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


@dataclass
class StoredUpload:
    filename: str
    stored_filename: str
    content_type: str
    size_bytes: int
    url: str
    page_numbers: list[int]
    thumbnail_url: str | None = None
    processed_url: str | None = None
    analysis: dict | None = None


def _safe_filename(filename: str | None) -> str:
    raw_name = Path(filename or "upload").name
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


def _extract_pdf_page_count(path: Path) -> int | None:
    try:
        reader = PdfReader(str(path))
        return max(1, len(reader.pages))
    except Exception:
        return None


def _build_page_numbers(content_type: str, path: Path) -> list[int]:
    if content_type != "application/pdf":
        return [1]

    page_count = _extract_pdf_page_count(path) or 1
    return list(range(1, page_count + 1))


def _render_pdf_first_page_thumbnail(path: Path, upload_root: Path, stored_filename: str) -> str | None:
    if fitz is None:
        return None

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


def _preprocess_image(path: Path, upload_root: Path, stored_filename: str) -> tuple[Path | None, str | None]:
    if fitz is None:
        return None, None

    processed_dir = upload_root / "processed-images"
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

    return output_path, f"/uploads/processed-images/{output_name}"


def _image_data_uri(path: Path, content_type: str) -> str | None:
    try:
        data = path.read_bytes()
    except Exception:
        return None
    if not data or len(data) > 8 * 1024 * 1024:
        return None
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{content_type};base64,{encoded}"


def _fallback_image_analysis(filename: str, status: str = "ready") -> dict:
    return {
        "status": status,
        "summary": f"{filename} 원본 사진입니다. 수업 중 촬영한 자료로, PDF 페이지와 연결해 복습할 수 있습니다.",
        "keywords": ["수업사진", "판서", "복습자료"],
        "confidence": 0.3,
    }


def _analyze_image_upload(upload: StoredUpload, source_path: Path, settings: Settings) -> None:
    if ALLOWED_CONTENT_TYPES.get(upload.content_type) != "image":
        return

    processed_path, processed_url = _preprocess_image(source_path, settings.upload_path, upload.stored_filename)
    upload.processed_url = processed_url
    analysis_path = processed_path or source_path
    analysis_content_type = "image/png" if processed_path else upload.content_type
    image_data_uri = _image_data_uri(analysis_path, analysis_content_type)

    if not image_data_uri:
        upload.analysis = _fallback_image_analysis(upload.filename, status="failed")
        return

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
    (settings.upload_path / "processed-images" / f"{Path(upload.stored_filename).stem}.png").unlink(missing_ok=True)


async def _store_upload(file: UploadFile, settings: Settings) -> StoredUpload:
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

    page_numbers = _build_page_numbers(content_type, target)
    thumbnail_url = _render_pdf_first_page_thumbnail(target, upload_root, stored_name) if content_type == "application/pdf" else None

    upload = StoredUpload(
        filename=safe_name,
        stored_filename=stored_name,
        content_type=content_type,
        size_bytes=total_bytes,
        url=f"/uploads/{stored_name}",
        page_numbers=page_numbers,
        thumbnail_url=thumbnail_url,
    )
    _analyze_image_upload(upload, target, settings)
    return upload


def _upload_response(upload: StoredUpload) -> dict:
    return {
        "filename": upload.filename,
        "stored_filename": upload.stored_filename,
        "content_type": upload.content_type,
        "size_bytes": upload.size_bytes,
        "page_count": len(upload.page_numbers),
        "page_numbers": upload.page_numbers,
        "thumbnail_url": upload.thumbnail_url,
        "url": upload.url,
        "processed_url": upload.processed_url,
        "analysis": upload.analysis,
    }


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
                "SELECT id FROM folders WHERE id = %s AND user_id = %s",
                (folder_id, current_user["id"]),
            )
            if cursor.fetchone() is None:
                raise HTTPException(status_code=404, detail="folder not found")

            cursor.execute(
                """
                INSERT INTO notes (user_id, folder_id, title, summary, file_url, thumbnail_url, page_count)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, folder_id, title, summary, file_url, thumbnail_url, page_count, created_at, updated_at
                """,
                (
                    current_user["id"],
                    folder_id,
                    title.strip() or upload.filename,
                    summary,
                    upload.url,
                    upload.thumbnail_url,
                    len(upload.page_numbers),
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

    return {
        "upload": _upload_response(upload),
        "note": note,
        "pages": pages,
    }
