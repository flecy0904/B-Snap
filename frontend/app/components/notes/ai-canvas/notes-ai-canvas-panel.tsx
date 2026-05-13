import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useDesktopNotesWorkspaceContext } from '../workspace/notes-workspace-context';

function MarkdownPreview(props: {
  markdown: string;
  styles: any;
}) {
  const lines = props.markdown.split(/\r?\n/);

  return (
    <View style={props.styles.aiCanvasMarkdown}>
      {lines.map((line, index) => {
        const key = `${index}-${line}`;
        const trimmed = line.trim();

        if (!trimmed) {
          return <View key={key} style={props.styles.aiCanvasMarkdownSpacer} />;
        }

        if (trimmed.startsWith('### ')) {
          return <Text key={key} style={props.styles.aiCanvasHeading3}>{trimmed.slice(4)}</Text>;
        }
        if (trimmed.startsWith('## ')) {
          return <Text key={key} style={props.styles.aiCanvasHeading2}>{trimmed.slice(3)}</Text>;
        }
        if (trimmed.startsWith('# ')) {
          return <Text key={key} style={props.styles.aiCanvasHeading1}>{trimmed.slice(2)}</Text>;
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          return (
            <View key={key} style={props.styles.aiCanvasListRow}>
              <Text style={props.styles.aiCanvasListBullet}>-</Text>
              <Text style={props.styles.aiCanvasParagraph}>{trimmed.slice(2)}</Text>
            </View>
          );
        }
        if (/^\d+\.\s/.test(trimmed)) {
          const marker = trimmed.match(/^\d+\./)?.[0] ?? '';
          return (
            <View key={key} style={props.styles.aiCanvasListRow}>
              <Text style={props.styles.aiCanvasListNumber}>{marker}</Text>
              <Text style={props.styles.aiCanvasParagraph}>{trimmed.replace(/^\d+\.\s/, '')}</Text>
            </View>
          );
        }

        return <Text key={key} style={props.styles.aiCanvasParagraph}>{trimmed}</Text>;
      })}
    </View>
  );
}

