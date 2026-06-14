import logging
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from psycopg import Connection

from backend.app.core.auth import get_current_user
from backend.app.core.config import Settings, get_settings
from backend.app.db.crud import execute_commit, execute_returning, fetch_all, fetch_one, require_row
from backend.app.db.session import get_db_connection
from backend.app.schemas.notes import (
    HandwritingAnalysisRead,
    HandwritingRecognitionWrite,
    NoteCreate,
    NotePageCreate,
    NotePageRead,
    NotePageUpdate,
    NoteRagStatusRead,
    NoteRead,
    NoteUpdate,
)
from backend.app.services.document_chunk_index import (
    delete_note_page_chunks_background,
    reindex_note_chunks_from_pages_background,
    reindex_note_page_background,
    sync_note_rag_metadata,
)
from backend.app.services.handwriting_signals import (
    build_handwriting_recognition_from_geometry,
    cluster_ink_strokes,
    compute_geometry_symbol_candidates,
    extract_page_ink_strokes,
    merge_handwriting_recognition_results,
    normalize_korean_study_keywords,
    stable_stroke_hash,
)
from backend.app.services.handwriting_vision_fallback import (
    analyze_handwriting_image_with_openai,
    render_ink_cluster_to_png,
    vision_api_key_available,
    vision_fallback_enabled,
    vision_max_clusters_per_page,
    vision_max_pages_per_note,
    vision_min_cluster_strokes,
)
from backend.app.services.note_page_content import merge_handwriting_recognition, merge_page_state_content, parse_page_state


router = APIRouter(tags=["notes"])
logger = logging.getLogger("uvicorn.error")
VISION_STAR_LIKE_CONFIDENCE_THRESHOLD = 0.45


def _schedule_note_page_structure_reindex(background_tasks: BackgroundTasks, note_id: int, user_id: int) -> None:
    background_tasks.add_task(reindex_note_chunks_from_pages_background, note_id, user_id)


def _schedule_note_page_reindex(background_tasks: BackgroundTasks, page_id: int, user_id: int) -> None:
    background_tasks.add_task(reindex_note_page_background, page_id, user_id)


def _schedule_note_page_chunk_delete(background_tasks: BackgroundTasks, page_id: int, user_id: int) -> None:
    background_tasks.add_task(delete_note_page_chunks_background, page_id, user_id)


def _delete_image_summaries_for_page(cursor: Any, *, note_id: int, page_number: int, user_id: int) -> None:
    cursor.execute(
        """
        DELETE FROM document_chunks
        WHERE user_id = %s
          AND source_type = 'image_ai_summary'
          AND source_id = ANY(
              SELECT id::text
              FROM image_ai_summaries
              WHERE user_id = %s
                AND note_id = %s
                AND page_number = %s
          )
        """,
        (user_id, user_id, note_id, page_number),
    )
    cursor.execute(
        """
        DELETE FROM image_ai_summaries
        WHERE user_id = %s
          AND note_id = %s
          AND page_number = %s
        """,
        (user_id, note_id, page_number),
    )


def _shift_image_summaries_after_page(cursor: Any, *, note_id: int, page_number: int, delta: int, user_id: int) -> None:
    if delta == 0:
        return
    offset = 100000
    cursor.execute(
        """
        UPDATE image_ai_summaries
        SET page_number = page_number + %s,
            indexed = false,
            indexed_at = NULL,
            updated_at = now()
        WHERE user_id = %s
          AND note_id = %s
          AND page_number > %s
        """,
        (offset, user_id, note_id, page_number),
    )
    cursor.execute(
        """
        UPDATE image_ai_summaries
        SET page_number = page_number - %s + %s,
            indexed = false,
            indexed_at = NULL,
            updated_at = now()
        WHERE user_id = %s
          AND note_id = %s
          AND page_number > %s
        """,
        (offset, delta, user_id, note_id, offset),
    )


def _duplicate_image_summaries_for_page(cursor: Any, *, note_id: int, page_number: int, user_id: int) -> None:
    cursor.execute(
        """
        INSERT INTO image_ai_summaries (
            user_id, folder_id, note_id, page_number, candidate_type, docling_ref,
            crop_hash, image_hash, status, skipped_reason, summary, ocr_text,
            confidence, importance, confidence_reason, importance_reason,
            indexed, metadata, analyzed_at, indexed_at, created_at, updated_at
        )
        SELECT user_id, folder_id, note_id, %s, candidate_type, docling_ref,
               crop_hash, image_hash, status, skipped_reason, summary, ocr_text,
               confidence, importance, confidence_reason, importance_reason,
               false, metadata, analyzed_at, NULL, now(), now()
        FROM image_ai_summaries
        WHERE user_id = %s
          AND note_id = %s
          AND page_number = %s
        ON CONFLICT (user_id, note_id, page_number, crop_hash) DO NOTHING
        """,
        (page_number + 1, user_id, note_id, page_number),
    )


def _swap_image_summary_pages(cursor: Any, *, note_id: int, page_number: int, next_page_number: int, user_id: int) -> None:
    temp_page_number = -max(page_number, next_page_number, 1)
    cursor.execute(
        """
        UPDATE image_ai_summaries
        SET page_number = %s,
            indexed = false,
            indexed_at = NULL,
            updated_at = now()
        WHERE user_id = %s
          AND note_id = %s
          AND page_number = %s
        """,
        (temp_page_number, user_id, note_id, page_number),
    )
    cursor.execute(
        """
        UPDATE image_ai_summaries
        SET page_number = %s,
            indexed = false,
            indexed_at = NULL,
            updated_at = now()
        WHERE user_id = %s
          AND note_id = %s
          AND page_number = %s
        """,
        (page_number, user_id, note_id, next_page_number),
    )
    cursor.execute(
        """
        UPDATE image_ai_summaries
        SET page_number = %s,
            indexed = false,
            indexed_at = NULL,
            updated_at = now()
        WHERE user_id = %s
          AND note_id = %s
          AND page_number = %s
        """,
        (next_page_number, user_id, note_id, temp_page_number),
    )


def get_note_for_user(note_id: int, user_id: int, connection: Connection):
    return require_row(
        fetch_one(
            connection,
            """
            SELECT id, folder_id, title, summary, file_url, thumbnail_url, page_count, created_at, updated_at
            FROM notes
            WHERE id = %s AND user_id = %s
            """,
            (note_id, user_id),
        ),
        "note not found",
    )


def _list_pages_for_note(connection: Connection, note_id: int) -> list[dict]:
    return fetch_all(
        connection,
        """
        SELECT id, note_id, page_number, content, image_url, created_at, updated_at
        FROM note_pages
        WHERE note_id = %s
        ORDER BY page_number ASC, id ASC
        """,
        (note_id,),
    )

