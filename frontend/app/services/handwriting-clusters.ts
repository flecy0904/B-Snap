import type { InkPoint, InkStroke } from '../ui-types';

export type InkRecognitionCluster = {
  id: string;
  pageNumber: number;
  bbox: { x: number; y: number; width: number; height: number };
  strokes: InkStroke[];
  strokeIds: string[];
  strokeCount: number;
  pointCount: number;
  startTime?: number;
  endTime?: number;
};

type PreparedStroke = {
  stroke: InkStroke;
  order: number;
  id: string;
  pageNumber: number;
  bbox: { x: number; y: number; width: number; height: number };
  pointCount: number;
  startTime?: number;
  endTime?: number;
};

type WorkingCluster = {
  pageNumber: number;
  bbox: { x: number; y: number; width: number; height: number };
  strokes: PreparedStroke[];
  pointCount: number;
  startTime?: number;
  endTime?: number;
};

export type InkRecognitionClusterOptions = {
  pageNumber?: number;
  maxDistance?: number;
  maxTimeGapMs?: number;
  minPointCount?: number;
  minSize?: number;
};

const DEFAULT_MAX_DISTANCE = 140;
const DEFAULT_MAX_TIME_GAP_MS = 2400;
const DEFAULT_MIN_POINT_COUNT = 4;
const DEFAULT_MIN_SIZE = 8;
const RECOGNITION_MIN_CANVAS_DIMENSION = 260;
const RECOGNITION_MAX_SCALE = 4.5;
const RECOGNITION_MAX_SEGMENT_LENGTH = 7;

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTextRecognitionStroke(stroke: InkStroke) {
  if (stroke.generatedPageId) return false;
  if (stroke.style === 'highlight' || stroke.style === 'shape') return false;
  if (stroke.brush === 'highlighter') return false;
  if (stroke.shape) return false;
  return Array.isArray(stroke.points) && stroke.points.length >= 2;
}

function getStrokePageNumber(stroke: InkStroke, fallbackPageNumber?: number) {
  if (finiteNumber(stroke.pageNumber)) return stroke.pageNumber;
  const pointPageNumber = stroke.points.find((point) => finiteNumber(point.pageNumber))?.pageNumber;
  return finiteNumber(pointPageNumber) ? pointPageNumber : fallbackPageNumber ?? 1;
}

function prepareStroke(stroke: InkStroke, order: number, fallbackPageNumber?: number): PreparedStroke | null {
  if (!isTextRecognitionStroke(stroke)) return null;

  const points = stroke.points.filter((point) => finiteNumber(point.x) && finiteNumber(point.y));
  if (points.length < 2) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const times: number[] = [];

  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    if (finiteNumber(point.t)) times.push(point.t);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }

  const pageNumber = getStrokePageNumber(stroke, fallbackPageNumber);
  if (fallbackPageNumber && pageNumber !== fallbackPageNumber) return null;

  return {
    stroke,
    order,
    id: stroke.id || `stroke-${order}`,
    pageNumber,
    bbox: {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    },
    pointCount: points.length,
    startTime: times.length ? Math.min(...times) : undefined,
    endTime: times.length ? Math.max(...times) : undefined,
  };
}

