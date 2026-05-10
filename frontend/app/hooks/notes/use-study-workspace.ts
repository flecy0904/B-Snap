import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { notes } from '../../data';
import type { MockAiAnswer } from '../../services/mock-ai-service';
import {
  createBackendNote,
  createBackendNotePage,
  deleteBackendNote,
  ensureFolderForSubject,
  isBackendApiEnabled,
  listAllBackendChatSessions,
  listBackendChatMessages,
  listBackendChatSessions,
  listBackendFolders,
  listBackendNotePages,
  listBackendNotes,
  updateBackendNote,
  updateBackendNotePage,
  type BackendChatSession,
  type BackendChatMessage,
} from '../../services/backend-api';
import {
  buildEmptyStudyWorkspaceState,
  clearStudyWorkspaceState,
  type PersistedStudyWorkspaceState,
} from '../../storage/local-workspace-store';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_PEN_COLOR,
  HIGHLIGHT_BRUSH_COLORS,
  PEN_BRUSH_COLORS,
  buildGeneratedSummary,
  buildWorkspaceAttachment,
} from './workspace/helpers';
import { getAiBackendErrorMessage } from './ai/ai-errors';
import { useAiChatActions } from './ai/use-ai-chat-actions';
import { useAiChatDerivedState } from './ai/use-ai-chat-derived-state';
import { addUniqueId, removeId, upsertStudyDocument } from './document/collection-helpers';
import { useDocumentPageActions } from './document/use-document-page-actions';
import { confirmDeleteAction } from './ui/confirm-delete-action';
import { useInkActions } from './ink/use-ink-actions';
import { parseNotePageContent, serializeNotePageContent } from './document/note-page-content';
import { useIncomingAssetSubscription } from './workspace/use-incoming-asset-subscription';
import { useStudyWorkspaceDerivedState } from './workspace/use-study-workspace-derived-state';
import { useStudyWorkspacePersistence } from './workspace/use-study-workspace-persistence';
import type { InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../ui-types';
import type { BookmarkedPage, CaptureAsset, DocumentPageView, GeneratedWorkspacePage, NoteWorkspaceMode, StudyDocumentEntry, Subject, WorkspaceAttachment } from '../../types';

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
  const [selectionPreviewByDocument, setSelectionPreviewByDocument] = useState<Record<number, string | null>>({});
  const [chatSessionByDocument, setChatSessionByDocument] = useState<Record<number, number>>({});
  const [lastChatSessionByDocument, setLastChatSessionByDocument] = useState<Record<number, number>>({});
  const [chatSessionsByDocument, setChatSessionsByDocument] = useState<Record<number, BackendChatSession[]>>({});
  const [allChatSessions, setAllChatSessions] = useState<BackendChatSession[]>([]);
  const [aiChatScope, setAiChatScope] = useState<'note' | 'all'>('note');
  const [aiChatSearchQuery, setAiChatSearchQuery] = useState('');
  const [aiMessagesBySession, setAiMessagesBySession] = useState<Record<number, BackendChatMessage[]>>({});
  const [backendPageIdsByDocument, setBackendPageIdsByDocument] = useState<Record<number, Record<number, number>>>({});

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
    setLastChatSessionByDocument(snapshot.lastChatSessionByDocument ?? {});
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
    lastChatSessionByDocument,
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
    lastChatSessionByDocument,
    textAnnotationsByDocument,
    userStudyDocuments,
  ]);
  const { workspaceHydrated, localPersistenceError } = useStudyWorkspacePersistence({
    state: persistedWorkspaceState,
    onHydrate: hydrateWorkspaceState,
  });
  const {
    activeAiChatSessionId,
    aiMessages,
    selectionPreviewUri,
    noteAiChatSessions: aiChatSessions,
    visibleAiChatSessions,
    currentDocumentHasBackendPages,
  } = useAiChatDerivedState({
    studyDocumentId,
    chatSessionByDocument,
    aiMessagesBySession,
    selectionPreviewByDocument,
    chatSessionsByDocument,
    allChatSessions,
    aiChatScope,
    aiChatSearchQuery,
    backendPageIdsByDocument,
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
        const pageIdsByDocument: Record<number, Record<number, number>> = {};
        const inkByBackendDocument: Record<number, InkStroke[]> = {};
        const textAnnotationsByBackendDocument: Record<number, InkTextAnnotation[]> = {};
        const hasStoredPageContentByDocument: Record<number, boolean> = {};
        const documents = await Promise.all(
          backendNotes.map(async (backendNote) => {
            const folder = folders.find((item) => item.id === backendNote.folder_id);
            const subject = availableSubjects.find((item) => item.name === folder?.name) ?? availableSubjects[0] ?? null;
            const pages = await listBackendNotePages(backendNote.id);
            const firstPage = pages[0] ?? null;
            pageIdsByDocument[backendNote.id] = {};
            inkByBackendDocument[backendNote.id] = [];
            textAnnotationsByBackendDocument[backendNote.id] = [];
            hasStoredPageContentByDocument[backendNote.id] = false;

            pages.forEach((page) => {
              pageIdsByDocument[backendNote.id][page.page_number] = page.id;
              const storedPage = parseNotePageContent(page.content);
              if (!storedPage) return;
              hasStoredPageContentByDocument[backendNote.id] = true;

              inkByBackendDocument[backendNote.id].push(
                ...storedPage.inkStrokes.map((stroke) => ({
                  ...stroke,
                  generatedPageId: undefined,
                  pageNumber: page.page_number,
                })),
              );
              textAnnotationsByBackendDocument[backendNote.id].push(
                ...storedPage.textAnnotations.map((annotation) => ({
                  ...annotation,
                  generatedPageId: undefined,
                  pageNumber: page.page_number,
                })),
              );
            });

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
        setBackendPageIdsByDocument((current) => ({
          ...current,
          ...pageIdsByDocument,
        }));
        setInkByDocument((current) => {
          const next = { ...current };
          Object.entries(inkByBackendDocument).forEach(([documentId, strokes]) => {
            if (hasStoredPageContentByDocument[Number(documentId)]) next[Number(documentId)] = strokes;
          });
          return next;
        });
        setTextAnnotationsByDocument((current) => {
          const next = { ...current };
          Object.entries(textAnnotationsByBackendDocument).forEach(([documentId, annotations]) => {
            if (hasStoredPageContentByDocument[Number(documentId)]) next[Number(documentId)] = annotations;
          });
          return next;
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

  useEffect(() => {
    if (!workspaceHydrated || !isBackendApiEnabled()) return;

    const timer = setTimeout(() => {
      Object.entries(backendPageIdsByDocument).forEach(([documentIdText, pagesByNumber]) => {
        const documentId = Number(documentIdText);
        const documentInk = inkByDocument[documentId] ?? [];
        const documentTextAnnotations = textAnnotationsByDocument[documentId] ?? [];

        Object.entries(pagesByNumber).forEach(([pageNumberText, pageId]) => {
          const pageNumber = Number(pageNumberText);
          const pageInkStrokes = documentInk.filter((stroke) => !stroke.generatedPageId && (stroke.pageNumber ?? 1) === pageNumber);
          const pageTextAnnotations = documentTextAnnotations.filter((annotation) => !annotation.generatedPageId && annotation.pageNumber === pageNumber);

          void updateBackendNotePage({
            pageId,
            content: serializeNotePageContent({
              inkStrokes: pageInkStrokes,
              textAnnotations: pageTextAnnotations,
            }),
          }).catch(() => {
            setWorkspaceFeedback('필기 저장에 실패했습니다. backend 연결을 확인해주세요.');
          });
        });
      });
    }, 700);

    return () => clearTimeout(timer);
  }, [backendPageIdsByDocument, inkByDocument, textAnnotationsByDocument, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated || !isBackendApiEnabled() || !studyDocumentId || !currentDocumentHasBackendPages) {
      return;
    }

    let mounted = true;

    const loadAiMessages = async () => {
      try {
        const [sessions, allSessions] = await Promise.all([
          listBackendChatSessions(studyDocumentId),
          listAllBackendChatSessions(),
        ]);
        const preferredSessionId = chatSessionByDocument[studyDocumentId] ?? lastChatSessionByDocument[studyDocumentId];
        const session = sessions.find((item) => item.id === preferredSessionId) ?? sessions[0] ?? null;

        if (!session) {
          if (!mounted) return;
          setAllChatSessions(allSessions);
          setChatSessionsByDocument((current) => ({ ...current, [studyDocumentId]: [] }));
          setChatSessionByDocument((current) => {
            const next = { ...current };
            delete next[studyDocumentId];
            return next;
          });
          return;
        }

        const messages = await listBackendChatMessages(session.id);
        if (!mounted) return;

        setAllChatSessions(allSessions);
        setChatSessionsByDocument((current) => ({ ...current, [studyDocumentId]: sessions }));
        setChatSessionByDocument((current) => ({ ...current, [studyDocumentId]: session.id }));
        setLastChatSessionByDocument((current) => ({ ...current, [studyDocumentId]: session.id }));
        setAiMessagesBySession((current) => ({ ...current, [session.id]: messages }));

        const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
        const lastUser = [...messages].reverse().find((message) => message.role === 'user');
        if (lastAssistant) {
          setAiAnswer({
            question: lastUser?.content ?? '이전 질문',
            response: lastAssistant.content,
            sections: [{
              title: 'AI 답변',
              body: lastAssistant.content,
            }],
            createdAt: lastAssistant.created_at,
          });
        }
      } catch (error) {
        if (mounted) {
          setAiError(getAiBackendErrorMessage(error, 'AI 채팅 내역을 불러오지 못했습니다.'));
        }
      }
    };

    void loadAiMessages();

    return () => {
      mounted = false;
    };
  }, [currentDocumentHasBackendPages, studyDocumentId, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated || !aiPanelOpen || !isBackendApiEnabled()) return;

    let mounted = true;

    listAllBackendChatSessions()
      .then((sessions) => {
        if (mounted) setAllChatSessions(sessions);
      })
      .catch((error) => {
        if (mounted) setAiError(getAiBackendErrorMessage(error, 'AI 채팅 내역을 불러오지 못했습니다.'));
      });

    return () => {
      mounted = false;
    };
  }, [aiPanelOpen, workspaceHydrated]);

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
    setChatSessionByDocument((current) => {
      const lastSessionId = lastChatSessionByDocument[id];
      if (!lastSessionId) return current;
      return { ...current, [id]: lastSessionId };
    });
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
        const backendPage = await createBackendNotePage({
          noteId: backendNote.id,
          pageNumber: 1,
          content: serializeNotePageContent({ inkStrokes: [], textAnnotations: [] }),
        });
        setBackendPageIdsByDocument((current) => ({
          ...current,
          [backendNote.id]: {
            ...(current[backendNote.id] ?? {}),
            1: backendPage.id,
          },
        }));
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

    confirmDeleteAction({
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

    confirmDeleteAction({
      title: 'Note 삭제',
      message: `"${target.title}" Note 문서와 이 문서에 남긴 필기를 삭제할까요?`,
      confirmText: '삭제',
      onConfirm: () => {
    if (isBackendApiEnabled() && backendPageIdsByDocument[id]) {
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
    if (isBackendApiEnabled() && backendPageIdsByDocument[id]) {
      void updateBackendNote({ noteId: id, title: nextTitle }).catch(() => {
        setWorkspaceFeedback('노트 제목 저장에 실패했습니다. backend 연결을 확인해주세요.');
      });
    }
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
      const pdfFileUri = Platform.OS === 'web' && picked.base64 ? picked.base64 : picked.uri;

      if (isBackendApiEnabled()) {
        try {
          const folder = await ensureFolderForSubject({ name: targetSubject.name, color: targetSubject.color });
          const backendNote = await createBackendNote({
            folderId: folder.id,
            title: picked.name || `${targetSubject.name} PDF`,
            summary: '업로드한 PDF 문서',
          });
          const backendPage = await createBackendNotePage({
            noteId: backendNote.id,
            pageNumber: 1,
            content: serializeNotePageContent({ inkStrokes: [], textAnnotations: [] }),
            imageUrl: pdfFileUri,
          });
          setBackendPageIdsByDocument((current) => ({
            ...current,
            [backendNote.id]: {
              ...(current[backendNote.id] ?? {}),
              1: backendPage.id,
            },
          }));
          const document: StudyDocumentEntry = {
            id: backendNote.id,
            subjectId: targetSubjectId,
            title: backendNote.title,
            type: 'pdf',
            updatedAt: '방금 전',
            pageCount: 1,
            preview: backendNote.summary ?? '업로드한 PDF 문서입니다.',
            file: { uri: pdfFileUri },
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
        file: { uri: pdfFileUri },
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
    if (!rect) {
      setSelectionPreviewByDocument((current) => ({ ...current, [studyDocumentId]: null }));
    }
  };

  const changeSelectionPreview = (uri: string | null) => {
    if (!studyDocumentId) return;
    setSelectionPreviewByDocument((current) => ({ ...current, [studyDocumentId]: uri }));
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

  const {
    selectAiChatSession,
    renameAiChatSession,
    removeAiChatSession,
    createAiChatSession,
    startNewAiChatSession,
    requestAiAnswer,
  } = useAiChatActions({
    studyDocumentId,
    studyDocument,
    selectionRect,
    selectionPreviewUri,
    currentAiPageLabel,
    currentAiPageNumber: currentDocumentPage?.kind === 'pdf' ? currentDocumentPage.pageNumber : currentPdfPage,
    currentDocumentHasBackendPages,
    activeAiChatSessionId,
    aiQuestion,
    chatSessionByDocument,
    chatSessionsByDocument,
    allChatSessions,
    setAiAnswer,
    setAiQuestion,
    setAiError,
    setAiLoading,
    setChatSessionByDocument,
    setLastChatSessionByDocument,
    setChatSessionsByDocument,
    setAllChatSessions,
    setAiMessagesBySession,
  });

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

  const {
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
  } = useInkActions({
    studyDocumentId,
    studyDocument,
    currentDocumentPage,
    currentPdfPage,
    selectionRect,
    selectionByDocument,
    inkByDocument,
    setInkByDocument,
    setRedoInkByDocument,
    setTextAnnotationsByDocument,
    setSelectionByDocument,
    setInkTool,
    setWorkspaceFeedback,
  });

  const openWorkspaceAttachment = (attachmentId: string) => {
    if (!studyDocumentId) return;
    const target = (attachmentsByDocument[studyDocumentId] ?? []).find((attachment) => attachment.id === attachmentId);
    if (!target?.generatedPageId) return;
    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: { kind: 'generated', pageId: target.generatedPageId! },
    }));
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

  const {
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
  } = useDocumentPageActions({
    studyDocumentId,
    studyDocument,
    aiAnswer,
    currentPdfPage,
    currentDocumentPage,
    currentDocumentPages,
    currentDocumentPageIndex,
    currentPageBookmarked,
    currentDocumentBookmarks,
    generatedWorkspacePages,
    memoPages,
    generatedPagesByDocument,
    activePageByDocument,
    currentPdfPageByDocument,
    bookmarksByDocument,
    backendPageIdsByDocument,
    currentDocumentHasBackendPages,
    inkByDocument,
    textAnnotationsByDocument,
    setGeneratedPagesByDocument,
    setActivePageByDocument,
    setWorkspaceFeedback,
    setUserStudyDocuments,
    setCurrentPdfPageByDocument,
    setBackendPageIdsByDocument,
    setInkTool,
    setInkByDocument,
    setTextAnnotationsByDocument,
    setBookmarksByDocument,
    clearCurrentSelection,
  });

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
    selectionPreviewUri,
    aiQuestion,
    aiAnswer,
    aiMessages,
    aiChatSessions: visibleAiChatSessions,
    noteAiChatSessions: aiChatSessions,
    allAiChatSessions: allChatSessions,
    aiChatScope,
    aiChatSearchQuery,
    activeAiChatSessionId,
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
    setAiChatScope,
    setAiChatSearchQuery,
    selectAiChatSession,
    renameAiChatSession,
    removeAiChatSession,
    startNewAiChatSession,
    createAiChatSession,
    requestAiAnswer,
    insertAiAnswerPage,
    changeSelection,
    changeSelectionPreview,
    clearCurrentSelection,
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