def _list_page_refs_for_note(connection: Connection, note_id: int) -> list[dict]:
    return fetch_all(
        connection,
        """
        SELECT id, note_id, page_number, NULL::text AS content, image_url, created_at, updated_at
        FROM note_pages
        WHERE note_id = %s
        ORDER BY page_number ASC, id ASC
        """,
        (note_id,),
    )


def _count_cached_docling_visual_candidates(connection: Connection, *, note_id: int, user_id: int) -> int:
    rows = fetch_all(
        connection,
        """
        SELECT result
        FROM docling_batch_results
        WHERE user_id = %s
          AND note_id = %s
          AND status = 'ready'
        """,
        (user_id, note_id),
    )
    count = 0
    for row in rows:
        result = row.get("result") if isinstance(row.get("result"), dict) else {}
        pages = result.get("pages") if isinstance(result.get("pages"), list) else []
        for page in pages:
            if not isinstance(page, dict):
                continue
            visual_candidates = page.get("visual_candidates")
            if isinstance(visual_candidates, list):
                count += len(visual_candidates)
    return count


def _get_note_page_for_user(page_id: int, user_id: int, connection: Connection) -> dict:
    return require_row(
        fetch_one(
            connection,
            """
            SELECT p.id, p.note_id, p.page_number, p.content, p.image_url, p.created_at, p.updated_at
            FROM note_pages p
            JOIN notes n ON n.id = p.note_id
            WHERE p.id = %s AND n.user_id = %s
            """,
            (page_id, user_id),
        ),
        "note page not found",
    )


def _failed_handwriting_recognition(stroke_hash: str, engine: str = "geometry") -> dict[str, Any]:
    return {
        "status": "failed",
        "strokeHash": stroke_hash,
        "engine": engine,
        "text": "",
        "keywords": [],
        "symbols": [],
        "confidence": 0.0,
        "clusters": [],
        "visionFallbackUsed": False,
        "analyzedClusterCount": 0,
        "visionAnalyzedClusterCount": 0,
        "cached": False,
        "stale": False,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }


def _recognition_confidence(recognition: dict[str, Any]) -> float:
    try:
        return max(0.0, min(1.0, float(recognition.get("confidence") or 0.0)))
    except (TypeError, ValueError):
        return 0.0


def _cluster_looks_text_like(cluster: dict[str, Any]) -> bool:
    stroke_count = int(cluster.get("strokeCount") or 0)
    point_count = int(cluster.get("pointCount") or 0)
    bbox = cluster.get("bbox") if isinstance(cluster.get("bbox"), dict) else {}
    width = float(bbox.get("width") or 0)
    height = float(bbox.get("height") or 0)
    if stroke_count < 2 or point_count < 6 or width < 12 or height < 8:
        return False
    if stroke_count > 24 or max(width, height) > 420:
        return False
    ratio = width / max(1.0, height)
    return 0.25 <= ratio <= 12


def _cluster_symbols(cluster: dict[str, Any]) -> set[str]:
    symbols = cluster.get("symbols")
    return {symbol for symbol in symbols if isinstance(symbol, str)} if isinstance(symbols, list) else set()


def _cluster_id(cluster: dict[str, Any]) -> str:
    value = cluster.get("id")
    return str(value) if value is not None else ""


def _cluster_bbox(cluster: dict[str, Any]) -> dict[str, float] | None:
    bbox = cluster.get("bbox") if isinstance(cluster.get("bbox"), dict) else None
    if not bbox:
        return None
    try:
        return {
            "x": float(bbox.get("x") or 0.0),
            "y": float(bbox.get("y") or 0.0),
            "width": max(0.0, float(bbox.get("width") or 0.0)),
            "height": max(0.0, float(bbox.get("height") or 0.0)),
        }
    except (TypeError, ValueError):
        return None


def _bbox_gap(left: dict[str, float], right: dict[str, float]) -> float:
    left_right = left["x"] + left["width"]
    right_right = right["x"] + right["width"]
    left_bottom = left["y"] + left["height"]
    right_bottom = right["y"] + right["height"]
    dx = max(right["x"] - left_right, left["x"] - right_right, 0.0)
    dy = max(right["y"] - left_bottom, left["y"] - right_bottom, 0.0)
    return math.hypot(dx, dy)


def _raw_point_xy(point: dict[str, Any]) -> tuple[float, float] | None:
    try:
        return float(point["x"]), float(point["y"])
    except (KeyError, TypeError, ValueError):
        return None


def _raw_stroke_points(stroke: dict[str, Any]) -> list[tuple[float, float]]:
    points = stroke.get("points")
    if not isinstance(points, list):
        return []
    return [xy for point in points if isinstance(point, dict) and (xy := _raw_point_xy(point)) is not None]


def _segment_intersection_point(
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
    d: tuple[float, float],
) -> tuple[float, float] | None:
    denominator = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0])
    if abs(denominator) < 1e-6:
        return None
    x = (
        (a[0] * b[1] - a[1] * b[0]) * (c[0] - d[0])
        - (a[0] - b[0]) * (c[0] * d[1] - c[1] * d[0])
    ) / denominator
    y = (
        (a[0] * b[1] - a[1] * b[0]) * (c[1] - d[1])
        - (a[1] - b[1]) * (c[0] * d[1] - c[1] * d[0])
    ) / denominator
    tolerance = 2.0
    if (
        min(a[0], b[0]) - tolerance <= x <= max(a[0], b[0]) + tolerance
        and min(a[1], b[1]) - tolerance <= y <= max(a[1], b[1]) + tolerance
        and min(c[0], d[0]) - tolerance <= x <= max(c[0], d[0]) + tolerance
        and min(c[1], d[1]) - tolerance <= y <= max(c[1], d[1]) + tolerance
    ):
        return x, y
    return None


def _stroke_axis(points: list[tuple[float, float]]) -> tuple[tuple[float, float], tuple[float, float], int] | None:
    if len(points) < 2:
        return None
    start, end = points[0], points[-1]
    length = math.hypot(end[0] - start[0], end[1] - start[1])
    if length < 18:
        return None
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    orientation_bin = int(round((angle % math.pi) / (math.pi / 6))) % 6
    return start, end, orientation_bin


def _raw_points_bbox(points: list[tuple[float, float]]) -> dict[str, float] | None:
    if not points:
        return None
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return {
        "x": min(xs),
        "y": min(ys),
        "width": max(xs) - min(xs),
        "height": max(ys) - min(ys),
    }


