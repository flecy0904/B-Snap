import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


class DoclingParsingError(ValueError):
    pass


@dataclass(frozen=True)
class DoclingPageText:
    page_number: int
    markdown: str
    markdown_length: int
    text_item_count: int
    table_count: int
    picture_count: int
    elapsed_ms: float


@dataclass(frozen=True)
class DoclingPagesParseResult:
    parser: str = "docling"
    pages: list[DoclingPageText] = field(default_factory=list)
    elapsed_ms: float = 0.0


def parse_pdf_pages_with_docling(path: Path, page_numbers: list[int] | None = None) -> DoclingPagesParseResult:
    if not path.exists() or path.suffix.lower() != ".pdf":
        raise DoclingParsingError("stored pdf file is unavailable")

    requested_page_numbers = None
    if page_numbers is not None:
        requested_page_numbers = sorted({int(page_number) for page_number in page_numbers if int(page_number) > 0})
        if not requested_page_numbers:
            return DoclingPagesParseResult(pages=[])

    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS", "1")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

    try:
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter
        from docling.document_converter import PdfFormatOption
    except Exception as exc:
        raise DoclingParsingError("docling dependency is not installed") from exc

    started_at = time.perf_counter()
    try:
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = False
        pipeline_options.do_table_structure = False
        converter = DocumentConverter(
            allowed_formats=[InputFormat.PDF],
            format_options={
                InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
            },
        )
        if requested_page_numbers is None:
            raise DoclingParsingError("page_numbers are required for docling page parsing")
        safe_page_numbers = requested_page_numbers
        pages: list[DoclingPageText] = []
        for page_number in safe_page_numbers:
            page_started_at = time.perf_counter()
            conversion = converter.convert(str(path), page_range=(page_number, page_number))
            document = conversion.document
            markdown = str(document.export_to_markdown() or "").strip()
            document_dict = _export_docling_document_dict(document)
            pages.append(
                DoclingPageText(
                    page_number=page_number,
                    markdown=markdown,
                    markdown_length=len(markdown),
                    text_item_count=_count_docling_items(document_dict, {"text", "paragraph", "section_header", "list_item"}, page_number=page_number),
                    table_count=_count_docling_items(document_dict, {"table"}, page_number=page_number),
                    picture_count=_count_docling_items(document_dict, {"picture", "image"}, page_number=page_number),
                    elapsed_ms=round((time.perf_counter() - page_started_at) * 1000, 1),
                )
            )
    except DoclingParsingError:
        raise
    except Exception as exc:
        raise DoclingParsingError("failed to parse pdf pages with docling") from exc

    return DoclingPagesParseResult(
        pages=pages,
        elapsed_ms=round((time.perf_counter() - started_at) * 1000, 1),
    )


def _export_docling_document_dict(document: Any) -> dict[str, Any]:
    for method_name in ("export_to_dict", "dict", "model_dump"):
        method = getattr(document, method_name, None)
        if not callable(method):
            continue
        try:
            value = method()
        except Exception:
            continue
        if isinstance(value, dict):
            return value
    return {}


def _count_docling_items(value: Any, labels: set[str], *, page_number: int | None = None) -> int:
    count = 0
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            item_label = str(item.get("label") or item.get("type") or item.get("name") or "").lower()
            if item_label in labels and _docling_item_matches_page(item, page_number):
                count += 1
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
    return count


def _docling_item_matches_page(item: dict[str, Any], page_number: int | None) -> bool:
    if page_number is None:
        return True
    prov = item.get("prov")
    if not isinstance(prov, list):
        return False
    return any(isinstance(entry, dict) and int(entry.get("page_no") or 0) == page_number for entry in prov)
