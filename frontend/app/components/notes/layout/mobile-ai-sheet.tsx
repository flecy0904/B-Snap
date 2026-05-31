import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView, BottomSheetTextInput, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { isClassInsightQuestion, isClassInsightTargetDocument } from '../../../hooks/notes/class-insight';
import { AiResponseContent } from '../ai/ai-response-content';
import type { MobileNotesViewProps } from './mobile-notes-view';

const CLASS_INSIGHT_QUICK_PROMPTS = [
  { label: '중요 페이지', question: '시험에 나올만한 중요 페이지 추천해줘' },
  { label: '다음 순위', question: '다음 순위 중요 페이지도 더 알려줘' },
  { label: '복습 순서', question: '이 PDF에서 먼저 복습할 순서 알려줘' },
  { label: '예상 문제', question: '이 내용에서 시험 예상 문제를 만들어줘' },
  { label: '암기 포인트', question: '시험 전에 외워야 할 핵심 포인트만 정리해줘' },
] as const;

const DEFAULT_AI_QUICK_PROMPTS = [
  { label: '그래프 의미', question: '이 그래프 의미 뭐야?' },
  { label: '핵심 3개', question: '여기서 중요한 개념 3개만 알려줘' },
  { label: '시험 관점', question: '시험 대비 관점으로 설명해줘' },
  { label: '요약', question: '현재 페이지를 짧게 요약해줘' },
] as const;

function formatClassInsightPriority(priority: string) {
  if (priority === 'very-high') return '매우 높음';
  if (priority === 'high') return '높음';
  return '중간';
}

