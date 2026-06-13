import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Animated, Image, Keyboard, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { hasEnoughClassInsightData, isClassInsightTargetDocument } from '../../../hooks/notes/class-insight';
import { useAppKeyboardInset } from '../../../hooks/notes/use-app-keyboard-inset';
import { useDelayedTooltip } from '../../../hooks/notes/use-delayed-tooltip';
import {
  evaluateBackendRagDebug,
  getBackendRagDebugIndex,
  getBackendRagDebugImageSummaryPreview,
  getBackendRagDebugParserCompare,
  getBackendRagDebugStatus,
  getBackendNoteRagStatus,
  reindexBackendNoteRag,
  type BackendNoteRagStatusResponse,
  type BackendRagDebugImageSummaryPreviewResponse,
  type BackendRagDebugIndexResponse,
  type BackendRagDebugEvaluateResponse,
  type BackendRagDebugParserCompareResponse,
  type BackendRagDebugParserName,
  type BackendRagDebugStatusResponse,
  type BackendRagScopeSource,
} from '../../../services/backend-api';
import { AiResponseContent } from './ai-response-content';
import { useNotesGlobalContext } from '../workspace/notes-global-context';

const FLOATING_PANEL_WIDTH = 300;
const FLOATING_PANEL_HEIGHT = 620;
const FLOATING_PANEL_TOP = 66;
const FLOATING_PANEL_MARGIN = 8;
const FLOATING_PANEL_MIN_WIDTH = 300;
const FLOATING_PANEL_MAX_WIDTH = 560;
const FLOATING_PANEL_MIN_HEIGHT = 360;
const FLOATING_PANEL_MAX_HEIGHT = 760;
const APP_DETACHED_PANEL_WIDTH = 380;
const APP_DETACHED_PANEL_TOP = 60;
const SIDEBAR_MIN_WIDTH = 300;
const SIDEBAR_DEFAULT_WIDTH = 340;
const RAG_SCOPE_TITLE_MAX_LENGTH = 42;

type WebFloatingDragState = {
  pointerId: number | null;
  startClientX: number;
  startClientY: number;
  startPanelX: number;
  startPanelY: number;
};

type WebSidebarResizeState = {
  pointerId: number | null;
  startClientX: number;
  startWidth: number;
};

type WebMessageScrollbarState = {
  scrollTop: number;
  contentHeight: number;
  viewportHeight: number;
  trackHeight: number;
};

type WebMessageScrollbarDragState = {
  pointerId: number | null;
  startClientY: number;
  startScrollTop: number;
  scrollRange: number;
  thumbTravel: number;
};

const WEB_MESSAGE_SCROLLBAR_MIN_THUMB_HEIGHT = 32;
const AI_COMPOSER_INPUT_MIN_HEIGHT = 36;
const AI_COMPOSER_INPUT_MAX_HEIGHT = 132;
const NOTE_RAG_STATUS_POLL_MS = 5000;
const RAG_DEV_PANEL_WIDTH = 480;
const RAG_DEV_PANEL_DEFAULT_HEIGHT = 9999;
const RAG_DEV_PANEL_MARGIN = 16;
const RAG_DEV_PANEL_TOP = 88;
const RAG_DEBUG_ENABLED = Platform.OS === 'web' && typeof __DEV__ !== 'undefined' && __DEV__;
const RAG_DEV_TABS = ['search', 'index', 'context', 'status'] as const;

type RagDevTab = typeof RAG_DEV_TABS[number];

