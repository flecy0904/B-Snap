import type { Dispatch, SetStateAction } from 'react';
import type { DocumentPageView, StudyDocumentEntry } from '../../../types';
import type { InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { findInkStrokesInRect, scaleInkStrokeToPageSize } from '../../../ui-helpers';
import { findLastIndex, isInkStrokeOnPage, scopeInkStrokeToPage } from './ink-helpers';

type SetState<T> = Dispatch<SetStateAction<T>>;

export function useInkActions(params: {
  studyDocumentId: number | null;
  studyDocument: StudyDocumentEntry | null;
  currentDocumentPage: DocumentPageView | null;
  currentPdfPage: number;
  selectionRect: SelectionRect | null;
  selectionByDocument: Record<number, SelectionRect | null>;
  inkByDocument: Record<number, InkStroke[]>;
  inkHistoryByDocument: Record<number, InkStroke[][]>;
  redoInkHistoryByDocument: Record<number, InkStroke[][]>;
  setInkByDocument: SetState<Record<number, InkStroke[]>>;
  setRedoInkByDocument: SetState<Record<number, InkStroke[]>>;
  setInkHistoryByDocument: SetState<Record<number, InkStroke[][]>>;
  setRedoInkHistoryByDocument: SetState<Record<number, InkStroke[][]>>;
  setTextAnnotationsByDocument: SetState<Record<number, InkTextAnnotation[]>>;
  setSelectionByDocument: SetState<Record<number, SelectionRect | null>>;
  setInkTool: SetState<InkTool>;
  setWorkspaceFeedback: SetState<string | null>;
}) {
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
    return new Set(findInkStrokesInRect(hitTestStrokes, params.selectionRect));
  };

  const clearCurrentSelection = () => {
    if (!params.studyDocumentId) return;
    params.setSelectionByDocument((current) => ({ ...current, [params.studyDocumentId!]: null }));
  };

  const pushInkHistorySnapshot = () => {
    if (!params.studyDocumentId) return;
    const snapshot = params.inkByDocument[params.studyDocumentId] ?? [];
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
  };

  const undoInk = () => {
    if (!params.studyDocumentId) return;
    const documentHistory = params.inkHistoryByDocument[params.studyDocumentId] ?? [];
    if (documentHistory.length > 0) {
      const previousStrokes = documentHistory[documentHistory.length - 1];
      const currentStrokes = params.inkByDocument[params.studyDocumentId] ?? [];
      params.setRedoInkHistoryByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []).slice(-39), currentStrokes],
      }));
      params.setInkHistoryByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).slice(0, -1),
      }));
      params.setInkByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: previousStrokes,
      }));
      clearCurrentSelection();
      params.setWorkspaceFeedback('이전 필기 상태로 되돌렸습니다.');
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
  };

  const redoInk = () => {
    if (!params.studyDocumentId) return;
    const documentRedoHistory = params.redoInkHistoryByDocument[params.studyDocumentId] ?? [];
    if (documentRedoHistory.length > 0) {
      const nextStrokes = documentRedoHistory[documentRedoHistory.length - 1];
      const currentStrokes = params.inkByDocument[params.studyDocumentId] ?? [];
      params.setInkHistoryByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []).slice(-39), currentStrokes],
      }));
      params.setRedoInkHistoryByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).slice(0, -1),
      }));
      params.setInkByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: nextStrokes,
      }));
      clearCurrentSelection();
      params.setWorkspaceFeedback('되돌린 필기 상태를 다시 적용했습니다.');
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
  };

  const addTextAnnotation = (point: InkPoint) => {
    if (!params.studyDocumentId) return;
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
      width: 180,
      text: '',
      anchorRect: anchoredSelection,
      pageWidth: anchoredSelection?.pageWidth ?? point.pageWidth,
      pageHeight: anchoredSelection?.pageHeight ?? point.pageHeight,
    };
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []), nextAnnotation],
    }));
    if (anchoredSelection) {
      clearCurrentSelection();
    }
    params.setInkTool('view');
    params.setWorkspaceFeedback(anchoredSelection ? '선택 영역 메모를 추가했습니다.' : '텍스트 메모를 추가했습니다.');
  };

  const updateTextAnnotation = (annotationId: string, text: string) => {
    if (!params.studyDocumentId) return;
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((annotation) =>
        annotation.id === annotationId ? { ...annotation, text } : annotation,
      ),
    }));
  };

  const removeTextAnnotation = (annotationId: string) => {
    if (!params.studyDocumentId) return;
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((annotation) => annotation.id !== annotationId),
    }));
  };

  const deleteSelectedStrokes = () => {
    if (!params.studyDocumentId || !params.selectionRect) return;
    const selectedStrokeIds = getSelectedStrokeIds();

    if (selectedStrokeIds.size > 0) {
      pushInkHistorySnapshot();
      params.setInkByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((stroke) => !selectedStrokeIds.has(stroke.id)),
      }));
      params.setWorkspaceFeedback(`선택한 ${selectedStrokeIds.size}개의 필기를 지웠습니다.`);
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
      params.setWorkspaceFeedback(`선택한 ${selectedStrokeIds.size}개의 필기 색상을 변경했습니다.`);
    }
    clearCurrentSelection();
    params.setInkTool('view');
  };

  const duplicateSelectedStrokes = () => {
    if (!params.studyDocumentId || !params.selectionRect) return;
    const currentStrokes = params.inkByDocument[params.studyDocumentId] ?? [];
    const selectedStrokeIds = getSelectedStrokeIds();
    if (!selectedStrokeIds.size) return;

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
    params.setWorkspaceFeedback(`선택한 ${selectedStrokeIds.size}개의 필기를 복제했습니다.`);
    params.setInkTool('select');
  };

  const resizeSelectedStrokes = (scale: number) => {
    if (!params.studyDocumentId || !params.selectionRect || !Number.isFinite(scale) || scale <= 0) return;
    const selectedStrokeIds = getSelectedStrokeIds();
    if (!selectedStrokeIds.size) return;
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
    params.setWorkspaceFeedback('선택한 필기 크기를 조절했습니다.');
    params.setInkTool('select');
  };

  const nudgeSelectedStrokes = (dx: number, dy: number) => {
    if (!params.studyDocumentId || !params.selectionRect) return;
    const selectedStrokeIds = getSelectedStrokeIds();
    if (!selectedStrokeIds.size) return;

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
      },
    }));
    params.setWorkspaceFeedback('선택한 필기를 이동했습니다.');
    params.setInkTool('select');
  };

  return {
    clearCurrentSelection,
    clearInk,
    undoInk,
    redoInk,
    commitInkStroke,
    removeInkStroke,
    addTextAnnotation,
    updateTextAnnotation,
    removeTextAnnotation,
    deleteSelectedStrokes,
    changeSelectedStrokesColor,
    duplicateSelectedStrokes,
    resizeSelectedStrokes,
    nudgeSelectedStrokes,
  };
}
