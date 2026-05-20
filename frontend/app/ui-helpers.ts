import getStroke, { StrokeOptions } from 'perfect-freehand';
import { InkBrush, InkBrushSettings, InkPoint, InkShape, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from './ui-types';
import { DocumentPageView, GeneratedWorkspacePage, TimetableEntry } from './types';

export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;
export const DAY_LABEL = { MON: '월', TUE: '화', WED: '수', THU: '목', FRI: '금' } as const;
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];

export function visibleHours(entries: TimetableEntry[]) {
  const latest = entries.reduce((max, entry) => Math.max(max, entry.startHour + entry.duration), 16);
  const endHour = Math.min(20, Math.max(16, Math.ceil(latest)));
  return HOURS.filter((hour) => hour <= endHour);
}

export function darkenHex(hex: string, amount = 0.2) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const r = Math.max(0, Math.min(255, Math.round(parseInt(full.slice(0, 2), 16) * (1 - amount))));
  const g = Math.max(0, Math.min(255, Math.round(parseInt(full.slice(2, 4), 16) * (1 - amount))));
  const b = Math.max(0, Math.min(255, Math.round(parseInt(full.slice(4, 6), 16) * (1 - amount))));
  return `rgb(${r}, ${g}, ${b})`;
}

export function hexToRgba(hex: string, alpha: number) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function currentSubjectId(entries: TimetableEntry[]) {
  const now = new Date();
  const day = DAYS[now.getDay() - 1];
  const hour = now.getHours() + now.getMinutes() / 60;
  return entries.find((entry) => entry.day === day && hour >= entry.startHour && hour < entry.startHour + entry.duration)?.subjectId ?? null;
}

export function isSameDocumentPage(left: DocumentPageView | null | undefined, right: DocumentPageView | null | undefined) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'pdf' && right.kind === 'pdf') return left.pageNumber === right.pageNumber;
  if (left.kind === 'generated' && right.kind === 'generated') return left.pageId === right.pageId;
  return false;
}

export function getDocumentPageLabel(props: {
  page: DocumentPageView;
  pages: DocumentPageView[];
  memoPages: GeneratedWorkspacePage[];
  pdfSuffix?: string;
  generatedFallback?: string;
}) {
  if (props.page.kind === 'pdf') {
    return props.pdfSuffix ? `${props.page.pageNumber} ${props.pdfSuffix}` : `${props.page.pageNumber} 페이지`;
  }

  let generatedCount = 0;
  let lastPdfPage = 1;

  for (const page of props.pages) {
    if (page.kind === 'pdf') {
      lastPdfPage = page.pageNumber;
      generatedCount = 0;
      continue;
    }

    generatedCount += 1;
    if (page.pageId === props.page.pageId) {
      const isMemo = props.memoPages.some((memoPage) => memoPage.id === page.pageId);
      return `${lastPdfPage}-${generatedCount} ${isMemo ? '메모' : '정리'}`;
    }
  }

  return props.generatedFallback ?? '생성된 페이지';
}

export function cleanAiDisplayText(value: string | null | undefined) {
  const text = (value ?? '').trim();
  if (!text) return '';

  return text
    .replace(/\b(?:[A-F0-9]{2}[-_]){6,}[A-F0-9]{2}(?:\.(?:jpe?g|png|heic|heif))?/gi, '이 사진')
    .replace(/\b[a-f0-9]{24,}[-_][^\s]+?\.(?:jpe?g|png|heic|heif)\b/gi, '이 사진')
    .replace(/이 사진\s+원본 사진입니다\.?/g, '수업 중 촬영한 원본 사진입니다.')
    .replace(/PDF\s*(내용|본문|텍스트)이 아직 추출되지 않아/g, 'PDF 본문 분석이 아직 준비되지 않아')
    .replace(/PDF\s*(내용|본문|텍스트)이 아직 추출되지 않았/g, 'PDF 본문 분석이 아직 준비되지 않았')
    .replace(/PDF\s*(내용|본문|텍스트)가 추출되면/g, 'PDF 본문 분석이 준비되면')
    .replace(/추출된 PDF\s*(내용|본문|텍스트)/g, '분석된 PDF 본문')
    .replace(/PDF\s*(내용|본문|텍스트)\s*추출/g, 'PDF 본문 분석')
    .replace(/\*\*/g, '')
    .replace(/^\s*[*-]\s+/gm, '• ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function derivePreprocessedCropUrl(url: string | null | undefined) {
  if (!url) return null;

  const marker = '/scan_enhance/';
  const markerIndex = url.indexOf(marker);
  if (markerIndex < 0) return null;

  const filename = url.slice(markerIndex + marker.length);
  if (!filename.endsWith('_crop_enhanced_color.jpg')) return null;

  return `${url.slice(0, markerIndex)}/crop/${filename.replace(/_crop_enhanced_color\.jpg$/, '_crop.jpg')}`;
}

function distanceToSegment(point: InkPoint, start: InkPoint, end: InkPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }

  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  const projectionX = start.x + t * dx;
  const projectionY = start.y + t * dy;
  return Math.hypot(point.x - projectionX, point.y - projectionY);
}

