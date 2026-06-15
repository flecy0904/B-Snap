import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import {
  analyzeBackendNoteHandwriting,
  analyzeBackendNotePageHandwriting,
  BackendApiError,
  getBackendClassInsight,
  isBackendApiEnabled,
  listAllBackendChatSessions,
  listBackendChatMessages,
  listBackendChatSessions,
  listBackendAiCanvasNotes,
  listBackendAiCanvasNotesByFolder,
  listBackendFolders,
  listBackendNotePages,
  listBackendNotes,
  persistBackendNotePageHandwritingRecognition,
  updateBackendChatSession,
  type BackendAiCanvasNoteSummary,
  type BackendClassInsight,
  type BackendChatSession,
  type BackendChatMessage,
  type BackendHandwritingRecognitionWrite,
  type BackendNotePage,
  type BackendRagScope,
  type BackendRagScopeSource,
} from '../../services/backend-api';
import {
  ensureKoreanHandwritingModel,
  getHandwritingRecognitionAvailability,
  recognizeKoreanHandwritingByClusters,
  type HandwritingRecognitionResult,
  type MlKitHandwritingDebugState,
} from '../../services/handwriting-recognition';
import type { PencilInteractionEvent } from '../../services/pencil-interaction';
import {
  type AiFloatingPanelSize,
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
import { isCanvasCreateRequest } from './ai-canvas/canvas-command-intent';
import { useAiCanvasNotes } from './ai-canvas/use-ai-canvas-notes';
import {
  buildClassInsightContext,
  buildImportantPageRecommendations,
  extractRecommendedPageNumbersFromText,
  isClassInsightQuestion,
  isClassInsightTargetDocument,
} from './class-insight';
import { getStudyDocumentBackendNoteId } from './document/backend-sync';
import { parseNotePageContent, type HandwritingRecognitionState } from './document/note-page-content';
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
import type { InkBrush, InkBrushSettings, InkEraserMode, InkImageAnnotation, InkLinePattern, InkPoint, InkSelectionMode, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../ui-types';
import type { AiCanvasBlockContext, AiCanvasRecommendationMode } from '../../types/ai-canvas';
import type { AiAnswer, BookmarkedPage, CaptureAsset, DocumentPageView, GeneratedWorkspacePage, NoteWorkspaceMode, PageCaptureReference, StudyDocumentEntry, Subject, WorkspaceAttachment } from '../../types';

export type WorkspaceFocusTarget = 'document' | 'aiCanvas';
export type AppRightSidebarPanel = 'chat' | 'canvas' | null;
export type AppChatMode = 'sidebar' | 'floating';
export type AppSidebarPosition = 'left' | 'right';
export type StudyInteractionMode = 'edit' | 'read';
export type { AiFloatingPanelSize };
export type { MlKitHandwritingDebugState };
export type HandwritingDebugReadiness = {
  platform: string;
  backendUrlPresent: boolean;
  workspaceHydrated: boolean;
  backendApiEnabled: boolean;
  studyDocumentId: number | null;
  backendNoteId: number | null;
  currentDocumentHasBackendPages: boolean;
  pageNumber: number | null;
  pageId: number | null;
  backendPageCount: number;
  pendingPageSaveCount: number;
  savingPageCount: number;
  failedPageSaveCount: number;
  handwritingSaveState: 'idle' | 'pending' | 'success' | 'failed';
  handwritingPersisted: boolean | null;
  lastHandwritingSaveError: string | null;
  lastHandwritingSaveAt: number | null;
  canAnalyze: boolean;
};

const DEFAULT_AI_FLOATING_PANEL_SIZE: AiFloatingPanelSize = { width: 380, height: 620 };
const DEFAULT_AI_PANEL_MODE: 'floating' | 'sidebar' = Platform.OS === 'web' ? 'sidebar' : 'floating';
const DEFAULT_AI_CHAT_MODEL_ID = 'gpt-4.1-mini';
const AI_CHAT_MODEL_IDS = new Set(['gpt-4.1-mini', 'gemini-3.1-pro', 'gpt-5.2', 'gpt-5.4', 'gpt-5.5']);
const HANDWRITING_AUTO_ANALYZE_ENABLED = process.env.EXPO_PUBLIC_ENABLE_HANDWRITING_AUTO_ANALYZE === 'true';
const HANDWRITING_AUTO_VISION_FALLBACK_ENABLED = process.env.EXPO_PUBLIC_ENABLE_HANDWRITING_AUTO_VISION === 'true';

function buildMlKitRecognitionWritePayload(
  result: HandwritingRecognitionResult,
  pageNumber: number,
  strokeHash?: string | null,
): BackendHandwritingRecognitionWrite {
  return {
    stroke_hash: strokeHash || undefined,
    engine: result.engine || 'mlkit-digital-ink',
    text: result.text || '',
    keywords: result.keywords ?? [],
    symbols: result.symbols ?? [],
    confidence: result.confidence ?? 0,
    clusters: (result.clusters ?? []).map((cluster, index) => ({
      id: cluster.id || `mlkit-cluster-${index + 1}`,
      pageNumber: cluster.pageNumber || pageNumber,
      bbox: cluster.bbox,
      text: cluster.text || '',
      candidates: cluster.candidates ?? [],
      keywords: cluster.keywords ?? [],
      symbols: cluster.symbols ?? [],
      confidence: cluster.confidence ?? result.confidence ?? 0,
      source: cluster.source || 'mlkit-digital-ink',
    })),
  };
}

function formatVisionSkipReason(reason?: string | null) {
  switch (reason) {
    case 'disabled':
      return 'fallback-disabled';
    case 'missing-api-key':
      return 'missing-api-key';
    case 'cluster-limit':
      return 'cluster-limit-exceeded';
    case 'page-limit':
      return 'note-page-limit-exceeded';
    case 'not-requested':
      return 'not-requested';
    case 'not-needed':
      return 'not-needed';
    case 'no-eligible-clusters':
      return 'no-eligible-clusters';
    case 'no-renderable-clusters':
      return 'no-renderable-clusters';
    case 'no-star-anchor':
      return 'no-star-anchor';
    case 'no-star-text-anchor':
      return 'no-star-text-anchor';
    case 'no-auxiliary-text-anchor':
      return 'no-auxiliary-text-anchor';
    case 'unavailable':
      return 'unavailable';
    case 'failed':
      return 'failed';
    default:
      return reason || 'unknown';
  }
}

function formatHandwritingAnalysisFeedback(
  pageNumber: number,
  recognition: HandwritingRecognitionState | null,
  options?: { force?: boolean; useVisionFallback?: boolean },
  previousStrokeHash?: string | null,
) {
  const sameStrokeHash = Boolean(
    previousStrokeHash
    && recognition?.strokeHash
    && previousStrokeHash === recognition.strokeHash
    && !options?.force
    && !options?.useVisionFallback,
  );
  if (sameStrokeHash) {
    return `${pageNumber}페이지 손필기 변경 없음(same-stroke-hash). 기존 분석을 유지했고 class insight는 그대로 둡니다.`;
  }
  if (options?.useVisionFallback) {
    if (recognition?.visionFallbackUsed) {
      return `${pageNumber}페이지 Vision fallback 결과를 저장했고 class insight를 새로고침했어요.`;
    }
    return `${pageNumber}페이지 Vision fallback skipped: ${formatVisionSkipReason(recognition?.visionFallbackSkippedReason)}. geometry 분석 결과는 저장했어요.`;
  }
  if (options?.force) {
    return `${pageNumber}페이지 force 재분석을 저장했고 class insight를 새로고침했어요.`;
  }
  return `${pageNumber}페이지 geometry 손필기 분석을 저장했고 class insight를 새로고침했어요.`;
}

function formatMlKitUnavailableFeedback(detail?: string) {
  const normalized = (detail ?? '').toLowerCase();
  if (Platform.OS === 'web' || normalized.includes('web fallback')) {
    return '웹에서는 ML Kit native module이 없어 unavailable이 정상입니다. geometry/Vision debug flow를 사용하세요.';
  }
  if (Platform.OS === 'android' || normalized.includes('android')) {
    return 'Android ML Kit bridge는 아직 연결하지 않았어요. Android에서는 저장된 inkStrokes를 백엔드 geometry/Vision 경로로 분석합니다.';
  }
  if (normalized.includes('download is in progress') || normalized.includes('downloading')) {
    return 'ML Kit 한국어 모델을 다운로드 중입니다. 완료 후 다시 실행해주세요.';
  }
  if (normalized === 'failed' || (normalized.includes('download') && normalized.includes('failed'))) {
    return 'ML Kit 한국어 모델 다운로드에 실패했어요. 모델 준비를 다시 실행해주세요.';
  }
  if (normalized === 'missing' || normalized.includes('model is missing') || normalized.includes('ensurekoreanmodel')) {
    return 'ML Kit 한국어 모델이 아직 없습니다. 먼저 한국어 모델 준비를 실행하세요.';
  }
  if (normalized.includes('native module unavailable')) {
    return 'ML Kit native module을 찾지 못했어요. iOS dev build에서는 모듈 연결을, Web/Android에서는 백엔드 분석 경로를 확인해주세요.';
  }
  return `ML Kit unavailable: ${detail ?? 'unknown'}`;
}

function normalizeAiFloatingPanelSize(size?: AiFloatingPanelSize | null): AiFloatingPanelSize {
  const width = Number.isFinite(size?.width) ? Math.round(size!.width) : DEFAULT_AI_FLOATING_PANEL_SIZE.width;
  const height = Number.isFinite(size?.height) ? Math.round(size!.height) : DEFAULT_AI_FLOATING_PANEL_SIZE.height;
  return {
    width: Math.max(300, Math.min(640, width)),
    height: Math.max(360, Math.min(760, height)),
  };
}

function normalizeAiChatModelId(modelId?: string | null) {
  return modelId && AI_CHAT_MODEL_IDS.has(modelId) ? modelId : DEFAULT_AI_CHAT_MODEL_ID;
}

function isTransientWebFileUri(uri: string | null | undefined) {
  if (typeof uri !== 'string') return false;
  const normalizedUri = uri.toLowerCase();
  return normalizedUri.startsWith('blob:') || normalizedUri.startsWith('data:application/pdf');
}

function getRagScopeSourceKey(source: Pick<BackendRagScopeSource, 'id' | 'type'>) {
  return `${source.type}:${source.id}`;
}

function buildRagScope(sources: BackendRagScopeSource[]): BackendRagScope {
  const nextSources: BackendRagScopeSource[] = [];
  const seen = new Set<string>();
  sources.forEach((source) => {
    const key = getRagScopeSourceKey(source);
    if (seen.has(key)) return;
    seen.add(key);
    nextSources.push(source);
  });
  return {
    sourceIds: nextSources.map(getRagScopeSourceKey),
    sources: nextSources,
  };
}

function buildDefaultRagScope(document: StudyDocumentEntry | null): BackendRagScope | null {
  const backendNoteId = getStudyDocumentBackendNoteId(document);
  if (!backendNoteId || !document) return null;
  return buildRagScope([{ id: String(backendNoteId), type: 'note', title: document.title }]);
}

function getValidRagScope(scope: BackendRagScope | null | undefined): BackendRagScope | null {
  return Array.isArray(scope?.sources) ? scope : null;
}

function getStudyDocumentBackendFolderId(document: StudyDocumentEntry | null | undefined) {
  return typeof document?.backendFolderId === 'number' ? document.backendFolderId : null;
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
  const [aiPanelMode, setAiPanelMode] = useState<'floating' | 'sidebar'>(DEFAULT_AI_PANEL_MODE);
  const [appRightSidebarPanel, setAppRightSidebarPanel] = useState<AppRightSidebarPanel>(null);
  const [appChatMode, setAppChatMode] = useState<AppChatMode>('sidebar');
  const [appRightSidebarWidth, setAppRightSidebarWidth] = useState(380);
  const [aiFloatingPanelSize, setAiFloatingPanelSize] = useState<AiFloatingPanelSize>(DEFAULT_AI_FLOATING_PANEL_SIZE);
  const [appSidebarPosition, setAppSidebarPosition] = useState<AppSidebarPosition>('right');
  const [studyInteractionMode, setStudyInteractionMode] = useState<StudyInteractionMode>('edit');
  const [chatSidebarOpenByDocument, setChatSidebarOpenByDocument] = useState<Record<number, boolean>>({});
  const lastEditingInkToolRef = useRef<InkTool>('pen');
  const [focusedWorkspaceTarget, setFocusedWorkspaceTarget] = useState<WorkspaceFocusTarget | null>(null);
  const [workspaceActionHistory, setWorkspaceActionHistory] = useState<WorkspaceFocusTarget[]>([]);
  const [workspaceRedoActionHistory, setWorkspaceRedoActionHistory] = useState<WorkspaceFocusTarget[]>([]);
  const previousStudyDocumentIdRef = useRef<number | null>(null);
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
  const [aiCanvasRequestBusy, setAiCanvasRequestBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [selectionPreviewByDocument, setSelectionPreviewByDocument] = useState<Record<number, string | null>>({});
  const [selectionPreviewAttachedByDocument, setSelectionPreviewAttachedByDocument] = useState<Record<number, boolean>>({});
  const [chatSessionByDocument, setChatSessionByDocument] = useState<Record<number, number>>({});
  const [viewingAiChatSessionId, setViewingAiChatSessionId] = useState<number | null>(null);
  const [lastChatSessionByDocument, setLastChatSessionByDocument] = useState<Record<number, number>>({});
  const [chatSessionsByDocument, setChatSessionsByDocument] = useState<Record<number, BackendChatSession[]>>({});
  const [classInsightByDocument, setClassInsightByDocument] = useState<Record<number, BackendClassInsight | null>>({});
  const [handwritingRecognitionByDocument, setHandwritingRecognitionByDocument] = useState<Record<number, Record<number, HandwritingRecognitionState | null>>>({});
  const [handwritingAnalysisBusy, setHandwritingAnalysisBusy] = useState<'page' | 'note' | null>(null);
  const [handwritingPersistenceDebug, setHandwritingPersistenceDebug] = useState<{
    state: 'idle' | 'pending' | 'success' | 'failed';
    persisted: boolean | null;
    lastError: string | null;
    lastSavedAt: number | null;
  }>({
    state: 'idle',
    persisted: null,
    lastError: null,
    lastSavedAt: null,
  });
  const [mlKitHandwritingDebug, setMlKitHandwritingDebug] = useState<MlKitHandwritingDebugState>({
    available: null,
    modelReady: null,
    busy: false,
    result: null,
  });
  const [handwritingAutoAnalyzeQueue, setHandwritingAutoAnalyzeQueue] = useState<{
    documentId: number;
    pageNumber: number;
    requestId: number;
  }[]>([]);
  const classInsightFetchKeyRef = useRef<Record<number, string>>({});
  const classInsightRefreshTimerRef = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const handwritingAutoAnalyzeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [allChatSessions, setAllChatSessions] = useState<BackendChatSession[]>([]);
  const [selectedAiChatModelId, setSelectedAiChatModelId] = useState(DEFAULT_AI_CHAT_MODEL_ID);
  const [aiChatScope, setAiChatScope] = useState<'note' | 'all'>('note');
  const [aiChatSearchQuery, setAiChatSearchQuery] = useState('');
  const [aiMessagesBySession, setAiMessagesBySession] = useState<Record<number, BackendChatMessage[]>>({});
  const [draftAiRagScopeByDocument, setDraftAiRagScopeByDocument] = useState<Record<number, BackendRagScope | null>>({});
  const [aiRagScopeCollapsed, setAiRagScopeCollapsed] = useState(true);
  const [aiRagCanvasCandidates, setAiRagCanvasCandidates] = useState<BackendAiCanvasNoteSummary[]>([]);
  const [backendFolderIdBySubjectId, setBackendFolderIdBySubjectId] = useState<Record<number, number>>({});
  const [backendDocumentSyncing, setBackendDocumentSyncing] = useState(false);
  const backendDocumentSyncRequestIdRef = useRef(0);
  const workspaceMountedRef = useRef(true);
  useEffect(() => () => {
    workspaceMountedRef.current = false;
  }, []);
  const loadAllAiChatSessions = useCallback(() => {
    if (!isBackendApiEnabled()) return;

    listAllBackendChatSessions()
      .then((sessions) => {
        setAllChatSessions(sessions);
      })
      .catch((error) => {
        setAiError(getAiBackendErrorMessage(error, '서버에서 AI와의 대화 내역을 불러오지 못했어요. 네트워크 연결 상태를 확인 후 다시 시도해 주세요.'));
      });
  }, []);

  const changeAiChatScope = useCallback((scope: 'note' | 'all') => {
    setAiChatScope(scope);
    if (scope === 'all') loadAllAiChatSessions();
  }, [loadAllAiChatSessions]);
  const changeSelectedAiChatModel = useCallback((modelId: string) => {
    setSelectedAiChatModelId(normalizeAiChatModelId(modelId));
  }, []);

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
    setChatSidebarOpenByDocument(snapshot.chatSidebarOpenByDocument ?? {});
    setAiPanelMode(snapshot.aiPanelMode === 'sidebar' || snapshot.aiPanelMode === 'floating'
      ? snapshot.aiPanelMode
      : DEFAULT_AI_PANEL_MODE);
    setAiFloatingPanelSize(normalizeAiFloatingPanelSize(snapshot.aiFloatingPanelSize));
    setSelectedAiChatModelId(normalizeAiChatModelId(snapshot.selectedAiChatModelId));
    setAppSidebarPosition(snapshot.appSidebarPosition === 'left' ? 'left' : 'right');
    setStudyInteractionMode(snapshot.studyInteractionMode === 'read' ? 'read' : 'edit');
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
    chatSidebarOpenByDocument,
    aiPanelMode,
    aiFloatingPanelSize,
    selectedAiChatModelId,
    appSidebarPosition,
    studyInteractionMode,
  }), [
    activePageByDocument,
    aiFloatingPanelSize,
    aiPanelMode,
    appSidebarPosition,
    attachmentsByDocument,
    bookmarksByDocument,
    captureAssetsBySubject,
    chatSidebarOpenByDocument,
    currentPdfPageByDocument,
    deletedNoteIds,
    deletedStudyDocumentIds,
    generatedPagesByDocument,
    imageAnnotationsByDocument,
    inkByDocument,
    lastChatSessionByDocument,
    pageCaptureReferencesByDocument,
    selectedAiChatModelId,
    studyInteractionMode,
    textAnnotationsByDocument,
    userStudyDocuments,
  ]);
  const { workspaceHydrated, localPersistenceError } = useStudyWorkspacePersistence({
    state: persistedWorkspaceState,
    onHydrate: hydrateWorkspaceState,
  });
  const currentBackendFolderId = getStudyDocumentBackendFolderId(studyDocument) ?? (subject?.id ? backendFolderIdBySubjectId[subject.id] : undefined);
  useEffect(() => {
    if (!workspaceHydrated || !isBackendApiEnabled()) {
      setAiRagCanvasCandidates([]);
      return;
    }
    const backendNoteId = getStudyDocumentBackendNoteId(studyDocument);
    if (!currentBackendFolderId && !backendNoteId) {
      setAiRagCanvasCandidates([]);
      return;
    }
    let cancelled = false;
    const loadCanvasNotes = currentBackendFolderId
      ? listBackendAiCanvasNotesByFolder(currentBackendFolderId)
      : listBackendAiCanvasNotes(backendNoteId!);
    loadCanvasNotes
      .then((notes) => {
        if (!cancelled) setAiRagCanvasCandidates(notes);
      })
      .catch(() => {
        if (!cancelled) setAiRagCanvasCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentBackendFolderId, studyDocument, workspaceHydrated]);
  useEffect(() => {
    if (!workspaceHydrated) return;
    if (!studyDocumentId) {
      if (appRightSidebarPanel === 'chat') {
        setAppRightSidebarPanel(null);
        setAiPanelOpen(false);
      }
      return;
    }

    if (chatSidebarOpenByDocument[studyDocumentId]) {
      if (appChatMode !== 'sidebar') setAppChatMode('sidebar');
      if (appRightSidebarPanel !== 'chat') setAppRightSidebarPanel('chat');
      if (aiPanelMode !== 'sidebar') setAiPanelMode('sidebar');
      if (!aiPanelOpen) setAiPanelOpen(true);
      return;
    }

    if (appRightSidebarPanel === 'chat' && appChatMode === 'sidebar') {
      setAppRightSidebarPanel(null);
      if (aiPanelOpen) setAiPanelOpen(false);
    }
  }, [
    aiPanelMode,
    aiPanelOpen,
    appChatMode,
    appRightSidebarPanel,
    chatSidebarOpenByDocument,
    studyDocumentId,
    workspaceHydrated,
  ]);
  useEffect(() => {
    if (previousStudyDocumentIdRef.current === studyDocumentId) return;
    previousStudyDocumentIdRef.current = studyDocumentId;
    setWorkspaceActionHistory([]);
    setWorkspaceRedoActionHistory([]);
    setFocusedWorkspaceTarget(null);

    if (studyDocumentId === null) {
      setInkHistoryByDocument({});
      setRedoInkHistoryByDocument({});
      setRedoInkByDocument({});
    }
  }, [studyDocumentId]);
  const studyDocumentBackendNoteId = getStudyDocumentBackendNoteId(studyDocument);
  const scheduleClassInsightRefresh = useCallback((documentId: number) => {
    const existingTimer = classInsightRefreshTimerRef.current[documentId];
    if (existingTimer) clearTimeout(existingTimer);
    classInsightRefreshTimerRef.current[documentId] = setTimeout(() => {
      delete classInsightRefreshTimerRef.current[documentId];
      delete classInsightFetchKeyRef.current[documentId];
      setClassInsightByDocument((current) => ({ ...current, [documentId]: null }));
    }, 1200);
  }, []);
  const rememberHandwritingRecognitionFromPages = useCallback((documentId: number, pages: BackendNotePage[]) => {
    const nextByPage: Record<number, HandwritingRecognitionState | null> = {};
    pages.forEach((page) => {
      nextByPage[page.page_number] = parseNotePageContent(page.content)?.handwritingRecognition ?? null;
    });
    setHandwritingRecognitionByDocument((current) => ({
      ...current,
      [documentId]: {
        ...(current[documentId] ?? {}),
        ...nextByPage,
      },
    }));
  }, []);
  const rememberHandwritingRecognitionFromPage = useCallback((documentId: number, page: BackendNotePage) => {
    const recognition = parseNotePageContent(page.content)?.handwritingRecognition ?? null;
    setHandwritingRecognitionByDocument((current) => ({
      ...current,
      [documentId]: {
        ...(current[documentId] ?? {}),
        [page.page_number]: recognition,
      },
    }));
  }, []);
  const handlePageSaveSuccess = useCallback((documentId: number, pageNumber: number) => {
    scheduleClassInsightRefresh(documentId);
    if (!HANDWRITING_AUTO_ANALYZE_ENABLED) return;
    setHandwritingAutoAnalyzeQueue((current) => {
      const nextRequest = {
        documentId,
        pageNumber,
        requestId: Date.now() + Math.random(),
      };
      return [
        ...current.filter((request) => (
          request.documentId !== documentId || request.pageNumber !== pageNumber
        )),
        nextRequest,
      ];
    });
  }, [scheduleClassInsightRefresh]);

  useEffect(() => () => {
    Object.values(classInsightRefreshTimerRef.current).forEach((timer) => clearTimeout(timer));
    classInsightRefreshTimerRef.current = {};
    if (handwritingAutoAnalyzeTimerRef.current) {
      clearTimeout(handwritingAutoAnalyzeTimerRef.current);
      handwritingAutoAnalyzeTimerRef.current = null;
    }
  }, []);

  const {
    backendPageIdsByDocument,
    setBackendPageIdsByDocument,
    markBackendPageDirty,
    rememberSavedBackendNotePage,
    syncPdfDocumentToBackend,
    syncLocalDocumentsToBackend,
    flushBackendPageSaves,
    refreshBackendDocumentPages,
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
    bookmarksByDocument,
    pageCaptureReferencesByDocument,
    generatedPagesByDocument,
    setUserStudyDocuments,
    setInkByDocument,
    setTextAnnotationsByDocument,
    setImageAnnotationsByDocument,
    setWorkspaceFeedback,
    onPageSaveSuccess: handlePageSaveSuccess,
    onBackendPagesLoaded: rememberHandwritingRecognitionFromPages,
  });
  // Auto analysis intentionally uses only the backend geometry/star-gated Vision path.
  // ML Kit stays available from the debug controls, but is not part of the product flow.
  const runAutomaticHandwritingAnalysisForPage = useCallback(async (
    documentId: number,
    pageNumber: number,
    pageId: number,
  ) => {
    const page = await analyzeBackendNotePageHandwriting(pageId, {
      force: false,
      useVisionFallback: HANDWRITING_AUTO_VISION_FALLBACK_ENABLED,
    });
    rememberHandwritingRecognitionFromPage(documentId, page);
    rememberSavedBackendNotePage(documentId, page);
    scheduleClassInsightRefresh(documentId);
  }, [
    rememberHandwritingRecognitionFromPage,
    rememberSavedBackendNotePage,
    scheduleClassInsightRefresh,
  ]);
  useEffect(() => {
    if (!HANDWRITING_AUTO_ANALYZE_ENABLED || !handwritingAutoAnalyzeQueue.length) return undefined;
    const request = handwritingAutoAnalyzeQueue.find(({ documentId, pageNumber }) => (
      Boolean(backendPageIdsByDocument[documentId]?.[pageNumber])
    ));
    if (!request) return undefined;

    const { documentId, pageNumber, requestId } = request;
    const pageId = backendPageIdsByDocument[documentId]?.[pageNumber];
    if (!pageId) return undefined;

    if (handwritingAutoAnalyzeTimerRef.current) clearTimeout(handwritingAutoAnalyzeTimerRef.current);
    const removeRequest = () => {
      setHandwritingAutoAnalyzeQueue((current) => current.filter((item) => (
        item.documentId !== documentId
        || item.pageNumber !== pageNumber
        || item.requestId !== requestId
      )));
    };
    handwritingAutoAnalyzeTimerRef.current = setTimeout(() => {
      handwritingAutoAnalyzeTimerRef.current = null;
      runAutomaticHandwritingAnalysisForPage(documentId, pageNumber, pageId)
        .catch(() => {
          // Automatic analysis should never interrupt normal page save flow.
        })
        .finally(() => {
          removeRequest();
        });
    }, 2000);

    return () => {
      if (handwritingAutoAnalyzeTimerRef.current) {
        clearTimeout(handwritingAutoAnalyzeTimerRef.current);
        handwritingAutoAnalyzeTimerRef.current = null;
      }
    };
  }, [
    backendPageIdsByDocument,
    handwritingAutoAnalyzeQueue,
    runAutomaticHandwritingAnalysisForPage,
  ]);
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
  const activeAiChatSession = activeAiChatSessionId
    ? aiChatSessions.find((session) => session.id === activeAiChatSessionId)
      ?? allChatSessions.find((session) => session.id === activeAiChatSessionId)
      ?? null
    : null;
  const defaultAiRagScope = useMemo(() => buildDefaultRagScope(studyDocument), [studyDocument]);
  const activeAiRagScope = useMemo(() => {
    const sessionScope = getValidRagScope(activeAiChatSession?.ragScope);
    if (sessionScope) return sessionScope;
    if (studyDocumentId && Object.prototype.hasOwnProperty.call(draftAiRagScopeByDocument, studyDocumentId)) {
      return draftAiRagScopeByDocument[studyDocumentId] ?? buildRagScope([]);
    }
    return defaultAiRagScope;
  }, [activeAiChatSession?.ragScope, defaultAiRagScope, draftAiRagScopeByDocument, studyDocumentId]);
  const noteTitleByBackendId = useMemo(() => {
    const titles = new Map<string, string>();
    allStudyDocuments.forEach((document) => {
      const backendNoteId = getStudyDocumentBackendNoteId(document);
      if (backendNoteId) titles.set(String(backendNoteId), document.title);
    });
    return titles;
  }, [allStudyDocuments]);
  const aiRagReferenceCandidates = useMemo(() => {
    const isCurrentReferenceDocument = (document: StudyDocumentEntry) => {
      const documentBackendFolderId = getStudyDocumentBackendFolderId(document);
      if (currentBackendFolderId && documentBackendFolderId) return documentBackendFolderId === currentBackendFolderId;
      return document.subjectId === subject?.id;
    };
    const noteCandidates: BackendRagScopeSource[] = allStudyDocuments
      .filter(isCurrentReferenceDocument)
      .flatMap((document) => {
        const backendNoteId = getStudyDocumentBackendNoteId(document);
        if (!backendNoteId) return [];
        return [{ id: String(backendNoteId), type: 'note' as const, title: document.title }];
      });
    const canvasCandidates: BackendRagScopeSource[] = aiRagCanvasCandidates
      .filter((canvas) => !currentBackendFolderId || canvas.folder_id === currentBackendFolderId)
      .map((canvas) => ({
        id: String(canvas.id),
        type: 'canvas_note' as const,
        title: `${noteTitleByBackendId.get(String(canvas.note_id)) ?? '노트'} - ${canvas.title}`,
      }));
    return [...noteCandidates, ...canvasCandidates];
  }, [aiRagCanvasCandidates, allStudyDocuments, currentBackendFolderId, noteTitleByBackendId, subject?.id]);
  const syncRagScopeToSessions = useCallback((sessionId: number, scope: BackendRagScope | null) => {
    setChatSessionsByDocument((current) => {
      const next: Record<number, BackendChatSession[]> = {};
      Object.entries(current).forEach(([key, sessions]) => {
        next[Number(key)] = sessions.map((session) => (
          session.id === sessionId ? { ...session, ragScope: scope } : session
        ));
      });
      return next;
    });
    setAllChatSessions((current) => current.map((session) => (
      session.id === sessionId ? { ...session, ragScope: scope } : session
    )));
  }, []);
  const resetDraftAiRagScope = useCallback(() => {
    if (!studyDocumentId) return;
    setDraftAiRagScopeByDocument((current) => {
      const next = { ...current };
      delete next[studyDocumentId];
      return next;
    });
  }, [studyDocumentId]);
  const setActiveAiRagScope = useCallback((scope: BackendRagScope | null) => {
    if (!studyDocumentId) return;
    const nextScope = scope ?? buildRagScope([]);
    if (activeAiChatSessionId) {
      syncRagScopeToSessions(activeAiChatSessionId, nextScope);
      if (isBackendApiEnabled()) {
        void updateBackendChatSession({ sessionId: activeAiChatSessionId, ragScope: nextScope })
          .then((session) => syncRagScopeToSessions(session.id, session.ragScope ?? nextScope))
          .catch(() => setWorkspaceFeedback('참고 자료 저장에 실패했어요.'));
      }
    } else {
      setDraftAiRagScopeByDocument((current) => ({ ...current, [studyDocumentId]: nextScope }));
    }
  }, [activeAiChatSessionId, studyDocumentId, syncRagScopeToSessions, setWorkspaceFeedback]);
  const addAiRagScopeSource = useCallback((source: BackendRagScopeSource) => {
    setActiveAiRagScope(buildRagScope([...(activeAiRagScope?.sources ?? []), source]));
  }, [activeAiRagScope?.sources, setActiveAiRagScope]);
  const removeAiRagScopeSource = useCallback((sourceKey: string) => {
    const remainingSources = (activeAiRagScope?.sources ?? []).filter((source) => getRagScopeSourceKey(source) !== sourceKey);
    setActiveAiRagScope(buildRagScope(remainingSources));
  }, [activeAiRagScope?.sources, setActiveAiRagScope]);
  const recordWorkspaceActionTarget = useCallback((target: WorkspaceFocusTarget) => {
    setFocusedWorkspaceTarget(target);
    setWorkspaceActionHistory((current) => [...current, target].slice(-100));
    setWorkspaceRedoActionHistory([]);
  }, []);
  const currentAiCanvasPageNumber = currentDocumentPage?.kind === 'pdf' ? currentDocumentPage.pageNumber : currentPdfPage;
  const aiCanvas = useAiCanvasNotes({
    noteId: studyDocumentBackendNoteId,
    enabled: workspaceHydrated && isBackendApiEnabled() && !!studyDocumentBackendNoteId && currentDocumentHasBackendPages,
    currentPageNumber: currentAiCanvasPageNumber ?? null,
    onFeedback: setWorkspaceFeedback,
    onRecordWorkspaceAction: () => recordWorkspaceActionTarget('aiCanvas'),
  });
  const currentClassInsight = studyDocumentId ? classInsightByDocument[studyDocumentId] ?? null : null;
  const importantPageRecommendations = useMemo(() => buildImportantPageRecommendations({
    studyDocument,
    subject,
    classInsight: currentClassInsight,
    limit: 5,
  }), [
    currentClassInsight,
    studyDocument,
    subject,
  ]);
  const applyCanvasEditFromChat = useCallback((
    payload: Parameters<typeof aiCanvas.applyChatCanvasEdit>[0],
  ) => {
    aiCanvas.applyChatCanvasEdit(payload);
    if (studyDocumentId) {
      setChatSidebarOpenByDocument((current) => (
        current[studyDocumentId] === false
          ? current
          : { ...current, [studyDocumentId]: false }
      ));
    }
    if (appRightSidebarPanel === 'chat' && appChatMode === 'sidebar') {
      setAppChatMode('floating');
      setAiPanelMode('floating');
      setAiPanelOpen(true);
    }
    setAppRightSidebarPanel('canvas');
  }, [aiCanvas.applyChatCanvasEdit, appChatMode, appRightSidebarPanel, studyDocumentId]);
  const currentBackendNoteId = getStudyDocumentBackendNoteId(studyDocument);
  const currentHandwritingDebugPageNumber = currentDocumentPage?.kind === 'pdf'
    ? currentDocumentPage.pageNumber
    : currentDocumentPage?.kind === 'generated'
      ? null
      : currentPdfPage;
  const currentBackendPageIds = studyDocumentId
    ? backendPageIdsByDocument[studyDocumentId] ?? null
    : null;
  const currentHandwritingDebugPageId = studyDocumentId && currentHandwritingDebugPageNumber
    ? currentBackendPageIds?.[currentHandwritingDebugPageNumber] ?? null
    : null;
  const currentPageHandwritingRecognition = studyDocumentId && currentHandwritingDebugPageNumber
    ? handwritingRecognitionByDocument[studyDocumentId]?.[currentHandwritingDebugPageNumber] ?? null
    : null;
  const handwritingDebugBackendApiEnabled = isBackendApiEnabled();
  const handwritingDebugReadiness: HandwritingDebugReadiness = {
    platform: Platform.OS,
    backendUrlPresent: Boolean(process.env.EXPO_PUBLIC_BACKEND_URL?.trim()),
    workspaceHydrated,
    backendApiEnabled: handwritingDebugBackendApiEnabled,
    studyDocumentId: studyDocumentId ?? null,
    backendNoteId: currentBackendNoteId ?? null,
    currentDocumentHasBackendPages,
    pageNumber: currentHandwritingDebugPageNumber ?? null,
    pageId: currentHandwritingDebugPageId,
    backendPageCount: currentBackendPageIds ? Object.keys(currentBackendPageIds).length : 0,
    pendingPageSaveCount,
    savingPageCount,
    failedPageSaveCount,
    handwritingSaveState: handwritingPersistenceDebug.state,
    handwritingPersisted: handwritingPersistenceDebug.persisted,
    lastHandwritingSaveError: handwritingPersistenceDebug.lastError,
    lastHandwritingSaveAt: handwritingPersistenceDebug.lastSavedAt,
    canAnalyze: Boolean(
      workspaceHydrated
      && handwritingDebugBackendApiEnabled
      && studyDocumentId
      && currentBackendNoteId
      && currentDocumentHasBackendPages
      && currentHandwritingDebugPageNumber
      && currentHandwritingDebugPageId
      && !pendingPageSaveCount
      && !savingPageCount
    ),
  };
  const canAnalyzeCurrentPageHandwriting = handwritingDebugReadiness.canAnalyze;
  const analyzeCurrentPageHandwriting = useCallback(async (options?: { force?: boolean; useVisionFallback?: boolean }) => {
    if (!studyDocumentId || !currentBackendNoteId || !currentHandwritingDebugPageNumber) {
      setWorkspaceFeedback('분석할 PDF 페이지를 찾지 못했어요.');
      return;
    }
    if (pendingPageSaveCount || savingPageCount) {
      setWorkspaceFeedback('필기 저장이 끝난 뒤 손필기 분석을 다시 실행해주세요.');
      return;
    }
    const pageId = backendPageIdsByDocument[studyDocumentId]?.[currentHandwritingDebugPageNumber];
    if (!pageId) {
      setHandwritingPersistenceDebug({
        state: 'failed',
        persisted: false,
        lastError: 'no backend page id',
        lastSavedAt: null,
      });
      setWorkspaceFeedback('서버에 연결된 현재 페이지가 아직 준비되지 않았어요.');
      return;
    }

    setHandwritingAnalysisBusy('page');
    setHandwritingPersistenceDebug({
      state: 'pending',
      persisted: false,
      lastError: null,
      lastSavedAt: null,
    });
    try {
      const page = await analyzeBackendNotePageHandwriting(pageId, options);
      const recognition = parseNotePageContent(page.content)?.handwritingRecognition ?? null;
      rememberHandwritingRecognitionFromPage(studyDocumentId, page);
      rememberSavedBackendNotePage(studyDocumentId, page);
      scheduleClassInsightRefresh(studyDocumentId);
      setHandwritingPersistenceDebug({
        state: 'success',
        persisted: Boolean(recognition),
        lastError: recognition ? null : 'backend response did not include handwritingRecognition',
        lastSavedAt: Date.now(),
      });
      setWorkspaceFeedback(formatHandwritingAnalysisFeedback(
        page.page_number,
        recognition,
        options,
        currentPageHandwritingRecognition?.strokeHash,
      ));
    } catch (error) {
      const detail = error instanceof BackendApiError
        ? error.detail ?? error.message
        : error instanceof Error
          ? error.message
          : 'unknown error';
      setHandwritingPersistenceDebug({
        state: 'failed',
        persisted: false,
        lastError: detail,
        lastSavedAt: null,
      });
      setWorkspaceFeedback(`현재 페이지 손필기 분석에 실패했어요. ${detail}`);
    } finally {
      setHandwritingAnalysisBusy(null);
    }
  }, [
    backendPageIdsByDocument,
    currentBackendNoteId,
    currentHandwritingDebugPageNumber,
    currentPageHandwritingRecognition?.strokeHash,
    pendingPageSaveCount,
    rememberSavedBackendNotePage,
    rememberHandwritingRecognitionFromPage,
    savingPageCount,
    scheduleClassInsightRefresh,
    setWorkspaceFeedback,
    studyDocumentId,
  ]);
  const forceAnalyzeCurrentPageHandwriting = useCallback(() => analyzeCurrentPageHandwriting({ force: true }), [analyzeCurrentPageHandwriting]);
  const analyzeCurrentPageHandwritingWithVision = useCallback(() => (
    analyzeCurrentPageHandwriting({ force: true, useVisionFallback: true })
  ), [analyzeCurrentPageHandwriting]);
  const analyzeCurrentNoteHandwriting = useCallback(async (options?: { force?: boolean; useVisionFallback?: boolean }) => {
    if (!studyDocumentId || !currentBackendNoteId) {
      setWorkspaceFeedback('분석할 PDF 노트를 찾지 못했어요.');
      return;
    }
    if (pendingPageSaveCount || savingPageCount) {
      setWorkspaceFeedback('필기 저장이 끝난 뒤 노트 전체 분석을 다시 실행해주세요.');
      return;
    }

    setHandwritingAnalysisBusy('note');
    try {
      const analysisOptions = options ?? { useVisionFallback: HANDWRITING_AUTO_VISION_FALLBACK_ENABLED };
      const summary = await analyzeBackendNoteHandwriting(currentBackendNoteId, analysisOptions);
      const pages = await listBackendNotePages(currentBackendNoteId);
      rememberHandwritingRecognitionFromPages(studyDocumentId, pages);
      pages.forEach((page) => rememberSavedBackendNotePage(studyDocumentId, page));
      scheduleClassInsightRefresh(studyDocumentId);
      setWorkspaceFeedback(`손필기 분석 완료: ${summary.pages_analyzed}개 분석, ${summary.pages_skipped}개 건너뜀, ${summary.pages_failed}개 실패`);
    } catch {
      setWorkspaceFeedback('노트 전체 손필기 분석에 실패했어요.');
    } finally {
      setHandwritingAnalysisBusy(null);
    }
  }, [
    currentBackendNoteId,
    pendingPageSaveCount,
    rememberHandwritingRecognitionFromPages,
    rememberSavedBackendNotePage,
    savingPageCount,
    scheduleClassInsightRefresh,
    setWorkspaceFeedback,
    studyDocumentId,
  ]);
  const getCurrentPageInkStrokesForRecognition = useCallback(() => {
    if (!studyDocumentId || !currentHandwritingDebugPageNumber) return [];
    return (inkByDocument[studyDocumentId] ?? []).filter((stroke) => (
      !stroke.generatedPageId
      && (!stroke.pageNumber || stroke.pageNumber === currentHandwritingDebugPageNumber)
    ));
  }, [currentHandwritingDebugPageNumber, inkByDocument, studyDocumentId]);
  const checkMlKitHandwritingAvailability = useCallback(async () => {
    setMlKitHandwritingDebug((current) => ({ ...current, busy: true }));
    const availability = await getHandwritingRecognitionAvailability();
    setMlKitHandwritingDebug((current) => ({
      ...current,
      available: availability.available,
      modelReady: availability.state === 'ready' ? true : availability.state ? false : current.modelReady,
      modelState: availability.state,
      busy: false,
      detail: availability.detail,
    }));
    setWorkspaceFeedback(
      availability.state === 'ready'
        ? 'ML Kit 손필기 인식 모듈과 한국어 모델이 준비됐어요.'
        : availability.available
          ? `ML Kit 모듈은 사용 가능해요. ${formatMlKitUnavailableFeedback(availability.detail ?? availability.state)}`
          : formatMlKitUnavailableFeedback(availability.detail ?? availability.state),
    );
  }, [setWorkspaceFeedback]);
  const prepareKoreanHandwritingModel = useCallback(async () => {
    setMlKitHandwritingDebug((current) => ({ ...current, busy: true }));
    const model = await ensureKoreanHandwritingModel();
    setMlKitHandwritingDebug((current) => ({
      ...current,
      available: model.available || current.available === true,
      modelReady: model.available || model.state === 'ready',
      modelState: model.state,
      busy: false,
      detail: model.detail,
    }));
    setWorkspaceFeedback(
      model.state === 'ready' || model.available
        ? '한국어 손필기 모델이 준비됐어요.'
        : `한국어 모델 준비 상태: ${formatMlKitUnavailableFeedback(model.detail ?? model.state)}`,
    );
  }, [setWorkspaceFeedback]);
  const recognizeCurrentPageWithMlKit = useCallback(async () => {
    if (!currentHandwritingDebugPageNumber) {
      setWorkspaceFeedback('ML Kit으로 인식할 현재 PDF 페이지를 찾지 못했어요.');
      return;
    }
    const strokes = getCurrentPageInkStrokesForRecognition();
    if (!strokes.length) {
      setWorkspaceFeedback('현재 페이지에 인식할 B-Snap 필기가 없어요.');
      return;
    }
    if (mlKitHandwritingDebug.modelReady === false) {
      setWorkspaceFeedback(formatMlKitUnavailableFeedback(mlKitHandwritingDebug.detail ?? mlKitHandwritingDebug.modelState ?? 'Korean Digital Ink model is missing.'));
      return;
    }

    setMlKitHandwritingDebug((current) => ({ ...current, busy: true }));
    const result = await recognizeKoreanHandwritingByClusters(strokes, { pageNumber: currentHandwritingDebugPageNumber });
    const clusterCount = result.clusters?.length ?? 0;
    setMlKitHandwritingDebug((current) => ({
      ...current,
      available: result.status === 'ready' ? true : current.available,
      modelReady: result.status === 'ready' ? true : result.modelState ? result.modelState === 'ready' : current.modelReady,
      modelState: result.modelState ?? current.modelState,
      busy: false,
      detail: result.detail,
      result,
    }));
    setWorkspaceFeedback(
      result.status === 'ready'
        ? `${currentHandwritingDebugPageNumber}페이지 ML Kit 후보를 ${clusterCount || 1}개 cluster에서 인식했어요.`
        : formatMlKitUnavailableFeedback(result.detail ?? result.status),
    );
  }, [
    currentHandwritingDebugPageNumber,
    getCurrentPageInkStrokesForRecognition,
    mlKitHandwritingDebug.detail,
    mlKitHandwritingDebug.modelReady,
    mlKitHandwritingDebug.modelState,
    setWorkspaceFeedback,
  ]);
  const recognizeAndSaveCurrentPageWithMlKit = useCallback(async () => {
    if (!studyDocumentId || !currentBackendNoteId || !currentHandwritingDebugPageNumber) {
      setWorkspaceFeedback('ML Kit으로 저장할 현재 PDF 페이지를 찾지 못했어요.');
      return;
    }
    if (pendingPageSaveCount || savingPageCount) {
      setWorkspaceFeedback('필기 저장이 끝난 뒤 ML Kit 저장을 다시 실행해주세요.');
      return;
    }
    const pageId = backendPageIdsByDocument[studyDocumentId]?.[currentHandwritingDebugPageNumber];
    if (!pageId) {
      setWorkspaceFeedback('서버에 연결된 현재 페이지가 아직 준비되지 않았어요.');
      return;
    }
    const strokes = getCurrentPageInkStrokesForRecognition();
    if (!strokes.length) {
      setWorkspaceFeedback('현재 페이지에 저장할 B-Snap 필기가 없어요.');
      return;
    }
    if (mlKitHandwritingDebug.modelReady === false) {
      setWorkspaceFeedback(formatMlKitUnavailableFeedback(mlKitHandwritingDebug.detail ?? mlKitHandwritingDebug.modelState ?? 'Korean Digital Ink model is missing.'));
      return;
    }

    setHandwritingAnalysisBusy('page');
    setMlKitHandwritingDebug((current) => ({ ...current, busy: true }));
    try {
      const result = await recognizeKoreanHandwritingByClusters(strokes, { pageNumber: currentHandwritingDebugPageNumber });
      setMlKitHandwritingDebug((current) => ({
        ...current,
        available: result.status === 'ready' ? true : current.available,
        modelReady: result.status === 'ready' ? true : result.modelState ? result.modelState === 'ready' : current.modelReady,
        modelState: result.modelState ?? current.modelState,
        detail: result.detail,
        result,
      }));
      if (result.status !== 'ready') {
        setWorkspaceFeedback(`ML Kit 결과를 저장하지 못했어요. ${formatMlKitUnavailableFeedback(result.detail ?? result.status)}`);
        return;
      }

      const page = await persistBackendNotePageHandwritingRecognition(
        pageId,
        buildMlKitRecognitionWritePayload(
          result,
          currentHandwritingDebugPageNumber,
          currentPageHandwritingRecognition?.strokeHash,
        ),
      );
      rememberHandwritingRecognitionFromPage(studyDocumentId, page);
      rememberSavedBackendNotePage(studyDocumentId, page);
      scheduleClassInsightRefresh(studyDocumentId);
      setWorkspaceFeedback(`${page.page_number}페이지 ML Kit 손필기 결과를 ${result.clusters?.length || 1}개 cluster 기준으로 저장했고 class insight를 새로고침했어요.`);
    } catch (error) {
      if (error instanceof BackendApiError && error.status === 409) {
        setWorkspaceFeedback('ML Kit 결과가 오래됐어요. 현재 페이지에서 다시 실행해주세요.');
      } else {
        setWorkspaceFeedback('ML Kit 손필기 결과 저장에 실패했어요.');
      }
    } finally {
      setHandwritingAnalysisBusy(null);
      setMlKitHandwritingDebug((current) => ({ ...current, busy: false }));
    }
  }, [
    backendPageIdsByDocument,
    currentBackendNoteId,
    currentHandwritingDebugPageNumber,
    currentPageHandwritingRecognition?.strokeHash,
    getCurrentPageInkStrokesForRecognition,
    mlKitHandwritingDebug.detail,
    mlKitHandwritingDebug.modelReady,
    mlKitHandwritingDebug.modelState,
    pendingPageSaveCount,
    rememberHandwritingRecognitionFromPage,
    rememberSavedBackendNotePage,
    savingPageCount,
    scheduleClassInsightRefresh,
    setWorkspaceFeedback,
    studyDocumentId,
  ]);

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

  const refreshClassInsightForQuestion = useCallback(async (question: string) => {
    if (!isClassInsightQuestion(question)) return currentClassInsight;
    if (!isClassInsightTargetDocument(studyDocument, subject)) return currentClassInsight;
    if (!workspaceHydrated || !isBackendApiEnabled() || !studyDocumentId || !currentDocumentHasBackendPages || !currentBackendNoteId) {
      return currentClassInsight;
    }

    try {
      const insight = await getBackendClassInsight(currentBackendNoteId, 12);
      classInsightFetchKeyRef.current[studyDocumentId] = `${studyDocumentId}:${currentBackendNoteId}`;
      setClassInsightByDocument((current) => ({ ...current, [studyDocumentId]: insight }));
      return insight;
    } catch {
      return currentClassInsight;
    }
  }, [
    currentBackendNoteId,
    currentClassInsight,
    currentDocumentHasBackendPages,
    studyDocument,
    studyDocumentId,
    subject,
    workspaceHydrated,
  ]);

  const pullBackendDocuments = useCallback(async (options?: {
    showFeedback?: boolean;
    requestIsCurrent?: () => boolean;
  }) => {
    const showFeedback = Boolean(options?.showFeedback);
    if (!workspaceHydrated) return false;
    if (!isBackendApiEnabled()) {
      if (showFeedback) setWorkspaceFeedback('백엔드 URL이 설정되어 있지 않아 서버 동기화를 사용할 수 없어요.');
      return false;
    }
    const requestIsCurrent = options?.requestIsCurrent ?? (() => workspaceMountedRef.current);

    try {
      const [folders, backendNotes] = await Promise.all([
        listBackendFolders(),
        listBackendNotes(),
      ]);
      if (!requestIsCurrent()) return false;

      const nextBackendFolderIdBySubjectId: Record<number, number> = {};
      folders.forEach((folder) => {
        const matchedSubject = availableSubjects.find((item) => item.name === folder.name);
        if (matchedSubject) nextBackendFolderIdBySubjectId[matchedSubject.id] = folder.id;
      });
      const documents = await Promise.all(
        backendNotes.map(async (backendNote) => {
          const folder = folders.find((item) => item.id === backendNote.folder_id);
          const subject = availableSubjects.find((item) => item.name === folder?.name) ?? availableSubjects[0] ?? null;
          const fileUrl = backendNote.file_url ?? null;
          const pageCount = Math.max(1, backendNote.page_count ?? 1);
          const pdfLikeBackendNote = /\.pdf$/i.test(backendNote.title.trim()) || !!fileUrl || pageCount > 1;
          let firstPageImageUrl: string | null = null;
          let resolvedPageCount = pageCount;
          if (!pdfLikeBackendNote) {
            try {
              const pages = await listBackendNotePages(backendNote.id);
              firstPageImageUrl = pages[0]?.image_url ?? null;
              resolvedPageCount = Math.max(pageCount, pages.length || 1);
            } catch {
              firstPageImageUrl = null;
            }
          }
          const documentType = firstPageImageUrl ? 'image' as const : pdfLikeBackendNote ? 'pdf' as const : 'blank' as const;
          const documentFileUrl = fileUrl ?? firstPageImageUrl;

          return {
            id: backendNote.id,
            subjectId: subject?.id ?? props.initialSubjectId ?? 101,
            backendNoteId: backendNote.id,
            backendFolderId: backendNote.folder_id,
            title: backendNote.title,
            type: documentType,
            updatedAt: 'DB 저장됨',
            pageCount: resolvedPageCount,
            preview: backendNote.summary ?? '백엔드에 저장된 노트입니다.',
            file: documentFileUrl ? { uri: documentFileUrl } : undefined,
            remoteFileUrl: documentFileUrl ?? undefined,
            thumbnailUrl: backendNote.thumbnail_url ?? firstPageImageUrl ?? undefined,
            backendSyncStatus: 'synced',
          } satisfies StudyDocumentEntry;
        }),
      );
      if (!requestIsCurrent()) return false;

      setBackendFolderIdBySubjectId(nextBackendFolderIdBySubjectId);
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
            localFileUri: isTransientWebFileUri(document.localFileUri) ? undefined : document.localFileUri,
            file: document.localFileUri && !isTransientWebFileUri(document.localFileUri)
              ? { uri: document.localFileUri }
              : normalizeDocumentFile(backendDocument.file),
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
      if (showFeedback) setWorkspaceFeedback('서버 자료를 동기화했어요.');
      return true;
    } catch {
      if (requestIsCurrent()) {
        setWorkspaceFeedback('노트 목록을 불러오지 못했어요.');
      }
      return false;
    }
  }, [availableSubjects, props.initialSubjectId, setWorkspaceFeedback, workspaceHydrated]);

  const syncBackendDocuments = useCallback(async (options?: { showFeedback?: boolean }) => {
    const showFeedback = Boolean(options?.showFeedback);
    if (!workspaceHydrated) return false;
    if (!isBackendApiEnabled()) {
      if (showFeedback) setWorkspaceFeedback('백엔드 URL이 설정되어 있지 않아 서버 동기화를 사용할 수 없어요.');
      return false;
    }

    const requestId = backendDocumentSyncRequestIdRef.current + 1;
    backendDocumentSyncRequestIdRef.current = requestId;
    setBackendDocumentSyncing(true);
    const requestIsCurrent = () => workspaceMountedRef.current && backendDocumentSyncRequestIdRef.current === requestId;

    try {
      if (showFeedback) setWorkspaceFeedback('클라우드와 동기화하는 중입니다.');
      const uploadResult = await syncLocalDocumentsToBackend();
      if (!requestIsCurrent()) return false;
      const savedPagesOk = await flushBackendPageSaves();
      if (!requestIsCurrent()) return false;
      const refreshedPagesOk = await refreshBackendDocumentPages();
      if (!requestIsCurrent()) return false;
      const pulledOk = await pullBackendDocuments({ requestIsCurrent });
      const ok = uploadResult.failed === 0 && savedPagesOk && refreshedPagesOk && pulledOk;

      if (showFeedback && requestIsCurrent()) {
        if (ok) {
          const uploadedText = uploadResult.synced > 0 ? `${uploadResult.synced}개 자료 업로드 · ` : '';
          setWorkspaceFeedback(`${uploadedText}클라우드 동기화를 완료했어요.`);
        } else {
          setWorkspaceFeedback('일부 항목을 동기화하지 못했어요. 네트워크 상태를 확인한 뒤 다시 눌러주세요.');
        }
      }
      return ok;
    } catch {
      if (requestIsCurrent()) {
        setWorkspaceFeedback('클라우드 동기화 중 문제가 발생했어요.');
      }
      return false;
    } finally {
      if (requestIsCurrent()) {
        setBackendDocumentSyncing(false);
      }
    }
  }, [
    flushBackendPageSaves,
    pullBackendDocuments,
    refreshBackendDocumentPages,
    setWorkspaceFeedback,
    syncLocalDocumentsToBackend,
    workspaceHydrated,
  ]);

  useEffect(() => {
    if (!workspaceHydrated || !isBackendApiEnabled()) return;
    void pullBackendDocuments();
  }, [pullBackendDocuments, workspaceHydrated]);

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
        setAllChatSessions((current) => {
          const incomingSessionIds = new Set(sessions.map((item) => item.id));
          return [
            ...sessions,
            ...current.filter((item) => !incomingSessionIds.has(item.id)),
          ];
        });
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
          setAiError(getAiBackendErrorMessage(error, '서버에서 AI와의 대화 내역을 불러오지 못했어요. 네트워크 연결 상태를 확인 후 다시 시도해 주세요.'));
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
    activePageByDocument,
    lastChatSessionByDocument,
    chatSidebarOpenByDocument,
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
    setAiPanelMode,
    setAppChatMode,
    setAppRightSidebarPanel,
    setViewingAiChatSessionId,
    setChatSidebarOpenByDocument,
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

  const enterEditModeForTool = (tool: InkTool) => {
    if (tool !== 'view') {
      lastEditingInkToolRef.current = tool;
      setStudyInteractionMode('edit');
    }
  };

  const changeInkTool = (tool: InkTool) => {
    enterEditModeForTool(tool);
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

  const handlePencilInteractionAction = useCallback((event: PencilInteractionEvent) => {
    if (event.type !== 'tap') return;
    changeInkTool(inkTool === 'erase' ? 'pen' : 'erase');
  }, [changeInkTool, inkTool]);

  const getPencilInteractionFeedbackMessage = useCallback((event: PencilInteractionEvent) => {
    if (event.type !== 'tap') return null;
    return inkTool === 'erase'
      ? 'Apple Pencil double tap: 펜으로 전환'
      : 'Apple Pencil double tap: 지우개로 전환';
  }, [inkTool]);

  usePencilInteractionFeedback({
    enabled: noteWorkspaceMode === 'note' && Boolean(studyDocumentId) && studyInteractionMode === 'edit',
    onFeedback: setWorkspaceFeedback,
    onPrimaryAction: handlePencilInteractionAction,
    getFeedbackMessage: getPencilInteractionFeedbackMessage,
  });

  const changePenColor = (color: string) => {
    setStudyInteractionMode('edit');
    setPenColor(color);
    setInkTool((current) => (current !== 'pen' && current !== 'highlight' && !isShapeTool(current) ? 'pen' : current));
  };

  const changePenWidth = (width: number) => {
    setStudyInteractionMode('edit');
    setPenWidth(width);
    setInkTool((current) => (current !== 'pen' && current !== 'highlight' && !isShapeTool(current) ? 'pen' : current));
  };

  const changeBrushType = (brush: InkBrush) => {
    setStudyInteractionMode('edit');
    setBrushType(brush);
    setInkTool(brush === 'highlighter' ? 'highlight' : 'pen');
    if (brush === 'highlighter' && penWidth < 8) setPenWidth(12);
    if (brush !== 'highlighter' && penWidth > 10) setPenWidth(4);
  };

  const changeLinePattern = (pattern: InkLinePattern) => {
    setStudyInteractionMode('edit');
    setLinePattern(pattern === 'dashed' ? 'dotted' : pattern);
    setInkTool((current) => (current !== 'pen' && current !== 'highlight' && !isShapeTool(current) ? 'pen' : current));
  };

  const changeEraserMode = (mode: InkEraserMode) => {
    setStudyInteractionMode('edit');
    setEraserMode(mode);
    setInkTool('erase');
  };

  const changeEraserWidth = (width: number) => {
    setStudyInteractionMode('edit');
    setEraserWidth(Math.max(6, Math.min(36, Math.round(width))));
    setInkTool('erase');
  };

  const changeSelectionMode = (mode: InkSelectionMode) => {
    setStudyInteractionMode('edit');
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
    Keyboard.dismiss();
    if (!studyDocumentId || !selectionRect) {
      setWorkspaceFeedback('복사할 영역을 먼저 선택해 주세요.');
      return;
    }
    if (!selectionPreviewUri) {
      setWorkspaceFeedback('선택한 영역을 준비 중입니다. 잠시 후 다시 시도해 주세요.');
      return;
    }
    setCopiedSelectionImageByDocument((current) => ({ ...current, [studyDocumentId]: selectionPreviewUri }));
    setWorkspaceFeedback('선택한 영역을 복사했어요.');
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
    selectedAiChatModelId,
    chatSessionByDocument,
    chatSessionsByDocument,
    allChatSessions,
    setAiAnswer,
    setAiQuestion,
    setAiError,
    setAiLoading,
    setAiCanvasRequestBusy,
    setWorkspaceFeedback,
    setSelectionPreviewByDocument,
    setChatSessionByDocument,
    setViewingAiChatSessionId,
    setLastChatSessionByDocument,
    setChatSessionsByDocument,
    setAllChatSessions,
    setAiMessagesBySession,
    activeRagScope: activeAiRagScope,
    activeCanvasNoteId: aiCanvas.activeNoteId,
    activeCanvasMarkdown: aiCanvas.markdownDraft,
    activeCanvasDocumentJson: aiCanvas.documentDraft,
    onApplyCanvasEditFromChat: applyCanvasEditFromChat,
    onSyncRagScope: syncRagScopeToSessions,
    onResetDraftRagScope: resetDraftAiRagScope,
    onOpenChatForCanvasAnswer: () => {
      setViewingAiChatSessionId(null);
      setAiPanelOpen(true);
      if (Platform.OS !== 'web' && props.wide) {
        if (appChatMode === 'sidebar') {
          setAiPanelMode('sidebar');
          setAppRightSidebarPanel('chat');
        } else {
          setAiPanelMode('floating');
          setAppRightSidebarPanel(null);
        }
      } else {
        setAiPanelMode('sidebar');
      }
    },
    clearSelection: clearSelectionForCurrentDocument,
    buildContextHint: async (question) => {
      const previouslyRecommendedPageNumbers = new Set<number>();
      aiMessages
        .filter((message) => message.role === 'assistant')
        .forEach((message) => {
          extractRecommendedPageNumbersFromText(message.content, studyDocument?.pageCount).forEach((pageNumber) => {
            previouslyRecommendedPageNumbers.add(pageNumber);
          });
        });

      return buildClassInsightContext({
        question,
        studyDocument,
        subject,
        classInsight: await refreshClassInsightForQuestion(question),
        previouslyRecommendedPageNumbers,
      });
    },
  });

  const rememberCurrentDocumentChatSidebar = (open: boolean) => {
    if (!studyDocumentId) return;
    setChatSidebarOpenByDocument((current) => (
      current[studyDocumentId] === open
        ? current
        : { ...current, [studyDocumentId]: open }
    ));
  };

  const {
    toggleAiPanel,
    askAiAboutSelection,
  } = useWorkspaceAiIntents({
    selectionRect,
    selectionPreviewUri: rawSelectionPreviewUri,
    setAiPanelOpen,
    setAiQuestion,
    setViewingAiChatSessionId,
    setWorkspaceFeedback,
    openAiChatForSelection: () => {
      setAiPanelOpen(true);
      if (Platform.OS !== 'web' && props.wide) {
        if (appChatMode === 'sidebar') {
          rememberCurrentDocumentChatSidebar(true);
          setAiPanelMode('sidebar');
          setAppRightSidebarPanel('chat');
        } else {
          setAiPanelMode('floating');
          setAppRightSidebarPanel(null);
        }
      }
    },
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
    onMarkPageDirty: markBackendPageDirty,
  });
  const requestAiCanvasCommand = useCallback(async (command: string, options?: {
    selectionImageUri?: string | null;
    canvasAction?: 'auto' | 'chat_only' | 'canvas_edit';
    source?: 'canvas-mini' | 'canvas-block';
    canvasBlockContext?: AiCanvasBlockContext | null;
    canvasNoteNeedsTitle?: boolean;
    canvasRecommendationMode?: AiCanvasRecommendationMode | null;
  }) => {
    if (isCanvasCreateRequest(command)) {
      setWorkspaceFeedback('현재 Canvas 수정만 도와드릴 수 있어요.');
      return false;
    }
    if (!aiCanvas.activeNoteId) {
      setWorkspaceFeedback('먼저 Canvas를 만들어 주세요.');
      return false;
    }
    return requestAiAnswer({
      question: command,
      source: options?.source ?? 'canvas-mini',
      canvasAction: options?.canvasAction ?? 'auto',
      selectionImageUri: options?.selectionImageUri ?? null,
      canvasMarkdown: aiCanvas.markdownDraft,
      canvasDocumentJson: aiCanvas.documentDraft,
      canvasBlockContext: options?.canvasBlockContext ?? null,
      canvasNoteNeedsTitle: options?.canvasNoteNeedsTitle ?? false,
      canvasRecommendationMode: options?.canvasRecommendationMode ?? null,
    });
  }, [aiCanvas.activeNoteId, aiCanvas.documentDraft, aiCanvas.markdownDraft, requestAiAnswer, setWorkspaceFeedback]);

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
    clearInk: clearInkBase,
    undoInk,
    redoInk,
    commitInkStroke: commitInkStrokeBase,
    removeInkStroke: removeInkStrokeBase,
    replaceInkStrokes: replaceInkStrokesBase,
    addTextAnnotation: addTextAnnotationBase,
    updateTextAnnotation: updateTextAnnotationBase,
    removeTextAnnotation: removeTextAnnotationBase,
    moveTextAnnotation: moveTextAnnotationBase,
    resizeTextAnnotation: resizeTextAnnotationBase,
    changeTextAnnotationFontSize: changeTextAnnotationFontSizeBase,
    eraseInkAtPoint: eraseInkAtPointBase,
    deleteSelectedStrokes: deleteSelectedStrokesBase,
    changeSelectedStrokesColor: changeSelectedStrokesColorBase,
    duplicateSelectedStrokes: duplicateSelectedStrokesBase,
    resizeSelectedStrokes: resizeSelectedStrokesBase,
    resizeSelectedStrokesToRect: resizeSelectedStrokesToRectBase,
    nudgeSelectedStrokes: nudgeSelectedStrokesBase,
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
  const recordDocumentAction = useCallback(() => recordWorkspaceActionTarget('document'), [recordWorkspaceActionTarget]);
  const clearInk = useCallback(() => {
    recordDocumentAction();
    clearInkBase();
  }, [clearInkBase, recordDocumentAction]);
  const commitInkStroke = useCallback((stroke: InkStroke) => {
    recordDocumentAction();
    commitInkStrokeBase(stroke);
  }, [commitInkStrokeBase, recordDocumentAction]);
  const removeInkStroke = useCallback((strokeId: string) => {
    recordDocumentAction();
    removeInkStrokeBase(strokeId);
  }, [recordDocumentAction, removeInkStrokeBase]);
  const replaceInkStrokes = useCallback((removedStrokeIds: string[], addedStrokes: InkStroke[]) => {
    recordDocumentAction();
    replaceInkStrokesBase(removedStrokeIds, addedStrokes);
  }, [recordDocumentAction, replaceInkStrokesBase]);
  const addTextAnnotation = useCallback((point: InkPoint) => {
    recordDocumentAction();
    addTextAnnotationBase(point);
  }, [addTextAnnotationBase, recordDocumentAction]);
  const addImageAnnotation = useCallback((_annotation: Partial<InkImageAnnotation> & Pick<InkImageAnnotation, 'uri'>) => {
    setWorkspaceFeedback('사진 삽입 기능은 임시로 꺼두었습니다.');
  }, [setWorkspaceFeedback]);
  const insertImageFromLibrary = useCallback(() => {
    setWorkspaceFeedback('사진 삽입 기능은 임시로 꺼두었습니다.');
  }, [setWorkspaceFeedback]);
  const updateTextAnnotation = useCallback((annotationId: string, text: string) => {
    recordDocumentAction();
    updateTextAnnotationBase(annotationId, text);
  }, [recordDocumentAction, updateTextAnnotationBase]);
  const removeTextAnnotation = useCallback((annotationId: string) => {
    recordDocumentAction();
    removeTextAnnotationBase(annotationId);
  }, [recordDocumentAction, removeTextAnnotationBase]);
  const moveTextAnnotation = useCallback((annotationId: string, x: number, y: number) => {
    recordDocumentAction();
    moveTextAnnotationBase(annotationId, x, y);
  }, [moveTextAnnotationBase, recordDocumentAction]);
  const resizeTextAnnotation = useCallback((annotationId: string, width: number, height: number) => {
    recordDocumentAction();
    resizeTextAnnotationBase(annotationId, width, height);
  }, [recordDocumentAction, resizeTextAnnotationBase]);
  const changeTextAnnotationFontSize = useCallback((annotationId: string, fontSize: number) => {
    recordDocumentAction();
    changeTextAnnotationFontSizeBase(annotationId, fontSize);
  }, [changeTextAnnotationFontSizeBase, recordDocumentAction]);
  const eraseInkAtPoint = useCallback((point: InkPoint, radius: number, snapshot?: boolean, mode?: InkEraserMode) => {
    const changed = eraseInkAtPointBase(point, radius, snapshot, mode);
    if (changed) recordDocumentAction();
    return changed;
  }, [eraseInkAtPointBase, recordDocumentAction]);
  const deleteSelectedStrokes = useCallback(() => {
    recordDocumentAction();
    deleteSelectedStrokesBase();
  }, [deleteSelectedStrokesBase, recordDocumentAction]);
  const changeSelectedStrokesColor = useCallback((color: string) => {
    recordDocumentAction();
    changeSelectedStrokesColorBase(color);
  }, [changeSelectedStrokesColorBase, recordDocumentAction]);
  const duplicateSelectedStrokes = useCallback(() => {
    recordDocumentAction();
    duplicateSelectedStrokesBase();
  }, [duplicateSelectedStrokesBase, recordDocumentAction]);
  const resizeSelectedStrokes = useCallback((scale: number) => {
    recordDocumentAction();
    resizeSelectedStrokesBase(scale);
  }, [recordDocumentAction, resizeSelectedStrokesBase]);
  const resizeSelectedStrokesToRect = useCallback((rect: SelectionRect) => {
    recordDocumentAction();
    resizeSelectedStrokesToRectBase(rect);
  }, [recordDocumentAction, resizeSelectedStrokesToRectBase]);
  const nudgeSelectedStrokes = useCallback((dx: number, dy: number) => {
    recordDocumentAction();
    nudgeSelectedStrokesBase(dx, dy);
  }, [nudgeSelectedStrokesBase, recordDocumentAction]);

  const {
    insertAiAnswerPage,
    createMemoPage,
    changeBlankNoteTemplate,
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
    onMarkPageDirty: markBackendPageDirty,
  });
  const { effectiveWorkspaceFeedback, documentSaveStatus } = useWorkspaceSaveStatus({
    workspaceFeedback,
    failedPageSaveCount,
    pendingPageSaveCount,
    savingPageCount,
    workspaceHydrated,
  });

  const documentInkHistory = studyDocumentId ? inkHistoryByDocument[studyDocumentId] ?? [] : [];
  const documentRedoHistory = studyDocumentId ? redoInkHistoryByDocument[studyDocumentId] ?? [] : [];
  const canUndoDocumentAction = documentInkHistory.length > 0;
  const canRedoDocumentAction = documentRedoHistory.length > 0;
  const canUndoWorkspaceTarget = (target: WorkspaceFocusTarget) => {
    if (target === 'document') return canUndoDocumentAction;
    return aiCanvas.canUndo;
  };
  const canRedoWorkspaceTarget = (target: WorkspaceFocusTarget) => {
    if (target === 'document') return canRedoDocumentAction;
    return aiCanvas.canRedo;
  };
  const lastUndoWorkspaceTarget = [...workspaceActionHistory].reverse().find(canUndoWorkspaceTarget)
    ?? (focusedWorkspaceTarget && canUndoWorkspaceTarget(focusedWorkspaceTarget) ? focusedWorkspaceTarget : null);
  const lastRedoWorkspaceTarget = [...workspaceRedoActionHistory].reverse().find(canRedoWorkspaceTarget)
    ?? (focusedWorkspaceTarget && canRedoWorkspaceTarget(focusedWorkspaceTarget) ? focusedWorkspaceTarget : null);
  const canUndoFocusedWorkspaceAction = Boolean(lastUndoWorkspaceTarget);
  const canRedoFocusedWorkspaceAction = Boolean(lastRedoWorkspaceTarget);
  const removeLastWorkspaceTarget = (items: WorkspaceFocusTarget[], target: WorkspaceFocusTarget) => {
    const index = items.lastIndexOf(target);
    if (index < 0) return items;
    return [...items.slice(0, index), ...items.slice(index + 1)];
  };
  const undoWorkspaceActionTarget = (target: WorkspaceFocusTarget) => {
    if (!canUndoWorkspaceTarget(target)) return;
    setWorkspaceActionHistory((current) => removeLastWorkspaceTarget(current, target));
    setWorkspaceRedoActionHistory((current) => [...current, target].slice(-100));
    setFocusedWorkspaceTarget(target);
    if (target === 'aiCanvas') {
      aiCanvas.undoCanvasEdit();
      return;
    }
    undoInk();
  };
  const redoWorkspaceActionTarget = (target: WorkspaceFocusTarget) => {
    if (!canRedoWorkspaceTarget(target)) return;
    setWorkspaceRedoActionHistory((current) => removeLastWorkspaceTarget(current, target));
    setWorkspaceActionHistory((current) => [...current, target].slice(-100));
    setFocusedWorkspaceTarget(target);
    if (target === 'aiCanvas') {
      aiCanvas.redoCanvasEdit();
      return;
    }
    redoInk();
  };
  const undoFocusedWorkspaceAction = () => {
    const target = lastUndoWorkspaceTarget;
    if (!target) return;
    undoWorkspaceActionTarget(target);
  };
  const redoFocusedWorkspaceAction = () => {
    const target = lastRedoWorkspaceTarget;
    if (!target) return;
    redoWorkspaceActionTarget(target);
  };
  const changeAppSidebarPosition = (position: AppSidebarPosition) => {
    setAppSidebarPosition(position);
  };
  const toggleAppSidebarPosition = () => {
    setAppSidebarPosition((current) => (current === 'right' ? 'left' : 'right'));
  };
  const toggleStudyInteractionMode = () => {
    if (studyInteractionMode === 'read') {
      setStudyInteractionMode('edit');
      setInkTool(lastEditingInkToolRef.current || 'pen');
      return;
    }

    lastEditingInkToolRef.current = inkTool === 'view' ? 'pen' : inkTool;
    setStudyInteractionMode('read');
    setInkTool('view');
    if (studyDocumentId) {
      setSelectionByDocument((current) => ({ ...current, [studyDocumentId]: null }));
      setSelectionPreviewByDocument((current) => ({ ...current, [studyDocumentId]: null }));
      setSelectionPreviewAttachedByDocument((current) => ({ ...current, [studyDocumentId]: false }));
    }
  };
  const openAppChatSidebar = () => {
    rememberCurrentDocumentChatSidebar(true);
    setAppChatMode('sidebar');
    setAppRightSidebarPanel('chat');
    setAiPanelMode('sidebar');
    setViewingAiChatSessionId(null);
    setAiPanelOpen(true);
  };
  const openAppAiCanvasSidebar = () => {
    if (appRightSidebarPanel === 'chat') rememberCurrentDocumentChatSidebar(false);
    setAppRightSidebarPanel('canvas');
    aiCanvas.open();
    if (appChatMode === 'sidebar') setAiPanelOpen(false);
  };
  const closeAppRightSidebar = () => {
    if (appRightSidebarPanel === 'chat') rememberCurrentDocumentChatSidebar(false);
    setAppRightSidebarPanel(null);
  };
  const floatAppAiChatPanel = () => {
    if (appRightSidebarPanel === 'chat') rememberCurrentDocumentChatSidebar(false);
    setAppChatMode('floating');
    setAppRightSidebarPanel(null);
    setAiPanelMode('floating');
    setViewingAiChatSessionId(null);
    setAiPanelOpen(true);
  };
  const dockAppAiChatPanel = () => {
    openAppChatSidebar();
  };

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
    aiFloatingPanelSize,
    appRightSidebarPanel,
    appChatMode,
    appRightSidebarWidth,
    appSidebarPosition,
    studyInteractionMode,
    focusedWorkspaceTarget,
    canUndoFocusedWorkspaceAction,
    canRedoFocusedWorkspaceAction,
    selectionRect,
    selectionPreviewUri,
    copiedSelectionImageUri: studyDocumentId ? copiedSelectionImageByDocument[studyDocumentId] ?? null : null,
    aiQuestion,
    aiAnswer,
    aiMessages,
    aiChatSessions: visibleAiChatSessions,
    noteAiChatSessions: aiChatSessions,
    allAiChatSessions: allChatSessions,
    selectedAiChatModelId,
    aiChatScope,
    aiChatSearchQuery,
    activeAiRagScope,
    aiRagReferenceCandidates,
    aiRagScopeCollapsed,
    activeAiChatSessionId,
    aiChatReadOnly,
    aiLoading,
    aiCanvasRequestBusy,
    aiError,
    aiCanvas,
    classInsight: currentClassInsight,
    importantPageRecommendations,
    currentPageHandwritingRecognition,
    handwritingAnalysisBusy,
    mlKitHandwritingDebug,
    handwritingDebugReadiness,
    canAnalyzeCurrentPageHandwriting,
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
    backendDocumentSyncing,
    openSubject,
    openNote,
    openStudyDocument,
    analyzeCurrentPageHandwriting,
    forceAnalyzeCurrentPageHandwriting,
    analyzeCurrentPageHandwritingWithVision,
    analyzeCurrentNoteHandwriting,
    checkMlKitHandwritingAvailability,
    prepareKoreanHandwritingModel,
    recognizeCurrentPageWithMlKit,
    recognizeAndSaveCurrentPageWithMlKit,
    createBlankNote,
    requestDeleteNote,
    requestDeleteStudyDocument,
    restoreNote,
    restoreStudyDocument,
    renameStudyDocument,
    syncBackendDocuments,
    uploadPdfDocument,
    insertImageFromLibrary,
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
    setAiFloatingPanelSize,
    setAppRightSidebarWidth,
    changeAppSidebarPosition,
    toggleAppSidebarPosition,
    toggleStudyInteractionMode,
    setFocusedWorkspaceTarget,
    openAppChatSidebar,
    openAppAiCanvasSidebar,
    closeAppRightSidebar,
    floatAppAiChatPanel,
    dockAppAiChatPanel,
    undoFocusedWorkspaceAction,
    redoFocusedWorkspaceAction,
    undoAiCanvasAction: () => undoWorkspaceActionTarget('aiCanvas'),
    redoAiCanvasAction: () => redoWorkspaceActionTarget('aiCanvas'),
    setAiQuestion,
    setAiChatScope: changeAiChatScope,
    onChangeAiChatScope: changeAiChatScope,
    onLoadAllAiChatSessions: loadAllAiChatSessions,
    onToggleAiRagScopeCollapsed: () => setAiRagScopeCollapsed((current) => !current),
    onAddAiRagScopeSource: addAiRagScopeSource,
    onRemoveAiRagScopeSource: removeAiRagScopeSource,
    setAiChatSearchQuery,
    setSelectedAiChatModelId: changeSelectedAiChatModel,
    selectAiChatSession,
    renameAiChatSession,
    removeAiChatSession,
    startNewAiChatSession,
    createAiChatSession,
    requestAiAnswer,
    requestAiAnswerForQuestion,
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
    changeBlankNoteTemplate,
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
