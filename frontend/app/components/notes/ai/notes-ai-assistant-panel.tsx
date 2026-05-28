import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Animated, Image, Keyboard, PanResponder, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { isClassInsightQuestion, isClassInsightTargetDocument } from '../../../hooks/notes/class-insight';
import type { BackendChatMessage, BackendChatSession, BackendClassInsightPageSignal } from '../../../services/backend-api';
import { AiResponseContent } from './ai-response-content';
import { useNotesGlobalContext } from '../workspace/notes-global-context';

const FLOATING_PANEL_WIDTH = 300;
const FLOATING_PANEL_HEIGHT = 620;
const FLOATING_PANEL_TOP = 66;
const FLOATING_PANEL_MARGIN = 8;
const SIDEBAR_KEYBOARD_TOP_OFFSET = 96;
const SIDEBAR_MIN_WIDTH = 300;
const SIDEBAR_DEFAULT_WIDTH = 340;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getFloatingPanelHeight(windowHeight: number, panelY: number, keyboardTop?: number | null) {
  const bottomEdge = keyboardTop ?? windowHeight;
  return Math.min(FLOATING_PANEL_HEIGHT, Math.max(260, bottomEdge - panelY - FLOATING_PANEL_MARGIN));
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
  { label: '예상 문제', question: '이 내용에서 시험 예상 문제를 만들어줘' },
  { label: '암기 포인트', question: '시험 전에 외워야 할 핵심 포인트만 정리해줘' },
] as const;

const DEFAULT_AI_QUICK_PROMPTS = [
  { label: '핵심 3개', question: '여기서 중요한 개념 3개만 알려줘' },
  { label: '쉽게 설명', question: '이 부분을 쉽게 풀어서 설명해줘' },
  { label: '예상 문제', question: '이 내용으로 시험 예상 문제를 만들어줘' },
  { label: '요약', question: '현재 페이지를 짧게 요약해줘' },
] as const;

