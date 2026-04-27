import getStroke, { StrokeOptions } from 'perfect-freehand';
import { InkPoint, InkStroke, InkTextAnnotation, SelectionRect } from './ui-types';
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

function getStrokeOptions(style: InkStroke['style'], width: number, complete: boolean): StrokeOptions {
  if (style === 'highlight') {
    return {
      size: Math.max(16, width),
      thinning: -0.2,
      smoothing: 0.8,
      streamline: 0.6,
      simulatePressure: false,
      start: { cap: true, taper: 0 },
      end: { cap: true, taper: 0 },
      last: complete,
    };
  }

  return {
    size: Math.max(2, width),
    thinning: 0.4,
    smoothing: 0.5,
    streamline: 0.6,
    simulatePressure: true,
    start: { cap: true, taper: 10, easing: (t) => t },
    end: { cap: true, taper: 10, easing: (t) => t },
    last: complete,
  };
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
    getStrokeOptions(style, stroke.width, complete),
  );

  return getSvgPathFromOutline(outline as number[][]);
}

export function resolveInkStrokeAppearance(tool: 'pen' | 'highlight', color: string, width: number) {
  if (tool === 'highlight') {
    return {
      color: hexToRgba(color, 0.34),
      width: Math.max(14, width * 2.8),
    };
  }

  return {
    color,
    width: Math.max(2, width * 1.3),
  };
}
