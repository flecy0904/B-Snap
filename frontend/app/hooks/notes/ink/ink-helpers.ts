import type { DocumentPageView, StudyDocumentEntry } from '../../../types';
import type { InkStroke } from '../../../ui-types';

export function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) return index;
  }
  return -1;
}

export function isInkStrokeOnPage(params: {
  stroke: InkStroke;
  currentDocumentPage: DocumentPageView | null;
  currentPdfPage: number;
  studyDocumentType?: StudyDocumentEntry['type'];
}) {
  const { stroke, currentDocumentPage, currentPdfPage, studyDocumentType } = params;

  if (currentDocumentPage?.kind === 'generated') {
    return stroke.generatedPageId === currentDocumentPage.pageId;
  }

  if (stroke.generatedPageId) return false;
  if (studyDocumentType === 'blank') return (stroke.pageNumber ?? 1) === currentPdfPage;
  return !stroke.pageNumber || stroke.pageNumber === currentPdfPage;
}

export function scopeInkStrokeToPage(params: {
  stroke: InkStroke;
  currentDocumentPage: DocumentPageView | null;
  currentPdfPage: number;
}) {
  const { stroke, currentDocumentPage, currentPdfPage } = params;

  if (stroke.generatedPageId) {
    return { ...stroke, pageNumber: undefined };
  }

  if (stroke.pageNumber) {
    return { ...stroke, generatedPageId: undefined, pageNumber: stroke.pageNumber };
  }

  if (currentDocumentPage?.kind === 'generated') {
    return { ...stroke, generatedPageId: currentDocumentPage.pageId, pageNumber: undefined };
  }

  return {
    ...stroke,
    generatedPageId: undefined,
    pageNumber: currentDocumentPage?.kind === 'pdf' ? stroke.pageNumber ?? currentDocumentPage.pageNumber : stroke.pageNumber ?? currentPdfPage,
  };
}