def _single_stroke_has_star_like_shape(stroke: dict[str, Any]) -> bool:
    points = _raw_stroke_points(stroke)
    if len(points) < 5:
        return False
    bbox = _raw_points_bbox(points)
    if bbox is None or bbox["width"] < 18 or bbox["height"] < 18:
        return False

    candidates = compute_geometry_symbol_candidates({
        "strokes": [stroke],
        "bbox": bbox,
        "strokeCount": 1,
        "pointCount": len(points),
    })
    for candidate in candidates:
        if candidate.get("symbol") != "star" or not candidate.get("accepted"):
            continue
        try:
            confidence = float(candidate.get("confidence") or 0.0)
        except (TypeError, ValueError):
            confidence = 0.0
        if confidence >= 0.6:
            return True
    return False


def _cluster_has_loose_star_like_crossing(cluster: dict[str, Any]) -> bool:
    strokes = [stroke for stroke in cluster.get("strokes", []) if isinstance(stroke, dict)]
    if any(_single_stroke_has_star_like_shape(stroke) for stroke in strokes):
        return True
    if len(strokes) < 4:
        return False
    axes = [axis for stroke in strokes if (axis := _stroke_axis(_raw_stroke_points(stroke))) is not None]
    if len(axes) < 4 or len({axis[2] for axis in axes}) < 3:
        return False

    intersections: list[tuple[float, float]] = []
    for left_index, left in enumerate(axes):
        for right in axes[left_index + 1:]:
            if left[2] == right[2]:
                continue
            intersection = _segment_intersection_point(left[0], left[1], right[0], right[1])
            if intersection is not None:
                intersections.append(intersection)
    if len(intersections) < 3:
        return False

    best_close_count = 0
    for anchor in intersections:
        close_count = sum(1 for point in intersections if math.hypot(point[0] - anchor[0], point[1] - anchor[1]) <= 24)
        best_close_count = max(best_close_count, close_count)
    return best_close_count >= 3


def _near_star_anchor(cluster: dict[str, Any], star_bboxes: list[dict[str, float]]) -> bool:
    bbox = _cluster_bbox(cluster)
    if bbox is None:
        return False
    for star_bbox in star_bboxes:
        anchor_size = max(star_bbox["width"], star_bbox["height"], 32.0)
        proximity_limit = max(90.0, min(260.0, anchor_size * 2.6))
        if _bbox_gap(bbox, star_bbox) <= proximity_limit:
            return True
    return False


def _geometry_star_anchors(geometry: dict[str, Any]) -> tuple[set[str], list[dict[str, float]]]:
    cluster_ids: set[str] = set()
    bboxes: list[dict[str, float]] = []
    clusters = geometry.get("clusters") if isinstance(geometry.get("clusters"), list) else []
    for cluster in clusters:
        if not isinstance(cluster, dict) or not _cluster_has_star_or_star_like_candidate(cluster):
            continue
        cluster_id = _cluster_id(cluster)
        if cluster_id:
            cluster_ids.add(cluster_id)
        bbox = _cluster_bbox(cluster)
        if bbox is not None:
            bboxes.append(bbox)
    return cluster_ids, bboxes


def _geometry_has_star_anchor(geometry: dict[str, Any]) -> bool:
    if "star" in _cluster_symbols(geometry):
        return True
    star_cluster_ids, star_bboxes = _geometry_star_anchors(geometry)
    return bool(star_cluster_ids or star_bboxes)


def _vision_star_anchors(
    geometry: dict[str, Any],
    raw_clusters: list[dict[str, Any]],
) -> tuple[set[str], list[dict[str, float]]]:
    cluster_ids, bboxes = _geometry_star_anchors(geometry)
    for cluster in raw_clusters:
        if not isinstance(cluster, dict) or not _cluster_has_loose_star_like_crossing(cluster):
            continue
        cluster_id = _cluster_id(cluster)
        if cluster_id:
            cluster_ids.add(cluster_id)
        bbox = _cluster_bbox(cluster)
        if bbox is not None:
            bboxes.append(bbox)
    return cluster_ids, bboxes


def _has_vision_star_anchor(geometry: dict[str, Any], raw_clusters: list[dict[str, Any]]) -> bool:
    if _geometry_has_star_anchor(geometry):
        return True
    star_cluster_ids, star_bboxes = _vision_star_anchors(geometry, raw_clusters)
    return bool(star_cluster_ids or star_bboxes)


def _cluster_has_star_or_star_like_candidate(cluster: dict[str, Any]) -> bool:
    if "star" in _cluster_symbols(cluster):
        return True
    candidates = cluster.get("symbolCandidates")
    if not isinstance(candidates, list):
        return False
    for candidate in candidates:
        if not isinstance(candidate, dict) or candidate.get("symbol") != "star":
            continue
        try:
            confidence = float(candidate.get("confidence") or 0.0)
        except (TypeError, ValueError):
            confidence = 0.0
        if (
            not candidate.get("accepted")
            and confidence >= VISION_STAR_LIKE_CONFIDENCE_THRESHOLD
            and candidate.get("rejectionReason") == "text-like cluster"
        ):
            return True
    return False


def _cluster_has_keyword_anchor_shape(cluster: dict[str, Any]) -> bool:
    try:
        text_like_score = float(cluster.get("textLikeScore") or 0.0)
    except (TypeError, ValueError):
        text_like_score = 0.0
    cluster_kind = cluster.get("clusterKind")
    if cluster_kind == "symbol_like" and text_like_score < 0.55:
        return False
    return (
        _cluster_looks_text_like(cluster)
        or cluster_kind in {"text_like", "mixed"}
        or text_like_score >= 0.55
    )


def _cluster_has_loose_handwriting_shape(cluster: dict[str, Any]) -> bool:
    bbox = _cluster_bbox(cluster)
    if bbox is None:
        return False
    try:
        stroke_count = int(cluster.get("strokeCount") or 0)
        point_count = int(cluster.get("pointCount") or 0)
        text_like_score = float(cluster.get("textLikeScore") or 0.0)
    except (TypeError, ValueError):
        return False

    width = bbox["width"]
    height = bbox["height"]
    if point_count < 5 or width < 14 or height < 8:
        return False
    if stroke_count > 32 or max(width, height) > 520:
        return False
    if _cluster_has_keyword_anchor_shape(cluster):
        return True

    cluster_kind = cluster.get("clusterKind")
    if cluster_kind == "symbol_like" and text_like_score < 0.18:
        return False
    if point_count >= 8 and width >= 20 and height >= 10:
        return True
    if stroke_count >= 2 and point_count >= 6 and max(width, height) >= 18:
        return True
    return False


