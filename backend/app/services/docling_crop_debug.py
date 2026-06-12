import base64
import hashlib
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

import fitz  # type: ignore[import-untyped]

from backend.app.services.docling_batch_pipeline import CachedDoclingPage, CachedDoclingVisualCandidate


class DoclingCropDebugError(ValueError):
    pass


CandidateType = Literal["picture", "table", "full_page"]
BBox = tuple[float, float, float, float]

DEFAULT_MIN_AREA_RATIO = 0.015
DEFAULT_MARGIN_RATIO = 0.14
DEFAULT_PAGE_MAX_CANDIDATES = 5
DEFAULT_DOCUMENT_MAX_CANDIDATES = 40
DEFAULT_RENDER_SCALE = 1.6
MIN_CROP_SIDE_POINTS = 24.0
FULL_PAGE_SIGNIFICANT_AREA_RATIO = 0.03
FULL_PAGE_SINGLE_AREA_RATIO = 0.45
FULL_PAGE_MULTI_MIN_COUNT = 3
FULL_PAGE_MULTI_TOTAL_AREA_RATIO = 0.15


@dataclass(frozen=True)
class DoclingCropCandidate:
    id: str
    page_number: int
    candidate_type: CandidateType
    self_ref: str | None
    docling_bbox: BBox
    docling_coord_origin: str
    pdf_bbox: BBox
    image_bbox: BBox
    context_bbox: BBox
    crop_mode: str
    page_width: float
    page_height: float
    area_ratio: float
    image_crop_width: int
    image_crop_height: int
    context_crop_width: int
    context_crop_height: int
    image_crop_data_uri: str
    context_crop_data_uri: str
    crop_hash: str
    image_crop_hash: str
    context_crop_hash: str
    nearby_text: str | None = None
    text_preview: str | None = None

    def to_response(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "page_number": self.page_number,
            "candidate_type": self.candidate_type,
            "self_ref": self.self_ref,
            "docling_bbox": _round_bbox(self.docling_bbox),
            "docling_coord_origin": self.docling_coord_origin,
            "pdf_bbox": _round_bbox(self.pdf_bbox),
            "image_bbox": _round_bbox(self.image_bbox),
            "context_bbox": _round_bbox(self.context_bbox),
            "crop_bbox": _round_bbox(self.context_bbox),
            "crop_mode": self.crop_mode,
            "page_width": round(self.page_width, 2),
            "page_height": round(self.page_height, 2),
            "area_ratio": round(self.area_ratio, 5),
            "image_area_ratio": round(self.area_ratio, 5),
            "crop_width": self.context_crop_width,
            "crop_height": self.context_crop_height,
            "image_crop_width": self.image_crop_width,
            "image_crop_height": self.image_crop_height,
            "context_crop_width": self.context_crop_width,
            "context_crop_height": self.context_crop_height,
            "image_data_uri": self.context_crop_data_uri,
            "image_crop_data_uri": self.image_crop_data_uri,
            "context_crop_data_uri": self.context_crop_data_uri,
            "crop_hash": self.crop_hash,
            "image_crop_hash": self.image_crop_hash,
            "context_crop_hash": self.context_crop_hash,
            "text_preview": self.text_preview,
        }


@dataclass(frozen=True)
class DoclingCropDebugResult:
    parser: str = "docling"
    candidates: list[DoclingCropCandidate] = field(default_factory=list)
    elapsed_ms: float = 0.0
    scanned_page_count: int = 0
    filtered_count: int = 0
    skipped_candidate_count: int = 0
    candidate_limit_reached: bool = False


def render_pdf_crop_preview_from_bboxes(
    path: Path,
    *,
    page_number: int,
    image_bbox: BBox,
    context_bbox: BBox,
    render_scale: float = DEFAULT_RENDER_SCALE,
) -> dict[str, Any]:
    if not path.exists() or path.suffix.lower() != ".pdf":
        raise DoclingCropDebugError("stored pdf file is unavailable")
    try:
        with fitz.open(path) as pdf_document:
            if page_number < 1 or page_number > pdf_document.page_count:
                raise DoclingCropDebugError("page_number is out of range")
            page = pdf_document.load_page(page_number - 1)
            page_width = float(page.rect.width)
            page_height = float(page.rect.height)
            safe_image_bbox = _clamp_bbox(image_bbox, page_width, page_height)
            safe_context_bbox = _clamp_bbox(context_bbox, page_width, page_height)
            image_bytes, image_width, image_height = _render_page_crop(page, safe_image_bbox, render_scale=render_scale)
            context_bytes, context_width, context_height = _render_page_crop(page, safe_context_bbox, render_scale=render_scale)
    except DoclingCropDebugError:
        raise
    except Exception as exc:
        raise DoclingCropDebugError("failed to render pdf crop preview") from exc
    return {
        "page_number": page_number,
        "image_bbox": _round_bbox(safe_image_bbox),
        "context_bbox": _round_bbox(safe_context_bbox),
        "image_crop_data_uri": _png_data_uri(image_bytes),
        "context_crop_data_uri": _png_data_uri(context_bytes),
        "image_crop_width": image_width,
        "image_crop_height": image_height,
        "context_crop_width": context_width,
        "context_crop_height": context_height,
    }


