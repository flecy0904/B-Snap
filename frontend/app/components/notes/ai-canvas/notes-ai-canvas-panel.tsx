import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, PanResponder, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';

import { useDesktopNotesWorkspaceContext } from '../workspace/notes-workspace-context';

const CANVAS_SIDEBAR_MIN_WIDTH = 320;
const CANVAS_SIDEBAR_DEFAULT_WIDTH = 380;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

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
  const { width } = useWindowDimensions();
  const canvasMaxWidth = Math.max(CANVAS_SIDEBAR_MIN_WIDTH, Math.min(760, Math.floor(width * 0.62)));
  const [canvasWidth, setCanvasWidth] = React.useState(CANVAS_SIDEBAR_DEFAULT_WIDTH);
  const canvasWidthRef = React.useRef(CANVAS_SIDEBAR_DEFAULT_WIDTH);
  const [titleMenuOpen, setTitleMenuOpen] = React.useState(false);
  const [noteListOpen, setNoteListOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);

  React.useEffect(() => {
    setCanvasWidth((current) => {
      const next = clamp(current, CANVAS_SIDEBAR_MIN_WIDTH, canvasMaxWidth);
      canvasWidthRef.current = next;
      return next;
    });
  }, [canvasMaxWidth]);

  const resizePanResponder = React.useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 3,
      onPanResponderMove: (_, gesture) => {
        setCanvasWidth(clamp(canvasWidthRef.current - gesture.dx, CANVAS_SIDEBAR_MIN_WIDTH, canvasMaxWidth));
      },
      onPanResponderRelease: (_, gesture) => {
        const next = clamp(canvasWidthRef.current - gesture.dx, CANVAS_SIDEBAR_MIN_WIDTH, canvasMaxWidth);
        canvasWidthRef.current = next;
        setCanvasWidth(next);
      },
      onPanResponderTerminate: (_, gesture) => {
        const next = clamp(canvasWidthRef.current - gesture.dx, CANVAS_SIDEBAR_MIN_WIDTH, canvasMaxWidth);
        canvasWidthRef.current = next;
        setCanvasWidth(next);
      },
    }),
    [canvasMaxWidth],
  );

  const closeTitleMenu = () => setTitleMenuOpen(false);
  const startRename = () => {
    if (!canvas.activeNote) return;
    closeTitleMenu();
    setRenameDraft(canvas.activeNote.title);
    setRenameError(null);
    setRenameOpen(true);
  };
  const cancelRename = () => {
    setRenameOpen(false);
    setRenameDraft('');
    setRenameError(null);
  };
  const saveRename = async () => {
    if (!renameDraft.trim()) {
      setRenameError('Canvas 이름을 입력해 주세요.');
      return;
    }
    const saved = await canvas.renameActiveNote(renameDraft);
    if (saved) cancelRename();
  };
  const openDeleteConfirm = () => {
    if (!canvas.activeNote) return;
    closeTitleMenu();
    setDeleteConfirmOpen(true);
  };
  const confirmDelete = async () => {
    setDeleteConfirmOpen(false);
    await canvas.deleteActiveNote();
  };

  return (
    <View style={[workspace.styles.aiCanvasPanel, { width: canvasWidth }]}>
      <View style={workspace.styles.aiCanvasResizeHandle} {...resizePanResponder.panHandlers}>
        <View style={workspace.styles.aiCanvasResizeGrip}>
          <View style={workspace.styles.aiCanvasResizeDot} />
          <View style={workspace.styles.aiCanvasResizeDot} />
          <View style={workspace.styles.aiCanvasResizeDot} />
        </View>
      </View>
      <View style={workspace.styles.aiCanvasHeader}>
        <View style={workspace.styles.aiCanvasHeaderTitleWrap}>
          <Text style={workspace.styles.aiCanvasEyebrow}>AI Canvas</Text>
          <View style={workspace.styles.aiCanvasTitleRow}>
            <Pressable
              style={workspace.styles.aiCanvasTitleButton}
              onPress={() => {
                if (canvas.activeNote) setTitleMenuOpen((current) => !current);
              }}
              disabled={!canvas.activeNote}
            >
              <Text style={workspace.styles.aiCanvasTitle} numberOfLines={1}>
                {canvas.activeNote?.title ?? 'Canvas Notes'}
              </Text>
            </Pressable>
            <Pressable
              style={workspace.styles.aiCanvasDropdownButton}
              onPress={() => {
                closeTitleMenu();
                setNoteListOpen((current) => !current);
              }}
              disabled={!canvas.notes.length}
            >
              <MaterialCommunityIcons
                name={noteListOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color="#5D6676"
              />
            </Pressable>
          </View>
          {titleMenuOpen ? (
            <View style={workspace.styles.aiCanvasTitleMenu}>
              <Pressable
                style={workspace.styles.aiCanvasTitleMenuItem}
                onPress={startRename}
              >
                <Text style={workspace.styles.aiCanvasTitleMenuText}>이름 바꾸기</Text>
              </Pressable>
              <Pressable
                style={workspace.styles.aiCanvasTitleMenuItem}
                onPress={openDeleteConfirm}
                disabled={canvas.saving}
              >
                <Text style={workspace.styles.aiCanvasTitleMenuDangerText}>삭제하기</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
        <View style={workspace.styles.aiCanvasHeaderActions}>
          <Pressable
            style={[
              workspace.styles.aiCanvasHeaderNewButton,
              (!canvas.canCreateNote || canvas.saving) && workspace.styles.aiCanvasSaveButtonDisabled,
            ]}
            onPress={canvas.createNote}
            disabled={!canvas.canCreateNote || canvas.saving}
          >
            <MaterialCommunityIcons name="plus" size={15} color="#FFFFFF" />
            <Text style={workspace.styles.aiCanvasHeaderNewButtonText}>새 Canvas</Text>
          </Pressable>
          <Pressable style={workspace.styles.aiCanvasIconButton} onPress={canvas.close}>
            <MaterialCommunityIcons name="close" size={18} color="#5D6676" />
          </Pressable>
        </View>
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
            <Text style={workspace.styles.aiCanvasLimitText}>
              {canvas.notes.length}/{canvas.maxNotesPerNote}
            </Text>
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

          {noteListOpen ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={workspace.styles.aiCanvasNoteTabs} contentContainerStyle={workspace.styles.aiCanvasNoteTabsContent}>
              {canvas.notes.map((note) => {
                const active = note.id === canvas.activeNoteId;
                return (
                  <Pressable
                    key={note.id}
                    style={[workspace.styles.aiCanvasNoteTab, active && workspace.styles.aiCanvasNoteTabActive]}
                    onPress={() => {
                      canvas.selectNote(note.id);
                      setNoteListOpen(false);
                    }}
                  >
                    <Text style={[workspace.styles.aiCanvasNoteTabText, active && workspace.styles.aiCanvasNoteTabTextActive]} numberOfLines={1}>{note.title}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          ) : null}

          {canvas.activeNote ? (
            <View style={workspace.styles.aiCanvasEditorShell}>
              <ScrollView
                style={workspace.styles.aiCanvasEditorScroll}
                contentContainerStyle={workspace.styles.aiCanvasEditorContent}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                showsVerticalScrollIndicator
              >
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
                    <ScrollView nestedScrollEnabled style={workspace.styles.aiCanvasAiDraftPreview} contentContainerStyle={workspace.styles.aiCanvasPreviewContent}>
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
      {renameOpen ? (
        <Pressable style={workspace.styles.aiPanelDialogOverlay} onPress={cancelRename}>
          <Pressable style={workspace.styles.aiRenameModalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={workspace.styles.aiRenameModalTitle}>Canvas 이름 바꾸기</Text>
            <TextInput
              value={renameDraft}
              onChangeText={(value) => {
                setRenameDraft(value);
                if (renameError && value.trim()) setRenameError(null);
              }}
              placeholder="Canvas 이름"
              placeholderTextColor="#8F96A3"
              style={[workspace.styles.aiRenameModalInput, renameError && workspace.styles.aiRenameModalInputError]}
              returnKeyType="done"
              onSubmitEditing={saveRename}
              autoFocus
            />
            {renameError ? <Text style={workspace.styles.aiRenameModalError}>{renameError}</Text> : null}
            <View style={workspace.styles.aiRenameModalActions}>
              <Pressable style={workspace.styles.aiRenameModalCancelButton} onPress={cancelRename} disabled={canvas.saving}>
                <Text style={workspace.styles.aiRenameModalCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[workspace.styles.aiRenameModalSaveButton, (!renameDraft.trim() || canvas.saving) && workspace.styles.aiRenameModalSaveButtonDisabled]}
                onPress={saveRename}
                disabled={!renameDraft.trim() || canvas.saving}
              >
                <Text style={workspace.styles.aiRenameModalSaveText}>이름 바꾸기</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      ) : null}
      {deleteConfirmOpen ? (
        <Pressable style={workspace.styles.aiPanelDialogOverlay} onPress={() => setDeleteConfirmOpen(false)}>
          <Pressable style={workspace.styles.aiRenameModalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={workspace.styles.aiRenameModalTitle}>Canvas 삭제</Text>
            <Text style={workspace.styles.aiRenameModalBody}>
              "{canvas.activeNote?.title ?? ''}" Canvas를 삭제할까요?
            </Text>
            <View style={workspace.styles.aiRenameModalActions}>
              <Pressable style={workspace.styles.aiRenameModalCancelButton} onPress={() => setDeleteConfirmOpen(false)} disabled={canvas.saving}>
                <Text style={workspace.styles.aiRenameModalCancelText}>취소</Text>
              </Pressable>
              <Pressable style={workspace.styles.aiRenameModalDangerButton} onPress={confirmDelete} disabled={canvas.saving}>
                <Text style={workspace.styles.aiRenameModalSaveText}>삭제</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      ) : null}
    </View>
  );
}