def _star_cluster_has_attached_handwriting_shape(cluster: dict[str, Any]) -> bool:
    if _cluster_has_keyword_anchor_shape(cluster):
        return True
    bbox = _cluster_bbox(cluster)
    if bbox is None:
        return False
    try:
        stroke_count = int(cluster.get("strokeCount") or 0)
        point_count = int(cluster.get("pointCount") or 0)
        text_like_score = float(cluster.get("textLikeScore") or 0.0)
    except (TypeError, ValueError):
        return False
    width = max(1.0, bbox["width"])
    height = max(1.0, bbox["height"])
    aspect = max(width, height) / max(1.0, min(width, height))
    cluster_kind = cluster.get("clusterKind")
    if cluster_kind == "symbol_like" and aspect <= 1.35 and stroke_count <= 5 and text_like_score < 0.35:
        return False
    return (
        point_count >= 8
        and max(width, height) >= 24
        and (text_like_score >= 0.35 or stroke_count >= 6 or aspect >= 1.45)
    )


def _vision_candidate_clusters_for_star_page(
    geometry: dict[str, Any],
    raw_clusters: list[dict[str, Any]],
    *,
    force: bool,
) -> list[dict[str, Any]]:
    star_cluster_ids, star_bboxes = _vision_star_anchors(geometry, raw_clusters)
    if not (star_cluster_ids or star_bboxes):
        return []

    candidates: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    for cluster in raw_clusters:
        if not isinstance(cluster, dict):
            continue
        cluster_id = _cluster_id(cluster)
        is_star_cluster = bool(cluster_id and cluster_id in star_cluster_ids)
        is_handwriting_like = _cluster_has_loose_handwriting_shape(cluster)
        if is_handwriting_like and not is_star_cluster:
            candidates.append(cluster)
            if cluster_id:
                seen_ids.add(cluster_id)

    # If a star and a short label were merged into one cluster, keep that cluster.
    for cluster in raw_clusters:
        cluster_id = _cluster_id(cluster)
        if not cluster_id or cluster_id in seen_ids or cluster_id not in star_cluster_ids:
            continue
        if _star_cluster_has_attached_handwriting_shape(cluster):
            candidates.append(cluster)
            seen_ids.add(cluster_id)
    return candidates


def _needs_vision_fallback(geometry: dict[str, Any], raw_clusters: list[dict[str, Any]], *, force: bool) -> bool:
    if not _has_vision_star_anchor(geometry, raw_clusters):
        return False
    if force:
        return True
    confidence = _recognition_confidence(geometry)
    keywords = geometry.get("keywords") if isinstance(geometry.get("keywords"), list) else []
    symbols = geometry.get("symbols") if isinstance(geometry.get("symbols"), list) else []
    if confidence < 0.65 and raw_clusters:
        return True
    if symbols and confidence < 0.78:
        return True
    if not keywords and _vision_candidate_clusters_for_star_page(geometry, raw_clusters, force=force):
        return True
    return False


def _normalize_vision_result(value: dict[str, Any]) -> dict[str, Any] | None:
    if value.get("status") != "ready":
        return None
    confidence = _recognition_confidence(value)
    if confidence < 0.50:
        return None
    text = str(value.get("text") or "")
    raw_keywords = [keyword for keyword in value.get("keywords", []) if isinstance(keyword, str)] if isinstance(value.get("keywords"), list) else []
    raw_symbols = [symbol for symbol in value.get("symbols", []) if isinstance(symbol, str)] if isinstance(value.get("symbols"), list) else []
    return {
        "text": text,
        "keywords": normalize_korean_study_keywords(text, raw_keywords),
        "symbols": [symbol for symbol in dict.fromkeys(raw_symbols) if symbol in {"star", "check", "circle", "box", "underline", "bracket", "arrow", "exclamation"}],
        "confidence": confidence,
        "sourceCluster": value.get("_sourceCluster") if isinstance(value.get("_sourceCluster"), dict) else None,
    }


def _merge_geometry_and_vision_recognition(
    geometry: dict[str, Any],
    vision_results: list[dict[str, Any]],
) -> dict[str, Any]:
    accepted = [result for result in (_normalize_vision_result(value) for value in vision_results) if result is not None]
    if not accepted:
        return geometry

    merged = dict(geometry)
    geometry_keywords = [keyword for keyword in geometry.get("keywords", []) if isinstance(keyword, str)] if isinstance(geometry.get("keywords"), list) else []
    geometry_symbols = [symbol for symbol in geometry.get("symbols", []) if isinstance(symbol, str)] if isinstance(geometry.get("symbols"), list) else []
    vision_text = " ".join(result["text"] for result in accepted if result.get("text")).strip()
    vision_keywords = [keyword for result in accepted for keyword in result.get("keywords", [])]
    vision_symbols = [symbol for result in accepted for symbol in result.get("symbols", [])]
    merged["engine"] = "hybrid" if geometry.get("engine") == "geometry" else "openai-vision"
    merged["status"] = "ready"
    merged["text"] = " ".join(value for value in [str(geometry.get("text") or "").strip(), vision_text] if value).strip()
    merged["keywords"] = list(dict.fromkeys([*geometry_keywords, *vision_keywords]))
    merged["symbols"] = list(dict.fromkeys([*geometry_symbols, *vision_symbols]))
    merged["confidence"] = max(
        _recognition_confidence(geometry),
        max((result["confidence"] for result in accepted), default=0.0),
    )
    merged["strokeHash"] = geometry.get("strokeHash")
    clusters = merged.get("clusters") if isinstance(merged.get("clusters"), list) else []
    merged["clusters"] = clusters + [
        {
            "id": f"vision-{result['sourceCluster'].get('id')}" if isinstance(result.get("sourceCluster"), dict) and result["sourceCluster"].get("id") else f"vision-{index + 1}",
            "pageNumber": (
                result["sourceCluster"].get("pageNumber")
                if isinstance(result.get("sourceCluster"), dict) and result["sourceCluster"].get("pageNumber")
                else clusters[0].get("pageNumber", 1) if clusters and isinstance(clusters[0], dict) else 1
            ),
            "bbox": (
                result["sourceCluster"].get("bbox")
                if isinstance(result.get("sourceCluster"), dict) and isinstance(result["sourceCluster"].get("bbox"), dict)
                else {"x": 0, "y": 0, "width": 0, "height": 0}
            ),
            "text": result["text"],
            "candidates": [{"text": result["text"], "confidence": result["confidence"]}] if result["text"] else [],
            "keywords": result["keywords"],
            "symbols": result["symbols"],
            "confidence": result["confidence"],
            "source": "openai-vision",
        }
        for index, result in enumerate(accepted)
        if result.get("text") or result.get("keywords") or result.get("symbols")
    ]
    return merged


