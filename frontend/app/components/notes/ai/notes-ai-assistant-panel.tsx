import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Animated, Image, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { isClassInsightQuestion, isClassInsightTargetDocument } from '../../../hooks/notes/class-insight';
import { AiResponseContent } from './ai-response-content';
import { useNotesGlobalContext } from '../workspace/notes-global-context';

const FLOATING_PANEL_WIDTH = 300;
const FLOATING_PANEL_HEIGHT = 620;
const FLOATING_PANEL_TOP = 66;
const FLOATING_PANEL_MARGIN = 8;
const APP_DETACHED_PANEL_WIDTH = 380;
const APP_DETACHED_PANEL_TOP = 60;
const SIDEBAR_MIN_WIDTH = 300;
const SIDEBAR_DEFAULT_WIDTH = 340;

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

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getFloatingPanelHeight(windowHeight: number, panelY: number) {
  return Math.min(FLOATING_PANEL_HEIGHT, Math.max(360, windowHeight - panelY - FLOATING_PANEL_MARGIN));
}

function formatPriorityLabel(priority: string) {
  if (priority === 'very-high') return '매우 높음';
  if (priority === 'high') return '높음';
  return '중간';
}

const CLASS_INSIGHT_QUICK_PROMPTS = [
  { label: '중요 페이지', question: '시험에 나올만한 중요 페이지 추천해줘' },
  { label: '다음 순위', question: '다음 순위 중요 페이지도 더 알려줘' },
  { label: '복습 순서', question: '이 PDF에서 먼저 복습할 순서 알려줘' },
] as const;

