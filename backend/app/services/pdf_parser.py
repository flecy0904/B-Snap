import base64
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import fitz  # type: ignore[import-untyped]


logger = logging.getLogger(__name__)


class PdfParsingError(ValueError):
    pass


PdfElementType = Literal["text", "image"]
BBox = tuple[float, float, float, float]
TextBlockRole = Literal["main_text", "header_footer_candidate", "side_label_candidate"]
VisualBlockRole = Literal["title", "content", "figure", "image", "other"]

EXTRACTION_STRATEGY = "pymupdf_visual_blocks_v3"
ORDER_STRATEGY_VISUAL_BLOCKS = "visual_block_groups"
ORDER_STRATEGY_NATIVE = "pymupdf_native_text"

FOOTER_PATTERNS = (
    re.compile(r"^\s*transport\s+layer\s*3\s*[-\u2013]\s*\d+\s*$", re.IGNORECASE),
    re.compile(r"^\s*[a-z][a-z\s]{2,48}\d+\s*[-\u2013]\s*\d+\s*$", re.IGNORECASE),
    re.compile(r"^\s*\d+\s*[-\u2013]\s*\d+\s*$"),
)


@dataclass(frozen=True)
class PageElement:
    type: PdfElementType
    bbox: BBox
    block_index: int
    reading_order: int
    role: TextBlockRole | None = None
    text: str | None = None
    text_preview: str | None = None
    image_ext: str | None = None
    width: int | None = None
    height: int | None = None

    def to_metadata(self) -> dict[str, Any]:
        metadata: dict[str, Any] = {
            "type": self.type,
            "bbox": [round(value, 2) for value in self.bbox],
            "blockIndex": self.block_index,
            "readingOrder": self.reading_order,
        }
        if self.role:
            metadata["role"] = self.role
        if self.text_preview:
            metadata["textPreview"] = self.text_preview
        if self.image_ext:
            metadata["imageExt"] = self.image_ext
        if self.width is not None:
            metadata["width"] = self.width
        if self.height is not None:
            metadata["height"] = self.height
        return metadata

    def to_text_block_metadata(self) -> dict[str, Any]:
        metadata = self.to_metadata()
        metadata["text"] = self.text or ""
        return metadata


@dataclass(frozen=True)
class VisualBlock:
    role: VisualBlockRole
    bbox: BBox
    reading_order: int
    text: str
    element_indexes: list[int] = field(default_factory=list)

    def to_metadata(self) -> dict[str, Any]:
        return {
            "role": self.role,
            "bbox": [round(value, 2) for value in self.bbox],
            "readingOrder": self.reading_order,
            "text": self.text,
            "textPreview": _preview(self.text),
            "elementIndexes": self.element_indexes,
            "blockIndex": self.reading_order,
        }


@dataclass(frozen=True)
class PageParseResult:
    page_number: int
    text: str
    elements: list[PageElement] = field(default_factory=list)
    visual_blocks: list[VisualBlock] = field(default_factory=list)
    extraction_strategy: str = EXTRACTION_STRATEGY
    reading_order_strategy: str = ORDER_STRATEGY_VISUAL_BLOCKS
    column_count: int = 1
    column_confidence: float = 0.0

    @property
    def text_block_count(self) -> int:
        return sum(1 for element in self.elements if element.type == "text")

    @property
    def image_block_count(self) -> int:
        return sum(1 for element in self.elements if element.type == "image")

    def extraction_metadata(self) -> dict[str, Any]:
        text_blocks = [element for element in self.elements if element.type == "text"]
        header_footer_candidates = [
            element.to_metadata()
            for element in text_blocks
            if element.role == "header_footer_candidate"
        ]
        side_label_candidates = [
            element.to_metadata()
            for element in text_blocks
            if element.role == "side_label_candidate"
        ]
        return {
            "parser": "pymupdf",
            "extractionStrategy": self.extraction_strategy,
            "readingOrderStrategy": self.reading_order_strategy,
            "columnCount": self.column_count,
            "columnConfidence": round(self.column_confidence, 3),
            "pageNumber": self.page_number,
            "textBlockCount": self.text_block_count,
            "imageBlockCount": self.image_block_count,
            "elements": [element.to_metadata() for element in self.elements],
            "textBlocks": [element.to_text_block_metadata() for element in text_blocks],
            "visualBlocks": [block.to_metadata() for block in self.visual_blocks],
            "visualBlockCount": len(self.visual_blocks),
            "headerFooterCandidates": header_footer_candidates,
            "sideLabelCandidates": side_label_candidates,
        }