def _add_handwriting_metadata(
    recognition: dict[str, Any],
    *,
    vision_used: bool,
    vision_skipped_reason: str | None,
    analyzed_cluster_count: int,
    vision_analyzed_cluster_count: int,
    cached: bool = False,
    stale: bool = False,
) -> dict[str, Any]:
    next_recognition = dict(recognition)
    next_recognition["visionFallbackUsed"] = bool(vision_used)
    if vision_skipped_reason:
        next_recognition["visionFallbackSkippedReason"] = vision_skipped_reason
    else:
        next_recognition.pop("visionFallbackSkippedReason", None)
    next_recognition["analyzedClusterCount"] = max(0, int(analyzed_cluster_count))
    next_recognition["visionAnalyzedClusterCount"] = max(0, int(vision_analyzed_cluster_count))
    next_recognition["cached"] = bool(cached)
    next_recognition["stale"] = bool(stale)
    return next_recognition


def _apply_vision_fallback_if_needed(
    geometry: dict[str, Any],
    raw_clusters: list[dict[str, Any]],
    *,
    force: bool,
    use_vision_fallback: bool,
    vision_allowed: bool = True,
    vision_skip_reason: str | None = None,
) -> dict[str, Any]:
    analyzed_cluster_count = len(raw_clusters)
    if not use_vision_fallback:
        return _add_handwriting_metadata(
            geometry,
            vision_used=False,
            vision_skipped_reason="not-requested",
            analyzed_cluster_count=analyzed_cluster_count,
            vision_analyzed_cluster_count=0,
        )
    if not vision_allowed:
        return _add_handwriting_metadata(
            geometry,
            vision_used=False,
            vision_skipped_reason=vision_skip_reason or "page-limit",
            analyzed_cluster_count=analyzed_cluster_count,
            vision_analyzed_cluster_count=0,
        )
    if not vision_fallback_enabled():
        return _add_handwriting_metadata(
            geometry,
            vision_used=False,
            vision_skipped_reason="disabled",
            analyzed_cluster_count=analyzed_cluster_count,
            vision_analyzed_cluster_count=0,
        )
    if not vision_api_key_available():
        return _add_handwriting_metadata(
            geometry,
            vision_used=False,
            vision_skipped_reason="missing-api-key",
            analyzed_cluster_count=analyzed_cluster_count,
            vision_analyzed_cluster_count=0,
        )
    if not _has_vision_star_anchor(geometry, raw_clusters):
        return _add_handwriting_metadata(
            geometry,
            vision_used=False,
            vision_skipped_reason="no-star-anchor",
            analyzed_cluster_count=analyzed_cluster_count,
            vision_analyzed_cluster_count=0,
        )
    if not _needs_vision_fallback(geometry, raw_clusters, force=force):
        return _add_handwriting_metadata(
            geometry,
            vision_used=False,
            vision_skipped_reason="not-needed",
            analyzed_cluster_count=analyzed_cluster_count,
            vision_analyzed_cluster_count=0,
        )

    vision_results: list[dict[str, Any]] = []
    min_strokes = vision_min_cluster_strokes()
    max_clusters = vision_max_clusters_per_page()
    candidate_clusters = [
        cluster
        for cluster in _vision_candidate_clusters_for_star_page(geometry, raw_clusters, force=force)
        if int(cluster.get("strokeCount") or 0) >= min_strokes
    ]
    if not candidate_clusters:
        return _add_handwriting_metadata(
            geometry,
            vision_used=False,
            vision_skipped_reason="no-star-text-anchor",
            analyzed_cluster_count=analyzed_cluster_count,
            vision_analyzed_cluster_count=0,
        )
    limited_clusters = candidate_clusters[:max_clusters] if max_clusters > 0 else []
    if not limited_clusters:
        return _add_handwriting_metadata(
            geometry,
            vision_used=False,
            vision_skipped_reason="cluster-limit",
            analyzed_cluster_count=analyzed_cluster_count,
            vision_analyzed_cluster_count=0,
        )
    for cluster in limited_clusters:
        image_bytes = render_ink_cluster_to_png(cluster)
        if not image_bytes:
            continue
        vision_result = analyze_handwriting_image_with_openai(image_bytes, stroke_hash=str(geometry.get("strokeHash") or ""))
        vision_result["_sourceCluster"] = cluster
        vision_results.append(vision_result)
    merged = _merge_geometry_and_vision_recognition(geometry, vision_results)
    ready_results = [result for result in vision_results if result.get("status") == "ready"]
    if not vision_results:
        skipped_reason = "no-renderable-clusters"
    elif not ready_results:
        skipped_reason = "unavailable" if any(result.get("status") == "unavailable" for result in vision_results) else "failed"
    elif len(candidate_clusters) > len(limited_clusters):
        skipped_reason = "cluster-limit"
    else:
        skipped_reason = None
    return _add_handwriting_metadata(
        merged,
        vision_used=bool(ready_results),
        vision_skipped_reason=skipped_reason,
        analyzed_cluster_count=analyzed_cluster_count,
        vision_analyzed_cluster_count=len(vision_results),
        cached=bool(vision_results) and all(bool(result.get("cached")) for result in vision_results),
    )


def _consume_note_vision_budget(use_vision_fallback: bool, used_pages: int) -> tuple[bool, str | None, int]:
    if not use_vision_fallback:
        return True, None, used_pages
    max_pages = vision_max_pages_per_note()
    if max_pages <= 0 or used_pages >= max_pages:
        return False, "page-limit", used_pages
    return True, None, used_pages + 1


def _vision_page_limit_allows(use_vision_fallback: bool, used_pages: int) -> tuple[bool, str | None]:
    if not use_vision_fallback:
        return True, None
    max_pages = vision_max_pages_per_note()
    if max_pages <= 0 or used_pages >= max_pages:
        return False, "page-limit"
    return True, None


def _vision_analyzed_cluster_count(content: str | None) -> int:
    state = parse_page_state(content)
    if not state:
        return 0
    recognition = state.get("handwritingRecognition")
    if not isinstance(recognition, dict):
        return 0
    try:
        return max(0, int(recognition.get("visionAnalyzedClusterCount") or 0))
    except (TypeError, ValueError):
        return 0


def _can_skip_existing_handwriting_recognition(
    current_recognition: Any,
    stroke_hash: str,
    *,
    force: bool,
    use_vision_fallback: bool,
) -> bool:
    if force or not isinstance(current_recognition, dict) or current_recognition.get("strokeHash") != stroke_hash:
        return False
    if not use_vision_fallback:
        return True
    if current_recognition.get("visionFallbackUsed") is True:
        return True
    retryable_skip_reasons = {None, "", "not-requested", "disabled", "missing-api-key", "unavailable", "failed"}
    return current_recognition.get("visionFallbackSkippedReason") not in retryable_skip_reasons