export function findHitInkStrokeId(strokes: InkStroke[], point: InkPoint, tolerance = 18) {
  for (let strokeIndex = strokes.length - 1; strokeIndex >= 0; strokeIndex -= 1) {
    const stroke = strokes[strokeIndex];
    const threshold = Math.max(tolerance, stroke.width * 2.5);

    if (stroke.style === 'shape') {
      const rect = getInkStrokeBounds(stroke);
      if (!rect) continue;
      const inLooseBounds =
        point.x >= rect.x - threshold &&
        point.x <= rect.x + rect.width + threshold &&
        point.y >= rect.y - threshold &&
        point.y <= rect.y + rect.height + threshold;
      if (!inLooseBounds) continue;
      if (stroke.shape === 'rect' || stroke.shape === 'ellipse') return stroke.id;
      if (stroke.points.length >= 2 && distanceToSegment(point, stroke.points[0], stroke.points[stroke.points.length - 1]) <= threshold) {
        return stroke.id;
      }
      continue;
    }

    if (stroke.points.length === 1) {
      if (Math.hypot(point.x - stroke.points[0].x, point.y - stroke.points[0].y) <= threshold) {
        return stroke.id;
      }
      continue;
    }

    for (let pointIndex = 0; pointIndex < stroke.points.length - 1; pointIndex += 1) {
      if (distanceToSegment(point, stroke.points[pointIndex], stroke.points[pointIndex + 1]) <= threshold) {
        return stroke.id;
      }
    }
  }

  return null;
}

function resolveScale(sourceWidth: number | undefined, sourceHeight: number | undefined, targetWidth: number, targetHeight: number) {
  const widthScale = sourceWidth && sourceWidth > 0 ? targetWidth / sourceWidth : 1;
  const heightScale = sourceHeight && sourceHeight > 0 ? targetHeight / sourceHeight : 1;
  return { widthScale, heightScale };
}

export function scaleInkStrokeToPageSize(stroke: InkStroke, pageWidth: number, pageHeight: number): InkStroke {
  const { widthScale, heightScale } = resolveScale(stroke.pageWidth, stroke.pageHeight, pageWidth, pageHeight);
  const widthRatio = (widthScale + heightScale) / 2;

  if (widthScale === 1 && heightScale === 1) return stroke;

  return {
    ...stroke,
    width: stroke.width * widthRatio,
    pageWidth,
    pageHeight,
    points: stroke.points.map((point) => ({
      ...point,
      x: point.x * widthScale,
      y: point.y * heightScale,
      pageWidth,
      pageHeight,
    })),
  };
}

export function isShapeTool(tool: InkTool): tool is InkShape {
  return tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'ellipse';
}

export function isDrawingTool(tool: InkTool) {
  return tool === 'pen' || tool === 'highlight' || isShapeTool(tool);
}

export function getInkStrokeBounds(stroke: InkStroke): SelectionRect | null {
  if (!stroke.points.length) return null;
  const xs = stroke.points.map((point) => point.x);
  const ys = stroke.points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return {
    x,
    y,
    width: Math.max(1, Math.max(...xs) - x),
    height: Math.max(1, Math.max(...ys) - y),
    pageWidth: stroke.pageWidth,
    pageHeight: stroke.pageHeight,
  };
}

export function scaleSelectionRectToPageSize(rect: SelectionRect | null, pageWidth: number, pageHeight: number): SelectionRect | null {
  if (!rect) return null;
  const { widthScale, heightScale } = resolveScale(rect.pageWidth, rect.pageHeight, pageWidth, pageHeight);

  if (widthScale === 1 && heightScale === 1) return rect;

  return {
    ...rect,
    x: rect.x * widthScale,
    y: rect.y * heightScale,
    width: rect.width * widthScale,
    height: rect.height * heightScale,
    pageWidth,
    pageHeight,
  };
}