@dataclass(frozen=True)
class PdfParseResult:
    page_count: int
    pages: list[PageParseResult]


def decode_pdf_data_uri(pdf_data: str) -> bytes:
    if not pdf_data:
        raise PdfParsingError("pdf_data is required")

    base64_text = pdf_data.split(",", 1)[1] if "," in pdf_data else pdf_data
    try:
        return base64.b64decode(base64_text, validate=True)
    except ValueError as exc:
        raise PdfParsingError("invalid pdf_data") from exc


def parse_pdf_data_uri(pdf_data: str) -> PdfParseResult:
    return parse_pdf_bytes(decode_pdf_data_uri(pdf_data))


def parse_pdf_path(path: Path) -> PdfParseResult:
    try:
        with fitz.open(path) as document:
            return _parse_document(document)
    except PdfParsingError:
        raise
    except Exception as exc:
        raise PdfParsingError("failed to read pdf") from exc


def parse_pdf_bytes(pdf_bytes: bytes) -> PdfParseResult:
    try:
        with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
            return _parse_document(document)
    except PdfParsingError:
        raise
    except Exception as exc:
        raise PdfParsingError("failed to read pdf") from exc


def get_pdf_page_count(path: Path) -> int:
    try:
        with fitz.open(path) as document:
            page_count = int(document.page_count)
    except Exception as exc:
        raise PdfParsingError("failed to read pdf") from exc
    if page_count < 1:
        raise PdfParsingError("pdf has no pages")
    return page_count


def _parse_document(document: fitz.Document) -> PdfParseResult:
    page_count = int(document.page_count)
    if page_count < 1:
        raise PdfParsingError("pdf has no pages")

    pages = [_parse_page(document.load_page(index), index + 1) for index in range(page_count)]
    return PdfParseResult(page_count=page_count, pages=pages)


def _parse_page(page: fitz.Page, page_number: int) -> PageParseResult:
    try:
        raw = page.get_text("dict")
        native_text = _normalize_page_text(str(page.get_text("text") or ""))
    except Exception as exc:
        raise PdfParsingError(f"failed to parse page {page_number}") from exc

    raw_blocks = raw.get("blocks")
    if not isinstance(raw_blocks, list):
        raise PdfParsingError(f"failed to parse page {page_number}")

    page_width = float(page.rect.width)
    page_height = float(page.rect.height)
    raw_elements: list[PageElement] = []
    for block_index, block in enumerate(raw_blocks):
        if not isinstance(block, dict):
            continue
        bbox = _normalize_bbox(block.get("bbox"))
        block_type = block.get("type")
        if block_type == 0:
            text = _extract_text_block_text(block)
            if not text:
                continue
            raw_elements.append(
                PageElement(
                    type="text",
                    bbox=bbox,
                    block_index=block_index,
                    reading_order=-1,
                    role="main_text",
                    text=text,
                    text_preview=_preview(text),
                )
            )
        elif block_type == 1:
            raw_elements.append(
                PageElement(
                    type="image",
                    bbox=bbox,
                    block_index=block_index,
                    reading_order=-1,
                    image_ext=_clean_optional_string(block.get("ext")),
                    width=_safe_int(block.get("width")),
                    height=_safe_int(block.get("height")),
                )
            )

    image_elements = [element for element in raw_elements if element.type == "image"]
    classified_text_elements = [
        _classify_text_element(element, page_width=page_width, page_height=page_height, image_elements=image_elements)
        for element in raw_elements
        if element.type == "text"
    ]
    side_label_elements = [element for element in classified_text_elements if element.role == "side_label_candidate"]
    footer_elements = [element for element in classified_text_elements if element.role == "header_footer_candidate"]
    content_ordered_elements = sorted(
        [*classified_text_elements, *image_elements],
        key=lambda element: element.block_index,
    )
    elements = [
        PageElement(
            type=element.type,
            bbox=element.bbox,
            block_index=element.block_index,
            reading_order=index,
            role=element.role,
            text=element.text,
            text_preview=element.text_preview,
            image_ext=element.image_ext,
            width=element.width,
            height=element.height,
        )
        for index, element in enumerate(content_ordered_elements)
    ]
    visual_blocks = _build_visual_blocks(
        elements,
        page_width=page_width,
        page_height=page_height,
    )
    page_text = _build_visual_block_page_text(visual_blocks)
    if not page_text:
        page_text = _remove_footer_candidate_lines(native_text, footer_elements)
    if not page_text:
        page_text = _build_raw_order_page_text(elements)
    logger.debug(
        "parsed pdf page with pymupdf: page=%s text_blocks=%s image_blocks=%s strategy=%s columns=%s footer_candidates=%s side_label_candidates=%s",
        page_number,
        sum(1 for element in elements if element.type == "text"),
        sum(1 for element in elements if element.type == "image"),
        ORDER_STRATEGY_VISUAL_BLOCKS,
        1,
        len(footer_elements),
        len(side_label_elements),
    )
    return PageParseResult(
        page_number=page_number,
        text=page_text,
        elements=elements,
        visual_blocks=visual_blocks,
        reading_order_strategy=ORDER_STRATEGY_VISUAL_BLOCKS,
        column_count=1,
        column_confidence=0.0,
    )