def extract_docling_crop_candidates_from_cached(
    path: Path,
    *,
    cached_candidates: list[CachedDoclingVisualCandidate],
    min_area_ratio: float = DEFAULT_MIN_AREA_RATIO,
    margin_ratio: float = DEFAULT_MARGIN_RATIO,
    page_max_candidates: int = DEFAULT_PAGE_MAX_CANDIDATES,
    document_max_candidates: int = DEFAULT_DOCUMENT_MAX_CANDIDATES,
    render_scale: float = DEFAULT_RENDER_SCALE,
) -> DoclingCropDebugResult:
    if not path.exists() or path.suffix.lower() != ".pdf":
        raise DoclingCropDebugError("stored pdf file is unavailable")
    started_at = time.perf_counter()
    candidates: list[DoclingCropCandidate] = []
    filtered_count = 0
    skipped_candidate_count = 0
    page_counts: dict[int, int] = {}
    scanned_pages: set[int] = set()

    try:
        with fitz.open(path) as pdf_document:
            for item_index, cached in enumerate(sorted(cached_candidates, key=lambda item: (item.page_number, item.bbox[1], item.bbox[0]))):
                if cached.page_number < 1 or cached.page_number > pdf_document.page_count:
                    filtered_count += 1
                    continue
                if len(candidates) >= document_max_candidates:
                    skipped_candidate_count += 1
                    continue
                if page_counts.get(cached.page_number, 0) >= page_max_candidates:
                    skipped_candidate_count += 1
                    continue
                page = pdf_document.load_page(cached.page_number - 1)
                candidate = _make_crop_candidate_from_bbox(
                    page=page,
                    item_index=item_index,
                    page_number=cached.page_number,
                    candidate_type=cached.candidate_type,
                    self_ref=cached.self_ref,
                    docling_bbox=cached.bbox,
                    coord_origin=cached.coord_origin,
                    docling_page_size=(page.rect.width, page.rect.height),
                    min_area_ratio=min_area_ratio,
                    margin_ratio=margin_ratio,
                    render_scale=render_scale,
                    text_preview=cached.text_preview,
                )
                if candidate is None:
                    filtered_count += 1
                    continue
                page_counts[cached.page_number] = page_counts.get(cached.page_number, 0) + 1
                scanned_pages.add(cached.page_number)
                candidates.append(candidate)
    except Exception as exc:
        raise DoclingCropDebugError("failed to render cached docling crop candidates") from exc

    return DoclingCropDebugResult(
        candidates=candidates,
        elapsed_ms=round((time.perf_counter() - started_at) * 1000, 1),
        scanned_page_count=len(scanned_pages),
        filtered_count=filtered_count,
        skipped_candidate_count=skipped_candidate_count,
        candidate_limit_reached=skipped_candidate_count > 0,
    )


