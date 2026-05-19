import base64
from io import BytesIO
from pathlib import Path

from fastapi import HTTPException
from pypdf import PdfReader


def decode_pdf_data_uri(pdf_data: str) -> bytes:
    if not pdf_data:
        raise HTTPException(status_code=400, detail="pdf_data is required")

    base64_text = pdf_data.split(",", 1)[1] if "," in pdf_data else pdf_data
    try:
        return base64.b64decode(base64_text, validate=True)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="invalid pdf_data") from exc


def extract_pdf_text_pages_from_reader(reader: PdfReader) -> list[str]:
    page_texts: list[str] = []
    for page in reader.pages:
        try:
            page_texts.append(page.extract_text() or "")
        except Exception:
            page_texts.append("")
    return page_texts


def extract_pdf_text_pages(pdf_data: str) -> list[str]:
    pdf_bytes = decode_pdf_data_uri(pdf_data)
    try:
        reader = PdfReader(BytesIO(pdf_bytes))
    except Exception as exc:
        raise HTTPException(status_code=400, detail="failed to read pdf") from exc

    return extract_pdf_text_pages_from_reader(reader)


def extract_pdf_text_pages_from_path(path: Path) -> list[str]:
    try:
        reader = PdfReader(path)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="failed to read pdf") from exc

    return extract_pdf_text_pages_from_reader(reader)