export function NotesAiCanvasPanel() {
  const workspace = useDesktopNotesWorkspaceContext();
  const canvas = workspace.aiCanvas;

  return (
    <View style={workspace.styles.aiCanvasPanel}>
      <View style={workspace.styles.aiCanvasHeader}>
        <View style={workspace.styles.aiCanvasHeaderTitleWrap}>
          <Text style={workspace.styles.aiCanvasEyebrow}>AI Canvas</Text>
          <Text style={workspace.styles.aiCanvasTitle} numberOfLines={1}>
            {canvas.activeNote?.title ?? 'Canvas Notes'}
          </Text>
        </View>
        <Pressable style={workspace.styles.aiCanvasIconButton} onPress={canvas.close}>
          <MaterialCommunityIcons name="close" size={18} color="#5D6676" />
        </Pressable>
      </View>

      {!canvas.enabled ? (
        <View style={workspace.styles.aiCanvasStateCard}>
          <MaterialCommunityIcons name="database-alert-outline" size={22} color="#6D7890" />
          <Text style={workspace.styles.aiCanvasStateTitle}>백엔드에 저장된 노트에서 사용할 수 있습니다.</Text>
          <Text style={workspace.styles.aiCanvasStateBody}>노트가 DB에 저장된 뒤 AI Canvas Notes를 만들고 편집할 수 있어요.</Text>
        </View>
      ) : (
        <>
          <View style={workspace.styles.aiCanvasToolbar}>
            <Pressable style={workspace.styles.aiCanvasPrimaryButton} onPress={canvas.createNote} disabled={canvas.saving}>
              <MaterialCommunityIcons name="plus" size={15} color="#FFFFFF" />
              <Text style={workspace.styles.aiCanvasPrimaryButtonText}>새 Canvas</Text>
            </Pressable>
            <View style={workspace.styles.aiCanvasModeTabs}>
              <Pressable
                style={[workspace.styles.aiCanvasModeTab, canvas.mode === 'preview' && workspace.styles.aiCanvasModeTabActive]}
                onPress={() => canvas.setMode('preview')}
              >
                <Text style={[workspace.styles.aiCanvasModeTabText, canvas.mode === 'preview' && workspace.styles.aiCanvasModeTabTextActive]}>보기</Text>
              </Pressable>
              <Pressable
                style={[workspace.styles.aiCanvasModeTab, canvas.mode === 'edit' && workspace.styles.aiCanvasModeTabActive]}
                onPress={() => canvas.setMode('edit')}
              >
                <Text style={[workspace.styles.aiCanvasModeTabText, canvas.mode === 'edit' && workspace.styles.aiCanvasModeTabTextActive]}>편집</Text>
              </Pressable>
            </View>
          </View>

          {canvas.loading ? (
            <View style={workspace.styles.aiCanvasLoading}>
              <ActivityIndicator size="small" color="#5F79FF" />
              <Text style={workspace.styles.aiCanvasStateBody}>Canvas Notes를 불러오는 중입니다.</Text>
            </View>
          ) : null}

          {canvas.error ? <Text style={workspace.styles.aiCanvasErrorText}>{canvas.error}</Text> : null}

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={workspace.styles.aiCanvasNoteTabs} contentContainerStyle={workspace.styles.aiCanvasNoteTabsContent}>
            {canvas.notes.map((note) => {
              const active = note.id === canvas.activeNoteId;
              return (
                <Pressable
                  key={note.id}
                  style={[workspace.styles.aiCanvasNoteTab, active && workspace.styles.aiCanvasNoteTabActive]}
                  onPress={() => canvas.selectNote(note.id)}
                >
                  <Text style={[workspace.styles.aiCanvasNoteTabText, active && workspace.styles.aiCanvasNoteTabTextActive]} numberOfLines={1}>{note.title}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {canvas.activeNote ? (
            <View style={workspace.styles.aiCanvasEditorShell}>
              <ScrollView
                style={workspace.styles.aiCanvasEditorScroll}
                contentContainerStyle={workspace.styles.aiCanvasEditorContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator
              >
                <TextInput
                  value={canvas.titleDraft}
                  onChangeText={canvas.setTitleDraft}
                  placeholder="Canvas 제목"
                  placeholderTextColor="#A2AAB8"
                  style={workspace.styles.aiCanvasTitleInput}
                />
                {canvas.mode === 'edit' ? (
                  <TextInput
                    value={canvas.markdownDraft}
                    onChangeText={canvas.setMarkdownDraft}
                    placeholder="Markdown으로 정리 내용을 작성하세요."
                    placeholderTextColor="#A2AAB8"
                    multiline
                    textAlignVertical="top"
                    style={workspace.styles.aiCanvasMarkdownInput}
                  />
                ) : (
                  <View style={workspace.styles.aiCanvasPreviewBox}>
                    <MarkdownPreview markdown={canvas.markdownDraft} styles={workspace.styles} />
                  </View>
                )}

                {canvas.aiEditing ? (
                  <View style={workspace.styles.aiCanvasAiDraftCard}>
                    <ActivityIndicator size="small" color="#5F79FF" />
                    <Text style={workspace.styles.aiCanvasAiEditTitle}>AI Chat 답변으로 Canvas 수정안을 만드는 중입니다.</Text>
                  </View>
                ) : null}

                {canvas.aiDraftMarkdown !== null ? (
                  <View style={workspace.styles.aiCanvasAiDraftCard}>
                    <Text style={workspace.styles.aiCanvasAiEditTitle}>AI 수정안 미리보기</Text>
                    <ScrollView style={workspace.styles.aiCanvasAiDraftPreview} contentContainerStyle={workspace.styles.aiCanvasPreviewContent}>
                      <MarkdownPreview markdown={canvas.aiDraftMarkdown} styles={workspace.styles} />
                    </ScrollView>
                    <View style={workspace.styles.aiCanvasFooter}>
                      <Pressable style={workspace.styles.aiCanvasDeleteButton} onPress={canvas.discardAiDraft}>
                        <Text style={workspace.styles.aiCanvasDeleteButtonText}>취소</Text>
                      </Pressable>
                      <Pressable style={workspace.styles.aiCanvasSaveButton} onPress={canvas.applyAiDraft}>
                        <Text style={workspace.styles.aiCanvasSaveButtonText}>적용</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                <View style={workspace.styles.aiCanvasFooter}>
                  <Pressable style={workspace.styles.aiCanvasDeleteButton} onPress={canvas.deleteActiveNote} disabled={canvas.saving}>
                    <MaterialCommunityIcons name="trash-can-outline" size={15} color="#C04B4B" />
                    <Text style={workspace.styles.aiCanvasDeleteButtonText}>삭제</Text>
                  </Pressable>
                  <Pressable
                    style={[workspace.styles.aiCanvasSaveButton, (!canvas.hasUnsavedChanges || canvas.saving) && workspace.styles.aiCanvasSaveButtonDisabled]}
                    onPress={canvas.saveNote}
                    disabled={!canvas.hasUnsavedChanges || canvas.saving}
                  >
                    {canvas.saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={workspace.styles.aiCanvasSaveButtonText}>저장</Text>}
                  </Pressable>
                </View>
              </ScrollView>
            </View>
          ) : (
            <View style={workspace.styles.aiCanvasStateCard}>
              <MaterialCommunityIcons name="note-edit-outline" size={22} color="#6D7890" />
              <Text style={workspace.styles.aiCanvasStateTitle}>아직 Canvas Note가 없습니다.</Text>
              <Text style={workspace.styles.aiCanvasStateBody}>새 Canvas를 만들어 요약이나 정리 내용을 저장하세요.</Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}