export function NotesAiAssistantPanel() {
  const workspace = useNotesGlobalContext();
  const { width, height } = useWindowDimensions();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [sidebarVisible, setSidebarVisible] = React.useState(false);
  const sidebarProgress = React.useRef(new Animated.Value(0)).current;
  const [floatingPosition, setFloatingPosition] = React.useState({ x: FLOATING_PANEL_MARGIN, y: FLOATING_PANEL_TOP });
  const floatingPositionRef = React.useRef(floatingPosition);
  const floatingAnimatedPosition = React.useRef(new Animated.ValueXY(floatingPosition)).current;
  const floatingAnimatedHeight = React.useRef(new Animated.Value(FLOATING_PANEL_HEIGHT)).current;
  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT_WIDTH);
  const sidebarWidthRef = React.useRef(SIDEBAR_DEFAULT_WIDTH);
  const [menuSessionId, setMenuSessionId] = React.useState<number | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = React.useState(false);
  const [headerEditing, setHeaderEditing] = React.useState(false);
  const [headerEditingTitle, setHeaderEditingTitle] = React.useState('');
  const [editingSessionId, setEditingSessionId] = React.useState<number | null>(null);
  const [editingTitle, setEditingTitle] = React.useState('');
  const [editingTitleError, setEditingTitleError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: number; title: string } | null>(null);
  const [keyboardTop, setKeyboardTop] = React.useState<number | null>(null);
  const messagesScrollRef = React.useRef<ScrollView | null>(null);
  const hasChatHistory = workspace.aiMessages.length > 0;
  const quickPrompts = React.useMemo(() => (
    isClassInsightTargetDocument(workspace.studyDocument, workspace.subject)
      ? CLASS_INSIGHT_QUICK_PROMPTS
      : DEFAULT_AI_QUICK_PROMPTS
  ), [workspace.studyDocument, workspace.subject]);
  const showQuickPrompts = Boolean(
    !workspace.aiChatReadOnly
    && !workspace.aiLoading
    && quickPrompts.length
    && !workspace.aiQuestion.trim()
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
    ? workspace.allAiChatSessions.find((session: BackendChatSession) => session.id === workspace.activeAiChatSessionId)
      ?? workspace.noteAiChatSessions.find((session: BackendChatSession) => session.id === workspace.activeAiChatSessionId)
      ?? null
    : null;
  const canManageActiveSession = Boolean(activeSession && !workspace.aiChatReadOnly);
  const openLinkedPdfPage = React.useCallback((pageNumber: number) => {
    workspace.onSetCurrentPdfPage?.(pageNumber);
    workspace.onChangeInkTool?.('view');
  }, [workspace.onChangeInkTool, workspace.onSetCurrentPdfPage]);
  const chatSearchTerm = workspace.aiChatSearchQuery.trim().toLowerCase();
  const sidebarSessions = workspace.allAiChatSessions.filter((session: BackendChatSession) => {
    if (!chatSearchTerm) return true;
    return `${session.title} ${session.model ?? ''}`.toLowerCase().includes(chatSearchTerm);
  });
  const currentNoteSessionIds = React.useMemo(
    () => new Set(workspace.noteAiChatSessions.map((session: BackendChatSession) => session.id)),
    [workspace.noteAiChatSessions],
  );
  const keyboardVisible = keyboardTop !== null && keyboardTop < height;
  const floatingPanelHeight = getFloatingPanelHeight(height, floatingPosition.y, keyboardTop);
  const floatingMaxX = Math.max(FLOATING_PANEL_MARGIN, width - FLOATING_PANEL_WIDTH - FLOATING_PANEL_MARGIN);
  const floatingMaxY = Math.max(FLOATING_PANEL_TOP, (keyboardTop ?? height) - 360 - FLOATING_PANEL_MARGIN);
  const sidebarMaxWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.floor(width * 0.5));
  const keyboardAwareSidebarHeight = keyboardVisible
    ? Math.max(280, (keyboardTop ?? height) - SIDEBAR_KEYBOARD_TOP_OFFSET - FLOATING_PANEL_MARGIN)
    : undefined;
  const effectivePanelMode = workspace.aiPanelMode;

  React.useEffect(() => {
    const updateKeyboardFrame = (event: { endCoordinates?: { screenY?: number; height?: number } }) => {
      const screenY = event.endCoordinates?.screenY;
      const keyboardHeight = event.endCoordinates?.height;
      const nextTop = typeof screenY === 'number'
        ? screenY
        : typeof keyboardHeight === 'number'
          ? height - keyboardHeight
          : height;
      setKeyboardTop(nextTop < height ? nextTop : null);
    };
    const hideKeyboardFrame = () => setKeyboardTop(null);
    const showSub = Keyboard.addListener('keyboardWillChangeFrame', updateKeyboardFrame);
    const changeSub = Keyboard.addListener('keyboardDidChangeFrame', updateKeyboardFrame);
    const showFallbackSub = Keyboard.addListener('keyboardDidShow', updateKeyboardFrame);
    const hideSub = Keyboard.addListener('keyboardWillHide', hideKeyboardFrame);
    const hideFallbackSub = Keyboard.addListener('keyboardDidHide', hideKeyboardFrame);
    return () => {
      showSub.remove();
      changeSub.remove();
      showFallbackSub.remove();
      hideSub.remove();
      hideFallbackSub.remove();
    };
  }, [height]);

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

  const floatingPanResponder = React.useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => workspace.aiPanelMode === 'floating',
      onMoveShouldSetPanResponder: (_, gesture) => (
        effectivePanelMode === 'floating'
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
        const nextHeight = getFloatingPanelHeight(height, next.y, keyboardTop);
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
        const nextHeight = getFloatingPanelHeight(height, next.y, keyboardTop);
        floatingPositionRef.current = next;
        setFloatingPosition(next);
        floatingAnimatedPosition.setValue(next);
        floatingAnimatedHeight.setValue(nextHeight);
      },
    }),
    [effectivePanelMode, floatingAnimatedHeight, floatingAnimatedPosition, floatingMaxX, floatingMaxY, floatingPanelHeight, height, keyboardTop, workspace.aiPanelMode],
  );

  const sidebarResizePanResponder = React.useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => workspace.aiPanelMode === 'sidebar',
      onMoveShouldSetPanResponder: (_, gesture) => (
        effectivePanelMode === 'sidebar'
        && Math.abs(gesture.dx) > 3
      ),
      onPanResponderGrant: () => {
        closeOpenMenus();
      },
      onPanResponderMove: (_, gesture) => {
        setSidebarWidth(clamp(sidebarWidthRef.current + gesture.dx, SIDEBAR_MIN_WIDTH, sidebarMaxWidth));
      },
      onPanResponderRelease: (_, gesture) => {
        const next = clamp(sidebarWidthRef.current + gesture.dx, SIDEBAR_MIN_WIDTH, sidebarMaxWidth);
        sidebarWidthRef.current = next;
        setSidebarWidth(next);
      },
      onPanResponderTerminate: (_, gesture) => {
        const next = clamp(sidebarWidthRef.current + gesture.dx, SIDEBAR_MIN_WIDTH, sidebarMaxWidth);
        sidebarWidthRef.current = next;
        setSidebarWidth(next);
      },
    }),
    [effectivePanelMode, sidebarMaxWidth, workspace.aiPanelMode],
  );

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
      setEditingTitleError('채팅방 이름을 입력해 주세요.');
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
    setMenuSessionId(null);
    void workspace.onSelectAiChatSession(sessionId);
    closeSidebar();
  };

  const removeDeleteTarget = async () => {
    if (!deleteTarget) return;
    const targetId = deleteTarget.id;
    setDeleteTarget(null);
    await workspace.onRemoveAiChatSession(targetId);
  };

  const startNewChat = () => {
    Keyboard.dismiss();
    setHeaderMenuOpen(false);
    workspace.onStartNewAiChatSession();
    closeSidebar();
  };

  const returnToCurrentNoteSession = () => {
    const session = workspace.noteAiChatSessions[0] ?? null;
    if (session) {
      void workspace.onSelectAiChatSession(session.id);
      return;
    }
    workspace.onStartNewAiChatSession();
  };

  const startHeaderEditing = () => {
    if (!activeSession) return;
    startEditingSession(activeSession.id, activeSession.title);
  };

  const saveHeaderEditing = async () => {
    if (!activeSession) return;
    const saved = await workspace.onRenameAiChatSession(activeSession.id, headerEditingTitle);
    if (saved) {
      setHeaderEditing(false);
      setHeaderEditingTitle('');
    }
  };

  const closeOpenMenus = () => {
    setHeaderMenuOpen(false);
    setMenuSessionId(null);
  };

  const togglePanelMode = () => {
    closeOpenMenus();
    workspace.onChangeAiPanelMode(workspace.aiPanelMode === 'floating' ? 'sidebar' : 'floating');
  };

  const scrollToLatestMessage = React.useCallback(() => {
    window.setTimeout(() => {
      messagesScrollRef.current?.scrollToEnd({ animated: true });
    }, 40);
  }, []);

  React.useEffect(() => {
    scrollToLatestMessage();
  }, [workspace.aiMessages.length, workspace.aiLoading, workspace.activeAiChatSessionId, scrollToLatestMessage]);

  React.useEffect(() => {
    if (sidebarOpen) {
      setSidebarVisible(true);
      Animated.timing(sidebarProgress, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(sidebarProgress, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setSidebarVisible(false);
    });
  }, [sidebarOpen, sidebarProgress]);

  const closeSidebar = () => setSidebarOpen(false);
  const openSidebar = () => {
    Keyboard.dismiss();
    workspace.onLoadAllAiChatSessions();
    setSidebarOpen(true);
  };

  const requestAiAnswer = () => {
    Keyboard.dismiss();
    workspace.onRequestAiAnswer();
  };

  const sidebarAnimatedStyle = {
    opacity: sidebarProgress,
    transform: [{
      translateX: sidebarProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [-238, 0],
      }),
    }],
  };

  const homePaneAnimatedStyle = {
    opacity: sidebarProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 0.46],
    }),
    transform: [{
      translateX: sidebarProgress.interpolate({
        inputRange: [0, 1],
        outputRange: [0, 238],
      }),
    }],
  };

  if (!workspace.aiPanelOpen) return null;
  const panelStyle = effectivePanelMode === 'floating'
    ? [workspace.styles.aiPanel, { left: floatingAnimatedPosition.x, top: floatingAnimatedPosition.y, bottom: undefined, height: floatingAnimatedHeight }]
    : [workspace.styles.aiPanel, workspace.styles.aiPanelSidebar, { width: sidebarWidth }, keyboardAwareSidebarHeight ? { height: keyboardAwareSidebarHeight, alignSelf: 'flex-start' as const } : null];

  return (
    <Animated.View style={panelStyle}>
      {menuSessionId ? (
        <Pressable style={workspace.styles.aiMenuDismissLayer} onPress={closeOpenMenus} />
      ) : null}
      {sidebarVisible ? (
        <Animated.View style={[workspace.styles.aiChatSidebar, sidebarAnimatedStyle]}>
          <View style={workspace.styles.aiChatSidebarHeader}>
            <MaterialCommunityIcons name="star-four-points" size={24} color="#5F79FF" />
            <Pressable style={workspace.styles.aiPanelClose} onPress={closeSidebar}>
              <MaterialCommunityIcons name="close" size={17} color="#7A8394" />
            </Pressable>
          </View>

          <Pressable style={workspace.styles.aiSidebarCommand} onPress={startNewChat} disabled={workspace.aiLoading}>
            <MaterialCommunityIcons name="square-edit-outline" size={18} color="#111827" />
            <Text style={workspace.styles.aiSidebarCommandText}>새 채팅</Text>
          </Pressable>

          <View style={workspace.styles.aiSidebarSearchRow}>
            <MaterialCommunityIcons name="magnify" size={18} color="#111827" />
            <TextInput
              value={workspace.aiChatSearchQuery}
              onChangeText={workspace.onChangeAiChatSearchQuery}
              placeholder="채팅 검색"
              placeholderTextColor="#6B7280"
              style={workspace.styles.aiSidebarSearchInput}
            />
          </View>

          <ScrollView style={workspace.styles.aiSidebarList} contentContainerStyle={workspace.styles.aiSidebarListContent} showsVerticalScrollIndicator={false}>
            {sidebarSessions.length ? sidebarSessions.map((session: BackendChatSession) => {
              const active = session.id === workspace.activeAiChatSessionId;
              const connected = currentNoteSessionIds.has(session.id);
              const editing = false;
              const contextMenuProps = Platform.OS === 'web'
                ? {
                    onContextMenu: (event: { preventDefault?: () => void }) => {
                      event.preventDefault?.();
                      setMenuSessionId((current) => (current === session.id ? null : session.id));
                    },
                  }
                : undefined;

              return (
                <View key={session.id} style={workspace.styles.aiSidebarChatRowWrap}>
                  {editing ? (
                    <View style={workspace.styles.aiSidebarEditRow}>
                      <TextInput
                        value={editingTitle}
                        onChangeText={setEditingTitle}
                        style={workspace.styles.aiSidebarEditInput}
                        returnKeyType="done"
                        onSubmitEditing={saveEditingSession}
                        autoFocus
                      />
                      <Pressable style={workspace.styles.aiSidebarMiniButton} onPress={saveEditingSession} disabled={workspace.aiLoading}>
                        <MaterialCommunityIcons name="check" size={15} color="#111827" />
                      </Pressable>
                      <Pressable style={workspace.styles.aiSidebarMiniButton} onPress={() => setEditingSessionId(null)} disabled={workspace.aiLoading}>
                        <MaterialCommunityIcons name="close" size={15} color="#111827" />
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      {...contextMenuProps}
                      style={[workspace.styles.aiSidebarChatRow, active && workspace.styles.aiSidebarChatRowActive]}
                      onPress={() => selectSession(session.id)}
                      onLongPress={() => setMenuSessionId((current) => (current === session.id ? null : session.id))}
                      delayLongPress={450}
                    >
                      <View style={workspace.styles.aiSidebarChatContent}>
                        <Text style={workspace.styles.aiSidebarChatText} numberOfLines={1}>{session.title}</Text>
                        {connected ? (
                          <Text style={workspace.styles.aiSidebarConnectedBadge}>연결됨</Text>
                        ) : null}
                      </View>
                    </Pressable>
                  )}

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
              <Text style={workspace.styles.aiSidebarEmptyText}>{workspace.aiChatSearchQuery ? '검색 결과가 없습니다' : '채팅방이 없습니다'}</Text>
            )}
          </ScrollView>
        </Animated.View>
      ) : null}

      <Animated.View style={[workspace.styles.aiHomePane, homePaneAnimatedStyle]} pointerEvents={sidebarOpen ? 'none' : 'auto'}>
        {headerMenuOpen ? (
          <Pressable style={workspace.styles.aiHomeMenuDismissLayer} onPress={closeOpenMenus} />
        ) : null}
        <View style={workspace.styles.aiPanelHeader}>
          <View style={workspace.styles.aiHeaderButtonCluster}>
            <Pressable style={workspace.styles.aiHeaderIconButton} onPress={openSidebar}>
              <MaterialCommunityIcons name="menu" size={20} color="#303744" />
            </Pressable>
            <Pressable style={workspace.styles.aiHeaderIconButton} onPress={startNewChat} disabled={workspace.aiLoading}>
              <MaterialCommunityIcons name="square-edit-outline" size={17} color="#303744" />
            </Pressable>
            <Pressable
              style={[workspace.styles.aiHeaderIconButton, effectivePanelMode === 'sidebar' && workspace.styles.aiHeaderIconButtonActive]}
              onPress={togglePanelMode}
            >
              <MaterialCommunityIcons name={effectivePanelMode === 'floating' ? 'dock-left' : 'window-restore'} size={18} color="#303744" />
            </Pressable>
            <View style={workspace.styles.aiHeaderMenuWrap}>
              <Pressable
                style={[workspace.styles.aiHeaderIconButton, !canManageActiveSession && workspace.styles.aiHeaderIconButtonDisabled]}
                onPress={() => canManageActiveSession && setHeaderMenuOpen((current) => !current)}
                disabled={!canManageActiveSession || workspace.aiLoading}
              >
                <MaterialCommunityIcons name="dots-vertical" size={20} color={canManageActiveSession ? '#303744' : '#A0A7B3'} />
              </Pressable>
              {headerMenuOpen && activeSession && !workspace.aiChatReadOnly ? (
                <View style={workspace.styles.aiHeaderContextMenu}>
                  <Pressable style={workspace.styles.aiSidebarContextMenuItem} onPress={startHeaderEditing}>
                    <MaterialCommunityIcons name="pencil-outline" size={15} color="#111827" />
                    <Text style={workspace.styles.aiSidebarContextMenuText}>이름 바꾸기</Text>
                  </Pressable>
                  <Pressable style={workspace.styles.aiSidebarContextMenuItem} onPress={() => confirmRemoveSession(activeSession.id, activeSession.title)}>
                    <MaterialCommunityIcons name="trash-can-outline" size={15} color="#C04B4B" />
                    <Text style={[workspace.styles.aiSidebarContextMenuText, workspace.styles.aiSidebarContextMenuDanger]}>삭제하기</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>

          <View
            style={[workspace.styles.aiHeaderTitleWrap, effectivePanelMode === 'floating' && !headerEditing && workspace.styles.aiPanelHeaderDraggable]}
            {...(effectivePanelMode === 'floating' && !headerEditing ? floatingPanResponder.panHandlers : {})}
          >
            {headerEditing && activeSession ? (
              <View style={workspace.styles.aiHeaderEditRow}>
                <TextInput
                  value={headerEditingTitle}
                  onChangeText={setHeaderEditingTitle}
                  style={workspace.styles.aiHeaderEditInput}
                  returnKeyType="done"
                  onSubmitEditing={saveHeaderEditing}
                  autoFocus
                />
                <Pressable style={workspace.styles.aiHeaderEditButton} onPress={saveHeaderEditing} disabled={workspace.aiLoading}>
                  <MaterialCommunityIcons name="check" size={14} color="#111827" />
                </Pressable>
                <Pressable style={workspace.styles.aiHeaderEditButton} onPress={() => setHeaderEditing(false)} disabled={workspace.aiLoading}>
                  <MaterialCommunityIcons name="close" size={14} color="#111827" />
                </Pressable>
              </View>
            ) : (
              <View style={workspace.styles.aiHeaderDragZone}>
                <View style={workspace.styles.aiHeaderTitleTextWrap}>
                  <Text style={workspace.styles.aiHeaderTitle} numberOfLines={1}>
                    {activeSession ? activeSession.title : '새 채팅'}
                  </Text>
                  {workspace.aiChatReadOnly ? (
                    <Text style={workspace.styles.aiHeaderSubtitle} numberOfLines={1}>읽기 전용</Text>
                  ) : null}
                </View>
                {effectivePanelMode === 'floating' ? (
                  <MaterialCommunityIcons name="drag-horizontal-variant" size={17} color="#8A94A6" />
                ) : null}
              </View>
            )}
          </View>
        </View>

        <View style={workspace.styles.aiConversationShell}>
        <ScrollView
          ref={messagesScrollRef}
          style={workspace.styles.aiMessagesScroll}
          contentContainerStyle={workspace.styles.aiMessagesContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
        >
          {hasChatHistory ? workspace.aiMessages.map((message: BackendChatMessage) => {
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
              <Text style={workspace.styles.aiEmptyConversationBody}>선택한 영역이나 현재 페이지에 대해 질문해보세요.</Text>
            </View>
          )}
          {workspace.aiLoading ? (
            <View style={[workspace.styles.aiMessageBubble, workspace.styles.aiMessageBubbleAssistant]}>
              <Text style={[workspace.styles.aiMessageText, workspace.styles.aiMessageTextAssistant]}>···</Text>
            </View>
          ) : null}
        </ScrollView>

        <View style={workspace.styles.aiComposer}>
          {workspace.aiChatReadOnly ? (
            <View style={workspace.styles.aiReadOnlyNotice}>
              <MaterialCommunityIcons name="lock-outline" size={14} color="#5B6472" />
              <Text style={workspace.styles.aiReadOnlyNoticeText}>보고 있는 노트와 연결된 대화방이 아니라서 읽기만 가능합니다.</Text>
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
                {classInsightPages.map((page: BackendClassInsightPageSignal) => (
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
              placeholder={workspace.selectionPreviewUri ? '선택 영역에 대해 물어보세요' : '메시지 입력'}
              placeholderTextColor="#8F96A3"
              multiline
              editable={!workspace.aiChatReadOnly && !workspace.aiLoading}
              onFocus={scrollToLatestMessage}
              style={workspace.styles.aiComposerInput}
            />
            {keyboardVisible ? (
              <Pressable style={workspace.styles.aiComposerKeyboardButton} onPress={() => Keyboard.dismiss()}>
                <MaterialCommunityIcons name="keyboard-close-outline" size={17} color="#6B7280" />
              </Pressable>
            ) : null}
            <Pressable style={[workspace.styles.aiSendButton, workspace.aiChatReadOnly && workspace.styles.aiSendButtonDisabled]} onPress={requestAiAnswer} disabled={workspace.aiLoading || workspace.aiChatReadOnly}>
              {workspace.aiLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialCommunityIcons name="arrow-up" size={18} color="#FFFFFF" />}
            </Pressable>
          </View>
        </View>
      </View>
      </Animated.View>
      {sidebarVisible ? (
        <Pressable style={workspace.styles.aiSidebarHomeDismissLayer} onPress={closeSidebar} />
      ) : null}
      {effectivePanelMode === 'sidebar' ? (
        <View style={workspace.styles.aiPanelSidebarResizeHandle} {...sidebarResizePanResponder.panHandlers}>
          <View style={workspace.styles.aiPanelSidebarResizeGrip}>
            <View style={workspace.styles.aiPanelSidebarResizeDot} />
            <View style={workspace.styles.aiPanelSidebarResizeDot} />
            <View style={workspace.styles.aiPanelSidebarResizeDot} />
          </View>
        </View>
      ) : null}
      {editingSessionId !== null ? (
        <Pressable style={workspace.styles.aiPanelDialogOverlay} onPress={cancelEditingSession}>
          <Pressable style={workspace.styles.aiRenameModalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={workspace.styles.aiRenameModalTitle}>채팅방 이름 바꾸기</Text>
            <TextInput
              value={editingTitle}
              onChangeText={(value) => {
                setEditingTitle(value);
                if (editingTitleError && value.trim()) setEditingTitleError(null);
              }}
              placeholder="채팅방 이름"
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
            <Text style={workspace.styles.aiRenameModalTitle}>채팅방 삭제</Text>
            <Text style={workspace.styles.aiRenameModalBody}>
              "{deleteTarget?.title ?? ''}" 채팅방을 삭제할까요?
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
