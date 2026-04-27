import { useMemo } from 'react';
import { notes, studyDocuments, subjects as fallbackSubjects } from '../../data';
import { isSameDocumentPage } from '../../ui-helpers';
import type { InkStroke, InkTextAnnotation, SelectionRect } from '../../ui-types';
import type {
  BookmarkedPage,
  CaptureAsset,
  DocumentPageView,
  GeneratedWorkspacePage,
  NoteEntry,
  StudyDocumentEntry,
  Subject,
  WorkspaceAttachment,
} from '../../types';
import { buildDocumentPageSequence, filterNotesByQuery, filterStudyDocumentsByQuery } from './helpers';

export function useStudyWorkspaceDerivedState(params: {
  subjects: Subject[];
  subjectId: number | null;
  noteId: number | null;
  query: string;
  sort: 'latest' | 'oldest';
  studyDocumentId: number | null;
  userStudyDocuments: StudyDocumentEntry[];
  deletedNoteIds: number[];
  deletedStudyDocumentIds: number[];
  captureAssetsBySubject: Record<number, CaptureAsset[]>;
  attachmentsByDocument: Record<number, WorkspaceAttachment[]>;
  generatedPagesByDocument: Record<number, GeneratedWorkspacePage[]>;
  currentPdfPageByDocument: Record<number, number>;
  activePageByDocument: Record<number, DocumentPageView>;
  bookmarksByDocument: Record<number, BookmarkedPage[]>;
  inkByDocument: Record<number, InkStroke[]>;
  textAnnotationsByDocument: Record<number, InkTextAnnotation[]>;
  selectionByDocument: Record<number, SelectionRect | null>;
  incomingAssetSuggestion: CaptureAsset | null;
}) {
  const availableSubjects = params.subjects.length ? params.subjects : fallbackSubjects;
  const deletedNoteIds = useMemo(() => new Set(params.deletedNoteIds), [params.deletedNoteIds]);
  const deletedStudyDocumentIds = useMemo(() => new Set(params.deletedStudyDocumentIds), [params.deletedStudyDocumentIds]);
  const visibleNotes = useMemo(
    () => notes.filter((value) => !deletedNoteIds.has(value.id)),
    [deletedNoteIds],
  );
  const deletedNotes = useMemo(
    () => notes.filter((value) => deletedNoteIds.has(value.id)),
    [deletedNoteIds],
  );
  const mergedStudyDocuments = useMemo(
    () => {
      const userDocumentIds = new Set(params.userStudyDocuments.map((document) => document.id));
      return [
        ...params.userStudyDocuments,
        ...studyDocuments.filter((document) => !userDocumentIds.has(document.id)),
      ];
    },
    [params.userStudyDocuments],
  );
  const allStudyDocuments = useMemo(
    () => mergedStudyDocuments.filter((document) => !deletedStudyDocumentIds.has(document.id)),
    [deletedStudyDocumentIds, mergedStudyDocuments],
  );
  const deletedStudyDocuments = useMemo(
    () => mergedStudyDocuments.filter((document) => deletedStudyDocumentIds.has(document.id)),
    [deletedStudyDocumentIds, mergedStudyDocuments],
  );
  const subject = useMemo(
    () => availableSubjects.find((value) => value.id === params.subjectId) ?? null,
    [availableSubjects, params.subjectId],
  );
  const note = useMemo<NoteEntry | null>(
    () => visibleNotes.find((value) => value.id === params.noteId) ?? null,
    [params.noteId, visibleNotes],
  );
  const studyDocument = useMemo(
    () => allStudyDocuments.find((value) => value.id === params.studyDocumentId) ?? null,
    [allStudyDocuments, params.studyDocumentId],
  );
  const selectionRect = params.studyDocumentId ? params.selectionByDocument[params.studyDocumentId] ?? null : null;
  const captureInbox = useMemo(() => {
    if (!params.subjectId) return [];
    return (params.captureAssetsBySubject[params.subjectId] ?? []).filter((asset) => asset.status !== 'dismissed');
  }, [params.captureAssetsBySubject, params.subjectId]);
  const workspaceAttachments = useMemo(() => {
    if (!params.studyDocumentId) return [];
    return params.attachmentsByDocument[params.studyDocumentId] ?? [];
  }, [params.attachmentsByDocument, params.studyDocumentId]);
  const generatedWorkspacePages = useMemo(() => {
    if (!params.studyDocumentId) return [];
    return params.generatedPagesByDocument[params.studyDocumentId] ?? [];
  }, [params.generatedPagesByDocument, params.studyDocumentId]);
  const currentPdfPage = params.studyDocumentId ? params.currentPdfPageByDocument[params.studyDocumentId] ?? 1 : 1;
  const currentDocumentPages = useMemo(() => {
    if (!studyDocument) return [];
    return buildDocumentPageSequence(studyDocument.pageCount, generatedWorkspacePages);
  }, [generatedWorkspacePages, studyDocument]);
  const currentDocumentPage = useMemo(() => {
    if (!params.studyDocumentId) return null;
    return params.activePageByDocument[params.studyDocumentId] ?? { kind: 'pdf' as const, pageNumber: currentPdfPage };
  }, [params.activePageByDocument, currentPdfPage, params.studyDocumentId]);
  const currentDocumentPageIndex = useMemo(() => {
    if (!currentDocumentPage) return 0;
    return currentDocumentPages.findIndex((value) => isSameDocumentPage(value, currentDocumentPage));
  }, [currentDocumentPage, currentDocumentPages]);
  const totalDocumentPageCount = currentDocumentPages.length;
  const activeGeneratedPage = useMemo(() => {
    if (!params.studyDocumentId || currentDocumentPage?.kind !== 'generated') return null;
    return params.generatedPagesByDocument[params.studyDocumentId]?.find((value) => value.id === currentDocumentPage.pageId) ?? null;
  }, [currentDocumentPage, params.generatedPagesByDocument, params.studyDocumentId]);
  const memoPages = useMemo(
    () => generatedWorkspacePages.filter((value) => value.pageKind === 'memo'),
    [generatedWorkspacePages],
  );
  const currentDocumentBookmarks = useMemo(() => {
    if (!params.studyDocumentId) return [];
    return params.bookmarksByDocument[params.studyDocumentId] ?? [];
  }, [params.bookmarksByDocument, params.studyDocumentId]);
  const currentPageBookmarked = useMemo(() => {
    if (!currentDocumentPage) return false;
    return currentDocumentBookmarks.some((bookmark) => isSameDocumentPage(bookmark.page, currentDocumentPage));
  }, [currentDocumentBookmarks, currentDocumentPage]);
  const inkStrokes = useMemo(() => {
    if (!params.studyDocumentId) return [];
    const documentInk = params.inkByDocument[params.studyDocumentId] ?? [];
    if (currentDocumentPage?.kind === 'generated') {
      return documentInk.filter((stroke) => stroke.generatedPageId === currentDocumentPage.pageId);
    }
    return documentInk.filter((stroke) => {
      if (stroke.generatedPageId) return false;
      if (studyDocument?.type === 'blank') return (stroke.pageNumber ?? 1) === currentPdfPage;
      return !stroke.pageNumber || stroke.pageNumber === currentPdfPage;
    });
  }, [currentDocumentPage, currentPdfPage, params.inkByDocument, params.studyDocumentId, studyDocument?.type]);
  const textAnnotations = useMemo(() => {
    if (!params.studyDocumentId) return [];
    const documentAnnotations = params.textAnnotationsByDocument[params.studyDocumentId] ?? [];
    if (currentDocumentPage?.kind === 'generated') {
      return documentAnnotations.filter((annotation) => annotation.generatedPageId === currentDocumentPage.pageId);
    }
    const currentAnnotationPage = currentPdfPage;
    return documentAnnotations.filter((annotation) => !annotation.generatedPageId && annotation.pageNumber === currentAnnotationPage);
  }, [currentDocumentPage, currentPdfPage, params.studyDocumentId, params.textAnnotationsByDocument]);
  const inboxPendingCount = useMemo(
    () => captureInbox.filter((asset) => asset.status === 'uploaded' || asset.status === 'archived').length,
    [captureInbox],
  );
  const inboxHint = useMemo(() => {
    if (params.incomingAssetSuggestion || !params.studyDocumentId || inboxPendingCount === 0) return null;
    return `현재 문서와 다른 흐름의 자료 ${inboxPendingCount}건이 inbox에 쌓였습니다.`;
  }, [params.incomingAssetSuggestion, inboxPendingCount, params.studyDocumentId]);
  const filteredNotes = useMemo(
    () => filterNotesByQuery({ notes: visibleNotes, subjects: availableSubjects, subjectId: params.subjectId, query: params.query, sort: params.sort }),
    [availableSubjects, params.query, params.sort, params.subjectId, visibleNotes],
  );
  const filteredStudyDocuments = useMemo(
    () =>
      filterStudyDocumentsByQuery({
        studyDocuments: allStudyDocuments,
        subjects: availableSubjects,
        subjectId: params.subjectId,
        query: params.query,
        sort: params.sort,
      }),
    [allStudyDocuments, availableSubjects, params.query, params.sort, params.subjectId],
  );
  const currentAiPageLabel = useMemo(() => {
    if (currentDocumentPage?.kind === 'generated') {
      return activeGeneratedPage?.title ?? '생성 페이지';
    }

    return `${currentPdfPage}페이지`;
  }, [activeGeneratedPage?.title, currentDocumentPage, currentPdfPage]);

  return {
    availableSubjects,
    visibleNotes,
    deletedNotes,
    allStudyDocuments,
    deletedStudyDocuments,
    subject,
    note,
    studyDocument,
    selectionRect,
    captureInbox,
    workspaceAttachments,
    generatedWorkspacePages,
    currentPdfPage,
    currentDocumentPages,
    currentDocumentPage,
    currentDocumentPageIndex,
    totalDocumentPageCount,
    activeGeneratedPage,
    memoPages,
    currentDocumentBookmarks,
    currentPageBookmarked,
    inkStrokes,
    textAnnotations,
    inboxPendingCount,
    inboxHint,
    filteredNotes,
    filteredStudyDocuments,
    currentAiPageLabel,
  };
}
