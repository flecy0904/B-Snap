import { useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { DocumentPageView, GeneratedWorkspacePage, StudyDocumentEntry } from '../../../types';
import type { InkEraserMode, InkImageAnnotation, InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { doesRectIntersectPolygon, findHitInkStrokeId, findInkStrokesInLasso, findInkStrokesInRect, scaleInkStrokeToPageSize } from '../../../ui-helpers';
import { isInkStrokeOnPage, scopeInkStrokeToPage } from './ink-helpers';

type SetState<T> = Dispatch<SetStateAction<T>>;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export type WorkspaceEditSnapshot = {
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  imageAnnotations: InkImageAnnotation[];
  selectionRect: SelectionRect | null;
  generatedPages?: GeneratedWorkspacePage[];
  activePage?: DocumentPageView;
};

export function useInkActions(params: {
  studyDocumentId: number | null;
  studyDocument: StudyDocumentEntry | null;
  currentDocumentPage: DocumentPageView | null;
  currentPdfPage: number;
  selectionRect: SelectionRect | null;
  selectionByDocument: Record<number, SelectionRect | null>;
  inkByDocument: Record<number, InkStroke[]>;
  textAnnotationsByDocument: Record<number, InkTextAnnotation[]>;
  imageAnnotationsByDocument: Record<number, InkImageAnnotation[]>;
  generatedPagesByDocument?: Record<number, GeneratedWorkspacePage[]>;
  activePageByDocument?: Record<number, DocumentPageView>;
  inkHistoryByDocument: Record<number, WorkspaceEditSnapshot[]>;
  redoInkHistoryByDocument: Record<number, WorkspaceEditSnapshot[]>;
  setInkByDocument: SetState<Record<number, InkStroke[]>>;
  setRedoInkByDocument: SetState<Record<number, InkStroke[]>>;
  setInkHistoryByDocument: SetState<Record<number, WorkspaceEditSnapshot[]>>;
  setRedoInkHistoryByDocument: SetState<Record<number, WorkspaceEditSnapshot[]>>;
  setTextAnnotationsByDocument: SetState<Record<number, InkTextAnnotation[]>>;
  setImageAnnotationsByDocument: SetState<Record<number, InkImageAnnotation[]>>;
  setGeneratedPagesByDocument?: SetState<Record<number, GeneratedWorkspacePage[]>>;
  setActivePageByDocument?: SetState<Record<number, DocumentPageView>>;
  setSelectionByDocument: SetState<Record<number, SelectionRect | null>>;
  setSelectionPreviewByDocument: SetState<Record<number, string | null>>;
  setInkTool: SetState<InkTool>;
  setWorkspaceFeedback: SetState<string | null>;
  onMarkPageDirty?: (documentId: number, pageNumber: number) => void;
}) {
  const textEditHistoryTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const textFrameHistoryTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const isStrokeOnCurrentPage = (stroke: InkStroke) => (
    isInkStrokeOnPage({
      stroke,
      currentDocumentPage: params.currentDocumentPage,
      currentPdfPage: params.currentPdfPage,
      studyDocumentType: params.studyDocument?.type,
    })
  );

  const getSelectionPageScope = () => {
    const selection = params.selectionRect;
    const pathPoint = selection?.path?.find((point) => point.generatedPageId || typeof point.pageNumber === 'number');
    return {
      generatedPageId: selection?.generatedPageId ?? pathPoint?.generatedPageId,
      pageNumber: selection?.pageNumber ?? pathPoint?.pageNumber,
    };
  };

  const getPageStrokesForSelection = () => {
    if (!params.studyDocumentId) return [];
    const currentStrokes = params.inkByDocument[params.studyDocumentId] ?? [];
    const selectionScope = getSelectionPageScope();
    return currentStrokes.filter((stroke) => (
      selectionScope.generatedPageId
        ? stroke.generatedPageId === selectionScope.generatedPageId
        : (
            !stroke.generatedPageId &&
            (typeof selectionScope.pageNumber === 'number'
              ? (
                  params.studyDocument?.type === 'blank'
                    ? (stroke.pageNumber ?? 1) === selectionScope.pageNumber
                    : (!stroke.pageNumber || stroke.pageNumber === selectionScope.pageNumber)
                )
              : (
                  params.currentDocumentPage?.kind === 'generated'
                    ? stroke.generatedPageId === params.currentDocumentPage.pageId
                    : (
                        params.studyDocument?.type === 'blank'
                          ? (stroke.pageNumber ?? 1) === params.currentPdfPage
                          : (!stroke.pageNumber || stroke.pageNumber === params.currentPdfPage)
                      )
                ))
          )
    ));
  };

  const getSelectedStrokeIds = () => {
    if (!params.selectionRect) return new Set<string>();
    const pageStrokes = getPageStrokesForSelection();
    const hitTestStrokes =
      params.selectionRect.pageWidth && params.selectionRect.pageHeight
        ? pageStrokes.map((stroke) => scaleInkStrokeToPageSize(stroke, params.selectionRect!.pageWidth!, params.selectionRect!.pageHeight!))
        : pageStrokes;
    if (params.selectionRect.path && params.selectionRect.path.length > 2) {
      return new Set(findInkStrokesInLasso(hitTestStrokes, params.selectionRect.path));
    }
    return new Set(findInkStrokesInRect(hitTestStrokes, params.selectionRect));
  };

  const getPageTextAnnotationsForSelection = () => {
    if (!params.studyDocumentId) return [];
    const annotations = params.textAnnotationsByDocument[params.studyDocumentId] ?? [];
    const selectionScope = getSelectionPageScope();
    return annotations.filter((annotation) => (
      selectionScope.generatedPageId
        ? annotation.generatedPageId === selectionScope.generatedPageId
        : (
            !annotation.generatedPageId &&
            (typeof selectionScope.pageNumber === 'number'
              ? (
                  params.studyDocument?.type === 'blank'
                    ? (annotation.pageNumber ?? 1) === selectionScope.pageNumber
                    : annotation.pageNumber === selectionScope.pageNumber
                )
              : (
                  params.currentDocumentPage?.kind === 'generated'
                    ? annotation.generatedPageId === params.currentDocumentPage.pageId
                    : (
                        params.studyDocument?.type === 'blank'
                          ? (annotation.pageNumber ?? 1) === params.currentPdfPage
                          : annotation.pageNumber === params.currentPdfPage
                      )
                ))
          )
    ));
  };

  const getPageImageAnnotationsForSelection = () => {
    if (!params.studyDocumentId) return [];
    const annotations = params.imageAnnotationsByDocument[params.studyDocumentId] ?? [];
    const selectionScope = getSelectionPageScope();
    return annotations.filter((annotation) => (
      selectionScope.generatedPageId
        ? annotation.generatedPageId === selectionScope.generatedPageId
        : (
            !annotation.generatedPageId &&
            (typeof selectionScope.pageNumber === 'number'
              ? (
                  params.studyDocument?.type === 'blank'
                    ? (annotation.pageNumber ?? 1) === selectionScope.pageNumber
                    : annotation.pageNumber === selectionScope.pageNumber
                )
              : (
                  params.currentDocumentPage?.kind === 'generated'
                    ? annotation.generatedPageId === params.currentDocumentPage.pageId
                    : (
                        params.studyDocument?.type === 'blank'
                          ? (annotation.pageNumber ?? 1) === params.currentPdfPage
                          : annotation.pageNumber === params.currentPdfPage
                      )
                ))
          )
    ));
  };

  const scaleRectToSelection = (rect: SelectionRect): SelectionRect => {
    if (!params.selectionRect?.pageWidth || !params.selectionRect?.pageHeight || !rect.pageWidth || !rect.pageHeight) return rect;
    const widthScale = params.selectionRect.pageWidth / rect.pageWidth;
    const heightScale = params.selectionRect.pageHeight / rect.pageHeight;
    return {
      ...rect,
      x: rect.x * widthScale,
      y: rect.y * heightScale,
      width: rect.width * widthScale,
      height: rect.height * heightScale,
      pageWidth: params.selectionRect.pageWidth,
      pageHeight: params.selectionRect.pageHeight,
    };
  };

  const getAnnotationSelectionRect = (annotation: InkTextAnnotation): SelectionRect => (
    annotation.anchorRect
      ? scaleRectToSelection(annotation.anchorRect)
      : scaleRectToSelection({
          x: annotation.x,
          y: annotation.y,
          width: annotation.width,
          height: annotation.height ?? 96,
          pageWidth: annotation.pageWidth,
          pageHeight: annotation.pageHeight,
        })
  );

  const getImageAnnotationSelectionRect = (annotation: InkImageAnnotation): SelectionRect => (
    scaleRectToSelection({
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
      pageWidth: annotation.pageWidth,
      pageHeight: annotation.pageHeight,
    })
  );

  const rectsOverlap = (left: SelectionRect, right: SelectionRect) => (
    left.x <= right.x + right.width &&
    left.x + left.width >= right.x &&
    left.y <= right.y + right.height &&
    left.y + left.height >= right.y
  );

  const distanceToSegment = (point: InkPoint, start: InkPoint, end: InkPoint) => {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
    const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
  };

  const isStrokeOnPointPage = (stroke: InkStroke, point: InkPoint) => {
    if (point.generatedPageId) return stroke.generatedPageId === point.generatedPageId;
    if (stroke.generatedPageId) return false;
    const targetPage = point.pageNumber ?? params.currentPdfPage;
    return !stroke.pageNumber || stroke.pageNumber === targetPage;
  };

  const scalePointToStrokeSpace = (point: InkPoint, stroke: InkStroke): InkPoint => {
    const pointWidth = point.pageWidth;
    const pointHeight = point.pageHeight;
    const strokeWidth = stroke.pageWidth;
    const strokeHeight = stroke.pageHeight;
    if (!pointWidth || !pointHeight || !strokeWidth || !strokeHeight) return point;
    if (pointWidth === strokeWidth && pointHeight === strokeHeight) return point;
    return {
      ...point,
      x: point.x / pointWidth * strokeWidth,
      y: point.y / pointHeight * strokeHeight,
      pageWidth: strokeWidth,
      pageHeight: strokeHeight,
    };
  };

  const scaleRadiusToStrokeSpace = (radius: number, point: InkPoint, stroke: InkStroke) => {
    const pointWidth = point.pageWidth;
    const pointHeight = point.pageHeight;
    const strokeWidth = stroke.pageWidth;
    const strokeHeight = stroke.pageHeight;
    if (!pointWidth || !pointHeight || !strokeWidth || !strokeHeight) return radius;
    const widthScale = strokeWidth / pointWidth;
    const heightScale = strokeHeight / pointHeight;
    return radius * Math.max(0.25, Math.min(4, (widthScale + heightScale) / 2));
  };

  const interpolateStrokePoint = (start: InkPoint, end: InkPoint, ratio: number): InkPoint => ({
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
    pageNumber: end.pageNumber ?? start.pageNumber,
    generatedPageId: end.generatedPageId ?? start.generatedPageId,
    pageWidth: end.pageWidth ?? start.pageWidth,
    pageHeight: end.pageHeight ?? start.pageHeight,
  });

  const appendChunkPoint = (chunk: InkPoint[], point: InkPoint) => {
    const previous = chunk[chunk.length - 1];
    if (previous && Math.hypot(previous.x - point.x, previous.y - point.y) < 0.75) return;
    chunk.push(point);
  };

  const getChunkLength = (points: InkPoint[]) => {
    let length = 0;
    for (let index = 1; index < points.length; index += 1) {
      length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
    }
    return length;
  };

  const shouldKeepErasedChunk = (stroke: InkStroke, points: InkPoint[]) => (
    points.length > 1 && getChunkLength(points) >= Math.max(3, stroke.width * 0.45)
  );

  const splitStrokeByEraser = (stroke: InkStroke, point: InkPoint, radius: number): InkStroke[] | null => {
    if (!isStrokeOnPointPage(stroke, point)) return null;
    const hitRadius = radius + Math.max(1, stroke.width) * 0.45;
    if (stroke.points.length <= 1) {
      if (stroke.points[0] && Math.hypot(stroke.points[0].x - point.x, stroke.points[0].y - point.y) <= hitRadius) return [];
      return null;
    }
    if (!stroke.points.some((strokePoint, index) => {
      if (Math.hypot(strokePoint.x - point.x, strokePoint.y - point.y) <= hitRadius) return true;
      const previous = stroke.points[index - 1];
      return Boolean(previous && distanceToSegment(point, previous, strokePoint) <= hitRadius);
    })) {
      return null;
    }

    let changed = false;
    const chunks: InkPoint[][] = [];
    let currentChunk: InkPoint[] = [];

    stroke.points.forEach((strokePoint, index) => {
      if (index === 0) {
        if (Math.hypot(strokePoint.x - point.x, strokePoint.y - point.y) > hitRadius) {
          currentChunk.push(strokePoint);
        } else {
          changed = true;
        }
        return;
      }

      const previous = stroke.points[index - 1];
      const segmentLength = Math.hypot(strokePoint.x - previous.x, strokePoint.y - previous.y);
      const sampleCount = Math.max(1, Math.ceil(segmentLength / Math.max(3, radius / 2)));

      for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex += 1) {
        const samplePoint = sampleIndex === sampleCount
          ? strokePoint
          : interpolateStrokePoint(previous, strokePoint, sampleIndex / sampleCount);
        if (Math.hypot(samplePoint.x - point.x, samplePoint.y - point.y) <= hitRadius) {
          changed = true;
          if (shouldKeepErasedChunk(stroke, currentChunk)) chunks.push(currentChunk);
          currentChunk = [];
          continue;
        }
        appendChunkPoint(currentChunk, samplePoint);
      }
    });
    if (shouldKeepErasedChunk(stroke, currentChunk)) chunks.push(currentChunk);
    if (!changed) return null;

    const timestamp = Date.now();
    return chunks.map((chunk, index) => ({
      ...stroke,
      id: `${stroke.id}-erase-${timestamp}-${index}`,
      points: chunk,
    }));
  };

  const eraseStrokesAtPoint = (strokes: InkStroke[], point: InkPoint, radius: number, mode: InkEraserMode = 'partial') => {
    if (mode === 'stroke') {
      const targetWidth = point.pageWidth;
      const targetHeight = point.pageHeight;
      const hitStrokeId = findHitInkStrokeId(
        strokes
          .filter((stroke) => isStrokeOnPointPage(stroke, point))
          .map((stroke) => (
            targetWidth && targetHeight
              ? scaleInkStrokeToPageSize(stroke, targetWidth, targetHeight)
              : stroke
          )),
        point,
        radius,
      );
      return hitStrokeId ? strokes.filter((stroke) => stroke.id !== hitStrokeId) : strokes;
    }

    let changed = false;
    const nextStrokes: InkStroke[] = [];

    strokes.forEach((stroke) => {
      const pointForStroke = scalePointToStrokeSpace(point, stroke);
      const radiusForStroke = scaleRadiusToStrokeSpace(radius, point, stroke);
      if (stroke.style === 'shape') {
        const hitShape = findHitInkStrokeId(
          isStrokeOnPointPage(stroke, pointForStroke) ? [stroke] : [],
          pointForStroke,
          radiusForStroke,
        );
        if (hitShape) {
          changed = true;
          return;
        }
        nextStrokes.push(stroke);
        return;
      }
      const split = splitStrokeByEraser(stroke, pointForStroke, radiusForStroke);
      if (!split) {
        nextStrokes.push(stroke);
        return;
      }
      changed = true;
      nextStrokes.push(...split);
    });

    return changed ? nextStrokes : strokes;
  };

  const getSelectedTextAnnotationIds = () => {
    if (!params.selectionRect) return new Set<string>();
    const selectionPath = params.selectionRect.path;
    if (selectionPath && selectionPath.length > 2) {
      return new Set(
        getPageTextAnnotationsForSelection()
          .filter((annotation) => doesRectIntersectPolygon(getAnnotationSelectionRect(annotation), selectionPath))
          .map((annotation) => annotation.id),
      );
    }
    return new Set(
      getPageTextAnnotationsForSelection()
        .filter((annotation) => rectsOverlap(getAnnotationSelectionRect(annotation), params.selectionRect!))
        .map((annotation) => annotation.id),
    );
  };

  const getSelectedImageAnnotationIds = () => {
    if (!params.selectionRect) return new Set<string>();
    const selectionPath = params.selectionRect.path;
    if (selectionPath && selectionPath.length > 2) {
      return new Set(
        getPageImageAnnotationsForSelection()
          .filter((annotation) => doesRectIntersectPolygon(getImageAnnotationSelectionRect(annotation), selectionPath))
          .map((annotation) => annotation.id),
      );
    }
    return new Set(
      getPageImageAnnotationsForSelection()
        .filter((annotation) => rectsOverlap(getImageAnnotationSelectionRect(annotation), params.selectionRect!))
        .map((annotation) => annotation.id),
    );
  };

  const clearCurrentSelection = () => {
    if (!params.studyDocumentId) return;
    params.setSelectionByDocument((current) => ({ ...current, [params.studyDocumentId!]: null }));
    params.setSelectionPreviewByDocument((current) => ({ ...current, [params.studyDocumentId!]: null }));
  };

  const markPageDirty = (pageNumber?: number | null) => {
    if (!params.studyDocumentId || !pageNumber || params.currentDocumentPage?.kind === 'generated') return;
    params.onMarkPageDirty?.(params.studyDocumentId, pageNumber);
  };

  const markCurrentPageDirty = () => {
    markPageDirty(params.currentDocumentPage?.kind === 'pdf' ? params.currentDocumentPage.pageNumber : params.currentPdfPage);
  };

  const markSelectionPageDirty = () => {
    const selectionScope = getSelectionPageScope();
    markPageDirty(selectionScope.generatedPageId ? null : selectionScope.pageNumber ?? params.currentPdfPage);
  };

  const getCurrentSnapshot = (): WorkspaceEditSnapshot => ({
    inkStrokes: params.studyDocumentId ? (params.inkByDocument[params.studyDocumentId] ?? []) : [],
    textAnnotations: params.studyDocumentId ? (params.textAnnotationsByDocument[params.studyDocumentId] ?? []) : [],
    imageAnnotations: params.studyDocumentId ? (params.imageAnnotationsByDocument[params.studyDocumentId] ?? []) : [],
    selectionRect: params.selectionRect ?? null,
    generatedPages: params.studyDocumentId ? params.generatedPagesByDocument?.[params.studyDocumentId] : undefined,
    activePage: params.studyDocumentId ? params.activePageByDocument?.[params.studyDocumentId] : undefined,
  });

  const applySnapshot = (snapshot: WorkspaceEditSnapshot) => {
    if (!params.studyDocumentId) return;
    params.setInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: snapshot.inkStrokes,
    }));
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: snapshot.textAnnotations,
    }));
    params.setImageAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: snapshot.imageAnnotations,
    }));
    params.setSelectionByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: snapshot.selectionRect,
    }));
    if (snapshot.generatedPages && params.setGeneratedPagesByDocument) {
      params.setGeneratedPagesByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: snapshot.generatedPages!,
      }));
    }
    if (snapshot.activePage && params.setActivePageByDocument) {
      params.setActivePageByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: snapshot.activePage!,
      }));
    }
  };

  const pushInkHistorySnapshot = () => {
    if (!params.studyDocumentId) return;
    const snapshot = getCurrentSnapshot();
    params.setInkHistoryByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []).slice(-39), snapshot],
    }));
    params.setRedoInkHistoryByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
  };

  const clearInk = () => {
    if (!params.studyDocumentId) return;
    const currentPageStrokes = (params.inkByDocument[params.studyDocumentId] ?? []).filter(isStrokeOnCurrentPage);
    if (!currentPageStrokes.length) return;
    pushInkHistorySnapshot();
    params.setInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((stroke) => !isStrokeOnCurrentPage(stroke)),
    }));
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((stroke) => !isStrokeOnCurrentPage(stroke)),
    }));
    markCurrentPageDirty();
  };

  const undoInk = () => {
    if (!params.studyDocumentId) return;
    const documentHistory = params.inkHistoryByDocument[params.studyDocumentId] ?? [];
    if (documentHistory.length > 0) {
      const previousSnapshot = documentHistory[documentHistory.length - 1];
      const currentSnapshot = getCurrentSnapshot();
      params.setRedoInkHistoryByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []).slice(-39), currentSnapshot],
      }));
      params.setInkHistoryByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).slice(0, -1),
      }));
      applySnapshot(previousSnapshot);
      markCurrentPageDirty();
      params.setWorkspaceFeedback('이전으로 되돌릴게요.');
      return;
    }

  };

  const redoInk = () => {
    if (!params.studyDocumentId) return;
    const documentRedoHistory = params.redoInkHistoryByDocument[params.studyDocumentId] ?? [];
    if (documentRedoHistory.length > 0) {
      const nextSnapshot = documentRedoHistory[documentRedoHistory.length - 1];
      const currentSnapshot = getCurrentSnapshot();
      params.setInkHistoryByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []).slice(-39), currentSnapshot],
      }));
      params.setRedoInkHistoryByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).slice(0, -1),
      }));
      applySnapshot(nextSnapshot);
      markCurrentPageDirty();
      params.setWorkspaceFeedback('이전 상태를 적용했어요.');
      return;
    }

  };

  const commitInkStroke = (stroke: InkStroke) => {
    if (!params.studyDocumentId) return;
    pushInkHistorySnapshot();
    const scopedStroke = scopeInkStrokeToPage({
      stroke,
      currentDocumentPage: params.currentDocumentPage,
      currentPdfPage: params.currentPdfPage,
    });
    params.setInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []), scopedStroke],
    }));
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    if (!scopedStroke.generatedPageId) markPageDirty(scopedStroke.pageNumber ?? params.currentPdfPage);
  };

  const removeInkStroke = (strokeId: string) => {
    if (!params.studyDocumentId) return;
    const hasStroke = (params.inkByDocument[params.studyDocumentId] ?? []).some((stroke) => stroke.id === strokeId);
    if (!hasStroke) return;
    pushInkHistorySnapshot();
    params.setInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((stroke) => stroke.id !== strokeId),
    }));
    markCurrentPageDirty();
  };

  const replaceInkStrokes = (removedStrokeIds: string[], addedStrokes: InkStroke[]) => {
    if (!params.studyDocumentId) return;
    const removedIds = new Set(removedStrokeIds);
    const currentStrokes = params.inkByDocument[params.studyDocumentId] ?? [];
    const hasRemovedStroke = currentStrokes.some((stroke) => removedIds.has(stroke.id));
    if (!hasRemovedStroke && addedStrokes.length === 0) return;

    pushInkHistorySnapshot();
    const scopedAddedStrokes = addedStrokes.map((stroke) => scopeInkStrokeToPage({
      stroke,
      currentDocumentPage: params.currentDocumentPage,
      currentPdfPage: params.currentPdfPage,
    }));
    params.setInkByDocument((current) => {
      const strokes = current[params.studyDocumentId!] ?? [];
      const next = [
        ...strokes.filter((stroke) => !removedIds.has(stroke.id)),
        ...scopedAddedStrokes,
      ];
      return {
        ...current,
        [params.studyDocumentId!]: next,
      };
    });
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    const dirtyPage = scopedAddedStrokes.find((stroke) => !stroke.generatedPageId)?.pageNumber ?? params.currentPdfPage;
    markPageDirty(dirtyPage);
  };

  const addTextAnnotation = (point: InkPoint) => {
    if (!params.studyDocumentId) return;
    pushInkHistorySnapshot();
    const generatedPageId = point.generatedPageId ?? (params.currentDocumentPage?.kind === 'generated' ? params.currentDocumentPage.pageId : undefined);
    const pageNumber = generatedPageId ? 1 : point.pageNumber ?? (params.currentDocumentPage?.kind === 'pdf' ? params.currentDocumentPage.pageNumber : params.currentPdfPage);
    const anchoredSelection = !generatedPageId && params.studyDocument?.type === 'pdf' ? params.selectionByDocument[params.studyDocumentId] ?? null : null;
    const anchorX = anchoredSelection ? Math.max(18, anchoredSelection.x) : Math.max(18, point.x);
    const anchorY = anchoredSelection ? Math.max(18, anchoredSelection.y) : Math.max(18, point.y);
    const nextAnnotation: InkTextAnnotation = {
      id: `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pageNumber,
      generatedPageId,
      x: anchorX,
      y: anchorY,
      width: 104,
      height: 56,
      fontSize: 17,
      text: '',
      anchorRect: anchoredSelection,
      pageWidth: anchoredSelection?.pageWidth ?? point.pageWidth,
      pageHeight: anchoredSelection?.pageHeight ?? point.pageHeight,
    };
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []), nextAnnotation],
    }));
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    if (anchoredSelection) {
      clearCurrentSelection();
    }
    if (!generatedPageId) markPageDirty(pageNumber);
    params.setInkTool('view');
    params.setWorkspaceFeedback(anchoredSelection ? '선택하신 부분을 메모로 추가했어요.' : '텍스트 메모를 추가했어요.');
  };

  const addImageAnnotation = (annotation: Partial<InkImageAnnotation> & Pick<InkImageAnnotation, 'uri'>) => {
    if (!params.studyDocumentId || !annotation.uri) return;
    const generatedPageId = annotation.generatedPageId ?? (params.currentDocumentPage?.kind === 'generated' ? params.currentDocumentPage.pageId : undefined);
    const pageNumber = generatedPageId ? 1 : annotation.pageNumber ?? (params.currentDocumentPage?.kind === 'pdf' ? params.currentDocumentPage.pageNumber : params.currentPdfPage);
    const anchoredSelection = params.selectionRect && (
      generatedPageId
        ? params.selectionRect.generatedPageId === generatedPageId
        : !params.selectionRect.generatedPageId && (params.selectionRect.pageNumber ?? pageNumber) === pageNumber
    )
      ? params.selectionRect
      : null;
    const pageWidth = annotation.pageWidth ?? anchoredSelection?.pageWidth;
    const pageHeight = annotation.pageHeight ?? anchoredSelection?.pageHeight;
    const defaultWidth = pageWidth ? Math.min(280, Math.max(120, pageWidth * 0.38)) : 260;
    const defaultHeight = Math.max(90, defaultWidth * 0.68);
    const width = Math.max(48, annotation.width ?? anchoredSelection?.width ?? defaultWidth);
    const height = Math.max(48, annotation.height ?? anchoredSelection?.height ?? defaultHeight);
    const maxX = pageWidth ? Math.max(0, pageWidth - width) : Number.POSITIVE_INFINITY;
    const maxY = pageHeight ? Math.max(0, pageHeight - height) : Number.POSITIVE_INFINITY;
    const x = clamp(annotation.x ?? anchoredSelection?.x ?? 42, 0, maxX);
    const y = clamp(annotation.y ?? anchoredSelection?.y ?? 42, 0, maxY);
    const nextAnnotation: InkImageAnnotation = {
      id: annotation.id ?? `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      uri: annotation.uri,
      assetId: annotation.assetId,
      pageNumber,
      generatedPageId,
      x,
      y,
      width,
      height,
      rotation: annotation.rotation ?? 0,
      opacity: annotation.opacity ?? 1,
      pageWidth,
      pageHeight,
      zIndex: annotation.zIndex,
    };
    pushInkHistorySnapshot();
    params.setImageAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []), nextAnnotation],
    }));
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    if (anchoredSelection) clearCurrentSelection();
    if (!generatedPageId) markPageDirty(pageNumber);
    params.setWorkspaceFeedback('현재 페이지에 이미지를 배치했습니다.');
  };

  const updateTextAnnotation = (annotationId: string, text: string) => {
    if (!params.studyDocumentId) return;
    const timerKey = `${params.studyDocumentId}:${annotationId}`;
    if (!textEditHistoryTimersRef.current[timerKey]) {
      pushInkHistorySnapshot();
    } else {
      clearTimeout(textEditHistoryTimersRef.current[timerKey]);
    }
    textEditHistoryTimersRef.current[timerKey] = setTimeout(() => {
      delete textEditHistoryTimersRef.current[timerKey];
    }, 900);
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((annotation) =>
        annotation.id === annotationId ? { ...annotation, text } : annotation,
      ),
    }));
    const targetAnnotation = (params.textAnnotationsByDocument[params.studyDocumentId] ?? []).find((annotation) => annotation.id === annotationId);
    if (!targetAnnotation?.generatedPageId) markPageDirty(targetAnnotation?.pageNumber ?? params.currentPdfPage);
  };

  const pushTextFrameHistorySnapshot = (annotationId: string) => {
    if (!params.studyDocumentId) return;
    const timerKey = `${params.studyDocumentId}:${annotationId}`;
    if (!textFrameHistoryTimersRef.current[timerKey]) {
      pushInkHistorySnapshot();
    } else {
      clearTimeout(textFrameHistoryTimersRef.current[timerKey]);
    }
    textFrameHistoryTimersRef.current[timerKey] = setTimeout(() => {
      delete textFrameHistoryTimersRef.current[timerKey];
    }, 700);
  };

  const removeTextAnnotation = (annotationId: string) => {
    if (!params.studyDocumentId) return;
    const hasAnnotation = (params.textAnnotationsByDocument[params.studyDocumentId] ?? []).some((annotation) => annotation.id === annotationId);
    if (!hasAnnotation) return;
    pushInkHistorySnapshot();
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((annotation) => annotation.id !== annotationId),
    }));
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    markCurrentPageDirty();
  };

  const moveTextAnnotation = (annotationId: string, x: number, y: number) => {
    if (!params.studyDocumentId) return;
    const targetAnnotation = (params.textAnnotationsByDocument[params.studyDocumentId] ?? []).find((annotation) => annotation.id === annotationId);
    if (!targetAnnotation) return;
    pushTextFrameHistorySnapshot(annotationId);
    params.setTextAnnotationsByDocument((current) => {
      const annotations = current[params.studyDocumentId!] ?? [];
      return {
        ...current,
        [params.studyDocumentId!]: annotations.map((annotation) => {
          if (annotation.id !== annotationId) return annotation;
          const nextX = Math.max(0, Math.min(annotation.pageWidth ? Math.max(0, annotation.pageWidth - annotation.width) : x, x));
          const nextY = Math.max(0, Math.min(annotation.pageHeight ? Math.max(0, annotation.pageHeight - (annotation.height ?? 72)) : y, y));
          const dx = nextX - annotation.x;
          const dy = nextY - annotation.y;
          return {
            ...annotation,
            x: nextX,
            y: nextY,
            anchorRect: annotation.anchorRect
              ? {
                  ...annotation.anchorRect,
                  x: annotation.anchorRect.x + dx,
                  y: annotation.anchorRect.y + dy,
                }
              : annotation.anchorRect,
          };
        }),
      };
    });
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    if (!targetAnnotation?.generatedPageId) markPageDirty(targetAnnotation?.pageNumber ?? params.currentPdfPage);
  };

  const resizeTextAnnotation = (annotationId: string, width: number, height: number) => {
    if (!params.studyDocumentId) return;
    const targetAnnotation = (params.textAnnotationsByDocument[params.studyDocumentId] ?? []).find((annotation) => annotation.id === annotationId);
    if (!targetAnnotation) return;
    pushTextFrameHistorySnapshot(annotationId);
    params.setTextAnnotationsByDocument((current) => {
      const annotations = current[params.studyDocumentId!] ?? [];
      return {
        ...current,
        [params.studyDocumentId!]: annotations.map((annotation) => {
          if (annotation.id !== annotationId) return annotation;
          const maxWidth = annotation.pageWidth ? Math.max(96, annotation.pageWidth - annotation.x) : width;
          const maxHeight = annotation.pageHeight ? Math.max(56, annotation.pageHeight - annotation.y) : height;
          return {
            ...annotation,
            width: Math.max(96, Math.min(maxWidth, width)),
            height: Math.max(56, Math.min(maxHeight, height)),
          };
        }),
      };
    });
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    if (!targetAnnotation?.generatedPageId) markPageDirty(targetAnnotation?.pageNumber ?? params.currentPdfPage);
  };

  const changeTextAnnotationFontSize = (annotationId: string, fontSize: number) => {
    if (!params.studyDocumentId) return;
    const targetAnnotation = (params.textAnnotationsByDocument[params.studyDocumentId] ?? []).find((annotation) => annotation.id === annotationId);
    if (!targetAnnotation) return;
    pushTextFrameHistorySnapshot(annotationId);
    const nextFontSize = Math.max(12, Math.min(40, Math.round(fontSize)));
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((annotation) =>
        annotation.id === annotationId ? { ...annotation, fontSize: nextFontSize } : annotation,
      ),
    }));
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    if (!targetAnnotation?.generatedPageId) markPageDirty(targetAnnotation?.pageNumber ?? params.currentPdfPage);
  };

  const eraseInkAtPoint = (point: InkPoint, radius: number, snapshot = false, mode: InkEraserMode = 'partial') => {
    if (!params.studyDocumentId) return false;
    const scopedPoint: InkPoint = {
      ...point,
      generatedPageId: point.generatedPageId ?? (params.currentDocumentPage?.kind === 'generated' ? params.currentDocumentPage.pageId : undefined),
      pageNumber: point.generatedPageId || params.currentDocumentPage?.kind === 'generated'
        ? point.pageNumber
        : point.pageNumber ?? (params.currentDocumentPage?.kind === 'pdf' ? params.currentDocumentPage.pageNumber : params.currentPdfPage),
    };
    const currentStrokes = params.inkByDocument[params.studyDocumentId] ?? [];
    const preview = eraseStrokesAtPoint(currentStrokes, scopedPoint, radius, mode);
    if (preview === currentStrokes) return false;
    if (snapshot) pushInkHistorySnapshot();
    params.setInkByDocument((current) => {
      const strokes = current[params.studyDocumentId!] ?? [];
      const next = eraseStrokesAtPoint(strokes, scopedPoint, radius, mode);
      if (next === strokes) return current;
      return {
        ...current,
        [params.studyDocumentId!]: next,
      };
    });
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    markPageDirty(scopedPoint.generatedPageId ? null : scopedPoint.pageNumber ?? params.currentPdfPage);
    return true;
  };

  const deleteSelectedStrokes = () => {
    if (!params.studyDocumentId || !params.selectionRect) return;
    const selectedStrokeIds = getSelectedStrokeIds();
    const selectedTextAnnotationIds = getSelectedTextAnnotationIds();
    const selectedImageAnnotationIds = getSelectedImageAnnotationIds();

    if (selectedStrokeIds.size > 0 || selectedTextAnnotationIds.size > 0 || selectedImageAnnotationIds.size > 0) {
      pushInkHistorySnapshot();
      params.setInkByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((stroke) => !selectedStrokeIds.has(stroke.id)),
      }));
      params.setTextAnnotationsByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((annotation) => !selectedTextAnnotationIds.has(annotation.id)),
      }));
      params.setImageAnnotationsByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((annotation) => !selectedImageAnnotationIds.has(annotation.id)),
      }));
      markSelectionPageDirty();
      params.setWorkspaceFeedback(`선택한 객체 ${selectedStrokeIds.size + selectedTextAnnotationIds.size + selectedImageAnnotationIds.size}개를 지웠습니다.`);
    }
    clearCurrentSelection();
    params.setInkTool('view');
  };

  const changeSelectedStrokesColor = (color: string) => {
    if (!params.studyDocumentId || !params.selectionRect) return;
    const currentStrokes = params.inkByDocument[params.studyDocumentId] ?? [];
    const selectedStrokeIds = getSelectedStrokeIds();
    const selectedTextAnnotationIds = getSelectedTextAnnotationIds();

    const nextStrokes = currentStrokes.map((stroke) => {
      if (selectedStrokeIds.has(stroke.id)) {
        const isHighlight = stroke.style === 'highlight';
        const finalColor = isHighlight ? (color.startsWith('#') ? `${color}55` : color) : color;
        return { ...stroke, color: finalColor };
      }
      return stroke;
    });

    if (selectedStrokeIds.size > 0 || selectedTextAnnotationIds.size > 0) {
      pushInkHistorySnapshot();
      params.setInkByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: nextStrokes,
      }));
      params.setTextAnnotationsByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((annotation) => (
          selectedTextAnnotationIds.has(annotation.id)
            ? { ...annotation, color }
            : annotation
        )),
      }));
      markSelectionPageDirty();
      params.setWorkspaceFeedback(`선택한 객체 ${selectedStrokeIds.size + selectedTextAnnotationIds.size}개의 색상을 변경했습니다.`);
    }
    params.setInkTool('select');
  };

  const duplicateSelectedStrokes = () => {
    if (!params.studyDocumentId || !params.selectionRect) return;
    const currentStrokes = params.inkByDocument[params.studyDocumentId] ?? [];
    const currentAnnotations = params.textAnnotationsByDocument[params.studyDocumentId] ?? [];
    const currentImageAnnotations = params.imageAnnotationsByDocument[params.studyDocumentId] ?? [];
    const selectedStrokeIds = getSelectedStrokeIds();
    const selectedTextAnnotationIds = getSelectedTextAnnotationIds();
    const selectedImageAnnotationIds = getSelectedImageAnnotationIds();
    if (!selectedStrokeIds.size && !selectedTextAnnotationIds.size && !selectedImageAnnotationIds.size) return;

    const offset = 18;
    const historyGroupId = `duplicate-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const duplicatedStrokes = currentStrokes
      .filter((stroke) => selectedStrokeIds.has(stroke.id))
      .map((stroke, index) => {
        const widthScale = stroke.pageWidth && params.selectionRect?.pageWidth ? stroke.pageWidth / params.selectionRect.pageWidth : 1;
        const heightScale = stroke.pageHeight && params.selectionRect?.pageHeight ? stroke.pageHeight / params.selectionRect.pageHeight : 1;
        return {
          ...stroke,
          id: `${stroke.id}-copy-${Date.now()}-${index}`,
          historyGroupId,
          points: stroke.points.map((point) => ({
            ...point,
            x: point.x + offset * widthScale,
            y: point.y + offset * heightScale,
          })),
        };
      });

    pushInkHistorySnapshot();
    params.setInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []), ...duplicatedStrokes],
    }));
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [
        ...(current[params.studyDocumentId!] ?? []),
        ...currentAnnotations
          .filter((annotation) => selectedTextAnnotationIds.has(annotation.id))
          .map((annotation, index) => ({
            ...annotation,
            id: `${annotation.id}-copy-${Date.now()}-${index}`,
            x: annotation.x + offset,
            y: annotation.y + offset,
            anchorRect: annotation.anchorRect
              ? {
                  ...annotation.anchorRect,
                  x: annotation.anchorRect.x + offset,
                  y: annotation.anchorRect.y + offset,
                }
              : annotation.anchorRect,
          })),
      ],
    }));
    params.setImageAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [
        ...(current[params.studyDocumentId!] ?? []),
        ...currentImageAnnotations
          .filter((annotation) => selectedImageAnnotationIds.has(annotation.id))
          .map((annotation, index) => ({
            ...annotation,
            id: `${annotation.id}-copy-${Date.now()}-${index}`,
            x: annotation.x + offset,
            y: annotation.y + offset,
          })),
      ],
    }));
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    params.setSelectionByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: params.selectionRect
        ? {
            ...params.selectionRect,
            x: params.selectionRect.x + offset,
            y: params.selectionRect.y + offset,
            path: params.selectionRect.path?.map((point) => ({
              ...point,
              x: point.x + offset,
              y: point.y + offset,
            })),
          }
        : null,
    }));
    markSelectionPageDirty();
    params.setWorkspaceFeedback(`선택한 객체 ${selectedStrokeIds.size + selectedTextAnnotationIds.size + selectedImageAnnotationIds.size}개를 복제했습니다.`);
    params.setInkTool('select');
  };

  const resizeSelectedStrokes = (scale: number) => {
    if (!params.studyDocumentId || !params.selectionRect || !Number.isFinite(scale) || scale <= 0) return;
    const selectedStrokeIds = getSelectedStrokeIds();
    const selectedTextAnnotationIds = getSelectedTextAnnotationIds();
    const selectedImageAnnotationIds = getSelectedImageAnnotationIds();
    if (!selectedStrokeIds.size && !selectedTextAnnotationIds.size && !selectedImageAnnotationIds.size) return;
    const centerX = params.selectionRect.x + params.selectionRect.width / 2;
    const centerY = params.selectionRect.y + params.selectionRect.height / 2;

    pushInkHistorySnapshot();
    params.setInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((stroke) => {
        if (!selectedStrokeIds.has(stroke.id)) return stroke;
        const widthScale = stroke.pageWidth && params.selectionRect?.pageWidth ? stroke.pageWidth / params.selectionRect.pageWidth : 1;
        const heightScale = stroke.pageHeight && params.selectionRect?.pageHeight ? stroke.pageHeight / params.selectionRect.pageHeight : 1;
        const strokeCenterX = centerX * widthScale;
        const strokeCenterY = centerY * heightScale;
        return {
          ...stroke,
          width: Math.max(1, stroke.width * scale),
          points: stroke.points.map((point) => ({
            ...point,
            x: strokeCenterX + (point.x - strokeCenterX) * scale,
            y: strokeCenterY + (point.y - strokeCenterY) * scale,
          })),
        };
      }),
    }));
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((annotation) => {
        if (!selectedTextAnnotationIds.has(annotation.id)) return annotation;
        return {
          ...annotation,
          x: centerX + (annotation.x - centerX) * scale,
          y: centerY + (annotation.y - centerY) * scale,
          width: Math.max(80, annotation.width * scale),
          anchorRect: annotation.anchorRect
            ? {
                ...annotation.anchorRect,
                x: centerX + (annotation.anchorRect.x - centerX) * scale,
                y: centerY + (annotation.anchorRect.y - centerY) * scale,
                width: Math.max(8, annotation.anchorRect.width * scale),
                height: Math.max(8, annotation.anchorRect.height * scale),
              }
            : annotation.anchorRect,
        };
      }),
    }));
    params.setImageAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((annotation) => {
        if (!selectedImageAnnotationIds.has(annotation.id)) return annotation;
        return {
          ...annotation,
          x: centerX + (annotation.x - centerX) * scale,
          y: centerY + (annotation.y - centerY) * scale,
          width: Math.max(48, annotation.width * scale),
          height: Math.max(48, annotation.height * scale),
        };
      }),
    }));
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    params.setSelectionByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: {
        ...params.selectionRect!,
        x: centerX - (params.selectionRect!.width * scale) / 2,
        y: centerY - (params.selectionRect!.height * scale) / 2,
        width: params.selectionRect!.width * scale,
        height: params.selectionRect!.height * scale,
      },
    }));
    markSelectionPageDirty();
    params.setWorkspaceFeedback('선택한 필기 크기를 조절했습니다.');
    params.setInkTool('select');
  };

  const resizeSelectedStrokesToRect = (nextRect: SelectionRect) => {
    if (!params.studyDocumentId || !params.selectionRect || nextRect.width < 8 || nextRect.height < 8) return;
    const selectedStrokeIds = getSelectedStrokeIds();
    const selectedTextAnnotationIds = getSelectedTextAnnotationIds();
    const selectedImageAnnotationIds = getSelectedImageAnnotationIds();
    if (!selectedStrokeIds.size && !selectedTextAnnotationIds.size && !selectedImageAnnotationIds.size) return;
    const sourceRect = params.selectionRect;
    const sourceWidth = Math.max(1, sourceRect.width);
    const sourceHeight = Math.max(1, sourceRect.height);
    const widthRatio = nextRect.width / sourceWidth;
    const heightRatio = nextRect.height / sourceHeight;

    pushInkHistorySnapshot();
    params.setInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((stroke) => {
        if (!selectedStrokeIds.has(stroke.id)) return stroke;
        const widthScale = stroke.pageWidth && sourceRect.pageWidth ? stroke.pageWidth / sourceRect.pageWidth : 1;
        const heightScale = stroke.pageHeight && sourceRect.pageHeight ? stroke.pageHeight / sourceRect.pageHeight : 1;
        const scaledSource = {
          x: sourceRect.x * widthScale,
          y: sourceRect.y * heightScale,
          width: Math.max(1, sourceRect.width * widthScale),
          height: Math.max(1, sourceRect.height * heightScale),
        };
        const scaledNext = {
          x: nextRect.x * widthScale,
          y: nextRect.y * heightScale,
          width: Math.max(1, nextRect.width * widthScale),
          height: Math.max(1, nextRect.height * heightScale),
        };
        return {
          ...stroke,
          width: Math.max(1, stroke.width * Math.max(0.35, Math.min(3.5, (widthRatio + heightRatio) / 2))),
          points: stroke.points.map((point) => ({
            ...point,
            x: scaledNext.x + ((point.x - scaledSource.x) / scaledSource.width) * scaledNext.width,
            y: scaledNext.y + ((point.y - scaledSource.y) / scaledSource.height) * scaledNext.height,
          })),
        };
      }),
    }));
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((annotation) => {
        if (!selectedTextAnnotationIds.has(annotation.id)) return annotation;
        return {
          ...annotation,
          x: nextRect.x + ((annotation.x - sourceRect.x) / sourceWidth) * nextRect.width,
          y: nextRect.y + ((annotation.y - sourceRect.y) / sourceHeight) * nextRect.height,
          width: Math.max(80, annotation.width * widthRatio),
          anchorRect: annotation.anchorRect
            ? {
                ...annotation.anchorRect,
                x: nextRect.x + ((annotation.anchorRect.x - sourceRect.x) / sourceWidth) * nextRect.width,
                y: nextRect.y + ((annotation.anchorRect.y - sourceRect.y) / sourceHeight) * nextRect.height,
                width: Math.max(8, annotation.anchorRect.width * widthRatio),
                height: Math.max(8, annotation.anchorRect.height * heightRatio),
              }
            : annotation.anchorRect,
        };
      }),
    }));
    params.setImageAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((annotation) => {
        if (!selectedImageAnnotationIds.has(annotation.id)) return annotation;
        return {
          ...annotation,
          x: nextRect.x + ((annotation.x - sourceRect.x) / sourceWidth) * nextRect.width,
          y: nextRect.y + ((annotation.y - sourceRect.y) / sourceHeight) * nextRect.height,
          width: Math.max(48, annotation.width * widthRatio),
          height: Math.max(48, annotation.height * heightRatio),
        };
      }),
    }));
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    params.setSelectionByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: nextRect,
    }));
    markSelectionPageDirty();
    params.setWorkspaceFeedback('선택한 필기 크기를 조절했습니다.');
    params.setInkTool('select');
  };

  const nudgeSelectedStrokes = (dx: number, dy: number) => {
    if (!params.studyDocumentId || !params.selectionRect) return;
    const selectedStrokeIds = getSelectedStrokeIds();
    const selectedTextAnnotationIds = getSelectedTextAnnotationIds();
    const selectedImageAnnotationIds = getSelectedImageAnnotationIds();
    if (!selectedStrokeIds.size && !selectedTextAnnotationIds.size && !selectedImageAnnotationIds.size) return;
    const pageWidth = params.selectionRect.pageWidth;
    const pageHeight = params.selectionRect.pageHeight;
    const boundedX = pageWidth
      ? clamp(params.selectionRect.x + dx, 0, Math.max(0, pageWidth - params.selectionRect.width))
      : params.selectionRect.x + dx;
    const boundedY = pageHeight
      ? clamp(params.selectionRect.y + dy, 0, Math.max(0, pageHeight - params.selectionRect.height))
      : params.selectionRect.y + dy;
    const moveDx = boundedX - params.selectionRect.x;
    const moveDy = boundedY - params.selectionRect.y;
    if (Math.abs(moveDx) < 0.5 && Math.abs(moveDy) < 0.5) return;

    pushInkHistorySnapshot();
    params.setInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((stroke) => {
        if (!selectedStrokeIds.has(stroke.id)) return stroke;
        const widthScale = stroke.pageWidth && params.selectionRect?.pageWidth ? stroke.pageWidth / params.selectionRect.pageWidth : 1;
        const heightScale = stroke.pageHeight && params.selectionRect?.pageHeight ? stroke.pageHeight / params.selectionRect.pageHeight : 1;
        return {
          ...stroke,
          points: stroke.points.map((point) => ({
            ...point,
            x: point.x + moveDx * widthScale,
            y: point.y + moveDy * heightScale,
          })),
        };
      }),
    }));
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((annotation) => (
        selectedTextAnnotationIds.has(annotation.id)
          ? {
              ...annotation,
              x: annotation.x + moveDx,
              y: annotation.y + moveDy,
              anchorRect: annotation.anchorRect
                ? {
                    ...annotation.anchorRect,
                    x: annotation.anchorRect.x + moveDx,
                    y: annotation.anchorRect.y + moveDy,
                  }
                : annotation.anchorRect,
            }
          : annotation
      )),
    }));
    params.setImageAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((annotation) => (
        selectedImageAnnotationIds.has(annotation.id)
          ? {
              ...annotation,
              x: annotation.x + moveDx,
              y: annotation.y + moveDy,
            }
          : annotation
      )),
    }));
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    params.setSelectionByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: {
        ...params.selectionRect!,
        x: params.selectionRect!.x + moveDx,
        y: params.selectionRect!.y + moveDy,
        path: params.selectionRect!.path?.map((point) => ({
          ...point,
          x: point.x + moveDx,
          y: point.y + moveDy,
        })),
      },
    }));
    markSelectionPageDirty();
    params.setInkTool('select');
  };

  return {
    pushWorkspaceHistorySnapshot: pushInkHistorySnapshot,
    clearCurrentSelection,
    clearInk,
    undoInk,
    redoInk,
    commitInkStroke,
    removeInkStroke,
    replaceInkStrokes,
    addTextAnnotation,
    addImageAnnotation,
    updateTextAnnotation,
    removeTextAnnotation,
    moveTextAnnotation,
    resizeTextAnnotation,
    changeTextAnnotationFontSize,
    eraseInkAtPoint,
    deleteSelectedStrokes,
    changeSelectedStrokesColor,
    duplicateSelectedStrokes,
    resizeSelectedStrokes,
    resizeSelectedStrokesToRect,
    nudgeSelectedStrokes,
  };
}
