import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import {
  createBackendNote,
  createBackendNotePage,
  deleteBackendNote,
  ensureFolderForSubject,
  extractBackendPdfText,
  isBackendApiEnabled,
  listAllBackendChatSessions,
  listBackendChatMessages,
  listBackendChatSessions,
  listBackendFolders,
  listBackendNotePages,
  listBackendNotes,
  resolveBackendAssetUrl,
  updateBackendNote,
  updateBackendNotePage,
  uploadBackendPdfNote,
  BackendApiError,
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
  buildPageCaptureReference,
  buildGeneratedSummary,
  buildWorkspaceAttachment,
} from './workspace/helpers';
import { getAiBackendErrorMessage } from './ai/ai-errors';
import { useAiChatActions } from './ai/use-ai-chat-actions';
import { useAiChatDerivedState } from './ai/use-ai-chat-derived-state';
import { useAiCanvasNotes } from './ai-canvas/use-ai-canvas-notes';
import { addUniqueId, removeId, upsertStudyDocument } from './document/collection-helpers';
import { useDocumentPageActions } from './document/use-document-page-actions';
import { confirmDeleteAction } from './ui/confirm-delete-action';
import { useInkActions, type WorkspaceEditSnapshot } from './ink/use-ink-actions';
import { parseNotePageContent, serializeNotePageContent } from './document/note-page-content';
import { useIncomingAssetSubscription } from './workspace/use-incoming-asset-subscription';
import { useStudyWorkspaceDerivedState } from './workspace/use-study-workspace-derived-state';
import { useStudyWorkspacePersistence } from './workspace/use-study-workspace-persistence';
import { getDocumentPageLabel, isSameDocumentPage, isShapeTool } from '../../ui-helpers';
import type { InkBrush, InkBrushSettings, InkLinePattern, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../ui-types';
import type { AiAnswer, BookmarkedPage, CaptureAsset, DocumentPageView, GeneratedWorkspacePage, NoteWorkspaceMode, PageCaptureReference, StudyDocumentEntry, Subject, WorkspaceAttachment } from '../../types';

type PendingPageSave = {
  pageId: number;
  documentId: number;
  pageNumber: number;
  content: string;
  attempts: number;
  updatedAt: number;
};

const EMPTY_PAGE_CONTENT = serializeNotePageContent({ inkStrokes: [], textAnnotations: [] });

const getPageSaveKey = (documentId: number, pageNumber: number) => `${documentId}:${pageNumber}`;

async function buildPdfDataUriForTextExtraction(picked: DocumentPicker.DocumentPickerAsset, pdfFileUri: string) {
  if (pdfFileUri.startsWith('data:application/pdf')) return pdfFileUri;
  if (Platform.OS === 'web' && picked.base64) {
    return picked.base64.startsWith('data:application/pdf')
      ? picked.base64
      : `data:application/pdf;base64,${picked.base64}`;
  }
  if (!picked.uri) return null;

  const base64 = await new File(picked.uri).base64();
  return `data:application/pdf;base64,${base64}`;
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
  const [noteWorkspaceMode, setNoteWorkspaceMode] = useState<NoteWorkspaceMode>('note');
  const [studyDocumentId, setStudyDocumentId] = useState<number | null>(null);
  const [inkTool, setInkTool] = useState<InkTool>('view');
  const [penColor, setPenColor] = useState<string>(DEFAULT_PEN_COLOR);
  const [penWidth, setPenWidth] = useState(3);
  const [brushType, setBrushType] = useState<InkBrush>('ballpoint');
  const [linePattern, setLinePattern] = useState<InkLinePattern>('solid');
  const [brushSettings, setBrushSettings] = useState<InkBrushSettings>({
    stability: 60,
    sharpness: 50,
    density: 100,
    pressure: 55,
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
  const [workspaceFeedback, setWorkspaceFeedback] = useState<string | null>(null);
  const [incomingBannerQueue, setIncomingBannerQueue] = useState<CaptureAsset[]>([]);
  const [aiAnswer, setAiAnswer] = useState<AiAnswer | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [selectionPreviewByDocument, setSelectionPreviewByDocument] = useState<Record<number, string | null>>({});
  const [chatSessionByDocument, setChatSessionByDocument] = useState<Record<number, number>>({});
  const [viewingAiChatSessionId, setViewingAiChatSessionId] = useState<number | null>(null);
  const [lastChatSessionByDocument, setLastChatSessionByDocument] = useState<Record<number, number>>({});
  const [chatSessionsByDocument, setChatSessionsByDocument] = useState<Record<number, BackendChatSession[]>>({});
  const [allChatSessions, setAllChatSessions] = useState<BackendChatSession[]>([]);
  const [aiChatScope, setAiChatScope] = useState<'note' | 'all'>('note');
  const [aiChatSearchQuery, setAiChatSearchQuery] = useState('');
  const [aiMessagesBySession, setAiMessagesBySession] = useState<Record<number, BackendChatMessage[]>>({});
  const [backendPageIdsByDocument, setBackendPageIdsByDocument] = useState<Record<number, Record<number, number>>>({});
  const [pendingPageSaves, setPendingPageSaves] = useState<Record<string, PendingPageSave>>({});
  const [savingPageKeys, setSavingPageKeys] = useState<Record<string, true>>({});
  const [failedPageSaveKeys, setFailedPageSaveKeys] = useState<Record<string, true>>({});
  const lastQueuedPageContentRef = useRef<Record<string, string>>({});
  const lastSavedPageContentRef = useRef<Record<string, string>>({});

  const isPdfAssetUrl = (url: string | null | undefined) => !!url && /\.pdf(?:$|[?#])/i.test(url);
  const normalizeDocumentFile = (file: StudyDocumentEntry['file']) => {
    if (!file || typeof file !== 'object' || !('uri' in file)) return file;
    return {
      ...file,
      uri: resolveBackendAssetUrl(file.uri) ?? file.uri,
    };
  };

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
    noteId: studyDocumentId,
    enabled: workspaceHydrated && isBackendApiEnabled() && !!studyDocumentId && currentDocumentHasBackendPages,
    currentPageNumber: currentAiCanvasPageNumber ?? null,
    onFeedback: setWorkspaceFeedback,
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
        const savedPageContentByKey: Record<string, string> = {};
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
              if (!storedPage) {
                savedPageContentByKey[getPageSaveKey(backendNote.id, page.page_number)] = EMPTY_PAGE_CONTENT;
                return;
              }
              hasStoredPageContentByDocument[backendNote.id] = true;

              const normalizedInkStrokes = storedPage.inkStrokes.map((stroke) => ({
                ...stroke,
                generatedPageId: undefined,
                pageNumber: page.page_number,
              }));
              const normalizedTextAnnotations = storedPage.textAnnotations.map((annotation) => ({
                ...annotation,
                generatedPageId: undefined,
                pageNumber: page.page_number,
              }));

              savedPageContentByKey[getPageSaveKey(backendNote.id, page.page_number)] = serializeNotePageContent({
                inkStrokes: normalizedInkStrokes,
                textAnnotations: normalizedTextAnnotations,
              });
              inkByBackendDocument[backendNote.id].push(...normalizedInkStrokes);
              textAnnotationsByBackendDocument[backendNote.id].push(...normalizedTextAnnotations);
            });

            const firstPageUrl = firstPage?.image_url ?? null;
            const fileUrl = backendNote.file_url ?? (isPdfAssetUrl(firstPageUrl) ? firstPageUrl : null);
            const pdfLikeBackendNote = /\.pdf$/i.test(backendNote.title.trim()) || !!fileUrl || pages.length > 1;
            const documentType = pdfLikeBackendNote ? 'pdf' as const : firstPageUrl ? 'image' as const : 'blank' as const;
            const pageCount = Math.max(1, backendNote.page_count ?? pages.length);

            return {
              id: backendNote.id,
              subjectId: subject?.id ?? props.initialSubjectId ?? 101,
              title: backendNote.title,
              type: documentType,
              updatedAt: 'DB 저장됨',
              pageCount,
              preview: backendNote.summary ?? firstPage?.content ?? '백엔드에 저장된 노트입니다.',
              file: fileUrl ? { uri: fileUrl } : firstPageUrl ? { uri: firstPageUrl } : undefined,
              thumbnailUrl: backendNote.thumbnail_url ?? undefined,
            } satisfies StudyDocumentEntry;
          }),
        );

        if (!mounted) return;
        const backendDocumentIds = new Set(documents.map((document) => document.id));
        setUserStudyDocuments((current) => {
          const nextById = new Map<number, StudyDocumentEntry>();
          [...current, ...documents].forEach((document) => {
            nextById.set(document.id, {
              ...document,
              file: normalizeDocumentFile(document.file),
            });
          });
          return Array.from(nextById.values()).sort((left, right) => right.id - left.id);
        });
        setDeletedStudyDocumentIds((current) => current.filter((id) => !backendDocumentIds.has(id)));
        setBackendPageIdsByDocument((current) => ({
          ...current,
          ...pageIdsByDocument,
        }));
        lastSavedPageContentRef.current = {
          ...lastSavedPageContentRef.current,
          ...savedPageContentByKey,
        };
        lastQueuedPageContentRef.current = {
          ...lastQueuedPageContentRef.current,
          ...savedPageContentByKey,
        };
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
      const nextPendingSaves: Record<string, PendingPageSave> = {};
      const clearedSaveKeys = new Set<string>();

      Object.entries(backendPageIdsByDocument).forEach(([documentIdText, pagesByNumber]) => {
        const documentId = Number(documentIdText);
        const documentInk = inkByDocument[documentId] ?? [];
        const documentTextAnnotations = textAnnotationsByDocument[documentId] ?? [];

        Object.entries(pagesByNumber).forEach(([pageNumberText, pageId]) => {
          const pageNumber = Number(pageNumberText);
          const pageInkStrokes = documentInk.filter((stroke) => !stroke.generatedPageId && (stroke.pageNumber ?? 1) === pageNumber);
          const pageTextAnnotations = documentTextAnnotations.filter((annotation) => !annotation.generatedPageId && annotation.pageNumber === pageNumber);
          const key = getPageSaveKey(documentId, pageNumber);

          const content = serializeNotePageContent({
            inkStrokes: pageInkStrokes,
            textAnnotations: pageTextAnnotations,
          });
          const savedContent = lastSavedPageContentRef.current[key];
          if (savedContent === undefined && content === EMPTY_PAGE_CONTENT) {
            lastSavedPageContentRef.current[key] = content;
            lastQueuedPageContentRef.current[key] = content;
            return;
          }
          if (savedContent === content) {
            lastQueuedPageContentRef.current[key] = content;
            clearedSaveKeys.add(key);
            return;
          }
          if (lastQueuedPageContentRef.current[key] === content) return;
          lastQueuedPageContentRef.current[key] = content;

          nextPendingSaves[key] = {
            pageId,
            documentId,
            pageNumber,
            content,
            attempts: 0,
            updatedAt: Date.now(),
          };
        });
      });

      if (!Object.keys(nextPendingSaves).length && !clearedSaveKeys.size) return;

      setPendingPageSaves((current) => {
        let next = current;
        if (clearedSaveKeys.size) {
          next = { ...next };
          clearedSaveKeys.forEach((key) => {
            delete next[key];
          });
        }
        return {
          ...next,
          ...nextPendingSaves,
        };
      });
    }, 700);

    return () => clearTimeout(timer);
  }, [backendPageIdsByDocument, inkByDocument, textAnnotationsByDocument, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated || !isBackendApiEnabled()) return;

    const now = Date.now();
    const saveEntries = Object.entries(pendingPageSaves).filter(([key, pending]) => {
      if (savingPageKeys[key]) return false;
      if (pending.attempts === 0) return true;
      return now - pending.updatedAt >= Math.min(15000, 2500 * pending.attempts);
    });
    if (!saveEntries.length) return;

    saveEntries.forEach(([key, pending]) => {
      setSavingPageKeys((current) => ({ ...current, [key]: true }));
      void updateBackendNotePage({
        pageId: pending.pageId,
        content: pending.content,
      })
        .then(() => {
          lastSavedPageContentRef.current[key] = pending.content;
          lastQueuedPageContentRef.current[key] = pending.content;
          setPendingPageSaves((current) => {
            const currentPending = current[key];
            if (!currentPending || currentPending.content !== pending.content) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
          setFailedPageSaveKeys((current) => {
            if (!current[key]) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
        })
        .catch(() => {
          lastQueuedPageContentRef.current[key] = '';
          setPendingPageSaves((current) => {
            const currentPending = current[key];
            if (!currentPending || currentPending.content !== pending.content) return current;
            return {
              ...current,
              [key]: {
                ...currentPending,
                attempts: currentPending.attempts + 1,
                updatedAt: Date.now(),
              },
            };
          });
          setFailedPageSaveKeys((current) => ({ ...current, [key]: true }));
        })
        .finally(() => {
          setSavingPageKeys((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          });
        });
    });
  }, [pendingPageSaves, savingPageKeys, workspaceHydrated]);

  useEffect(() => {
    if (!Object.keys(failedPageSaveKeys).length) return;
    const timer = setTimeout(() => {
      setFailedPageSaveKeys({});
      setPendingPageSaves((current) => ({ ...current }));
    }, 3500);
    return () => clearTimeout(timer);
  }, [failedPageSaveKeys]);

  useEffect(() => {
    const now = Date.now();
    const retryDelays = Object.entries(pendingPageSaves)
      .filter(([key, pending]) => pending.attempts > 0 && !savingPageKeys[key])
      .map(([, pending]) => Math.max(0, Math.min(15000, 2500 * pending.attempts) - (now - pending.updatedAt)));
    if (!retryDelays.length) return;

    const timer = setTimeout(() => {
      setPendingPageSaves((current) => ({ ...current }));
    }, Math.min(...retryDelays));
    return () => clearTimeout(timer);
  }, [pendingPageSaves, savingPageKeys]);

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
    setViewingAiChatSessionId(null);
    setChatSessionByDocument((current) => {
      const next = { ...current };
      const lastSessionId = lastChatSessionByDocument[id];
      if (lastSessionId) next[id] = lastSessionId;
      else delete next[id];
      return next;
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
    const target = visibleNotes.find((value) => value.id === id);
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
    const isBackendDocument = isBackendApiEnabled() && Boolean(backendPageIdsByDocument[id]);

    confirmDeleteAction({
      title: 'Note 삭제',
      message: isBackendDocument
        ? `"${target.title}" Note 문서와 이 문서에 남긴 필기를 백엔드에서도 삭제할까요?`
        : `"${target.title}" Note 문서와 이 문서에 남긴 필기를 삭제할까요?`,
      confirmText: '삭제',
      onConfirm: () => {
        if (isBackendDocument) {
          void deleteBackendNote(id)
            .then(() => {
              setUserStudyDocuments((current) => current.filter((document) => document.id !== id));
              setBackendPageIdsByDocument((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setInkByDocument((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setRedoInkByDocument((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setTextAnnotationsByDocument((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setBookmarksByDocument((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setAttachmentsByDocument((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setGeneratedPagesByDocument((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setCurrentPdfPageByDocument((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setActivePageByDocument((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setChatSessionByDocument((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setLastChatSessionByDocument((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setChatSessionsByDocument((current) => {
                const next = { ...current };
                delete next[id];
                return next;
              });
              setAllChatSessions((current) => current.filter((session) => session.note_id !== id));

              if (studyDocumentId === id) {
                setStudyDocumentId(null);
                setInkTool('view');
                setAiPanelOpen(false);
                setIncomingAssetSuggestion(null);
                setAiAnswer(null);
                setAiError(null);
                setAiLoading(false);
              }
              setWorkspaceFeedback('Note 문서를 백엔드에서 삭제했습니다.');
            })
            .catch(() => {
              setWorkspaceFeedback('백엔드 노트 삭제에 실패했습니다. 다시 시도해주세요.');
            });
          return;
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
    const isBackendDocument = isBackendApiEnabled() && Boolean(backendPageIdsByDocument[id]);

    if (isBackendDocument) {
      void updateBackendNote({ noteId: id, title: nextTitle })
        .then((updated) => {
          setUserStudyDocuments((current) => upsertStudyDocument(current, {
            ...target,
            title: updated.title,
            preview: updated.summary ?? target.preview,
            updatedAt: 'DB 저장됨',
          }));
          setWorkspaceFeedback('문서 제목을 백엔드에 저장했습니다.');
        })
        .catch(() => {
          setWorkspaceFeedback('노트 제목 저장에 실패했습니다. backend 연결을 확인해주세요.');
        });
      return true;
    }

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
      const localPdfFileUri = Platform.OS === 'web' && picked.base64 ? picked.base64 : picked.uri;
      setWorkspaceFeedback('PDF 원본과 첫 페이지 썸네일을 저장하는 중입니다.');

      if (isBackendApiEnabled()) {
        try {
          const folder = await ensureFolderForSubject({ name: targetSubject.name, color: targetSubject.color });
          const result = await uploadBackendPdfNote({
            file: {
              uri: picked.uri,
              name: picked.name || `${targetSubject.name} PDF`,
              type: picked.mimeType || 'application/pdf',
            },
            folderId: folder.id,
            title: picked.name || `${targetSubject.name} PDF`,
            summary: '업로드한 PDF 문서',
          });
          const pagesByNumber = Object.fromEntries(
            result.pages.map((page) => [page.page_number, page.id]),
          );
          setBackendPageIdsByDocument((current) => ({
            ...current,
            [result.note.id]: pagesByNumber,
          }));
          void buildPdfDataUriForTextExtraction(picked, localPdfFileUri)
            .then((pdfData) => {
              if (!pdfData) return null;
              return extractBackendPdfText({
                noteId: result.note.id,
                pdfData,
              });
            })
            .then((textResult) => {
              if (!textResult) return;
              const pagesByNumber = textResult.pages.reduce<Record<number, number>>((next, page) => {
                next[page.page_number] = page.id;
                return next;
              }, {});
              setBackendPageIdsByDocument((current) => ({
                ...current,
                [result.note.id]: {
                  ...(current[result.note.id] ?? {}),
                  ...pagesByNumber,
                },
              }));
              setUserStudyDocuments((current) => current.map((item) => (
                item.id === result.note.id
                  ? { ...item, pageCount: Math.max(item.pageCount, textResult.pages_extracted) }
                  : item
              )));
            })
            .catch(() => {
              setWorkspaceFeedback('PDF text extraction failed.');
            });
          const document: StudyDocumentEntry = {
            id: result.note.id,
            subjectId: targetSubjectId,
            title: result.note.title,
            type: 'pdf',
            updatedAt: '방금 전',
            pageCount: Math.max(1, result.note.page_count ?? result.upload.page_count),
            preview: result.note.summary ?? '업로드한 PDF 문서입니다.',
            file: { uri: result.note.file_url ?? result.upload.url },
            thumbnailUrl: result.note.thumbnail_url ?? result.upload.thumbnail_url ?? undefined,
          };
          openCreatedStudyDocument(document, `${document.pageCount}페이지 PDF를 백엔드에 저장했습니다.`);
          return;
        } catch (error) {
          setWorkspaceFeedback(
            error instanceof BackendApiError && error.detail
              ? error.detail
              : '백엔드 저장에 실패해 이 기기에만 PDF를 추가했습니다.',
          );
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
        file: { uri: localPdfFileUri },
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
    setLinePattern(pattern);
    setInkTool((current) => (current !== 'pen' && current !== 'highlight' && !isShapeTool(current) ? 'pen' : current));
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

  const resolveAssetUri = (asset: CaptureAsset) => {
    const uri = asset.fileUrl ?? asset.thumbnailUrl ?? asset.previewImageKey;
    return (
      uri?.startsWith('http://') ||
      uri?.startsWith('https://') ||
      uri?.startsWith('file://') ||
      uri?.startsWith('data:image/') ||
      uri?.startsWith('data:application/pdf')
        ? uri
        : null
    );
  };

  const createImageNoteFromAsset = async (asset: CaptureAsset) => {
    if (asset.type !== 'image') return false;
    const imageUrl = resolveAssetUri(asset);
    if (!imageUrl) {
      setWorkspaceFeedback('이미지 파일 URL을 찾지 못했습니다.');
      return false;
    }

    const targetSubject = availableSubjects.find((value) => value.id === asset.subjectId)
      ?? subject
      ?? availableSubjects[0]
      ?? null;
    if (!targetSubject) return false;

    if (isBackendApiEnabled()) {
      try {
        const folder = await ensureFolderForSubject({ name: targetSubject.name, color: targetSubject.color });
        const backendNote = await createBackendNote({
          folderId: folder.id,
          title: asset.title,
          summary: asset.summary,
        });
        const backendPage = await createBackendNotePage({
          noteId: backendNote.id,
          pageNumber: 1,
          content: serializeNotePageContent({ inkStrokes: [], textAnnotations: [] }),
          imageUrl,
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
          subjectId: targetSubject.id,
          title: backendNote.title,
          type: 'image',
          updatedAt: '방금 전',
          pageCount: 1,
          preview: backendNote.summary ?? '이미지로 만든 노트입니다.',
          file: { uri: imageUrl },
        };
        openCreatedStudyDocument(document, '이미지를 새 노트 페이지로 저장했습니다.');
        updateAssetStatus(asset.id, 'accepted');
        return true;
      } catch (error) {
        setWorkspaceFeedback(
          error instanceof BackendApiError && error.detail
            ? error.detail
            : '이미지 노트 저장에 실패했습니다.',
        );
        return false;
      }
    }

    const document: StudyDocumentEntry = {
      id: Date.now(),
      subjectId: targetSubject.id,
      title: asset.title,
      type: 'image',
      updatedAt: '방금 전',
      pageCount: 1,
      preview: asset.summary,
      file: { uri: imageUrl },
    };
    openCreatedStudyDocument(document, '이미지를 새 노트로 만들었습니다.');
    updateAssetStatus(asset.id, 'accepted');
    return true;
  };

  const persistAssetForCurrentDocument = async (asset: CaptureAsset) => {
    if (!studyDocumentId || !isBackendApiEnabled() || !backendPageIdsByDocument[studyDocumentId]) return;
    const assetUrl = resolveAssetUri(asset);
    if (!assetUrl) return;

    const existingPageNumbers = Object.keys(backendPageIdsByDocument[studyDocumentId]).map(Number).filter(Number.isFinite);
    const nextPageNumber = Math.max(0, ...existingPageNumbers) + 1;
    try {
      const backendPage = await createBackendNotePage({
        noteId: studyDocumentId,
        pageNumber: nextPageNumber,
        content: serializeNotePageContent({ inkStrokes: [], textAnnotations: [] }),
        imageUrl: assetUrl,
      });
      setBackendPageIdsByDocument((current) => ({
        ...current,
        [studyDocumentId]: {
          ...(current[studyDocumentId] ?? {}),
          [backendPage.page_number]: backendPage.id,
        },
      }));
    } catch {
      setWorkspaceFeedback('이미지 페이지 저장에 실패했습니다. backend 연결을 확인해주세요.');
    }
  };

  const insertAssetIntoWorkspace = async (asset: CaptureAsset) => {
    if (!studyDocumentId) {
      await createImageNoteFromAsset(asset);
      return;
    }

    if (asset.type === 'image') {
      void persistAssetForCurrentDocument(asset);
    }

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
      fileUrl: asset.fileUrl,
      thumbnailUrl: asset.thumbnailUrl,
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
    setWorkspaceFeedback(asset.type === 'image' ? '이미지를 백엔드 페이지로 저장하고 정리본을 생성하고 있습니다.' : '다음 페이지 정리본을 생성하고 있습니다.');

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

  const getReferencePageLabel = (page: DocumentPageView) => getDocumentPageLabel({
    page,
    pages: currentDocumentPages,
    memoPages,
    pdfSuffix: '페이지',
  });

  const linkCaptureAssetToCurrentPage = async (asset: CaptureAsset) => {
    if (!studyDocumentId || !studyDocument) {
      await createImageNoteFromAsset(asset);
      return;
    }

    const page = currentDocumentPage ?? { kind: 'pdf' as const, pageNumber: currentPdfPage };
    const pageLabel = getReferencePageLabel(page);
    const existingReferences = pageCaptureReferencesByDocument[studyDocumentId] ?? [];
    const alreadyLinked = existingReferences.some((reference) => reference.assetId === asset.id && isSameDocumentPage(reference.page, page));

    if (alreadyLinked) {
      updateAssetStatus(asset.id, 'accepted');
      setIncomingAssetSuggestion((current) => (current?.id === asset.id ? null : current));
      setIncomingBannerQueue((current) => current.filter((value) => value.id !== asset.id));
      setWorkspaceFeedback(`${pageLabel}에 이미 연결된 자료입니다.`);
      return;
    }

    const reference = buildPageCaptureReference({
      asset,
      documentId: studyDocumentId,
      page,
      pageLabel,
      subjects: availableSubjects,
    });

    setPageCaptureReferencesByDocument((current) => ({
      ...current,
      [studyDocumentId]: [reference, ...(current[studyDocumentId] ?? [])],
    }));
    updateAssetStatus(asset.id, 'accepted');
    setIncomingAssetSuggestion((current) => (current?.id === asset.id ? null : current));
    setIncomingBannerQueue((current) => current.filter((value) => value.id !== asset.id));
    setWorkspaceFeedback(`${pageLabel}에 ${asset.type === 'image' ? '사진' : 'PDF'} 자료를 연결했습니다.`);
  };

  const openPageCaptureReference = (referenceId: string) => {
    if (!studyDocumentId) return;
    const reference = (pageCaptureReferencesByDocument[studyDocumentId] ?? []).find((value) => value.id === referenceId);
    if (!reference) return;

    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: reference.page,
    }));
    if (reference.page.kind === 'pdf') {
      const pageNumber = reference.page.pageNumber;
      setCurrentPdfPageByDocument((current) => ({
        ...current,
        [studyDocumentId]: pageNumber,
      }));
    }
    setWorkspaceFeedback(`${reference.pageLabel}로 이동했습니다.`);
  };

  const movePageCaptureReference = (referenceId: string, delta: -1 | 1) => {
    if (!studyDocumentId || !studyDocument) return;
    const maxPage = Math.max(1, studyDocument.pageCount);

    setPageCaptureReferencesByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).map((reference) => {
        if (reference.id !== referenceId) return reference;
        const basePage = reference.page.kind === 'pdf' ? reference.page.pageNumber : currentPdfPage;
        const nextPageNumber = Math.min(maxPage, Math.max(1, basePage + delta));
        const nextPage: DocumentPageView = { kind: 'pdf', pageNumber: nextPageNumber };
        return {
          ...reference,
          page: nextPage,
          pageLabel: getReferencePageLabel(nextPage),
        };
      }),
    }));
    setWorkspaceFeedback('자료 연결 위치를 이동했습니다.');
  };

  const removePageCaptureReference = (referenceId: string) => {
    if (!studyDocumentId) return;
    setPageCaptureReferencesByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).filter((reference) => reference.id !== referenceId),
    }));
    setWorkspaceFeedback('페이지에서 사진 자료 연결을 제거했습니다.');
  };

  const buildPageCaptureReferenceQuestion = (reference: PageCaptureReference) => (
    [
      `${reference.pageLabel}에 연결한 자료 "${reference.title}"를 수업 맥락에 맞춰 설명해줘.`,
      `자료 설명: ${reference.aiSummary || reference.summary}`,
      reference.keywords.length ? `키워드: ${reference.keywords.join(', ')}` : '',
      '핵심 개념, 시험 포인트, 원본 PDF 페이지와 연결해서 볼 부분을 정리해줘.',
    ].filter(Boolean).join('\n')
  );

  const prepareAiQuestionForPageCaptureReference = (referenceId: string) => {
    if (!studyDocumentId) return;
    const reference = (pageCaptureReferencesByDocument[studyDocumentId] ?? []).find((value) => value.id === referenceId);
    if (!reference) return;

    setAiQuestion(buildPageCaptureReferenceQuestion(reference));
    setAiPanelOpen(true);
    setViewingAiChatSessionId(null);
    setWorkspaceFeedback('AI 질문창에 연결 자료 맥락을 넣었습니다.');
  };

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
    onRequestCanvasEditFromChat: aiCanvas.requestAiEditFromChat,
  });

  const askAiAboutPageCaptureReference = (referenceId: string) => {
    if (!studyDocumentId) return;
    const reference = (pageCaptureReferencesByDocument[studyDocumentId] ?? []).find((value) => value.id === referenceId);
    if (!reference) return;
    if (!isBackendApiEnabled() || !currentDocumentHasBackendPages) {
      prepareAiQuestionForPageCaptureReference(referenceId);
      return;
    }

    const question = buildPageCaptureReferenceQuestion(reference);
    setAiPanelOpen(true);
    setViewingAiChatSessionId(null);
    void requestAiAnswerForQuestion(question, {
      pageNumber: reference.page.kind === 'pdf' ? reference.page.pageNumber : currentPdfPage,
      selectionImageUri: null,
    });
    setWorkspaceFeedback('연결 자료로 AI 채팅을 시작했습니다.');
  };

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
    const asset = captureInbox.find((value) => value.id === assetId);
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
  const failedPageSaveCount = Object.keys(failedPageSaveKeys).length;
  const pendingPageSaveCount = Object.keys(pendingPageSaves).length;
  const savingPageCount = Object.keys(savingPageKeys).length;
  const pageSaveFeedback = failedPageSaveCount ? `필기 저장 실패 ${failedPageSaveCount}건 · 자동 재시도 중` : null;
  const effectiveWorkspaceFeedback = workspaceFeedback ?? pageSaveFeedback;
  const documentSaveStatus = failedPageSaveCount
    ? `저장 실패 ${failedPageSaveCount} · 재시도 중`
    : savingPageCount
      ? `저장 중 ${savingPageCount}`
      : pendingPageSaveCount
        ? `저장 대기 ${pendingPageSaveCount}`
        : workspaceHydrated
          ? '저장됨'
          : '저장 준비 중';

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
    brushType,
    linePattern,
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
    changeBrushSettings,
    toggleAiPanel: () => setAiPanelOpen((current) => {
      const next = !current;
      if (next) setViewingAiChatSessionId(null);
      return next;
    }),
    setAiPanelMode,
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
    openPageCaptureReference,
    movePageCaptureReference,
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
    toggleSort: () => setSort((current) => (current === 'latest' ? 'oldest' : 'latest')),
  };
}
