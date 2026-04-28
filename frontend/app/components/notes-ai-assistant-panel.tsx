import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';

export function NotesAiAssistantPanel() {
  const workspace = useDesktopNotesWorkspaceContext();
  const responseSections = workspace.aiAnswer?.sections ?? workspace.aiResponseSections;
  const responseBody = workspace.aiAnswer?.response ?? workspace.aiResponse;
  const hasChatHistory = workspace.aiMessages.length > 0;

  if (!workspace.aiPanelOpen) return null;

  return (
    <View style={workspace.styles.aiPanel}>
      <View style={workspace.styles.aiPanelHeader}>
        <MaterialCommunityIcons name="star-four-points" size={24} color="#5F79FF" />
        <Pressable style={workspace.styles.aiPanelClose} onPress={workspace.onToggleAiPanel}><MaterialCommunityIcons name="close" size={18} color="#7A8394" /></Pressable>
      </View>
      <ScrollView style={workspace.styles.aiPanelScroll} contentContainerStyle={workspace.styles.aiPanelScrollContent} showsVerticalScrollIndicator={false}>
        <Text style={workspace.styles.aiPanelSubtitle}>선택 영역을 기준으로 질문할 수 있습니다.</Text>
        <View style={workspace.styles.aiChatHeaderRow}>
          <Text style={workspace.styles.aiSectionLabel}>최근 채팅</Text>
          <Pressable style={workspace.styles.aiNewChatButton} onPress={workspace.onCreateAiChatSession} disabled={workspace.aiLoading}>
            <MaterialCommunityIcons name="plus" size={15} color="#5169D8" />
            <Text style={workspace.styles.aiNewChatButtonText}>새 채팅</Text>
          </Pressable>
        </View>
        <View style={workspace.styles.aiChatScopeTabs}>
          {[
            { value: 'note' as const, label: `현재 노트 (${workspace.noteAiChatSessions.length})` },
            { value: 'all' as const, label: `전체 채팅 (${workspace.allAiChatSessions.length})` },
          ].map((tab) => {
            const active = workspace.aiChatScope === tab.value;
            return (
              <Pressable
                key={tab.value}
                style={[workspace.styles.aiChatScopeTab, active && workspace.styles.aiChatScopeTabActive]}
                onPress={() => workspace.onChangeAiChatScope(tab.value)}
              >
                <Text style={[workspace.styles.aiChatScopeTabText, active && workspace.styles.aiChatScopeTabTextActive]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {workspace.aiChatSessions.length ? (
          <View style={workspace.styles.aiChatList}>
            {workspace.aiChatSessions.map((session) => {
              const active = session.id === workspace.activeAiChatSessionId;
              return (
                <Pressable
                  key={session.id}
                  style={[workspace.styles.aiChatListItem, active && workspace.styles.aiChatListItemActive]}
                  onPress={() => workspace.onSelectAiChatSession(session.id)}
                  disabled={workspace.aiLoading || active}
                >
                  <Text style={[workspace.styles.aiChatListItemTitle, active && workspace.styles.aiChatListItemTitleActive]} numberOfLines={1}>{session.title}</Text>
                  <Text style={workspace.styles.aiChatListItemMeta} numberOfLines={1}>{session.model ?? '모델 미선택'}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : (
          <Pressable style={workspace.styles.aiEmptyChatButton} onPress={workspace.onCreateAiChatSession} disabled={workspace.aiLoading}>
            <Text style={workspace.styles.aiEmptyChatButtonText}>새 채팅 시작</Text>
          </Pressable>
        )}
        <View style={workspace.styles.aiStateCard}>
          <Text style={workspace.styles.aiStateTitle}>선택 영역</Text>
          <Text style={workspace.styles.aiStateBody}>{workspace.selectionRect ? `${Math.round(workspace.selectionRect.width)} × ${Math.round(workspace.selectionRect.height)} 영역 선택됨` : '아직 선택된 영역이 없습니다'}</Text>
        </View>
        <Text style={workspace.styles.aiSectionLabel}>추천 질문</Text>
        {['이 영역 핵심만 요약해줘', '여기서 중요한 개념 3개만 알려줘', '시험 대비 관점으로 설명해줘'].map((prompt) => (
          <Pressable key={prompt} style={workspace.styles.aiSuggestionChip} onPress={() => workspace.onChangeAiQuestion(prompt)}><Text style={workspace.styles.aiSuggestionText}>{prompt}</Text></Pressable>
        ))}
        <Text style={workspace.styles.aiSectionLabel}>질문</Text>
        <View style={workspace.styles.aiInputShell}>
          <TextInput value={workspace.aiQuestion} onChangeText={workspace.onChangeAiQuestion} placeholder="선택한 영역에 대해 물어보세요" placeholderTextColor="#A2AAB8" multiline style={workspace.styles.aiInput} />
        </View>
        <View style={workspace.styles.aiActionRow}>
          <Pressable style={workspace.styles.aiPrimaryButton} onPress={workspace.onRequestAiAnswer} disabled={workspace.aiLoading}>
            {workspace.aiLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={workspace.styles.aiPrimaryButtonText}>응답 생성</Text>}
          </Pressable>
          <Pressable style={[workspace.styles.aiSecondaryButton, !workspace.aiAnswer && workspace.styles.aiSecondaryButtonDisabled]} onPress={workspace.onInsertAiAnswerPage} disabled={!workspace.aiAnswer}>
            <Text style={[workspace.styles.aiSecondaryButtonText, !workspace.aiAnswer && workspace.styles.aiSecondaryButtonTextDisabled]}>정리 페이지로 추가</Text>
          </Pressable>
        </View>
        {workspace.aiError ? <Text style={workspace.styles.aiErrorText}>{workspace.aiError}</Text> : null}
        {hasChatHistory ? (
          <>
            <Text style={workspace.styles.aiSectionLabel}>채팅 내역</Text>
            <View style={workspace.styles.aiResponseCard}>
              {workspace.aiMessages.map((message) => (
                <View key={message.id} style={workspace.styles.aiResponseSection}>
                  <Text style={workspace.styles.aiResponseSectionTitle}>{message.role === 'user' ? '나' : 'AI'}</Text>
                  <Text style={workspace.styles.aiResponseBody}>{message.content}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}
        <View style={workspace.styles.aiResponseCard}>
          <Text style={workspace.styles.aiResponseTitle}>답변</Text>
          {workspace.selectionRect && workspace.normalizedQuestion ? <View style={workspace.styles.aiQuestionPill}><Text style={workspace.styles.aiQuestionPillText}>{workspace.normalizedQuestion}</Text></View> : null}
          {responseSections ? responseSections.map((section, index) => (
            <View key={`${section.title}-${index}`} style={[workspace.styles.aiResponseSection, index === responseSections.length - 1 && workspace.styles.aiResponseSectionLast]}>
              <Text style={workspace.styles.aiResponseSectionTitle}>{section.title}</Text>
              <Text style={workspace.styles.aiResponseBody}>{section.body}</Text>
            </View>
          )) : <Text style={workspace.styles.aiResponseBody}>{responseBody}</Text>}
        </View>
      </ScrollView>
    </View>
  );
}
