import React, { createContext, useContext } from 'react';
import type { AiAnswer, BookmarkedPage, DocumentPageView, GeneratedWorkspacePage, NotebookPage, StudyDocumentEntry } from '../../../types';
import { useNotesGlobalContext } from './notes-global-context';

export type DocumentState = {
  studyDocumentId: number | null;
  studyDocument: StudyDocumentEntry | null;
  currentDocumentPage: DocumentPageView | null;
  currentDocumentPages: DocumentPageView[];
  notebookPages: NotebookPage[];
  currentDocumentPageIndex: number;
  currentPdfPage: number;
  currentPageBookmarked: boolean;
  currentDocumentBookmarks: BookmarkedPage[];
  generatedWorkspacePages: GeneratedWorkspacePage[];
  memoPages: GeneratedWorkspacePage[];
  activeGeneratedPage: GeneratedWorkspacePage | null;
  currentDocumentHasBackendPages: boolean;
  totalDocumentPageCount: number;
};

export type DocumentActions = {
  onInsertAiAnswerPage: () => void;
  onCreateMemoPage: (insertAfterPage?: number) => void;
  onOpenGeneratedPage: (pageId: string) => void;
  onRemoveGeneratedPage: (pageId: string) => void;
  onDuplicateGeneratedPage: (pageId: string) => void;
  onMoveGeneratedPage: (pageId: string, delta: -1 | 1) => void;
  onDuplicatePdfPage: (pageNumber?: number) => void;
  onRemovePdfPage: (pageNumber?: number) => void;
  onMovePdfPage: (pageNumber: number | undefined, delta: -1 | 1) => void;
  onUpdateStudyDocumentPageCount: (pageCount: number) => void;
  onSetCurrentPdfPage: (pageNumber: number) => void;
  onGoToPreviousDocumentPage: () => void;
  onGoToNextDocumentPage: () => void;
  onToggleBookmarkCurrentPage: () => void;
  onOpenBookmarkedPage: (bookmarkId: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onExportCurrentDocument: () => void;
};

const DocumentContext = createContext<(DocumentState & DocumentActions) | null>(null);

export function DocumentProvider({ children }: { children: React.ReactNode }) {
  const global = useNotesGlobalContext();

  const value = {
    studyDocumentId: global.studyDocumentId ?? null,
    studyDocument: global.studyDocument ?? null,
    currentDocumentPage: global.currentDocumentPage ?? null,
    currentDocumentPages: global.currentDocumentPages ?? [],
    notebookPages: global.notebookPages ?? [],
    currentDocumentPageIndex: global.currentDocumentPageIndex ?? 0,
    currentPdfPage: global.currentPdfPage ?? 1,
    currentPageBookmarked: global.currentPageBookmarked ?? false,
    currentDocumentBookmarks: global.bookmarks ?? [],
    generatedWorkspacePages: global.generatedWorkspacePages ?? [],
    memoPages: global.memoPages ?? [],
    activeGeneratedPage: global.activeGeneratedPage ?? null,
    currentDocumentHasBackendPages: global.currentDocumentHasBackendPages ?? true,
    totalDocumentPageCount: global.totalDocumentPageCount ?? 0,

    onInsertAiAnswerPage: global.onInsertAiAnswerPage,
    onCreateMemoPage: global.onCreateMemoPage,
    onOpenGeneratedPage: global.onOpenGeneratedPage,
    onRemoveGeneratedPage: global.onRemoveGeneratedPage,
    onDuplicateGeneratedPage: global.onDuplicateGeneratedPage,
    onMoveGeneratedPage: global.onMoveGeneratedPage,
    onDuplicatePdfPage: global.onDuplicatePdfPage,
    onRemovePdfPage: global.onRemovePdfPage,
    onMovePdfPage: global.onMovePdfPage,
    onUpdateStudyDocumentPageCount: global.onUpdateStudyDocumentPageCount,
    onSetCurrentPdfPage: global.onSetCurrentPdfPage,
    onGoToPreviousDocumentPage: global.onGoToPreviousDocumentPage,
    onGoToNextDocumentPage: global.onGoToNextDocumentPage,
    onToggleBookmarkCurrentPage: global.onToggleBookmarkCurrentPage,
    onOpenBookmarkedPage: global.onOpenBookmarkedPage,
    onRemoveBookmark: global.onRemoveBookmark,
    onExportCurrentDocument: global.onExportCurrentDocument,
  };

  return <DocumentContext.Provider value={value}>{children}</DocumentContext.Provider>;
}

export function useDocumentContext() {
  const context = useContext(DocumentContext);
  if (!context) {
    throw new Error('useDocumentContext must be used within a DocumentProvider');
  }
  return context;
}