function unionBbox(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  const minX = Math.min(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxX = Math.max(a.x + a.width, b.x + b.width);
  const maxY = Math.max(a.y + a.height, b.y + b.height);
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function bboxDistance(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  const ax2 = a.x + a.width;
  const ay2 = a.y + a.height;
  const bx2 = b.x + b.width;
  const by2 = b.y + b.height;
  const dx = Math.max(0, Math.max(b.x - ax2, a.x - bx2));
  const dy = Math.max(0, Math.max(b.y - ay2, a.y - by2));
  return Math.hypot(dx, dy);
}

function timeGap(a: WorkingCluster, b: PreparedStroke) {
  if (!finiteNumber(a.startTime) || !finiteNumber(a.endTime) || !finiteNumber(b.startTime) || !finiteNumber(b.endTime)) {
    return null;
  }
  if (b.startTime > a.endTime) return b.startTime - a.endTime;
  if (a.startTime > b.endTime) return a.startTime - b.endTime;
  return 0;
}

function shouldMergeStroke(
  cluster: WorkingCluster,
  stroke: PreparedStroke,
  options: Required<Pick<InkRecognitionClusterOptions, 'maxDistance' | 'maxTimeGapMs'>>,
) {
  if (cluster.pageNumber !== stroke.pageNumber) return false;

  const distance = bboxDistance(cluster.bbox, stroke.bbox);
  const merged = unionBbox(cluster.bbox, stroke.bbox);
  const referenceHeight = Math.max(12, Math.max(cluster.bbox.height, stroke.bbox.height));
  const proximityLimit = Math.max(34, Math.min(options.maxDistance, referenceHeight * 2.4));
  const gap = timeGap(cluster, stroke);
  const temporalClose = gap === null || gap <= options.maxTimeGapMs;

  if (distance <= proximityLimit && temporalClose) return true;
  if (distance <= proximityLimit * 0.55) return true;

  const mergedTooWide = merged.width > Math.max(referenceHeight * 8, options.maxDistance * 1.8);
  return !mergedTooWide && distance <= proximityLimit * 1.2 && temporalClose;
}

function addStrokeToCluster(cluster: WorkingCluster, stroke: PreparedStroke) {
  cluster.strokes.push(stroke);
  cluster.bbox = unionBbox(cluster.bbox, stroke.bbox);
  cluster.pointCount += stroke.pointCount;
  if (finiteNumber(stroke.startTime)) {
    cluster.startTime = finiteNumber(cluster.startTime) ? Math.min(cluster.startTime, stroke.startTime) : stroke.startTime;
  }
  if (finiteNumber(stroke.endTime)) {
    cluster.endTime = finiteNumber(cluster.endTime) ? Math.max(cluster.endTime, stroke.endTime) : stroke.endTime;
  }
}

function hasMinimumInk(cluster: WorkingCluster, options: Required<Pick<InkRecognitionClusterOptions, 'minPointCount' | 'minSize'>>) {
  const maxDimension = Math.max(cluster.bbox.width, cluster.bbox.height);
  const area = cluster.bbox.width * cluster.bbox.height;
  return cluster.pointCount >= options.minPointCount && maxDimension >= options.minSize && area >= options.minSize * options.minSize;
}

function resampleRecognitionPoints(points: InkPoint[]) {
  if (points.length < 2) return points;
  const nextPoints: InkPoint[] = [];
  points.forEach((point, index) => {
    if (index === 0) {
      nextPoints.push(point);
      return;
    }
    const previous = points[index - 1];
    const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
    const segmentCount = Math.max(1, Math.ceil(distance / RECOGNITION_MAX_SEGMENT_LENGTH));
    for (let segmentIndex = 1; segmentIndex <= segmentCount; segmentIndex += 1) {
      const ratio = segmentIndex / segmentCount;
      const interpolatedTime = finiteNumber(previous.t) && finiteNumber(point.t)
        ? previous.t + (point.t - previous.t) * ratio
        : undefined;
      nextPoints.push({
        ...point,
        x: previous.x + (point.x - previous.x) * ratio,
        y: previous.y + (point.y - previous.y) * ratio,
        t: finiteNumber(interpolatedTime) ? Math.round(interpolatedTime) : point.t,
      });
    }
  });
  return nextPoints;
}

export function clusterInkStrokesForRecognition(
  strokes: InkStroke[],
  options: InkRecognitionClusterOptions = {},
): InkRecognitionCluster[] {
  const prepared = strokes
    .map((stroke, order) => prepareStroke(stroke, order, options.pageNumber))
    .filter((stroke): stroke is PreparedStroke => Boolean(stroke))
    .sort((a, b) => (
      a.pageNumber - b.pageNumber
      || (a.startTime ?? Number.MAX_SAFE_INTEGER) - (b.startTime ?? Number.MAX_SAFE_INTEGER)
      || a.bbox.y - b.bbox.y
      || a.bbox.x - b.bbox.x
      || a.order - b.order
    ));

  const mergeOptions = {
    maxDistance: options.maxDistance ?? DEFAULT_MAX_DISTANCE,
    maxTimeGapMs: options.maxTimeGapMs ?? DEFAULT_MAX_TIME_GAP_MS,
  };
  const minOptions = {
    minPointCount: options.minPointCount ?? DEFAULT_MIN_POINT_COUNT,
    minSize: options.minSize ?? DEFAULT_MIN_SIZE,
  };
  const clusters: WorkingCluster[] = [];

  prepared.forEach((stroke) => {
    let bestClusterIndex = -1;
    let bestDistance = Infinity;

    clusters.forEach((cluster, index) => {
      if (!shouldMergeStroke(cluster, stroke, mergeOptions)) return;
      const distance = bboxDistance(cluster.bbox, stroke.bbox);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestClusterIndex = index;
      }
    });

    if (bestClusterIndex >= 0) {
      addStrokeToCluster(clusters[bestClusterIndex], stroke);
      return;
    }

    clusters.push({
      pageNumber: stroke.pageNumber,
      bbox: stroke.bbox,
      strokes: [stroke],
      pointCount: stroke.pointCount,
      startTime: stroke.startTime,
      endTime: stroke.endTime,
    });
  });

  return clusters
    .filter((cluster) => hasMinimumInk(cluster, minOptions))
    .sort((a, b) => (
      a.pageNumber - b.pageNumber
      || a.bbox.y - b.bbox.y
      || a.bbox.x - b.bbox.x
      || (a.startTime ?? Number.MAX_SAFE_INTEGER) - (b.startTime ?? Number.MAX_SAFE_INTEGER)
    ))
    .map((cluster, index) => ({
      id: `mlkit-cluster-${cluster.pageNumber}-${index + 1}`,
      pageNumber: cluster.pageNumber,
      bbox: cluster.bbox,
      strokes: cluster.strokes.map((stroke) => stroke.stroke),
      strokeIds: cluster.strokes.map((stroke) => stroke.id),
      strokeCount: cluster.strokes.length,
      pointCount: cluster.pointCount,
      startTime: cluster.startTime,
      endTime: cluster.endTime,
    }));
}

export function prepareClusterStrokesForRecognition(cluster: InkRecognitionCluster) {
  const padding = Math.max(12, Math.min(32, Math.max(cluster.bbox.width, cluster.bbox.height) * 0.22));
  const paddedWidth = Math.max(1, cluster.bbox.width + padding * 2);
  const paddedHeight = Math.max(1, cluster.bbox.height + padding * 2);
  const maxDimension = Math.max(paddedWidth, paddedHeight);
  const scale = Math.max(1, Math.min(RECOGNITION_MAX_SCALE, RECOGNITION_MIN_CANVAS_DIMENSION / maxDimension));
  const writingArea = {
    width: Math.max(1, paddedWidth * scale),
    height: Math.max(1, paddedHeight * scale),
  };

  const allTimes = cluster.strokes
    .flatMap((stroke) => stroke.points.map((point) => point.t))
    .filter(finiteNumber);
  const timeBase = allTimes.length ? Math.min(...allTimes) : null;
  let lastTime = 0;

  const strokes = cluster.strokes.map((stroke, strokeIndex) => {
    const transformedPoints = stroke.points.map((point) => {
      const rawRelativeTime = timeBase !== null && finiteNumber(point.t)
        ? Math.round(point.t - timeBase)
        : lastTime + 16;
      const t = Math.max(lastTime + 1, rawRelativeTime);
      lastTime = t;
      return {
        ...point,
        x: (point.x - cluster.bbox.x + padding) * scale,
        y: (point.y - cluster.bbox.y + padding) * scale,
        t,
        pageNumber: cluster.pageNumber,
        pageWidth: writingArea.width,
        pageHeight: writingArea.height,
      };
    });
    const points = resampleRecognitionPoints(transformedPoints);
    lastTime += strokeIndex === cluster.strokes.length - 1 ? 0 : 24;
    return {
      ...stroke,
      points,
      pageNumber: cluster.pageNumber,
      pageWidth: writingArea.width,
      pageHeight: writingArea.height,
    };
  });

  return { strokes, writingArea, scale, padding };
}
