import re
import json
import shutil
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
    page_image_urls: list[str]


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


def _render_pdf_page_images(path: Path, upload_root: Path, stored_filename: str, page_numbers: list[int]) -> list[str]:
    if fitz is None:
        return []

    cache_dir = upload_root / "pdf-pages" / Path(stored_filename).stem
    cache_dir.mkdir(parents=True, exist_ok=True)
    image_urls: list[str] = []

    try:
        with fitz.open(path) as document:
            for page_number in page_numbers:
                page = document.load_page(page_number - 1)
                rect = page.rect
                scale = max(1.0, min(2.0, 1600 / max(float(rect.width), 1.0)))
                pixmap = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                image_name = f"page-{page_number:04d}.png"
                image_path = cache_dir / image_name
                pixmap.save(image_path)
                image_urls.append(f"/uploads/pdf-pages/{Path(stored_filename).stem}/{image_name}")
    except Exception:
        shutil.rmtree(cache_dir, ignore_errors=True)
        return []

    return image_urls


def _cleanup_stored_upload(upload: StoredUpload, settings: Settings) -> None:
    (settings.upload_path / upload.stored_filename).unlink(missing_ok=True)
    shutil.rmtree(settings.upload_path / "pdf-pages" / Path(upload.stored_filename).stem, ignore_errors=True)


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
    page_image_urls = (
        _render_pdf_page_images(target, upload_root, stored_name, page_numbers)
        if content_type == "application/pdf"
        else []
    )

    return StoredUpload(
        filename=safe_name,
        stored_filename=stored_name,
        content_type=content_type,
        size_bytes=total_bytes,
        url=f"/uploads/{stored_name}",
        page_numbers=page_numbers,
        page_image_urls=page_image_urls,
    )


def _upload_response(upload: StoredUpload) -> dict:
    return {
        "filename": upload.filename,
        "stored_filename": upload.stored_filename,
        "content_type": upload.content_type,
        "size_bytes": upload.size_bytes,
        "page_count": len(upload.page_numbers),
        "page_numbers": upload.page_numbers,
        "page_image_urls": upload.page_image_urls,
        "url": upload.url,
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
                INSERT INTO notes (user_id, folder_id, title, summary)
                VALUES (%s, %s, %s, %s)
                RETURNING id, folder_id, title, summary, created_at, updated_at
                """,
                (current_user["id"], folder_id, title.strip() or upload.filename, summary),
            )
            note = cursor.fetchone()
            if note is None:
                raise HTTPException(status_code=500, detail="노트 생성에 실패했습니다.")

            cursor.execute(
                """
                INSERT INTO note_pages (note_id, page_number, content, image_url)
                SELECT %s, pages.page_number, %s, %s
                FROM unnest(%s::int[]) AS pages(page_number)
                RETURNING id, note_id, page_number, content, image_url, created_at, updated_at
                """,
                (note["id"], EMPTY_PAGE_CONTENT, upload.url, upload.page_numbers),
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
