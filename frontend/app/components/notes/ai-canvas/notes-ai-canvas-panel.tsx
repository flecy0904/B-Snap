import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from 'react-native';

import { useDesktopNotesWorkspaceContext } from '../workspace/notes-workspace-context';

const AI_CANVAS_MINI_PROMPTS = ['마무리 다듬기', '수준 조정', '길이 조절'];

export function NotesAiCanvasPanel() {
  const workspace = useDesktopNotesWorkspaceContext();
  const canvas = workspace.aiCanvas;
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
  const [miniComposerOpen, setMiniComposerOpen] = React.useState(false);
  const isAppAiCanvasSidebar = Boolean(workspace.isAppAiCanvasSidebarPanel);
  const miniCommandReady = Boolean(miniCommand.trim());

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
      setMiniComposerOpen(false);
    }
  };
  const closeMiniComposer = () => {
    setMiniCommand('');
    setMiniSelectionImageUri(null);
    setMiniComposerOpen(false);
  };
  const pasteCopiedSelectionImage = () => {
    if (!workspace.copiedSelectionImageUri) return;
    setMiniSelectionImageUri(workspace.copiedSelectionImageUri);
  };
  const closeCanvasPanel = () => {
    if (isAppAiCanvasSidebar) {
      workspace.onCloseAppRightSidebar();
      return;
    }
    canvas.close();
  };
  const renderMiniCommandInput = () => {
    if (workspace.aiPanelOpen) return null;

    return (
      <View
        pointerEvents="box-none"
        style={[
          workspace.styles.aiCanvasMiniComposer,
          !miniComposerOpen && workspace.styles.aiCanvasMiniComposerFloating,
        ]}
      >
        {miniComposerOpen && miniSelectionImageUri ? (
          <View style={workspace.styles.aiCanvasMiniAttachment}>
            <Image source={{ uri: miniSelectionImageUri }} style={workspace.styles.aiCanvasMiniAttachmentImage} resizeMode="cover" />
            <Pressable
              style={workspace.styles.aiCanvasMiniAttachmentRemove}
              onPress={() => setMiniSelectionImageUri(null)}
            >
              <MaterialCommunityIcons name="close" size={12} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : miniComposerOpen && workspace.copiedSelectionImageUri ? (
          <Pressable style={workspace.styles.aiCanvasPasteSelectionButton} onPress={pasteCopiedSelectionImage}>
            <MaterialCommunityIcons name="content-paste" size={14} color="#405CD1" />
            <Text style={workspace.styles.aiCanvasPasteSelectionText}>복사한 선택 영역 붙여넣기</Text>
          </Pressable>
        ) : null}
        {miniComposerOpen ? (
          <View style={workspace.styles.aiCanvasMiniQuickRow}>
            {AI_CANVAS_MINI_PROMPTS.map((prompt) => (
              <Pressable
                key={prompt}
                style={workspace.styles.aiCanvasMiniQuickChip}
                onPress={() => setMiniCommand(prompt)}
                disabled={workspace.aiLoading}
              >
                <Text style={workspace.styles.aiCanvasMiniQuickChipText}>{prompt}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        {miniComposerOpen ? (
          <View style={workspace.styles.aiCanvasMiniInputBar}>
            <TextInput
              value={miniCommand}
              onChangeText={setMiniCommand}
              placeholder="AI에게 수정 요청"
              placeholderTextColor="#8F96A3"
              style={workspace.styles.aiCanvasMiniInput}
              multiline
              editable={!workspace.aiLoading}
              onSubmitEditing={submitMiniCommand}
              autoFocus
            />
            <Pressable
              style={[
                workspace.styles.aiCanvasMiniSendButton,
                workspace.aiLoading && workspace.styles.aiCanvasMiniSendButtonDisabled,
              ]}
              onPress={miniCommandReady ? submitMiniCommand : closeMiniComposer}
              disabled={workspace.aiLoading}
            >
              {workspace.aiLoading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : miniCommandReady ? (
                <MaterialCommunityIcons name="arrow-up" size={18} color="#FFFFFF" />
              ) : (
                <MaterialCommunityIcons name="close" size={18} color="#FFFFFF" />
              )}
            </Pressable>
          </View>
        ) : (
          <View style={workspace.styles.aiCanvasMiniFabAnchor}>
            <Pressable
              style={workspace.styles.aiCanvasMiniSendButton}
              onPress={() => setMiniComposerOpen(true)}
            >
              <MaterialCommunityIcons name="pencil-outline" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        )}
      </View>
    );
  };
  const renderNoteListMenu = () => {
    if (!noteListOpen) return null;

    return (
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
    );
  };

  return (
    <View style={[workspace.styles.aiCanvasPanel, isAppAiCanvasSidebar && workspace.styles.appRightSidebarAiCanvasPanel]}>
      {noteListOpen ? (
        <Pressable style={workspace.styles.aiCanvasMenuDismissLayer} onPress={closeMenus} />
      ) : null}
      <View style={workspace.styles.aiCanvasHeader}>
        <View style={workspace.styles.aiCanvasHeaderTitleWrap}>
          <Text style={workspace.styles.aiCanvasTitle} numberOfLines={1}>
            {canvas.activeNote?.title ?? 'Canvas Notes'}
          </Text>
        </View>
        <View style={workspace.styles.aiCanvasHeaderActions}>
          <Pressable
            style={[
              workspace.styles.aiCanvasHeaderNewButton,
              canvas.saving && workspace.styles.aiCanvasSaveButtonDisabled,
            ]}
            onPress={canvas.createNote}
            disabled={canvas.saving}
          >
            <MaterialCommunityIcons name="note-edit-outline" size={18} color="#111827" />
          </Pressable>
          <View style={workspace.styles.aiHeaderMenuWrap}>
            <Pressable
              style={workspace.styles.aiCanvasIconButton}
              onPress={() => {
                setNoteActionMenuId(null);
                setNoteListOpen((current) => !current);
              }}
              disabled={!canvas.notes.length}
            >
              <MaterialCommunityIcons name="dots-vertical" size={20} color="#303744" />
            </Pressable>
            {renderNoteListMenu()}
          </View>
          <Pressable style={workspace.styles.aiCanvasIconButton} onPress={closeCanvasPanel}>
            <MaterialCommunityIcons name="close" size={20} color="#303744" />
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
              <TextInput
                value={canvas.markdownDraft}
                onChangeText={canvas.setMarkdownDraft}
                onFocus={() => workspace.onFocusWorkspaceTarget('aiCanvas')}
                placeholder="Markdown으로 정리 내용을 작성하세요."
                placeholderTextColor="#A2AAB8"
                multiline
                scrollEnabled
                textAlignVertical="top"
                style={workspace.styles.aiCanvasMarkdownInput}
              />
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