def _classify_text_element(
    element: PageElement,
    *,
    page_width: float,
    page_height: float,
    image_elements: list[PageElement],
) -> PageElement:
    role: TextBlockRole = "main_text"
    if _is_footer_candidate(element, page_height=page_height):
        role = "header_footer_candidate"
    elif _is_side_label_candidate(element, page_width=page_width, page_height=page_height, image_elements=image_elements):
        role = "side_label_candidate"
    return PageElement(
        type=element.type,
        bbox=element.bbox,
        block_index=element.block_index,
        reading_order=element.reading_order,
        role=role,
        text=element.text,
        text_preview=element.text_preview,
        image_ext=element.image_ext,
        width=element.width,
        height=element.height,
    )


def _is_footer_candidate(element: PageElement, *, page_height: float) -> bool:
    text = " ".join(str(element.text or "").split())
    if not text:
        return False
    _, y0, _, y1 = element.bbox
    near_bottom = y0 >= page_height * 0.82 or y1 >= page_height * 0.9
    if not near_bottom:
        return False
    if not any(pattern.match(text) for pattern in FOOTER_PATTERNS):
        return False
    if len(text) > 64:
        return False
    return True


def _is_side_label_candidate(
    element: PageElement,
    *,
    page_width: float,
    page_height: float,
    image_elements: list[PageElement],
) -> bool:
    text = " ".join(str(element.text or "").split())
    if not text:
        return False
    if len(text) > 70:
        return False
    words = [word for word in re.split(r"\s+", text) if word]
    if len(words) > 7:
        return False
    if element.bbox[1] <= page_height * 0.16:
        return False
    if re.match(r"^(?:\d+[\.)]|[-*\u2022])\s+", text):
        return False
    if text.endswith((".", "?", "!")) and len(words) > 3:
        return False

    x0, y0, x1, y1 = element.bbox
    block_width = max(0.0, x1 - x0)
    block_height = max(0.0, y1 - y0)
    looks_like_diagram_label = bool(re.search(r"[=<>_/]", text)) or any(
        token.lower() in {"ack", "seq", "cwnd", "rwnd", "ssthresh", "sender", "receiver", "timeout"}
        for token in words
    )
    near_right_or_middle = x0 >= page_width * 0.38
    compact_block = block_width <= page_width * 0.48 and block_height <= page_height * 0.18
    near_image = any(_bbox_distance(element.bbox, image.bbox) <= max(page_width, page_height) * 0.08 for image in image_elements)

    if looks_like_diagram_label and compact_block and (near_right_or_middle or near_image):
        return True
    if near_image and compact_block and len(words) <= 4:
        return True
    return False


def _bbox_distance(a: BBox, b: BBox) -> float:
    ax0, ay0, ax1, ay1 = a
    bx0, by0, bx1, by1 = b
    dx = max(bx0 - ax1, ax0 - bx1, 0.0)
    dy = max(by0 - ay1, ay0 - by1, 0.0)
    return (dx * dx + dy * dy) ** 0.5


def _build_visual_blocks(
    elements: list[PageElement],
    *,
    page_width: float,
    page_height: float,
) -> list[VisualBlock]:
    text_elements = [
        element
        for element in elements
        if element.type == "text"
        and element.role != "header_footer_candidate"
        and str(element.text or "").strip()
    ]
    image_elements = [
        element
        for element in elements
        if element.type == "image"
    ]
    if not text_elements and not image_elements:
        return []

    title_elements = [
        element
        for element in text_elements
        if _is_title_block(element, page_width=page_width, page_height=page_height)
    ]
    title_ids = {id(element) for element in title_elements}
    remaining_text = [element for element in text_elements if id(element) not in title_ids]

    blocks: list[VisualBlock] = []
    for title in sorted(title_elements, key=lambda element: (element.bbox[1], element.bbox[0], element.block_index)):
        blocks.append(_make_visual_block("title", [title], len(blocks)))

    for region_elements in _split_visual_regions(remaining_text, page_width=page_width):
        for group in _group_region_elements(region_elements, page_height=page_height):
            if not group:
                continue
            role = _classify_visual_group(group)
            blocks.append(_make_visual_block(role, group, len(blocks)))

    for image in sorted(image_elements, key=lambda element: (element.bbox[1], element.bbox[0], element.block_index)):
        blocks.append(_make_visual_block("image", [image], len(blocks)))

    return [
        VisualBlock(
            role=block.role,
            bbox=block.bbox,
            reading_order=index,
            text=block.text,
            element_indexes=block.element_indexes,
        )
        for index, block in enumerate(sorted(blocks, key=_visual_block_sort_key))
    ]


