import { useRef } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { DocumentPageView, GeneratedWorkspacePage, StudyDocumentEntry } from '../../../types';
import type { InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { findInkStrokesInLasso, findInkStrokesInRect, isPointInPolygon, scaleInkStrokeToPageSize } from '../../../ui-helpers';
import { findLastIndex, isInkStrokeOnPage, scopeInkStrokeToPage } from './ink-helpers';

type SetState<T> = Dispatch<SetStateAction<T>>;
export type WorkspaceEditSnapshot = {
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
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
  generatedPagesByDocument?: Record<number, GeneratedWorkspacePage[]>;
  activePageByDocument?: Record<number, DocumentPageView>;
  inkHistoryByDocument: Record<number, WorkspaceEditSnapshot[]>;
  redoInkHistoryByDocument: Record<number, WorkspaceEditSnapshot[]>;
  setInkByDocument: SetState<Record<number, InkStroke[]>>;
  setRedoInkByDocument: SetState<Record<number, InkStroke[]>>;
  setInkHistoryByDocument: SetState<Record<number, WorkspaceEditSnapshot[]>>;
  setRedoInkHistoryByDocument: SetState<Record<number, WorkspaceEditSnapshot[]>>;
  setTextAnnotationsByDocument: SetState<Record<number, InkTextAnnotation[]>>;
  setGeneratedPagesByDocument?: SetState<Record<number, GeneratedWorkspacePage[]>>;
  setActivePageByDocument?: SetState<Record<number, DocumentPageView>>;
  setSelectionByDocument: SetState<Record<number, SelectionRect | null>>;
  setSelectionPreviewByDocument: SetState<Record<number, string | null>>;
  setInkTool: SetState<InkTool>;
  setWorkspaceFeedback: SetState<string | null>;
  onMarkPageDirty?: (documentId: number, pageNumber: number) => void;
}) {
  const textEditHistoryTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const isStrokeOnCurrentPage = (stroke: InkStroke) => (
    isInkStrokeOnPage({
      stroke,
      currentDocumentPage: params.currentDocumentPage,
      currentPdfPage: params.currentPdfPage,
      studyDocumentType: params.studyDocument?.type,
    })
  );

  const getPageStrokesForSelection = () => {
    if (!params.studyDocumentId) return [];
    const currentStrokes = params.inkByDocument[params.studyDocumentId] ?? [];
    return currentStrokes.filter((stroke) => (
      params.currentDocumentPage?.kind === 'generated'
        ? stroke.generatedPageId === params.currentDocumentPage.pageId
        : (
            !stroke.generatedPageId &&
            (params.studyDocument?.type === 'blank'
              ? (stroke.pageNumber ?? 1) === params.currentPdfPage
              : (!stroke.pageNumber || stroke.pageNumber === params.currentPdfPage))
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
    return annotations.filter((annotation) => (
      params.currentDocumentPage?.kind === 'generated'
        ? annotation.generatedPageId === params.currentDocumentPage.pageId
        : (
            !annotation.generatedPageId &&
            (params.studyDocument?.type === 'blank'
              ? (annotation.pageNumber ?? 1) === params.currentPdfPage
              : annotation.pageNumber === params.currentPdfPage)
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
          height: 96,
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

  const splitStrokeByEraser = (stroke: InkStroke, point: InkPoint, radius: number): InkStroke[] | null => {
    if (!isStrokeOnPointPage(stroke, point)) return null;
    if (stroke.points.length <= 1) {
      if (stroke.points[0] && Math.hypot(stroke.points[0].x - point.x, stroke.points[0].y - point.y) <= radius) return [];
      return null;
    }
    if (!stroke.points.some((strokePoint, index) => {
      if (Math.hypot(strokePoint.x - point.x, strokePoint.y - point.y) <= radius) return true;
      const previous = stroke.points[index - 1];
      return Boolean(previous && distanceToSegment(point, previous, strokePoint) <= radius);
    })) {
      return null;
    }

    let changed = false;
    const chunks: InkPoint[][] = [];
    let currentChunk: InkPoint[] = [];

    stroke.points.forEach((strokePoint, index) => {
      if (index === 0) {
        if (Math.hypot(strokePoint.x - point.x, strokePoint.y - point.y) > radius) {
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
        if (Math.hypot(samplePoint.x - point.x, samplePoint.y - point.y) <= radius) {
          changed = true;
          if (currentChunk.length > 1) chunks.push(currentChunk);
          currentChunk = [];
          continue;
        }
        appendChunkPoint(currentChunk, samplePoint);
      }
    });
    if (currentChunk.length > 1) chunks.push(currentChunk);
    if (!changed) return null;

    const timestamp = Date.now();
    return chunks.map((chunk, index) => ({
      ...stroke,
      id: `${stroke.id}-erase-${timestamp}-${index}`,
      points: chunk,
    }));
  };

  const eraseStrokesAtPoint = (strokes: InkStroke[], point: InkPoint, radius: number) => {
    let changed = false;
    const nextStrokes: InkStroke[] = [];

    strokes.forEach((stroke) => {
      const split = splitStrokeByEraser(stroke, point, radius);
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
          .filter((annotation) => {
            const rect = getAnnotationSelectionRect(annotation);
            const points: InkPoint[] = [
              { x: rect.x, y: rect.y },
              { x: rect.x + rect.width, y: rect.y },
              { x: rect.x + rect.width, y: rect.y + rect.height },
              { x: rect.x, y: rect.y + rect.height },
              { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
            ];
            return points.some((point) => isPointInPolygon(point, selectionPath));
          })
          .map((annotation) => annotation.id),
      );
    }
    return new Set(
      getPageTextAnnotationsForSelection()
        .filter((annotation) => rectsOverlap(getAnnotationSelectionRect(annotation), params.selectionRect!))
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

  const getCurrentSnapshot = (): WorkspaceEditSnapshot => ({
    inkStrokes: params.studyDocumentId ? (params.inkByDocument[params.studyDocumentId] ?? []) : [],
    textAnnotations: params.studyDocumentId ? (params.textAnnotationsByDocument[params.studyDocumentId] ?? []) : [],
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
      params.setWorkspaceFeedback('이전 편집 상태로 되돌렸습니다.');
      return;
    }

    params.setInkByDocument((current) => {
      const currentStrokes = current[params.studyDocumentId!] ?? [];
      const lastStrokeIndex = findLastIndex(currentStrokes, isStrokeOnCurrentPage);
      if (lastStrokeIndex < 0) return current;

      const lastStroke = currentStrokes[lastStrokeIndex];
      const historyGroupId = lastStroke.historyGroupId;
      const removedStrokes = historyGroupId
        ? currentStrokes.filter((stroke) => stroke.historyGroupId === historyGroupId && isStrokeOnCurrentPage(stroke))
        : [lastStroke];
      const removedStrokeIds = new Set(removedStrokes.map((stroke) => stroke.id));

      params.setRedoInkByDocument((redoCurrent) => ({
        ...redoCurrent,
        [params.studyDocumentId!]: [...(redoCurrent[params.studyDocumentId!] ?? []), ...removedStrokes],
      }));

      return {
        ...current,
        [params.studyDocumentId!]: currentStrokes.filter((stroke, index) => (
          historyGroupId ? !removedStrokeIds.has(stroke.id) : index !== lastStrokeIndex
        )),
      };
    });
    markCurrentPageDirty();
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
      params.setWorkspaceFeedback('되돌린 편집 상태를 다시 적용했습니다.');
      return;
    }

    params.setRedoInkByDocument((current) => {
      const currentRedoStrokes = current[params.studyDocumentId!] ?? [];
      const lastRedoStrokeIndex = findLastIndex(currentRedoStrokes, isStrokeOnCurrentPage);
      if (lastRedoStrokeIndex < 0) return current;

      const lastRedoStroke = currentRedoStrokes[lastRedoStrokeIndex];
      const historyGroupId = lastRedoStroke.historyGroupId;
      const redoStrokes = historyGroupId
        ? currentRedoStrokes.filter((stroke) => stroke.historyGroupId === historyGroupId && isStrokeOnCurrentPage(stroke))
        : [lastRedoStroke];
      const redoStrokeIds = new Set(redoStrokes.map((stroke) => stroke.id));

      params.setInkByDocument((inkCurrent) => ({
        ...inkCurrent,
        [params.studyDocumentId!]: [...(inkCurrent[params.studyDocumentId!] ?? []), ...redoStrokes],
      }));

      return {
        ...current,
        [params.studyDocumentId!]: currentRedoStrokes.filter((stroke, index) => (
          historyGroupId ? !redoStrokeIds.has(stroke.id) : index !== lastRedoStrokeIndex
        )),
      };
    });
    markCurrentPageDirty();
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
      width: 220,
      height: 96,
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
    params.setWorkspaceFeedback(anchoredSelection ? '선택 영역 메모를 추가했습니다.' : '텍스트 메모를 추가했습니다.');
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
    if (!targetAnnotation?.generatedPageId) markPageDirty(targetAnnotation?.pageNumber ?? params.currentPdfPage);
  };

  const resizeTextAnnotation = (annotationId: string, width: number, height: number) => {
    if (!params.studyDocumentId) return;
    const targetAnnotation = (params.textAnnotationsByDocument[params.studyDocumentId] ?? []).find((annotation) => annotation.id === annotationId);
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
    if (!targetAnnotation?.generatedPageId) markPageDirty(targetAnnotation?.pageNumber ?? params.currentPdfPage);
  };

  const eraseInkAtPoint = (point: InkPoint, radius: number, snapshot = false) => {
    if (!params.studyDocumentId) return false;
    const scopedPoint: InkPoint = {
      ...point,
      generatedPageId: point.generatedPageId ?? (params.currentDocumentPage?.kind === 'generated' ? params.currentDocumentPage.pageId : undefined),
      pageNumber: point.generatedPageId || params.currentDocumentPage?.kind === 'generated'
        ? point.pageNumber
        : point.pageNumber ?? (params.currentDocumentPage?.kind === 'pdf' ? params.currentDocumentPage.pageNumber : params.currentPdfPage),
    };
    const currentStrokes = params.inkByDocument[params.studyDocumentId] ?? [];
    const preview = eraseStrokesAtPoint(currentStrokes, scopedPoint, radius);
    if (preview === currentStrokes) return false;
    if (snapshot) pushInkHistorySnapshot();
    params.setInkByDocument((current) => {
      const strokes = current[params.studyDocumentId!] ?? [];
      const next = eraseStrokesAtPoint(strokes, scopedPoint, radius);
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

    if (selectedStrokeIds.size > 0 || selectedTextAnnotationIds.size > 0) {
      pushInkHistorySnapshot();
      params.setInkByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((stroke) => !selectedStrokeIds.has(stroke.id)),
      }));
      params.setTextAnnotationsByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((annotation) => !selectedTextAnnotationIds.has(annotation.id)),
      }));
      markCurrentPageDirty();
      params.setWorkspaceFeedback(`선택한 객체 ${selectedStrokeIds.size + selectedTextAnnotationIds.size}개를 지웠습니다.`);
    }
    clearCurrentSelection();
    params.setInkTool('view');
  };

  const changeSelectedStrokesColor = (color: string) => {
    if (!params.studyDocumentId || !params.selectionRect) return;
    const currentStrokes = params.inkByDocument[params.studyDocumentId] ?? [];
    const selectedStrokeIds = getSelectedStrokeIds();

    const nextStrokes = currentStrokes.map((stroke) => {
      if (selectedStrokeIds.has(stroke.id)) {
        const isHighlight = stroke.style === 'highlight';
        const finalColor = isHighlight ? (color.startsWith('#') ? `${color}55` : color) : color;
        return { ...stroke, color: finalColor };
      }
      return stroke;
    });

    if (selectedStrokeIds.size > 0) {
      pushInkHistorySnapshot();
      params.setInkByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: nextStrokes,
      }));
      markCurrentPageDirty();
      params.setWorkspaceFeedback(`선택한 ${selectedStrokeIds.size}개의 필기 색상을 변경했습니다.`);
    }
    clearCurrentSelection();
    params.setInkTool('view');
  };

  const duplicateSelectedStrokes = () => {
    if (!params.studyDocumentId || !params.selectionRect) return;
    const currentStrokes = params.inkByDocument[params.studyDocumentId] ?? [];
    const currentAnnotations = params.textAnnotationsByDocument[params.studyDocumentId] ?? [];
    const selectedStrokeIds = getSelectedStrokeIds();
    const selectedTextAnnotationIds = getSelectedTextAnnotationIds();
    if (!selectedStrokeIds.size && !selectedTextAnnotationIds.size) return;

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
          }
        : null,
    }));
    markCurrentPageDirty();
    params.setWorkspaceFeedback(`선택한 객체 ${selectedStrokeIds.size + selectedTextAnnotationIds.size}개를 복제했습니다.`);
    params.setInkTool('select');
  };

  const resizeSelectedStrokes = (scale: number) => {
    if (!params.studyDocumentId || !params.selectionRect || !Number.isFinite(scale) || scale <= 0) return;
    const selectedStrokeIds = getSelectedStrokeIds();
    const selectedTextAnnotationIds = getSelectedTextAnnotationIds();
    if (!selectedStrokeIds.size && !selectedTextAnnotationIds.size) return;
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
    markCurrentPageDirty();
    params.setWorkspaceFeedback('선택한 필기 크기를 조절했습니다.');
    params.setInkTool('select');
  };

  const resizeSelectedStrokesToRect = (nextRect: SelectionRect) => {
    if (!params.studyDocumentId || !params.selectionRect || nextRect.width < 8 || nextRect.height < 8) return;
    const selectedStrokeIds = getSelectedStrokeIds();
    const selectedTextAnnotationIds = getSelectedTextAnnotationIds();
    if (!selectedStrokeIds.size && !selectedTextAnnotationIds.size) return;
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
    params.setRedoInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [],
    }));
    params.setSelectionByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: nextRect,
    }));
    markCurrentPageDirty();
    params.setWorkspaceFeedback('선택한 필기 크기를 조절했습니다.');
    params.setInkTool('select');
  };

  const nudgeSelectedStrokes = (dx: number, dy: number) => {
    if (!params.studyDocumentId || !params.selectionRect) return;
    const selectedStrokeIds = getSelectedStrokeIds();
    const selectedTextAnnotationIds = getSelectedTextAnnotationIds();
    if (!selectedStrokeIds.size && !selectedTextAnnotationIds.size) return;

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
            x: point.x + dx * widthScale,
            y: point.y + dy * heightScale,
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
              x: annotation.x + dx,
              y: annotation.y + dy,
              anchorRect: annotation.anchorRect
                ? {
                    ...annotation.anchorRect,
                    x: annotation.anchorRect.x + dx,
                    y: annotation.anchorRect.y + dy,
                  }
                : annotation.anchorRect,
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
        x: params.selectionRect!.x + dx,
        y: params.selectionRect!.y + dy,
        path: params.selectionRect!.path?.map((point) => ({
          ...point,
          x: point.x + dx,
          y: point.y + dy,
        })),
      },
    }));
    markCurrentPageDirty();
    params.setWorkspaceFeedback('선택한 객체를 이동했습니다.');
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
    addTextAnnotation,
    updateTextAnnotation,
    removeTextAnnotation,
    moveTextAnnotation,
    resizeTextAnnotation,
    eraseInkAtPoint,
    deleteSelectedStrokes,
    changeSelectedStrokesColor,
    duplicateSelectedStrokes,
    resizeSelectedStrokes,
    resizeSelectedStrokesToRect,
    nudgeSelectedStrokes,
  };
}