def _analyze_page_handwriting_content(
    content: str | None,
    *,
    force: bool = False,
    use_vision_fallback: bool = False,
    vision_allowed: bool = True,
    vision_skip_reason: str | None = None,
) -> tuple[str | None, str]:
    state = parse_page_state(content)
    if state is None:
        return None, "failed"

    ink_strokes = extract_page_ink_strokes(state)
    stroke_hash = stable_stroke_hash(ink_strokes)
    current_recognition = state.get("handwritingRecognition")
    if _can_skip_existing_handwriting_recognition(
        current_recognition,
        stroke_hash,
        force=force,
        use_vision_fallback=use_vision_fallback,
    ):
        return content, "skipped"

    try:
        recognition = build_handwriting_recognition_from_geometry(state)
        # Preserve on-device ML Kit / classifier keywords for the same strokes so the
        # geometry rebuild does not clobber them. The merged confidence then lets the
        # Vision step skip pages already covered by on-device recognition.
        if (
            isinstance(current_recognition, dict)
            and current_recognition.get("strokeHash") == stroke_hash
            and current_recognition.get("engine") != "geometry"
        ):
            recognition = merge_handwriting_recognition_results(
                current_recognition,
                recognition,
                stroke_hash,
            )
        recognition = _apply_vision_fallback_if_needed(
            recognition,
            cluster_ink_strokes(ink_strokes),
            force=force,
            use_vision_fallback=use_vision_fallback,
            vision_allowed=vision_allowed,
            vision_skip_reason=vision_skip_reason,
        )
    except Exception:
        recognition = _failed_handwriting_recognition(stroke_hash)
        return merge_handwriting_recognition(content, recognition), "failed"

    return merge_handwriting_recognition(content, recognition), "analyzed"


def _upload_relative_path(url: str | None) -> str | None:
    if not url:
        return None

    path = urlparse(url).path
    if not path.startswith("/uploads/"):
        return None
    return unquote(path.removeprefix("/uploads/"))


def _delete_upload_file(settings: Settings, relative_path: str | None) -> None:
    if not relative_path:
        return

    upload_root = settings.upload_path.resolve()
    target = (upload_root / relative_path).resolve()
    if upload_root not in target.parents:
        return

    try:
        target.unlink(missing_ok=True)
    except OSError as exc:
        logger.warning("failed to delete upload file %s: %s", target, exc)


def _cleanup_note_upload_files(note: dict, settings: Settings) -> None:
    file_relative_path = _upload_relative_path(note.get("file_url"))
    thumbnail_relative_path = _upload_relative_path(note.get("thumbnail_url"))

    _delete_upload_file(settings, file_relative_path)
    _delete_upload_file(settings, thumbnail_relative_path)

    if file_relative_path and file_relative_path.lower().endswith(".pdf"):
        thumbnail_name = f"{Path(file_relative_path).stem}.png"
        _delete_upload_file(settings, f"pdf-thumbnails/{thumbnail_name}")


