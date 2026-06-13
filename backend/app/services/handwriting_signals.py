import hashlib
import json
import math
import re
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Any


CANONICAL_STUDY_KEYWORDS = (
    "중요",
    "시험",
    "중간",
    "기말",
    "퀴즈",
    "암기",
    "필수",
    "공식",
    "주의",
    "체크",
    "별표",
    "복습",
    "정리",
)

KEYWORD_VARIANTS: dict[str, str] = {
    "시험범위": "시험",
    "시혐": "시험",
    "시헙": "시험",
    "시엄": "시험",
    "시함": "시험",
    "시염": "시험",
    "기말고사": "기말",
    "기맣": "기말",
    "기마": "기말",
    "가말": "기말",
    "거말": "기말",
    "기발": "기말",
    "중간고사": "중간",
    "중칸": "중간",
    "중긴": "중간",
    "증간": "중간",
    "중요함": "중요",
    "중요표시": "중요",
    "중오": "중요",
    "즁요": "중요",
    "증요": "중요",
    "종요": "중요",
    "중여": "중요",
    "쥬요": "중요",
    "외우기": "암기",
    "외워": "암기",
    "외우": "암기",
    "암가": "암기",
    "암키": "암기",
    "임기": "암기",
    "암끼": "암기",
    "암기할것": "암기",
    "필쑤": "필수",
    "필슈": "필수",
    "나옴": "시험",
    "나온다": "시험",
    "나올듯": "시험",
    "출제": "시험",
    "출제예상": "시험",
    "별": "별표",
    "별표시": "별표",
    "check": "체크",
}

SYMBOL_NAMES = {"star", "check", "circle", "box", "underline", "bracket", "arrow", "exclamation"}
STRONG_STUDY_KEYWORDS = {"중요", "시험", "기말", "중간", "암기", "필수"}

_HANGUL_BASE = 0xAC00
_HANGUL_END = 0xD7A3
_HANGUL_MEDIAL_COUNT = 21
_HANGUL_FINAL_COUNT = 28
_SIMILAR_MEDIALS = (
    {8, 12},  # ㅗ/ㅛ
    {13, 17},  # ㅜ/ㅠ
    {4, 6},  # ㅓ/ㅕ
    {0, 2},  # ㅏ/ㅑ
    {18, 19},  # ㅡ/ㅢ
)


def _round_number(value: Any, digits: int = 3) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return round(float(value), digits)
    return value


def _coerce_points(stroke: dict[str, Any]) -> list[dict[str, Any]]:
    points = stroke.get("points")
    if not isinstance(points, list):
        return []
    return [point for point in points if isinstance(point, dict)]


def _point_page_number(point: dict[str, Any]) -> int | None:
    try:
        page_number = point.get("pageNumber")
        return int(page_number) if page_number is not None else None
    except (TypeError, ValueError):
        return None


def _stroke_page_number(stroke: dict[str, Any]) -> int | None:
    try:
        page_number = stroke.get("pageNumber")
        if page_number is not None:
            return int(page_number)
    except (TypeError, ValueError):
        return None
    for point in _coerce_points(stroke):
        page_number = _point_page_number(point)
        if page_number is not None:
            return page_number
    return None


