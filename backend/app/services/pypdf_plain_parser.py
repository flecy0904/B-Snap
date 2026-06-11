import time
from dataclasses import dataclass, field
from pathlib import Path


class PypdfPlainParsingError(ValueError):
    pass


@dataclass(frozen=True)
class PypdfPlainPageText:
    page_number: int
    text: str
    text_length: int
    elapsed_ms: float


@dataclass(frozen=True)
class PypdfPlainParseResult:
    parser: str = "pypdf_plain"
    pages: list[PypdfPlainPageText] = field(default_factory=list)
    elapsed_ms: float = 0.0


def parse_pdf_pages_with_pypdf_plain(path: Path) -> PypdfPlainParseResult:
    if not path.exists() or path.suffix.lower() != ".pdf":
        raise PypdfPlainParsingError("stored pdf file is unavailable")

    try:
        from pypdf import PdfReader
    except Exception as exc:
        raise PypdfPlainParsingError("pypdf dependency is not installed") from exc

    started_at = time.perf_counter()
    try:
        reader = PdfReader(path)
        pages: list[PypdfPlainPageText] = []
        for index, page in enumerate(reader.pages):
            page_started_at = time.perf_counter()
            text = str(page.extract_text(extraction_mode="plain") or "").strip()
            pages.append(
                PypdfPlainPageText(
                    page_number=index + 1,
                    text=text,
                    text_length=len(text),
                    elapsed_ms=round((time.perf_counter() - page_started_at) * 1000, 1),
                )
            )
    except Exception as exc:
        raise PypdfPlainParsingError("failed to parse pdf pages with pypdf plain") from exc

    return PypdfPlainParseResult(
        pages=pages,
        elapsed_ms=round((time.perf_counter() - started_at) * 1000, 1),
    )