def extract_docling_crop_candidates_from_cached_pages(
    path: Path,
    *,
    cached_pages: list[CachedDoclingPage],
    min_area_ratio: float = DEFAULT_MIN_AREA_RATIO,
    margin_ratio: float = DEFAULT_MARGIN_RATIO,
    page_max_candidates: int = DEFAULT_PAGE_MAX_CANDIDATES,
    document_max_candidates: int = DEFAULT_DOCUMENT_MAX_CANDIDATES,
    render_scale: float = DEFAULT_RENDER_SCALE,
    use_full_page_context: bool = False,
) -> DoclingCropDebugResult:
    pages_by_number = {page.page_number: page for page in cached_pages}
    source_candidates: list[CachedDoclingVisualCandidate] = []
    for page in cached_pages:
        if use_full_page_context and _should_use_full_page_context(page):
            source_candidates.append(
                CachedDoclingVisualCandidate(
                    page_number=page.page_number,
                    candidate_type="full_page",
                    self_ref=None,
                    bbox=(0.0, 0.0, max(1.0, page.page_width), max(1.0, page.page_height)),
                    coord_origin="TOPLEFT",
                    text_preview="full page context",
                )
            )
        else:
            source_candidates.extend(page.visual_candidates)
    result = extract_docling_crop_candidates_from_cached(
        path,
        cached_candidates=source_candidates,
        min_area_ratio=min_area_ratio,
        margin_ratio=margin_ratio,
        page_max_candidates=page_max_candidates,
        document_max_candidates=document_max_candidates,
        render_scale=render_scale,
    )
    enriched: list[DoclingCropCandidate] = []
    for candidate in result.candidates:
        page = pages_by_number.get(candidate.page_number)
        nearby_text = _nearby_text_for_context_bbox(page, candidate.context_bbox) if page else None
        enriched.append(
            DoclingCropCandidate(
                id=candidate.id,
                page_number=candidate.page_number,
                candidate_type=candidate.candidate_type,
                self_ref=candidate.self_ref,
                docling_bbox=candidate.docling_bbox,
                docling_coord_origin=candidate.docling_coord_origin,
                pdf_bbox=candidate.pdf_bbox,
                image_bbox=candidate.image_bbox,
                context_bbox=candidate.context_bbox,
                crop_mode=candidate.crop_mode,
                page_width=candidate.page_width,
                page_height=candidate.page_height,
                area_ratio=candidate.area_ratio,
                image_crop_width=candidate.image_crop_width,
                image_crop_height=candidate.image_crop_height,
                context_crop_width=candidate.context_crop_width,
                context_crop_height=candidate.context_crop_height,
                image_crop_data_uri=candidate.image_crop_data_uri,
                context_crop_data_uri=candidate.context_crop_data_uri,
                crop_hash=candidate.crop_hash,
                image_crop_hash=candidate.image_crop_hash,
                context_crop_hash=candidate.context_crop_hash,
                nearby_text=nearby_text,
                text_preview=candidate.text_preview,
            )
        )
    return DoclingCropDebugResult(
        candidates=enriched,
        elapsed_ms=result.elapsed_ms,
        scanned_page_count=result.scanned_page_count,
        filtered_count=result.filtered_count,
        skipped_candidate_count=result.skipped_candidate_count,
        candidate_limit_reached=result.candidate_limit_reached,
    )


def _make_crop_candidate_from_bbox(
    *,
    page: fitz.Page,
    item_index: int,
    page_number: int,
    candidate_type: CandidateType,
    self_ref: str | None,
    docling_bbox: BBox,
    coord_origin: str,
    docling_page_size: tuple[float, float],
    min_area_ratio: float,
    margin_ratio: float,
    render_scale: float,
    text_preview: str | None,
) -> DoclingCropCandidate | None:
    pdf_bbox = _docling_bbox_to_pdf_bbox(
        docling_bbox,
        coord_origin=coord_origin,
        docling_page_width=docling_page_size[0],
        docling_page_height=docling_page_size[1],
        pdf_page_width=float(page.rect.width),
        pdf_page_height=float(page.rect.height),
    )
    page_area = max(1.0, float(page.rect.width) * float(page.rect.height))
    area_ratio = _bbox_area(pdf_bbox) / page_area
    if area_ratio < min_area_ratio:
        return None
    if min(pdf_bbox[2] - pdf_bbox[0], pdf_bbox[3] - pdf_bbox[1]) < MIN_CROP_SIDE_POINTS:
        return None

    image_bbox = pdf_bbox
    is_full_page = candidate_type == "full_page"
    context_bbox = (
        _clamp_bbox((0.0, 0.0, float(page.rect.width), float(page.rect.height)), float(page.rect.width), float(page.rect.height))
        if is_full_page
        else _expand_bbox(image_bbox, margin_ratio=margin_ratio, page_width=float(page.rect.width), page_height=float(page.rect.height))
    )
    image_bytes, image_width, image_height = _render_page_crop(page, image_bbox, render_scale=render_scale)
    context_bytes, context_width, context_height = _render_page_crop(page, context_bbox, render_scale=render_scale)
    image_crop_hash = hashlib.sha256(image_bytes).hexdigest()
    context_crop_hash = hashlib.sha256(context_bytes).hexdigest()
    return DoclingCropCandidate(
        id=f"{candidate_type}:p{page_number}:{item_index}",
        page_number=page_number,
        candidate_type=candidate_type,
        self_ref=self_ref,
        docling_bbox=docling_bbox,
        docling_coord_origin=coord_origin,
        pdf_bbox=pdf_bbox,
        image_bbox=image_bbox,
        context_bbox=context_bbox,
        crop_mode="full_page_context" if is_full_page else "image_with_context",
        page_width=float(page.rect.width),
        page_height=float(page.rect.height),
        area_ratio=area_ratio,
        image_crop_width=image_width,
        image_crop_height=image_height,
        context_crop_width=context_width,
        context_crop_height=context_height,
        image_crop_data_uri=_png_data_uri(image_bytes),
        context_crop_data_uri=_png_data_uri(context_bytes),
        crop_hash=context_crop_hash,
        image_crop_hash=image_crop_hash,
        context_crop_hash=context_crop_hash,
        nearby_text=None,
        text_preview=text_preview,
    )