def stable_stroke_hash(ink_strokes: list[dict[str, Any]]) -> str:
    normalized_strokes: list[dict[str, Any]] = []
    for stroke in ink_strokes:
        if not isinstance(stroke, dict):
            continue
        normalized_strokes.append({
            "style": stroke.get("style"),
            "brush": stroke.get("brush"),
            "shape": stroke.get("shape"),
            "width": _round_number(stroke.get("width")),
            "color": stroke.get("color"),
            "pageNumber": stroke.get("pageNumber"),
            "pageWidth": _round_number(stroke.get("pageWidth")),
            "pageHeight": _round_number(stroke.get("pageHeight")),
            "generatedPageId": stroke.get("generatedPageId"),
            "points": [
                {
                    "x": _round_number(point.get("x")),
                    "y": _round_number(point.get("y")),
                    "t": _round_number(point.get("t"), 1) if point.get("t") is not None else None,
                    "pageNumber": point.get("pageNumber"),
                    "pageWidth": _round_number(point.get("pageWidth")),
                    "pageHeight": _round_number(point.get("pageHeight")),
                }
                for point in _coerce_points(stroke)
            ],
        })
    payload = json.dumps(normalized_strokes, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def extract_page_ink_strokes(page_state: dict[str, Any], page_number: int | None = None) -> list[dict[str, Any]]:
    ink_strokes = page_state.get("inkStrokes")
    if not isinstance(ink_strokes, list):
        return []
    if page_number is None:
        return [stroke for stroke in ink_strokes if isinstance(stroke, dict)]
    return [
        stroke
        for stroke in ink_strokes
        if isinstance(stroke, dict) and _stroke_page_number(stroke) == page_number
    ]


def _point_xy(point: dict[str, Any]) -> tuple[float, float] | None:
    try:
        return float(point["x"]), float(point["y"])
    except (KeyError, TypeError, ValueError):
        return None


def _stroke_points_xy(stroke: dict[str, Any]) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for point in _coerce_points(stroke):
        xy = _point_xy(point)
        if xy is not None:
            points.append(xy)
    return points


def _bbox_for_points(points: list[tuple[float, float]]) -> dict[str, float]:
    if not points:
        return {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    min_x = min(xs)
    min_y = min(ys)
    return {
        "x": min_x,
        "y": min_y,
        "width": max(xs) - min_x,
        "height": max(ys) - min_y,
    }


def _stroke_bbox(stroke: dict[str, Any]) -> dict[str, float]:
    return _bbox_for_points(_stroke_points_xy(stroke))


def _merge_bbox(left: dict[str, float], right: dict[str, float]) -> dict[str, float]:
    min_x = min(left["x"], right["x"])
    min_y = min(left["y"], right["y"])
    max_x = max(left["x"] + left["width"], right["x"] + right["width"])
    max_y = max(left["y"] + left["height"], right["y"] + right["height"])
    return {"x": min_x, "y": min_y, "width": max_x - min_x, "height": max_y - min_y}


def _bbox_distance(left: dict[str, float], right: dict[str, float]) -> float:
    left_right = left["x"] + left["width"]
    right_right = right["x"] + right["width"]
    left_bottom = left["y"] + left["height"]
    right_bottom = right["y"] + right["height"]
    dx = max(right["x"] - left_right, left["x"] - right_right, 0)
    dy = max(right["y"] - left_bottom, left["y"] - right_bottom, 0)
    return math.hypot(dx, dy)


def _stroke_time_range(stroke: dict[str, Any], fallback_index: int) -> tuple[float, float]:
    times = [
        float(point["t"])
        for point in _coerce_points(stroke)
        if isinstance(point.get("t"), (int, float)) and math.isfinite(float(point["t"]))
    ]
    if times:
        return min(times), max(times)
    return float(fallback_index * 10000), float(fallback_index * 10000)


def _style_summary(strokes: list[dict[str, Any]]) -> dict[str, int]:
    summary: dict[str, int] = {}
    for stroke in strokes:
        key = str(stroke.get("shape") or stroke.get("style") or stroke.get("brush") or "ink")
        summary[key] = summary.get(key, 0) + 1
    return summary


def cluster_ink_strokes(strokes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    prepared: list[dict[str, Any]] = []
    for index, stroke in enumerate(strokes):
        if not isinstance(stroke, dict):
            continue
        points = _stroke_points_xy(stroke)
        if not points:
            continue
        page_number = _stroke_page_number(stroke) or 1
        start_time, end_time = _stroke_time_range(stroke, index)
        prepared.append({
            "index": index,
            "stroke": stroke,
            "pageNumber": page_number,
            "bbox": _bbox_for_points(points),
            "pointCount": len(points),
            "startTime": start_time,
            "endTime": end_time,
        })

    prepared.sort(key=lambda item: (item["pageNumber"], item["startTime"], item["bbox"]["y"], item["bbox"]["x"]))
    clusters: list[dict[str, Any]] = []
    for item in prepared:
        target: dict[str, Any] | None = None
        for cluster in reversed(clusters):
            if cluster["pageNumber"] != item["pageNumber"]:
                continue
            distance = _bbox_distance(cluster["bbox"], item["bbox"])
            merged_width = max(cluster["bbox"]["width"], item["bbox"]["width"], 1.0)
            proximity_limit = max(38.0, min(140.0, merged_width * 0.9))
            time_gap = item["startTime"] - cluster["endTime"]
            temporally_close = time_gap <= 1800 or item["startTime"] >= 9000
            if distance <= proximity_limit and temporally_close:
                target = cluster
                break
        if target is None:
            target = {
                "id": f"cluster-{len(clusters) + 1}",
                "pageNumber": item["pageNumber"],
                "bbox": item["bbox"],
                "strokes": [],
                "strokeIds": [],
                "pointCount": 0,
                "strokeCount": 0,
                "startTime": item["startTime"],
                "endTime": item["endTime"],
            }
            clusters.append(target)
        target["strokes"].append(item["stroke"])
        target["strokeIds"].append(str(item["stroke"].get("id") or item["index"]))
        target["pointCount"] += item["pointCount"]
        target["strokeCount"] += 1
        target["bbox"] = _merge_bbox(target["bbox"], item["bbox"])
        target["endTime"] = max(target["endTime"], item["endTime"])

    for cluster in clusters:
        cluster["styleSummary"] = _style_summary(cluster["strokes"])
        cluster.update(classify_ink_cluster(cluster))
        cluster.pop("startTime", None)
        cluster.pop("endTime", None)
    return clusters


def _path_length(points: list[tuple[float, float]]) -> float:
    return sum(
        math.hypot(points[index][0] - points[index - 1][0], points[index][1] - points[index - 1][1])
        for index in range(1, len(points))
    )


def _clamp_confidence(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if not math.isfinite(number):
        return 0.0
    return max(0.0, min(1.0, round(number, 3)))


def _symbol_result(symbol: str, confidence: float) -> dict[str, Any]:
    return {"symbol": symbol, "confidence": _clamp_confidence(confidence), "accepted": True}


def _symbol_candidate(symbol: str, confidence: float, accepted: bool, rejection_reason: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "symbol": symbol,
        "confidence": _clamp_confidence(confidence),
        "accepted": bool(accepted),
    }
    if not accepted:
        result["rejectionReason"] = rejection_reason or "below threshold"
    return result


def _is_highlighter(stroke: dict[str, Any]) -> bool:
    return stroke.get("style") == "highlight" or stroke.get("brush") == "highlighter"


def _distance_point_to_segment(
    point: tuple[float, float],
    start: tuple[float, float],
    end: tuple[float, float],
) -> float:
    dx = end[0] - start[0]
    dy = end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    t = max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)))
    closest = (start[0] + t * dx, start[1] + t * dy)
    return math.hypot(point[0] - closest[0], point[1] - closest[1])


def _stroke_center(stroke: dict[str, Any]) -> tuple[float, float] | None:
    bbox = _stroke_bbox(stroke)
    if bbox["width"] == 0 and bbox["height"] == 0:
        points = _stroke_points_xy(stroke)
        if not points:
            return None
    return bbox["x"] + bbox["width"] / 2, bbox["y"] + bbox["height"] / 2


def _stroke_orientation_bin(points: list[tuple[float, float]]) -> int | None:
    if len(points) < 2:
        return None
    start, end = points[0], points[-1]
    if math.hypot(end[0] - start[0], end[1] - start[1]) < 3:
        return None
    angle = math.atan2(end[1] - start[1], end[0] - start[0])
    # Orientation, not direction: opposite directions are the same axis.
    return int(round((angle % math.pi) / (math.pi / 6))) % 6


def _simplify_polyline(points: list[tuple[float, float]], min_distance: float) -> list[tuple[float, float]]:
    if len(points) <= 2:
        return points
    simplified = [points[0]]
    for point in points[1:-1]:
        previous = simplified[-1]
        if math.hypot(point[0] - previous[0], point[1] - previous[1]) >= min_distance:
            simplified.append(point)
    if simplified[-1] != points[-1]:
        simplified.append(points[-1])
    return simplified


def _orientation(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> float:
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _segments_intersect(
    a: tuple[float, float],
    b: tuple[float, float],
    c: tuple[float, float],
    d: tuple[float, float],
) -> bool:
    o1 = _orientation(a, b, c)
    o2 = _orientation(a, b, d)
    o3 = _orientation(c, d, a)
    o4 = _orientation(c, d, b)
    return (o1 * o2 < 0) and (o3 * o4 < 0)


def _self_intersection_count(points: list[tuple[float, float]]) -> int:
    if len(points) < 5:
        return 0
    intersections = 0
    segment_count = len(points) - 1
    for left in range(segment_count):
        for right in range(left + 2, segment_count):
            if left == 0 and right == segment_count - 1:
                continue
            if _segments_intersect(points[left], points[left + 1], points[right], points[right + 1]):
                intersections += 1
    return intersections


def _sharp_turn_count(points: list[tuple[float, float]]) -> int:
    turns = 0
    for index in range(1, len(points) - 1):
        previous = points[index - 1]
        current = points[index]
        following = points[index + 1]
        left = (current[0] - previous[0], current[1] - previous[1])
        right = (following[0] - current[0], following[1] - current[1])
        left_length = math.hypot(left[0], left[1])
        right_length = math.hypot(right[0], right[1])
        if left_length < 1 or right_length < 1:
            continue
        cosine = max(-1.0, min(1.0, (left[0] * right[0] + left[1] * right[1]) / (left_length * right_length)))
        angle = math.acos(cosine)
        if angle >= 0.7:
            turns += 1
    return turns


def _occupied_bins(values: list[float], origin: float, span: float, bin_count: int = 4) -> int:
    if not values or span <= 0:
        return 0
    bins = {
        max(0, min(bin_count - 1, int((value - origin) / span * bin_count)))
        for value in values
    }
    return len(bins)


def _star_geometry_metrics(strokes: list[dict[str, Any]], bbox: dict[str, float]) -> dict[str, Any]:
    pen_strokes = [stroke for stroke in strokes if not _is_highlighter(stroke)]
    width = max(1.0, float(bbox.get("width") or 0.0))
    height = max(1.0, float(bbox.get("height") or 0.0))
    max_dim = max(width, height)
    center = (float(bbox.get("x") or 0.0) + width / 2, float(bbox.get("y") or 0.0) + height / 2)
    center_threshold = max(4.0, max_dim * 0.14)
    center_stroke_threshold = max(6.0, max_dim * 0.28)
    crossing = 0
    centered = 0
    radial_endpoints = 0
    angle_bins: set[int] = set()
    center_distances: list[float] = []

    for stroke in pen_strokes:
        points = _stroke_points_xy(stroke)
        if len(points) < 2:
            continue
        stroke_center = _stroke_center(stroke)
        if stroke_center is not None:
            distance = math.hypot(stroke_center[0] - center[0], stroke_center[1] - center[1])
            center_distances.append(distance)
            if distance <= center_stroke_threshold:
                centered += 1
        if any(
            _distance_point_to_segment(center, points[index - 1], points[index]) <= center_threshold
            for index in range(1, len(points))
        ):
            crossing += 1
        orientation = _stroke_orientation_bin(points)
        if orientation is not None:
            angle_bins.add(orientation)
        for endpoint in (points[0], points[-1]):
            if math.hypot(endpoint[0] - center[0], endpoint[1] - center[1]) >= max_dim * 0.24:
                radial_endpoints += 1

    count = max(1, len(pen_strokes))
    return {
        "strokeCount": len(pen_strokes),
        "aspectRatio": max(width, height) / max(1.0, min(width, height)),
        "centerCrossingCount": crossing,
        "centerCrossingRatio": crossing / count,
        "centeredCount": centered,
        "centeredRatio": centered / count,
        "orientationCount": len(angle_bins),
        "radialEndpointCount": radial_endpoints,
        "meanCenterDistanceRatio": (sum(center_distances) / len(center_distances) / max_dim) if center_distances else 1.0,
    }


def classify_ink_cluster(cluster: dict[str, Any]) -> dict[str, Any]:
    strokes = [stroke for stroke in cluster.get("strokes", []) if isinstance(stroke, dict)]
    bbox = cluster.get("bbox") if isinstance(cluster.get("bbox"), dict) else {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}
    pen_strokes = [stroke for stroke in strokes if not _is_highlighter(stroke)]
    width = max(1.0, float(bbox.get("width") or 0.0))
    height = max(1.0, float(bbox.get("height") or 0.0))
    max_dim = max(width, height)
    aspect = max(width, height) / max(1.0, min(width, height))
    stroke_count = len(pen_strokes)
    centers = [center for center in (_stroke_center(stroke) for stroke in pen_strokes) if center is not None]
    center_xs = [center[0] for center in centers]
    center_ys = [center[1] for center in centers]
    center = (float(bbox.get("x") or 0.0) + width / 2, float(bbox.get("y") or 0.0) + height / 2)
    center_distances = [math.hypot(x - center[0], y - center[1]) for x, y in centers]
    mean_center_distance_ratio = (sum(center_distances) / len(center_distances) / max_dim) if center_distances else 1.0
    center_x_span_ratio = ((max(center_xs) - min(center_xs)) / width) if len(center_xs) >= 2 else 0.0
    center_y_span_ratio = ((max(center_ys) - min(center_ys)) / height) if len(center_ys) >= 2 else 0.0
    x_bins = _occupied_bins(center_xs, float(bbox.get("x") or 0.0), width)
    y_bins = _occupied_bins(center_ys, float(bbox.get("y") or 0.0), height)
    metrics = _star_geometry_metrics(pen_strokes, bbox)
    explicit_symbol_shape = any(stroke.get("shape") in {"ellipse", "rect", "arrow", "line"} for stroke in pen_strokes)

    text_score = 0.0
    if stroke_count >= 4:
        text_score += 0.24
    if stroke_count >= 7:
        text_score += 0.18
    if width >= 48 and aspect >= 1.35:
        text_score += 0.2
    if center_x_span_ratio >= 0.42:
        text_score += 0.18
    if x_bins >= 3:
        text_score += 0.14
    if y_bins >= 3 and stroke_count >= 5:
        text_score += 0.08
    if mean_center_distance_ratio >= 0.24:
        text_score += 0.14
    if metrics["centerCrossingRatio"] < 0.6 and stroke_count >= 4:
        text_score += 0.12
    if center_x_span_ratio >= 0.5 and center_y_span_ratio >= 0.35 and stroke_count >= 5:
        text_score += 0.1

    symbol_score = 0.0
    if explicit_symbol_shape:
        symbol_score += 0.45
    if stroke_count <= 2:
        symbol_score += 0.18
    if metrics["centerCrossingRatio"] >= 0.65 and metrics["orientationCount"] >= 3:
        symbol_score += 0.32
    if metrics["centeredRatio"] >= 0.62:
        symbol_score += 0.18
    if metrics["radialEndpointCount"] >= max(6, stroke_count):
        symbol_score += 0.12
    if aspect <= 1.7 and stroke_count >= 4:
        symbol_score += 0.08

    text_like_score = _clamp_confidence(text_score)
    symbol_like_score = _clamp_confidence(symbol_score)
    if text_like_score >= 0.62 and text_like_score >= symbol_like_score + 0.14:
        cluster_kind = "text_like"
    elif symbol_like_score >= 0.58 and symbol_like_score >= text_like_score:
        cluster_kind = "symbol_like"
    elif text_like_score >= 0.5 and symbol_like_score >= 0.5:
        cluster_kind = "mixed"
    else:
        cluster_kind = "unknown"

    return {
        "clusterKind": cluster_kind,
        "textLikeScore": text_like_score,
        "symbolLikeScore": symbol_like_score,
        "classification": {
            "strokeCount": stroke_count,
            "aspectRatio": _round_number(metrics["aspectRatio"]),
            "centerXSpanRatio": _clamp_confidence(center_x_span_ratio),
            "centerYSpanRatio": _clamp_confidence(center_y_span_ratio),
            "meanCenterDistanceRatio": _clamp_confidence(mean_center_distance_ratio),
            "centerCrossingRatio": _clamp_confidence(metrics["centerCrossingRatio"]),
            "centeredRatio": _clamp_confidence(metrics["centeredRatio"]),
            "orientationCount": metrics["orientationCount"],
            "xBins": x_bins,
            "yBins": y_bins,
        },
    }


def _is_long_horizontal(points: list[tuple[float, float]], bbox: dict[str, float]) -> bool:
    if len(points) < 2:
        return False
    width = max(1.0, bbox["width"])
    height = max(1.0, bbox["height"])
    start, end = points[0], points[-1]
    return width >= 45 and width / height >= 6 and abs(start[1] - end[1]) <= max(10.0, height * 1.2)


def _detect_check(strokes: list[dict[str, Any]], bbox: dict[str, float]) -> float:
    if len(strokes) != 1:
        return 0.0
    points = _stroke_points_xy(strokes[0])
    if len(points) < 3 or bbox["width"] < 18 or bbox["height"] < 14:
        return 0.0
    start = points[0]
    end = points[-1]
    turn_index = min(range(1, len(points) - 1), key=lambda index: points[index][1] - points[index][0] * 0.05)
    turn = points[turn_index]
    if turn[1] <= start[1] or end[1] >= turn[1]:
        return 0.0
    if end[0] <= turn[0] or turn[0] <= start[0] - bbox["width"] * 0.2:
        return 0.0
    first = math.hypot(turn[0] - start[0], turn[1] - start[1])
    second = math.hypot(end[0] - turn[0], end[1] - turn[1])
    if second < first * 0.75:
        return 0.0
    return 0.78


def _detect_circle(strokes: list[dict[str, Any]], bbox: dict[str, float]) -> float:
    if len(strokes) != 1:
        return 0.0
    stroke = strokes[0]
    if stroke.get("shape") == "ellipse":
        return 0.86
    points = _stroke_points_xy(stroke)
    if len(points) < 8:
        return 0.0
    width = max(1.0, bbox["width"])
    height = max(1.0, bbox["height"])
    if width < 18 or height < 18 or max(width, height) / min(width, height) > 2.0:
        return 0.0
    close_distance = math.hypot(points[0][0] - points[-1][0], points[0][1] - points[-1][1])
    if close_distance > max(width, height) * 0.28:
        return 0.0
    perimeter_like = _path_length(points)
    if perimeter_like < (width + height) * 1.4:
        return 0.0
    return 0.78


def _detect_box(strokes: list[dict[str, Any]], bbox: dict[str, float]) -> float:
    if any(stroke.get("shape") == "rect" for stroke in strokes):
        return 0.88
    if len(strokes) == 1:
        points = _stroke_points_xy(strokes[0])
        if len(points) >= 5 and bbox["width"] >= 20 and bbox["height"] >= 20:
            close_distance = math.hypot(points[0][0] - points[-1][0], points[0][1] - points[-1][1])
            if close_distance <= max(bbox["width"], bbox["height"]) * 0.18:
                return 0.62
    return 0.0


def _detect_star(strokes: list[dict[str, Any]], bbox: dict[str, float]) -> float:
    pen_strokes = [stroke for stroke in strokes if not _is_highlighter(stroke)]
    width = max(1.0, bbox["width"])
    height = max(1.0, bbox["height"])
    max_dim = max(width, height)
    if width < 18 or height < 18 or max_dim / min(width, height) > 1.75:
        return 0.0
    if len(pen_strokes) == 1:
        return _detect_single_stroke_star(pen_strokes[0], bbox)
    if len(pen_strokes) < 4:
        return 0.0
    metrics = _star_geometry_metrics(pen_strokes, bbox)
    required_center_crossings = 3
    if metrics["centerCrossingCount"] < required_center_crossings or metrics["centerCrossingRatio"] < 0.62:
        return 0.0
    if metrics["centeredCount"] < required_center_crossings or metrics["centeredRatio"] < 0.55:
        return 0.0
    if metrics["orientationCount"] < 3:
        return 0.0
    if metrics["meanCenterDistanceRatio"] > 0.34:
        return 0.0
    if metrics["radialEndpointCount"] < max(5, len(pen_strokes)):
        return 0.0
    confidence = 0.56
    confidence += min(0.18, metrics["centerCrossingRatio"] * 0.18)
    confidence += min(0.12, metrics["centeredRatio"] * 0.12)
    confidence += min(0.1, metrics["orientationCount"] * 0.025)
    confidence += 0.06 if max_dim / min(width, height) <= 1.35 else 0.0
    return min(confidence, 0.9)


def _detect_single_stroke_star(stroke: dict[str, Any], bbox: dict[str, float]) -> float:
    points = _stroke_points_xy(stroke)
    if len(points) < 5:
        return 0.0
    width = max(1.0, bbox["width"])
    height = max(1.0, bbox["height"])
    max_dim = max(width, height)
    simplified = _simplify_polyline(points, max(4.0, max_dim * 0.08))
    if len(simplified) < 5:
        return 0.0
    intersections = _self_intersection_count(simplified)
    sharp_turns = _sharp_turn_count(simplified)
    path_length = _path_length(points)
    center = (float(bbox.get("x") or 0.0) + width / 2, float(bbox.get("y") or 0.0) + height / 2)
    center_threshold = max(5.0, max_dim * 0.16)
    center_crossings = sum(
        1
        for index in range(1, len(simplified))
        if _distance_point_to_segment(center, simplified[index - 1], simplified[index]) <= center_threshold
    )
    endpoint_bins = _occupied_bins([point[0] for point in simplified], float(bbox.get("x") or 0.0), width, bin_count=5)
    vertical_bins = _occupied_bins([point[1] for point in simplified], float(bbox.get("y") or 0.0), height, bin_count=5)
    path_ratio = path_length / max(1.0, width + height)
    far_points = [
        point for point in simplified
        if math.hypot(point[0] - center[0], point[1] - center[1]) >= max_dim * 0.3
    ]
    angle_bins = {
        int((((math.atan2(point[1] - center[1], point[0] - center[0]) + math.pi * 2) % (math.pi * 2)) / (math.pi / 4)))
        for point in far_points
    }
    near_center_vertices = sum(
        1
        for point in simplified
        if math.hypot(point[0] - center[0], point[1] - center[1]) <= center_threshold * 1.2
    )

    if (
        center_crossings >= 3
        and len(far_points) >= 4
        and len(angle_bins) >= 4
        and near_center_vertices >= 2
        and sharp_turns >= 3
        and endpoint_bins >= 3
        and vertical_bins >= 3
        and path_ratio >= 1.55
    ):
        confidence = 0.7
        confidence += min(0.08, center_crossings * 0.015)
        confidence += min(0.06, len(angle_bins) * 0.01)
        confidence += min(0.04, near_center_vertices * 0.01)
        confidence += 0.04 if max_dim / min(width, height) <= 1.45 else 0.0
        return min(confidence, 0.88)

    if intersections < 2:
        return 0.0
    if sharp_turns < 4:
        return 0.0
    if center_crossings < 2:
        return 0.0
    if endpoint_bins < 3 or vertical_bins < 3:
        return 0.0
    if path_ratio < 2.1:
        return 0.0

    confidence = 0.68
    confidence += min(0.08, intersections * 0.02)
    confidence += min(0.08, sharp_turns * 0.012)
    confidence += min(0.06, center_crossings * 0.02)
    confidence += 0.04 if max_dim / min(width, height) <= 1.45 else 0.0
    return min(confidence, 0.88)


def _detect_bracket(strokes: list[dict[str, Any]], bbox: dict[str, float]) -> float:
    vertical = 0
    horizontal = 0
    for stroke in strokes:
        points = _stroke_points_xy(stroke)
        if len(points) < 2:
            continue
        stroke_bbox = _stroke_bbox(stroke)
        if stroke_bbox["height"] >= 28 and stroke_bbox["height"] / max(1.0, stroke_bbox["width"]) >= 3:
            vertical += 1
        if 8 <= stroke_bbox["width"] <= max(80.0, bbox["width"] * 0.75) and stroke_bbox["width"] / max(1.0, stroke_bbox["height"]) >= 3:
            horizontal += 1
    if vertical >= 1 and horizontal >= 1:
        return 0.68
    return 0.0


def _detect_exclamation(strokes: list[dict[str, Any]], bbox: dict[str, float]) -> float:
    if len(strokes) < 2:
        return 0.0
    vertical = False
    dot = False
    for stroke in strokes:
        stroke_bbox = _stroke_bbox(stroke)
        if stroke_bbox["height"] >= 24 and stroke_bbox["height"] / max(1.0, stroke_bbox["width"]) >= 4:
            vertical = True
        if stroke_bbox["width"] <= 12 and stroke_bbox["height"] <= 12:
            dot = True
    return 0.74 if vertical and dot else 0.0


def compute_geometry_symbol_candidates(cluster: dict[str, Any]) -> list[dict[str, Any]]:
    strokes = [stroke for stroke in cluster.get("strokes", []) if isinstance(stroke, dict)]
    bbox = cluster.get("bbox") if isinstance(cluster.get("bbox"), dict) else {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}
    classification = {
        "clusterKind": cluster.get("clusterKind"),
        "textLikeScore": cluster.get("textLikeScore"),
        "symbolLikeScore": cluster.get("symbolLikeScore"),
    }
    if classification["clusterKind"] is None:
        classification.update(classify_ink_cluster({"strokes": strokes, "bbox": bbox}))
    cluster_kind = classification.get("clusterKind")

    arrow_confidence = 0.0
    arrow_reason = "no arrow shape"
    if any(stroke.get("shape") == "arrow" for stroke in strokes):
        arrow_confidence = 0.86
        arrow_reason = ""
    elif any(stroke.get("shape") == "line" for stroke in strokes):
        arrow_confidence = 0.42
        arrow_reason = "line shape is not explicit arrow"

    raw_candidates = [
        ("star", _detect_star(strokes, bbox), 0.68, "no center-crossing star pattern"),
        ("check", _detect_check(strokes, bbox), 0.6, "no check angle"),
        ("circle", _detect_circle(strokes, bbox), 0.6, "not closed"),
        ("box", _detect_box(strokes, bbox), 0.6, "not rectangular/closed"),
        ("arrow", arrow_confidence, 0.6, arrow_reason),
        (
            "underline",
            0.76 if any(_is_long_horizontal(_stroke_points_xy(stroke), _stroke_bbox(stroke)) for stroke in strokes) else 0.0,
            0.6,
            "not long horizontal",
        ),
        ("bracket", _detect_bracket(strokes, bbox), 0.6, "no bracket geometry"),
        ("exclamation", _detect_exclamation(strokes, bbox), 0.6, "no vertical-plus-dot pattern"),
    ]

    candidates: list[dict[str, Any]] = []
    for symbol, confidence, threshold, default_reason in raw_candidates:
        accepted = confidence >= threshold
        rejection_reason = default_reason if not accepted else None
        if cluster_kind == "text_like" and symbol == "star":
            accepted = False
            rejection_reason = "text-like cluster"
        elif cluster_kind == "text_like" and symbol in {"check", "circle", "box"} and confidence < 0.84:
            accepted = False
            rejection_reason = "text-like cluster"
        candidates.append(_symbol_candidate(symbol, confidence, accepted, rejection_reason))
    return sorted(candidates, key=lambda item: (item["accepted"], item["confidence"]), reverse=True)


def compute_geometry_symbols(cluster: dict[str, Any]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    for candidate in compute_geometry_symbol_candidates(cluster):
        if not candidate.get("accepted"):
            continue
        result = _symbol_result(candidate["symbol"], float(candidate.get("confidence") or 0.0))
        symbol = result["symbol"]
        if symbol not in deduped or result["confidence"] > deduped[symbol]["confidence"]:
            deduped[symbol] = result
    return sorted(deduped.values(), key=lambda item: item["confidence"], reverse=True)


def _normalize_keyword_text(value: str) -> str:
    return re.sub(r"[^0-9a-zA-Z가-힣]+", "", value.strip().lower())


def _decompose_hangul_syllable(char: str) -> tuple[int, int, int] | None:
    code = ord(char)
    if code < _HANGUL_BASE or code > _HANGUL_END:
        return None
    offset = code - _HANGUL_BASE
    initial = offset // (_HANGUL_MEDIAL_COUNT * _HANGUL_FINAL_COUNT)
    medial = (offset % (_HANGUL_MEDIAL_COUNT * _HANGUL_FINAL_COUNT)) // _HANGUL_FINAL_COUNT
    final = offset % _HANGUL_FINAL_COUNT
    return initial, medial, final


def _similar_medial(left: int, right: int) -> bool:
    return any(left in group and right in group for group in _SIMILAR_MEDIALS)


def _hangul_syllable_similarity(left: str, right: str) -> float:
    if left == right:
        return 1.0
    left_parts = _decompose_hangul_syllable(left)
    right_parts = _decompose_hangul_syllable(right)
    if left_parts is None or right_parts is None:
        return 0.0

    score = 0.0
    if left_parts[0] == right_parts[0]:
        score += 0.45
    if left_parts[1] == right_parts[1]:
        score += 0.35
    elif _similar_medial(left_parts[1], right_parts[1]):
        score += 0.28
    if left_parts[2] == right_parts[2]:
        score += 0.2
    return score


def _hangul_keyword_similarity(left: str, right: str) -> float:
    if len(left) != len(right) or not left:
        return 0.0
    return sum(
        _hangul_syllable_similarity(left_char, right_char)
        for left_char, right_char in zip(left, right, strict=False)
    ) / len(right)


def _keyword_windows(value: str, length: int) -> list[str]:
    if length <= 0 or len(value) < length:
        return []
    if len(value) == length:
        return [value]
    return [value[index:index + length] for index in range(0, len(value) - length + 1)]


def normalize_korean_study_keywords(text: str, candidates: list[str] | None = None) -> list[str]:
    values = [text, *(candidates or [])]
    found: list[str] = []

    def add(keyword: str) -> None:
        if keyword in CANONICAL_STUDY_KEYWORDS and keyword not in found:
            found.append(keyword)

    for value in values:
        normalized = _normalize_keyword_text(value)
        if not normalized:
            continue
        for variant, canonical in KEYWORD_VARIANTS.items():
            if _normalize_keyword_text(variant) in normalized:
                add(canonical)
        for canonical in CANONICAL_STUDY_KEYWORDS:
            if _normalize_keyword_text(canonical) in normalized:
                add(canonical)

        tokens = re.findall(r"[a-zA-Z가-힣0-9]+", value.lower())
        for token in tokens:
            token_normalized = _normalize_keyword_text(token)
            if len(token_normalized) < 2:
                continue
            for canonical in CANONICAL_STUDY_KEYWORDS:
                canonical_normalized = _normalize_keyword_text(canonical)
                if len(token_normalized) < len(canonical_normalized):
                    continue
                if SequenceMatcher(None, token_normalized, canonical_normalized).ratio() >= 0.88:
                    add(canonical)
            for canonical in STRONG_STUDY_KEYWORDS:
                canonical_normalized = _normalize_keyword_text(canonical)
                threshold = 0.84 if len(canonical_normalized) <= 2 else 0.82
                if any(
                    _hangul_keyword_similarity(window, canonical_normalized) >= threshold
                    for window in _keyword_windows(token_normalized, len(canonical_normalized))
                ):
                    add(canonical)
    return found


def _clamp_confidence(value: Any) -> float:
    try:
        if isinstance(value, bool):
            return 0.0
        number = float(value)
        if not math.isfinite(number):
            return 0.0
        return max(0.0, min(1.0, number))
    except (TypeError, ValueError):
        return 0.0


def _unique_strings(values: list[Any]) -> list[str]:
    result: list[str] = []
    for value in values:
        if not isinstance(value, str):
            continue
        normalized = value.strip()
        if normalized and normalized not in result:
            result.append(normalized)
    return result


def _candidate_texts(candidates: Any) -> list[str]:
    if not isinstance(candidates, list):
        return []
    texts: list[str] = []
    for candidate in candidates:
        if isinstance(candidate, dict) and isinstance(candidate.get("text"), str):
            texts.append(candidate["text"])
    return texts


def _normalize_candidates(candidates: Any) -> list[dict[str, Any]]:
    if not isinstance(candidates, list):
        return []
    normalized: list[dict[str, Any]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        text = str(candidate.get("text") or "").strip()
        if not text:
            continue
        result: dict[str, Any] = {"text": text}
        if candidate.get("confidence") is not None:
            result["confidence"] = _clamp_confidence(candidate.get("confidence"))
        normalized.append(result)
    return normalized


def _normalize_bbox(value: Any) -> dict[str, float]:
    if not isinstance(value, dict):
        return {"x": 0.0, "y": 0.0, "width": 0.0, "height": 0.0}
    def number(key: str) -> float:
        try:
            return float(value.get(key) or 0.0)
        except (TypeError, ValueError):
            return 0.0
    return {
        "x": number("x"),
        "y": number("y"),
        "width": max(0.0, number("width")),
        "height": max(0.0, number("height")),
    }


def _normalize_symbol_candidates(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    normalized: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        symbol = item.get("symbol")
        if symbol not in SYMBOL_NAMES:
            continue
        candidate: dict[str, Any] = {
            "symbol": symbol,
            "confidence": _clamp_confidence(item.get("confidence")),
            "accepted": bool(item.get("accepted")),
        }
        if not candidate["accepted"]:
            reason = item.get("rejectionReason")
            if isinstance(reason, str) and reason.strip():
                candidate["rejectionReason"] = reason.strip()
        normalized.append(candidate)
    return normalized


def _cluster_source(value: Any, fallback: str) -> str:
    if value in {"geometry", "mlkit-digital-ink", "openai-vision", "hybrid"}:
        return str(value)
    return fallback if fallback in {"geometry", "mlkit-digital-ink", "openai-vision", "hybrid"} else "mlkit-digital-ink"


def _normalize_recognition_cluster(cluster: dict[str, Any], *, fallback_source: str, fallback_index: int) -> dict[str, Any]:
    candidates = _normalize_candidates(cluster.get("candidates"))
    text = str(cluster.get("text") or candidates[0]["text"] if candidates else cluster.get("text") or "")
    raw_keywords = [*cluster.get("keywords", [])] if isinstance(cluster.get("keywords"), list) else []
    keywords = normalize_korean_study_keywords(text, [*_candidate_texts(candidates), *raw_keywords])
    symbols = [
        symbol
        for symbol in _unique_strings(cluster.get("symbols", []) if isinstance(cluster.get("symbols"), list) else [])
        if symbol in SYMBOL_NAMES
    ]
    source = _cluster_source(cluster.get("source"), fallback_source)
    try:
        page_number = int(cluster.get("pageNumber") or cluster.get("page_number") or 1)
    except (TypeError, ValueError):
        page_number = 1
    normalized = {
        "id": str(cluster.get("id") or f"{source}-cluster-{fallback_index}"),
        "pageNumber": page_number,
        "bbox": _normalize_bbox(cluster.get("bbox")),
        "text": text,
        "candidates": candidates,
        "keywords": keywords,
        "symbols": symbols,
        "confidence": _clamp_confidence(cluster.get("confidence")),
        "source": source,
    }
    if isinstance(cluster.get("clusterKind"), str):
        normalized["clusterKind"] = cluster["clusterKind"]
    for key in ("textLikeScore", "symbolLikeScore"):
        if cluster.get(key) is not None:
            normalized[key] = _clamp_confidence(cluster.get(key))
    symbol_candidates = _normalize_symbol_candidates(cluster.get("symbolCandidates"))
    if symbol_candidates:
        normalized["symbolCandidates"] = symbol_candidates
    return normalized


def _merge_cluster(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    left_candidates = left.get("symbolCandidates", []) if isinstance(left.get("symbolCandidates"), list) else []
    right_candidates = right.get("symbolCandidates", []) if isinstance(right.get("symbolCandidates"), list) else []
    symbol_candidates_by_key = {
        (candidate.get("symbol"), candidate.get("rejectionReason")): candidate
        for candidate in left_candidates
        if isinstance(candidate, dict)
    }
    for candidate in right_candidates:
        if not isinstance(candidate, dict):
            continue
        key = (candidate.get("symbol"), candidate.get("rejectionReason"))
        existing = symbol_candidates_by_key.get(key)
        if existing is None or _clamp_confidence(candidate.get("confidence")) > _clamp_confidence(existing.get("confidence")):
            symbol_candidates_by_key[key] = candidate
    cluster_kind = left.get("clusterKind") or right.get("clusterKind")
    if left.get("clusterKind") != right.get("clusterKind") and left.get("clusterKind") and right.get("clusterKind"):
        cluster_kind = "mixed"
    return {
        **left,
        "text": "\n".join(_unique_strings([left.get("text", ""), right.get("text", "")])),
        "candidates": [
            *left.get("candidates", []),
            *[
                candidate
                for candidate in right.get("candidates", [])
                if candidate.get("text") not in {existing.get("text") for existing in left.get("candidates", [])}
            ],
        ],
        "keywords": _unique_strings([*left.get("keywords", []), *right.get("keywords", [])]),
        "symbols": _unique_strings([*left.get("symbols", []), *right.get("symbols", [])]),
        "confidence": max(_clamp_confidence(left.get("confidence")), _clamp_confidence(right.get("confidence"))),
        "source": "hybrid" if left.get("source") != right.get("source") else left.get("source", "hybrid"),
        "clusterKind": cluster_kind,
        "textLikeScore": max(_clamp_confidence(left.get("textLikeScore")), _clamp_confidence(right.get("textLikeScore"))),
        "symbolLikeScore": max(_clamp_confidence(left.get("symbolLikeScore")), _clamp_confidence(right.get("symbolLikeScore"))),
        "symbolCandidates": list(symbol_candidates_by_key.values()),
    }


def _recognition_source_types(recognition: dict[str, Any]) -> set[str]:
    sources: set[str] = set()
    engine = recognition.get("engine")
    if engine == "hybrid":
        sources.add("hybrid")
    elif isinstance(engine, str) and engine:
        sources.add(engine)
    clusters = recognition.get("clusters")
    if isinstance(clusters, list):
        for cluster in clusters:
            if isinstance(cluster, dict) and isinstance(cluster.get("source"), str):
                sources.add(cluster["source"])
    return {source for source in sources if source in {"geometry", "mlkit-digital-ink", "openai-vision", "hybrid"}}


def _merged_engine(sources: set[str]) -> str:
    concrete = {source for source in sources if source != "hybrid"}
    if "hybrid" in sources or len(concrete) > 1:
        return "hybrid"
    if concrete:
        return next(iter(concrete))
    return "mlkit-digital-ink"


def _merged_confidence(existing: dict[str, Any] | None, incoming: dict[str, Any], keywords: list[str], symbols: list[str]) -> float:
    existing_confidence = _clamp_confidence(existing.get("confidence")) if isinstance(existing, dict) else 0.0
    incoming_confidence = _clamp_confidence(incoming.get("confidence"))
    if existing_confidence and incoming_confidence:
        existing_keywords = set(existing.get("keywords", []) if isinstance(existing.get("keywords"), list) else [])
        existing_symbols = set(existing.get("symbols", []) if isinstance(existing.get("symbols"), list) else [])
        incoming_keywords = set(incoming.get("keywords", []) if isinstance(incoming.get("keywords"), list) else [])
        incoming_symbols = set(incoming.get("symbols", []) if isinstance(incoming.get("symbols"), list) else [])
        sources_agree = bool(existing_keywords & incoming_keywords or existing_symbols & incoming_symbols)
        if sources_agree:
            return min(0.95, max(existing_confidence, incoming_confidence))
        return min(0.95, (existing_confidence * 0.45) + (incoming_confidence * 0.55))
    if keywords or symbols:
        return min(0.95, max(existing_confidence, incoming_confidence))
    return 0.0


def merge_handwriting_recognition_results(
    existing: dict[str, Any] | None,
    incoming: dict[str, Any],
    current_stroke_hash: str,
) -> dict[str, Any]:
    existing_recognition = existing if isinstance(existing, dict) else {}
    incoming_engine = _cluster_source(incoming.get("engine"), "mlkit-digital-ink")
    incoming_candidates = _candidate_texts(incoming.get("candidates"))
    incoming_text = str(incoming.get("text") or "")
    incoming_keywords = normalize_korean_study_keywords(
        incoming_text,
        [
            *incoming_candidates,
            *(
                incoming.get("keywords", [])
                if isinstance(incoming.get("keywords"), list)
                else []
            ),
        ],
    )
    incoming_symbols = [
        symbol
        for symbol in _unique_strings(incoming.get("symbols", []) if isinstance(incoming.get("symbols"), list) else [])
        if symbol in SYMBOL_NAMES
    ]
    normalized_incoming = {
        **incoming,
        "engine": incoming_engine,
        "text": incoming_text,
        "keywords": incoming_keywords,
        "symbols": incoming_symbols,
        "confidence": _clamp_confidence(incoming.get("confidence")),
    }

    clusters_by_id: dict[str, dict[str, Any]] = {}
    for index, cluster in enumerate(existing_recognition.get("clusters", []) if isinstance(existing_recognition.get("clusters"), list) else [], start=1):
        if not isinstance(cluster, dict):
            continue
        normalized = _normalize_recognition_cluster(
            cluster,
            fallback_source=_cluster_source(cluster.get("source") or existing_recognition.get("engine"), "geometry"),
            fallback_index=index,
        )
        clusters_by_id[normalized["id"]] = normalized

    incoming_clusters = normalized_incoming.get("clusters")
    if isinstance(incoming_clusters, list):
        for index, cluster in enumerate(incoming_clusters, start=1):
            if not isinstance(cluster, dict):
                continue
            normalized = _normalize_recognition_cluster(cluster, fallback_source=incoming_engine, fallback_index=index)
            if normalized["id"] in clusters_by_id:
                clusters_by_id[normalized["id"]] = _merge_cluster(clusters_by_id[normalized["id"]], normalized)
            else:
                clusters_by_id[normalized["id"]] = normalized

    cluster_keywords = [keyword for cluster in clusters_by_id.values() for keyword in cluster.get("keywords", [])]
    cluster_symbols = [symbol for cluster in clusters_by_id.values() for symbol in cluster.get("symbols", [])]
    keywords = _unique_strings([
        *(existing_recognition.get("keywords", []) if isinstance(existing_recognition.get("keywords"), list) else []),
        *incoming_keywords,
        *cluster_keywords,
    ])
    symbols = _unique_strings([
        *(existing_recognition.get("symbols", []) if isinstance(existing_recognition.get("symbols"), list) else []),
        *incoming_symbols,
        *cluster_symbols,
    ])
    text = "\n".join(_unique_strings([
        str(existing_recognition.get("text") or ""),
        incoming_text,
        *[cluster.get("text", "") for cluster in clusters_by_id.values()],
    ]))
    sources = _recognition_source_types(existing_recognition) | _recognition_source_types(normalized_incoming)
    if clusters_by_id:
        sources |= {str(cluster.get("source")) for cluster in clusters_by_id.values() if cluster.get("source")}
    confidence = _merged_confidence(existing_recognition, normalized_incoming, keywords, symbols)
    status = "ready" if (text.strip() or keywords or symbols) else "unavailable"

    result: dict[str, Any] = {
        "status": status,
        "strokeHash": current_stroke_hash,
        "engine": _merged_engine(sources),
        "text": text,
        "keywords": keywords,
        "symbols": symbols,
        "confidence": confidence,
        "clusters": list(clusters_by_id.values()),
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }

    for key in ["visionFallbackUsed", "cached"]:
        if key in existing_recognition:
            result[key] = bool(existing_recognition.get(key))
    result["stale"] = False
    if isinstance(existing_recognition.get("visionFallbackSkippedReason"), str):
        result["visionFallbackSkippedReason"] = existing_recognition["visionFallbackSkippedReason"]
    for key in ["analyzedClusterCount", "visionAnalyzedClusterCount"]:
        if key in existing_recognition:
            try:
                result[key] = max(0, int(existing_recognition.get(key) or 0))
            except (TypeError, ValueError):
                result[key] = 0

    return result


def _recognition_cluster(cluster: dict[str, Any]) -> dict[str, Any]:
    symbol_results = compute_geometry_symbols(cluster)
    symbol_candidates = compute_geometry_symbol_candidates(cluster)
    symbols = [result["symbol"] for result in symbol_results if result["confidence"] >= 0.6]
    confidence = max([result["confidence"] for result in symbol_results], default=0.0)
    return {
        "id": cluster.get("id") or "cluster",
        "pageNumber": cluster.get("pageNumber") or 1,
        "bbox": cluster.get("bbox") or {"x": 0, "y": 0, "width": 0, "height": 0},
        "text": "",
        "candidates": [],
        "keywords": [],
        "symbols": symbols,
        "confidence": confidence,
        "source": "geometry",
        "clusterKind": cluster.get("clusterKind") or "unknown",
        "textLikeScore": cluster.get("textLikeScore") or 0.0,
        "symbolLikeScore": cluster.get("symbolLikeScore") or 0.0,
        "symbolCandidates": symbol_candidates,
    }


def build_handwriting_recognition_from_geometry(page_state: dict[str, Any]) -> dict[str, Any]:
    strokes = extract_page_ink_strokes(page_state)
    stroke_hash = stable_stroke_hash(strokes)
    if not strokes:
        return {
            "status": "unavailable",
            "strokeHash": stroke_hash,
            "engine": "geometry",
            "text": "",
            "keywords": [],
            "symbols": [],
            "confidence": 0.0,
            "clusters": [],
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }

    clusters = [_recognition_cluster(cluster) for cluster in cluster_ink_strokes(strokes)]
    symbols = sorted({symbol for cluster in clusters for symbol in cluster.get("symbols", [])})
    confidence = max([float(cluster.get("confidence") or 0.0) for cluster in clusters], default=0.0)
    return {
        "status": "ready",
        "strokeHash": stroke_hash,
        "engine": "geometry",
        "text": "",
        "keywords": [],
        "symbols": symbols,
        "confidence": confidence,
        "clusters": clusters,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
    }
