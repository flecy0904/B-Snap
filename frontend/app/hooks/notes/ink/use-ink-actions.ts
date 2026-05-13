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
  setInkByDocument: SetState<Record<number, InkStroke[]>>;
  setRedoInkByDocument: SetState<Record<number, InkStroke[]>>;
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

  const clearInk = () => {
    if (!params.studyDocumentId) return;
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
    params.setInkByDocument((current) => {
      const currentStrokes = current[params.studyDocumentId!] ?? [];
      const lastStrokeIndex = findLastIndex(currentStrokes, isStrokeOnCurrentPage);
      if (lastStrokeIndex < 0) return current;

      const lastStroke = currentStrokes[lastStrokeIndex];

      params.setRedoInkByDocument((redoCurrent) => ({
        ...redoCurrent,
        [params.studyDocumentId!]: [...(redoCurrent[params.studyDocumentId!] ?? []), lastStroke],
      }));

      return {
        ...current,
        [params.studyDocumentId!]: currentStrokes.filter((_, index) => index !== lastStrokeIndex),
      };
    });
  };

  const redoInk = () => {
    if (!params.studyDocumentId) return;
    params.setRedoInkByDocument((current) => {
      const currentRedoStrokes = current[params.studyDocumentId!] ?? [];
      const lastRedoStrokeIndex = findLastIndex(currentRedoStrokes, isStrokeOnCurrentPage);
      if (lastRedoStrokeIndex < 0) return current;

      const lastRedoStroke = currentRedoStrokes[lastRedoStrokeIndex];

      params.setInkByDocument((inkCurrent) => ({
        ...inkCurrent,
        [params.studyDocumentId!]: [...(inkCurrent[params.studyDocumentId!] ?? []), lastRedoStroke],
      }));

      return {
        ...current,
        [params.studyDocumentId!]: currentRedoStrokes.filter((_, index) => index !== lastRedoStrokeIndex),
      };
    });
  };

  const commitInkStroke = (stroke: InkStroke) => {
    if (!params.studyDocumentId) return;
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
      params.setInkByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: nextStrokes,
      }));
      params.setWorkspaceFeedback(`선택한 ${selectedStrokeIds.size}개의 필기 색상을 변경했습니다.`);
    }
    clearCurrentSelection();
    params.setInkTool('view');
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
  };
}