def _is_title_block(element: PageElement, *, page_width: float, page_height: float) -> bool:
    text = _normalize_line(str(element.text or ""))
    if not text:
        return False
    x0, y0, x1, y1 = element.bbox
    width = max(0.0, x1 - x0)
    height = max(0.0, y1 - y0)
    if y0 > page_height * 0.18:
        return False
    if re.match(r"^\d+(?:\.\d+)+\s+\S+", text):
        return True
    return height >= page_height * 0.055 and width >= page_width * 0.25


def _split_visual_regions(elements: list[PageElement], *, page_width: float) -> list[list[PageElement]]:
    left: list[PageElement] = []
    right: list[PageElement] = []
    center: list[PageElement] = []
    for element in elements:
        x0, _, x1, _ = element.bbox
        center_x = (x0 + x1) / 2
        if center_x < page_width * 0.48:
            left.append(element)
        elif center_x > page_width * 0.52:
            right.append(element)
        else:
            center.append(element)

    regions = [left, right, center]
    return [
        sorted(region, key=lambda element: (element.bbox[1], element.bbox[0], element.block_index))
        for region in regions
        if region
    ]


def _group_region_elements(elements: list[PageElement], *, page_height: float) -> list[list[PageElement]]:
    groups: list[list[PageElement]] = []
    current: list[PageElement] = []
    for element in elements:
        if not current:
            current = [element]
            continue

        if _starts_new_visual_group(current, element, page_height=page_height):
            groups.append(current)
            current = [element]
        else:
            current.append(element)

    if current:
        groups.append(current)
    return groups


def _starts_new_visual_group(current: list[PageElement], element: PageElement, *, page_height: float) -> bool:
    previous = current[-1]
    vertical_gap = element.bbox[1] - previous.bbox[3]
    starts_bullet = _starts_with_bullet(element.text)
    current_text = _join_element_text(current)
    current_is_single_heading = len(current) == 1 and current_text.rstrip().endswith(":")
    current_bbox = _union_bbox(current)
    same_column = _horizontal_overlap_ratio(current_bbox, element.bbox) >= 0.12

    if starts_bullet and current and not (current_is_single_heading and vertical_gap <= page_height * 0.075 and same_column):
        return True
    if vertical_gap > page_height * 0.16:
        return True
    if vertical_gap > page_height * 0.075 and not same_column:
        return True
    return False


def _classify_visual_group(group: list[PageElement]) -> VisualBlockRole:
    text = _join_element_text(group)
    if any(_starts_with_bullet(element.text) for element in group):
        return "content"
    if any(element.role == "side_label_candidate" for element in group):
        return "figure"
    if _looks_like_figure_label_group(group, text):
        return "figure"
    if _looks_like_formula_text(text):
        return "figure"
    return "content"


def _make_visual_block(role: VisualBlockRole, elements: list[PageElement], reading_order: int) -> VisualBlock:
    bbox = _union_bbox(elements)
    text = _join_element_text(_order_elements_inside_visual_block(elements, role=role))
    if role == "image" and not text:
        text = "[Image block]"
    return VisualBlock(
        role=role,
        bbox=bbox,
        reading_order=reading_order,
        text=text,
        element_indexes=[element.block_index for element in elements],
    )


def _order_elements_inside_visual_block(elements: list[PageElement], *, role: VisualBlockRole) -> list[PageElement]:
    if role == "content":
        return sorted(elements, key=lambda element: element.block_index)
    return sorted(elements, key=lambda element: (element.bbox[1], element.bbox[0], element.block_index))


def _join_element_text(elements: list[PageElement]) -> str:
    return _normalize_page_text("\n".join(str(element.text or "").strip() for element in elements if str(element.text or "").strip()))


