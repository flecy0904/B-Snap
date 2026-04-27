import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Share } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { notes } from '../data';
import { requestMockAiAnswer, type MockAiAnswer } from '../services/mock-ai-service';
import {
  createBackendChatSession,
  createBackendNote,
  createBackendNotePage,
  deleteBackendNote,
  ensureFolderForSubject,
  isBackendApiEnabled,
  listBackendFolders,
  listBackendNotePages,
  listBackendNotes,
  sendBackendAiMessage,
  updateBackendNote,
} from '../services/backend-api';
import {
  buildEmptyStudyWorkspaceState,
  clearStudyWorkspaceState,
  type PersistedStudyWorkspaceState,
} from '../storage/local-workspace-store';
import { findInkStrokesInRect, getDocumentPageLabel, isSameDocumentPage, scaleInkStrokeToPageSize } from '../ui-helpers';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_PEN_COLOR,
  HIGHLIGHT_BRUSH_COLORS,
  PEN_BRUSH_COLORS,
  buildGeneratedSummary,
  buildWorkspaceAttachment,
} from './study-workspace/helpers';
import { useIncomingAssetSubscription } from './study-workspace/use-incoming-asset-subscription';
import { useStudyWorkspaceDerivedState } from './study-workspace/use-study-workspace-derived-state';
import { useStudyWorkspacePersistence } from './study-workspace/use-study-workspace-persistence';
import type { InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../ui-types';
import type { BookmarkedPage, CaptureAsset, DocumentPageView, GeneratedWorkspacePage, NoteWorkspaceMode, StudyDocumentEntry, Subject, WorkspaceAttachment } from '../types';

function addUniqueId(ids: number[], id: number) {
  return ids.includes(id) ? ids : [...ids, id];
}

function removeId(ids: number[], id: number) {
  return ids.filter((value) => value !== id);
}

function upsertStudyDocument(documents: StudyDocumentEntry[], nextDocument: StudyDocumentEntry) {
  const exists = documents.some((document) => document.id === nextDocument.id);
  if (!exists) return [nextDocument, ...documents];

  return documents.map((document) => (
    document.id === nextDocument.id ? nextDocument : document
  ));
}

function confirmDestructiveAction(params: {
  title: string;
  message: string;
  confirmText: string;
  onConfirm: () => void;
}) {
  if (Platform.OS === 'web') {
    const confirmed = typeof globalThis.confirm === 'function'
      ? globalThis.confirm(`${params.title}\n\n${params.message}`)
      : false;
    if (confirmed) params.onConfirm();
    return;
  }

  Alert.alert(
    params.title,
    params.message,
    [
      { text: '취소', style: 'cancel' },
      {
        text: params.confirmText,
        style: 'destructive',
        onPress: params.onConfirm,
      },
    ],
  );
}

export function useStudyWorkspace(props: {
  wide: boolean;
  subjects: Subject[];
  initialSubjectId: number | null;
  onOpenNotesTab: () => void;
}) {
  const [subjectId, setSubjectId] = useState<number | null>(props.initialSubjectId);
  const [noteId, setNoteId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'latest' | 'oldest'>('latest');
  const [noteDetailTab, setNoteDetailTab] = useState<'original' | 'summary'>('original');
  const [noteWorkspaceMode, setNoteWorkspaceMode] = useState<NoteWorkspaceMode>('photo');
  const [studyDocumentId, setStudyDocumentId] = useState<number | null>(null);
  const [inkTool, setInkTool] = useState<InkTool>('view');
  const [penColor, setPenColor] = useState<string>(DEFAULT_PEN_COLOR);
  const [penWidth, setPenWidth] = useState(3);
  const [inkByDocument, setInkByDocument] = useState<Record<number, InkStroke[]>>({});
  const [redoInkByDocument, setRedoInkByDocument] = useState<Record<number, InkStroke[]>>({});
  const [textAnnotationsByDocument, setTextAnnotationsByDocument] = useState<Record<number, InkTextAnnotation[]>>({});
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [selectionByDocument, setSelectionByDocument] = useState<Record<number, SelectionRect | null>>({});
  const [aiQuestion, setAiQuestion] = useState('');
  const [incomingAssetSuggestion, setIncomingAssetSuggestion] = useState<CaptureAsset | null>(null);
  const [captureAssetsBySubject, setCaptureAssetsBySubject] = useState<Record<number, CaptureAsset[]>>({});
  const [attachmentsByDocument, setAttachmentsByDocument] = useState<Record<number, WorkspaceAttachment[]>>({});
  const [generatedPagesByDocument, setGeneratedPagesByDocument] = useState<Record<number, GeneratedWorkspacePage[]>>({});
  const [userStudyDocuments, setUserStudyDocuments] = useState<StudyDocumentEntry[]>([]);
  const [deletedNoteIds, setDeletedNoteIds] = useState<number[]>([]);
  const [deletedStudyDocumentIds, setDeletedStudyDocumentIds] = useState<number[]>([]);
  const [currentPdfPageByDocument, setCurrentPdfPageByDocument] = useState<Record<number, number>>({});
  const [activePageByDocument, setActivePageByDocument] = useState<Record<number, DocumentPageView>>({});
  const [bookmarksByDocument, setBookmarksByDocument] = useState<Record<number, BookmarkedPage[]>>({});
  const [workspaceFeedback, setWorkspaceFeedback] = useState<string | null>(null);
  const [incomingBannerQueue, setIncomingBannerQueue] = useState<CaptureAsset[]>([]);
  const [aiAnswer, setAiAnswer] = useState<MockAiAnswer | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [chatSessionByDocument, setChatSessionByDocument] = useState<Record<number, number>>({});

  const {
    availableSubjects,
    allStudyDocuments,
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
    visibleNotes,
    deletedNotes,
    deletedStudyDocuments,
  } = useStudyWorkspaceDerivedState({
    subjects: props.subjects,
    subjectId,
    noteId,
    query,
    sort,
    studyDocumentId,
    userStudyDocuments,
    deletedNoteIds,
    deletedStudyDocumentIds,
    captureAssetsBySubject,
    attachmentsByDocument,
    generatedPagesByDocument,
    currentPdfPageByDocument,
    activePageByDocument,
    bookmarksByDocument,
    inkByDocument,
    textAnnotationsByDocument,
    selectionByDocument,
    incomingAssetSuggestion,
  });
  const activeIncomingBanner = incomingBannerQueue[0] ?? null;
  const hydrateWorkspaceState = useCallback((snapshot: PersistedStudyWorkspaceState | null) => {
    if (!snapshot) return;
    setUserStudyDocuments(snapshot.userStudyDocuments);
    setDeletedNoteIds(snapshot.deletedNoteIds ?? []);
    setDeletedStudyDocumentIds(snapshot.deletedStudyDocumentIds ?? []);
    setCaptureAssetsBySubject(snapshot.captureAssetsBySubject);
    setAttachmentsByDocument(snapshot.attachmentsByDocument);
    setGeneratedPagesByDocument(snapshot.generatedPagesByDocument);
    setInkByDocument(snapshot.inkByDocument);
    setTextAnnotationsByDocument(snapshot.textAnnotationsByDocument);
    setCurrentPdfPageByDocument(snapshot.currentPdfPageByDocument);
    setActivePageByDocument(snapshot.activePageByDocument);
    setBookmarksByDocument(snapshot.bookmarksByDocument ?? {});
  }, []);
  const persistedWorkspaceState = useMemo<PersistedStudyWorkspaceState>(() => ({
    version: 1,
    userStudyDocuments,
    deletedNoteIds,
    deletedStudyDocumentIds,
    captureAssetsBySubject,
    attachmentsByDocument,
    generatedPagesByDocument,
    inkByDocument,
    textAnnotationsByDocument,
    currentPdfPageByDocument,
    activePageByDocument,
    bookmarksByDocument,
  }), [
    activePageByDocument,
    attachmentsByDocument,
    bookmarksByDocument,
    captureAssetsBySubject,
    currentPdfPageByDocument,
    deletedNoteIds,
    deletedStudyDocumentIds,
    generatedPagesByDocument,
    inkByDocument,
    textAnnotationsByDocument,
    userStudyDocuments,
  ]);
  const { workspaceHydrated, localPersistenceError } = useStudyWorkspacePersistence({
    state: persistedWorkspaceState,
    onHydrate: hydrateWorkspaceState,
  });

  useEffect(() => {
    if (!workspaceFeedback) return;
    const timer = setTimeout(() => setWorkspaceFeedback(null), 2200);
    return () => clearTimeout(timer);
  }, [workspaceFeedback]);

  useEffect(() => {
    if (!activeIncomingBanner) return;
    const timer = setTimeout(() => {
      setIncomingBannerQueue((current) => (
        current[0]?.id === activeIncomingBanner.id ? current.slice(1) : current
      ));
    }, 4500);
    return () => clearTimeout(timer);
  }, [activeIncomingBanner]);

  useIncomingAssetSubscription({
    noteWorkspaceMode,
    studyDocumentId,
    subjectId,
    setCaptureAssetsBySubject,
    setIncomingBannerQueue,
    setIncomingAssetSuggestion,
  });

  useEffect(() => {
    if (!workspaceHydrated || !isBackendApiEnabled()) return;

    let mounted = true;

    const loadBackendDocuments = async () => {
      try {
        const [folders, backendNotes] = await Promise.all([
          listBackendFolders(),
          listBackendNotes(),
        ]);
        const documents = await Promise.all(
          backendNotes.map(async (backendNote) => {
            const folder = folders.find((item) => item.id === backendNote.folder_id);
            const subject = availableSubjects.find((item) => item.name === folder?.name) ?? availableSubjects[0] ?? null;
            const pages = await listBackendNotePages(backendNote.id);
            const firstPage = pages[0] ?? null;

            return {
              id: backendNote.id,
              subjectId: subject?.id ?? props.initialSubjectId ?? 101,
              title: backendNote.title,
              type: firstPage?.image_url ? 'pdf' as const : 'blank' as const,
              updatedAt: 'DB 저장됨',
              pageCount: Math.max(1, pages.length),
              preview: backendNote.summary ?? firstPage?.content ?? '백엔드에 저장된 노트입니다.',
              file: firstPage?.image_url ? { uri: firstPage.image_url } : undefined,
            } satisfies StudyDocumentEntry;
          }),
        );

        if (!mounted) return;
        setUserStudyDocuments((current) => {
          const nextById = new Map<number, StudyDocumentEntry>();
          [...current, ...documents].forEach((document) => {
            nextById.set(document.id, document);
          });
          return Array.from(nextById.values()).sort((left, right) => right.id - left.id);
        });
      } catch {
        if (mounted) {
          setWorkspaceFeedback('백엔드 노트 목록을 불러오지 못했습니다.');
        }
      }
    };

    void loadBackendDocuments();

    return () => {
      mounted = false;
    };
  }, [availableSubjects, props.initialSubjectId, workspaceHydrated]);

  const openSubject = (id: number) => {
    props.onOpenNotesTab();
    setSubjectId(id);
    setNoteId(null);
    setStudyDocumentId(null);
    setNoteDetailTab('original');
  };

  const openNote = (id: number) => {
    const selected = visibleNotes.find((value) => value.id === id);
    if (!selected) return;

    props.onOpenNotesTab();
    setSubjectId(selected.subjectId);
    setNoteId(id);
    setNoteDetailTab('original');
  };

  const openStudyDocument = (id: number | null) => {
    if (id === null) {
      setStudyDocumentId(null);
      setInkTool('view');
      setAiPanelOpen(false);
      return;
    }

    const selected = allStudyDocuments.find((value) => value.id === id);
    if (!selected) return;

    props.onOpenNotesTab();
    setSubjectId(selected.subjectId);
    setNoteId(null);
    setStudyDocumentId(id);
    setInkTool('view');
    setActivePageByDocument((current) => ({
      ...current,
      [id]: current[id] ?? { kind: 'pdf', pageNumber: currentPdfPageByDocument[id] ?? 1 },
    }));
  };

  const openCreatedStudyDocument = (document: StudyDocumentEntry, feedback: string) => {
    setUserStudyDocuments((current) => [document, ...current]);
    props.onOpenNotesTab();
    setSubjectId(document.subjectId);
    setNoteId(null);
    setStudyDocumentId(document.id);
    setNoteWorkspaceMode('note');
    setInkTool('view');
    setAiPanelOpen(false);
    setWorkspaceFeedback(feedback);
    setCurrentPdfPageByDocument((current) => ({
      ...current,
      [document.id]: 1,
    }));
    setActivePageByDocument((current) => ({
      ...current,
      [document.id]: { kind: 'pdf', pageNumber: 1 },
    }));
  };

  const createBlankNote = async () => {
    const targetSubjectId = subjectId ?? availableSubjects[0]?.id ?? null;
    if (!targetSubjectId) return;

    const targetSubject = availableSubjects.find((value) => value.id === targetSubjectId);
    if (!targetSubject) return;

    if (isBackendApiEnabled()) {
      try {
        const folder = await ensureFolderForSubject({ name: targetSubject.name, color: targetSubject.color });
        const backendNote = await createBackendNote({
          folderId: folder.id,
          title: `${targetSubject.name} 새 노트`,
          summary: '빈 노트',
        });
        await createBackendNotePage({
          noteId: backendNote.id,
          pageNumber: 1,
          content: '',
        });
        const document: StudyDocumentEntry = {
          id: backendNote.id,
          subjectId: targetSubjectId,
          title: backendNote.title,
          type: 'blank',
          updatedAt: '방금 전',
          pageCount: 1,
          preview: backendNote.summary ?? '새 빈 노트입니다.',
        };
        openCreatedStudyDocument(document, '새 빈 노트를 백엔드에 저장했습니다.');
        return;
      } catch {
        setWorkspaceFeedback('백엔드 저장에 실패해 이 기기에만 빈 노트를 만들었습니다.');
      }
    }

    const document: StudyDocumentEntry = {
      id: Date.now(),
      subjectId: targetSubjectId,
      title: `${targetSubject?.name ?? '수업'} 새 노트`,
      type: 'blank',
      updatedAt: '방금 전',
      pageCount: 1,
      preview: '새로 만든 빈 필기 노트입니다.',
    };

    openCreatedStudyDocument(document, '새 빈 노트를 만들었습니다.');
  };

  const requestDeleteNote = (id: number) => {
    const target = visibleNotes.find((value) => value.id === id) ?? notes.find((value) => value.id === id);
    if (!target) return;

    confirmDestructiveAction({
      title: 'Photo 삭제',
      message: `"${target.title}" Photo를 삭제할까요? 삭제 후에는 현재 기기 목록에서 보이지 않습니다.`,
      confirmText: '삭제',
      onConfirm: () => {
        setDeletedNoteIds((current) => addUniqueId(current, id));
        if (noteId === id) {
          setNoteId(null);
          setNoteDetailTab('original');
        }
        setWorkspaceFeedback('Photo를 삭제했습니다.');
      },
    });
  };

  const requestDeleteStudyDocument = (id: number) => {
    const target = allStudyDocuments.find((value) => value.id === id);
    if (!target) return;

    confirmDestructiveAction({
      title: 'Note 삭제',
      message: `"${target.title}" Note 문서와 이 문서에 남긴 필기를 삭제할까요?`,
      confirmText: '삭제',
      onConfirm: () => {
        if (isBackendApiEnabled()) {
          void deleteBackendNote(id).catch(() => {
            setWorkspaceFeedback('백엔드 노트 삭제에 실패했습니다.');
          });
        }
        setDeletedStudyDocumentIds((current) => addUniqueId(current, id));

        if (studyDocumentId === id) {
          setStudyDocumentId(null);
          setInkTool('view');
          setAiPanelOpen(false);
          setIncomingAssetSuggestion(null);
          setAiAnswer(null);
          setAiError(null);
          setAiLoading(false);
        }
        setWorkspaceFeedback('Note 문서를 삭제했습니다.');
      },
    });
  };

  const restoreNote = (id: number) => {
    const target = deletedNotes.find((value) => value.id === id);
    if (!target) return;

    setDeletedNoteIds((current) => removeId(current, id));
    setNoteWorkspaceMode('photo');
    setSubjectId(target.subjectId);
    setWorkspaceFeedback('Photo를 복구했습니다.');
  };

  const restoreStudyDocument = (id: number) => {
    const target = deletedStudyDocuments.find((value) => value.id === id);
    if (!target) return;

    setDeletedStudyDocumentIds((current) => removeId(current, id));
    setNoteWorkspaceMode('note');
    setSubjectId(target.subjectId);
    setWorkspaceFeedback('Note 문서를 복구했습니다.');
  };

  const renameStudyDocument = (id: number, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      setWorkspaceFeedback('문서 제목을 입력해주세요.');
      return false;
    }

    const target = allStudyDocuments.find((value) => value.id === id) ?? deletedStudyDocuments.find((value) => value.id === id);
    if (!target) return false;

    setUserStudyDocuments((current) => upsertStudyDocument(current, {
      ...target,
      title: nextTitle,
      updatedAt: '방금 전',
    }));
    setWorkspaceFeedback('문서 제목을 수정했습니다.');
    return true;
  };

  const uploadPdfDocument = async () => {
    const targetSubjectId = subjectId ?? availableSubjects[0]?.id ?? null;
    if (!targetSubjectId) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets.length) {
        setWorkspaceFeedback('PDF 업로드를 취소했습니다.');
        return;
      }

      const picked = result.assets[0];
      const targetSubject = availableSubjects.find((value) => value.id === targetSubjectId);
      if (!targetSubject) return;

      if (isBackendApiEnabled()) {
        try {
          const folder = await ensureFolderForSubject({ name: targetSubject.name, color: targetSubject.color });
          const backendNote = await createBackendNote({
            folderId: folder.id,
            title: picked.name || `${targetSubject.name} PDF`,
            summary: '업로드한 PDF 문서',
          });
          await createBackendNotePage({
            noteId: backendNote.id,
            pageNumber: 1,
            content: picked.name || 'PDF 문서',
            imageUrl: picked.uri,
          });
          const document: StudyDocumentEntry = {
            id: backendNote.id,
            subjectId: targetSubjectId,
            title: backendNote.title,
            type: 'pdf',
            updatedAt: '방금 전',
            pageCount: 1,
            preview: backendNote.summary ?? '업로드한 PDF 문서입니다.',
            file: { uri: picked.uri },
          };
          openCreatedStudyDocument(document, 'PDF 파일을 백엔드에 저장했습니다.');
          return;
        } catch {
          setWorkspaceFeedback('백엔드 저장에 실패해 이 기기에만 PDF를 추가했습니다.');
        }
      }

      const document: StudyDocumentEntry = {
        id: Date.now(),
        subjectId: targetSubjectId,
        title: picked.name || `${targetSubject?.name ?? '수업'} PDF`,
        type: 'pdf',
        updatedAt: '방금 전',
        pageCount: 1,
        preview: '파일 선택기에서 업로드한 수업 PDF입니다.',
        file: { uri: picked.uri },
      };

      openCreatedStudyDocument(document, 'PDF 파일을 업로드했습니다.');
    } catch {
      setWorkspaceFeedback('PDF 파일을 가져오지 못했습니다.');
    }
  };

  const resetNotes = () => {
    setNoteId(null);
    setStudyDocumentId(null);
    setQuery('');
    setNoteDetailTab('original');
    setInkTool('view');
    setAiPanelOpen(false);
    if (!props.wide) setSubjectId(null);
  };

  const resetLocalWorkspaceData = async () => {
    const emptyState = buildEmptyStudyWorkspaceState();
    setUserStudyDocuments(emptyState.userStudyDocuments);
    setDeletedNoteIds(emptyState.deletedNoteIds);
    setDeletedStudyDocumentIds(emptyState.deletedStudyDocumentIds);
    setCaptureAssetsBySubject(emptyState.captureAssetsBySubject);
    setAttachmentsByDocument(emptyState.attachmentsByDocument);
    setGeneratedPagesByDocument(emptyState.generatedPagesByDocument);
    setInkByDocument(emptyState.inkByDocument);
    setRedoInkByDocument({});
    setTextAnnotationsByDocument(emptyState.textAnnotationsByDocument);
    setCurrentPdfPageByDocument(emptyState.currentPdfPageByDocument);
    setActivePageByDocument(emptyState.activePageByDocument);
    setBookmarksByDocument(emptyState.bookmarksByDocument);
    setIncomingAssetSuggestion(null);
    setIncomingBannerQueue([]);
    setStudyDocumentId(null);
    setAiAnswer(null);
    setAiError(null);
    setAiLoading(false);
    await clearStudyWorkspaceState();
    setWorkspaceFeedback('로컬 작업 데이터를 초기화했습니다.');
  };

  const changeNoteWorkspaceMode = (next: NoteWorkspaceMode) => {
    setNoteWorkspaceMode(next);
    setNoteId(null);
    setStudyDocumentId(null);
    setInkTool('view');
    setAiPanelOpen(false);
  };

  const resetToSubjectList = () => {
    setNoteId(null);
    setSubjectId(null);
    setQuery('');
    setNoteDetailTab('original');
  };

  const backToNoteList = () => {
    setNoteId(null);
    setStudyDocumentId(null);
    setAiPanelOpen(false);
    setInkTool('view');
    setIncomingAssetSuggestion(null);
  };

  const changeInkTool = (tool: InkTool) => {
    if (tool === 'select' && inkTool === 'select') {
      setInkTool('view');
      if (studyDocumentId) {
        setSelectionByDocument((current) => ({ ...current, [studyDocumentId]: null }));
      }
      return;
    }

    if (tool === 'highlight') {
      if (!HIGHLIGHT_BRUSH_COLORS.includes(penColor as (typeof HIGHLIGHT_BRUSH_COLORS)[number])) {
        setPenColor(DEFAULT_HIGHLIGHT_COLOR);
      }
      if (penWidth < 8) {
        setPenWidth(12);
      }
    }

    if (tool === 'pen') {
      if (!PEN_BRUSH_COLORS.includes(penColor as (typeof PEN_BRUSH_COLORS)[number])) {
        setPenColor(DEFAULT_PEN_COLOR);
      }
      if (penWidth > 6) {
        setPenWidth(4);
      }
    }

    setInkTool(tool);
    if (tool !== 'select' && tool !== 'text' && studyDocumentId) {
      setSelectionByDocument((current) => ({ ...current, [studyDocumentId]: null }));
    }
  };

  const changePenColor = (color: string) => {
    setPenColor(color);
    setInkTool((current) => (current !== 'pen' && current !== 'highlight' ? 'pen' : current));
  };

  const changePenWidth = (width: number) => {
    setPenWidth(width);
    setInkTool((current) => (current !== 'pen' && current !== 'highlight' ? 'pen' : current));
  };

  const changeSelection = (rect: SelectionRect | null) => {
    if (!studyDocumentId) return;
    setSelectionByDocument((current) => ({ ...current, [studyDocumentId]: rect }));
  };

  const isStrokeOnCurrentPage = (stroke: InkStroke) => (
    currentDocumentPage?.kind === 'generated'
      ? stroke.generatedPageId === currentDocumentPage.pageId
      : (
          !stroke.generatedPageId &&
          (studyDocument?.type === 'blank' ? (stroke.pageNumber ?? 1) === currentPdfPage : (!stroke.pageNumber || stroke.pageNumber === currentPdfPage))
        )
  );

  const findLastIndex = <T,>(items: T[], predicate: (item: T) => boolean) => {
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (predicate(items[index])) return index;
    }
    return -1;
  };

  const clearInk = () => {
    if (!studyDocumentId) return;
    setInkByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).filter((stroke) => !isStrokeOnCurrentPage(stroke)),
    }));
    setRedoInkByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).filter((stroke) => !isStrokeOnCurrentPage(stroke)),
    }));
  };

  const undoInk = () => {
    if (!studyDocumentId) return;
    setInkByDocument((current) => {
      const currentStrokes = current[studyDocumentId] ?? [];
      const lastStrokeIndex = findLastIndex(currentStrokes, isStrokeOnCurrentPage);
      if (lastStrokeIndex < 0) return current;

      const lastStroke = currentStrokes[lastStrokeIndex];
      
      setRedoInkByDocument((redoCurrent) => ({
        ...redoCurrent,
        [studyDocumentId]: [...(redoCurrent[studyDocumentId] ?? []), lastStroke],
      }));
      
      return {
        ...current,
        [studyDocumentId]: currentStrokes.filter((_, index) => index !== lastStrokeIndex),
      };
    });
  };

  const redoInk = () => {
    if (!studyDocumentId) return;
    setRedoInkByDocument((current) => {
      const currentRedoStrokes = current[studyDocumentId] ?? [];
      const lastRedoStrokeIndex = findLastIndex(currentRedoStrokes, isStrokeOnCurrentPage);
      if (lastRedoStrokeIndex < 0) return current;

      const lastRedoStroke = currentRedoStrokes[lastRedoStrokeIndex];

      setInkByDocument((inkCurrent) => ({
        ...inkCurrent,
        [studyDocumentId]: [...(inkCurrent[studyDocumentId] ?? []), lastRedoStroke],
      }));

      return {
        ...current,
        [studyDocumentId]: currentRedoStrokes.filter((_, index) => index !== lastRedoStrokeIndex),
      };
    });
  };

  const commitInkStroke = (stroke: InkStroke) => {
    if (!studyDocumentId) return;
    const scopedStroke =
      currentDocumentPage?.kind === 'generated'
        ? { ...stroke, generatedPageId: currentDocumentPage.pageId, pageNumber: undefined }
        : { ...stroke, generatedPageId: undefined, pageNumber: currentDocumentPage?.kind === 'pdf' ? currentDocumentPage.pageNumber : currentPdfPage };
    setInkByDocument((current) => ({
      ...current,
      [studyDocumentId]: [...(current[studyDocumentId] ?? []), scopedStroke],
    }));
    setRedoInkByDocument((current) => ({
      ...current,
      [studyDocumentId]: [],
    }));
  };

  const removeInkStroke = (strokeId: string) => {
    if (!studyDocumentId) return;
    setInkByDocument((current) => {
      const nextStrokes = (current[studyDocumentId] ?? []).filter((stroke) => stroke.id !== strokeId);
      return {
        ...current,
        [studyDocumentId]: nextStrokes,
      };
    });
  };

  const addTextAnnotation = (point: InkPoint) => {
    if (!studyDocumentId) return;
    const generatedPageId = currentDocumentPage?.kind === 'generated' ? currentDocumentPage.pageId : undefined;
    const pageNumber = generatedPageId ? 1 : currentDocumentPage?.kind === 'pdf' ? currentDocumentPage.pageNumber : currentPdfPage;
    const anchoredSelection = !generatedPageId && studyDocument?.type === 'pdf' ? selectionByDocument[studyDocumentId] ?? null : null;
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
    setTextAnnotationsByDocument((current) => ({
      ...current,
      [studyDocumentId]: [...(current[studyDocumentId] ?? []), nextAnnotation],
    }));
    if (anchoredSelection) {
      clearCurrentSelection();
    }
    setInkTool('view');
    setWorkspaceFeedback(anchoredSelection ? '선택 영역 메모를 추가했습니다.' : '텍스트 메모를 추가했습니다.');
  };

  const updateTextAnnotation = (annotationId: string, text: string) => {
    if (!studyDocumentId) return;
    setTextAnnotationsByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).map((annotation) =>
        annotation.id === annotationId ? { ...annotation, text } : annotation,
      ),
    }));
  };

  const removeTextAnnotation = (annotationId: string) => {
    if (!studyDocumentId) return;
    setTextAnnotationsByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).filter((annotation) => annotation.id !== annotationId),
    }));
  };
  const updateAssetStatus = (assetId: string, nextStatus: CaptureAsset['status']) => {
    setCaptureAssetsBySubject((current) => {
      const next = { ...current };

      Object.keys(next).forEach((key) => {
        const subjectAssets = next[Number(key)] ?? [];
        next[Number(key)] = subjectAssets.map((asset) => (asset.id === assetId ? { ...asset, status: nextStatus } : asset));
      });

      return next;
    });
  };

  const insertAssetIntoWorkspace = (asset: CaptureAsset) => {
    if (!studyDocumentId) return;

    const insertAfterPage = currentPdfPageByDocument[studyDocumentId] ?? 1;
    const generatedPageId = `generated-page-${asset.id}-${Date.now()}`;
    const generatedPage: GeneratedWorkspacePage = {
      id: generatedPageId,
      documentId: studyDocumentId,
      sourceAssetId: asset.id,
      pageKind: 'summary',
      title: asset.title,
      createdAt: new Date().toISOString(),
      insertAfterPage,
      status: 'generating',
      previewImageKey: asset.previewImageKey,
      previewImage: asset.previewImage,
      ...buildGeneratedSummary(asset, availableSubjects),
    };

    setAttachmentsByDocument((current) => ({
      ...current,
      [studyDocumentId]: [buildWorkspaceAttachment(asset, generatedPageId), ...(current[studyDocumentId] ?? [])],
    }));
    setGeneratedPagesByDocument((current) => ({
      ...current,
      [studyDocumentId]: [generatedPage, ...(current[studyDocumentId] ?? [])],
    }));
    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: { kind: 'generated', pageId: generatedPageId },
    }));
    updateAssetStatus(asset.id, 'accepted');
    setWorkspaceFeedback('다음 페이지 정리본을 생성하고 있습니다.');

    setTimeout(() => {
      setGeneratedPagesByDocument((current) => ({
        ...current,
        [studyDocumentId]: (current[studyDocumentId] ?? []).map((value) =>
          value.id === generatedPageId ? { ...value, status: 'ready' } : value,
        ),
      }));
      setWorkspaceFeedback('다음 페이지 정리본이 준비됐습니다.');
    }, 1600);
  };

  const requestAiAnswer = async () => {
    if (!studyDocumentId) return;

    setAiLoading(true);
    setAiError(null);

    try {
      if (isBackendApiEnabled()) {
        let sessionId = chatSessionByDocument[studyDocumentId];
        if (!sessionId) {
          const session = await createBackendChatSession({
            noteId: studyDocumentId,
            title: studyDocument?.title ? `${studyDocument.title} AI 채팅` : 'AI 채팅',
          });
          sessionId = session.id;
          setChatSessionByDocument((current) => ({
            ...current,
            [studyDocumentId]: session.id,
          }));
        }

        const response = await sendBackendAiMessage({
          sessionId,
          content: aiQuestion.trim() || '현재 페이지를 요약해줘',
        });
        const content = response.assistant_message.content;
        setAiAnswer({
          question: aiQuestion.trim() || '현재 페이지를 요약해줘',
          response: content,
          sections: [
            {
              title: 'AI 답변',
              body: content,
              tone: 'highlight',
            },
          ],
          createdAt: response.assistant_message.created_at,
        });
        return;
      }

      const answer = await requestMockAiAnswer({
        question: aiQuestion,
        selectionRect,
        currentPageLabel: currentAiPageLabel,
      });
      setAiAnswer(answer);
    } catch {
      setAiError('AI 응답을 만들지 못했습니다. 다시 시도해주세요.');
    } finally {
      setAiLoading(false);
    }
  };

  const insertAiAnswerPage = () => {
    if (!studyDocumentId || !aiAnswer) return;

    const insertAfterPage =
      currentDocumentPage?.kind === 'generated'
        ? ((generatedPagesByDocument[studyDocumentId] ?? []).find((value) => value.id === currentDocumentPage.pageId)?.insertAfterPage ?? currentPdfPage)
        : currentPdfPage;
    const generatedPageId = `ai-answer-page-${studyDocumentId}-${Date.now()}`;
    const generatedPage: GeneratedWorkspacePage = {
      id: generatedPageId,
      documentId: studyDocumentId,
      sourceAssetId: `ai-answer-${generatedPageId}`,
      pageKind: 'summary',
      title: 'AI 질문 정리',
      createdAt: aiAnswer.createdAt,
      insertAfterPage,
      status: 'ready',
      summaryTitle: aiAnswer.question,
      summaryIntro: '선택 영역 질문을 바탕으로 만든 로컬 mock AI 정리입니다.',
      summarySections: aiAnswer.sections,
    };

    setGeneratedPagesByDocument((current) => ({
      ...current,
      [studyDocumentId]: [generatedPage, ...(current[studyDocumentId] ?? [])],
    }));
    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: { kind: 'generated', pageId: generatedPageId },
    }));
    setWorkspaceFeedback('AI 답변을 정리 페이지로 추가했습니다.');
  };

  const createMemoPage = () => {
    if (!studyDocumentId || !studyDocument) return;

    if (studyDocument.type === 'blank') {
      const nextPage = studyDocument.pageCount + 1;
      const nextDocument = {
        ...studyDocument,
        pageCount: nextPage,
        updatedAt: '방금 전',
      };

      setUserStudyDocuments((current) => upsertStudyDocument(current, nextDocument));
      setCurrentPdfPageByDocument((current) => ({
        ...current,
        [studyDocumentId]: nextPage,
      }));
      setActivePageByDocument((current) => ({
        ...current,
        [studyDocumentId]: { kind: 'pdf', pageNumber: nextPage },
      }));
      setInkTool('pen');
      setWorkspaceFeedback(`${nextPage}페이지를 추가했습니다.`);
      return;
    }

    const insertAfterPage =
      currentDocumentPage?.kind === 'generated'
        ? ((generatedPagesByDocument[studyDocumentId] ?? []).find((value) => value.id === currentDocumentPage.pageId)?.insertAfterPage ?? currentPdfPage)
        : currentPdfPage;
    const generatedPageId = `memo-page-${studyDocumentId}-${Date.now()}`;
    const nextMemoCount =
      (generatedPagesByDocument[studyDocumentId] ?? []).filter((value) => value.pageKind === 'memo' && value.insertAfterPage === insertAfterPage).length + 1;

    const memoPage: GeneratedWorkspacePage = {
      id: generatedPageId,
      documentId: studyDocumentId,
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

    setGeneratedPagesByDocument((current) => ({
      ...current,
      [studyDocumentId]: [...(current[studyDocumentId] ?? []), memoPage],
    }));
    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: { kind: 'generated', pageId: generatedPageId },
    }));
    setInkTool('pen');
    setWorkspaceFeedback(`${insertAfterPage}페이지 뒤에 메모 페이지를 추가했습니다.`);
  };

  const acceptIncomingAsset = () => {
    if (!incomingAssetSuggestion || !studyDocumentId) return;
    insertAssetIntoWorkspace(incomingAssetSuggestion);
    setWorkspaceFeedback(`${incomingAssetSuggestion.type === 'image' ? '이미지' : 'PDF'}를 다음 PDF 페이지에 삽입했습니다.`);
    setIncomingAssetSuggestion(null);
  };

  const archiveIncomingAsset = () => {
    if (!incomingAssetSuggestion) return;
    updateAssetStatus(incomingAssetSuggestion.id, 'archived');
    setWorkspaceFeedback('자료를 보관함으로 넘겼습니다.');
    setIncomingAssetSuggestion(null);
  };

  const dismissIncomingAsset = () => {
    if (!incomingAssetSuggestion) return;
    updateAssetStatus(incomingAssetSuggestion.id, 'dismissed');
    setWorkspaceFeedback('이번 제안은 숨겼습니다.');
    setIncomingAssetSuggestion(null);
  };

  const insertInboxAsset = (assetId: string) => {
    const asset = captureInbox.find((value) => value.id === assetId);
    if (!asset || !studyDocumentId) return;
    insertAssetIntoWorkspace(asset);
    setWorkspaceFeedback(`${asset.type === 'image' ? '이미지' : 'PDF'}를 inbox에서 다음 PDF 페이지에 삽입했습니다.`);
  };

  const removeInboxAsset = (assetId: string) => {
    const asset = captureInbox.find((value) => value.id === assetId);
    if (!asset) return;
    updateAssetStatus(asset.id, 'dismissed');
    if (incomingAssetSuggestion?.id === asset.id) {
      setIncomingAssetSuggestion(null);
    }
    setWorkspaceFeedback('inbox에서 자료를 삭제했습니다.');
  };

  const removeWorkspaceAttachment = (attachmentId: string) => {
    if (!studyDocumentId) return;
    const target = (attachmentsByDocument[studyDocumentId] ?? []).find((attachment) => attachment.id === attachmentId);
    if (!target) return;
    const linkedGeneratedPage = target.generatedPageId
      ? (generatedPagesByDocument[studyDocumentId] ?? []).find((page) => page.id === target.generatedPageId) ?? null
      : null;

    setAttachmentsByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).filter((attachment) => attachment.id !== attachmentId),
    }));
    if (target.generatedPageId) {
      setGeneratedPagesByDocument((current) => ({
        ...current,
        [studyDocumentId]: (current[studyDocumentId] ?? []).filter((page) => page.id !== target.generatedPageId),
      }));
      setBookmarksByDocument((current) => ({
        ...current,
        [studyDocumentId]: (current[studyDocumentId] ?? []).filter((bookmark) => bookmark.page.kind !== 'generated' || bookmark.page.pageId !== target.generatedPageId),
      }));
    }
    if (linkedGeneratedPage && activePageByDocument[studyDocumentId]?.kind === 'generated' && activePageByDocument[studyDocumentId]?.pageId === linkedGeneratedPage.id) {
      setActivePageByDocument((current) => ({
        ...current,
        [studyDocumentId]: { kind: 'pdf', pageNumber: linkedGeneratedPage.insertAfterPage },
      }));
      setCurrentPdfPageByDocument((current) => ({
        ...current,
        [studyDocumentId]: linkedGeneratedPage.insertAfterPage,
      }));
    }
    updateAssetStatus(target.assetId, 'archived');
    setWorkspaceFeedback('추가한 정리 페이지를 삭제했습니다.');
  };

  const openGeneratedPage = (pageId: string) => {
    if (!studyDocumentId) return;
    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: { kind: 'generated', pageId },
    }));
  };

  const removeGeneratedPage = (pageId: string) => {
    if (!studyDocumentId) return;
    const target = (generatedPagesByDocument[studyDocumentId] ?? []).find((page) => page.id === pageId);
    if (!target || (target.pageKind !== 'memo' && !target.sourceAssetId.startsWith('ai-answer-'))) return;

    setGeneratedPagesByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).filter((page) => page.id !== pageId),
    }));
    setInkByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).filter((stroke) => stroke.generatedPageId !== pageId),
    }));
    setTextAnnotationsByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).filter((annotation) => annotation.generatedPageId !== pageId),
    }));
    setBookmarksByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).filter((bookmark) => bookmark.page.kind !== 'generated' || bookmark.page.pageId !== pageId),
    }));
    if (activePageByDocument[studyDocumentId]?.kind === 'generated' && activePageByDocument[studyDocumentId]?.pageId === pageId) {
      setActivePageByDocument((current) => ({
        ...current,
        [studyDocumentId]: { kind: 'pdf', pageNumber: target.insertAfterPage },
      }));
      setCurrentPdfPageByDocument((current) => ({
        ...current,
        [studyDocumentId]: target.insertAfterPage,
      }));
    }
    setWorkspaceFeedback('메모 페이지를 삭제했습니다.');
  };

  const updateStudyDocumentPageCount = (pageCount: number) => {
    if (!studyDocumentId || !studyDocument || !Number.isFinite(pageCount) || pageCount < 1) return;
    setUserStudyDocuments((current) => upsertStudyDocument(current, {
      ...studyDocument,
      pageCount,
    }));
  };

  const clearCurrentSelection = () => {
    if (!studyDocumentId) return;
    setSelectionByDocument((current) => ({ ...current, [studyDocumentId]: null }));
  };

  const deleteSelectedStrokes = () => {
    if (!studyDocumentId || !selectionRect) return;
    const currentStrokes = inkByDocument[studyDocumentId] ?? [];

    const pageStrokes = currentStrokes.filter((stroke) => (
      currentDocumentPage?.kind === 'generated'
        ? stroke.generatedPageId === currentDocumentPage.pageId
        : (
            !stroke.generatedPageId &&
            (studyDocument?.type === 'blank' ? (stroke.pageNumber ?? 1) === currentPdfPage : (!stroke.pageNumber || stroke.pageNumber === currentPdfPage))
          )
    ));
    const hitTestStrokes =
      selectionRect.pageWidth && selectionRect.pageHeight
        ? pageStrokes.map((stroke) => scaleInkStrokeToPageSize(stroke, selectionRect.pageWidth!, selectionRect.pageHeight!))
        : pageStrokes;
    const selectedStrokeIds = new Set(findInkStrokesInRect(hitTestStrokes, selectionRect));

    if (selectedStrokeIds.size > 0) {
      setInkByDocument((current) => ({
        ...current,
        [studyDocumentId]: (current[studyDocumentId] ?? []).filter((stroke) => !selectedStrokeIds.has(stroke.id)),
      }));
      setWorkspaceFeedback(`선택된 ${selectedStrokeIds.size}개의 필기를 지웠습니다.`);
    }
    clearCurrentSelection();
    setInkTool('view');
  };

  const changeSelectedStrokesColor = (color: string) => {
    if (!studyDocumentId || !selectionRect) return;
    const currentStrokes = inkByDocument[studyDocumentId] ?? [];

    const pageStrokes = currentStrokes.filter((stroke) => (
      currentDocumentPage?.kind === 'generated'
        ? stroke.generatedPageId === currentDocumentPage.pageId
        : (
            !stroke.generatedPageId &&
            (studyDocument?.type === 'blank' ? (stroke.pageNumber ?? 1) === currentPdfPage : (!stroke.pageNumber || stroke.pageNumber === currentPdfPage))
          )
    ));
    const hitTestStrokes =
      selectionRect.pageWidth && selectionRect.pageHeight
        ? pageStrokes.map((stroke) => scaleInkStrokeToPageSize(stroke, selectionRect.pageWidth!, selectionRect.pageHeight!))
        : pageStrokes;
    const selectedStrokeIds = new Set(findInkStrokesInRect(hitTestStrokes, selectionRect));

    const nextStrokes = currentStrokes.map((stroke) => {
      if (selectedStrokeIds.has(stroke.id)) {
        const isHighlight = stroke.style === 'highlight';
        const finalColor = isHighlight ? (color.startsWith('#') ? color + '55' : color) : color;
        return { ...stroke, color: finalColor };
      }
      return stroke;
    });

    if (selectedStrokeIds.size > 0) {
      setInkByDocument((current) => ({
        ...current,
        [studyDocumentId]: nextStrokes,
      }));
      setWorkspaceFeedback(`선택된 ${selectedStrokeIds.size}개의 필기 색상을 변경했습니다.`);
    }
    clearCurrentSelection();
    setInkTool('view');
  };

  const setCurrentPdfPage = (pageNumber: number) => {
    if (!studyDocumentId || !studyDocument) return;

    const nextPage = Math.max(1, Math.min(pageNumber, studyDocument.pageCount));
    clearCurrentSelection();
    setCurrentPdfPageByDocument((current) => ({
      ...current,
      [studyDocumentId]: nextPage,
    }));
    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: { kind: 'pdf', pageNumber: nextPage },
    }));
  };

  const moveDocumentPage = (delta: -1 | 1) => {
    if (!studyDocumentId || currentDocumentPages.length === 0) return;
    const currentIndex = currentDocumentPageIndex >= 0 ? currentDocumentPageIndex : 0;
    const nextPage = currentDocumentPages[currentIndex + delta];
    if (!nextPage) return;

    clearCurrentSelection();
    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: nextPage,
    }));
    if (nextPage.kind === 'pdf') {
      setCurrentPdfPageByDocument((current) => ({
        ...current,
        [studyDocumentId]: nextPage.pageNumber,
      }));
    }
  };

  const openWorkspaceAttachment = (attachmentId: string) => {
    if (!studyDocumentId) return;
    const target = (attachmentsByDocument[studyDocumentId] ?? []).find((attachment) => attachment.id === attachmentId);
    if (!target?.generatedPageId) return;
    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: { kind: 'generated', pageId: target.generatedPageId! },
    }));
  };

  const getCurrentPageBookmarkLabel = () => {
    if (!currentDocumentPage) return '현재 페이지';
    return getDocumentPageLabel({
      page: currentDocumentPage,
      pages: currentDocumentPages,
      memoPages,
      pdfSuffix: '페이지',
    });
  };

  const toggleBookmarkCurrentPage = () => {
    if (!studyDocumentId || !currentDocumentPage) return;
    const label = getCurrentPageBookmarkLabel();

    setBookmarksByDocument((current) => {
      const bookmarks = current[studyDocumentId] ?? [];
      const alreadyBookmarked = bookmarks.some((bookmark) => isSameDocumentPage(bookmark.page, currentDocumentPage));
      const nextBookmarks = alreadyBookmarked
        ? bookmarks.filter((bookmark) => !isSameDocumentPage(bookmark.page, currentDocumentPage))
        : [
            {
              id: `bookmark-${studyDocumentId}-${Date.now()}`,
              documentId: studyDocumentId,
              page: currentDocumentPage,
              label,
              createdAt: new Date().toISOString(),
            },
            ...bookmarks,
          ];

      return {
        ...current,
        [studyDocumentId]: nextBookmarks,
      };
    });

    setWorkspaceFeedback(currentPageBookmarked ? '중요 페이지에서 해제했습니다.' : '중요 페이지로 저장했습니다.');
  };

  const openBookmarkedPage = (bookmarkId: string) => {
    if (!studyDocumentId) return;
    const bookmark = (bookmarksByDocument[studyDocumentId] ?? []).find((value) => value.id === bookmarkId);
    if (!bookmark) return;
    const targetPage = bookmark.page;

    clearCurrentSelection();
    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: targetPage,
    }));
    if (targetPage.kind === 'pdf') {
      setCurrentPdfPageByDocument((current) => ({
        ...current,
        [studyDocumentId]: targetPage.pageNumber,
      }));
    }
  };

  const removeBookmark = (bookmarkId: string) => {
    if (!studyDocumentId) return;
    setBookmarksByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).filter((bookmark) => bookmark.id !== bookmarkId),
    }));
    setWorkspaceFeedback('중요 페이지를 삭제했습니다.');
  };

  const exportCurrentDocumentSummary = async () => {
    if (!studyDocumentId || !studyDocument) return;

    const bookmarkLines = currentDocumentBookmarks.length
      ? currentDocumentBookmarks.map((bookmark) => `- ${bookmark.label}`).join('\n')
      : '- 저장된 중요 페이지 없음';
    const generatedPageLines = generatedWorkspacePages.length
      ? generatedWorkspacePages.map((page) => `- ${page.title} (${page.insertAfterPage}페이지 뒤)`).join('\n')
      : '- 추가 정리/메모 페이지 없음';
    const annotationCount = (inkByDocument[studyDocumentId] ?? []).length + (textAnnotationsByDocument[studyDocumentId] ?? []).length;

    try {
      await Share.share({
        title: `${studyDocument.title} 내보내기`,
        message: [
          `B-SNAP 문서 내보내기`,
          `문서: ${studyDocument.title}`,
          `현재 위치: ${getCurrentPageBookmarkLabel()}`,
          `전체 페이지: ${currentDocumentPages.length || studyDocument.pageCount}`,
          `필기/메모 수: ${annotationCount}`,
          '',
          '중요 페이지',
          bookmarkLines,
          '',
          '추가 페이지',
          generatedPageLines,
        ].join('\n'),
      });
      setWorkspaceFeedback('문서 요약을 공유 시트로 내보냈습니다.');
    } catch {
      setWorkspaceFeedback('이 기기에서는 내보내기를 열지 못했습니다.');
    }
  };

  const dismissIncomingBanner = () => {
    setIncomingBannerQueue((current) => current.slice(1));
  };

  const openIncomingBanner = () => {
    const asset = incomingBannerQueue[0];
    if (!asset) return;

    props.onOpenNotesTab();
    setSubjectId(asset.subjectId);
    setNoteId(null);
    setStudyDocumentId(null);
    setWorkspaceFeedback(`${asset.type === 'image' ? '이미지' : 'PDF'}를 inbox에서 확인할 수 있습니다.`);
    setIncomingBannerQueue((current) => current.slice(1));
  };

  return {
    subjectId,
    subject,
    note,
    noteDetailTab,
    noteWorkspaceMode,
    studyDocument,
    inkTool,
    penColor,
    penWidth,
    inkStrokes,
    textAnnotations,
    aiPanelOpen,
    selectionRect,
    aiQuestion,
    aiAnswer,
    aiLoading,
    aiError,
    query,
    sort,
    incomingAssetSuggestion,
    inboxHint,
    inboxPendingCount,
    workspaceFeedback,
    workspaceHydrated,
    localPersistenceError,
    activeIncomingBanner,
    captureInbox,
    workspaceAttachments,
    generatedWorkspacePages,
    memoPages,
    currentDocumentBookmarks,
    currentPageBookmarked,
    activeGeneratedPage,
    currentPdfPage,
    currentDocumentPages,
    currentDocumentPage,
    currentDocumentPageIndex,
    totalDocumentPageCount,
    filteredNotes,
    allNotes: visibleNotes,
    deletedNotes,
    allStudyDocuments,
    deletedStudyDocuments,
    filteredStudyDocuments,
    openSubject,
    openNote,
    openStudyDocument,
    createBlankNote,
    requestDeleteNote,
    requestDeleteStudyDocument,
    restoreNote,
    restoreStudyDocument,
    renameStudyDocument,
    uploadPdfDocument,
    resetNotes,
    resetLocalWorkspaceData,
    setNoteDetailTab,
    changeNoteWorkspaceMode,
    changeInkTool,
    changePenColor,
    changePenWidth,
    toggleAiPanel: () => setAiPanelOpen((current) => !current),
    setAiQuestion,
    requestAiAnswer,
    insertAiAnswerPage,
    changeSelection,
    undoInk,
    redoInk,
    clearInk,
    commitInkStroke,
    resetToSubjectList,
    backToNoteList,
    addTextAnnotation,
    updateTextAnnotation,
    removeTextAnnotation,
    removeInkStroke,
    deleteSelectedStrokes,
    changeSelectedStrokesColor,
    acceptIncomingAsset,
    archiveIncomingAsset,
    dismissIncomingAsset,
    dismissIncomingBanner,
    insertInboxAsset,
    removeInboxAsset,
    openIncomingBanner,
    removeWorkspaceAttachment,
    createMemoPage,
    openWorkspaceAttachment,
    toggleBookmarkCurrentPage,
    openBookmarkedPage,
    removeBookmark,
    exportCurrentDocumentSummary,
    openGeneratedPage,
    removeGeneratedPage,
    updateStudyDocumentPageCount,
    setCurrentPdfPage,
    goToPreviousDocumentPage: () => moveDocumentPage(-1),
    goToNextDocumentPage: () => moveDocumentPage(1),
    setQuery,
    toggleSort: () => setSort((current) => (current === 'latest' ? 'oldest' : 'latest')),
  };
}