export function NotesAiAssistantPanel() {
  const workspace = useNotesGlobalContext();
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
  const messagesScrollRef = React.useRef<ScrollView | null>(null);
  const [messageScrollbarState, setMessageScrollbarState] = React.useState<WebMessageScrollbarState>({
    scrollTop: 0,
    contentHeight: 0,
    viewportHeight: 0,
    trackHeight: 0,
  });
  const messageScrollbarStateRef = React.useRef(messageScrollbarState);
  const hasChatHistory = workspace.aiMessages.length > 0;
  const quickPrompts = React.useMemo(() => (
    isClassInsightTargetDocument(workspace.studyDocument, workspace.subject)
      ? CLASS_INSIGHT_QUICK_PROMPTS
      : []
  ), [workspace.studyDocument, workspace.subject]);
  const showQuickPrompts = Boolean(
    !workspace.aiChatReadOnly
    && !workspace.aiLoading
    && quickPrompts.length
    && !workspace.aiQuestion.trim()
    && !hasChatHistory,
  );
  const shouldShowClassInsightPages = React.useMemo(() => (
    isClassInsightQuestion(workspace.aiQuestion)
    || isClassInsightQuestion(workspace.aiAnswer?.question ?? '')
  ), [workspace.aiAnswer?.question, workspace.aiQuestion]);
  const classInsightPages = React.useMemo(() => {
    if (!shouldShowClassInsightPages) return [];
    if (!isClassInsightTargetDocument(workspace.studyDocument, workspace.subject)) return [];
    return (workspace.classInsight?.pages ?? []).slice(0, 3);
  }, [shouldShowClassInsightPages, workspace.classInsight?.pages, workspace.studyDocument, workspace.subject]);
  const activeSession = workspace.activeAiChatSessionId
    ? workspace.allAiChatSessions.find((session: any) => session.id === workspace.activeAiChatSessionId)
      ?? workspace.noteAiChatSessions.find((session: any) => session.id === workspace.activeAiChatSessionId)
      ?? null
    : null;
  const openLinkedPdfPage = React.useCallback((pageNumber: number) => {
    workspace.onSetCurrentPdfPage?.(pageNumber);
    workspace.onChangeInkTool?.('view');
  }, [workspace.onChangeInkTool, workspace.onSetCurrentPdfPage]);
  const recentSessions = workspace.allAiChatSessions.slice(0, 8);
  const appFloatingChat = Boolean(
    workspace.usesAppAiPanelLayout
    && workspace.appChatMode === 'floating'
    && workspace.aiPanelMode === 'floating',
  );
  const appChatSidebar = Boolean(workspace.isAppChatSidebarPanel);
  const floatingPanelWidth = appFloatingChat ? APP_DETACHED_PANEL_WIDTH : FLOATING_PANEL_WIDTH;
  const floatingPanelHeight = getFloatingPanelHeight(height, floatingPosition.y);
  const floatingMaxX = Math.max(FLOATING_PANEL_MARGIN, width - floatingPanelWidth - FLOATING_PANEL_MARGIN);
  const floatingMaxY = Math.max(FLOATING_PANEL_TOP, height - 360 - FLOATING_PANEL_MARGIN);
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
    floatingAnimatedHeight.setValue(getFloatingPanelHeight(height, next.y));
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
        const nextHeight = getFloatingPanelHeight(height, next.y);
        floatingPositionRef.current = next;
        setFloatingPosition(next);
        floatingAnimatedPosition.setValue(next);
        floatingAnimatedHeight.setValue(nextHeight);
      },
      onPanResponderTerminate: (_, gesture) => {
        const start = floatingPositionRef.current;
        const next = {
          x: clamp(start.x + gesture.dx, FLOATING_PANEL_MARGIN, floatingMaxX),
          y: clamp(start.y + gesture.dy, FLOATING_PANEL_TOP, floatingMaxY),
        };
        const nextHeight = getFloatingPanelHeight(height, next.y);
        floatingPositionRef.current = next;
        setFloatingPosition(next);
        floatingAnimatedPosition.setValue(next);
        floatingAnimatedHeight.setValue(nextHeight);
      },
    }),
    [floatingAnimatedHeight, floatingAnimatedPosition, floatingMaxX, floatingMaxY, floatingPanelHeight, height, workspace.aiPanelMode],
  );

  const finishWebFloatingDrag = React.useCallback((clientX: number, clientY: number) => {
    const drag = webFloatingDragRef.current;
    if (!drag) return;
    const bounds = floatingBoundsRef.current;
    const next = {
      x: clamp(drag.startPanelX + clientX - drag.startClientX, FLOATING_PANEL_MARGIN, bounds.maxX),
      y: clamp(drag.startPanelY + clientY - drag.startClientY, FLOATING_PANEL_TOP, bounds.maxY),
    };
    const nextHeight = getFloatingPanelHeight(bounds.windowHeight, next.y);
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
    floatingAnimatedHeight.setValue(getFloatingPanelHeight(bounds.windowHeight, next.y));
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
    floatingAnimatedHeight.setValue(getFloatingPanelHeight(floatingBoundsRef.current.windowHeight, floatingPositionRef.current.y));
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

  if (!workspace.aiPanelOpen && !appChatSidebar) return null;
  const webSidebarAttachedPanel = Platform.OS === 'web' && !workspace.usesAppAiPanelLayout && workspace.aiPanelMode === 'sidebar';
  const panelStyle = appChatSidebar
    ? [workspace.styles.aiPanel, workspace.styles.appRightSidebarPanelContent]
    : appFloatingChat
      ? [
          workspace.styles.aiPanel,
          workspace.styles.appFloatingAiChatPanel,
          { left: floatingAnimatedPosition.x, top: floatingAnimatedPosition.y, right: undefined, bottom: undefined, height: floatingAnimatedHeight },
        ]
    : webSidebarAttachedPanel
      ? [
          workspace.styles.aiPanel,
          workspace.styles.aiPanelSidebar,
          workspace.styles.aiPanelWebAttached,
          { width: workspace.webChatSidebarWidth },
        ]
    : workspace.aiPanelMode === 'floating'
      ? [workspace.styles.aiPanel, { left: floatingAnimatedPosition.x, top: floatingAnimatedPosition.y, bottom: undefined, height: floatingAnimatedHeight }]
      : [workspace.styles.aiPanel, workspace.styles.aiPanelSidebar, { width: sidebarWidth }];

  return (
    <Animated.View style={panelStyle} {...webFloatingDragProps}>
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
            <Pressable
              style={workspace.styles.aiHeaderIconButton}
              onPress={togglePanelMode}
            >
              <MaterialCommunityIcons name={workspace.aiPanelMode === 'floating' ? 'dock-left' : 'window-restore'} size={18} color="#303744" />
            </Pressable>
            <Pressable style={workspace.styles.aiHeaderIconButton} onPress={startNewChat} disabled={workspace.aiLoading}>
              <MaterialCommunityIcons name="square-edit-outline" size={18} color="#303744" />
            </Pressable>
            <View style={workspace.styles.aiHeaderMenuWrap}>
              <Pressable
                style={workspace.styles.aiHeaderIconButton}
                onPress={() => {
                  workspace.onLoadAllAiChatSessions();
                  setHeaderMenuOpen((current) => !current);
                }}
                disabled={workspace.aiLoading}
              >
                <MaterialCommunityIcons name="dots-vertical" size={20} color="#303744" />
              </Pressable>
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
                      <View key={session.id} style={workspace.styles.aiSidebarChatRowWrap}>
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
                          <View style={workspace.styles.aiSidebarContextMenu}>
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
            <Pressable style={workspace.styles.aiHeaderIconButton} onPress={closeChatPanel}>
              <MaterialCommunityIcons name="close" size={20} color="#303744" />
            </Pressable>
          </View>
        </View>

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
              onLayout={updateMessagesViewportHeight}
              onContentSizeChange={updateMessagesContentHeight}
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
              keyboardShouldPersistTaps="handled"
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
          {classInsightPages.length ? (
            <View style={workspace.styles.aiClassInsightStrip}>
              <View style={workspace.styles.aiClassInsightHeader}>
                <Text style={workspace.styles.aiClassInsightTitle}>추천 페이지</Text>
                <Text style={workspace.styles.aiClassInsightMeta}>수업 필기 흐름 기준</Text>
              </View>
              <View style={workspace.styles.aiClassInsightChipRow}>
                {classInsightPages.map((page: any) => (
                  <Pressable
                    key={page.page_number}
                    style={workspace.styles.aiClassInsightChip}
                    onPress={() => openLinkedPdfPage(page.page_number)}
                    disabled={workspace.aiLoading}
                  >
                    <Text style={workspace.styles.aiClassInsightPage}>{page.page_number}p</Text>
                    <Text style={workspace.styles.aiClassInsightPriority}>{formatPriorityLabel(page.priority)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          <View style={workspace.styles.aiComposerInputShell}>
            <TextInput
              value={workspace.aiQuestion}
              onChangeText={workspace.onChangeAiQuestion}
              onFocus={() => workspace.onFocusWorkspaceTarget?.(null)}
              placeholder={workspace.selectionRect || workspace.selectionPreviewUri ? '이 부분이 궁금하신가요?' : '메시지 입력'}
              placeholderTextColor="#8F96A3"
              multiline
              editable={!workspace.aiChatReadOnly && !workspace.aiLoading}
              style={workspace.styles.aiComposerInput}
            />
            <Pressable style={[workspace.styles.aiSendButton, workspace.aiChatReadOnly && workspace.styles.aiSendButtonDisabled]} onPress={workspace.onRequestAiAnswer} disabled={workspace.aiLoading || workspace.aiChatReadOnly}>
              {workspace.aiLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialCommunityIcons name="arrow-up" size={18} color="#FFFFFF" />}
            </Pressable>
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