def _docling_bbox_to_pdf_bbox(
    bbox: BBox,
    *,
    coord_origin: str,
    docling_page_width: float,
    docling_page_height: float,
    pdf_page_width: float,
    pdf_page_height: float,
) -> BBox:
    left, bottom, right, top = bbox
    if coord_origin == "BOTTOMLEFT":
        x0 = left
        y0 = docling_page_height - top
        x1 = right
        y1 = docling_page_height - bottom
    else:
        x0 = left
        y0 = top
        x1 = right
        y1 = bottom
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    scale_x = pdf_page_width / max(1.0, docling_page_width)
    scale_y = pdf_page_height / max(1.0, docling_page_height)
    return _clamp_bbox((x0 * scale_x, y0 * scale_y, x1 * scale_x, y1 * scale_y), pdf_page_width, pdf_page_height)


def _nearby_text_for_context_bbox(page: CachedDoclingPage, context_bbox: BBox, max_blocks: int = 12) -> str | None:
    matched: list[tuple[float, str]] = []
    for block in page.text_blocks:
        if not block.bbox or not block.text.strip():
            continue
        pdf_bbox = _docling_bbox_to_pdf_bbox(
            block.bbox,
            coord_origin=block.coord_origin,
            docling_page_width=page.page_width,
            docling_page_height=page.page_height,
            pdf_page_width=page.page_width,
            pdf_page_height=page.page_height,
        )
        if not _bbox_intersects(context_bbox, pdf_bbox):
            continue
        matched.append((pdf_bbox[1], block.text.strip()))
    if not matched:
        return None
    texts: list[str] = []
    for _top, text in sorted(matched, key=lambda item: item[0])[:max_blocks]:
        if text not in texts:
            texts.append(text)
    return "\n".join(texts).strip() or None


def _should_use_full_page_context(page: CachedDoclingPage) -> bool:
    page_area = max(1.0, page.page_width * page.page_height)
    significant_areas = [
        _bbox_area(candidate.bbox) / page_area
        for candidate in page.visual_candidates
        if _bbox_area(candidate.bbox) / page_area >= FULL_PAGE_SIGNIFICANT_AREA_RATIO
    ]
    if any(area >= FULL_PAGE_SINGLE_AREA_RATIO for area in significant_areas):
        return True
    return (
        len(significant_areas) >= FULL_PAGE_MULTI_MIN_COUNT
        and sum(significant_areas) >= FULL_PAGE_MULTI_TOTAL_AREA_RATIO
    )


def _bbox_intersects(a: BBox, b: BBox) -> bool:
    return min(a[2], b[2]) >= max(a[0], b[0]) and min(a[3], b[3]) >= max(a[1], b[1])


def _expand_bbox(bbox: BBox, *, margin_ratio: float, page_width: float, page_height: float) -> BBox:
    width = max(1.0, bbox[2] - bbox[0])
    height = max(1.0, bbox[3] - bbox[1])
    margin_x = max(6.0, width * margin_ratio)
    margin_y = max(6.0, height * margin_ratio)
    return _clamp_bbox((bbox[0] - margin_x, bbox[1] - margin_y, bbox[2] + margin_x, bbox[3] + margin_y), page_width, page_height)


def _render_page_crop(page: fitz.Page, bbox: BBox, *, render_scale: float) -> tuple[bytes, int, int]:
    pixmap = page.get_pixmap(matrix=fitz.Matrix(render_scale, render_scale), clip=fitz.Rect(*bbox), alpha=False)
    return pixmap.tobytes("png"), int(pixmap.width), int(pixmap.height)


def _png_data_uri(image_bytes: bytes) -> str:
    return f"data:image/png;base64,{base64.b64encode(image_bytes).decode('ascii')}"


def _clamp_bbox(bbox: BBox, page_width: float, page_height: float) -> BBox:
    x0 = max(0.0, min(page_width, bbox[0]))
    y0 = max(0.0, min(page_height, bbox[1]))
    x1 = max(0.0, min(page_width, bbox[2]))
    y1 = max(0.0, min(page_height, bbox[3]))
    x0, x1 = sorted((x0, x1))
    y0, y1 = sorted((y0, y1))
    return (x0, y0, x1, y1)


def _bbox_area(bbox: BBox) -> float:
    return max(0.0, bbox[2] - bbox[0]) * max(0.0, bbox[3] - bbox[1])


def _round_bbox(bbox: BBox) -> list[float]:
    return [round(value, 2) for value in bbox]