export function scaleTextAnnotationToPageSize(annotation: InkTextAnnotation, pageWidth: number, pageHeight: number): InkTextAnnotation {
  const { widthScale, heightScale } = resolveScale(annotation.pageWidth, annotation.pageHeight, pageWidth, pageHeight);

  if (widthScale === 1 && heightScale === 1) return annotation;

  return {
    ...annotation,
    x: annotation.x * widthScale,
    y: annotation.y * heightScale,
    width: annotation.width * widthScale,
    pageWidth,
    pageHeight,
    anchorRect: scaleSelectionRectToPageSize(annotation.anchorRect ?? null, pageWidth, pageHeight),
  };
}

export function findInkStrokesInRect(strokes: InkStroke[], rect: { x: number; y: number; width: number; height: number }): string[] {
  const selectedIds: string[] = [];

  for (const stroke of strokes) {
    const bounds = getInkStrokeBounds(stroke);
    if (bounds) {
      const overlaps =
        bounds.x <= rect.x + rect.width &&
        bounds.x + bounds.width >= rect.x &&
        bounds.y <= rect.y + rect.height &&
        bounds.y + bounds.height >= rect.y;
      if (overlaps) {
        selectedIds.push(stroke.id);
        continue;
      }
    }

    // 모든 점이 사각형 안에 있는지 확인 (또는 일부 점이라도 있는지)
    // 여기서는 선의 일부라도 포함되면 선택되도록 합니다.
    let isInside = false;
    for (const point of stroke.points) {
      if (
        point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
      ) {
        isInside = true;
        break;
      }
    }
    if (isInside) {
      selectedIds.push(stroke.id);
    }
  }

  return selectedIds;
}

function average(a: number, b: number) {
  return (a + b) / 2;
}

function getSvgPathFromOutline(points: number[][], closed = true) {
  const len = points.length;

  if (len < 4) {
    return '';
  }

  let a = points[0];
  let b = points[1];
  const c = points[2];

  let result = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(b[0], c[0]).toFixed(2)},${average(
    b[1],
    c[1],
  ).toFixed(2)} T`;

  for (let i = 2; i < len - 1; i += 1) {
    a = points[i];
    b = points[i + 1];
    result += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `;
  }

  if (closed) {
    result += 'Z';
  }

  return result;
}

function clampRatio(value: number | undefined, fallback: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(1, value / 100));
}

function applyBrushSettings(options: StrokeOptions, settings?: InkBrushSettings): StrokeOptions {
  if (!settings) return options;

  const stability = clampRatio(settings.stability, 0.58);
  const sharpness = clampRatio(settings.sharpness, 0.5);
  const density = clampRatio(settings.density, 1);
  const pressure = clampRatio(settings.pressure, 0.55);
  const taperRatio = 1.25 - sharpness * 0.7;

  const applyTaper = (cap: StrokeOptions['start']) => {
    if (!cap || typeof cap !== 'object') return cap;
    return {
      ...cap,
      taper: typeof cap.taper === 'number' ? cap.taper * taperRatio : cap.taper,
    };
  };

  return {
    ...options,
    size: (options.size ?? 1) * (0.85 + density * 0.28),
    thinning: (options.thinning ?? 0) * (0.35 + pressure * 0.95),
    smoothing: Math.max(0.2, Math.min(0.98, 0.24 + stability * 0.7)),
    streamline: Math.max(0.08, Math.min(0.9, 0.14 + stability * 0.72)),
    start: applyTaper(options.start),
    end: applyTaper(options.end),
  };
}