export function MobileAiSheet(props: MobileNotesViewProps) {
  const aiSheetSnapPoints = React.useMemo(() => ['44%', '78%'], []);
  const renderAiBackdrop = React.useCallback(
    (backdropProps: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...backdropProps} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  );
  const normalizedQuestion = props.aiAnswer?.question ?? props.aiQuestion.trim();
  const aiResponseSections = props.aiAnswer?.sections ?? null;
  const aiResponse = props.aiAnswer?.response ?? (props.selectionRect ? '응답 생성을 누르면 선택 영역 기준으로 AI 답변을 요청합니다.' : '먼저 선택 모드로 문서 영역을 드래그해 주세요.');
  const aiSuggestionPrompts = React.useMemo(() => (
    isClassInsightTargetDocument(props.studyDocument, props.subject)
      ? CLASS_INSIGHT_QUICK_PROMPTS
      : DEFAULT_AI_QUICK_PROMPTS
  ), [props.studyDocument, props.subject]);
  const showAiSuggestionPrompts = Boolean(
    aiSuggestionPrompts.length
    && !props.aiQuestion.trim()
    && !props.aiChatReadOnly,
  );
  const shouldShowClassInsightPages = React.useMemo(() => (
    isClassInsightQuestion(props.aiQuestion)
    || isClassInsightQuestion(props.aiAnswer?.question ?? '')
  ), [props.aiAnswer?.question, props.aiQuestion]);
  const classInsightPages = React.useMemo(() => {
    if (!shouldShowClassInsightPages) return [];
    if (!isClassInsightTargetDocument(props.studyDocument, props.subject)) return [];
    return (props.classInsight?.pages ?? []).slice(0, 3);
  }, [props.classInsight?.pages, props.studyDocument, props.subject, shouldShowClassInsightPages]);
  const activeSession = props.aiChatSessions.find((session) => session.id === props.activeAiChatSessionId) ?? null;

  if (!props.aiPanelOpen) return null;

  return (
    <BottomSheet
      index={0}
      snapPoints={aiSheetSnapPoints}
      enablePanDownToClose
      backdropComponent={renderAiBackdrop}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      onClose={props.onToggleAiPanel}
      backgroundStyle={props.styles.mobileAiBottomSheetBackground}
      handleIndicatorStyle={props.styles.mobileAiHandle}
      style={props.styles.mobileAiBottomSheet}
    >
      <View style={props.styles.mobileAiHeader}>
        <View style={props.styles.mobileAiHeaderTitleWrap}>
          <View style={props.styles.mobileAiTitleRow}>
            <MaterialCommunityIcons name="star-four-points" size={18} color="#5F79FF" />
            <Text style={props.styles.mobileAiTitle}>AI 채팅</Text>
          </View>
          <Text style={props.styles.mobileAiSubtitle} numberOfLines={1}>
            {activeSession?.title ?? (props.selectionRect ? '선택 영역 질문 준비됨' : '현재 문서 기준으로 질문')}
          </Text>
        </View>
        <Pressable style={props.styles.aiPanelClose} onPress={props.onToggleAiPanel}>
          <MaterialCommunityIcons name="close" size={18} color="#7A8394" />
        </Pressable>
      </View>
      <BottomSheetScrollView contentContainerStyle={props.styles.mobileAiScrollContent} showsVerticalScrollIndicator={false}>
        <View style={props.styles.aiChatHeaderRow}>
          <Text style={props.styles.aiSectionLabel}>채팅 범위</Text>
          <Pressable style={props.styles.aiNewChatButton} onPress={props.onCreateAiChatSession} disabled={props.aiLoading}>
            <MaterialCommunityIcons name="plus" size={15} color="#5169D8" />
            <Text style={props.styles.aiNewChatButtonText}>새 채팅</Text>
          </Pressable>
        </View>
        <View style={props.styles.aiChatScopeTabs}>
          {[
            { value: 'note' as const, label: `현재 노트 (${props.noteAiChatSessions.length})` },
            { value: 'all' as const, label: `전체 (${props.allAiChatSessions.length})` },
          ].map((tab) => {
            const active = props.aiChatScope === tab.value;
            return (
              <Pressable
                key={tab.value}
                style={[props.styles.aiChatScopeTab, active && props.styles.aiChatScopeTabActive]}
                onPress={() => props.onChangeAiChatScope(tab.value)}
              >
                <Text style={[props.styles.aiChatScopeTabText, active && props.styles.aiChatScopeTabTextActive]}>{tab.label}</Text>
              </Pressable>
            );
          })}
        </View>
        {props.aiChatSessions.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={props.styles.mobileAiChatList}>
            {props.aiChatSessions.map((session) => {
              const active = session.id === props.activeAiChatSessionId;
              return (
                <Pressable
                  key={session.id}
                  style={[props.styles.aiChatListItem, props.styles.mobileAiChatListItem, active && props.styles.aiChatListItemActive]}
                  onPress={() => props.onSelectAiChatSession(session.id)}
                  disabled={props.aiLoading || active}
                >
                  <Text style={[props.styles.aiChatListItemTitle, active && props.styles.aiChatListItemTitleActive]} numberOfLines={1}>{session.title}</Text>
                  <Text style={props.styles.aiChatListItemMeta} numberOfLines={1}>{session.model ?? '모델 미선택'}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        ) : (
          <Pressable style={props.styles.aiEmptyChatButton} onPress={props.onCreateAiChatSession} disabled={props.aiLoading}>
            <Text style={props.styles.aiEmptyChatButtonText}>새 채팅 시작</Text>
          </Pressable>
        )}
        <View style={props.styles.mobileAiContextRow}>
          <MaterialCommunityIcons name={props.selectionRect ? 'selection-drag' : 'file-document-outline'} size={14} color="#5F79FF" />
          <Text style={props.styles.mobileAiContextText} numberOfLines={1}>
            {props.selectionRect ? `선택 영역 ${Math.round(props.selectionRect.width)} x ${Math.round(props.selectionRect.height)}` : '현재 문서와 페이지 기준'}
          </Text>
        </View>
        {showAiSuggestionPrompts ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {aiSuggestionPrompts.map((prompt) => (
              <Pressable key={prompt.label} style={props.styles.aiSuggestionChip} onPress={() => props.onChangeAiQuestion(prompt.question)}>
                <Text style={props.styles.aiSuggestionText}>{prompt.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {classInsightPages.length ? (
          <View style={props.styles.aiClassInsightStrip}>
            <View style={props.styles.aiClassInsightHeader}>
              <Text style={props.styles.aiClassInsightTitle}>추천 페이지</Text>
              <Text style={props.styles.aiClassInsightMeta}>수업 필기 흐름 기준</Text>
            </View>
            <View style={props.styles.aiClassInsightChipRow}>
              {classInsightPages.map((page) => (
                <Pressable key={page.page_number} style={props.styles.aiClassInsightChip} onPress={() => props.onSetCurrentPdfPage(page.page_number)}>
                  <Text style={props.styles.aiClassInsightPage}>{page.page_number}p</Text>
                  <Text style={props.styles.aiClassInsightPriority}>{formatClassInsightPriority(page.priority)}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        {props.aiChatReadOnly ? (
          <View style={props.styles.aiReadOnlyNotice}>
            <MaterialCommunityIcons name="lock-outline" size={14} color="#5B6472" />
            <Text style={props.styles.aiReadOnlyNoticeText}>보고 있는 노트와 연결된 대화방이 아니라서 읽기만 가능합니다.</Text>
          </View>
        ) : null}
        <View style={props.styles.aiComposerInputShell}>
          <BottomSheetTextInput
            value={props.aiQuestion}
            onChangeText={props.onChangeAiQuestion}
            placeholder={props.selectionRect ? '선택한 영역에 대해 물어보세요' : '현재 페이지에 대해 물어보세요'}
            placeholderTextColor="#A2AAB8"
            multiline
            style={props.styles.aiComposerInput}
          />
          <Pressable
            style={[props.styles.aiSendButton, (props.aiLoading || props.aiChatReadOnly) && props.styles.aiSendButtonDisabled]}
            onPress={props.onRequestAiAnswer}
            disabled={props.aiLoading || props.aiChatReadOnly}
          >
            {props.aiLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <MaterialCommunityIcons name="arrow-up" size={18} color="#FFFFFF" />
            )}
          </Pressable>
        </View>
        {props.aiAnswer ? (
          <Pressable style={props.styles.mobileAiInsertButton} onPress={props.onInsertAiAnswerPage}>
            <MaterialCommunityIcons name="file-document-plus-outline" size={15} color="#5169D8" />
            <Text style={props.styles.mobileAiInsertButtonText}>정리 페이지로 추가</Text>
          </Pressable>
        ) : null}
        {props.aiError ? <Text style={props.styles.aiErrorText}>{props.aiError}</Text> : null}
        {props.aiMessages.length ? (
          <>
            <Text style={props.styles.aiSectionLabel}>채팅 내역</Text>
            <View style={props.styles.aiResponseCard}>
              {props.aiMessages.map((message) => (
                <View key={message.id} style={props.styles.aiResponseSection}>
                  <Text style={props.styles.aiResponseSectionTitle}>{message.role === 'user' ? '나' : 'AI'}</Text>
                  {message.role === 'user' ? (
                    <Text style={props.styles.aiResponseBody}>{message.content}</Text>
                  ) : (
                    <AiResponseContent
                      content={message.content}
                      pageCount={props.studyDocument?.pageCount}
                      styles={props.styles}
                      textStyle={props.styles.aiResponseBody}
                      linkStyle={props.styles.aiResponsePageLink}
                      onOpenPage={props.onSetCurrentPdfPage}
                    />
                  )}
                </View>
              ))}
            </View>
          </>
        ) : null}
        <View style={props.styles.aiResponseCard}>
          <Text style={props.styles.aiResponseTitle}>답변</Text>
          {props.selectionRect && normalizedQuestion ? (
            <View style={props.styles.aiQuestionPill}>
              <Text style={props.styles.aiQuestionPillText}>{normalizedQuestion}</Text>
            </View>
          ) : null}
          {aiResponseSections ? aiResponseSections.map((section, index) => (
            <View key={`${section.title}-${index}`} style={[props.styles.aiResponseSection, index === aiResponseSections.length - 1 && props.styles.aiResponseSectionLast]}>
              <Text style={props.styles.aiResponseSectionTitle}>{section.title}</Text>
              <AiResponseContent
                content={section.body}
                pageCount={props.studyDocument?.pageCount}
                styles={props.styles}
                textStyle={props.styles.aiResponseBody}
                linkStyle={props.styles.aiResponsePageLink}
                onOpenPage={props.onSetCurrentPdfPage}
              />
            </View>
          )) : (
            <AiResponseContent
              content={aiResponse}
              pageCount={props.studyDocument?.pageCount}
              styles={props.styles}
              textStyle={props.styles.aiResponseBody}
              linkStyle={props.styles.aiResponsePageLink}
              onOpenPage={props.onSetCurrentPdfPage}
            />
          )}
        </View>
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
