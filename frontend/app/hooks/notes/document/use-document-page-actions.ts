import type { Dispatch, SetStateAction } from 'react';
import { Share } from 'react-native';
import { createBackendNotePage, isBackendApiEnabled } from '../../../services/backend-api';
import type { InkStroke, InkTextAnnotation, InkTool } from '../../../ui-types';
import type { AiAnswer, BookmarkedPage, DocumentPageView, GeneratedWorkspacePage, StudyDocumentEntry } from '../../../types';
import { getDocumentPageLabel, isSameDocumentPage } from '../../../ui-helpers';
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
}) {
  const getInsertAfterPage = () => {
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

  const insertAiAnswerPage = () => {
    if (!params.studyDocumentId || !params.aiAnswer) return;

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

  const createMemoPage = () => {
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
        void createBackendNotePage({
          noteId: params.studyDocumentId,
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

    const insertAfterPage = getInsertAfterPage();
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

  const updateStudyDocumentPageCount = (pageCount: number) => {
    if (!params.studyDocumentId || !params.studyDocument || !Number.isFinite(pageCount) || pageCount < 1) return;
    params.setUserStudyDocuments((current) => upsertStudyDocument(current, {
      ...params.studyDocument!,
      pageCount,
    }));
    if (isBackendApiEnabled() && params.currentDocumentHasBackendPages) {
      const existingPages = params.backendPageIdsByDocument[params.studyDocumentId] ?? {};
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        if (existingPages[pageNumber]) continue;

        void createBackendNotePage({
          noteId: params.studyDocumentId,
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
    updateStudyDocumentPageCount,
    setCurrentPdfPage,
    moveDocumentPage,
    toggleBookmarkCurrentPage,
    openBookmarkedPage,
    removeBookmark,
    exportCurrentDocumentSummary,
  };
}
