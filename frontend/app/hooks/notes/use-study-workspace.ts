import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { useWorkspaceCaptureIntents } from './workspace/use-workspace-capture-intents';
import { useWorkspaceAiIntents } from './workspace/use-workspace-ai-intents';
import { isSameDocumentPage, isShapeTool } from '../../ui-helpers';
import type { InkBrush, InkBrushSettings, InkEraserMode, InkImageAnnotation, InkLinePattern, InkSelectionMode, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../ui-types';
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
  const [eraserWidth, setEraserWidth] = useState(12);
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
  const [imageAnnotationsByDocument, setImageAnnotationsByDocument] = useState<Record<number, InkImageAnnotation[]>>({});
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelMode, setAiPanelMode] = useState<'floating' | 'sidebar'>('floating');
  const [selectionByDocument, setSelectionByDocument] = useState<Record<number, SelectionRect | null>>({});
  const [copiedSelectionImageByDocument, setCopiedSelectionImageByDocument] = useState<Record<number, string | null>>({});
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
  const [selectionPreviewAttachedByDocument, setSelectionPreviewAttachedByDocument] = useState<Record<number, boolean>>({});
  const [chatSessionByDocument, setChatSessionByDocument] = useState<Record<number, number>>({});
  const [viewingAiChatSessionId, setViewingAiChatSessionId] = useState<number | null>(null);
  const [lastChatSessionByDocument, setLastChatSessionByDocument] = useState<Record<number, number>>({});
  const [chatSessionsByDocument, setChatSessionsByDocument] = useState<Record<number, BackendChatSession[]>>({});
  const [classInsightByDocument, setClassInsightByDocument] = useState<Record<number, BackendClassInsight | null>>({});
  const classInsightFetchKeyRef = useRef<Record<number, string>>({});
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
    imageAnnotations,
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
    imageAnnotationsByDocument,
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
    setImageAnnotationsByDocument(snapshot.imageAnnotationsByDocument ?? {});
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
    imageAnnotationsByDocument,
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
    imageAnnotationsByDocument,
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
    imageAnnotationsByDocument,
    setUserStudyDocuments,
    setInkByDocument,
    setTextAnnotationsByDocument,
    setImageAnnotationsByDocument,
    setWorkspaceFeedback,
  });
  const {
    activeAiChatSessionId,
    aiChatReadOnly,
    aiMessages,
    rawSelectionPreviewUri,
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
    selectionPreviewAttachedByDocument,
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
  const currentBackendNoteId = getStudyDocumentBackendNoteId(studyDocument);

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
    if (!workspaceHydrated || !isBackendApiEnabled() || !studyDocumentId || !currentDocumentHasBackendPages || !currentBackendNoteId) return;

    const fetchKey = `${studyDocumentId}:${currentBackendNoteId}`;
    const cachedInsight = classInsightByDocument[studyDocumentId];
    if (cachedInsight?.note_id === currentBackendNoteId) return;
    if (classInsightFetchKeyRef.current[studyDocumentId] === fetchKey) return;
    classInsightFetchKeyRef.current[studyDocumentId] = fetchKey;

    let mounted = true;

    getBackendClassInsight(currentBackendNoteId, 12)
      .then((insight) => {
        if (mounted) setClassInsightByDocument((current) => ({ ...current, [studyDocumentId]: insight }));
      })
      .catch(() => {
        if (mounted) setClassInsightByDocument((current) => ({ ...current, [studyDocumentId]: null }));
      });

    return () => {
      mounted = false;
    };
  }, [classInsightByDocument, currentBackendNoteId, currentDocumentHasBackendPages, studyDocumentId, workspaceHydrated]);

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
        setSelectionPreviewAttachedByDocument((current) => ({ ...current, [studyDocumentId]: false }));
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
      setSelectionPreviewAttachedByDocument((current) => ({ ...current, [studyDocumentId]: false }));
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

  const changeEraserWidth = (width: number) => {
    setEraserWidth(Math.max(6, Math.min(36, Math.round(width))));
    setInkTool('erase');
  };

  const changeSelectionMode = (mode: InkSelectionMode) => {
    setSelectionMode(mode);
    setInkTool('select');
    if (studyDocumentId) {
      setSelectionByDocument((current) => ({ ...current, [studyDocumentId]: null }));
      setSelectionPreviewByDocument((current) => ({ ...current, [studyDocumentId]: null }));
      setSelectionPreviewAttachedByDocument((current) => ({ ...current, [studyDocumentId]: false }));
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
    setSelectionPreviewAttachedByDocument((current) => ({ ...current, [studyDocumentId]: false }));
    if (!rect) {
      setSelectionPreviewByDocument((current) => ({ ...current, [studyDocumentId]: null }));
    }
  };

  const changeSelectionPreview = (uri: string | null) => {
    if (!studyDocumentId) return;
    setSelectionPreviewByDocument((current) => ({ ...current, [studyDocumentId]: uri }));
  };

  const copySelectionImage = useCallback(() => {
    if (!studyDocumentId || !selectionRect) {
      setWorkspaceFeedback('복사할 선택 영역을 먼저 선택해 주세요.');
      return;
    }
    if (!selectionPreviewUri) {
      setWorkspaceFeedback('선택 영역 미리보기를 준비 중입니다. 잠시 후 다시 복사해 주세요.');
      return;
    }
    setCopiedSelectionImageByDocument((current) => ({ ...current, [studyDocumentId]: selectionPreviewUri }));
    setWorkspaceFeedback('선택 영역을 복사했습니다. Canvas 입력창에 붙여넣어 첨부할 수 있습니다.');
  }, [selectionPreviewUri, selectionRect, studyDocumentId]);

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
    setSelectionPreviewAttachedByDocument((current) => ({ ...current, [studyDocumentId]: false }));
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
    selectionAttachmentEnabled: Boolean(studyDocumentId && selectionPreviewAttachedByDocument[studyDocumentId]),
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
    activeCanvasNoteId: aiCanvas.activeNoteId,
    onApplyCanvasEditFromChat: aiCanvas.applyChatCanvasEdit,
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

  const {
    toggleAiPanel,
    askAiAboutSelection,
  } = useWorkspaceAiIntents({
    selectionRect,
    selectionPreviewUri: rawSelectionPreviewUri,
    setAiPanelOpen,
    setAiPanelMode,
    setAiQuestion,
    setViewingAiChatSessionId,
    setWorkspaceFeedback,
    attachSelectionPreviewToAi: (selectionPreviewUri?: string | null) => {
      if (!studyDocumentId) return;
      if (selectionPreviewUri !== undefined) {
        setSelectionPreviewByDocument((current) => ({ ...current, [studyDocumentId]: selectionPreviewUri }));
      }
      setSelectionPreviewAttachedByDocument((current) => ({ ...current, [studyDocumentId]: true }));
    },
  });

  const addCaptureImageAnnotation = useCallback((annotation: Partial<InkImageAnnotation> & Pick<InkImageAnnotation, 'uri'>) => {
    if (!studyDocumentId || !annotation.uri) return;
    const generatedPageId = annotation.generatedPageId ?? (currentDocumentPage?.kind === 'generated' ? currentDocumentPage.pageId : undefined);
    const pageNumber = generatedPageId ? 1 : annotation.pageNumber ?? (currentDocumentPage?.kind === 'pdf' ? currentDocumentPage.pageNumber : currentPdfPage);
    const anchoredSelection = selectionRect && (
      generatedPageId
        ? selectionRect.generatedPageId === generatedPageId
        : !selectionRect.generatedPageId && (selectionRect.pageNumber ?? pageNumber) === pageNumber
    )
      ? selectionRect
      : null;
    const pageWidth = annotation.pageWidth ?? anchoredSelection?.pageWidth;
    const pageHeight = annotation.pageHeight ?? anchoredSelection?.pageHeight;
    const defaultWidth = pageWidth ? Math.min(280, Math.max(120, pageWidth * 0.38)) : 260;
    const defaultHeight = Math.max(90, defaultWidth * 0.68);
    const width = Math.max(48, annotation.width ?? anchoredSelection?.width ?? defaultWidth);
    const height = Math.max(48, annotation.height ?? anchoredSelection?.height ?? defaultHeight);
    const x = Math.max(0, Math.min(pageWidth ? Math.max(0, pageWidth - width) : Number.POSITIVE_INFINITY, annotation.x ?? anchoredSelection?.x ?? 42));
    const y = Math.max(0, Math.min(pageHeight ? Math.max(0, pageHeight - height) : Number.POSITIVE_INFINITY, annotation.y ?? anchoredSelection?.y ?? 42));
    const snapshot: WorkspaceEditSnapshot = {
      inkStrokes: inkByDocument[studyDocumentId] ?? [],
      textAnnotations: textAnnotationsByDocument[studyDocumentId] ?? [],
      imageAnnotations: imageAnnotationsByDocument[studyDocumentId] ?? [],
      selectionRect: selectionRect ?? null,
      generatedPages: generatedPagesByDocument[studyDocumentId],
      activePage: activePageByDocument[studyDocumentId],
    };
    setInkHistoryByDocument((current) => ({
      ...current,
      [studyDocumentId]: [...(current[studyDocumentId] ?? []).slice(-39), snapshot],
    }));
    setRedoInkHistoryByDocument((current) => ({
      ...current,
      [studyDocumentId]: [],
    }));
    setRedoInkByDocument((current) => ({
      ...current,
      [studyDocumentId]: [],
    }));
    setImageAnnotationsByDocument((current) => ({
      ...current,
      [studyDocumentId]: [
        ...(current[studyDocumentId] ?? []),
        {
          id: annotation.id ?? `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          uri: annotation.uri,
          assetId: annotation.assetId,
          pageNumber,
          generatedPageId,
          x,
          y,
          width,
          height,
          rotation: annotation.rotation ?? 0,
          opacity: annotation.opacity ?? 1,
          pageWidth,
          pageHeight,
          zIndex: annotation.zIndex,
        },
      ],
    }));
    if (anchoredSelection) {
      setSelectionByDocument((current) => ({ ...current, [studyDocumentId]: null }));
      setSelectionPreviewByDocument((current) => ({ ...current, [studyDocumentId]: null }));
    }
    if (!generatedPageId) markBackendPageDirty(studyDocumentId, pageNumber);
    setWorkspaceFeedback('현재 페이지에 이미지를 배치했습니다.');
  }, [
    activePageByDocument,
    currentDocumentPage,
    currentPdfPage,
    generatedPagesByDocument,
    imageAnnotationsByDocument,
    inkByDocument,
    markBackendPageDirty,
    selectionRect,
    setWorkspaceFeedback,
    studyDocumentId,
    textAnnotationsByDocument,
  ]);

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
  const requestAiCanvasCommand = useCallback(async (command: string, options?: { selectionImageUri?: string | null }) => (
    requestAiAnswer({
      question: command,
      source: 'canvas-mini',
      selectionImageUri: options?.selectionImageUri ?? null,
    })
  ), [requestAiAnswer]);

  const {
    acceptIncomingAsset,
    archiveIncomingAsset,
    dismissIncomingAsset,
    insertInboxAsset,
    removeInboxAsset,
    removeWorkspaceAttachment,
    openWorkspaceAttachment,
    dismissIncomingBanner,
    openIncomingBanner,
  } = useWorkspaceCaptureIntents({
    studyDocumentId,
    incomingAssetSuggestion,
    incomingBannerQueue,
    captureInbox,
    attachmentsByDocument,
    generatedPagesByDocument,
    activePageByDocument,
    onOpenNotesTab: props.onOpenNotesTab,
    updateAssetStatus,
    findCaptureAssetById,
    linkCaptureAssetToCurrentPage,
    setSubjectId,
    setNoteId,
    setNoteWorkspaceMode,
    setStudyDocumentId,
    setIncomingAssetSuggestion,
    setIncomingBannerQueue,
    setWorkspaceFeedback,
    setAttachmentsByDocument,
    setGeneratedPagesByDocument,
    setBookmarksByDocument,
    setActivePageByDocument,
    setCurrentPdfPageByDocument,
  });

  const {
    pushWorkspaceHistorySnapshot,
    clearCurrentSelection,
    clearInk,
    undoInk,
    redoInk,
    commitInkStroke,
    removeInkStroke,
    replaceInkStrokes,
    addTextAnnotation,
    addImageAnnotation,
    updateTextAnnotation,
    removeTextAnnotation,
    moveTextAnnotation,
    resizeTextAnnotation,
    changeTextAnnotationFontSize,
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
    imageAnnotationsByDocument,
    generatedPagesByDocument,
    activePageByDocument,
    inkHistoryByDocument,
    redoInkHistoryByDocument,
    setInkByDocument,
    setRedoInkByDocument,
    setInkHistoryByDocument,
    setRedoInkHistoryByDocument,
    setTextAnnotationsByDocument,
    setImageAnnotationsByDocument,
    setGeneratedPagesByDocument,
    setActivePageByDocument,
    setSelectionByDocument,
    setSelectionPreviewByDocument,
    setInkTool,
    setWorkspaceFeedback,
    onMarkPageDirty: markBackendPageDirty,
  });

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
    eraserWidth,
    selectionMode,
    brushSettings,
    inkStrokes,
    textAnnotations,
    imageAnnotations,
    inkByDocument,
    textAnnotationsByDocument,
    imageAnnotationsByDocument,
    aiPanelOpen,
    aiPanelMode,
    selectionRect,
    selectionPreviewUri,
    copiedSelectionImageUri: studyDocumentId ? copiedSelectionImageByDocument[studyDocumentId] ?? null : null,
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
    changeEraserWidth,
    changeSelectionMode,
    changeBrushSettings,
    toggleAiPanel,
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
    requestAiCanvasCommand,
    askAiAboutSelection,
    insertAiAnswerPage,
    changeSelection,
    changeSelectionPreview,
    copySelectionImage,
    clearCurrentSelection,
    undoInk,
    redoInk,
    clearInk,
    commitInkStroke,
    resetToSubjectList,
    backToNoteList,
    addTextAnnotation,
    addImageAnnotation,
    updateTextAnnotation,
    removeTextAnnotation,
    moveTextAnnotation,
    resizeTextAnnotation,
    changeTextAnnotationFontSize,
    eraseInkAtPoint,
    removeInkStroke,
    replaceInkStrokes,
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