def _build_visual_block_page_text(blocks: list[VisualBlock]) -> str:
    sections = []
    for block in blocks:
        if block.role == "image":
            continue
        text = block.text.strip()
        if not text:
            continue
        label = {
            "title": "Title",
            "content": "Content",
            "figure": "Figure",
            "other": "Block",
            "image": "Image",
        }.get(block.role, "Block")
        sections.append(f"[{label}]\n{text}")
    return "\n\n".join(sections).strip()


def _visual_block_sort_key(block: VisualBlock) -> tuple[int, int, float, float]:
    if block.role == "title":
        return (0, 0, block.bbox[1], block.bbox[0])
    column_bucket = int(block.bbox[0] // 200)
    return (1, column_bucket, block.bbox[1], block.bbox[0])


def _starts_with_bullet(text: str | None) -> bool:
    return bool(re.match(r"^\s*(?:[\u2756\u2022\u00b7\-*]|\d+[\.)])\s*", str(text or "")))


def _looks_like_formula_text(text: str) -> bool:
    normalized = _normalize_line(text)
    if not normalized:
        return False
    return bool(re.search(r"[=<>~/\u2248]", normalized)) and len(normalized.split()) <= 18


def _looks_like_figure_label_group(group: list[PageElement], text: str) -> bool:
    normalized = _normalize_line(text)
    if not normalized:
        return False
    if len(group) < 2:
        return False
    words = normalized.split()
    if len(words) > 18:
        return False
    if normalized.endswith((".", "?", "!")):
        return False
    return not any(_starts_with_bullet(line) for line in text.splitlines())


def _union_bbox(elements: list[PageElement]) -> BBox:
    if not elements:
        return (0.0, 0.0, 0.0, 0.0)
    x0 = min(element.bbox[0] for element in elements)
    y0 = min(element.bbox[1] for element in elements)
    x1 = max(element.bbox[2] for element in elements)
    y1 = max(element.bbox[3] for element in elements)
    return (x0, y0, x1, y1)


def _horizontal_overlap_ratio(a: BBox, b: BBox) -> float:
    overlap = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
    width = max(1.0, min(max(0.0, a[2] - a[0]), max(0.0, b[2] - b[0])))
    return overlap / width


def _build_raw_order_page_text(elements: list[PageElement]) -> str:
    parts = [
        str(element.text or "").strip()
        for element in elements
        if element.type == "text"
        and element.role != "header_footer_candidate"
        and str(element.text or "").strip()
    ]
    return _normalize_page_text("\n\n".join(parts))


def _remove_footer_candidate_lines(text: str, footer_elements: list[PageElement]) -> str:
    footer_lines = {
        _normalize_line(str(element.text or ""))
        for element in footer_elements
        if str(element.text or "").strip()
    }
    if not text or not footer_lines:
        return text

    kept_lines = [
        line
        for line in text.splitlines()
        if _normalize_line(line) not in footer_lines
    ]
    return _normalize_page_text("\n".join(kept_lines))


def _normalize_page_text(text: str) -> str:
    normalized_lines: list[str] = []
    previous_blank = False
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        stripped = line.strip()
        if not stripped:
            if normalized_lines and not previous_blank:
                normalized_lines.append("")
            previous_blank = True
            continue
        normalized_lines.append(stripped)
        previous_blank = False
    return "\n".join(normalized_lines).strip()


def _normalize_line(text: str) -> str:
    return " ".join(text.split()).strip()


def _normalize_bbox(value: Any) -> BBox:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return (0.0, 0.0, 0.0, 0.0)
    try:
        return tuple(float(item) for item in value)  # type: ignore[return-value]
    except (TypeError, ValueError):
        return (0.0, 0.0, 0.0, 0.0)


def _extract_text_block_text(block: dict[str, Any]) -> str:
    lines = block.get("lines")
    if not isinstance(lines, list):
        return ""

    text_lines: list[str] = []
    for line in lines:
        if not isinstance(line, dict):
            continue
        spans = line.get("spans")
        if not isinstance(spans, list):
            continue
        line_text = "".join(str(span.get("text") or "") for span in spans if isinstance(span, dict)).strip()
        if line_text:
            text_lines.append(line_text)
    return "\n".join(text_lines).strip()


def _preview(text: str, max_length: int = 240) -> str:
    normalized = " ".join(text.split())
    if len(normalized) <= max_length:
        return normalized
    return f"{normalized[:max_length].rstrip()}..."


def _clean_optional_string(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _safe_int(value: Any) -> int | None:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return None
    return number if number >= 0 else None
