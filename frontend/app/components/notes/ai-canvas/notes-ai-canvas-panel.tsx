import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Image, PanResponder, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';

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
  const [noteListOpen, setNoteListOpen] = React.useState(false);
  const [noteActionMenuId, setNoteActionMenuId] = React.useState<number | null>(null);
  const [pendingRenameNoteId, setPendingRenameNoteId] = React.useState<number | null>(null);
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = React.useState<number | null>(null);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [miniCommand, setMiniCommand] = React.useState('');
  const [miniSelectionImageUri, setMiniSelectionImageUri] = React.useState<string | null>(null);

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

  const noteActionMenuNote = React.useMemo(
    () => canvas.notes.find((note) => note.id === noteActionMenuId) ?? null,
    [canvas.notes, noteActionMenuId],
  );
  const startRename = () => {
    const targetNote = noteActionMenuNote ?? canvas.activeNote;
    if (!targetNote) return;
    setPendingRenameNoteId(targetNote.id);
    setNoteActionMenuId(null);
    setNoteListOpen(false);
    setRenameDraft(targetNote.title);
    setRenameError(null);
    setRenameOpen(true);
  };
  const cancelRename = () => {
    setRenameOpen(false);
    setPendingRenameNoteId(null);
    setRenameDraft('');
    setRenameError(null);
  };
  const saveRename = async () => {
    if (!renameDraft.trim()) {
      setRenameError('Canvas 이름을 입력해 주세요.');
      return;
    }
    const saved = await canvas.renameNote(renameDraft, pendingRenameNoteId ?? undefined);
    if (saved) cancelRename();
  };
  const openDeleteConfirm = () => {
    const targetNote = noteActionMenuNote ?? canvas.activeNote;
    if (!targetNote) return;
    setPendingDeleteNoteId(targetNote.id);
    setNoteActionMenuId(null);
    setNoteListOpen(false);
    setDeleteConfirmOpen(true);
  };
  const closeMenus = () => {
    setNoteListOpen(false);
    setNoteActionMenuId(null);
  };
  const confirmDelete = async () => {
    setDeleteConfirmOpen(false);
    await canvas.deleteNote(pendingDeleteNoteId ?? undefined);
    setPendingDeleteNoteId(null);
  };
  const submitMiniCommand = async () => {
    const command = miniCommand.trim();
    if (!command || workspace.aiLoading) return;
    const sent = await workspace.onRequestAiCanvasCommand(command, {
      selectionImageUri: miniSelectionImageUri,
    });
    if (sent) {
      setMiniCommand('');
      setMiniSelectionImageUri(null);
    }
  };
  const pasteCopiedSelectionImage = () => {
    if (!workspace.copiedSelectionImageUri) return;
    setMiniSelectionImageUri(workspace.copiedSelectionImageUri);
  };
  const renderMiniCommandInput = () => {
    if (workspace.aiPanelOpen) return null;

    return (
      <View style={workspace.styles.aiCanvasMiniComposer}>
        {miniSelectionImageUri ? (
          <View style={workspace.styles.aiCanvasMiniAttachment}>
            <Image source={{ uri: miniSelectionImageUri }} style={workspace.styles.aiCanvasMiniAttachmentImage} resizeMode="cover" />
            <Pressable
              style={workspace.styles.aiCanvasMiniAttachmentRemove}
              onPress={() => setMiniSelectionImageUri(null)}
            >
              <MaterialCommunityIcons name="close" size={12} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : workspace.copiedSelectionImageUri ? (
          <Pressable style={workspace.styles.aiCanvasPasteSelectionButton} onPress={pasteCopiedSelectionImage}>
            <MaterialCommunityIcons name="content-paste" size={14} color="#405CD1" />
            <Text style={workspace.styles.aiCanvasPasteSelectionText}>복사한 선택 영역 붙여넣기</Text>
          </Pressable>
        ) : null}
        <View style={workspace.styles.aiCanvasMiniInputBar}>
          <TextInput
            value={miniCommand}
            onChangeText={setMiniCommand}
            placeholder="이 Canvas에 추가하거나 수정할 내용을 입력하세요"
            placeholderTextColor="#9AA3B2"
            style={workspace.styles.aiCanvasMiniInput}
            multiline
            textAlignVertical="center"
            editable={!workspace.aiLoading}
            onSubmitEditing={submitMiniCommand}
          />
          <Pressable
            style={[
              workspace.styles.aiCanvasMiniSendButton,
              (!miniCommand.trim() || workspace.aiLoading) && workspace.styles.aiCanvasMiniSendButtonDisabled,
            ]}
            onPress={submitMiniCommand}
            disabled={!miniCommand.trim() || workspace.aiLoading}
          >
            {workspace.aiLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <MaterialCommunityIcons name="arrow-up" size={18} color="#FFFFFF" />
            )}
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={[workspace.styles.aiCanvasPanel, { width: canvasWidth }]}>
      {noteListOpen ? (
        <Pressable style={workspace.styles.aiCanvasMenuDismissLayer} onPress={closeMenus} />
      ) : null}
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
            <View style={workspace.styles.aiCanvasTitleButton}>
              <Text style={workspace.styles.aiCanvasTitle} numberOfLines={1}>
                {canvas.activeNote?.title ?? 'Canvas Notes'}
              </Text>
            </View>
            <Pressable
              style={workspace.styles.aiCanvasDropdownButton}
              onPress={() => {
                setNoteActionMenuId(null);
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
          {noteListOpen ? (
            <View style={workspace.styles.aiCanvasNoteListMenu}>
              {canvas.notes.map((note) => {
                const active = note.id === canvas.activeNoteId;
                return (
                  <View key={note.id} style={workspace.styles.aiCanvasNoteListMenuItemWrap}>
                    <Pressable
                      style={[
                        workspace.styles.aiCanvasNoteListMenuItem,
                        active && workspace.styles.aiCanvasNoteListMenuItemActive,
                      ]}
                      onPress={() => {
                        canvas.selectNote(note.id);
                        setNoteListOpen(false);
                        setNoteActionMenuId(null);
                      }}
                      onLongPress={() => {
                        setNoteActionMenuId(note.id);
                      }}
                      delayLongPress={350}
                    >
                      <Text
                        style={[
                          workspace.styles.aiCanvasNoteListMenuText,
                          active && workspace.styles.aiCanvasNoteListMenuTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {note.title}
                      </Text>
                    </Pressable>
                    {noteActionMenuId === note.id ? (
                      <View style={workspace.styles.aiCanvasNoteActionMenu}>
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
                );
              })}
            </View>
          ) : null}
        </View>
        <View style={workspace.styles.aiCanvasHeaderActions}>
          <View style={workspace.styles.aiCanvasHistoryActions}>
            <Pressable
              style={[workspace.styles.aiCanvasHistoryButton, !canvas.canUndo && workspace.styles.aiCanvasHistoryButtonDisabled]}
              onPress={canvas.undoCanvasEdit}
              disabled={!canvas.canUndo}
            >
              <MaterialCommunityIcons name="undo" size={18} color={canvas.canUndo ? '#405CD1' : '#A8B0BF'} />
            </Pressable>
            <Pressable
              style={[workspace.styles.aiCanvasHistoryButton, !canvas.canRedo && workspace.styles.aiCanvasHistoryButtonDisabled]}
              onPress={canvas.redoCanvasEdit}
              disabled={!canvas.canRedo}
            >
              <MaterialCommunityIcons name="redo" size={18} color={canvas.canRedo ? '#405CD1' : '#A8B0BF'} />
            </Pressable>
          </View>
          <Pressable
            style={[
              workspace.styles.aiCanvasHeaderNewButton,
              canvas.saving && workspace.styles.aiCanvasSaveButtonDisabled,
            ]}
            onPress={canvas.createNote}
            disabled={canvas.saving}
          >
            <MaterialCommunityIcons name="note-edit-outline" size={20} color="#111827" />
          </Pressable>
          <Pressable style={workspace.styles.aiCanvasIconButton} onPress={canvas.close}>
            <MaterialCommunityIcons name="close" size={22} color="#303744" />
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
          {canvas.loading ? (
            <View style={workspace.styles.aiCanvasLoading}>
              <ActivityIndicator size="small" color="#5F79FF" />
              <Text style={workspace.styles.aiCanvasStateBody}>Canvas Notes를 불러오는 중입니다.</Text>
            </View>
          ) : null}

          {canvas.error ? <Text style={workspace.styles.aiCanvasErrorText}>{canvas.error}</Text> : null}

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
              {renderMiniCommandInput()}
            </View>
          ) : (
            <View style={workspace.styles.aiCanvasEditorShell}>
              <View style={workspace.styles.aiCanvasEmptyState}>
                <Text style={workspace.styles.aiCanvasEmptyText}>
                  새 Canvas를 만들어 요약이나 정리 내용을 저장해주세요.
                </Text>
              </View>
              {renderMiniCommandInput()}
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
        <Pressable
          style={workspace.styles.aiPanelDialogOverlay}
          onPress={() => {
            setDeleteConfirmOpen(false);
            setPendingDeleteNoteId(null);
          }}
        >
          <Pressable style={workspace.styles.aiRenameModalCard} onPress={(event) => event.stopPropagation()}>
            <Text style={workspace.styles.aiRenameModalTitle}>Canvas 삭제</Text>
            <Text style={workspace.styles.aiRenameModalBody}>
              "{canvas.notes.find((note) => note.id === pendingDeleteNoteId)?.title ?? canvas.activeNote?.title ?? ''}" Canvas를 삭제할까요?
            </Text>
            <View style={workspace.styles.aiRenameModalActions}>
              <Pressable
                style={workspace.styles.aiRenameModalCancelButton}
                onPress={() => {
                  setDeleteConfirmOpen(false);
                  setPendingDeleteNoteId(null);
                }}
                disabled={canvas.saving}
              >
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
