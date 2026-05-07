import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Animated, Image, LayoutChangeEvent, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';

export function NotesAiAssistantPanel() {
  const workspace = useDesktopNotesWorkspaceContext();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [sidebarVisible, setSidebarVisible] = React.useState(false);
  const sidebarProgress = React.useRef(new Animated.Value(0)).current;
  const [menuSessionId, setMenuSessionId] = React.useState<number | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = React.useState(false);
  const [headerEditing, setHeaderEditing] = React.useState(false);
  const [headerEditingTitle, setHeaderEditingTitle] = React.useState('');
  const [editingSessionId, setEditingSessionId] = React.useState<number | null>(null);
  const [editingTitle, setEditingTitle] = React.useState('');
  const [editingTitleError, setEditingTitleError] = React.useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<{ id: number; title: string } | null>(null);
  const messagesScrollRef = React.useRef<ScrollView | null>(null);
  const messageLayoutsRef = React.useRef<Record<number, { y: number; height: number }>>({});
  const hasChatHistory = workspace.aiMessages.length > 0;
  const latestUserMessage = [...workspace.aiMessages].reverse().find((message) => message.role === 'user') ?? null;
  const latestUserMessageId = latestUserMessage?.id ?? null;
  const activeSession = workspace.activeAiChatSessionId
    ? workspace.allAiChatSessions.find((session) => session.id === workspace.activeAiChatSessionId)
      ?? workspace.noteAiChatSessions.find((session) => session.id === workspace.activeAiChatSessionId)
      ?? null
    : null;
  const chatSearchTerm = workspace.aiChatSearchQuery.trim().toLowerCase();
  const sidebarSessions = workspace.allAiChatSessions.filter((session) => {
    if (!chatSearchTerm) return true;
    return `${session.title} ${session.model ?? ''}`.toLowerCase().includes(chatSearchTerm);
  });

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
    setHeaderMenuOpen(false);
    workspace.onStartNewAiChatSession();
    closeSidebar();
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

  const scrollToLatestUserMessage = React.useCallback(() => {
    const latestUserLayout = latestUserMessageId ? messageLayoutsRef.current[latestUserMessageId] : null;
    if (!latestUserLayout) return;
    window.setTimeout(() => {
      messagesScrollRef.current?.scrollTo({
        y: Math.max(0, latestUserLayout.y - 4),
        animated: true,
      });
    }, 40);
  }, [latestUserMessageId]);

  React.useEffect(() => {
    scrollToLatestUserMessage();
  }, [latestUserMessageId, workspace.aiMessages.length, scrollToLatestUserMessage]);

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

  const handleMessageLayout = (id: number, event: LayoutChangeEvent) => {
    const { y, height } = event.nativeEvent.layout;
    messageLayoutsRef.current[id] = { y, height };
  };

  const closeSidebar = () => setSidebarOpen(false);
  const openSidebar = () => setSidebarOpen(true);

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

  return (
    <View style={workspace.styles.aiPanel}>
      {headerMenuOpen || menuSessionId ? (
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
            {sidebarSessions.length ? sidebarSessions.map((session) => {
              const active = session.id === workspace.activeAiChatSessionId;
              const editing = false;
              const contextMenuProps = {
                onContextMenu: (event: { preventDefault?: () => void }) => {
                  event.preventDefault?.();
                  setMenuSessionId((current) => (current === session.id ? null : session.id));
                },
              } as any;

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
                      <Text style={workspace.styles.aiSidebarChatText} numberOfLines={1}>{session.title}</Text>
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
        <View style={workspace.styles.aiPanelHeader}>
          <Pressable style={workspace.styles.aiHeaderIconButton} onPress={openSidebar}>
            <MaterialCommunityIcons name="menu" size={20} color="#303744" />
          </Pressable>

          <View style={workspace.styles.aiHeaderTitleWrap}>
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
              <>
                <Text style={workspace.styles.aiHeaderTitle} numberOfLines={1}>
                  {activeSession ? activeSession.title : '새 채팅'}
                </Text>
              </>
            )}
          </View>

          <View style={workspace.styles.aiHeaderActions}>
            <Pressable style={workspace.styles.aiHeaderNewChatButton} onPress={startNewChat} disabled={workspace.aiLoading}>
              <MaterialCommunityIcons name="square-edit-outline" size={16} color="#303744" />
              <Text style={workspace.styles.aiHeaderNewChatButtonText}>새 채팅</Text>
            </Pressable>
            <View style={workspace.styles.aiHeaderMenuWrap}>
              <Pressable
                style={[workspace.styles.aiHeaderIconButton, !activeSession && workspace.styles.aiHeaderIconButtonDisabled]}
                onPress={() => activeSession && setHeaderMenuOpen((current) => !current)}
                disabled={!activeSession || workspace.aiLoading}
              >
                <MaterialCommunityIcons name="dots-vertical" size={20} color={activeSession ? '#303744' : '#A0A7B3'} />
              </Pressable>
              {headerMenuOpen && activeSession ? (
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
        </View>

        <View style={workspace.styles.aiConversationShell}>
        <ScrollView
          ref={messagesScrollRef}
          style={workspace.styles.aiMessagesScroll}
          contentContainerStyle={workspace.styles.aiMessagesContent}
          showsVerticalScrollIndicator={false}
        >
          {hasChatHistory ? workspace.aiMessages.map((message) => {
            const isUser = message.role === 'user';
            return (
              <View
                key={message.id}
                style={[workspace.styles.aiMessageBubble, isUser ? workspace.styles.aiMessageBubbleUser : workspace.styles.aiMessageBubbleAssistant]}
                onLayout={(event) => handleMessageLayout(message.id, event)}
              >
                <Text style={[workspace.styles.aiMessageText, isUser ? workspace.styles.aiMessageTextUser : workspace.styles.aiMessageTextAssistant]}>{message.content}</Text>
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
          {workspace.selectionPreviewUri ? (
            <View style={workspace.styles.aiSelectionAttachment}>
              <Image source={{ uri: workspace.selectionPreviewUri }} style={workspace.styles.aiSelectionAttachmentImage} resizeMode="contain" />
              <Pressable style={workspace.styles.aiSelectionAttachmentRemove} onPress={() => workspace.onSelectionPreviewChange(null)}>
                <MaterialCommunityIcons name="close" size={12} color="#FFFFFF" />
              </Pressable>
            </View>
          ) : null}
          {workspace.aiError ? <Text style={workspace.styles.aiErrorText}>{workspace.aiError}</Text> : null}
          <View style={workspace.styles.aiComposerInputShell}>
            <TextInput
              value={workspace.aiQuestion}
              onChangeText={workspace.onChangeAiQuestion}
              placeholder="메시지 입력"
              placeholderTextColor="#8F96A3"
              multiline
              style={workspace.styles.aiComposerInput}
            />
            <Pressable style={workspace.styles.aiSendButton} onPress={workspace.onRequestAiAnswer} disabled={workspace.aiLoading}>
              {workspace.aiLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <MaterialCommunityIcons name="arrow-up" size={18} color="#FFFFFF" />}
            </Pressable>
          </View>
        </View>
      </View>
      </Animated.View>
      {sidebarVisible ? (
        <Pressable style={workspace.styles.aiSidebarHomeDismissLayer} onPress={closeSidebar} />
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
    </View>
  );
}
