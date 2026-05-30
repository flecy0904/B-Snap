import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Animated, Image, PanResponder, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
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
  const floatingAnimatedPosition = React.useRef(new Animated.ValueXY(floatingPosition)).current;
  const floatingAnimatedHeight = React.useRef(new Animated.Value(FLOATING_PANEL_HEIGHT)).current;
  const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT_WIDTH);
  const sidebarWidthRef = React.useRef(SIDEBAR_DEFAULT_WIDTH);
  const [menuSessionId, setMenuSessionId] = React.useState<number | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = React.useState(false);
  const [editingSessionId, setEditingSessionId] = React.useState<number | null>(null);
  const [editingTitle, setEditingTitle] = React.useState('');
  const [editingTitleError, setEditingTitleError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: number; title: string } | null>(null);
  const messagesScrollRef = React.useRef<ScrollView | null>(null);
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

  const sidebarResizePanResponder = React.useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => workspace.aiPanelMode === 'sidebar',
      onMoveShouldSetPanResponder: (_, gesture) => (
        workspace.aiPanelMode === 'sidebar'
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
    [sidebarMaxWidth, workspace.aiPanelMode],
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
  const panelStyle = appChatSidebar
    ? [workspace.styles.aiPanel, workspace.styles.appRightSidebarPanelContent]
    : appFloatingChat
      ? [
          workspace.styles.aiPanel,
          workspace.styles.appFloatingAiChatPanel,
          { left: floatingAnimatedPosition.x, top: floatingAnimatedPosition.y, right: undefined, bottom: undefined, height: floatingAnimatedHeight },
        ]
    : workspace.aiPanelMode === 'floating'
      ? [workspace.styles.aiPanel, { left: floatingAnimatedPosition.x, top: floatingAnimatedPosition.y, bottom: undefined, height: floatingAnimatedHeight }]
      : [workspace.styles.aiPanel, workspace.styles.aiPanelSidebar, { width: sidebarWidth }];

  return (
    <Animated.View style={panelStyle}>
      {menuSessionId ? (
        <Pressable style={workspace.styles.aiMenuDismissLayer} onPress={closeOpenMenus} />
      ) : null}
      <Animated.View style={workspace.styles.aiHomePane}>
        {headerMenuOpen ? (
          <Pressable style={workspace.styles.aiHomeMenuDismissLayer} onPress={closeOpenMenus} />
        ) : null}
        <View
          style={[
            workspace.styles.aiPanelHeader,
            workspace.aiPanelMode === 'floating'
              && !appChatSidebar
              && workspace.styles.aiPanelHeaderDraggable,
          ]}
          {...(workspace.aiPanelMode === 'floating' && !appChatSidebar ? floatingPanResponder.panHandlers : {})}
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
                <View style={workspace.styles.aiHeaderRecentMenu}>
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

        <View style={workspace.styles.aiConversationShell}>
        <ScrollView
          ref={messagesScrollRef}
          style={workspace.styles.aiMessagesScroll}
          contentContainerStyle={workspace.styles.aiMessagesContent}
          showsVerticalScrollIndicator={false}
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