const RAG_DEV_TAB_LABELS: Record<RagDevTab, string> = {
  search: '검색 테스트',
  index: '페이지별 자료',
  context: 'Context',
  status: '처리 상태',
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getRagDebugIndexChunkKey(chunk: { source_type: string; source_id?: string | number | null; page_number?: number | null; chunk_index?: number | null }, index: number) {
  return `index:chunk:${chunk.source_type}:${chunk.source_id ?? 'none'}:${chunk.page_number ?? 'none'}:${chunk.chunk_index ?? index}`;
}

function getRagDebugImageSummaryIdFromChunk(chunk: { source_type: string; source_id?: string | number | null; metadata?: Record<string, unknown> }) {
  if (chunk.source_type !== 'image_ai_summary') return null;
  const metadataId = chunk.metadata?.image_ai_summary_id;
  const rawId = metadataId ?? chunk.source_id;
  const id = Number(rawId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function getRagDebugImageChunkLabel(chunk: { source_id?: string | number | null; chunk_index?: number | null; metadata?: Record<string, unknown> }, fallbackIndex: number) {
  const summaryId = getRagDebugImageSummaryIdFromChunk({ ...chunk, source_type: 'image_ai_summary' });
  const sourceLabel = summaryId ? `#${summaryId}` : `#${chunk.source_id ?? fallbackIndex + 1}`;
  const partLabel = Number.isFinite(Number(chunk.chunk_index)) ? Number(chunk.chunk_index) : fallbackIndex + 1;
  return `이미지 요약 ${sourceLabel} · part ${partLabel}`;
}

function getRagDebugParserPageKey(parser: string, pageNumber: number) {
  return `parser:${parser}:page:${pageNumber}`;
}

function getRagDebugParserChunkKey(chunk: { parser: string; page_number: number; chunk_index?: number | null }, index: number) {
  return `parser:${chunk.parser}:page:${chunk.page_number}:chunk:${chunk.chunk_index ?? index}`;
}

function handleWebSubmitKeyPress(event: any, submit: () => void) {
  if (Platform.OS !== 'web') return;
  const key = event?.key ?? event?.nativeEvent?.key;
  const shiftKey = Boolean(event?.shiftKey ?? event?.nativeEvent?.shiftKey);
  if (key !== 'Enter' || shiftKey) return;
  event.preventDefault?.();
  submit();
}

function isWebRagMenuInteractiveTarget(target: unknown) {
  if (Platform.OS !== 'web' || typeof Element === 'undefined' || !(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest('[data-ai-rag-menu-interactive="true"]'));
}

function isWebModelMenuInteractiveTarget(target: unknown) {
  if (Platform.OS !== 'web' || typeof Element === 'undefined' || !(target instanceof Element)) {
    return false;
  }
  return Boolean(target.closest('[data-ai-model-menu-interactive="true"]'));
}

function getFloatingPanelHeight(windowHeight: number, panelY: number, requestedHeight = FLOATING_PANEL_HEIGHT) {
  return Math.min(requestedHeight, Math.max(FLOATING_PANEL_MIN_HEIGHT, windowHeight - panelY - FLOATING_PANEL_MARGIN));
}

type NoteRagStatusDisplay = {
  progressLabel: string | null;
  currentNoteScopeLabel: string;
};

const AI_CHAT_MODEL_OPTIONS = [
  { id: 'gemini-3.1-pro', label: 'Gemini 3.1 Pro', icon: 'star-four-points', iconColor: '#5F79FF' },
  { id: 'gpt-5.2', label: 'GPT-5.2', icon: 'star-four-points', iconColor: '#5F79FF' },
  { id: 'gpt-5.4', label: 'GPT-5.4', icon: 'star-four-points', iconColor: '#5F79FF' },
  { id: 'gpt-5.5', label: 'GPT-5.5', icon: 'star-four-points', iconColor: '#5F79FF' },
] as const;

type AiChatModelId = typeof AI_CHAT_MODEL_OPTIONS[number]['id'];

function formatPercentProgress(done: number, total: number) {
  if (!Number.isFinite(total) || total <= 0) return '';
  const safeDone = Math.max(0, Math.min(Number(done) || 0, Number(total)));
  const percent = Math.max(0, Math.min(100, Math.round((safeDone / Number(total)) * 100)));
  return ` · ${percent}%`;
}

function buildNoteRagStatusDisplay(status: BackendNoteRagStatusResponse | null): NoteRagStatusDisplay | null {
  if (!status) return null;
  const job = status.rag_job;
  if (status.analysis_required === false) {
    return { progressLabel: null, currentNoteScopeLabel: '현재 노트 참고중' };
  }
  if (!job) {
    return (status.current_note_chunk_count ?? 0) > 0
      ? { progressLabel: null, currentNoteScopeLabel: '현재 노트 참고중' }
      : { progressLabel: '노트 분석중', currentNoteScopeLabel: '노트 분석중' };
  }
  if (job.text_status === 'failed' || job.overall_status === 'failed') {
    return { progressLabel: null, currentNoteScopeLabel: '노트 분석 실패' };
  }
  if (job.text_status !== 'ready') {
    return {
      progressLabel: `노트 분석중${formatPercentProgress(job.processed_page_count, job.page_count)}`,
      currentNoteScopeLabel: '노트 분석중',
    };
  }
  if (job.image_status !== 'ready' && job.image_status !== 'partial_failed') {
    const imageProcessedCount = job.image_processed_count ?? job.image_completed_count;
    return {
      progressLabel: `이미지 분석 중${formatPercentProgress(imageProcessedCount, job.image_candidate_count)}`,
      currentNoteScopeLabel: '노트 내용 참고중',
    };
  }
  return { progressLabel: null, currentNoteScopeLabel: '현재 노트 참고중' };
}

const CLASS_INSIGHT_QUICK_PROMPTS = [
  { label: '중요 페이지', question: '시험에 나올만한 중요 페이지 추천해줘' },
] as const;
const MORE_IMPORTANT_PAGES_QUESTION = '중요 페이지 더 보여줘';

export function NotesAiAssistantPanel() {
  const workspace = useNotesGlobalContext();
  const { activeTooltipId, hoveredTooltipId, getTooltipTriggerProps, hideTooltip } = useDelayedTooltip();
  const { width, height } = useWindowDimensions();
  const [floatingPosition, setFloatingPosition] = React.useState({ x: FLOATING_PANEL_MARGIN, y: FLOATING_PANEL_TOP });
  const floatingPositionRef = React.useRef(floatingPosition);
  const floatingBoundsRef = React.useRef({ maxX: FLOATING_PANEL_MARGIN, maxY: FLOATING_PANEL_TOP, windowHeight: height });
  const webFloatingDragRef = React.useRef<WebFloatingDragState | null>(null);
  const floatingAnimatedPosition = React.useRef(new Animated.ValueXY(floatingPosition)).current;
  const floatingAnimatedHeight = React.useRef(new Animated.Value(FLOATING_PANEL_HEIGHT)).current;
  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT_WIDTH);
  const sidebarWidthRef = React.useRef(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarResizeActive, setSidebarResizeActive] = React.useState(false);
  const sidebarResizeDraggingRef = React.useRef(false);
  const webSidebarResizeRef = React.useRef<WebSidebarResizeState | null>(null);
  const webMessageScrollbarDragRef = React.useRef<WebMessageScrollbarDragState | null>(null);
  const [menuSessionId, setMenuSessionId] = React.useState<number | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = React.useState(false);
  const [editingSessionId, setEditingSessionId] = React.useState<number | null>(null);
  const [editingTitle, setEditingTitle] = React.useState('');
  const [editingTitleError, setEditingTitleError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: number; title: string } | null>(null);
  const [ragMenuOpen, setRagMenuOpen] = React.useState(false);
  const [ragMenuQuery, setRagMenuQuery] = React.useState('');
  const [modelMenuOpen, setModelMenuOpen] = React.useState(false);
  const [selectedAiModelId, setSelectedAiModelId] = React.useState<AiChatModelId>('gpt-5.5');
  const [aiComposerInputHeight, setAiComposerInputHeight] = React.useState(AI_COMPOSER_INPUT_MIN_HEIGHT);
  const [ragDebugOpen, setRagDebugOpen] = React.useState(false);
  const [ragDevTab, setRagDevTab] = React.useState<RagDevTab>('search');
  const [ragDevPosition, setRagDevPosition] = React.useState({ x: Math.max(RAG_DEV_PANEL_MARGIN, width - RAG_DEV_PANEL_WIDTH - RAG_DEV_PANEL_MARGIN), y: RAG_DEV_PANEL_TOP });
  const ragDevPositionRef = React.useRef(ragDevPosition);
  const webRagDevDragRef = React.useRef<WebFloatingDragState | null>(null);
  const [ragDebugQuery, setRagDebugQuery] = React.useState('');
  const [ragDebugLoading, setRagDebugLoading] = React.useState<'evaluate' | 'status' | 'index' | 'reindex' | 'parserCompare' | null>(null);
  const [ragDebugError, setRagDebugError] = React.useState<string | null>(null);
  const [ragDebugNotice, setRagDebugNotice] = React.useState<string | null>(null);
  const [ragDebugEvaluation, setRagDebugEvaluation] = React.useState<BackendRagDebugEvaluateResponse | null>(null);
  const [ragDebugIndex, setRagDebugIndex] = React.useState<BackendRagDebugIndexResponse | null>(null);
  const [ragDebugParserCompare, setRagDebugParserCompare] = React.useState<BackendRagDebugParserCompareResponse | null>(null);
  const [ragDebugParserCompareName, setRagDebugParserCompareName] = React.useState<BackendRagDebugParserName | null>(null);
  const [ragDebugImagePreview, setRagDebugImagePreview] = React.useState<BackendRagDebugImageSummaryPreviewResponse | null>(null);
  const [ragDebugImagePreviewLoading, setRagDebugImagePreviewLoading] = React.useState(false);
  const [ragDebugImagePreviewError, setRagDebugImagePreviewError] = React.useState<string | null>(null);
  const [ragDebugStatus, setRagDebugStatus] = React.useState<BackendRagDebugStatusResponse | null>(null);
  const [ragDebugSelectedKey, setRagDebugSelectedKey] = React.useState<string | null>(null);
  const [noteRagStatus, setNoteRagStatus] = React.useState<BackendNoteRagStatusResponse | null>(null);
  const aiQuestionInputRef = React.useRef<TextInput | null>(null);
  const messagesScrollRef = React.useRef<ScrollView | null>(null);
  const [messageScrollbarState, setMessageScrollbarState] = React.useState<WebMessageScrollbarState>({
    scrollTop: 0,
    contentHeight: 0,
    viewportHeight: 0,
    trackHeight: 0,
  });
  const messageScrollbarStateRef = React.useRef(messageScrollbarState);
  const hasChatHistory = workspace.aiMessages.length > 0;
  const selectedAiModel = React.useMemo(
    () => AI_CHAT_MODEL_OPTIONS.find((model) => model.id === selectedAiModelId) ?? AI_CHAT_MODEL_OPTIONS[AI_CHAT_MODEL_OPTIONS.length - 1],
    [selectedAiModelId],
  );
  const latestUserMessageContent = React.useMemo(() => {
    for (let index = workspace.aiMessages.length - 1; index >= 0; index -= 1) {
      const message = workspace.aiMessages[index] as any;
      if (message?.role === 'user' && typeof message.content === 'string' && message.content.trim()) {
        return message.content.trim();
      }
    }
    return '';
  }, [workspace.aiMessages]);
  const quickPrompts = React.useMemo(() => (
    isClassInsightTargetDocument(workspace.studyDocument, workspace.subject)
    && hasEnoughClassInsightData(workspace.classInsight)
      ? CLASS_INSIGHT_QUICK_PROMPTS
      : []
  ), [workspace.classInsight, workspace.studyDocument, workspace.subject]);
  const canRequestMoreImportantPages = quickPrompts.length > 0 && !workspace.aiChatReadOnly;
  const showQuickPrompts = Boolean(
    !workspace.aiChatReadOnly
    && !workspace.aiLoading
    && quickPrompts.length
    && !workspace.aiQuestion.trim()
  );
  const activeSession = workspace.activeAiChatSessionId
    ? workspace.allAiChatSessions.find((session: any) => session.id === workspace.activeAiChatSessionId)
      ?? workspace.noteAiChatSessions.find((session: any) => session.id === workspace.activeAiChatSessionId)
      ?? null
    : null;
  const activeSessionIdRef = React.useRef<number | null>(activeSession?.id ?? null);
  React.useEffect(() => {
    activeSessionIdRef.current = activeSession?.id ?? null;
    setRagDebugEvaluation(null);
    setRagDebugIndex(null);
    setRagDebugParserCompare(null);
    setRagDebugParserCompareName(null);
    setRagDebugImagePreview(null);
    setRagDebugImagePreviewError(null);
    setRagDebugImagePreviewLoading(false);
    setRagDebugStatus(null);
    setRagDebugSelectedKey(null);
    setRagDebugError(null);
    setRagDebugNotice(null);
    setRagDebugLoading((current) => (current === 'evaluate' || current === 'status' ? null : current));
  }, [activeSession?.id]);
  const openLinkedPdfPage = React.useCallback((pageNumber: number) => {
    workspace.onSetCurrentPdfPage?.(pageNumber);
    workspace.onChangeInkTool?.('view');
  }, [workspace.onChangeInkTool, workspace.onSetCurrentPdfPage]);
  const requestMoreImportantPages = React.useCallback(() => {
    void workspace.onRequestAiAnswerForQuestion(MORE_IMPORTANT_PAGES_QUESTION);
  }, [workspace.onRequestAiAnswerForQuestion]);
  const recentSessions = workspace.allAiChatSessions.slice(0, 8);
  const activeRagScopeSources = workspace.activeAiRagScope?.sources ?? [];
  const ragReferenceCandidates = workspace.aiRagReferenceCandidates ?? [];
  const activeRagScopeKeys = React.useMemo(
    () => new Set(activeRagScopeSources.map((source) => `${source.type}:${source.id}`)),
    [activeRagScopeSources],
  );
  const filteredRagCandidates = React.useMemo(() => {
    const query = ragMenuQuery.trim().toLowerCase();
    return ragReferenceCandidates
      .filter((source) => !activeRagScopeKeys.has(`${source.type}:${source.id}`))
      .filter((source) => !query || source.title.toLowerCase().includes(query) || source.type.includes(query))
      .slice(0, 8);
  }, [activeRagScopeKeys, ragMenuQuery, ragReferenceCandidates]);
  const currentBackendNoteId = React.useMemo(() => {
    const document = workspace.studyDocument as any;
    if (typeof document?.backendNoteId === 'number') return String(document.backendNoteId);
    if (document?.backendSyncStatus === 'synced' && typeof document?.id === 'number') return String(document.id);
    return null;
  }, [workspace.studyDocument]);
  const currentBackendNoteIdRef = React.useRef(currentBackendNoteId);
  React.useEffect(() => {
    currentBackendNoteIdRef.current = currentBackendNoteId;
    setRagDebugEvaluation(null);
    setRagDebugIndex(null);
    setRagDebugParserCompare(null);
    setRagDebugParserCompareName(null);
    setRagDebugImagePreview(null);
    setRagDebugImagePreviewError(null);
    setRagDebugImagePreviewLoading(false);
    setRagDebugStatus(null);
    setRagDebugSelectedKey(null);
    setRagDebugError(null);
    setRagDebugNotice(null);
    setRagDebugLoading(null);
    setNoteRagStatus(null);
  }, [currentBackendNoteId]);
  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    const noteId = Number(currentBackendNoteId);
    if (!Number.isFinite(noteId) || noteId <= 0) {
      setNoteRagStatus(null);
      return;
    }

    let cancelled = false;
    const loadStatus = async () => {
      try {
        const result = await getBackendNoteRagStatus(noteId);
        if (!cancelled && currentBackendNoteIdRef.current === String(noteId)) {
          setNoteRagStatus(result);
        }
      } catch {
        if (!cancelled && currentBackendNoteIdRef.current === String(noteId)) {
          setNoteRagStatus(null);
        }
      }
    };

    void loadStatus();
    const intervalId = window.setInterval(() => {
      void loadStatus();
    }, NOTE_RAG_STATUS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [currentBackendNoteId]);
  const noteRagStatusDisplay = React.useMemo(() => buildNoteRagStatusDisplay(noteRagStatus), [noteRagStatus]);
  const ragScopeTitle = React.useMemo(() => {
    if (activeRagScopeSources.length === 0) {
      if (workspace.activeAiRagScope) {
        return '참고자료 0개';
      }
      return noteRagStatusDisplay?.currentNoteScopeLabel ?? '참고 자료 준비 중';
    }
    if (activeRagScopeSources.length === 1) {
      const source = activeRagScopeSources[0];
      if (source?.type === 'note' && source.id === currentBackendNoteId) {
        return noteRagStatusDisplay?.currentNoteScopeLabel ?? '현재 노트 참고중';
      }
      const title = source?.title ?? '현재 노트';
      const shortTitle = title.length > RAG_SCOPE_TITLE_MAX_LENGTH
        ? `${title.slice(0, RAG_SCOPE_TITLE_MAX_LENGTH).trimEnd()}...`
        : title;
      return `${shortTitle} 참고중`;
    }
    return `참고자료 ${activeRagScopeSources.length}개`;
  }, [activeRagScopeSources, currentBackendNoteId, noteRagStatusDisplay, workspace.activeAiRagScope]);
  const getRagDebugSessionId = React.useCallback(() => {
    const currentNoteId = currentBackendNoteIdRef.current;
    const session = activeSession
      ?? workspace.noteAiChatSessions.find((item: any) => String(item.note_id) === currentNoteId)
      ?? workspace.allAiChatSessions.find((item: any) => String(item.note_id) === currentNoteId)
      ?? null;
    return session?.id ?? null;
  }, [activeSession, workspace.allAiChatSessions, workspace.noteAiChatSessions]);
  const ragDebugDetail = React.useMemo(() => {
    if (!ragDebugSelectedKey) return null;
    if (ragDebugEvaluation) {
      const result = ragDebugEvaluation.results.find((item, index) => (
        `result:${item.source_type}:${item.source_id}:${item.chunk_index ?? index}` === ragDebugSelectedKey
      ));
      if (result) {
        return {
          title: result.title,
          meta: `${result.source_type} · p.${result.page_number ?? '-'} · chunk ${result.chunk_index ?? '-'} · score ${typeof result.score === 'number' ? result.score.toFixed(3) : '-'}`,
          text: result.content,
        };
      }
      for (const section of ragDebugEvaluation.context?.sections ?? []) {
        const contextItem = section.items.find((item, index) => (
          `context:${section.title}:${item.source_type}:${item.source_id ?? 'none'}:${item.chunk_index ?? index}` === ragDebugSelectedKey
        ));
        if (contextItem) {
          return {
            title: `${section.title} / ${contextItem.title}`,
            meta: `${contextItem.source_type} · p.${contextItem.page_number ?? '-'} · chunk ${contextItem.chunk_index ?? '-'} · ${contextItem.content_length} chars`,
            text: contextItem.content,
          };
        }
      }
    }
    if (ragDebugParserCompare) {
      const parserPage = ragDebugParserCompare.pages.find((page) => (
        getRagDebugParserPageKey(page.parser ?? ragDebugParserCompare.summary.parser, page.page_number) === ragDebugSelectedKey
      ));
      if (parserPage) {
        return {
          title: `${parserPage.parser ?? ragDebugParserCompare.summary.parser} / Page ${parserPage.page_number}`,
          meta: `parser 비교 추출 원문 · ${parserPage.text_length} chars`,
          text: parserPage.text,
        };
      }
      const parserChunk = ragDebugParserCompare.chunks.find((chunk, index) => (
        getRagDebugParserChunkKey(chunk, index) === ragDebugSelectedKey
      ));
      if (parserChunk) {
        return {
          title: `${parserChunk.parser} / Page ${parserChunk.page_number}`,
          meta: `parser 비교 chunk ${parserChunk.chunk_index ?? '-'} · embedding 직전 content · ${parserChunk.content_length} chars`,
          text: parserChunk.content,
        };
      }
    }
    if (ragDebugIndex) {
      const indexChunk = ragDebugIndex.chunks.find((chunk, index) => (
        getRagDebugIndexChunkKey(chunk, index) === ragDebugSelectedKey
      ));
      if (indexChunk) {
        const confidence = typeof indexChunk.metadata?.confidence === 'string' ? indexChunk.metadata.confidence : null;
        const importance = typeof indexChunk.metadata?.importance === 'string' ? indexChunk.metadata.importance : null;
        const imageMeta = indexChunk.source_type === 'image_ai_summary'
          ? ` · confidence ${confidence ?? '-'} · importance ${importance ?? '-'}`
          : '';
        return {
          title: `${indexChunk.title || indexChunk.source_type} / Page ${indexChunk.page_number ?? '-'}`,
          meta: `${indexChunk.source_type} · chunk ${indexChunk.chunk_index ?? '-'} · embedding 직전 content${imageMeta}`,
          text: indexChunk.content,
        };
      }
      const imageSummary = ragDebugIndex.image_ai_summaries.find((summary) => (
        `index:image-summary:${summary.id}` === ragDebugSelectedKey
      ));
      if (imageSummary) {
        return {
          title: `이미지 요약 / Page ${imageSummary.page_number ?? '-'}`,
          meta: `status ${imageSummary.status ?? '-'} · confidence ${imageSummary.confidence ?? '-'} · importance ${imageSummary.importance ?? '-'} · indexed ${imageSummary.indexed ? 'yes' : 'no'}`,
          text: [
            imageSummary.summary ? `요약:\n${imageSummary.summary}` : null,
            imageSummary.ocr_text ? `이미지 안 텍스트:\n${imageSummary.ocr_text}` : null,
            imageSummary.skipped_reason ? `제외 사유:\n${imageSummary.skipped_reason}` : null,
            imageSummary.confidence_reason ? `confidence 이유:\n${imageSummary.confidence_reason}` : null,
            imageSummary.importance_reason ? `importance 이유:\n${imageSummary.importance_reason}` : null,
          ].filter(Boolean).join('\n\n') || '저장된 이미지 요약 내용이 없습니다.',
        };
      }
    }
    return null;
  }, [ragDebugEvaluation, ragDebugIndex, ragDebugParserCompare, ragDebugSelectedKey]);
  React.useEffect(() => {
    if (!RAG_DEBUG_ENABLED || !ragDebugIndex || !ragDebugSelectedKey) {
      setRagDebugImagePreview(null);
      setRagDebugImagePreviewError(null);
      setRagDebugImagePreviewLoading(false);
      return;
    }
    let summaryId: number | null = null;
    const selectedChunk = ragDebugIndex.chunks.find((chunk, index) => (
      getRagDebugIndexChunkKey(chunk, index) === ragDebugSelectedKey
    ));
    if (selectedChunk) {
      summaryId = getRagDebugImageSummaryIdFromChunk(selectedChunk);
    } else {
      const selectedSummary = ragDebugIndex.image_ai_summaries.find((summary) => (
        `index:image-summary:${summary.id}` === ragDebugSelectedKey
      ));
      summaryId = selectedSummary?.id ?? null;
    }
    if (!summaryId) {
      setRagDebugImagePreview(null);
      setRagDebugImagePreviewError(null);
      setRagDebugImagePreviewLoading(false);
      return;
    }
    const noteId = Number(currentBackendNoteIdRef.current);
    if (!Number.isFinite(noteId) || noteId <= 0) {
      setRagDebugImagePreview(null);
      setRagDebugImagePreviewError('현재 노트가 backend note와 연결되어 있지 않습니다.');
      setRagDebugImagePreviewLoading(false);
      return;
    }
    let cancelled = false;
    setRagDebugImagePreview(null);
    setRagDebugImagePreviewError(null);
    setRagDebugImagePreviewLoading(true);
    getBackendRagDebugImageSummaryPreview(noteId, summaryId)
      .then((preview) => {
        if (cancelled || currentBackendNoteIdRef.current !== String(noteId)) return;
        setRagDebugImagePreview(preview);
      })
      .catch((error: any) => {
        if (cancelled || currentBackendNoteIdRef.current !== String(noteId)) return;
        setRagDebugImagePreviewError(error?.detail || error?.message || '이미지 미리보기를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (cancelled || currentBackendNoteIdRef.current !== String(noteId)) return;
        setRagDebugImagePreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ragDebugIndex, ragDebugSelectedKey]);
  const runRagDevEvaluate = React.useCallback(async () => {
    if (!RAG_DEBUG_ENABLED) return;
    const question = (ragDebugQuery || workspace.aiQuestion || latestUserMessageContent).trim();
    if (!question) {
      setRagDebugError('검색 테스트 질문을 입력하세요.');
      return;
    }
    const sessionId = getRagDebugSessionId();
    const noteId = currentBackendNoteIdRef.current;
    if (!sessionId) {
      setRagDebugError('활성 AI Chat 세션이 없습니다.');
      return;
    }
    setRagDebugQuery(question);
    setRagDebugLoading('evaluate');
    setRagDebugError(null);
    setRagDebugNotice(null);
    try {
      const result = await evaluateBackendRagDebug({
        sessionId,
        content: question,
        pageNumber: workspace.currentPdfPage ?? null,
        selectionImageUri: workspace.selectionPreviewUri ?? null,
        selectionRect: workspace.selectionRect ?? null,
        ragScope: workspace.activeAiRagScope ?? null,
        useRag: true,
        topK: 10,
      });
      if (activeSessionIdRef.current !== sessionId || currentBackendNoteIdRef.current !== noteId) return;
      setRagDebugEvaluation(result);
      setRagDebugSelectedKey(result.results[0]
        ? `result:${result.results[0].source_type}:${result.results[0].source_id}:${result.results[0].chunk_index ?? 0}`
        : null);
    } catch (error: any) {
      if (activeSessionIdRef.current !== sessionId || currentBackendNoteIdRef.current !== noteId) return;
      setRagDebugError(error?.detail || error?.message || 'RAG 검색 테스트에 실패했습니다.');
    } finally {
      if (activeSessionIdRef.current === sessionId && currentBackendNoteIdRef.current === noteId) {
        setRagDebugLoading(null);
      }
    }
  }, [
    getRagDebugSessionId,
    latestUserMessageContent,
    ragDebugQuery,
    workspace.activeAiRagScope,
    workspace.aiQuestion,
    workspace.currentPdfPage,
    workspace.selectionPreviewUri,
    workspace.selectionRect,
  ]);
  const runRagDevLoadIndex = React.useCallback(async () => {
    if (!RAG_DEBUG_ENABLED) return;
    const noteId = Number(currentBackendNoteId);
    if (!Number.isFinite(noteId) || noteId <= 0) {
      setRagDebugError('현재 노트가 backend note와 연결되어 있지 않습니다.');
      return;
    }
    setRagDebugLoading('index');
    setRagDebugError(null);
    setRagDebugNotice(null);
    setRagDebugIndex(null);
    setRagDebugParserCompare(null);
    setRagDebugParserCompareName(null);
    setRagDebugSelectedKey(null);
    try {
      const result = await getBackendRagDebugIndex(noteId, { limit: 500 });
      if (currentBackendNoteIdRef.current !== String(noteId)) return;
      setRagDebugIndex(result);
      const firstChunk = result.chunks.find((chunk) => chunk.source_type === 'pdf_page')
        ?? result.chunks.find((chunk) => chunk.source_type === 'image_ai_summary')
        ?? result.chunks[0];
      if (firstChunk) {
        const firstChunkIndex = result.chunks.indexOf(firstChunk);
        setRagDebugSelectedKey(getRagDebugIndexChunkKey(firstChunk, firstChunkIndex >= 0 ? firstChunkIndex : 0));
        return;
      }
      const firstImageSummary = result.image_ai_summaries[0];
      setRagDebugSelectedKey(firstImageSummary ? `index:image-summary:${firstImageSummary.id}` : null);
    } catch (error: any) {
      if (currentBackendNoteIdRef.current !== String(noteId)) return;
      setRagDebugError(error?.detail || error?.message || '현재 노트 index를 불러오지 못했습니다.');
    } finally {
      if (currentBackendNoteIdRef.current === String(noteId)) {
        setRagDebugLoading(null);
      }
    }
  }, [currentBackendNoteId]);
  const runRagDevParserCompare = React.useCallback(async (parserName: BackendRagDebugParserName) => {
    if (!RAG_DEBUG_ENABLED) return;
    const noteId = Number(currentBackendNoteId);
    if (!Number.isFinite(noteId) || noteId <= 0) {
      setRagDebugError('현재 노트가 backend note와 연결되어 있지 않습니다.');
      return;
    }
    setRagDebugLoading('parserCompare');
    setRagDebugError(null);
    setRagDebugNotice(null);
    setRagDebugIndex(null);
    setRagDebugParserCompare(null);
    setRagDebugParserCompareName(parserName);
    setRagDebugSelectedKey(null);
    try {
      const result = await getBackendRagDebugParserCompare(noteId, parserName);
      if (currentBackendNoteIdRef.current !== String(noteId)) return;
      setRagDebugParserCompare(result);
      const firstPage = result.pages[0];
      if (firstPage) {
        setRagDebugSelectedKey(getRagDebugParserPageKey(firstPage.parser ?? result.summary.parser, firstPage.page_number));
      }
    } catch (error: any) {
      if (currentBackendNoteIdRef.current !== String(noteId)) return;
      setRagDebugParserCompareName(null);
      setRagDebugError(error?.detail || error?.message || 'parser 비교 추출에 실패했습니다.');
    } finally {
      if (currentBackendNoteIdRef.current === String(noteId)) {
        setRagDebugLoading(null);
      }
    }
  }, [currentBackendNoteId]);
  const runRagDevReindex = React.useCallback(async () => {
    if (!RAG_DEBUG_ENABLED) return;
    const noteId = Number(currentBackendNoteId);
    if (!Number.isFinite(noteId) || noteId <= 0) {
      setRagDebugError('현재 노트가 backend note와 연결되어 있지 않습니다.');
      return;
    }
    setRagDebugLoading('reindex');
    setRagDebugError(null);
    setRagDebugNotice(null);
    try {
      await reindexBackendNoteRag(noteId);
      if (currentBackendNoteIdRef.current !== String(noteId)) return;
      setRagDebugStatus(null);
      setRagDebugNotice('현재 노트 검색 자료를 다시 만드는 작업을 시작했습니다. 잠시 뒤 처리 상태를 새로고침하세요.');
    } catch (error: any) {
      if (currentBackendNoteIdRef.current !== String(noteId)) return;
      setRagDebugError(error?.detail || error?.message || '현재 노트 검색 자료 다시 만들기 요청에 실패했습니다.');
    } finally {
      if (currentBackendNoteIdRef.current === String(noteId)) {
        setRagDebugLoading(null);
      }
    }
  }, [currentBackendNoteId]);
  const runRagDevStatus = React.useCallback(async () => {
    if (!RAG_DEBUG_ENABLED) return;
    const sessionId = getRagDebugSessionId();
    const noteId = currentBackendNoteIdRef.current;
    if (!sessionId) {
      setRagDebugError('활성 AI Chat 세션이 없습니다.');
      return;
    }
    setRagDebugLoading('status');
    setRagDebugError(null);
    setRagDebugNotice(null);
    try {
      const result = await getBackendRagDebugStatus({
        sessionId,
        ragScope: workspace.activeAiRagScope ?? null,
      });
      if (activeSessionIdRef.current !== sessionId || currentBackendNoteIdRef.current !== noteId) return;
      setRagDebugStatus(result);
    } catch (error: any) {
      if (activeSessionIdRef.current !== sessionId || currentBackendNoteIdRef.current !== noteId) return;
      setRagDebugError(error?.detail || error?.message || 'RAG status check failed.');
    } finally {
      if (activeSessionIdRef.current === sessionId && currentBackendNoteIdRef.current === noteId) {
        setRagDebugLoading(null);
      }
    }
  }, [getRagDebugSessionId, workspace.activeAiRagScope]);
  const removeMentionToken = React.useCallback((value: string) => (
    value.replace(/(^|\s)@[^\s@]*$/, (match, prefix) => prefix.trimEnd())
  ).trimStart(), []);
  const closeRagReferenceMenu = React.useCallback((options?: { focusComposer?: boolean }) => {
    setRagMenuOpen(false);
    setRagMenuQuery('');
    if (Platform.OS === 'web' && options?.focusComposer) {
      window.setTimeout(() => {
        aiQuestionInputRef.current?.focus();
      }, 0);
    }
  }, []);
  const closeModelMenu = React.useCallback((options?: { focusComposer?: boolean }) => {
    setModelMenuOpen(false);
    if (Platform.OS === 'web' && options?.focusComposer) {
      window.setTimeout(() => {
        aiQuestionInputRef.current?.focus();
      }, 0);
    }
  }, []);
  const handleAiQuestionChange = React.useCallback((value: string) => {
    workspace.onChangeAiQuestion(value);
    if (!value) setAiComposerInputHeight(AI_COMPOSER_INPUT_MIN_HEIGHT);
    if (Platform.OS !== 'web') return;
    const match = value.match(/(?:^|\s)@([^\s@]*)$/);
    if (match) {
      closeModelMenu();
      setRagMenuOpen(true);
      setRagMenuQuery(match[1] ?? '');
      return;
    }
    closeRagReferenceMenu();
  }, [closeModelMenu, closeRagReferenceMenu, workspace.onChangeAiQuestion]);
  const handleAiQuestionContentSizeChange = React.useCallback((event: any) => {
    const contentHeight = Number(event?.nativeEvent?.contentSize?.height ?? 0);
    if (!Number.isFinite(contentHeight) || contentHeight <= 0) return;
    const nextHeight = clamp(Math.ceil(contentHeight), AI_COMPOSER_INPUT_MIN_HEIGHT, AI_COMPOSER_INPUT_MAX_HEIGHT);
    setAiComposerInputHeight((current) => (
      Math.abs(current - nextHeight) < 1 ? current : nextHeight
    ));
  }, []);
  const addRagReference = React.useCallback((source: BackendRagScopeSource) => {
    workspace.onAddAiRagScopeSource?.(source);
    workspace.onChangeAiQuestion(removeMentionToken(workspace.aiQuestion));
    closeRagReferenceMenu();
  }, [closeRagReferenceMenu, removeMentionToken, workspace]);
  const webRagMenuInteractiveProps = React.useMemo(() => (
    Platform.OS === 'web'
      ? ({
        'data-ai-rag-menu-interactive': 'true',
        onPointerDown: (event: any) => {
          event.stopPropagation?.();
          event.nativeEvent?.stopPropagation?.();
        },
      } as any)
      : {}
  ), []);
  const webModelMenuInteractiveProps = React.useMemo(() => (
    Platform.OS === 'web'
      ? ({
        'data-ai-model-menu-interactive': 'true',
        onPointerDown: (event: any) => {
          event.stopPropagation?.();
          event.nativeEvent?.stopPropagation?.();
        },
      } as any)
      : {}
  ), []);
  const getWebRagMenuItemProps = React.useCallback((source: BackendRagScopeSource) => (
    Platform.OS === 'web'
      ? ({
        onPointerDown: (event: any) => {
          event.preventDefault?.();
          event.stopPropagation?.();
          event.nativeEvent?.stopPropagation?.();
          addRagReference(source);
        },
      } as any)
      : {}
  ), [addRagReference]);
  const handleAiComposerKeyPress = React.useCallback((event: any) => {
    if (Platform.OS === 'web') {
      const key = event?.key ?? event?.nativeEvent?.key;
      if (key === 'Escape' && modelMenuOpen) {
        event.preventDefault?.();
        event.stopPropagation?.();
        event.nativeEvent?.stopPropagation?.();
        closeModelMenu({ focusComposer: true });
        return;
      }
      if (key === 'Escape' && ragMenuOpen) {
        event.preventDefault?.();
        event.stopPropagation?.();
        event.nativeEvent?.stopPropagation?.();
        closeRagReferenceMenu({ focusComposer: true });
        return;
      }
    }
    handleWebSubmitKeyPress(event, () => {
      void workspace.onRequestAiAnswer();
    });
  }, [closeModelMenu, closeRagReferenceMenu, modelMenuOpen, ragMenuOpen, workspace.onRequestAiAnswer]);
  const appFloatingChat = Boolean(
    workspace.usesAppAiPanelLayout
    && workspace.appChatMode === 'floating'
    && workspace.aiPanelMode === 'floating',
  );
  const appChatSidebar = Boolean(workspace.isAppChatSidebarPanel);
  const appKeyboardInset = useAppKeyboardInset(workspace.usesAppAiPanelLayout && (appChatSidebar || appFloatingChat));
  const requestedFloatingPanelSize = workspace.aiFloatingPanelSize ?? {
    width: appFloatingChat ? APP_DETACHED_PANEL_WIDTH : FLOATING_PANEL_WIDTH,
    height: FLOATING_PANEL_HEIGHT,
  };
  const floatingPanelMaxWidth = Math.max(
    FLOATING_PANEL_MIN_WIDTH,
    Math.min(FLOATING_PANEL_MAX_WIDTH, width - FLOATING_PANEL_MARGIN * 2),
  );
  const floatingPanelMaxHeight = Math.max(
    FLOATING_PANEL_MIN_HEIGHT,
    Math.min(FLOATING_PANEL_MAX_HEIGHT, height - FLOATING_PANEL_TOP - FLOATING_PANEL_MARGIN),
  );
  const floatingPanelWidth = clamp(requestedFloatingPanelSize.width, FLOATING_PANEL_MIN_WIDTH, floatingPanelMaxWidth);
  const floatingPanelHeight = clamp(requestedFloatingPanelSize.height, FLOATING_PANEL_MIN_HEIGHT, floatingPanelMaxHeight);
  const floatingPanelSizeRef = React.useRef({ width: floatingPanelWidth, height: floatingPanelHeight });
  const floatingResizeStartSizeRef = React.useRef(floatingPanelSizeRef.current);
  const floatingMaxX = Math.max(FLOATING_PANEL_MARGIN, width - floatingPanelWidth - FLOATING_PANEL_MARGIN);
  const floatingMaxY = Math.max(FLOATING_PANEL_TOP, height - floatingPanelHeight - FLOATING_PANEL_MARGIN);
  const ragDevPanelWidth = Math.min(RAG_DEV_PANEL_WIDTH, Math.max(320, width - RAG_DEV_PANEL_MARGIN * 2));
  const ragDevPanelHeight = Math.min(RAG_DEV_PANEL_DEFAULT_HEIGHT, Math.max(360, height - RAG_DEV_PANEL_TOP));
  const ragDevMaxX = Math.max(RAG_DEV_PANEL_MARGIN, width - ragDevPanelWidth - RAG_DEV_PANEL_MARGIN);
  const ragDevMaxY = Math.max(RAG_DEV_PANEL_TOP, height - ragDevPanelHeight - RAG_DEV_PANEL_MARGIN);
  const sidebarMaxWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.floor(width * 0.5));
  const useWebFloatingDrag = Platform.OS === 'web' && !appChatSidebar && workspace.aiPanelMode === 'floating';
  const useWebSidebarResize = Platform.OS === 'web' && !workspace.usesAppAiPanelLayout && workspace.aiPanelMode === 'sidebar';
  const messageScrollbarMetrics = React.useMemo(() => {
    const { scrollTop, contentHeight, viewportHeight, trackHeight } = messageScrollbarState;
    const scrollRange = Math.max(0, contentHeight - viewportHeight);
    const visible = Platform.OS === 'web' && scrollRange > 1 && trackHeight > 0;
    if (!visible) {
      return { visible: false, thumbTop: 0, thumbHeight: 0, scrollRange: 0, thumbTravel: 0 };
    }
    const thumbHeight = Math.min(
      trackHeight,
      Math.max(WEB_MESSAGE_SCROLLBAR_MIN_THUMB_HEIGHT, (viewportHeight / Math.max(1, contentHeight)) * trackHeight),
    );
    const thumbTravel = Math.max(0, trackHeight - thumbHeight);
    const clampedScrollTop = clamp(scrollTop, 0, scrollRange);
    const thumbTop = thumbTravel > 0 ? (clampedScrollTop / scrollRange) * thumbTravel : 0;
    return { visible: true, thumbTop, thumbHeight, scrollRange, thumbTravel };
  }, [messageScrollbarState]);

  React.useEffect(() => {
    messageScrollbarStateRef.current = messageScrollbarState;
  }, [messageScrollbarState]);

  React.useEffect(() => {
    ragDevPositionRef.current = ragDevPosition;
  }, [ragDevPosition]);

  React.useEffect(() => {
    setRagDevPosition((current) => {
      const next = {
        x: clamp(current.x, RAG_DEV_PANEL_MARGIN, ragDevMaxX),
        y: clamp(current.y, RAG_DEV_PANEL_TOP, ragDevMaxY),
      };
      return next.x === current.x && next.y === current.y ? current : next;
    });
  }, [ragDevMaxX, ragDevMaxY]);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !ragMenuOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (isWebRagMenuInteractiveTarget(event.target)) return;
      closeRagReferenceMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeRagReferenceMenu({ focusComposer: true });
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeRagReferenceMenu, ragMenuOpen]);

  React.useEffect(() => {
    if (Platform.OS !== 'web' || !modelMenuOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (isWebModelMenuInteractiveTarget(event.target)) return;
      closeModelMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeModelMenu({ focusComposer: true });
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeModelMenu, modelMenuOpen]);

  const handleRagDevPointerDown = React.useCallback((event: any) => {
    if (Platform.OS !== 'web') return;
    const native = event?.nativeEvent ?? event;
    const pointerId = Number(native?.pointerId ?? 0);
    webRagDevDragRef.current = {
      pointerId: Number.isFinite(pointerId) ? pointerId : null,
      startClientX: Number(native?.clientX ?? 0),
      startClientY: Number(native?.clientY ?? 0),
      startPanelX: ragDevPositionRef.current.x,
      startPanelY: ragDevPositionRef.current.y,
    };
    event.preventDefault?.();
    event.stopPropagation?.();
    event.currentTarget?.setPointerCapture?.(pointerId);
  }, []);

  React.useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const handlePointerMove = (event: PointerEvent) => {
      const drag = webRagDevDragRef.current;
      if (!drag) return;
      if (drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
      const nextX = clamp(drag.startPanelX + event.clientX - drag.startClientX, RAG_DEV_PANEL_MARGIN, ragDevMaxX);
      const nextY = clamp(drag.startPanelY + event.clientY - drag.startClientY, RAG_DEV_PANEL_TOP, ragDevMaxY);
      setRagDevPosition({ x: nextX, y: nextY });
    };
    const handlePointerUp = (event: PointerEvent) => {
      const drag = webRagDevDragRef.current;
      if (!drag) return;
      if (drag.pointerId !== null && event.pointerId !== drag.pointerId) return;
      webRagDevDragRef.current = null;
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [ragDevMaxX, ragDevMaxY]);

  const scrollMessagesTo = React.useCallback((scrollTop: number) => {
    const currentState = messageScrollbarStateRef.current;
    const nextScrollTop = clamp(scrollTop, 0, Math.max(0, currentState.contentHeight - currentState.viewportHeight));
    (messagesScrollRef.current as any)?.scrollTo?.({ y: nextScrollTop, animated: false });
    setMessageScrollbarState((current) => (
      Math.abs(current.scrollTop - nextScrollTop) < 0.5 ? current : { ...current, scrollTop: nextScrollTop }
    ));
  }, []);

  const handleMessagesScroll = React.useCallback((event: any) => {
    if (Platform.OS !== 'web') return;
    const nativeEvent = event.nativeEvent ?? {};
    const nextScrollTop = Number(nativeEvent.contentOffset?.y ?? 0);
    const nextContentHeight = Number(nativeEvent.contentSize?.height ?? messageScrollbarState.contentHeight);
    const nextViewportHeight = Number(nativeEvent.layoutMeasurement?.height ?? messageScrollbarState.viewportHeight);
    setMessageScrollbarState((current) => {
      const next = {
        ...current,
        scrollTop: nextScrollTop,
        contentHeight: nextContentHeight > 0 ? nextContentHeight : current.contentHeight,
        viewportHeight: nextViewportHeight > 0 ? nextViewportHeight : current.viewportHeight,
      };
      if (
        Math.abs(current.scrollTop - next.scrollTop) < 0.5
        && Math.abs(current.contentHeight - next.contentHeight) < 0.5
        && Math.abs(current.viewportHeight - next.viewportHeight) < 0.5
      ) {
        return current;
      }
      return next;
    });
  }, [messageScrollbarState.contentHeight, messageScrollbarState.viewportHeight]);

  const updateMessagesContentHeight = React.useCallback((_width: number, heightValue: number) => {
    if (Platform.OS !== 'web') return;
    setMessageScrollbarState((current) => (
      Math.abs(current.contentHeight - heightValue) < 0.5 ? current : { ...current, contentHeight: heightValue }
    ));
  }, []);

  const updateMessagesViewportHeight = React.useCallback((event: any) => {
    if (Platform.OS !== 'web') return;
    const heightValue = Number(event.nativeEvent?.layout?.height ?? 0);
    setMessageScrollbarState((current) => (
      Math.abs(current.viewportHeight - heightValue) < 0.5 ? current : { ...current, viewportHeight: heightValue }
    ));
  }, []);

  const updateMessagesTrackHeight = React.useCallback((event: any) => {
    if (Platform.OS !== 'web') return;
    const heightValue = Number(event.nativeEvent?.layout?.height ?? 0);
    setMessageScrollbarState((current) => (
      Math.abs(current.trackHeight - heightValue) < 0.5 ? current : { ...current, trackHeight: heightValue }
    ));
  }, []);

  const handleWebMessageScrollbarPointerMove = React.useCallback((event: PointerEvent) => {
    const drag = webMessageScrollbarDragRef.current;
    if (!drag || (drag.pointerId !== null && event.pointerId !== drag.pointerId) || drag.thumbTravel <= 0) return;
    event.preventDefault();
    scrollMessagesTo(drag.startScrollTop + ((event.clientY - drag.startClientY) / drag.thumbTravel) * drag.scrollRange);
  }, [scrollMessagesTo]);

  const handleWebMessageScrollbarPointerUp = React.useCallback((event: PointerEvent) => {
    const drag = webMessageScrollbarDragRef.current;
    if (!drag || (drag.pointerId !== null && event.pointerId !== drag.pointerId)) return;
    event.preventDefault();
    webMessageScrollbarDragRef.current = null;
  }, []);

  React.useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    window.addEventListener('pointermove', handleWebMessageScrollbarPointerMove, { passive: false });
    window.addEventListener('pointerup', handleWebMessageScrollbarPointerUp);
    window.addEventListener('pointercancel', handleWebMessageScrollbarPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWebMessageScrollbarPointerMove);
      window.removeEventListener('pointerup', handleWebMessageScrollbarPointerUp);
      window.removeEventListener('pointercancel', handleWebMessageScrollbarPointerUp);
      webMessageScrollbarDragRef.current = null;
    };
  }, [handleWebMessageScrollbarPointerMove, handleWebMessageScrollbarPointerUp]);

  const handleWebMessageScrollbarPointerDown = React.useCallback((event: any) => {
    if (Platform.OS !== 'web' || !messageScrollbarMetrics.visible || messageScrollbarMetrics.thumbTravel <= 0) return;
    const nativeEvent = event?.nativeEvent ?? event;
    if (typeof nativeEvent.button === 'number' && nativeEvent.button !== 0) return;
    webMessageScrollbarDragRef.current = {
      pointerId: typeof nativeEvent.pointerId === 'number' ? nativeEvent.pointerId : null,
      startClientY: nativeEvent.clientY,
      startScrollTop: messageScrollbarStateRef.current.scrollTop,
      scrollRange: messageScrollbarMetrics.scrollRange,
      thumbTravel: messageScrollbarMetrics.thumbTravel,
    };
    nativeEvent.preventDefault?.();
    nativeEvent.stopPropagation?.();
  }, [messageScrollbarMetrics]);

  React.useEffect(() => {
    floatingBoundsRef.current = { maxX: floatingMaxX, maxY: floatingMaxY, windowHeight: height };
  }, [floatingMaxX, floatingMaxY, height]);

  React.useEffect(() => {
    if (!appFloatingChat) return;
    const next = {
      x: Math.max(FLOATING_PANEL_MARGIN, width - APP_DETACHED_PANEL_WIDTH - 10),
      y: APP_DETACHED_PANEL_TOP,
    };
    floatingPositionRef.current = next;
    setFloatingPosition(next);
    floatingAnimatedPosition.setValue(next);
    floatingAnimatedHeight.setValue(floatingPanelHeight);
  }, [appFloatingChat, floatingAnimatedHeight, floatingAnimatedPosition, height, width]);

  React.useEffect(() => {
    setFloatingPosition((current) => ({
      x: clamp(current.x, FLOATING_PANEL_MARGIN, floatingMaxX),
      y: clamp(current.y, FLOATING_PANEL_TOP, floatingMaxY),
    }));
  }, [floatingMaxX, floatingMaxY]);

  React.useEffect(() => {
    floatingPositionRef.current = floatingPosition;
    floatingAnimatedPosition.setValue(floatingPosition);
    floatingAnimatedHeight.setValue(floatingPanelHeight);
  }, [floatingAnimatedHeight, floatingAnimatedPosition, floatingPanelHeight, floatingPosition]);

  React.useEffect(() => {
    const next = { width: floatingPanelWidth, height: floatingPanelHeight };
    floatingPanelSizeRef.current = next;
    floatingAnimatedHeight.setValue(next.height);
    if (
      next.width !== workspace.aiFloatingPanelSize?.width
      || next.height !== workspace.aiFloatingPanelSize?.height
    ) {
      workspace.onChangeAiFloatingPanelSize(next);
    }
  }, [
    floatingAnimatedHeight,
    floatingPanelHeight,
    floatingPanelWidth,
    workspace.aiFloatingPanelSize?.height,
    workspace.aiFloatingPanelSize?.width,
    workspace.onChangeAiFloatingPanelSize,
  ]);

  React.useEffect(() => {
    setSidebarWidth((current) => {
      const next = clamp(current, SIDEBAR_MIN_WIDTH, sidebarMaxWidth);
      sidebarWidthRef.current = next;
      return next;
    });
  }, [sidebarMaxWidth]);

  React.useEffect(() => {
    if (!useWebSidebarResize) return;
    sidebarWidthRef.current = workspace.webChatSidebarWidth;
  }, [useWebSidebarResize, workspace.webChatSidebarWidth]);

  const floatingPanResponder = React.useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => workspace.aiPanelMode === 'floating',
      onMoveShouldSetPanResponder: (_, gesture) => (
        workspace.aiPanelMode === 'floating'
        && Math.abs(gesture.dx) + Math.abs(gesture.dy) > 3
      ),
      onPanResponderGrant: () => {
        closeOpenMenus();
        floatingAnimatedPosition.setValue(floatingPositionRef.current);
        floatingAnimatedHeight.setValue(floatingPanelHeight);
      },
      onPanResponderMove: (_, gesture) => {
        const start = floatingPositionRef.current;
        const next = {
          x: clamp(start.x + gesture.dx, FLOATING_PANEL_MARGIN, floatingMaxX),
          y: clamp(start.y + gesture.dy, FLOATING_PANEL_TOP, floatingMaxY),
        };
        floatingAnimatedPosition.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        const start = floatingPositionRef.current;
        const next = {
          x: clamp(start.x + gesture.dx, FLOATING_PANEL_MARGIN, floatingMaxX),
          y: clamp(start.y + gesture.dy, FLOATING_PANEL_TOP, floatingMaxY),
        };
        floatingPositionRef.current = next;
        setFloatingPosition(next);
        floatingAnimatedPosition.setValue(next);
        floatingAnimatedHeight.setValue(floatingPanelHeight);
      },
      onPanResponderTerminate: (_, gesture) => {
        const start = floatingPositionRef.current;
        const next = {
          x: clamp(start.x + gesture.dx, FLOATING_PANEL_MARGIN, floatingMaxX),
          y: clamp(start.y + gesture.dy, FLOATING_PANEL_TOP, floatingMaxY),
        };
        floatingPositionRef.current = next;
        setFloatingPosition(next);
        floatingAnimatedPosition.setValue(next);
        floatingAnimatedHeight.setValue(floatingPanelHeight);
      },
    }),
    [floatingAnimatedHeight, floatingAnimatedPosition, floatingMaxX, floatingMaxY, floatingPanelHeight, workspace.aiPanelMode],
  );

  const changeFloatingPanelSize = React.useCallback((size: { width: number; height: number }) => {
    const position = floatingPositionRef.current;
    const next = {
      width: clamp(size.width, FLOATING_PANEL_MIN_WIDTH, floatingPanelMaxWidth),
      height: clamp(size.height, FLOATING_PANEL_MIN_HEIGHT, floatingPanelMaxHeight),
    };
    const nextPosition = {
      x: clamp(position.x, FLOATING_PANEL_MARGIN, Math.max(FLOATING_PANEL_MARGIN, width - next.width - FLOATING_PANEL_MARGIN)),
      y: clamp(position.y, FLOATING_PANEL_TOP, Math.max(FLOATING_PANEL_TOP, height - next.height - FLOATING_PANEL_MARGIN)),
    };
    floatingPanelSizeRef.current = next;
    floatingPositionRef.current = nextPosition;
    setFloatingPosition(nextPosition);
    floatingAnimatedPosition.setValue(nextPosition);
    workspace.onChangeAiFloatingPanelSize(next);
    floatingAnimatedHeight.setValue(next.height);
  }, [
    floatingAnimatedHeight,
    floatingAnimatedPosition,
    floatingPanelMaxHeight,
    floatingPanelMaxWidth,
    height,
    width,
    workspace.onChangeAiFloatingPanelSize,
  ]);

  const floatingResizePanResponder = React.useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponderCapture: () => workspace.aiPanelMode === 'floating' && !appChatSidebar,
      onStartShouldSetPanResponder: () => workspace.aiPanelMode === 'floating' && !appChatSidebar,
      onMoveShouldSetPanResponderCapture: (_, gesture) => (
        workspace.aiPanelMode === 'floating'
        && !appChatSidebar
        && Math.abs(gesture.dx) + Math.abs(gesture.dy) > 2
      ),
      onMoveShouldSetPanResponder: (_, gesture) => (
        workspace.aiPanelMode === 'floating'
        && !appChatSidebar
        && Math.abs(gesture.dx) + Math.abs(gesture.dy) > 2
      ),
      onPanResponderGrant: () => {
        closeOpenMenus();
        floatingResizeStartSizeRef.current = floatingPanelSizeRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        const start = floatingResizeStartSizeRef.current;
        changeFloatingPanelSize({
          width: start.width + gesture.dx,
          height: start.height + gesture.dy,
        });
      },
      onPanResponderRelease: (_, gesture) => {
        const start = floatingResizeStartSizeRef.current;
        changeFloatingPanelSize({
          width: start.width + gesture.dx,
          height: start.height + gesture.dy,
        });
      },
      onPanResponderTerminate: (_, gesture) => {
        const start = floatingResizeStartSizeRef.current;
        changeFloatingPanelSize({
          width: start.width + gesture.dx,
          height: start.height + gesture.dy,
        });
      },
    }),
    [appChatSidebar, changeFloatingPanelSize, workspace.aiPanelMode],
  );

  const finishWebFloatingDrag = React.useCallback((clientX: number, clientY: number) => {
    const drag = webFloatingDragRef.current;
    if (!drag) return;
    const bounds = floatingBoundsRef.current;
    const next = {
      x: clamp(drag.startPanelX + clientX - drag.startClientX, FLOATING_PANEL_MARGIN, bounds.maxX),
      y: clamp(drag.startPanelY + clientY - drag.startClientY, FLOATING_PANEL_TOP, bounds.maxY),
    };
    const nextHeight = getFloatingPanelHeight(bounds.windowHeight, next.y, floatingPanelSizeRef.current.height);
    webFloatingDragRef.current = null;
    floatingPositionRef.current = next;
    setFloatingPosition(next);
    floatingAnimatedPosition.setValue(next);
    floatingAnimatedHeight.setValue(nextHeight);
  }, [floatingAnimatedHeight, floatingAnimatedPosition]);

  const handleWebFloatingPointerMove = React.useCallback((event: PointerEvent) => {
    const drag = webFloatingDragRef.current;
    if (!drag || (drag.pointerId !== null && event.pointerId !== drag.pointerId)) return;
    const bounds = floatingBoundsRef.current;
    const next = {
      x: clamp(drag.startPanelX + event.clientX - drag.startClientX, FLOATING_PANEL_MARGIN, bounds.maxX),
      y: clamp(drag.startPanelY + event.clientY - drag.startClientY, FLOATING_PANEL_TOP, bounds.maxY),
    };
    floatingAnimatedPosition.setValue(next);
    floatingAnimatedHeight.setValue(getFloatingPanelHeight(bounds.windowHeight, next.y, floatingPanelSizeRef.current.height));
  }, [floatingAnimatedHeight, floatingAnimatedPosition]);

  const handleWebFloatingPointerUp = React.useCallback((event: PointerEvent) => {
    const drag = webFloatingDragRef.current;
    if (!drag || (drag.pointerId !== null && event.pointerId !== drag.pointerId)) return;
    finishWebFloatingDrag(event.clientX, event.clientY);
  }, [finishWebFloatingDrag]);

  React.useEffect(() => {
    if (!useWebFloatingDrag) return undefined;
    window.addEventListener('pointermove', handleWebFloatingPointerMove);
    window.addEventListener('pointerup', handleWebFloatingPointerUp);
    window.addEventListener('pointercancel', handleWebFloatingPointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWebFloatingPointerMove);
      window.removeEventListener('pointerup', handleWebFloatingPointerUp);
      window.removeEventListener('pointercancel', handleWebFloatingPointerUp);
      webFloatingDragRef.current = null;
    };
  }, [handleWebFloatingPointerMove, handleWebFloatingPointerUp, useWebFloatingDrag]);

  const handleWebFloatingPointerDown = React.useCallback((event: any) => {
    if (!useWebFloatingDrag) return;
    const nativeEvent = event?.nativeEvent ?? event;
    if (typeof nativeEvent.button === 'number' && nativeEvent.button !== 0) return;
    const target = nativeEvent.target;
    if (
      target instanceof HTMLElement
      && target.closest('button,[role="button"],input,textarea,select,[contenteditable="true"],[data-chat-drag-exclude="true"]')
    ) return;
    closeOpenMenus();
    webFloatingDragRef.current = {
      pointerId: typeof nativeEvent.pointerId === 'number' ? nativeEvent.pointerId : null,
      startClientX: nativeEvent.clientX,
      startClientY: nativeEvent.clientY,
      startPanelX: floatingPositionRef.current.x,
      startPanelY: floatingPositionRef.current.y,
    };
    floatingAnimatedPosition.setValue(floatingPositionRef.current);
    floatingAnimatedHeight.setValue(getFloatingPanelHeight(
      floatingBoundsRef.current.windowHeight,
      floatingPositionRef.current.y,
      floatingPanelSizeRef.current.height,
    ));
    nativeEvent.preventDefault?.();
    nativeEvent.stopPropagation?.();
  }, [floatingAnimatedHeight, floatingAnimatedPosition, useWebFloatingDrag]);
  const stopWebFloatingDragPropagation = React.useCallback((event: any) => {
    event?.stopPropagation?.();
    event?.nativeEvent?.stopPropagation?.();
  }, []);
  const webFloatingDragProps = useWebFloatingDrag ? ({ onPointerDown: handleWebFloatingPointerDown } as any) : {};
  const webFloatingDragExcludeProps = useWebFloatingDrag
    ? ({ 'data-chat-drag-exclude': 'true', onPointerDown: stopWebFloatingDragPropagation } as any)
    : {};

  const finishWebSidebarResize = React.useCallback((clientX: number) => {
    const resize = webSidebarResizeRef.current;
    if (!resize) return;
    const next = resize.startWidth + clientX - resize.startClientX;
    webSidebarResizeRef.current = null;
    sidebarResizeDraggingRef.current = false;
    workspace.onResizeWebChatSidebar(next);
    setSidebarResizeActive(false);
  }, [workspace.onResizeWebChatSidebar]);

  const handleWebSidebarResizePointerMove = React.useCallback((event: PointerEvent) => {
    const resize = webSidebarResizeRef.current;
    if (!resize || (resize.pointerId !== null && event.pointerId !== resize.pointerId)) return;
    workspace.onResizeWebChatSidebar(resize.startWidth + event.clientX - resize.startClientX);
  }, [workspace.onResizeWebChatSidebar]);

  const handleWebSidebarResizePointerUp = React.useCallback((event: PointerEvent) => {
    const resize = webSidebarResizeRef.current;
    if (!resize || (resize.pointerId !== null && event.pointerId !== resize.pointerId)) return;
    finishWebSidebarResize(event.clientX);
  }, [finishWebSidebarResize]);

  React.useEffect(() => {
    if (!useWebSidebarResize) return undefined;
    window.addEventListener('pointermove', handleWebSidebarResizePointerMove);
    window.addEventListener('pointerup', handleWebSidebarResizePointerUp);
    window.addEventListener('pointercancel', handleWebSidebarResizePointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWebSidebarResizePointerMove);
      window.removeEventListener('pointerup', handleWebSidebarResizePointerUp);
      window.removeEventListener('pointercancel', handleWebSidebarResizePointerUp);
      webSidebarResizeRef.current = null;
      sidebarResizeDraggingRef.current = false;
    };
  }, [handleWebSidebarResizePointerMove, handleWebSidebarResizePointerUp, useWebSidebarResize]);

  const handleWebSidebarResizePointerDown = React.useCallback((event: any) => {
    if (!useWebSidebarResize) return;
    const nativeEvent = event?.nativeEvent ?? event;
    if (typeof nativeEvent.button === 'number' && nativeEvent.button !== 0) return;
    closeOpenMenus();
    webSidebarResizeRef.current = {
      pointerId: typeof nativeEvent.pointerId === 'number' ? nativeEvent.pointerId : null,
      startClientX: nativeEvent.clientX,
      startWidth: sidebarWidthRef.current,
    };
    sidebarResizeDraggingRef.current = true;
    setSidebarResizeActive(true);
    nativeEvent.preventDefault?.();
    nativeEvent.stopPropagation?.();
  }, [useWebSidebarResize]);

  const startEditingSession = (sessionId: number, title: string) => {
    setMenuSessionId(null);
    setHeaderMenuOpen(false);
    setEditingSessionId(sessionId);
    setEditingTitle(title);
    setEditingTitleError(null);
  };

  const saveEditingSession = async () => {
    if (!editingSessionId) return;
    if (!editingTitle.trim()) {
      setEditingTitleError('채팅 이름을 입력해 주세요.');
      return;
    }
    const saved = await workspace.onRenameAiChatSession(editingSessionId, editingTitle);
    if (saved) {
      setEditingSessionId(null);
      setEditingTitle('');
      setEditingTitleError(null);
    }
  };

  const cancelEditingSession = () => {
    setEditingSessionId(null);
    setEditingTitle('');
    setEditingTitleError(null);
  };

  const confirmRemoveSession = (sessionId: number, title: string) => {
    setMenuSessionId(null);
    setHeaderMenuOpen(false);
    setDeleteTarget({ id: sessionId, title });
  };

  const selectSession = (sessionId: number) => {
    void workspace.onSelectAiChatSession(sessionId);
    closeOpenMenus();
  };

  const removeDeleteTarget = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    await workspace.onRemoveAiChatSession(targetId);
  };

  const startNewChat = () => {
    workspace.onStartNewAiChatSession();
    closeOpenMenus();
  };

  const returnToCurrentNoteSession = () => {
    const session = workspace.noteAiChatSessions[0] ?? null;
    if (session) {
      void workspace.onSelectAiChatSession(session.id);
      return;
    }
    workspace.onStartNewAiChatSession();
  };

  const closeOpenMenus = () => {
    setHeaderMenuOpen(false);
    setMenuSessionId(null);
    closeRagReferenceMenu();
    closeModelMenu();
  };

  const closeChatPanel = () => {
    closeOpenMenus();
    if (workspace.isAppChatSidebarPanel) {
      workspace.onCloseAppRightSidebar?.();
      return;
    }
    workspace.onToggleAiPanel?.();
  };

  const togglePanelMode = () => {
    if (workspace.isAppChatSidebarPanel) {
      closeOpenMenus();
      workspace.onFloatAppAiChatPanel?.();
      return;
    }
    if (workspace.usesAppAiPanelLayout && workspace.appChatMode === 'floating') {
      closeOpenMenus();
      workspace.onDockAppAiChatPanel?.();
      return;
    }
    closeOpenMenus();
    workspace.onChangeAiPanelMode(workspace.aiPanelMode === 'floating' ? 'sidebar' : 'floating');
  };

  const scrollToLatestMessage = React.useCallback(() => {
    setTimeout(() => {
      messagesScrollRef.current?.scrollToEnd({ animated: true });
    }, 40);
  }, []);

  React.useEffect(() => {
    scrollToLatestMessage();
  }, [workspace.aiMessages.length, workspace.aiLoading, workspace.activeAiChatSessionId, scrollToLatestMessage]);

  React.useEffect(() => {
    if (appKeyboardInset > 0) scrollToLatestMessage();
  }, [appKeyboardInset, scrollToLatestMessage]);

  if (!workspace.aiPanelOpen && !appChatSidebar) return null;
  const webSidebarAttachedPanel = Platform.OS === 'web' && !workspace.usesAppAiPanelLayout && workspace.aiPanelMode === 'sidebar';
  const panelStyle = appChatSidebar
    ? [workspace.styles.aiPanel, workspace.styles.appRightSidebarPanelContent]
    : appFloatingChat
      ? [
          workspace.styles.aiPanel,
          workspace.styles.appFloatingAiChatPanel,
          { left: floatingAnimatedPosition.x, top: floatingAnimatedPosition.y, right: undefined, bottom: undefined, width: floatingPanelWidth, height: floatingAnimatedHeight },
        ]
    : webSidebarAttachedPanel
      ? [
          workspace.styles.aiPanel,
          workspace.styles.aiPanelSidebar,
          workspace.styles.aiPanelWebAttached,
          { width: workspace.webChatSidebarWidth },
        ]
    : workspace.aiPanelMode === 'floating'
      ? [workspace.styles.aiPanel, { left: floatingAnimatedPosition.x, top: floatingAnimatedPosition.y, bottom: undefined, width: floatingPanelWidth, height: floatingAnimatedHeight }]
      : [workspace.styles.aiPanel, workspace.styles.aiPanelSidebar, { width: sidebarWidth }];
  const appKeyboardAvoidingStyle = appKeyboardInset > 0 ? { paddingBottom: appKeyboardInset + 12 } : null;
  const renderAiTooltip = (id: string, label: string, placement: 'above' | 'below' = 'below') => (
    activeTooltipId === id ? (
      <View
        pointerEvents="none"
        style={[
          workspace.styles.aiTooltipBubble,
          placement === 'above' ? workspace.styles.aiTooltipAbove : workspace.styles.aiTooltipBelow,
        ]}
      >
        <Text style={workspace.styles.aiTooltipText} numberOfLines={1}>{label}</Text>
      </View>
    ) : null
  );
  const getAiHeaderButtonStyle = (id: string) => [
    workspace.styles.aiHeaderIconButton,
    hoveredTooltipId === id && workspace.styles.aiHeaderIconButtonHover,
  ];

  return (
    <Animated.View style={[panelStyle, appKeyboardAvoidingStyle]} {...webFloatingDragProps}>
      {menuSessionId ? (
        <Pressable {...webFloatingDragExcludeProps} style={workspace.styles.aiMenuDismissLayer} onPress={closeOpenMenus} />
      ) : null}
      <Animated.View style={workspace.styles.aiHomePane}>
        {headerMenuOpen ? (
          <Pressable {...webFloatingDragExcludeProps} style={workspace.styles.aiHomeMenuDismissLayer} onPress={closeOpenMenus} />
        ) : null}
        <View
          style={[
            workspace.styles.aiPanelHeader,
            workspace.aiPanelMode === 'floating'
              && !appChatSidebar
              && !webSidebarAttachedPanel
              && workspace.styles.aiPanelHeaderDraggable,
          ]}
          {...(!useWebFloatingDrag && workspace.aiPanelMode === 'floating' && !appChatSidebar && !webSidebarAttachedPanel
              ? floatingPanResponder.panHandlers
              : {})}
        >
          <View style={workspace.styles.aiHeaderTitleWrap}>
            <Text style={workspace.styles.aiHeaderTitle} numberOfLines={1}>
              {activeSession ? activeSession.title : '새 채팅'}
            </Text>
            {workspace.aiChatReadOnly ? (
              <Text style={workspace.styles.aiHeaderSubtitle} numberOfLines={1}>읽기 전용</Text>
            ) : null}
          </View>

          <View style={workspace.styles.aiHeaderActions}>
            {RAG_DEBUG_ENABLED ? (
              <Pressable
                style={[
                  workspace.styles.aiRagDevHeaderButton,
                  ragDebugOpen && workspace.styles.aiRagDevHeaderButtonActive,
                ]}
                onPress={() => setRagDebugOpen((current) => !current)}
              >
                <Text style={workspace.styles.aiRagDevHeaderButtonText}>RAG Dev</Text>
              </Pressable>
            ) : null}
            <View style={workspace.styles.aiTooltipAnchor}>
              <Pressable
                {...getTooltipTriggerProps('ai-chat-panel-mode', workspace.aiPanelMode === 'floating' ? '사이드바로 보기' : '플로팅으로 보기')}
                style={getAiHeaderButtonStyle('ai-chat-panel-mode')}
                onPress={() => {
                  hideTooltip('ai-chat-panel-mode');
                  togglePanelMode();
                }}
              >
                <MaterialCommunityIcons name={workspace.aiPanelMode === 'floating' ? 'dock-left' : 'window-restore'} size={18} color="#303744" />
              </Pressable>
              {renderAiTooltip('ai-chat-panel-mode', workspace.aiPanelMode === 'floating' ? '사이드바로 보기' : '플로팅으로 보기')}
            </View>
            <View style={workspace.styles.aiTooltipAnchor}>
              <Pressable
                {...getTooltipTriggerProps('ai-chat-new', '새 채팅')}
                style={getAiHeaderButtonStyle('ai-chat-new')}
                onPress={() => {
                  hideTooltip('ai-chat-new');
                  startNewChat();
                }}
                disabled={workspace.aiLoading}
              >
                <MaterialCommunityIcons name="square-edit-outline" size={18} color="#303744" />
              </Pressable>
              {renderAiTooltip('ai-chat-new', '새 채팅')}
            </View>
            <View style={workspace.styles.aiHeaderMenuWrap}>
              <Pressable
                {...getTooltipTriggerProps('ai-chat-list', '목록')}
                style={getAiHeaderButtonStyle('ai-chat-list')}
                onPress={() => {
                  hideTooltip('ai-chat-list');
                  workspace.onLoadAllAiChatSessions();
                  setHeaderMenuOpen((current) => !current);
                }}
                disabled={workspace.aiLoading}
              >
                <MaterialCommunityIcons name="dots-vertical" size={20} color="#303744" />
              </Pressable>
              {renderAiTooltip('ai-chat-list', '목록')}
              {headerMenuOpen ? (
                <View {...webFloatingDragExcludeProps} style={workspace.styles.aiHeaderRecentMenu}>
                  {recentSessions.length ? recentSessions.map((session: any) => {
                    const active = session.id === workspace.activeAiChatSessionId;
                    const contextMenuProps = {
                      onContextMenu: (event: { preventDefault?: () => void }) => {
                        event.preventDefault?.();
                        setMenuSessionId((current) => (current === session.id ? null : session.id));
                      },
                    } as any;
                    return (
                      <View
                        key={session.id}
                        style={[
                          workspace.styles.aiSidebarChatRowWrap,
                          menuSessionId === session.id && workspace.styles.aiSidebarChatRowWrapMenuOpen,
                        ]}
                      >
                        <Pressable
                          {...contextMenuProps}
                          style={[workspace.styles.aiHeaderRecentMenuItem, active && workspace.styles.aiHeaderRecentMenuItemActive]}
                          onPress={() => selectSession(session.id)}
                          onLongPress={() => setMenuSessionId((current) => (current === session.id ? null : session.id))}
                          delayLongPress={450}
                        >
                          <Text style={[workspace.styles.aiHeaderRecentMenuText, active && workspace.styles.aiHeaderRecentMenuTextActive]} numberOfLines={1}>
                            {session.title}
                          </Text>
                        </Pressable>
                        {menuSessionId === session.id ? (
                          <View style={[workspace.styles.aiSidebarContextMenu, workspace.styles.aiHeaderRecentContextMenu]}>
                            <Pressable style={workspace.styles.aiSidebarContextMenuItem} onPress={() => startEditingSession(session.id, session.title)}>
                              <MaterialCommunityIcons name="pencil-outline" size={15} color="#111827" />
                              <Text style={workspace.styles.aiSidebarContextMenuText}>이름 바꾸기</Text>
                            </Pressable>
                            <Pressable style={workspace.styles.aiSidebarContextMenuItem} onPress={() => confirmRemoveSession(session.id, session.title)}>
                              <MaterialCommunityIcons name="trash-can-outline" size={15} color="#C04B4B" />
                              <Text style={[workspace.styles.aiSidebarContextMenuText, workspace.styles.aiSidebarContextMenuDanger]}>삭제하기</Text>
                            </Pressable>
                          </View>
                        ) : null}
                      </View>
                    );
                  }) : (
                    <Text style={workspace.styles.aiSidebarEmptyText}>최근 대화가 없습니다</Text>
                  )}
                </View>
              ) : null}
            </View>
            <View style={workspace.styles.aiTooltipAnchor}>
              <Pressable
                {...getTooltipTriggerProps('ai-chat-close', '닫기')}
                style={getAiHeaderButtonStyle('ai-chat-close')}
                onPress={() => {
                  hideTooltip('ai-chat-close');
                  closeChatPanel();
                }}
              >
                <MaterialCommunityIcons name="close" size={20} color="#303744" />
              </Pressable>
              {renderAiTooltip('ai-chat-close', '닫기')}
            </View>
          </View>
        </View>

        {RAG_DEBUG_ENABLED && ragDebugOpen ? (
          <View
            {...webFloatingDragExcludeProps}
            style={[
              workspace.styles.aiRagDevPanel,
              {
                left: ragDevPosition.x,
                top: ragDevPosition.y,
                width: ragDevPanelWidth,
                height: ragDevPanelHeight,
              },
            ]}
          >
            <View style={workspace.styles.aiRagDevHeader} {...({ onPointerDown: handleRagDevPointerDown } as any)}>
              <View style={workspace.styles.aiRagDevTitleWrap}>
                <Text style={workspace.styles.aiRagDevTitle}>RAG 확인 도구</Text>
                <Text style={workspace.styles.aiRagDevSubtitle} numberOfLines={1}>검색 결과, 페이지별 index, 처리 상태를 확인합니다.</Text>
              </View>
              <Pressable
                style={workspace.styles.aiRagDevCloseButton}
                onPress={() => setRagDebugOpen(false)}
                {...({
                  onPointerDown: (event: any) => {
                    event.stopPropagation?.();
                    event.nativeEvent?.stopPropagation?.();
                  },
                } as any)}
              >
                <MaterialCommunityIcons name="close" size={17} color="#303744" />
              </Pressable>
            </View>
            <View style={workspace.styles.aiRagDevTabs}>
              {RAG_DEV_TABS.map((tab) => (
                <Pressable
                  key={tab}
                  style={[workspace.styles.aiRagDevTab, ragDevTab === tab && workspace.styles.aiRagDevTabActive]}
                  onPress={() => setRagDevTab(tab)}
                >
                  <Text style={[workspace.styles.aiRagDevTabText, ragDevTab === tab && workspace.styles.aiRagDevTabTextActive]}>
                    {RAG_DEV_TAB_LABELS[tab]}
                  </Text>
                </Pressable>
              ))}
            </View>
            <ScrollView style={workspace.styles.aiRagDevScroll} contentContainerStyle={workspace.styles.aiRagDevContent} showsVerticalScrollIndicator>
              {ragDebugError ? <Text style={workspace.styles.aiRagDevError}>{ragDebugError}</Text> : null}
              {ragDebugNotice ? <Text style={workspace.styles.aiRagDevMeta}>{ragDebugNotice}</Text> : null}
              {ragDevTab === 'search' ? (
                <View style={workspace.styles.aiRagDevSection}>
                  <Text style={workspace.styles.aiRagDevLabel}>검색 테스트 질문</Text>
                  <TextInput
                    value={ragDebugQuery}
                    onChangeText={setRagDebugQuery}
                    placeholder="RAG 검색을 테스트할 질문을 입력하세요"
                    placeholderTextColor="#8F96A3"
                    style={workspace.styles.aiRagDevInput}
                  />
                  <View style={workspace.styles.aiRagDevActions}>
                    <Pressable style={workspace.styles.aiRagDevPrimaryButton} onPress={runRagDevEvaluate} disabled={ragDebugLoading !== null}>
                      <Text style={workspace.styles.aiRagDevPrimaryButtonText}>{ragDebugLoading === 'evaluate' ? '검색 중' : '검색 결과 확인'}</Text>
                    </Pressable>
                  </View>
                  {ragDebugEvaluation ? (
                    <View style={workspace.styles.aiRagDevSection}>
                      <Text style={workspace.styles.aiRagDevMeta}>
                        mode {ragDebugEvaluation.mode} · scope {ragDebugEvaluation.debug?.scope_count ?? ragDebugEvaluation.ragScope?.sources.length ?? 0} · sources {ragDebugEvaluation.debug?.retrieved_source_count ?? 0} · chunks {ragDebugEvaluation.debug?.retrieved_chunk_count ?? 0}
                      </Text>
                      <Text style={workspace.styles.aiRagDevMeta} numberOfLines={1}>
                        context pages: {ragDebugEvaluation.debug?.context_page_count ?? 0}
                        {ragDebugEvaluation.debug?.context_page_number ? ` · current p.${ragDebugEvaluation.debug.context_page_number}` : ''}
                      </Text>
                      <Text style={workspace.styles.aiRagDevMeta} numberOfLines={2}>rewritten: {ragDebugEvaluation.rewritten_query}</Text>
                      <Text style={workspace.styles.aiRagDevMeta} numberOfLines={2}>reason: {ragDebugEvaluation.router_reason}</Text>
                      <Text style={workspace.styles.aiRagDevMeta} numberOfLines={2}>
                        scope: {(ragDebugEvaluation.ragScope?.sources ?? activeRagScopeSources).map((source) => `${source.type}:${source.title}`).join(', ') || '-'}
                      </Text>
                      {ragDebugEvaluation.debug?.image_recheck ? (
                        <Text style={workspace.styles.aiRagDevMeta} numberOfLines={3}>
                          image recheck: candidates {ragDebugEvaluation.debug.image_recheck.candidate_count ?? 0} · judge {ragDebugEvaluation.debug.image_recheck.judge_called ? 'yes' : 'no'} · needed {ragDebugEvaluation.debug.image_recheck.needed ? 'yes' : 'no'} · rechecked {ragDebugEvaluation.debug.image_recheck.rechecked_count ?? 0}
                          {ragDebugEvaluation.debug.image_recheck.items?.length ? ` · ${ragDebugEvaluation.debug.image_recheck.items.map((item) => `p.${item.page_number ?? '-'} ${item.image_mode ?? '-'}`).join(', ')}` : ''}
                          {ragDebugEvaluation.debug.image_recheck.judge?.reason ? ` · ${ragDebugEvaluation.debug.image_recheck.judge.reason}` : ''}
                        </Text>
                      ) : null}
                      <Text style={workspace.styles.aiRagDevSectionTitle}>검색된 상위 자료</Text>
                      {ragDebugEvaluation.results.length ? ragDebugEvaluation.results.map((result, index) => {
                        const key = `result:${result.source_type}:${result.source_id}:${result.chunk_index ?? index}`;
                        return (
                          <Pressable key={key} style={[workspace.styles.aiRagDevCard, ragDebugSelectedKey === key && workspace.styles.aiRagDevCardActive]} onPress={() => setRagDebugSelectedKey(key)}>
                            <Text style={workspace.styles.aiRagDevCardTitle} numberOfLines={1}>{index + 1}. {result.title}</Text>
                            <Text style={workspace.styles.aiRagDevMeta} numberOfLines={1}>
                              {result.source_type} · p.{result.page_number ?? '-'} · chunk {result.chunk_index ?? '-'} · score {typeof result.score === 'number' ? result.score.toFixed(4) : '-'}
                            </Text>
                            <Text style={workspace.styles.aiRagDevSnippet} numberOfLines={3}>{result.content_snippet}</Text>
                          </Pressable>
                        );
                      }) : (
                        <Text style={workspace.styles.aiRagDevEmpty}>검색 결과가 없습니다.</Text>
                      )}
                    </View>
                  ) : null}
                </View>
              ) : null}
              {ragDevTab === 'index' ? (
                <View style={workspace.styles.aiRagDevSection}>
                  <View style={workspace.styles.aiRagDevActions}>
                    <Pressable
                      style={workspace.styles.aiRagDevPrimaryButton}
                      onPress={runRagDevLoadIndex}
                      disabled={ragDebugLoading !== null}
                    >
                      <Text style={workspace.styles.aiRagDevPrimaryButtonText}>
                        {ragDebugLoading === 'index' ? '불러오는 중' : 'Docling 추출 불러오기'}
                      </Text>
                    </Pressable>
                    <Pressable
                      style={workspace.styles.aiRagDevSecondaryButton}
                      onPress={runRagDevReindex}
                      disabled={ragDebugLoading !== null}
                    >
                      <Text style={workspace.styles.aiRagDevSecondaryButtonText}>
                        {ragDebugLoading === 'reindex' ? '다시 만드는 중' : '현재 노트 검색 자료 다시 만들기'}
                      </Text>
                    </Pressable>
                  </View>
                  <View style={workspace.styles.aiRagDevActions}>
                    {([
                      ['pypdf_plain', 'pypdf 텍스트 추출'],
                      ['pymupdf', 'PyMuPDF 추출'],
                    ] as Array<[BackendRagDebugParserName, string]>).map(([parserName, label]) => {
                      const active = ragDebugParserCompareName === parserName;
                      const loading = ragDebugLoading === 'parserCompare' && active;
                      return (
                        <Pressable
                          key={parserName}
                          style={[
                            workspace.styles.aiRagDevParserButton,
                            active && workspace.styles.aiRagDevParserButtonActive,
                          ]}
                          onPress={() => runRagDevParserCompare(parserName)}
                          disabled={ragDebugLoading !== null}
                        >
                          <Text
                            style={[
                              workspace.styles.aiRagDevParserButtonText,
                              active && workspace.styles.aiRagDevParserButtonTextActive,
                            ]}
                          >
                            {loading ? '추출 중' : label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={workspace.styles.aiRagDevMeta}>
                    Docling 추출 불러오기는 이미 저장된 page text, text chunk, image summary chunk를 조회합니다. 다시 파싱하거나 embedding을 새로 만들지 않습니다.
                  </Text>
                  {ragDebugParserCompare ? (() => {
                    const pages = [...ragDebugParserCompare.pages].sort((a, b) => Number(a.page_number) - Number(b.page_number));
                    const parserLabel = ragDebugParserCompare.summary.parser === 'pypdf_plain'
                      ? 'pypdf 텍스트 추출'
                      : ragDebugParserCompare.summary.parser === 'pymupdf'
                        ? 'PyMuPDF 추출'
                        : ragDebugParserCompare.summary.parser;
                    return (
                      <View style={workspace.styles.aiRagDevSection}>
                        <Text style={workspace.styles.aiRagDevSectionTitle}>{parserLabel} 비교 결과</Text>
                        <Text style={workspace.styles.aiRagDevMeta}>
                          pages {ragDebugParserCompare.summary.page_count} · chunks {ragDebugParserCompare.summary.chunk_count} · text {ragDebugParserCompare.summary.text_length} chars · {Math.round(ragDebugParserCompare.summary.elapsed_ms)}ms
                        </Text>
                        {pages.length ? pages.map((page) => {
                          const pageParser = page.parser ?? ragDebugParserCompare.summary.parser;
                          const pageKey = getRagDebugParserPageKey(pageParser, page.page_number);
                          const pageChunks = ragDebugParserCompare.chunks.filter((chunk) => Number(chunk.page_number) === Number(page.page_number));
                          return (
                            <View key={pageKey} style={workspace.styles.aiRagDevCard}>
                              <Pressable
                                style={[workspace.styles.aiRagDevCard, ragDebugSelectedKey === pageKey && workspace.styles.aiRagDevCardActive]}
                                onPress={() => setRagDebugSelectedKey(pageKey)}
                              >
                                <Text style={workspace.styles.aiRagDevCardTitle}>Page {page.page_number} · {page.text_length} chars</Text>
                                <Text style={workspace.styles.aiRagDevSnippet} numberOfLines={3}>{page.text_snippet || page.text || '추출된 텍스트 없음'}</Text>
                              </Pressable>
                              {pageChunks.length ? pageChunks.map((chunk, index) => {
                                const chunkKey = getRagDebugParserChunkKey(chunk, index);
                                return (
                                  <Pressable
                                    key={chunkKey}
                                    style={[workspace.styles.aiRagDevCard, ragDebugSelectedKey === chunkKey && workspace.styles.aiRagDevCardActive]}
                                    onPress={() => setRagDebugSelectedKey(chunkKey)}
                                  >
                                    <Text style={workspace.styles.aiRagDevCardTitle}>chunk {chunk.chunk_index ?? index} · {chunk.content_length} chars</Text>
                                    <Text style={workspace.styles.aiRagDevSnippet} numberOfLines={2}>{chunk.content_snippet || chunk.content || 'chunk 없음'}</Text>
                                  </Pressable>
                                );
                              }) : (
                                <Text style={workspace.styles.aiRagDevEmpty}>이 페이지에는 비교용 chunk가 없습니다.</Text>
                              )}
                            </View>
                          );
                        }) : (
                          <Text style={workspace.styles.aiRagDevEmpty}>비교 추출 결과가 없습니다.</Text>
                        )}
                      </View>
                    );
                  })() : null}
                  {ragDebugIndex ? (() => {
                    const pages = [...ragDebugIndex.pages].sort((a, b) => Number(a.page_number) - Number(b.page_number));
                    const sourceCounts = Object.entries(ragDebugIndex.summary.source_counts ?? {})
                      .map(([sourceType, count]) => `${sourceType} ${count}`)
                      .join(' · ');
                    return (
                      <View style={workspace.styles.aiRagDevSection}>
                        <Text style={workspace.styles.aiRagDevSectionTitle} numberOfLines={1}>{ragDebugIndex.note.title}</Text>
                        <Text style={workspace.styles.aiRagDevMeta}>
                          pages {ragDebugIndex.summary.page_count} · chunks {ragDebugIndex.summary.chunk_count} · returned {ragDebugIndex.summary.chunks_returned}/{ragDebugIndex.summary.chunk_limit}
                        </Text>
                        <Text style={workspace.styles.aiRagDevMeta} numberOfLines={2}>
                          status {ragDebugIndex.summary.index_status} · parser {ragDebugIndex.summary.parser ?? '-'} · model {(ragDebugIndex.summary.embedding_models ?? []).join(', ') || ragDebugIndex.summary.embedding_model || '-'}
                        </Text>
                        {sourceCounts ? <Text style={workspace.styles.aiRagDevMeta} numberOfLines={2}>source: {sourceCounts}</Text> : null}
                        {ragDebugIndex.summary.last_error ? <Text style={workspace.styles.aiRagDevError}>index error: {ragDebugIndex.summary.last_error}</Text> : null}
                        {ragDebugIndex.summary.image_summary_error ? <Text style={workspace.styles.aiRagDevError}>image summary error: {ragDebugIndex.summary.image_summary_error}</Text> : null}
                        {pages.length ? pages.map((page) => {
                          const pageNumber = Number(page.page_number);
                          const textChunks = ragDebugIndex.chunks.filter((chunk) => chunk.source_type === 'pdf_page' && Number(chunk.page_number) === pageNumber);
                          const imageChunks = ragDebugIndex.chunks.filter((chunk) => chunk.source_type === 'image_ai_summary' && Number(chunk.page_number) === pageNumber);
                          const imageSummaries = ragDebugIndex.image_ai_summaries.filter((summary) => (
                            Number(summary.page_number) === pageNumber
                            && summary.skipped_reason !== 'stale_candidate'
                          ));
                          return (
                            <View key={`index:page:${pageNumber}`} style={workspace.styles.aiRagDevCard}>
                              <Text style={workspace.styles.aiRagDevCardTitle}>Page {pageNumber}</Text>
                              <Text style={workspace.styles.aiRagDevMeta} numberOfLines={2}>
                                text chunks {textChunks.length} · image summaries {imageSummaries.length} · indexed image chunks {imageChunks.length} · page text {page.text_length} chars
                              </Text>
                              <Text style={workspace.styles.aiRagDevMeta} numberOfLines={1}>
                                parser {page.parser ?? '-'} · text blocks {page.text_block_count} · image blocks {page.image_block_count} · visual blocks {page.visual_block_count}
                              </Text>
                              <Text style={workspace.styles.aiRagDevSectionTitle}>텍스트 embedding 입력</Text>
                              {textChunks.length ? textChunks.map((chunk, index) => {
                                const chunkIndex = ragDebugIndex.chunks.indexOf(chunk);
                                const key = getRagDebugIndexChunkKey(chunk, chunkIndex >= 0 ? chunkIndex : index);
                                return (
                                  <Pressable key={key} style={[workspace.styles.aiRagDevCard, ragDebugSelectedKey === key && workspace.styles.aiRagDevCardActive]} onPress={() => setRagDebugSelectedKey(key)}>
                                    <Text style={workspace.styles.aiRagDevCardTitle}>chunk {chunk.chunk_index ?? index} · {chunk.content_length ?? chunk.content.length} chars</Text>
                                    <Text style={workspace.styles.aiRagDevSnippet} numberOfLines={3}>{chunk.content_snippet || chunk.content || '내용 없음'}</Text>
                                  </Pressable>
                                );
                              }) : (
                                <Text style={workspace.styles.aiRagDevEmpty}>이 페이지에는 text embedding 입력이 없습니다.</Text>
                              )}
                              <Text style={workspace.styles.aiRagDevSectionTitle}>이미지 summary embedding 입력</Text>
                              {imageChunks.length ? imageChunks.map((chunk, index) => {
                                const chunkIndex = ragDebugIndex.chunks.indexOf(chunk);
                                const key = getRagDebugIndexChunkKey(chunk, chunkIndex >= 0 ? chunkIndex : index);
                                const confidence = typeof chunk.metadata?.confidence === 'string' ? chunk.metadata.confidence : '-';
                                const importance = typeof chunk.metadata?.importance === 'string' ? chunk.metadata.importance : '-';
                                return (
                                  <Pressable key={key} style={[workspace.styles.aiRagDevCard, ragDebugSelectedKey === key && workspace.styles.aiRagDevCardActive]} onPress={() => setRagDebugSelectedKey(key)}>
                                    <Text style={workspace.styles.aiRagDevCardTitle}>{getRagDebugImageChunkLabel(chunk, index)} · {chunk.content_length ?? chunk.content.length} chars</Text>
                                    <Text style={workspace.styles.aiRagDevMeta} numberOfLines={1}>confidence {confidence} · importance {importance}</Text>
                                    <Text style={workspace.styles.aiRagDevSnippet} numberOfLines={3}>{chunk.content_snippet || chunk.content || '내용 없음'}</Text>
                                  </Pressable>
                                );
                              }) : imageSummaries.length ? (
                                <View style={workspace.styles.aiRagDevSection}>
                                  <Text style={workspace.styles.aiRagDevEmpty}>저장된 이미지 요약은 있지만 아직 embedding 대상 chunk는 없습니다.</Text>
                                  {imageSummaries.map((summary) => {
                                    const key = `index:image-summary:${summary.id}`;
                                    return (
                                      <Pressable key={key} style={[workspace.styles.aiRagDevCard, ragDebugSelectedKey === key && workspace.styles.aiRagDevCardActive]} onPress={() => setRagDebugSelectedKey(key)}>
                                        <Text style={workspace.styles.aiRagDevCardTitle}>summary {summary.id} · {summary.status ?? '-'} · importance {summary.importance ?? '-'}</Text>
                                        <Text style={workspace.styles.aiRagDevMeta} numberOfLines={1}>indexed {summary.indexed ? 'yes' : 'no'} · confidence {summary.confidence ?? '-'}</Text>
                                        <Text style={workspace.styles.aiRagDevSnippet} numberOfLines={3}>{summary.summary_snippet || summary.summary || summary.skipped_reason || '요약 내용 없음'}</Text>
                                      </Pressable>
                                    );
                                  })}
                                </View>
                              ) : (
                                <Text style={workspace.styles.aiRagDevEmpty}>이 페이지에는 이미지 요약 자료가 없습니다.</Text>
                              )}
                            </View>
                          );
                        }) : (
                          <Text style={workspace.styles.aiRagDevEmpty}>저장된 페이지가 없습니다.</Text>
                        )}
                      </View>
                    );
                  })() : (
                    <Text style={workspace.styles.aiRagDevEmpty}>Docling 추출 불러오기를 누르면 저장된 페이지별 검색 자료가 표시됩니다.</Text>
                  )}
                </View>
              ) : null}
              {ragDevTab === 'context' ? (
                <View style={workspace.styles.aiRagDevSection}>
                  {ragDebugEvaluation?.context ? (
                    <>
                      <Text style={workspace.styles.aiRagDevSectionTitle}>최근 검색 테스트 Context</Text>
                      <Text style={workspace.styles.aiRagDevMeta}>
                        mode {ragDebugEvaluation.context.mode} · scope {ragDebugEvaluation.context.scope_count} · sources {ragDebugEvaluation.context.source_count} · chunks {ragDebugEvaluation.context.retrieved_chunk_count}
                      </Text>
                      <Text style={workspace.styles.aiRagDevMeta}>
                        current page {ragDebugEvaluation.context.current_page_included ? 'yes' : 'no'} · nearby {ragDebugEvaluation.context.nearby_pages_included ? 'yes' : 'no'} · canvas {ragDebugEvaluation.context.canvas_context_included ? 'yes' : 'no'} · vision {ragDebugEvaluation.context.vision_image_attached ? 'yes' : 'no'}
                      </Text>
                      {ragDebugEvaluation.context.fallback ? (
                        <Text style={workspace.styles.aiRagDevError}>fallback: {ragDebugEvaluation.context.fallback_reason ?? '-'}</Text>
                      ) : null}
                      {ragDebugEvaluation.context.context_preview ? (
                        <View style={workspace.styles.aiRagDevCard}>
                          <Text style={workspace.styles.aiRagDevCardTitle}>최종 context preview</Text>
                          <Text style={workspace.styles.aiRagDevSnippet} numberOfLines={6}>{ragDebugEvaluation.context.context_preview}</Text>
                        </View>
                      ) : null}
                      {ragDebugEvaluation.context.sections.map((section) => (
                        <View key={`context-section:${section.title}`} style={workspace.styles.aiRagDevSection}>
                          <Text style={workspace.styles.aiRagDevSectionTitle}>{section.title} · {section.count}</Text>
                          {section.items.length ? section.items.map((item, index) => {
                            const key = `context:${section.title}:${item.source_type}:${item.source_id ?? 'none'}:${item.chunk_index ?? index}`;
                            return (
                              <Pressable
                                key={key}
                                style={[workspace.styles.aiRagDevCard, ragDebugSelectedKey === key && workspace.styles.aiRagDevCardActive]}
                                onPress={() => setRagDebugSelectedKey(key)}
                              >
                                <Text style={workspace.styles.aiRagDevCardTitle} numberOfLines={1}>{item.title}</Text>
                                <Text style={workspace.styles.aiRagDevMeta} numberOfLines={1}>
                                  {item.source_type} · p.{item.page_number ?? '-'} · chunk {item.chunk_index ?? '-'} · {item.content_length} chars
                                </Text>
                                <Text style={workspace.styles.aiRagDevSnippet} numberOfLines={3}>{item.content_snippet || item.content || '내용 없음'}</Text>
                              </Pressable>
                            );
                          }) : (
                            <Text style={workspace.styles.aiRagDevEmpty}>이 섹션에는 context가 없습니다.</Text>
                          )}
                        </View>
                      ))}
                    </>
                  ) : (
                    <Text style={workspace.styles.aiRagDevEmpty}>검색 테스트를 먼저 실행하면 실제 요청 context가 여기에 표시됩니다.</Text>
                  )}
                </View>
              ) : null}
              {ragDevTab === 'status' ? (
                <View style={workspace.styles.aiRagDevSection}>
                  <View style={workspace.styles.aiRagDevActions}>
                    <Pressable style={workspace.styles.aiRagDevPrimaryButton} onPress={runRagDevStatus} disabled={ragDebugLoading !== null}>
                      <Text style={workspace.styles.aiRagDevPrimaryButtonText}>{ragDebugLoading === 'status' ? '확인 중' : '처리 상태 새로고침'}</Text>
                    </Pressable>
                  </View>
                  {ragDebugStatus ? (
                    (() => {
                      const doclingBatches = Array.isArray(ragDebugStatus.docling_batches) ? ragDebugStatus.docling_batches : [];
                      const embeddingModels = Array.isArray(ragDebugStatus.embedding_models) ? ragDebugStatus.embedding_models : [];
                      const recentIndexStatus = Array.isArray(ragDebugStatus.recent_index_status) ? ragDebugStatus.recent_index_status : [];
                      const imageSummaryStatus = Array.isArray(ragDebugStatus.image_summary_status) ? ragDebugStatus.image_summary_status : [];
                      const recentImageSummaries = Array.isArray(ragDebugStatus.recent_image_summaries) ? ragDebugStatus.recent_image_summaries : [];
                      return (
                    <View style={workspace.styles.aiRagDevSection}>
                      <Text style={workspace.styles.aiRagDevMeta}>pgvector {ragDebugStatus.pgvector_available ? 'available' : 'not available'}</Text>
                      <Text style={workspace.styles.aiRagDevSectionTitle}>현재 노트 처리 작업</Text>
                      {ragDebugStatus.rag_job ? (
                        <>
                          <Text style={workspace.styles.aiRagDevMeta}>
                            text {ragDebugStatus.rag_job.text_status ?? '-'} · image {ragDebugStatus.rag_job.image_status ?? '-'} · overall {ragDebugStatus.rag_job.overall_status ?? '-'}
                          </Text>
                          <Text style={workspace.styles.aiRagDevMeta}>
                            pages {ragDebugStatus.rag_job.processed_page_count}/{ragDebugStatus.rag_job.page_count} · batches {ragDebugStatus.rag_job.completed_batches}/{ragDebugStatus.rag_job.total_batches}
                          </Text>
                          <Text style={workspace.styles.aiRagDevMeta}>
                            text chunks {ragDebugStatus.rag_job.text_chunk_count} · image candidates {ragDebugStatus.rag_job.image_candidate_count} · image indexed {ragDebugStatus.rag_job.image_indexed_count}
                          </Text>
                          {ragDebugStatus.rag_job.last_error ? <Text style={workspace.styles.aiRagDevError}>job error: {ragDebugStatus.rag_job.last_error}</Text> : null}
                        </>
                      ) : <Text style={workspace.styles.aiRagDevEmpty}>아직 처리 작업 기록이 없습니다.</Text>}
                      <Text style={workspace.styles.aiRagDevSectionTitle}>Docling 페이지 묶음 처리</Text>
                      {doclingBatches.length ? doclingBatches.map((item, index) => (
                        <Text key={`${item.status}:${index}`} style={workspace.styles.aiRagDevMeta}>
                          {item.status ?? '-'} · {item.count} batches · pages {item.page_start ?? '-'}-{item.page_end ?? '-'}
                        </Text>
                      )) : <Text style={workspace.styles.aiRagDevEmpty}>아직 Docling 처리 기록이 없습니다.</Text>}
                      <Text style={workspace.styles.aiRagDevMeta}>total chunks {ragDebugStatus.document_chunks_total_count} · current note {ragDebugStatus.current_note_chunk_count} · current scope {ragDebugStatus.current_scope_chunk_count}</Text>
                      <Text style={workspace.styles.aiRagDevSectionTitle}>Embedding 모델</Text>
                      {embeddingModels.length ? embeddingModels.map((item) => <Text key={item.model} style={workspace.styles.aiRagDevMeta}>{item.model} · {item.count}</Text>) : <Text style={workspace.styles.aiRagDevEmpty}>저장된 embedding 모델 정보가 없습니다.</Text>}
                      <Text style={workspace.styles.aiRagDevSectionTitle}>최근 index 상태</Text>
                      {recentIndexStatus.length ? recentIndexStatus.map((item, index) => (
                        <Text key={`${item.note_id}:${item.source_type}:${index}`} style={workspace.styles.aiRagDevMeta}>note {item.note_id ?? '-'} · {item.source_type ?? '-'} · chunks {item.chunk_count} · {item.last_indexed_at ?? '-'}</Text>
                      )) : <Text style={workspace.styles.aiRagDevEmpty}>최근 index 기록이 없습니다.</Text>}
                      <Text style={workspace.styles.aiRagDevSectionTitle}>이미지 AI 요약</Text>
                      {imageSummaryStatus.length ? imageSummaryStatus.map((item, index) => (
                        <Text key={`${item.status}:${item.importance}:${item.indexed}:${index}`} style={workspace.styles.aiRagDevMeta}>
                          {item.status ?? '-'} · importance {item.importance ?? '-'} · indexed {item.indexed ? 'yes' : 'no'} · {item.count}
                        </Text>
                      )) : <Text style={workspace.styles.aiRagDevEmpty}>이미지 AI 요약 기록이 없습니다.</Text>}
                      {recentImageSummaries.length ? recentImageSummaries.map((item) => (
                        <Text key={`image-summary:${item.id}`} style={workspace.styles.aiRagDevMeta} numberOfLines={2}>
                          p.{item.page_number ?? '-'} · {item.candidate_type ?? '-'} · {item.status ?? '-'} · conf {item.confidence ?? '-'} · imp {item.importance ?? '-'} · indexed {item.indexed ? 'yes' : 'no'} · {item.summary_snippet || item.skipped_reason || '-'}
                        </Text>
                      )) : null}
                      {ragDebugStatus.last_error ? <Text style={workspace.styles.aiRagDevError}>last error: {ragDebugStatus.last_error}</Text> : null}
                      {ragDebugStatus.image_summary_error ? <Text style={workspace.styles.aiRagDevError}>image summary error: {ragDebugStatus.image_summary_error}</Text> : null}
                    </View>
                      );
                    })()
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
            <View style={workspace.styles.aiRagDevDetail}>
              {ragDebugDetail ? (
                <>
                  <Text style={workspace.styles.aiRagDevDetailTitle} numberOfLines={2}>{ragDebugDetail.title}</Text>
                  <Text style={workspace.styles.aiRagDevMeta} numberOfLines={2}>{ragDebugDetail.meta}</Text>
                  <ScrollView style={workspace.styles.aiRagDevDetailScroll} contentContainerStyle={workspace.styles.aiRagDevDetailScrollContent} showsVerticalScrollIndicator>
                    {ragDebugImagePreviewLoading ? (
                      <Text style={workspace.styles.aiRagDevMeta}>이미지 미리보기를 불러오는 중입니다.</Text>
                    ) : null}
                    {ragDebugImagePreviewError ? (
                      <Text style={workspace.styles.aiRagDevError}>{ragDebugImagePreviewError}</Text>
                    ) : null}
                    {ragDebugImagePreview ? (
                      <>
                        <Text style={workspace.styles.aiRagDevMeta}>
                          confidence {ragDebugImagePreview.confidence ?? '-'} · importance {ragDebugImagePreview.importance ?? '-'} · indexed {ragDebugImagePreview.indexed ? 'yes' : 'no'}
                        </Text>
                        {ragDebugImagePreview.confidence_reason || ragDebugImagePreview.importance_reason ? (
                          <Text style={workspace.styles.aiRagDevMeta}>
                            confidence 이유: {ragDebugImagePreview.confidence_reason || '-'}{'\n'}
                            importance 이유: {ragDebugImagePreview.importance_reason || '-'}
                          </Text>
                        ) : null}
                        <View style={workspace.styles.aiRagDevCropDetailGrid}>
                          <View style={workspace.styles.aiRagDevCropDetailItem}>
                            <Text style={workspace.styles.aiRagDevMeta}>요약에 사용한 주변 포함 이미지</Text>
                            <Image source={{ uri: ragDebugImagePreview.context_crop_data_uri }} style={workspace.styles.aiRagDevCropDetailImage} resizeMode="contain" />
                          </View>
                          <View style={workspace.styles.aiRagDevCropDetailItem}>
                            <Text style={workspace.styles.aiRagDevMeta}>Docling이 잡은 원본 이미지 영역</Text>
                            <Image source={{ uri: ragDebugImagePreview.image_crop_data_uri }} style={workspace.styles.aiRagDevCropDetailImage} resizeMode="contain" />
                          </View>
                        </View>
                      </>
                    ) : null}
                    <Text style={workspace.styles.aiRagDevDetailText}>{ragDebugDetail.text || '상세 내용이 없습니다.'}</Text>
                  </ScrollView>
                </>
              ) : (
                <Text style={workspace.styles.aiRagDevEmpty}>위 목록에서 page나 chunk를 선택하면 상세 내용이 여기에 표시됩니다.</Text>
              )}
            </View>
          </View>
        ) : null}

        <View {...webFloatingDragExcludeProps} style={workspace.styles.aiConversationShell}>
          <View style={workspace.styles.aiMessagesViewport}>
            <ScrollView
              ref={messagesScrollRef}
              style={workspace.styles.aiMessagesScroll}
              contentContainerStyle={[
                workspace.styles.aiMessagesContent,
                Platform.OS === 'web' && workspace.styles.aiMessagesContentWeb,
              ]}
              showsVerticalScrollIndicator={false}
              scrollEventThrottle={16}
              onScroll={handleMessagesScroll}
              onScrollBeginDrag={() => {
                if (Platform.OS !== 'web') Keyboard.dismiss();
              }}
              onLayout={updateMessagesViewportHeight}
              onContentSizeChange={updateMessagesContentHeight}
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              keyboardShouldPersistTaps="handled"
            >
          {hasChatHistory ? workspace.aiMessages.map((message: any) => {
            const isUser = message.role === 'user';
            return (
              <View
                key={message.id}
                style={[workspace.styles.aiMessageBubble, isUser ? workspace.styles.aiMessageBubbleUser : workspace.styles.aiMessageBubbleAssistant]}
              >
                {isUser && message.selection_image_url ? (
                  <Image source={{ uri: message.selection_image_url }} style={workspace.styles.aiMessageAttachmentImage} resizeMode="cover" />
                ) : null}
                {isUser ? (
                  <Text style={[workspace.styles.aiMessageText, workspace.styles.aiMessageTextUser]}>{message.content}</Text>
                ) : (
                  <AiResponseContent
                    content={message.content}
                    pageCount={workspace.studyDocument?.pageCount}
                    styles={workspace.styles}
                    textStyle={[workspace.styles.aiMessageText, workspace.styles.aiMessageTextAssistant]}
                    linkStyle={workspace.styles.aiMessagePageLink}
                    onOpenPage={openLinkedPdfPage}
                    onRequestMoreRecommendations={canRequestMoreImportantPages ? requestMoreImportantPages : undefined}
                    moreRecommendationsDisabled={workspace.aiLoading || workspace.aiChatReadOnly}
                  />
                )}
              </View>
            );
          }) : (
            <View style={workspace.styles.aiEmptyConversation}>
              <Text style={workspace.styles.aiEmptyConversationTitle}>무엇을 도와드릴까요?</Text>
              <Text style={workspace.styles.aiEmptyConversationBody}>궁금한 부분에 대해 질문해 보세요.</Text>
            </View>
          )}
          {workspace.aiLoading ? (
            <View style={[workspace.styles.aiMessageBubble, workspace.styles.aiMessageBubbleAssistant]}>
              <Text style={[workspace.styles.aiMessageText, workspace.styles.aiMessageTextAssistant]}>···</Text>
            </View>
          ) : null}
            </ScrollView>
            {Platform.OS === 'web' ? <View pointerEvents="none" style={workspace.styles.aiMessagesTopFade} /> : null}
            {Platform.OS === 'web' ? (
            <View
              pointerEvents={messageScrollbarMetrics.visible ? 'auto' : 'none'}
              style={workspace.styles.aiCustomScrollbarTrack}
              onLayout={updateMessagesTrackHeight}
            >
              {messageScrollbarMetrics.visible ? (
              <View
                style={[
                  workspace.styles.aiCustomScrollbarThumb,
                  {
                    top: messageScrollbarMetrics.thumbTop,
                    height: messageScrollbarMetrics.thumbHeight,
                  },
                ]}
                {...({ onPointerDown: handleWebMessageScrollbarPointerDown } as any)}
              />
            ) : null}
              </View>
            ) : null}
          </View>

        <View style={workspace.styles.aiComposer}>
          {Platform.OS === 'web' ? (
            <View style={workspace.styles.aiRagScopePanel}>
              {activeRagScopeSources.length > 0 && noteRagStatusDisplay?.progressLabel ? (
                <View style={workspace.styles.aiRagProgressHint}>
                  <ActivityIndicator size="small" color="#7A8394" />
                  <Text style={workspace.styles.aiRagProgressHintText} numberOfLines={1}>
                    {noteRagStatusDisplay.progressLabel}
                  </Text>
                </View>
              ) : null}
              <Pressable
                style={workspace.styles.aiRagScopeHeader}
                onPress={() => workspace.onToggleAiRagScopeCollapsed?.()}
              >
                <Text style={workspace.styles.aiRagScopeTitle} numberOfLines={1}>{ragScopeTitle}</Text>
                <MaterialCommunityIcons name={workspace.aiRagScopeCollapsed ? 'chevron-right' : 'chevron-down'} size={17} color="#465064" />
              </Pressable>
              {!workspace.aiRagScopeCollapsed ? (
                <View style={workspace.styles.aiRagScopeList}>
                  {activeRagScopeSources.map((source) => {
                    const key = `${source.type}:${source.id}`;
                    return (
                      <View key={key} style={workspace.styles.aiRagScopeItem}>
                        <MaterialCommunityIcons name={source.type === 'canvas_note' ? 'note-edit-outline' : 'file-document-outline'} size={14} color="#5F79FF" />
                        <Text style={workspace.styles.aiRagScopeItemText} numberOfLines={1}>{source.title}</Text>
                        <Pressable
                          style={workspace.styles.aiRagScopeRemove}
                          onPress={() => workspace.onRemoveAiRagScopeSource?.(key)}
                        >
                          <MaterialCommunityIcons name="close" size={14} color="#6A7280" />
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </View>
          ) : null}
          {workspace.aiChatReadOnly ? (
            <View style={workspace.styles.aiReadOnlyNotice}>
              <MaterialCommunityIcons name="lock-outline" size={14} color="#5B6472" />
              <Text style={workspace.styles.aiReadOnlyNoticeText}>현재 대화는 다른 노트의 대화라서 읽기만 가능해요.</Text>
              <Pressable style={workspace.styles.aiReadOnlyReturnButton} onPress={returnToCurrentNoteSession}>
                <Text style={workspace.styles.aiReadOnlyReturnText}>돌아가기</Text>
              </Pressable>
            </View>
          ) : null}
          {workspace.selectionPreviewUri ? (
            <View style={workspace.styles.aiSelectionAttachment}>
              <Image source={{ uri: workspace.selectionPreviewUri }} style={workspace.styles.aiSelectionAttachmentImage} resizeMode="contain" />
              <Pressable
                style={workspace.styles.aiSelectionAttachmentRemove}
                onPress={() => {
                  workspace.onSelectionPreviewChange(null);
                  workspace.onSelectionChange(null);
                }}
              >
                <MaterialCommunityIcons name="close" size={12} color="#FFFFFF" />
              </Pressable>
            </View>
          ) : null}
          {workspace.aiError ? <Text style={workspace.styles.aiErrorText}>{workspace.aiError}</Text> : null}
          {showQuickPrompts ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={workspace.styles.aiComposerQuickRow}
              keyboardShouldPersistTaps="always"
            >
              {quickPrompts.map((prompt) => (
                <Pressable
                  key={prompt.label}
                  style={workspace.styles.aiComposerQuickChip}
                  onPress={() => workspace.onChangeAiQuestion(prompt.question)}
                  disabled={workspace.aiLoading}
                >
                  <Text style={workspace.styles.aiComposerQuickChipText}>{prompt.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <View
            style={[
              workspace.styles.aiComposerInputShell,
              Platform.OS !== 'web' && workspace.styles.aiComposerInputShellStandalone,
            ]}
            {...webRagMenuInteractiveProps}
          >
            {ragMenuOpen && Platform.OS === 'web' ? (
              <View style={workspace.styles.aiRagScopeMenu}>
                <Text style={workspace.styles.aiRagScopeMenuTitle}>참고 자료 추가</Text>
                {filteredRagCandidates.length ? filteredRagCandidates.map((source) => (
                  <Pressable
                    key={`${source.type}:${source.id}`}
                    style={workspace.styles.aiRagScopeMenuItem}
                    onPress={Platform.OS === 'web' ? undefined : () => addRagReference(source)}
                    {...getWebRagMenuItemProps(source)}
                  >
                    <MaterialCommunityIcons name={source.type === 'canvas_note' ? 'note-edit-outline' : 'file-document-outline'} size={15} color="#5F79FF" />
                    <Text style={workspace.styles.aiRagScopeMenuItemText} numberOfLines={1}>{source.title}</Text>
                  </Pressable>
                )) : (
                  <Text style={workspace.styles.aiRagScopeMenuEmpty}>추가할 참고 자료가 없어요.</Text>
                )}
              </View>
            ) : null}
            {modelMenuOpen ? (
              <View style={workspace.styles.aiModelMenu} {...webModelMenuInteractiveProps}>
                {AI_CHAT_MODEL_OPTIONS.map((model) => {
                  const selected = model.id === selectedAiModelId;
                  return (
                    <Pressable
                      key={model.id}
                      style={[workspace.styles.aiModelMenuItem, selected && workspace.styles.aiModelMenuItemActive]}
                      onPress={() => {
                        setSelectedAiModelId(model.id);
                        closeModelMenu();
                      }}
                      disabled={workspace.aiChatReadOnly || workspace.aiLoading}
                    >
                      <MaterialCommunityIcons name={model.icon as any} size={16} color={model.iconColor} />
                      <Text style={workspace.styles.aiModelMenuItemText} numberOfLines={1}>{model.label}</Text>
                      {selected ? (
                        <MaterialCommunityIcons name="check" size={16} color="#303744" />
                      ) : (
                        <View style={workspace.styles.aiModelMenuCheckPlaceholder} />
                      )}
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            <TextInput
              ref={aiQuestionInputRef}
              value={workspace.aiQuestion}
              onChangeText={handleAiQuestionChange}
              onFocus={() => workspace.onFocusWorkspaceTarget?.(null)}
              placeholder={workspace.selectionRect || workspace.selectionPreviewUri ? '이 부분이 궁금하신가요?' : '메시지 입력'}
              placeholderTextColor="#8F96A3"
              multiline
              editable={!workspace.aiChatReadOnly && !workspace.aiLoading}
              showSoftInputOnFocus
              style={[
                workspace.styles.aiComposerInput,
                { height: aiComposerInputHeight },
              ]}
              onContentSizeChange={handleAiQuestionContentSizeChange}
              scrollEnabled={aiComposerInputHeight >= AI_COMPOSER_INPUT_MAX_HEIGHT}
              submitBehavior="submit"
              blurOnSubmit={false}
              onSubmitEditing={() => {
                void workspace.onRequestAiAnswer();
              }}
              onKeyPress={handleAiComposerKeyPress}
            />
            <View style={workspace.styles.aiComposerActionRow}>
              {Platform.OS === 'web' ? (
                <Pressable
                  style={workspace.styles.aiRagScopeAddButton}
                  onPress={() => {
                    if (ragMenuOpen) {
                      closeRagReferenceMenu({ focusComposer: true });
                      return;
                    }
                    closeModelMenu();
                    setRagMenuOpen(true);
                    setRagMenuQuery('');
                  }}
                  disabled={workspace.aiChatReadOnly || workspace.aiLoading}
                >
                  <MaterialCommunityIcons name="plus" size={18} color="#5B6472" />
                </Pressable>
              ) : null}
              <View style={workspace.styles.aiComposerActionSpacer} />
              <Pressable
                style={[
                  workspace.styles.aiComposerModeButton,
                  modelMenuOpen && workspace.styles.aiComposerModeButtonActive,
                ]}
                onPress={() => {
                  closeRagReferenceMenu();
                  setModelMenuOpen((open) => !open);
                }}
                disabled={workspace.aiChatReadOnly || workspace.aiLoading}
                {...webModelMenuInteractiveProps}
              >
                <Text style={workspace.styles.aiComposerModeText}>{selectedAiModel.label}</Text>
                <MaterialCommunityIcons name="chevron-down" size={15} color="#5B6472" />
              </Pressable>
              <View style={workspace.styles.aiTooltipAnchor}>
              <Pressable
                {...getTooltipTriggerProps('ai-chat-send', '전송')}
                style={[workspace.styles.aiSendButton, workspace.aiChatReadOnly && workspace.styles.aiSendButtonDisabled]}
                onPress={() => {
                  hideTooltip('ai-chat-send');
                  void workspace.onRequestAiAnswer();
                }}
                disabled={workspace.aiLoading || workspace.aiChatReadOnly}
              >
                {workspace.aiLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialCommunityIcons name="arrow-up" size={18} color="#FFFFFF" />}
              </Pressable>
              {renderAiTooltip('ai-chat-send', '전송', 'above')}
            </View>
          </View>
        </View>
      </View>
      </View>
      </Animated.View>
      {workspace.aiPanelMode === 'sidebar' && !workspace.usesAppAiPanelLayout ? (
        <View
          style={workspace.styles.aiPanelSidebarResizeHandle}
          {...({
            onPointerDown: handleWebSidebarResizePointerDown,
            onMouseEnter: () => setSidebarResizeActive(true),
            onMouseLeave: () => {
              if (!sidebarResizeDraggingRef.current) setSidebarResizeActive(false);
            },
          } as any)}
        >
          <View
            style={[
              workspace.styles.aiPanelResizeRail,
              sidebarResizeActive && workspace.styles.aiPanelResizeRailActive,
            ]}
          />
        </View>
      ) : null}
      {workspace.aiPanelMode === 'floating' && !appChatSidebar ? (
        <View style={workspace.styles.aiPanelFloatingResizeHandle} {...floatingResizePanResponder.panHandlers}>
          <MaterialCommunityIcons name="resize-bottom-right" size={16} color="#687386" />
        </View>
      ) : null}
      {editingSessionId !== null ? (
        <Pressable style={workspace.styles.aiPanelDialogOverlay} onPress={cancelEditingSession}>
          <Pressable style={workspace.styles.aiRenameModalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={workspace.styles.aiRenameModalTitle}>채팅 이름 변경</Text>
            <TextInput
              value={editingTitle}
              onChangeText={(value) => {
                setEditingTitle(value);
                if (editingTitleError && value.trim()) setEditingTitleError(null);
              }}
              placeholder="채팅 이름"
              placeholderTextColor="#8F96A3"
              style={[workspace.styles.aiRenameModalInput, editingTitleError && workspace.styles.aiRenameModalInputError]}
              returnKeyType="done"
              onSubmitEditing={saveEditingSession}
              autoFocus
              showSoftInputOnFocus
            />
            {editingTitleError ? <Text style={workspace.styles.aiRenameModalError}>{editingTitleError}</Text> : null}
            <View style={workspace.styles.aiRenameModalActions}>
              <Pressable style={workspace.styles.aiRenameModalCancelButton} onPress={cancelEditingSession} disabled={workspace.aiLoading}>
                <Text style={workspace.styles.aiRenameModalCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[workspace.styles.aiRenameModalSaveButton, (!editingTitle.trim() || workspace.aiLoading) && workspace.styles.aiRenameModalSaveButtonDisabled]}
                onPress={saveEditingSession}
                disabled={!editingTitle.trim() || workspace.aiLoading}
              >
                <Text style={workspace.styles.aiRenameModalSaveText}>이름 바꾸기</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      ) : null}
      {deleteTarget !== null ? (
        <Pressable style={workspace.styles.aiPanelDialogOverlay} onPress={() => setDeleteTarget(null)}>
          <Pressable style={workspace.styles.aiRenameModalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={workspace.styles.aiRenameModalTitle}>채팅 삭제</Text>
            <Text style={workspace.styles.aiRenameModalBody}>
              "{deleteTarget?.title ?? ''}" 채팅을 삭제할까요?
            </Text>
            <View style={workspace.styles.aiRenameModalActions}>
              <Pressable style={workspace.styles.aiRenameModalCancelButton} onPress={() => setDeleteTarget(null)} disabled={workspace.aiLoading}>
                <Text style={workspace.styles.aiRenameModalCancelText}>취소</Text>
              </Pressable>
              <Pressable style={workspace.styles.aiRenameModalDangerButton} onPress={removeDeleteTarget} disabled={workspace.aiLoading}>
                <Text style={workspace.styles.aiRenameModalSaveText}>삭제</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}
