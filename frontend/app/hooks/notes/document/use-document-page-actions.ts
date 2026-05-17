import type { Dispatch, SetStateAction } from 'react';
import { Share } from 'react-native';
import {
  createBackendNotePage,
  deleteBackendNotePageByNumber,
  duplicateBackendNotePage,
  isBackendApiEnabled,
  moveBackendNotePage,
  type BackendNotePage,
} from '../../../services/backend-api';
import type { InkStroke, InkTextAnnotation, InkTool } from '../../../ui-types';
import type { AiAnswer, BookmarkedPage, DocumentPageView, GeneratedWorkspacePage, StudyDocumentEntry } from '../../../types';
import { getDocumentPageLabel, isSameDocumentPage } from '../../../ui-helpers';
import { getStudyDocumentBackendNoteId } from './backend-sync';
import { upsertStudyDocument } from './collection-helpers';
import { serializeNotePageContent } from './note-page-content';

type SetState<T> = Dispatch<SetStateAction<T>>;

export function useDocumentPageActions(params: {
  studyDocumentId: number | null;
  studyDocument: StudyDocumentEntry | null;
  aiAnswer: AiAnswer | null;
  currentPdfPage: number;
  currentDocumentPage: DocumentPageView | null;
  currentDocumentPages: DocumentPageView[];
  currentDocumentPageIndex: number;
  currentPageBookmarked: boolean;
  currentDocumentBookmarks: BookmarkedPage[];
  generatedWorkspacePages: GeneratedWorkspacePage[];
  memoPages: GeneratedWorkspacePage[];
  generatedPagesByDocument: Record<number, GeneratedWorkspacePage[]>;
  activePageByDocument: Record<number, DocumentPageView>;
  currentPdfPageByDocument: Record<number, number>;
  bookmarksByDocument: Record<number, BookmarkedPage[]>;
  backendPageIdsByDocument: Record<number, Record<number, number>>;
  currentDocumentHasBackendPages: boolean;
  inkByDocument: Record<number, InkStroke[]>;
  textAnnotationsByDocument: Record<number, InkTextAnnotation[]>;
  setGeneratedPagesByDocument: SetState<Record<number, GeneratedWorkspacePage[]>>;
  setActivePageByDocument: SetState<Record<number, DocumentPageView>>;
  setWorkspaceFeedback: SetState<string | null>;
  setUserStudyDocuments: SetState<StudyDocumentEntry[]>;
  setCurrentPdfPageByDocument: SetState<Record<number, number>>;
  setBackendPageIdsByDocument: SetState<Record<number, Record<number, number>>>;
  setInkTool: SetState<InkTool>;
  setInkByDocument: SetState<Record<number, InkStroke[]>>;
  setTextAnnotationsByDocument: SetState<Record<number, InkTextAnnotation[]>>;
  setBookmarksByDocument: SetState<Record<number, BookmarkedPage[]>>;
  clearCurrentSelection: () => void;
  pushWorkspaceHistorySnapshot: () => void;
}) {
  const getInsertAfterPage = (preferredPage?: number) => {
    if (preferredPage && Number.isFinite(preferredPage)) {
      return Math.max(1, Math.min(params.studyDocument?.pageCount ?? preferredPage, Math.floor(preferredPage)));
    }
    const page = params.currentDocumentPage;
    if (page?.kind !== 'generated') return params.currentPdfPage;
    return (
      params.generatedPagesByDocument[params.studyDocumentId ?? -1]?.find((value) => value.id === page.pageId)?.insertAfterPage
      ?? params.currentPdfPage
    );
  };

  const getCurrentPageBookmarkLabel = () => {
    if (!params.currentDocumentPage) return '현재 페이지';
    return getDocumentPageLabel({
      page: params.currentDocumentPage,
      pages: params.currentDocumentPages,
      memoPages: params.memoPages,
      pdfSuffix: '페이지',
    });
  };

  const getBackendNoteId = () => getStudyDocumentBackendNoteId(params.studyDocument);

  const applyBackendPageList = (pages: BackendNotePage[], activePageNumber: number, feedback: string) => {
    if (!params.studyDocumentId || !params.studyDocument) return;
    const backendPageIds = pages.reduce<Record<number, number>>((next, page) => {
      next[page.page_number] = page.id;
      return next;
    }, {});
    const nextPageCount = Math.max(1, pages.length);
    const nextActivePage = Math.max(1, Math.min(nextPageCount, activePageNumber));

    params.setBackendPageIdsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: backendPageIds,
    }));
    params.setUserStudyDocuments((current) => upsertStudyDocument(current, {
      ...params.studyDocument!,
      pageCount: nextPageCount,
      updatedAt: '방금 전',
    }));
    params.setCurrentPdfPageByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: nextActivePage,
    }));
    params.setActivePageByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: { kind: 'pdf', pageNumber: nextActivePage },
    }));
    params.clearCurrentSelection();
    params.setWorkspaceFeedback(feedback);
  };

  const duplicatePdfPageLocally = (pageNumber: number) => {
    if (!params.studyDocumentId) return;
    const timestamp = Date.now();
    params.setInkByDocument((current) => {
      const strokes = current[params.studyDocumentId!] ?? [];
      const shifted = strokes.map((stroke) => (
        !stroke.generatedPageId && stroke.pageNumber && stroke.pageNumber > pageNumber
          ? { ...stroke, pageNumber: stroke.pageNumber + 1 }
          : stroke
      ));
      const copied = strokes
        .filter((stroke) => !stroke.generatedPageId && stroke.pageNumber === pageNumber)
        .map((stroke, index) => ({
          ...stroke,
          id: `${stroke.id}-pdf-page-copy-${timestamp}-${index}`,
          pageNumber: pageNumber + 1,
        }));
      return { ...current, [params.studyDocumentId!]: [...shifted, ...copied] };
    });
    params.setTextAnnotationsByDocument((current) => {
      const annotations = current[params.studyDocumentId!] ?? [];
      const shifted = annotations.map((annotation) => (
        !annotation.generatedPageId && annotation.pageNumber > pageNumber
          ? { ...annotation, pageNumber: annotation.pageNumber + 1 }
          : annotation
      ));
      const copied = annotations
        .filter((annotation) => !annotation.generatedPageId && annotation.pageNumber === pageNumber)
        .map((annotation, index) => ({
          ...annotation,
          id: `${annotation.id}-pdf-page-copy-${timestamp}-${index}`,
          pageNumber: pageNumber + 1,
        }));
      return { ...current, [params.studyDocumentId!]: [...shifted, ...copied] };
    });
    params.setGeneratedPagesByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((page) => (
        page.insertAfterPage > pageNumber ? { ...page, insertAfterPage: page.insertAfterPage + 1 } : page
      )),
    }));
    params.setBookmarksByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((bookmark) => (
        bookmark.page.kind === 'pdf' && bookmark.page.pageNumber > pageNumber
          ? { ...bookmark, page: { kind: 'pdf', pageNumber: bookmark.page.pageNumber + 1 } }
          : bookmark
      )),
    }));
  };

  const deletePdfPageLocally = (pageNumber: number) => {
    if (!params.studyDocumentId) return;
    const removedGeneratedPageIds = new Set(
      (params.generatedPagesByDocument[params.studyDocumentId] ?? [])
        .filter((page) => page.insertAfterPage === pageNumber)
        .map((page) => page.id),
    );
    params.setInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? [])
        .filter((stroke) => stroke.generatedPageId ? !removedGeneratedPageIds.has(stroke.generatedPageId) : stroke.pageNumber !== pageNumber)
        .map((stroke) => (
          !stroke.generatedPageId && stroke.pageNumber && stroke.pageNumber > pageNumber
            ? { ...stroke, pageNumber: stroke.pageNumber - 1 }
            : stroke
        )),
    }));
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? [])
        .filter((annotation) => annotation.generatedPageId ? !removedGeneratedPageIds.has(annotation.generatedPageId) : annotation.pageNumber !== pageNumber)
        .map((annotation) => (
          !annotation.generatedPageId && annotation.pageNumber > pageNumber
            ? { ...annotation, pageNumber: annotation.pageNumber - 1 }
            : annotation
        )),
    }));
    params.setGeneratedPagesByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? [])
        .filter((page) => page.insertAfterPage !== pageNumber)
        .map((page) => (
          page.insertAfterPage > pageNumber ? { ...page, insertAfterPage: page.insertAfterPage - 1 } : page
        )),
    }));
    params.setBookmarksByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? [])
        .filter((bookmark) => {
          if (bookmark.page.kind === 'generated') return !removedGeneratedPageIds.has(bookmark.page.pageId);
          return bookmark.page.pageNumber !== pageNumber;
        })
        .map((bookmark) => (
          bookmark.page.kind === 'pdf' && bookmark.page.pageNumber > pageNumber
            ? { ...bookmark, page: { kind: 'pdf', pageNumber: bookmark.page.pageNumber - 1 } }
            : bookmark
        )),
    }));
  };

  const swapPdfPagesLocally = (pageNumber: number, delta: -1 | 1) => {
    if (!params.studyDocumentId) return;
    const nextPageNumber = pageNumber + delta;
    const swapNumber = (value: number) => (value === pageNumber ? nextPageNumber : value === nextPageNumber ? pageNumber : value);
    params.setInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((stroke) => (
        !stroke.generatedPageId && stroke.pageNumber
          ? { ...stroke, pageNumber: swapNumber(stroke.pageNumber) }
          : stroke
      )),
    }));
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((annotation) => (
        !annotation.generatedPageId ? { ...annotation, pageNumber: swapNumber(annotation.pageNumber) } : annotation
      )),
    }));
    params.setGeneratedPagesByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((page) => ({
        ...page,
        insertAfterPage: swapNumber(page.insertAfterPage),
      })),
    }));
    params.setBookmarksByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((bookmark) => (
        bookmark.page.kind === 'pdf'
          ? { ...bookmark, page: { kind: 'pdf', pageNumber: swapNumber(bookmark.page.pageNumber) } }
          : bookmark
      )),
    }));
  };

  const insertAiAnswerPage = () => {
    if (!params.studyDocumentId || !params.aiAnswer) return;
    params.pushWorkspaceHistorySnapshot();

    const generatedPageId = `ai-answer-page-${params.studyDocumentId}-${Date.now()}`;
    const generatedPage: GeneratedWorkspacePage = {
      id: generatedPageId,
      documentId: params.studyDocumentId,
      sourceAssetId: `ai-answer-${generatedPageId}`,
      pageKind: 'summary',
      title: 'AI 질문 정리',
      createdAt: params.aiAnswer.createdAt,
      insertAfterPage: getInsertAfterPage(),
      status: 'ready',
      summaryTitle: params.aiAnswer.question,
      summaryIntro: '선택 영역 질문을 바탕으로 만든 AI 정리입니다.',
      summarySections: params.aiAnswer.sections,
    };

    params.setGeneratedPagesByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [generatedPage, ...(current[params.studyDocumentId!] ?? [])],
    }));
    params.setActivePageByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: { kind: 'generated', pageId: generatedPageId },
    }));
    params.setWorkspaceFeedback('AI 응답을 정리 페이지로 추가했습니다.');
  };

  const createMemoPage = (insertAfterPageOverride?: number) => {
    if (!params.studyDocumentId || !params.studyDocument) return;

    if (params.studyDocument.type === 'blank') {
      const nextPage = params.studyDocument.pageCount + 1;
      const nextDocument = {
        ...params.studyDocument,
        pageCount: nextPage,
        updatedAt: '방금 전',
      };

      params.setUserStudyDocuments((current) => upsertStudyDocument(current, nextDocument));
      params.setCurrentPdfPageByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: nextPage,
      }));
      params.setActivePageByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: { kind: 'pdf', pageNumber: nextPage },
      }));
      if (isBackendApiEnabled() && params.currentDocumentHasBackendPages) {
        const backendNoteId = getBackendNoteId();
        if (!backendNoteId) return;
        void createBackendNotePage({
          noteId: backendNoteId,
          pageNumber: nextPage,
          content: serializeNotePageContent({ inkStrokes: [], textAnnotations: [] }),
        })
          .then((backendPage) => {
            params.setBackendPageIdsByDocument((current) => ({
              ...current,
              [params.studyDocumentId!]: {
                ...(current[params.studyDocumentId!] ?? {}),
                [nextPage]: backendPage.id,
              },
            }));
          })
          .catch(() => {
            params.setWorkspaceFeedback('새 페이지 저장에 실패했습니다. backend 연결을 확인해주세요.');
          });
      }
      params.setInkTool('pen');
      params.setWorkspaceFeedback(`${nextPage}페이지를 추가했습니다.`);
      return;
    }

    const insertAfterPage = getInsertAfterPage(insertAfterPageOverride);
    params.pushWorkspaceHistorySnapshot();
    const generatedPageId = `memo-page-${params.studyDocumentId}-${Date.now()}`;
    const nextMemoCount =
      (params.generatedPagesByDocument[params.studyDocumentId] ?? []).filter((value) => value.pageKind === 'memo' && value.insertAfterPage === insertAfterPage).length + 1;

    const memoPage: GeneratedWorkspacePage = {
      id: generatedPageId,
      documentId: params.studyDocumentId,
      sourceAssetId: generatedPageId,
      pageKind: 'memo',
      title: `${insertAfterPage}-${nextMemoCount} 메모`,
      createdAt: new Date().toISOString(),
      insertAfterPage,
      status: 'ready',
      summaryTitle: '',
      summaryIntro: '',
      summarySections: [],
    };

    params.setGeneratedPagesByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []), memoPage],
    }));
    params.setActivePageByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: { kind: 'generated', pageId: generatedPageId },
    }));
    params.setInkTool('pen');
    params.setWorkspaceFeedback(`${insertAfterPage}페이지 뒤에 메모 페이지를 추가했습니다.`);
  };

  const openGeneratedPage = (pageId: string) => {
    if (!params.studyDocumentId) return;
    params.setActivePageByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: { kind: 'generated', pageId },
    }));
  };

  const removeGeneratedPage = (pageId: string) => {
    if (!params.studyDocumentId) return;
    const target = (params.generatedPagesByDocument[params.studyDocumentId] ?? []).find((page) => page.id === pageId);
    if (!target || (target.pageKind !== 'memo' && !target.sourceAssetId.startsWith('ai-answer-'))) return;
    params.pushWorkspaceHistorySnapshot();

    params.setGeneratedPagesByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((page) => page.id !== pageId),
    }));
    params.setInkByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((stroke) => stroke.generatedPageId !== pageId),
    }));
    params.setTextAnnotationsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((annotation) => annotation.generatedPageId !== pageId),
    }));
    params.setBookmarksByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((bookmark) => bookmark.page.kind !== 'generated' || bookmark.page.pageId !== pageId),
    }));
    const activePage = params.activePageByDocument[params.studyDocumentId];
    if (activePage?.kind === 'generated' && activePage.pageId === pageId) {
      params.setActivePageByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: { kind: 'pdf', pageNumber: target.insertAfterPage },
      }));
      params.setCurrentPdfPageByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: target.insertAfterPage,
      }));
    }
    params.setWorkspaceFeedback('메모 페이지를 삭제했습니다.');
  };

  const duplicateGeneratedPage = (pageId: string) => {
    if (!params.studyDocumentId) return;
    const target = (params.generatedPagesByDocument[params.studyDocumentId] ?? []).find((page) => page.id === pageId);
    if (!target) return;
    params.pushWorkspaceHistorySnapshot();

    const nextPageId = `${target.pageKind}-page-${params.studyDocumentId}-${Date.now()}`;
    const copiedPage: GeneratedWorkspacePage = {
      ...target,
      id: nextPageId,
      sourceAssetId: `${target.sourceAssetId}-copy-${Date.now()}`,
      title: `${target.title} 복사본`,
      createdAt: new Date().toISOString(),
    };

    params.setGeneratedPagesByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []), copiedPage],
    }));
    params.setInkByDocument((current) => {
      const copiedStrokes = (current[params.studyDocumentId!] ?? [])
        .filter((stroke) => stroke.generatedPageId === pageId)
        .map((stroke, index) => ({
          ...stroke,
          id: `${stroke.id}-page-copy-${Date.now()}-${index}`,
          generatedPageId: nextPageId,
        }));
      return {
        ...current,
        [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []), ...copiedStrokes],
      };
    });
    params.setTextAnnotationsByDocument((current) => {
      const copiedAnnotations = (current[params.studyDocumentId!] ?? [])
        .filter((annotation) => annotation.generatedPageId === pageId)
        .map((annotation, index) => ({
          ...annotation,
          id: `${annotation.id}-page-copy-${Date.now()}-${index}`,
          generatedPageId: nextPageId,
        }));
      return {
        ...current,
        [params.studyDocumentId!]: [...(current[params.studyDocumentId!] ?? []), ...copiedAnnotations],
      };
    });
    params.clearCurrentSelection();
    params.setActivePageByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: { kind: 'generated', pageId: nextPageId },
    }));
    params.setWorkspaceFeedback('페이지를 복제했습니다.');
  };

  const moveGeneratedPage = (pageId: string, delta: -1 | 1) => {
    if (!params.studyDocumentId || !params.studyDocument) return;
    const target = (params.generatedPagesByDocument[params.studyDocumentId] ?? []).find((page) => page.id === pageId);
    if (!target) return;

    const nextInsertAfterPage = Math.max(1, Math.min(params.studyDocument.pageCount, target.insertAfterPage + delta));
    if (nextInsertAfterPage === target.insertAfterPage) return;
    params.pushWorkspaceHistorySnapshot();

    params.setGeneratedPagesByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((page) =>
        page.id === pageId
          ? {
              ...page,
              insertAfterPage: nextInsertAfterPage,
              title: page.pageKind === 'memo' ? `${nextInsertAfterPage}페이지 메모` : page.title,
              createdAt: new Date(Date.now() + delta).toISOString(),
            }
          : page,
      ),
    }));
    params.clearCurrentSelection();
    params.setWorkspaceFeedback(delta < 0 ? '페이지를 위로 이동했습니다.' : '페이지를 아래로 이동했습니다.');
  };

  const duplicatePdfPage = (pageNumber = params.currentPdfPage) => {
    if (!params.studyDocumentId || !params.studyDocument) return;
    if (!isBackendApiEnabled() || !params.currentDocumentHasBackendPages) {
      params.setWorkspaceFeedback('백엔드에 저장된 PDF만 페이지 복제를 지원합니다.');
      return;
    }
    const backendNoteId = getBackendNoteId();
    if (!backendNoteId) return;

    void duplicateBackendNotePage({ noteId: backendNoteId, pageNumber })
      .then((pages) => {
        params.pushWorkspaceHistorySnapshot();
        duplicatePdfPageLocally(pageNumber);
        applyBackendPageList(pages, pageNumber + 1, 'PDF 페이지를 복제했습니다.');
      })
      .catch(() => {
        params.setWorkspaceFeedback('PDF 페이지 복제 저장에 실패했습니다. 새로고침 후 다시 시도해주세요.');
      });
  };

  const removePdfPage = (pageNumber = params.currentPdfPage) => {
    if (!params.studyDocumentId || !params.studyDocument) return;
    if (params.studyDocument.pageCount <= 1) {
      params.setWorkspaceFeedback('마지막 페이지는 삭제할 수 없습니다.');
      return;
    }
    if (!isBackendApiEnabled() || !params.currentDocumentHasBackendPages) {
      params.setWorkspaceFeedback('백엔드에 저장된 PDF만 페이지 삭제를 지원합니다.');
      return;
    }
    const backendNoteId = getBackendNoteId();
    if (!backendNoteId) return;

    const nextActivePage = Math.max(1, Math.min(params.studyDocument.pageCount - 1, pageNumber));
    void deleteBackendNotePageByNumber({ noteId: backendNoteId, pageNumber })
      .then((pages) => {
        params.pushWorkspaceHistorySnapshot();
        deletePdfPageLocally(pageNumber);
        applyBackendPageList(pages, nextActivePage, 'PDF 페이지를 삭제했습니다.');
      })
      .catch(() => {
        params.setWorkspaceFeedback('PDF 페이지 삭제 저장에 실패했습니다. 새로고침 후 다시 시도해주세요.');
      });
  };

  const movePdfPage = (pageNumber = params.currentPdfPage, delta: -1 | 1) => {
    if (!params.studyDocumentId || !params.studyDocument) return;
    const nextPageNumber = pageNumber + delta;
    if (nextPageNumber < 1 || nextPageNumber > params.studyDocument.pageCount) return;
    if (!isBackendApiEnabled() || !params.currentDocumentHasBackendPages) {
      params.setWorkspaceFeedback('백엔드에 저장된 PDF만 페이지 이동을 지원합니다.');
      return;
    }
    const backendNoteId = getBackendNoteId();
    if (!backendNoteId) return;

    void moveBackendNotePage({ noteId: backendNoteId, pageNumber, delta })
      .then((pages) => {
        params.pushWorkspaceHistorySnapshot();
        swapPdfPagesLocally(pageNumber, delta);
        applyBackendPageList(pages, nextPageNumber, delta < 0 ? 'PDF 페이지를 위로 이동했습니다.' : 'PDF 페이지를 아래로 이동했습니다.');
      })
      .catch(() => {
        params.setWorkspaceFeedback('PDF 페이지 이동 저장에 실패했습니다. 새로고침 후 다시 시도해주세요.');
      });
  };

  const updateStudyDocumentPageCount = (pageCount: number) => {
    if (!params.studyDocumentId || !params.studyDocument || !Number.isFinite(pageCount) || pageCount < 1) return;
    if (pageCount < params.studyDocument.pageCount) return;
    if (pageCount === params.studyDocument.pageCount) return;
    params.setUserStudyDocuments((current) => upsertStudyDocument(current, {
      ...params.studyDocument!,
      pageCount,
    }));
    if (isBackendApiEnabled() && params.currentDocumentHasBackendPages) {
      const backendNoteId = getBackendNoteId();
      if (!backendNoteId) return;
      const existingPages = params.backendPageIdsByDocument[params.studyDocumentId] ?? {};
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        if (existingPages[pageNumber]) continue;

        void createBackendNotePage({
          noteId: backendNoteId,
          pageNumber,
          content: serializeNotePageContent({ inkStrokes: [], textAnnotations: [] }),
        })
          .then((backendPage) => {
            params.setBackendPageIdsByDocument((current) => ({
              ...current,
              [params.studyDocumentId!]: {
                ...(current[params.studyDocumentId!] ?? {}),
                [pageNumber]: backendPage.id,
              },
            }));
          })
          .catch(() => {
            params.setWorkspaceFeedback('페이지 저장 준비에 실패했습니다. backend 연결을 확인해주세요.');
          });
      }
    }
  };

  const setCurrentPdfPage = (pageNumber: number) => {
    if (!params.studyDocumentId || !params.studyDocument) return;

    const nextPage = Math.max(1, Math.min(pageNumber, params.studyDocument.pageCount));
    params.clearCurrentSelection();
    params.setCurrentPdfPageByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: nextPage,
    }));
    params.setActivePageByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: { kind: 'pdf', pageNumber: nextPage },
    }));
  };

  const moveDocumentPage = (delta: -1 | 1) => {
    if (!params.studyDocumentId || params.currentDocumentPages.length === 0) return;
    const currentIndex = params.currentDocumentPageIndex >= 0 ? params.currentDocumentPageIndex : 0;
    const nextPage = params.currentDocumentPages[currentIndex + delta];
    if (!nextPage) return;

    params.clearCurrentSelection();
    params.setActivePageByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: nextPage,
    }));
    if (nextPage.kind === 'pdf') {
      params.setCurrentPdfPageByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: nextPage.pageNumber,
      }));
    }
  };

  const toggleBookmarkCurrentPage = () => {
    if (!params.studyDocumentId || !params.currentDocumentPage) return;
    const label = getCurrentPageBookmarkLabel();

    params.setBookmarksByDocument((current) => {
      const bookmarks = current[params.studyDocumentId!] ?? [];
      const alreadyBookmarked = bookmarks.some((bookmark) => isSameDocumentPage(bookmark.page, params.currentDocumentPage!));
      const nextBookmarks = alreadyBookmarked
        ? bookmarks.filter((bookmark) => !isSameDocumentPage(bookmark.page, params.currentDocumentPage!))
        : [
            {
              id: `bookmark-${params.studyDocumentId}-${Date.now()}`,
              documentId: params.studyDocumentId!,
              page: params.currentDocumentPage!,
              label,
              createdAt: new Date().toISOString(),
            },
            ...bookmarks,
          ];

      return {
        ...current,
        [params.studyDocumentId!]: nextBookmarks,
      };
    });

    params.setWorkspaceFeedback(params.currentPageBookmarked ? '중요 페이지에서 해제했습니다.' : '중요 페이지로 저장했습니다.');
  };

  const openBookmarkedPage = (bookmarkId: string) => {
    if (!params.studyDocumentId) return;
    const bookmark = (params.bookmarksByDocument[params.studyDocumentId] ?? []).find((value) => value.id === bookmarkId);
    if (!bookmark) return;
    const targetPage = bookmark.page;

    params.clearCurrentSelection();
    params.setActivePageByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: targetPage,
    }));
    if (targetPage.kind === 'pdf') {
      params.setCurrentPdfPageByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: targetPage.pageNumber,
      }));
    }
  };

  const removeBookmark = (bookmarkId: string) => {
    if (!params.studyDocumentId) return;
    params.setBookmarksByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((bookmark) => bookmark.id !== bookmarkId),
    }));
    params.setWorkspaceFeedback('중요 페이지를 삭제했습니다.');
  };

  const exportCurrentDocumentSummary = async () => {
    if (!params.studyDocumentId || !params.studyDocument) return;

    const bookmarkLines = params.currentDocumentBookmarks.length
      ? params.currentDocumentBookmarks.map((bookmark) => `- ${bookmark.label}`).join('\n')
      : '- 저장된 중요 페이지 없음';
    const generatedPageLines = params.generatedWorkspacePages.length
      ? params.generatedWorkspacePages.map((page) => `- ${page.title} (${page.insertAfterPage}페이지 뒤)`).join('\n')
      : '- 추가 정리/메모 페이지 없음';
    const annotationCount = (params.inkByDocument[params.studyDocumentId] ?? []).length + (params.textAnnotationsByDocument[params.studyDocumentId] ?? []).length;

    try {
      await Share.share({
        title: `${params.studyDocument.title} 내보내기`,
        message: [
          'B-SNAP 문서 내보내기',
          `문서: ${params.studyDocument.title}`,
          `현재 위치: ${getCurrentPageBookmarkLabel()}`,
          `전체 페이지: ${params.currentDocumentPages.length || params.studyDocument.pageCount}`,
          `필기/메모 수: ${annotationCount}`,
          '',
          '중요 페이지',
          bookmarkLines,
          '',
          '추가 페이지',
          generatedPageLines,
        ].join('\n'),
      });
      params.setWorkspaceFeedback('문서 요약을 공유 시트로 내보냈습니다.');
    } catch {
      params.setWorkspaceFeedback('이 기기에서는 내보내기를 열지 못했습니다.');
    }
  };

  return {
    insertAiAnswerPage,
    createMemoPage,
    openGeneratedPage,
    removeGeneratedPage,
    duplicateGeneratedPage,
    moveGeneratedPage,
    duplicatePdfPage,
    removePdfPage,
    movePdfPage,
    updateStudyDocumentPageCount,
    setCurrentPdfPage,
    moveDocumentPage,
    toggleBookmarkCurrentPage,
    openBookmarkedPage,
    removeBookmark,
    exportCurrentDocumentSummary,
  };
}