function getStrokeOptions(style: InkStroke['style'], width: number, complete: boolean, brush: InkBrush = 'ballpoint', settings?: InkBrushSettings): StrokeOptions {
  if (style === 'highlight') {
    return applyBrushSettings({
      size: Math.max(16, width),
      thinning: -0.2,
      smoothing: 0.9,
      streamline: 0.72,
      simulatePressure: false,
      start: { cap: true, taper: 0 },
      end: { cap: true, taper: 0 },
      last: complete,
    }, settings);
  }

  if (brush === 'fountain') {
    return applyBrushSettings({
      size: Math.max(2, width),
      thinning: 0.82,
      smoothing: 0.62,
      streamline: 0.48,
      simulatePressure: true,
      start: { cap: true, taper: 16, easing: (t) => t },
      end: { cap: true, taper: 18, easing: (t) => t },
      last: complete,
    }, settings);
  }

  if (brush === 'pencil') {
    return applyBrushSettings({
      size: Math.max(2, width),
      thinning: 0.66,
      smoothing: 0.42,
      streamline: 0.3,
      simulatePressure: true,
      start: { cap: true, taper: 8, easing: (t) => t },
      end: { cap: true, taper: 12, easing: (t) => t },
      last: complete,
    }, settings);
  }

  if (brush === 'marker') {
    return applyBrushSettings({
      size: Math.max(5, width * 1.25),
      thinning: 0.05,
      smoothing: 0.74,
      streamline: 0.72,
      simulatePressure: false,
      start: { cap: true, taper: 0 },
      end: { cap: true, taper: 0 },
      last: complete,
    }, settings);
  }

  return applyBrushSettings({
    size: Math.max(2, width),
    thinning: 0.48,
    smoothing: 0.58,
    streamline: 0.58,
    simulatePressure: true,
    start: { cap: true, taper: 10, easing: (t) => t },
    end: { cap: true, taper: 10, easing: (t) => t },
    last: complete,
  }, settings);
}

export function getInkCenterlinePath(points: InkPoint[]) {
  if (points.length === 0) {
    return '';
  }

  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    path += ` Q ${points[i].x} ${points[i].y}, ${midX} ${midY}`;
  }

  const lastPoint = points[points.length - 1];
  path += ` L ${lastPoint.x} ${lastPoint.y}`;

  return path;
}

export function getInkStrokeSvgPath(stroke: InkStroke, complete = true) {
  if (stroke.points.length === 0) {
    return '';
  }

  if (stroke.style === 'shape') {
    const start = stroke.points[0];
    const end = stroke.points[stroke.points.length - 1] ?? start;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    if (stroke.shape === 'rect') {
      return `M ${x} ${y} H ${x + width} V ${y + height} H ${x} Z`;
    }

    if (stroke.shape === 'ellipse') {
      const rx = Math.max(1, width / 2);
      const ry = Math.max(1, height / 2);
      const cx = x + rx;
      const cy = y + ry;
      return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
    }

    if (stroke.shape === 'arrow') {
      const angle = Math.atan2(end.y - start.y, end.x - start.x);
      const headLength = Math.max(12, stroke.width * 4);
      const leftX = end.x - headLength * Math.cos(angle - Math.PI / 6);
      const leftY = end.y - headLength * Math.sin(angle - Math.PI / 6);
      const rightX = end.x - headLength * Math.cos(angle + Math.PI / 6);
      const rightY = end.y - headLength * Math.sin(angle + Math.PI / 6);
      return `M ${start.x} ${start.y} L ${end.x} ${end.y} M ${end.x} ${end.y} L ${leftX} ${leftY} M ${end.x} ${end.y} L ${rightX} ${rightY}`;
    }

    return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
  }

  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    const radius = Math.max(1.2, stroke.width / 2);
    return [
      `M ${point.x - radius} ${point.y}`,
      `a ${radius} ${radius} 0 1 0 ${radius * 2} 0`,
      `a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`,
    ].join(' ');
  }

  const style = stroke.style ?? 'pen';
  const outline = getStroke(
    stroke.points.map((point) => [point.x, point.y]),
    getStrokeOptions(style, stroke.width, complete, stroke.brush, stroke.brushSettings),
  );

  return getSvgPathFromOutline(outline as number[][]);
}

export function resolveInkStrokeAppearance(tool: 'pen' | 'highlight', color: string, width: number, brush: InkBrush = tool === 'highlight' ? 'highlighter' : 'ballpoint') {
  if (tool === 'highlight') {
    return {
      color: hexToRgba(color, 0.34),
      width: Math.max(14, width * 2.8),
    };
  }

  if (brush === 'pencil') {
    return {
      color: hexToRgba(color, 0.74),
      width: Math.max(2, width * 1.08),
    };
  }

  if (brush === 'fountain') {
    return {
      color,
      width: Math.max(2, width * 1.42),
    };
  }

  if (brush === 'marker') {
    return {
      color: hexToRgba(color, 0.82),
      width: Math.max(5, width * 2.1),
    };
  }

  return {
    color,
    width: Math.max(2, width * 1.3),
  };
}

export function resolveShapeStrokeAppearance(color: string, width: number) {
  return {
    color,
    width: Math.max(2, width * 1.15),
  };
}
