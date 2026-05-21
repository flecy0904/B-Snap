import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getBackendClassInsight,
  isBackendApiEnabled,
  listAllBackendChatSessions,
  listBackendChatMessages,
  listBackendChatSessions,
  listBackendFolders,
  listBackendNotes,
  type BackendClassInsight,
  type BackendChatSession,
  type BackendChatMessage,
} from '../../services/backend-api';
import {
  type PersistedStudyWorkspaceState,
} from '../../storage/local-workspace-store';
import {
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_PEN_COLOR,
  HIGHLIGHT_BRUSH_COLORS,
  PEN_BRUSH_COLORS,
} from './workspace/helpers';
import { getAiBackendErrorMessage } from './ai/ai-errors';
import { useAiChatActions } from './ai/use-ai-chat-actions';
import { useAiChatDerivedState } from './ai/use-ai-chat-derived-state';
import { useAiCanvasNotes } from './ai-canvas/use-ai-canvas-notes';
import { buildClassInsightContext } from './class-insight';
import { getStudyDocumentBackendNoteId } from './document/backend-sync';
import { useStudyDocumentActions } from './document/use-study-document-actions';
import { useDocumentPageActions } from './document/use-document-page-actions';
import { normalizeDocumentFile } from './document/document-file-utils';
import { useBackendNotePageSync } from './document/use-backend-note-page-sync';
import { useInkActions, type WorkspaceEditSnapshot } from './ink/use-ink-actions';
import { useCaptureAssetActions } from './capture/use-capture-asset-actions';
import { usePageCaptureReferenceActions } from './capture/use-page-capture-references';
import { useIncomingAssetSubscription } from './workspace/use-incoming-asset-subscription';
import { useStudyWorkspaceDerivedState } from './workspace/use-study-workspace-derived-state';
import { useStudyWorkspacePersistence } from './workspace/use-study-workspace-persistence';
import { usePencilInteractionFeedback } from './workspace/use-pencil-interaction-feedback';
import { useWorkspaceFeedback, useWorkspaceSaveStatus } from './workspace/use-workspace-feedback';
import { useWorkspaceDocumentIntents } from './workspace/use-workspace-document-intents';
import { isSameDocumentPage, isShapeTool } from '../../ui-helpers';
import type { InkBrush, InkBrushSettings, InkEraserMode, InkLinePattern, InkSelectionMode, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../ui-types';
import type { AiAnswer, BookmarkedPage, CaptureAsset, DocumentPageView, GeneratedWorkspacePage, NoteWorkspaceMode, PageCaptureReference, StudyDocumentEntry, Subject, WorkspaceAttachment } from '../../types';

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
  const [noteWorkspaceMode, setNoteWorkspaceMode] = useState<NoteWorkspaceMode>('note');
  const [studyDocumentId, setStudyDocumentId] = useState<number | null>(null);
  const [inkTool, setInkTool] = useState<InkTool>('pen');
  const [fingerDrawingEnabled, setFingerDrawingEnabled] = useState(false);
  const [penColor, setPenColor] = useState<string>(DEFAULT_PEN_COLOR);
  const [penWidth, setPenWidth] = useState(3);
  const [brushType, setBrushType] = useState<InkBrush>('ballpoint');
  const [linePattern, setLinePattern] = useState<InkLinePattern>('solid');
  const [eraserMode, setEraserMode] = useState<InkEraserMode>('partial');
  const [selectionMode, setSelectionMode] = useState<InkSelectionMode>('rect');
  const [brushSettings, setBrushSettings] = useState<InkBrushSettings>({
    stability: 18,
    sharpness: 50,
    density: 100,
    pressure: 35,
  });
  const [inkByDocument, setInkByDocument] = useState<Record<number, InkStroke[]>>({});
  const [redoInkByDocument, setRedoInkByDocument] = useState<Record<number, InkStroke[]>>({});
  const [inkHistoryByDocument, setInkHistoryByDocument] = useState<Record<number, WorkspaceEditSnapshot[]>>({});
  const [redoInkHistoryByDocument, setRedoInkHistoryByDocument] = useState<Record<number, WorkspaceEditSnapshot[]>>({});
  const [textAnnotationsByDocument, setTextAnnotationsByDocument] = useState<Record<number, InkTextAnnotation[]>>({});
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelMode, setAiPanelMode] = useState<'floating' | 'sidebar'>('floating');
  const [selectionByDocument, setSelectionByDocument] = useState<Record<number, SelectionRect | null>>({});
  const [aiQuestion, setAiQuestion] = useState('');
  const [incomingAssetSuggestion, setIncomingAssetSuggestion] = useState<CaptureAsset | null>(null);
  const [captureAssetsBySubject, setCaptureAssetsBySubject] = useState<Record<number, CaptureAsset[]>>({});
  const [attachmentsByDocument, setAttachmentsByDocument] = useState<Record<number, WorkspaceAttachment[]>>({});
  const [pageCaptureReferencesByDocument, setPageCaptureReferencesByDocument] = useState<Record<number, PageCaptureReference[]>>({});
  const [generatedPagesByDocument, setGeneratedPagesByDocument] = useState<Record<number, GeneratedWorkspacePage[]>>({});
  const [userStudyDocuments, setUserStudyDocuments] = useState<StudyDocumentEntry[]>([]);
  const [deletedNoteIds, setDeletedNoteIds] = useState<number[]>([]);
  const [deletedStudyDocumentIds, setDeletedStudyDocumentIds] = useState<number[]>([]);
  const [currentPdfPageByDocument, setCurrentPdfPageByDocument] = useState<Record<number, number>>({});
  const [activePageByDocument, setActivePageByDocument] = useState<Record<number, DocumentPageView>>({});
  const [bookmarksByDocument, setBookmarksByDocument] = useState<Record<number, BookmarkedPage[]>>({});
  const { workspaceFeedback, setWorkspaceFeedback } = useWorkspaceFeedback();
  const [incomingBannerQueue, setIncomingBannerQueue] = useState<CaptureAsset[]>([]);
  const [aiAnswer, setAiAnswer] = useState<AiAnswer | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [selectionPreviewByDocument, setSelectionPreviewByDocument] = useState<Record<number, string | null>>({});
  const [chatSessionByDocument, setChatSessionByDocument] = useState<Record<number, number>>({});
  const [viewingAiChatSessionId, setViewingAiChatSessionId] = useState<number | null>(null);
  const [lastChatSessionByDocument, setLastChatSessionByDocument] = useState<Record<number, number>>({});
  const [chatSessionsByDocument, setChatSessionsByDocument] = useState<Record<number, BackendChatSession[]>>({});
  const [classInsightByDocument, setClassInsightByDocument] = useState<Record<number, BackendClassInsight | null>>({});
  const [allChatSessions, setAllChatSessions] = useState<BackendChatSession[]>([]);
  const [aiChatScope, setAiChatScope] = useState<'note' | 'all'>('note');
  const [aiChatSearchQuery, setAiChatSearchQuery] = useState('');
  const [aiMessagesBySession, setAiMessagesBySession] = useState<Record<number, BackendChatMessage[]>>({});
  const loadAllAiChatSessions = useCallback(() => {
    if (!isBackendApiEnabled()) return;

    listAllBackendChatSessions()
      .then((sessions) => {
        setAllChatSessions(sessions);
      })
      .catch((error) => {
        setAiError(getAiBackendErrorMessage(error, 'AI 채팅 내역을 불러오지 못했습니다.'));
      });
  }, []);

  const changeAiChatScope = useCallback((scope: 'note' | 'all') => {
    setAiChatScope(scope);
    if (scope === 'all') loadAllAiChatSessions();
  }, [loadAllAiChatSessions]);

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
    notebookPages,
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
  const pageCaptureReferences = useMemo(() => {
    if (!studyDocumentId) return [];
    return pageCaptureReferencesByDocument[studyDocumentId] ?? [];
  }, [pageCaptureReferencesByDocument, studyDocumentId]);
  const allPageCaptureReferences = useMemo(
    () => Object.values(pageCaptureReferencesByDocument).flat(),
    [pageCaptureReferencesByDocument],
  );
  const currentPageCaptureReferences = useMemo(() => {
    if (!currentDocumentPage) return [];
    return pageCaptureReferences.filter((reference) => isSameDocumentPage(reference.page, currentDocumentPage));
  }, [currentDocumentPage, pageCaptureReferences]);
  const hydrateWorkspaceState = useCallback((snapshot: PersistedStudyWorkspaceState | null) => {
    if (!snapshot) return;
    setUserStudyDocuments(snapshot.userStudyDocuments);
    setDeletedNoteIds(snapshot.deletedNoteIds ?? []);
    setDeletedStudyDocumentIds(snapshot.deletedStudyDocumentIds ?? []);
    setCaptureAssetsBySubject(snapshot.captureAssetsBySubject);
    setAttachmentsByDocument(snapshot.attachmentsByDocument);
    setPageCaptureReferencesByDocument(snapshot.pageCaptureReferencesByDocument ?? {});
    setGeneratedPagesByDocument(snapshot.generatedPagesByDocument);
    setInkByDocument(snapshot.inkByDocument);
    setTextAnnotationsByDocument(snapshot.textAnnotationsByDocument);
    setCurrentPdfPageByDocument(snapshot.currentPdfPageByDocument);
    setActivePageByDocument(snapshot.activePageByDocument);
    setBookmarksByDocument(snapshot.bookmarksByDocument ?? {});
    setLastChatSessionByDocument(snapshot.lastChatSessionByDocument ?? {});
    setAiPanelMode(snapshot.aiPanelMode === 'sidebar' ? 'sidebar' : 'floating');
  }, []);
  const persistedWorkspaceState = useMemo<PersistedStudyWorkspaceState>(() => ({
    version: 1,
    userStudyDocuments,
    deletedNoteIds,
    deletedStudyDocumentIds,
    captureAssetsBySubject,
    attachmentsByDocument,
    pageCaptureReferencesByDocument,
    generatedPagesByDocument,
    inkByDocument,
    textAnnotationsByDocument,
    currentPdfPageByDocument,
    activePageByDocument,
    bookmarksByDocument,
    lastChatSessionByDocument,
    aiPanelMode,
  }), [
    activePageByDocument,
    aiPanelMode,
    attachmentsByDocument,
    bookmarksByDocument,
    captureAssetsBySubject,
    currentPdfPageByDocument,
    deletedNoteIds,
    deletedStudyDocumentIds,
    generatedPagesByDocument,
    inkByDocument,
    lastChatSessionByDocument,
    pageCaptureReferencesByDocument,
    textAnnotationsByDocument,
    userStudyDocuments,
  ]);
  const { workspaceHydrated, localPersistenceError } = useStudyWorkspacePersistence({
    state: persistedWorkspaceState,
    onHydrate: hydrateWorkspaceState,
  });
  const studyDocumentBackendNoteId = getStudyDocumentBackendNoteId(studyDocument);
  const {
    backendPageIdsByDocument,
    setBackendPageIdsByDocument,
    markBackendPageDirty,
    syncPdfDocumentToBackend,
    failedPageSaveCount,
    pendingPageSaveCount,
    savingPageCount,
  } = useBackendNotePageSync({
    workspaceHydrated,
    studyDocumentId,
    studyDocument,
    availableSubjects,
    userStudyDocuments,
    inkByDocument,
    textAnnotationsByDocument,
    setUserStudyDocuments,
    setInkByDocument,
    setTextAnnotationsByDocument,
    setWorkspaceFeedback,
  });
  const {
    activeAiChatSessionId,
    aiChatReadOnly,
    aiMessages,
    selectionPreviewUri,
    noteAiChatSessions: aiChatSessions,
    visibleAiChatSessions,
    currentDocumentHasBackendPages,
  } = useAiChatDerivedState({
    studyDocumentId,
    currentBackendNoteId: studyDocumentBackendNoteId,
    chatSessionByDocument,
    viewingAiChatSessionId,
    aiMessagesBySession,
    selectionPreviewByDocument,
    chatSessionsByDocument,
    allChatSessions,
    aiChatScope,
    aiChatSearchQuery,
    backendPageIdsByDocument,
  });
  const currentAiCanvasPageNumber = currentDocumentPage?.kind === 'pdf' ? currentDocumentPage.pageNumber : currentPdfPage;
  const aiCanvas = useAiCanvasNotes({
    noteId: studyDocumentBackendNoteId,
    enabled: workspaceHydrated && isBackendApiEnabled() && !!studyDocumentBackendNoteId && currentDocumentHasBackendPages,
    currentPageNumber: currentAiCanvasPageNumber ?? null,
    onFeedback: setWorkspaceFeedback,
  });
  const currentClassInsight = studyDocumentId ? classInsightByDocument[studyDocumentId] ?? null : null;

  usePencilInteractionFeedback({
    enabled: noteWorkspaceMode === 'note' && Boolean(studyDocumentId),
    onFeedback: setWorkspaceFeedback,
  });

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
    if (!workspaceHydrated || !isBackendApiEnabled() || !studyDocumentId || !currentDocumentHasBackendPages) return;
    if (Object.prototype.hasOwnProperty.call(classInsightByDocument, studyDocumentId)) return;

    let mounted = true;

    getBackendClassInsight(studyDocumentId, 12)
      .then((insight) => {
        if (mounted) setClassInsightByDocument((current) => ({ ...current, [studyDocumentId]: insight }));
      })
      .catch(() => {
        if (mounted) setClassInsightByDocument((current) => ({ ...current, [studyDocumentId]: null }));
      });

    return () => {
      mounted = false;
    };
  }, [classInsightByDocument, currentDocumentHasBackendPages, studyDocumentId, workspaceHydrated]);

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
            const fileUrl = backendNote.file_url ?? null;
            const pageCount = Math.max(1, backendNote.page_count ?? 1);
            const pdfLikeBackendNote = /\.pdf$/i.test(backendNote.title.trim()) || !!fileUrl || pageCount > 1;
            const documentType = pdfLikeBackendNote ? 'pdf' as const : 'blank' as const;

            return {
              id: backendNote.id,
              subjectId: subject?.id ?? props.initialSubjectId ?? 101,
              backendNoteId: backendNote.id,
              title: backendNote.title,
              type: documentType,
              updatedAt: 'DB 저장됨',
              pageCount,
              preview: backendNote.summary ?? '백엔드에 저장된 노트입니다.',
              file: fileUrl ? { uri: fileUrl } : undefined,
              remoteFileUrl: fileUrl ?? undefined,
              thumbnailUrl: backendNote.thumbnail_url ?? undefined,
              backendSyncStatus: 'synced',
            } satisfies StudyDocumentEntry;
          }),
        );

        if (!mounted) return;
        const backendDocumentIds = new Set(documents.map((document) => document.id));
        setUserStudyDocuments((current) => {
          const backendDocumentByBackendId = new Map<number, StudyDocumentEntry>();
          documents.forEach((document) => {
            if (document.backendNoteId) backendDocumentByBackendId.set(document.backendNoteId, document);
          });
          const mergedCurrent = current.map((document) => {
            const backendNoteId = getStudyDocumentBackendNoteId(document);
            const backendDocument = backendNoteId ? backendDocumentByBackendId.get(backendNoteId) : null;
            if (!backendDocument) return document;

            return {
              ...backendDocument,
              id: document.id,
              localFileUri: document.localFileUri,
              file: document.localFileUri ? { uri: document.localFileUri } : normalizeDocumentFile(backendDocument.file),
            };
          });
          const existingBackendNoteIds = new Set(
            mergedCurrent
              .map((document) => getStudyDocumentBackendNoteId(document))
              .filter((id): id is number => typeof id === 'number'),
          );
          const nextById = new Map<number, StudyDocumentEntry>();
          [...mergedCurrent, ...documents.filter((document) => !document.backendNoteId || !existingBackendNoteIds.has(document.backendNoteId))].forEach((document) => {
            nextById.set(document.id, {
              ...document,
              file: normalizeDocumentFile(document.file),
            });
          });
          return Array.from(nextById.values()).sort((left, right) => right.id - left.id);
        });
        setDeletedStudyDocumentIds((current) => current.filter((id) => !backendDocumentIds.has(id)));
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
    if (!workspaceHydrated || !aiPanelOpen || !isBackendApiEnabled() || !studyDocumentId || !currentDocumentHasBackendPages) {
      return;
    }
    const backendNoteId = getStudyDocumentBackendNoteId(studyDocument);
    if (!backendNoteId) return;

    let mounted = true;

    const loadAiMessages = async () => {
      try {
        const sessions = await listBackendChatSessions(backendNoteId);
        const preferredSessionId = chatSessionByDocument[studyDocumentId] ?? lastChatSessionByDocument[studyDocumentId];
        const session = sessions.find((item) => item.id === preferredSessionId) ?? sessions[0] ?? null;

        if (!session) {
          if (!mounted) return;
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
  }, [aiPanelOpen, currentDocumentHasBackendPages, studyDocument, studyDocumentId, workspaceHydrated]);
  const {
    openSubject,
    openNote,
    requestDeleteNote,
    restoreNote,
    renameStudyDocument,
    changeNoteWorkspaceMode,
    resetToSubjectList,
  } = useWorkspaceDocumentIntents({
    visibleNotes,
    deletedNotes,
    allStudyDocuments,
    deletedStudyDocuments,
    noteId,
    onOpenNotesTab: props.onOpenNotesTab,
    setSubjectId,
    setNoteId,
    setQuery,
    setNoteDetailTab,
    setNoteWorkspaceMode,
    setStudyDocumentId,
    setInkTool,
    setAiPanelOpen,
    setDeletedNoteIds,
    setUserStudyDocuments,
    setWorkspaceFeedback,
  });

  const {
    openStudyDocument,
    openCreatedStudyDocument,
    createBlankNote,
    requestDeleteStudyDocument,
    restoreStudyDocument,
    uploadPdfDocument,
    resetNotes,
    resetLocalWorkspaceData,
    backToNoteList,
  } = useStudyDocumentActions({
    wide: props.wide,
    subjectId,
    studyDocumentId,
    availableSubjects,
    allStudyDocuments,
    deletedStudyDocuments,
    currentPdfPageByDocument,
    lastChatSessionByDocument,
    onOpenNotesTab: props.onOpenNotesTab,
    syncPdfDocumentToBackend,
    setSubjectId,
    setNoteId,
    setQuery,
    setNoteDetailTab,
    setNoteWorkspaceMode,
    setStudyDocumentId,
    setInkTool,
    setAiPanelOpen,
    setViewingAiChatSessionId,
    setChatSessionByDocument,
    setLastChatSessionByDocument,
    setChatSessionsByDocument,
    setAllChatSessions,
    setCurrentPdfPageByDocument,
    setActivePageByDocument,
    setUserStudyDocuments,
    setDeletedNoteIds,
    setDeletedStudyDocumentIds,
    setBackendPageIdsByDocument,
    setInkByDocument,
    setRedoInkByDocument,
    setTextAnnotationsByDocument,
    setBookmarksByDocument,
    setAttachmentsByDocument,
    setPageCaptureReferencesByDocument,
    setGeneratedPagesByDocument,
    setCaptureAssetsBySubject,
    setIncomingAssetSuggestion,
    setIncomingBannerQueue,
    setAiAnswer,
    setAiError,
    setAiLoading,
    setWorkspaceFeedback,
  });

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

    if (tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'ellipse') {
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
    setInkTool((current) => (current !== 'pen' && current !== 'highlight' && !isShapeTool(current) ? 'pen' : current));
  };

  const changePenWidth = (width: number) => {
    setPenWidth(width);
    setInkTool((current) => (current !== 'pen' && current !== 'highlight' && !isShapeTool(current) ? 'pen' : current));
  };

  const changeBrushType = (brush: InkBrush) => {
    setBrushType(brush);
    setInkTool(brush === 'highlighter' ? 'highlight' : 'pen');
    if (brush === 'highlighter' && penWidth < 8) setPenWidth(12);
    if (brush !== 'highlighter' && penWidth > 10) setPenWidth(4);
  };

  const changeLinePattern = (pattern: InkLinePattern) => {
    setLinePattern(pattern === 'dashed' ? 'dotted' : pattern);
    setInkTool((current) => (current !== 'pen' && current !== 'highlight' && !isShapeTool(current) ? 'pen' : current));
  };

  const changeEraserMode = (mode: InkEraserMode) => {
    setEraserMode(mode);
    setInkTool('erase');
  };

  const changeSelectionMode = (mode: InkSelectionMode) => {
    setSelectionMode(mode);
    setInkTool('select');
    if (studyDocumentId) {
      setSelectionByDocument((current) => ({ ...current, [studyDocumentId]: null }));
      setSelectionPreviewByDocument((current) => ({ ...current, [studyDocumentId]: null }));
    }
  };

  const changeBrushSettings = (nextSettings: Partial<InkBrushSettings>) => {
    setBrushSettings((current) => ({
      stability: Math.max(0, Math.min(100, nextSettings.stability ?? current.stability)),
      sharpness: Math.max(0, Math.min(100, nextSettings.sharpness ?? current.sharpness)),
      density: Math.max(0, Math.min(100, nextSettings.density ?? current.density)),
      pressure: Math.max(0, Math.min(100, nextSettings.pressure ?? current.pressure)),
    }));
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

  const {
    updateAssetStatus,
    findCaptureAssetById,
    createImageNoteFromAsset,
    removeCaptureAsset,
  } = useCaptureAssetActions({
    availableSubjects,
    subject,
    studyDocumentId,
    studyDocument,
    currentPdfPageByDocument,
    backendPageIdsByDocument,
    captureAssetsBySubject,
    setCaptureAssetsBySubject,
    setAttachmentsByDocument,
    setGeneratedPagesByDocument,
    setPageCaptureReferencesByDocument,
    setActivePageByDocument,
    setBackendPageIdsByDocument,
    setIncomingAssetSuggestion,
    setIncomingBannerQueue,
    setWorkspaceFeedback,
    openCreatedStudyDocument,
  });

  const clearSelectionForCurrentDocument = useCallback(() => {
    if (!studyDocumentId) return;
    setSelectionByDocument((current) => ({ ...current, [studyDocumentId]: null }));
    setSelectionPreviewByDocument((current) => ({ ...current, [studyDocumentId]: null }));
  }, [studyDocumentId]);

  const {
    selectAiChatSession,
    renameAiChatSession,
    removeAiChatSession,
    createAiChatSession,
    startNewAiChatSession,
    requestAiAnswer,
    requestAiAnswerForQuestion,
  } = useAiChatActions({
    studyDocumentId,
    studyDocument,
    currentDocumentHasBackendPages,
    selectionRect,
    selectionPreviewUri,
    currentPageNumber: currentDocumentPage?.kind === 'pdf' ? currentDocumentPage.pageNumber : null,
    activeAiChatSessionId,
    aiChatReadOnly,
    aiQuestion,
    chatSessionByDocument,
    chatSessionsByDocument,
    allChatSessions,
    setAiAnswer,
    setAiQuestion,
    setAiError,
    setAiLoading,
    setSelectionPreviewByDocument,
    setChatSessionByDocument,
    setViewingAiChatSessionId,
    setLastChatSessionByDocument,
    setChatSessionsByDocument,
    setAllChatSessions,
    setAiMessagesBySession,
    clearSelection: clearSelectionForCurrentDocument,
    onRequestCanvasEditFromChat: aiCanvas.requestAiEditFromChat,
    buildContextHint: (question) => buildClassInsightContext({
      question,
      studyDocument,
      subject,
      inkStrokes: studyDocumentId ? inkByDocument[studyDocumentId] ?? [] : [],
      textAnnotations: studyDocumentId ? textAnnotationsByDocument[studyDocumentId] ?? [] : [],
      bookmarks: currentDocumentBookmarks,
      pageCaptureReferences,
      generatedPages: generatedWorkspacePages,
      classInsight: currentClassInsight,
    }),
  });

  const askAiAboutSelection = () => {
    if (!selectionRect && !selectionPreviewUri) {
      setWorkspaceFeedback('AI에게 물어볼 영역을 먼저 선택해 주세요.');
      return;
    }

    setViewingAiChatSessionId(null);
    setAiPanelOpen(true);
    setAiPanelMode('floating');
    setAiQuestion((current) => current.trim() || '이 선택 영역을 설명해줘');
    setWorkspaceFeedback(selectionPreviewUri
      ? '선택 영역을 AI 질문창에 첨부했습니다.'
      : '선택 영역 미리보기를 준비 중입니다. 잠시 후 질문을 보내세요.');
  };

  const {
    linkCaptureAssetToPage,
    linkCaptureAssetToCurrentPage,
    openPageCaptureReference,
    movePageCaptureReference,
    movePageCaptureReferenceToPage,
    removePageCaptureReference,
    askAiAboutPageCaptureReference,
  } = usePageCaptureReferenceActions({
    studyDocumentId,
    studyDocument,
    allStudyDocuments,
    availableSubjects,
    currentDocumentPages,
    currentDocumentPage,
    currentPdfPage,
    memoPages,
    currentDocumentHasBackendPages,
    pageCaptureReferencesByDocument,
    setPageCaptureReferencesByDocument,
    setActivePageByDocument,
    setCurrentPdfPageByDocument,
    setIncomingAssetSuggestion,
    setIncomingBannerQueue,
    setAiQuestion,
    setAiPanelOpen,
    setViewingAiChatSessionId,
    setWorkspaceFeedback,
    updateAssetStatus,
    findCaptureAssetById,
    createImageNoteFromAsset,
    openStudyDocument,
    requestAiAnswerForQuestion,
  });

  const acceptIncomingAsset = () => {
    if (!incomingAssetSuggestion) return;
    void linkCaptureAssetToCurrentPage(incomingAssetSuggestion);
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
    const asset = captureInbox.find((value) => value.id === assetId) ?? findCaptureAssetById(assetId);
    if (!asset) return;
    void linkCaptureAssetToCurrentPage(asset);
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
    pushWorkspaceHistorySnapshot,
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
  } = useInkActions({
    studyDocumentId,
    studyDocument,
    currentDocumentPage,
    currentPdfPage,
    selectionRect,
    selectionByDocument,
    inkByDocument,
    textAnnotationsByDocument,
    generatedPagesByDocument,
    activePageByDocument,
    inkHistoryByDocument,
    redoInkHistoryByDocument,
    setInkByDocument,
    setRedoInkByDocument,
    setInkHistoryByDocument,
    setRedoInkHistoryByDocument,
    setTextAnnotationsByDocument,
    setGeneratedPagesByDocument,
    setActivePageByDocument,
    setSelectionByDocument,
    setSelectionPreviewByDocument,
    setInkTool,
    setWorkspaceFeedback,
    onMarkPageDirty: markBackendPageDirty,
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
    setNoteWorkspaceMode(asset.type === 'image' ? 'photo' : 'note');
    setNoteId(null);
    setStudyDocumentId(null);
    setWorkspaceFeedback(asset.type === 'image' ? 'Photo 라이브러리에서 원본 사진을 확인할 수 있습니다.' : 'PDF 자료를 inbox에서 확인할 수 있습니다.');
    setIncomingBannerQueue((current) => current.slice(1));
  };

  const {
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
    pushWorkspaceHistorySnapshot,
  });
  const { effectiveWorkspaceFeedback, documentSaveStatus } = useWorkspaceSaveStatus({
    workspaceFeedback,
    failedPageSaveCount,
    pendingPageSaveCount,
    savingPageCount,
    workspaceHydrated,
  });

  return {
    subjectId,
    subject,
    note,
    noteDetailTab,
    noteWorkspaceMode,
    studyDocument,
    inkTool,
    fingerDrawingEnabled,
    penColor,
    penWidth,
    brushType,
    linePattern,
    eraserMode,
    selectionMode,
    brushSettings,
    inkStrokes,
    textAnnotations,
    inkByDocument,
    textAnnotationsByDocument,
    aiPanelOpen,
    aiPanelMode,
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
    aiChatReadOnly,
    aiLoading,
    aiError,
    aiCanvas,
    classInsight: currentClassInsight,
    query,
    sort,
    incomingAssetSuggestion,
    inboxHint,
    inboxPendingCount,
    workspaceFeedback: effectiveWorkspaceFeedback,
    documentSaveStatus,
    workspaceHydrated,
    localPersistenceError,
    activeIncomingBanner,
    captureAssetsBySubject,
    captureInbox,
    workspaceAttachments,
    pageCaptureReferences,
    allPageCaptureReferences,
    currentPageCaptureReferences,
    generatedWorkspacePages,
    memoPages,
    currentDocumentBookmarks,
    currentPageBookmarked,
    activeGeneratedPage,
    currentPdfPage,
    currentDocumentPages,
    notebookPages,
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
    changeBrushType,
    changeLinePattern,
    changeEraserMode,
    changeSelectionMode,
    changeBrushSettings,
    toggleAiPanel: () => setAiPanelOpen((current) => {
      const next = !current;
      if (next) setViewingAiChatSessionId(null);
      return next;
    }),
    setAiPanelMode,
    setAiQuestion,
    setAiChatScope: changeAiChatScope,
    onChangeAiChatScope: changeAiChatScope,
    onLoadAllAiChatSessions: loadAllAiChatSessions,
    setAiChatSearchQuery,
    selectAiChatSession,
    renameAiChatSession,
    removeAiChatSession,
    startNewAiChatSession,
    createAiChatSession,
    requestAiAnswer,
    askAiAboutSelection,
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
    moveTextAnnotation,
    resizeTextAnnotation,
    eraseInkAtPoint,
    removeInkStroke,
    deleteSelectedStrokes,
    changeSelectedStrokesColor,
    duplicateSelectedStrokes,
    resizeSelectedStrokes,
    resizeSelectedStrokesToRect,
    nudgeSelectedStrokes,
    acceptIncomingAsset,
    archiveIncomingAsset,
    dismissIncomingAsset,
    dismissIncomingBanner,
    insertInboxAsset,
    removeInboxAsset,
    removeCaptureAsset,
    linkCaptureAssetToPage,
    openPageCaptureReference,
    movePageCaptureReference,
    movePageCaptureReferenceToPage,
    removePageCaptureReference,
    askAiAboutPageCaptureReference,
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
    duplicateGeneratedPage,
    moveGeneratedPage,
    duplicatePdfPage,
    removePdfPage,
    movePdfPage,
    updateStudyDocumentPageCount,
    setCurrentPdfPage,
    goToPreviousDocumentPage: () => moveDocumentPage(-1),
    goToNextDocumentPage: () => moveDocumentPage(1),
    setQuery,
    toggleFingerDrawing: () => setFingerDrawingEnabled((current) => !current),
    toggleSort: () => setSort((current) => (current === 'latest' ? 'oldest' : 'latest')),
  };
}