@router.post("/notes", response_model=NoteRead)
def create_note(
    payload: NoteCreate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    require_row(
        fetch_one(connection, "SELECT id FROM folders WHERE id = %s AND user_id = %s", (payload.folder_id, current_user["id"])),
        "folder not found",
    )
    return execute_returning(
        connection,
        """
        INSERT INTO notes (user_id, folder_id, title, summary)
        VALUES (%s, %s, %s, %s)
        RETURNING id, folder_id, title, summary, file_url, thumbnail_url, page_count, created_at, updated_at
        """,
        (current_user["id"], payload.folder_id, payload.title, payload.summary),
    )


@router.get("/notes", response_model=list[NoteRead])
def list_notes(
    folder_id: int | None = Query(default=None),
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    if folder_id is None:
        return fetch_all(
            connection,
            """
            SELECT id, folder_id, title, summary, file_url, thumbnail_url, page_count, created_at, updated_at
            FROM notes
            WHERE user_id = %s
            ORDER BY updated_at DESC, id DESC
            """,
            (current_user["id"],),
        )

    return fetch_all(
        connection,
        """
        SELECT id, folder_id, title, summary, file_url, thumbnail_url, page_count, created_at, updated_at
        FROM notes
        WHERE folder_id = %s AND user_id = %s
        ORDER BY updated_at DESC, id DESC
        """,
        (folder_id, current_user["id"]),
    )


@router.get("/notes/{note_id}", response_model=NoteRead)
def get_note(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    return get_note_for_user(note_id, current_user["id"], connection)


@router.get("/notes/{note_id}/rag-status", response_model=NoteRagStatusRead)
def get_note_rag_status(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    rag_job = fetch_one(
        connection,
        """
        SELECT text_status, image_status, overall_status, page_count, processed_page_count,
               total_batches, completed_batches, text_chunk_count, image_candidate_count,
               image_completed_count, image_indexed_count, last_error, started_at,
               text_ready_at, image_ready_at, updated_at
        FROM note_rag_jobs
        WHERE user_id = %s AND note_id = %s
        """,
        (current_user["id"], note_id),
    )
    chunk_row = fetch_one(
        connection,
        """
        SELECT COUNT(*) AS count
        FROM document_chunks
        WHERE user_id = %s
          AND note_id = %s
          AND source_type <> 'canvas_note'
        """,
        (current_user["id"], note_id),
    )
    image_count_row = fetch_one(
        connection,
        """
        SELECT COUNT(*) AS candidate_count,
               COUNT(*) FILTER (WHERE status IN ('completed', 'failed', 'skipped')) AS processed_count,
               COUNT(*) FILTER (WHERE status = 'completed') AS completed_count,
               COUNT(*) FILTER (WHERE indexed = true) AS indexed_count
        FROM image_ai_summaries
        WHERE user_id = %s
          AND note_id = %s
        """,
        (current_user["id"], note_id),
    ) or {}
    cached_visual_candidate_count = _count_cached_docling_visual_candidates(
        connection,
        note_id=note_id,
        user_id=current_user["id"],
    )
    image_candidate_count = max(
        int(image_count_row.get("candidate_count") or 0),
        cached_visual_candidate_count,
    )
    image_error_row = fetch_one(
        connection,
        """
        SELECT skipped_reason
        FROM image_ai_summaries
        WHERE user_id = %s
          AND note_id = %s
          AND status = 'failed'
          AND skipped_reason IS NOT NULL
        ORDER BY updated_at DESC NULLS LAST, id DESC
        LIMIT 1
        """,
        (current_user["id"], note_id),
    )
    return {
        "rag_job": (
            {
                "text_status": rag_job.get("text_status"),
                "image_status": rag_job.get("image_status"),
                "overall_status": rag_job.get("overall_status"),
                "page_count": int(rag_job.get("page_count") or 0),
                "processed_page_count": int(rag_job.get("processed_page_count") or 0),
                "total_batches": int(rag_job.get("total_batches") or 0),
                "completed_batches": int(rag_job.get("completed_batches") or 0),
                "text_chunk_count": int(rag_job.get("text_chunk_count") or 0),
                "image_candidate_count": image_candidate_count,
                "image_processed_count": int(image_count_row.get("processed_count") or 0),
                "image_completed_count": int(image_count_row.get("completed_count") or 0),
                "image_indexed_count": int(image_count_row.get("indexed_count") or 0),
                "last_error": rag_job.get("last_error"),
                "started_at": rag_job.get("started_at"),
                "text_ready_at": rag_job.get("text_ready_at"),
                "image_ready_at": rag_job.get("image_ready_at"),
                "updated_at": rag_job.get("updated_at"),
            }
            if rag_job
            else None
        ),
        "current_note_chunk_count": int(chunk_row["count"]) if chunk_row else 0,
        "image_summary_error": image_error_row.get("skipped_reason") if image_error_row else None,
    }


@router.patch("/notes/{note_id}", response_model=NoteRead)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    current = get_note_for_user(note_id, current_user["id"], connection)
    next_folder_id = payload.folder_id if payload.folder_id is not None else current["folder_id"]
    require_row(
        fetch_one(connection, "SELECT id FROM folders WHERE id = %s AND user_id = %s", (next_folder_id, current_user["id"])),
        "folder not found",
    )
    try:
        updated = require_row(
            fetch_one(
                connection,
                """
                UPDATE notes
                SET folder_id = %s, title = %s, summary = %s, updated_at = now()
                WHERE id = %s AND user_id = %s
                RETURNING id, folder_id, title, summary, file_url, thumbnail_url, page_count, created_at, updated_at
                """,
                (
                    next_folder_id,
                    payload.title if payload.title is not None else current["title"],
                    payload.summary if payload.summary is not None else current["summary"],
                    note_id,
                    current_user["id"],
                ),
            )
        )
        sync_note_rag_metadata(connection, note_id=note_id, user_id=current_user["id"], commit=False)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return updated


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
    settings: Settings = Depends(get_settings),
    current_user: dict = Depends(get_current_user),
):
    note = get_note_for_user(note_id, current_user["id"], connection)
    execute_commit(connection, "DELETE FROM notes WHERE id = %s AND user_id = %s", (note_id, current_user["id"]))
    _cleanup_note_upload_files(note, settings)


@router.post("/notes/{note_id}/pages", response_model=NotePageRead)
def create_note_page(
    note_id: int,
    payload: NotePageCreate,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    created = execute_returning(
        connection,
        """
        INSERT INTO note_pages (note_id, page_number, content, image_url)
        VALUES (%s, %s, %s, %s)
        RETURNING id, note_id, page_number, content, image_url, created_at, updated_at
        """,
        (note_id, payload.page_number, payload.content, payload.image_url),
    )
    _schedule_note_page_reindex(background_tasks, int(created["id"]), current_user["id"])
    return created


@router.get("/notes/{note_id}/pages", response_model=list[NotePageRead])
def list_note_pages(
    note_id: int,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    return _list_pages_for_note(connection, note_id)


@router.post("/notes/{note_id}/pages/{page_number}/duplicate", response_model=list[NotePageRead])
def duplicate_note_page(
    note_id: int,
    page_number: int,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    target = require_row(
        fetch_one(
            connection,
            """
            SELECT id, note_id, page_number, content, image_url
            FROM note_pages
            WHERE note_id = %s AND page_number = %s
            ORDER BY id ASC
            LIMIT 1
            """,
            (note_id, page_number),
        ),
        "note page not found",
    )

    try:
        with connection.cursor() as cursor:
            _shift_image_summaries_after_page(cursor, note_id=note_id, page_number=page_number, delta=1, user_id=current_user["id"])
            _duplicate_image_summaries_for_page(cursor, note_id=note_id, page_number=page_number, user_id=current_user["id"])
            cursor.execute(
                """
                UPDATE note_pages
                SET page_number = page_number + 1, updated_at = now()
                WHERE note_id = %s AND page_number > %s
                """,
                (note_id, page_number),
            )
            cursor.execute(
                """
                INSERT INTO note_pages (note_id, page_number, content, image_url)
                VALUES (%s, %s, %s, %s)
                """,
                (note_id, page_number + 1, target["content"], target["image_url"]),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise

    _schedule_note_page_structure_reindex(background_tasks, note_id, current_user["id"])
    return _list_pages_for_note(connection, note_id)


@router.delete("/notes/{note_id}/pages/by-number/{page_number}", response_model=list[NotePageRead])
def delete_note_page_by_number(
    note_id: int,
    page_number: int,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    pages = _list_pages_for_note(connection, note_id)
    if len(pages) <= 1:
        raise HTTPException(status_code=400, detail="마지막 페이지는 삭제할 수 없어요.")
    target = require_row(
        next((page for page in pages if int(page["page_number"]) == page_number), None),
        "note page not found",
    )

    try:
        with connection.cursor() as cursor:
            _delete_image_summaries_for_page(cursor, note_id=note_id, page_number=page_number, user_id=current_user["id"])
            _shift_image_summaries_after_page(cursor, note_id=note_id, page_number=page_number, delta=-1, user_id=current_user["id"])
            cursor.execute("DELETE FROM note_pages WHERE id = %s", (target["id"],))
            cursor.execute(
                """
                UPDATE note_pages
                SET page_number = page_number - 1, updated_at = now()
                WHERE note_id = %s AND page_number > %s
                """,
                (note_id, page_number),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise

    _schedule_note_page_structure_reindex(background_tasks, note_id, current_user["id"])
    return _list_pages_for_note(connection, note_id)


@router.post("/notes/{note_id}/pages/{page_number}/move", response_model=list[NotePageRead])
def move_note_page_by_number(
    note_id: int,
    page_number: int,
    background_tasks: BackgroundTasks,
    delta: int = Query(..., ge=-1, le=1),
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    if delta == 0:
        return _list_pages_for_note(connection, note_id)

    pages = _list_pages_for_note(connection, note_id)
    target = require_row(
        next((page for page in pages if int(page["page_number"]) == page_number), None),
        "note page not found",
    )
    next_page_number = page_number + delta
    swap_target = require_row(
        next((page for page in pages if int(page["page_number"]) == next_page_number), None),
        "target page not found",
    )

    try:
        with connection.cursor() as cursor:
            _swap_image_summary_pages(
                cursor,
                note_id=note_id,
                page_number=page_number,
                next_page_number=next_page_number,
                user_id=current_user["id"],
            )
            cursor.execute("UPDATE note_pages SET page_number = -1 WHERE id = %s", (target["id"],))
            cursor.execute(
                "UPDATE note_pages SET page_number = %s, updated_at = now() WHERE id = %s",
                (page_number, swap_target["id"]),
            )
            cursor.execute(
                "UPDATE note_pages SET page_number = %s, updated_at = now() WHERE id = %s",
                (next_page_number, target["id"]),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise

    _schedule_note_page_structure_reindex(background_tasks, note_id, current_user["id"])
    return _list_pages_for_note(connection, note_id)

@router.post("/note-pages/{page_id}/analyze-handwriting", response_model=NotePageRead)
def analyze_note_page_handwriting(
    page_id: int,
    force: bool = Query(default=False),
    use_vision_fallback: bool = Query(default=False),
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    current = _get_note_page_for_user(page_id, current_user["id"], connection)
    next_content, status = _analyze_page_handwriting_content(
        current["content"],
        force=force,
        use_vision_fallback=use_vision_fallback,
    )
    if status == "skipped" or next_content is None or next_content == current["content"]:
        return current

    return execute_returning(
        connection,
        """
        UPDATE note_pages
        SET content = %s, updated_at = now()
        WHERE id = %s
        RETURNING id, note_id, page_number, content, image_url, created_at, updated_at
        """,
        (next_content, page_id),
    )


@router.post("/note-pages/{page_id}/handwriting-recognition", response_model=NotePageRead)
def save_note_page_handwriting_recognition(
    page_id: int,
    payload: HandwritingRecognitionWrite,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    current = _get_note_page_for_user(page_id, current_user["id"], connection)
    state = parse_page_state(current["content"])
    if state is None:
        raise HTTPException(status_code=400, detail="bsnap page state is required")

    ink_strokes = extract_page_ink_strokes(state)
    current_stroke_hash = stable_stroke_hash(ink_strokes)
    if payload.stroke_hash and payload.stroke_hash != current_stroke_hash:
        raise HTTPException(status_code=409, detail="stale handwriting recognition result")

    incoming = payload.model_dump(mode="python")
    incoming["strokeHash"] = current_stroke_hash
    merged_recognition = merge_handwriting_recognition_results(
        state.get("handwritingRecognition") if isinstance(state.get("handwritingRecognition"), dict) else None,
        incoming,
        current_stroke_hash,
    )
    next_content = merge_handwriting_recognition(current["content"], merged_recognition)

    return execute_returning(
        connection,
        """
        UPDATE note_pages
        SET content = %s, updated_at = now()
        WHERE id = %s
        RETURNING id, note_id, page_number, content, image_url, created_at, updated_at
        """,
        (next_content, page_id),
    )


@router.post("/notes/{note_id}/analyze-handwriting", response_model=HandwritingAnalysisRead)
def analyze_note_handwriting(
    note_id: int,
    force: bool = Query(default=False),
    use_vision_fallback: bool = Query(default=False),
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    get_note_for_user(note_id, current_user["id"], connection)
    pages = _list_pages_for_note(connection, note_id)
    summary = {
        "note_id": note_id,
        "pages_analyzed": 0,
        "pages_skipped": 0,
        "pages_failed": 0,
    }
    vision_pages_used = 0

    for page in pages:
        vision_allowed, vision_skip_reason = _vision_page_limit_allows(
            use_vision_fallback,
            vision_pages_used,
        )
        next_content, status = _analyze_page_handwriting_content(
            page["content"],
            force=force,
            use_vision_fallback=use_vision_fallback,
            vision_allowed=vision_allowed,
            vision_skip_reason=vision_skip_reason,
        )
        if use_vision_fallback and vision_allowed and _vision_analyzed_cluster_count(next_content) > 0:
            vision_pages_used += 1
        if status == "skipped":
            summary["pages_skipped"] += 1
            continue
        if next_content is None:
            summary["pages_failed"] += 1
            continue

        try:
            execute_returning(
                connection,
                """
                UPDATE note_pages
                SET content = %s, updated_at = now()
                WHERE id = %s
                RETURNING id, note_id, page_number, content, image_url, created_at, updated_at
                """,
                (next_content, page["id"]),
            )
        except Exception:
            summary["pages_failed"] += 1
            continue

        if status == "failed":
            summary["pages_failed"] += 1
        else:
            summary["pages_analyzed"] += 1

    return summary


@router.patch("/note-pages/{page_id}", response_model=NotePageRead)
def update_note_page(
    page_id: int,
    payload: NotePageUpdate,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    current = require_row(
        fetch_one(
            connection,
            """
            SELECT p.id, p.note_id, p.page_number, p.content, p.image_url, p.created_at, p.updated_at
            FROM note_pages p
            JOIN notes n ON n.id = p.note_id
            WHERE p.id = %s AND n.user_id = %s
            """,
            (page_id, current_user["id"]),
        ),
        "note page not found",
    )
    updated = execute_returning(
        connection,
        """
        UPDATE note_pages
        SET page_number = %s, content = %s, image_url = %s, updated_at = now()
        WHERE id = %s
        RETURNING id, note_id, page_number, content, image_url, created_at, updated_at
        """,
        (
            payload.page_number if payload.page_number is not None else current["page_number"],
            merge_page_state_content(current["content"], payload.content)
            if payload.content is not None
            else current["content"],
            payload.image_url if payload.image_url is not None else current["image_url"],
            page_id,
        ),
    )
    _schedule_note_page_reindex(background_tasks, int(updated["id"]), current_user["id"])
    return updated


@router.delete("/note-pages/{page_id}", status_code=204)
def delete_note_page(
    page_id: int,
    background_tasks: BackgroundTasks,
    connection: Connection = Depends(get_db_connection),
    current_user: dict = Depends(get_current_user),
):
    current = require_row(
        fetch_one(
            connection,
            """
            SELECT p.id, p.note_id, p.page_number
            FROM note_pages p
            JOIN notes n ON n.id = p.note_id
            WHERE p.id = %s AND n.user_id = %s
            """,
            (page_id, current_user["id"]),
        ),
        "note page not found",
    )
    try:
        with connection.cursor() as cursor:
            _delete_image_summaries_for_page(
                cursor,
                note_id=int(current["note_id"]),
                page_number=int(current["page_number"]),
                user_id=current_user["id"],
            )
            cursor.execute("DELETE FROM note_pages WHERE id = %s", (page_id,))
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    _schedule_note_page_chunk_delete(background_tasks, page_id, current_user["id"])
