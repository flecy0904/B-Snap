import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';

export function NotesAiAssistantPanel() {
  const workspace = useDesktopNotesWorkspaceContext();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [menuSessionId, setMenuSessionId] = React.useState<number | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = React.useState(false);
  const [headerEditing, setHeaderEditing] = React.useState(false);
  const [headerEditingTitle, setHeaderEditingTitle] = React.useState('');
  const [editingSessionId, setEditingSessionId] = React.useState<number | null>(null);
  const [editingTitle, setEditingTitle] = React.useState('');
  const hasChatHistory = workspace.aiMessages.length > 0;
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

  if (!workspace.aiPanelOpen) return null;

  const startEditingSession = (sessionId: number, title: string) => {
    setMenuSessionId(null);
    setHeaderMenuOpen(false);
    setEditingSessionId(sessionId);
    setEditingTitle(title);
  };

  const saveEditingSession = async () => {
    if (!editingSessionId) return;
    const saved = await workspace.onRenameAiChatSession(editingSessionId, editingTitle);
    if (saved) {
      setEditingSessionId(null);
      setEditingTitle('');
    }
  };

  const confirmRemoveSession = (sessionId: number, title: string) => {
    setMenuSessionId(null);
    setHeaderMenuOpen(false);
    Alert.alert('채팅방 삭제', `"${title}" 채팅방을 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => workspace.onRemoveAiChatSession(sessionId) },
    ]);
  };

  const selectSession = (sessionId: number) => {
    setMenuSessionId(null);
    void workspace.onSelectAiChatSession(sessionId);
    setSidebarOpen(false);
  };

  const startNewChat = () => {
    setHeaderMenuOpen(false);
    setHeaderEditing(false);
    workspace.onStartNewAiChatSession();
    setSidebarOpen(false);
  };

  const startHeaderEditing = () => {
    if (!activeSession) return;
    setHeaderMenuOpen(false);
    setHeaderEditing(true);
    setHeaderEditingTitle(activeSession.title);
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

  return (
    <View style={workspace.styles.aiPanel}>
      {headerMenuOpen || menuSessionId ? (
        <Pressable style={workspace.styles.aiMenuDismissLayer} onPress={closeOpenMenus} />
      ) : null}
      {sidebarOpen ? (
        <View style={workspace.styles.aiChatSidebar}>
          <View style={workspace.styles.aiChatSidebarHeader}>
            <MaterialCommunityIcons name="star-four-points" size={24} color="#5F79FF" />
            <Pressable style={workspace.styles.aiPanelClose} onPress={() => setSidebarOpen(false)}>
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
              const editing = session.id === editingSessionId;
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
        </View>
      ) : null}

      <View style={[workspace.styles.aiHomePane, sidebarOpen && workspace.styles.aiHomePaneShifted]} pointerEvents={sidebarOpen ? 'none' : 'auto'}>
        <View style={workspace.styles.aiPanelHeader}>
          <Pressable style={workspace.styles.aiHeaderIconButton} onPress={() => setSidebarOpen((current) => !current)}>
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
        <ScrollView style={workspace.styles.aiMessagesScroll} contentContainerStyle={workspace.styles.aiMessagesContent} showsVerticalScrollIndicator={false}>
          {hasChatHistory ? workspace.aiMessages.map((message) => {
            const isUser = message.role === 'user';
            return (
              <View key={message.id} style={[workspace.styles.aiMessageBubble, isUser ? workspace.styles.aiMessageBubbleUser : workspace.styles.aiMessageBubbleAssistant]}>
                <Text style={[workspace.styles.aiMessageText, isUser ? workspace.styles.aiMessageTextUser : workspace.styles.aiMessageTextAssistant]}>{message.content}</Text>
              </View>
            );
          }) : (
            <View style={workspace.styles.aiEmptyConversation}>
              <Text style={workspace.styles.aiEmptyConversationTitle}>무엇을 도와드릴까요?</Text>
              <Text style={workspace.styles.aiEmptyConversationBody}>노트 내용이나 선택한 영역에 대해 질문해보세요.</Text>
            </View>
          )}
        </ScrollView>

        <View style={workspace.styles.aiComposer}>
          {workspace.selectionRect ? (
            <View style={workspace.styles.aiSelectionAttachment}>
              {workspace.selectionPreviewUri ? (
                <Image source={{ uri: workspace.selectionPreviewUri }} style={workspace.styles.aiSelectionAttachmentImage} resizeMode="contain" />
              ) : (
                <View style={workspace.styles.aiSelectionAttachmentFallback}>
                  <MaterialCommunityIcons name="image-outline" size={18} color="#5169D8" />
                </View>
              )}
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
      </View>
      {sidebarOpen ? (
        <Pressable style={workspace.styles.aiSidebarHomeDismissLayer} onPress={() => setSidebarOpen(false)} />
      ) : null}
    </View>
  );
}
