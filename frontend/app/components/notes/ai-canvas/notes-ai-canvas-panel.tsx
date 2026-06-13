import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { hasUsefulAiCanvasMarkdown } from '../../../hooks/notes/ai-canvas/use-ai-canvas-notes';
import { isCanvasCreateRequest } from '../../../hooks/notes/ai-canvas/canvas-command-intent';
import { useAppKeyboardInset } from '../../../hooks/notes/use-app-keyboard-inset';
import { useDelayedTooltip } from '../../../hooks/notes/use-delayed-tooltip';
import AiCanvasMarkdownEditor from './ai-canvas-markdown-editor.dom';
import { useDesktopNotesWorkspaceContext } from '../workspace/notes-workspace-context';
import type { AiCanvasBlockContext, AiCanvasRecommendationMode } from '../../../types/ai-canvas';

const AI_CANVAS_MINI_PROMPTS = ['마무리 다듬기', '수준 조정', '길이 조절', '정리 보강'];

type RecommendationMode = 'polish' | 'level' | 'length' | 'study' | null;

type WebCanvasResizeState = {
  pointerId: number | null;
  startClientX: number;
  startWidth: number;
};

function handleWebSubmitKeyPress(event: any, submit: () => void) {
  if (Platform.OS !== 'web') return;
  const key = event?.key ?? event?.nativeEvent?.key;
  const shiftKey = Boolean(event?.shiftKey ?? event?.nativeEvent?.shiftKey);
  if (key !== 'Enter' || shiftKey) return;
  event.preventDefault?.();
  submit();
}

const AI_CANVAS_RECOMMENDATION_COMMANDS = {
  polish: '마무리 다듬기',
  simplify: '수준 조정 - 쉽게',
  professionalize: '수준 조정 - 전문적으로',
  shorten: '길이 조절 - 짧게',
  expand: '길이 조절 - 길게',
  studyRestructure: '정리 보강 - 구조화',
  studyKeyPoints: '정리 보강 - 핵심만',
  studyMarkUncertain: '정리 보강 - 오류 의심 표시',
};

function isDefaultAiCanvasTitle(title?: string | null) {
  const normalized = (title ?? '').trim();
  if (!normalized) return true;
  if (/^Canvas Note(?:\s+\d+)?$/.test(normalized)) return true;
  return /^p\.\d+(?:-\d+)?\s+메모$/.test(normalized);
}

function getCanvasCreatedAtTime(note: { id: number; created_at?: string | null }) {
  const time = note.created_at ? new Date(note.created_at).getTime() : Number.NaN;
  return Number.isNaN(time) ? note.id : time;
}

function getCanvasNoteCreationIndex(
  note: { id: number; created_at?: string | null },
  notes: Array<{ id: number; created_at?: string | null }>,
) {
  const sorted = [...notes].sort((left, right) => {
    const timeDiff = getCanvasCreatedAtTime(left) - getCanvasCreatedAtTime(right);
    return timeDiff || left.id - right.id;
  });
  const index = sorted.findIndex((item) => item.id === note.id);
  return index >= 0 ? index + 1 : sorted.length + 1;
}

function formatCanvasNoteTitle(
  note: { id: number; title?: string | null; created_at?: string | null } | null | undefined,
  notes: Array<{ id: number; created_at?: string | null }>,
) {
  if (!note) return 'Canvas Notes';
  if (!isDefaultAiCanvasTitle(note.title)) return note.title ?? 'Canvas Note';
  return `Canvas Note ${getCanvasNoteCreationIndex(note, notes)}`;
}

function formatCanvasUpdatedAt(value?: string | Date | null) {
  if (!value) return '최근 수정';
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return '최근 수정';
  const diffMs = Date.now() - time;
  const minuteMs = 60 * 1000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (diffMs < minuteMs) return '방금 전';
  if (diffMs < hourMs) return `${Math.max(1, Math.floor(diffMs / minuteMs))}분 전`;
  if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}시간 전`;
  if (diffMs < dayMs * 7) return `${Math.floor(diffMs / dayMs)}일 전`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getActiveSelectionContext(selection?: { from: number; to: number; context?: AiCanvasBlockContext | null } | null) {
  if (!selection || selection.from === selection.to) return null;
  return selection.context ?? null;
}

export function NotesAiCanvasPanel() {
  const workspace = useDesktopNotesWorkspaceContext();
  const { activeTooltipId, hoveredTooltipId, getTooltipTriggerProps, hideTooltip } = useDelayedTooltip();
  const canvas = workspace.aiCanvas;
  const [noteListOpen, setNoteListOpen] = React.useState(false);
  const [noteActionMenuId, setNoteActionMenuId] = React.useState<number | null>(null);
  const [pendingRenameNoteId, setPendingRenameNoteId] = React.useState<number | null>(null);
  const [pendingDeleteNoteId, setPendingDeleteNoteId] = React.useState<number | null>(null);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
  const [miniCommand, setMiniCommand] = React.useState('');
  const [miniSelectionImageUri, setMiniSelectionImageUri] = React.useState<string | null>(null);
  const [miniComposerOpen, setMiniComposerOpen] = React.useState(false);
  const [miniSelectionContext, setMiniSelectionContext] = React.useState<AiCanvasBlockContext | null>(null);
  const [recommendationMode, setRecommendationMode] = React.useState<RecommendationMode>(null);
  const [canvasRequestBusy, setCanvasRequestBusy] = React.useState(false);
  const [nativeEditorMode, setNativeEditorMode] = React.useState<'view' | 'edit'>('view');
  const [webCanvasResizeActive, setWebCanvasResizeActive] = React.useState(false);
  const webCanvasWidthRef = React.useRef(workspace.webAiCanvasPanelWidth);
  const webCanvasResizeDraggingRef = React.useRef(false);
  const webCanvasResizeRef = React.useRef<WebCanvasResizeState | null>(null);
  const isAppAiCanvasSidebar = Boolean(workspace.isAppAiCanvasSidebarPanel);
  const appKeyboardInset = useAppKeyboardInset(isAppAiCanvasSidebar);
  const isWebAiCanvasPanel = Platform.OS === 'web' && !isAppAiCanvasSidebar;
  const isNativeApp = Platform.OS !== 'web';
  const canvasEditModeEnabled = !isNativeApp || nativeEditorMode === 'edit';
  const canvasControlsLocked = canvasRequestBusy || workspace.aiCanvasRequestBusy;
  const canvasAiEditingBusy = canvasRequestBusy || workspace.aiCanvasRequestBusy || Boolean(canvas.pendingCanvasOperations);
  const editorEditable = canvasEditModeEnabled && !canvasControlsLocked;
  const canvasCanModify = canvasEditModeEnabled;
  const recommendationBusy = canvasRequestBusy || workspace.aiLoading || canvas.loading || canvas.saving;
  const baseRecommendationAvailable = canvasCanModify && Boolean(canvas.activeNote) && !recommendationBusy;
  const hasCanvasContent = hasUsefulAiCanvasMarkdown(canvas.markdownDraft);
  const miniCommandReady = Boolean(miniCommand.trim());
  const canvasManagementDisabled = canvasControlsLocked || canvas.loading || canvas.saving;
  const canUndoCanvas = Boolean(canvas.activeNote && canvas.canUndo && !canvasControlsLocked);
  const canRedoCanvas = Boolean(canvas.activeNote && canvas.canRedo && !canvasControlsLocked);
  const resizeWebAiCanvasPanel = workspace.onResizeWebAiCanvasPanel;
  const appKeyboardAvoidingStyle = appKeyboardInset > 0 ? { paddingBottom: appKeyboardInset + 12 } : null;

  React.useEffect(() => {
    webCanvasWidthRef.current = workspace.webAiCanvasPanelWidth;
  }, [workspace.webAiCanvasPanelWidth]);

  React.useEffect(() => {
    if (!canvasControlsLocked) return;
    setNoteListOpen(false);
    setNoteActionMenuId(null);
    setRenameOpen(false);
    setHelpOpen(false);
    setDeleteConfirmOpen(false);
    setPendingRenameNoteId(null);
    setPendingDeleteNoteId(null);
  }, [canvasControlsLocked]);

  const noteActionMenuNote = React.useMemo(
    () => canvas.notes.find((note) => note.id === noteActionMenuId) ?? null,
    [canvas.notes, noteActionMenuId],
  );
  const startRename = () => {
    if (canvasControlsLocked) return;
    const targetNote = noteActionMenuNote ?? canvas.activeNote;
    if (!targetNote) return;
    setPendingRenameNoteId(targetNote.id);
    setNoteActionMenuId(null);
    setNoteListOpen(false);
    setRenameDraft(formatCanvasNoteTitle(targetNote, canvas.notes));
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
    if (canvasManagementDisabled) return;
    if (!renameDraft.trim()) {
      setRenameError('Canvas 이름을 입력해 주세요.');
      return;
    }
    const saved = await canvas.renameNote(renameDraft, pendingRenameNoteId ?? undefined);
    if (saved) cancelRename();
  };
  const openDeleteConfirm = () => {
    if (canvasControlsLocked) return;
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
  const finishWebCanvasResize = React.useCallback((clientX: number) => {
    const resize = webCanvasResizeRef.current;
    if (!resize) return;
    const next = resize.startWidth - (clientX - resize.startClientX);
    webCanvasResizeRef.current = null;
    webCanvasResizeDraggingRef.current = false;
    resizeWebAiCanvasPanel(next);
    setWebCanvasResizeActive(false);
  }, [resizeWebAiCanvasPanel]);

  const handleWebCanvasResizePointerMove = React.useCallback((event: PointerEvent) => {
    const resize = webCanvasResizeRef.current;
    if (!resize || (resize.pointerId !== null && event.pointerId !== resize.pointerId)) return;
    resizeWebAiCanvasPanel(resize.startWidth - (event.clientX - resize.startClientX));
  }, [resizeWebAiCanvasPanel]);

  const handleWebCanvasResizePointerUp = React.useCallback((event: PointerEvent) => {
    const resize = webCanvasResizeRef.current;
    if (!resize || (resize.pointerId !== null && event.pointerId !== resize.pointerId)) return;
    finishWebCanvasResize(event.clientX);
  }, [finishWebCanvasResize]);

  React.useEffect(() => {
    if (!isWebAiCanvasPanel) return undefined;
    window.addEventListener('pointermove', handleWebCanvasResizePointerMove);
    window.addEventListener('pointerup', handleWebCanvasResizePointerUp);
    window.addEventListener('pointercancel', handleWebCanvasResizePointerUp);
    return () => {
      window.removeEventListener('pointermove', handleWebCanvasResizePointerMove);
      window.removeEventListener('pointerup', handleWebCanvasResizePointerUp);
      window.removeEventListener('pointercancel', handleWebCanvasResizePointerUp);
      webCanvasResizeRef.current = null;
      webCanvasResizeDraggingRef.current = false;
    };
  }, [handleWebCanvasResizePointerMove, handleWebCanvasResizePointerUp, isWebAiCanvasPanel]);

  const handleWebCanvasResizePointerDown = React.useCallback((event: any) => {
    if (!isWebAiCanvasPanel) return;
    const nativeEvent = event?.nativeEvent ?? event;
    if (typeof nativeEvent.button === 'number' && nativeEvent.button !== 0) return;
    closeMenus();
    webCanvasResizeRef.current = {
      pointerId: typeof nativeEvent.pointerId === 'number' ? nativeEvent.pointerId : null,
      startClientX: nativeEvent.clientX,
      startWidth: webCanvasWidthRef.current,
    };
    webCanvasResizeDraggingRef.current = true;
    setWebCanvasResizeActive(true);
    nativeEvent.preventDefault?.();
    nativeEvent.stopPropagation?.();
  }, [isWebAiCanvasPanel]);

  const confirmDelete = async () => {
    if (canvasManagementDisabled) return;
    setDeleteConfirmOpen(false);
    await canvas.deleteNote(pendingDeleteNoteId ?? undefined);
    setPendingDeleteNoteId(null);
  };
  const openMiniComposer = () => {
    setMiniSelectionContext(getActiveSelectionContext(canvas.selectionDraft));
    setMiniComposerOpen(true);
  };
  const submitMiniCommand = async () => {
    const command = miniCommand.trim();
    if (!command || recommendationBusy) return;
    const locallyBlocked = isCanvasCreateRequest(command) || !canvas.activeNote;
    setCanvasRequestBusy(true);
    try {
      const sent = await workspace.onRequestAiCanvasCommand(command, {
        selectionImageUri: miniSelectionImageUri,
        canvasAction: 'auto',
        source: 'canvas-mini',
        canvasBlockContext: miniSelectionContext ?? getActiveSelectionContext(canvas.selectionDraft),
      });
      if (sent) {
        setMiniCommand('');
        setMiniSelectionImageUri(null);
        setMiniSelectionContext(null);
        setMiniComposerOpen(false);
      }
      if (!sent && !locallyBlocked) {
        canvas.showFeedback('Canvas 수정에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      }
    } finally {
      setCanvasRequestBusy(false);
    }
  };
  const submitRecommendationCommand = async (command: string, mode: AiCanvasRecommendationMode) => {
    if (!canRunRecommendationMode(mode)) return;
    setCanvasRequestBusy(true);
    try {
      const sent = await workspace.onRequestAiCanvasCommand(command, {
        selectionImageUri: miniSelectionImageUri,
        canvasAction: 'canvas_edit',
        source: 'canvas-mini',
        canvasNoteNeedsTitle: isDefaultAiCanvasTitle(canvas.activeNote?.title),
        canvasBlockContext: miniSelectionContext ?? getActiveSelectionContext(canvas.selectionDraft),
        canvasRecommendationMode: mode,
      });
      if (sent) {
        setRecommendationMode(null);
        setMiniCommand('');
        setMiniSelectionImageUri(null);
        setMiniSelectionContext(null);
        setMiniComposerOpen(false);
        return;
      }
      canvas.showFeedback('Canvas 수정에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setCanvasRequestBusy(false);
    }
  };
  const closeMiniComposer = () => {
    setMiniCommand('');
    setMiniSelectionImageUri(null);
    setMiniSelectionContext(null);
    setMiniComposerOpen(false);
    setRecommendationMode(null);
  };
  const pasteCopiedSelectionImage = () => {
    if (canvasControlsLocked) return;
    if (!workspace.copiedSelectionImageUri) return;
    setMiniSelectionImageUri(workspace.copiedSelectionImageUri);
  };
  const submitBlockAiCommand = async (command: string, canvasBlockContext: AiCanvasBlockContext) => {
    if (!command.trim() || recommendationBusy) return false;
    setCanvasRequestBusy(true);
    try {
      const sent = await workspace.onRequestAiCanvasCommand(command, {
        canvasAction: 'auto',
        source: 'canvas-block',
        canvasBlockContext,
      });
      if (!sent) {
        canvas.showFeedback('AI 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.');
      }
      return sent;
    } finally {
      setCanvasRequestBusy(false);
    }
  };
  const closeCanvasPanel = () => {
    if (isAppAiCanvasSidebar) {
      workspace.onCloseAppRightSidebar();
      return;
    }
    canvas.close();
  };
  const renderAiTooltip = (id: string, label: string, placement: 'above' | 'below' = 'below') => (
    activeTooltipId === id ? (
      <View
        pointerEvents="none"
        style={[
          workspace.styles.aiTooltipBubble,
          placement === 'above' ? workspace.styles.aiTooltipAbove : workspace.styles.aiTooltipBelow,
        ]}
      >
        <Text style={workspace.styles.aiTooltipText} numberOfLines={1}>{label}</Text>
      </View>
    ) : null
  );
  const getAiCanvasHeaderIconButtonStyle = (id: string, active = false) => [
    workspace.styles.aiCanvasIconButton,
    hoveredTooltipId === id && workspace.styles.aiCanvasIconButtonHover,
    active && workspace.styles.aiCanvasIconButtonActive,
  ];
  const getAiCanvasHeaderNewButtonStyle = (id: string) => [
    workspace.styles.aiCanvasHeaderNewButton,
    hoveredTooltipId === id && workspace.styles.aiCanvasHeaderNewButtonHover,
    (canvasManagementDisabled || !canvas.canCreateNote) && workspace.styles.aiCanvasSaveButtonDisabled,
  ];
  const getAiCanvasHeaderHistoryButtonStyle = (id: string, enabled: boolean) => [
    workspace.styles.aiCanvasIconButton,
    hoveredTooltipId === id && enabled && workspace.styles.aiCanvasIconButtonHover,
    !enabled && workspace.styles.aiCanvasSaveButtonDisabled,
  ];
  const canRunRecommendationMode = (mode: AiCanvasRecommendationMode) => {
    if (!baseRecommendationAvailable) return false;
    return hasCanvasContent;
  };
  const canOpenRecommendationGroup = (prompt: string) => (
    prompt === '정리 보강' ? baseRecommendationAvailable : baseRecommendationAvailable && hasCanvasContent
  );
  const preserveCanvasSelectionProps = Platform.OS === 'web'
    ? ({
        onMouseDown: (event: any) => {
          if (miniSelectionContext || getActiveSelectionContext(canvas.selectionDraft)) {
            event.preventDefault?.();
          }
        },
      } as any)
    : {};
  const renderRecommendationChip = (label: string, command: string, mode: AiCanvasRecommendationMode) => {
    const enabled = canRunRecommendationMode(mode);
    return (
      <Pressable
        {...preserveCanvasSelectionProps}
        style={[workspace.styles.aiCanvasMiniQuickChip, !enabled && workspace.styles.aiCanvasMiniQuickChipDisabled]}
        onPress={() => submitRecommendationCommand(command, mode)}
        disabled={!enabled}
      >
        <Text style={workspace.styles.aiCanvasMiniQuickChipText}>{label}</Text>
      </Pressable>
    );
  };
  const renderRecommendationActions = () => {
    if (!miniComposerOpen) return null;

    if (recommendationMode === 'polish') {
      return (
        <View style={workspace.styles.aiCanvasMiniQuickRow}>
          <Pressable style={workspace.styles.aiCanvasMiniQuickChip} onPress={() => setRecommendationMode(null)} disabled={recommendationBusy}>
            <MaterialCommunityIcons name="close" size={14} color="#4F68D2" />
          </Pressable>
          {renderRecommendationChip('실행', AI_CANVAS_RECOMMENDATION_COMMANDS.polish, 'polish')}
        </View>
      );
    }

    if (recommendationMode === 'level') {
      return (
        <View style={workspace.styles.aiCanvasMiniQuickRow}>
          <Pressable style={workspace.styles.aiCanvasMiniQuickChip} onPress={() => setRecommendationMode(null)} disabled={recommendationBusy}>
            <MaterialCommunityIcons name="close" size={14} color="#4F68D2" />
          </Pressable>
          {renderRecommendationChip('쉽게', AI_CANVAS_RECOMMENDATION_COMMANDS.simplify, 'simplify')}
          {renderRecommendationChip('전문적으로', AI_CANVAS_RECOMMENDATION_COMMANDS.professionalize, 'professionalize')}
        </View>
      );
    }

    if (recommendationMode === 'length') {
      return (
        <View style={workspace.styles.aiCanvasMiniQuickRow}>
          <Pressable style={workspace.styles.aiCanvasMiniQuickChip} onPress={() => setRecommendationMode(null)} disabled={recommendationBusy}>
            <MaterialCommunityIcons name="close" size={14} color="#4F68D2" />
          </Pressable>
          {renderRecommendationChip('짧게', AI_CANVAS_RECOMMENDATION_COMMANDS.shorten, 'shorten')}
          {renderRecommendationChip('길게', AI_CANVAS_RECOMMENDATION_COMMANDS.expand, 'expand')}
        </View>
      );
    }

    if (recommendationMode === 'study') {
      return (
        <View style={workspace.styles.aiCanvasMiniQuickRow}>
          <Pressable style={workspace.styles.aiCanvasMiniQuickChip} onPress={() => setRecommendationMode(null)} disabled={recommendationBusy}>
            <MaterialCommunityIcons name="close" size={14} color="#4F68D2" />
          </Pressable>
          {renderRecommendationChip('구조화', AI_CANVAS_RECOMMENDATION_COMMANDS.studyRestructure, 'restructure')}
          {renderRecommendationChip('핵심만', AI_CANVAS_RECOMMENDATION_COMMANDS.studyKeyPoints, 'extract_key_points')}
          {renderRecommendationChip('오류 의심', AI_CANVAS_RECOMMENDATION_COMMANDS.studyMarkUncertain, 'mark_uncertain')}
        </View>
      );
    }

    return (
      <View style={workspace.styles.aiCanvasMiniQuickRow}>
        {AI_CANVAS_MINI_PROMPTS.map((prompt) => {
          const enabled = canOpenRecommendationGroup(prompt);
          return (
            <Pressable
              key={prompt}
              {...preserveCanvasSelectionProps}
              style={[workspace.styles.aiCanvasMiniQuickChip, !enabled && workspace.styles.aiCanvasMiniQuickChipDisabled]}
              onPress={() => {
                if (prompt === '마무리 다듬기') setRecommendationMode('polish');
                if (prompt === '수준 조정') setRecommendationMode('level');
                if (prompt === '길이 조절') setRecommendationMode('length');
                if (prompt === '정리 보강') setRecommendationMode('study');
              }}
              disabled={!enabled}
            >
              <Text style={workspace.styles.aiCanvasMiniQuickChipText}>{prompt}</Text>
            </Pressable>
          );
        })}
      </View>
    );
  };
  const renderMiniCommandInput = () => {
    if (!isWebAiCanvasPanel && workspace.aiPanelOpen) return null;
    if (!canvasCanModify) return null;

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
        {renderRecommendationActions()}
        {miniComposerOpen ? (
          <View style={workspace.styles.aiCanvasMiniInputBar}>
            <TextInput
              value={miniCommand}
              onChangeText={setMiniCommand}
              placeholder="AI에게 수정 요청"
              placeholderTextColor="#8F96A3"
              style={workspace.styles.aiCanvasMiniInput}
              multiline
              editable={!recommendationBusy}
              onSubmitEditing={submitMiniCommand}
              submitBehavior="submit"
              blurOnSubmit={false}
              onKeyPress={(event) => {
                handleWebSubmitKeyPress(event, () => {
                  void submitMiniCommand();
                });
              }}
              autoFocus={!miniSelectionContext}
              showSoftInputOnFocus={!miniSelectionContext}
            />
            <View style={workspace.styles.aiTooltipAnchor}>
              <Pressable
                {...getTooltipTriggerProps('ai-canvas-mini-submit', miniCommandReady ? '전송' : '닫기')}
                style={[
                  workspace.styles.aiCanvasMiniSendButton,
                  recommendationBusy && workspace.styles.aiCanvasMiniSendButtonDisabled,
                ]}
                onPress={() => {
                  hideTooltip('ai-canvas-mini-submit');
                  if (miniCommandReady) {
                    void submitMiniCommand();
                    return;
                  }
                  closeMiniComposer();
                }}
                disabled={recommendationBusy}
              >
                {recommendationBusy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : miniCommandReady ? (
                  <MaterialCommunityIcons name="arrow-up" size={18} color="#FFFFFF" />
                ) : (
                  <MaterialCommunityIcons name="close" size={18} color="#FFFFFF" />
                )}
              </Pressable>
              {renderAiTooltip('ai-canvas-mini-submit', miniCommandReady ? '전송' : '닫기', 'above')}
            </View>
          </View>
        ) : (
          <View style={workspace.styles.aiCanvasMiniFabAnchor}>
            <View style={workspace.styles.aiTooltipAnchor}>
              <Pressable
                {...preserveCanvasSelectionProps}
                {...getTooltipTriggerProps('ai-canvas-mini-open', 'AI')}
                style={workspace.styles.aiCanvasMiniSendButton}
                onPress={() => {
                  hideTooltip('ai-canvas-mini-open');
                  openMiniComposer();
                }}
              >
                <MaterialCommunityIcons name="pencil-outline" size={20} color="#FFFFFF" />
              </Pressable>
              {renderAiTooltip('ai-canvas-mini-open', 'AI', 'above')}
            </View>
          </View>
        )}
      </View>
    );
  };
  const renderNoteListMenu = () => {
    if (!noteListOpen || canvasControlsLocked) return null;

    return (
      <View style={workspace.styles.aiCanvasNoteListMenu}>
        <View style={workspace.styles.aiCanvasNoteListMenuHeader}>
          <View style={workspace.styles.aiCanvasNoteListMenuHeaderTextBox}>
            <Text style={workspace.styles.aiCanvasNoteListMenuTitle}>이 PDF의 Canvas</Text>
            <Text style={workspace.styles.aiCanvasNoteListMenuSubtitle}>
              주제별 필기 {canvas.notes.length}/{canvas.maxNotesPerNote}
            </Text>
          </View>
          <Pressable
            style={[
              workspace.styles.aiCanvasNoteListMenuNewButton,
              (canvasManagementDisabled || !canvas.canCreateNote) && workspace.styles.aiCanvasSaveButtonDisabled,
            ]}
            onPress={() => {
              if (canvasManagementDisabled || !canvas.canCreateNote) return;
              setNoteActionMenuId(null);
              void canvas.createNote();
            }}
            disabled={canvasManagementDisabled || !canvas.canCreateNote}
          >
            <MaterialCommunityIcons name="plus" size={16} color="#405CD1" />
          </Pressable>
        </View>
        {canvas.notes.map((note) => {
          const active = note.id === canvas.activeNoteId;
          return (
            <View
              key={note.id}
              style={[
                workspace.styles.aiCanvasNoteListMenuItemWrap,
                noteActionMenuId === note.id && workspace.styles.aiCanvasNoteListMenuItemWrapActive,
              ]}
            >
              <Pressable
                style={[
                  workspace.styles.aiCanvasNoteListMenuItem,
                  active && workspace.styles.aiCanvasNoteListMenuItemActive,
                ]}
                onPress={() => {
                  if (canvasControlsLocked) return;
                  canvas.selectNote(note.id);
                  setNoteListOpen(false);
                  setNoteActionMenuId(null);
                }}
                onLongPress={() => {
                  if (canvasControlsLocked) return;
                  setNoteActionMenuId(note.id);
                }}
                disabled={canvasControlsLocked}
                delayLongPress={350}
              >
                <View style={[workspace.styles.aiCanvasNoteListActiveDot, active && workspace.styles.aiCanvasNoteListActiveDotOn]} />
                <View style={workspace.styles.aiCanvasNoteListMenuTextBox}>
                  <Text
                    style={[
                      workspace.styles.aiCanvasNoteListMenuText,
                      active && workspace.styles.aiCanvasNoteListMenuTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {formatCanvasNoteTitle(note, canvas.notes)}
                  </Text>
                  <Text style={workspace.styles.aiCanvasNoteListMenuMeta} numberOfLines={1}>
                    {formatCanvasUpdatedAt(note.updated_at)}
                  </Text>
                </View>
                <Pressable
                  style={workspace.styles.aiCanvasNoteListRowMenuButton}
                  onPress={(event) => {
                    event.stopPropagation();
                    if (canvasControlsLocked) return;
                    setNoteActionMenuId((current) => (current === note.id ? null : note.id));
                  }}
                  disabled={canvasControlsLocked}
                >
                  <MaterialCommunityIcons name="dots-horizontal" size={16} color="#7A8394" />
                </Pressable>
              </Pressable>
              {noteActionMenuId === note.id ? (
                <View style={workspace.styles.aiCanvasNoteActionMenu}>
                  <Pressable
                    style={workspace.styles.aiCanvasTitleMenuItem}
                    onPress={startRename}
                    disabled={canvasControlsLocked}
                  >
                    <Text style={workspace.styles.aiCanvasTitleMenuText}>이름 바꾸기</Text>
                  </Pressable>
                  <Pressable
                    style={workspace.styles.aiCanvasTitleMenuItem}
                    onPress={openDeleteConfirm}
                    disabled={canvasManagementDisabled}
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
    <View
      style={[
        workspace.styles.aiCanvasPanel,
        isWebAiCanvasPanel && workspace.styles.aiCanvasWebAttachedPanel,
        isWebAiCanvasPanel && { width: workspace.webAiCanvasPanelWidth },
        isAppAiCanvasSidebar && workspace.styles.appRightSidebarAiCanvasPanel,
        appKeyboardAvoidingStyle,
      ]}
    >
      {noteListOpen ? (
        <Pressable style={workspace.styles.aiCanvasMenuDismissLayer} onPress={closeMenus} />
      ) : null}
      {isWebAiCanvasPanel ? (
        <View
          style={[workspace.styles.aiPanelSidebarResizeHandle, workspace.styles.aiPanelSidebarResizeHandleLeft]}
          {...({
            onPointerDown: handleWebCanvasResizePointerDown,
            onMouseEnter: () => setWebCanvasResizeActive(true),
            onMouseLeave: () => {
              if (!webCanvasResizeDraggingRef.current) setWebCanvasResizeActive(false);
            },
          } as any)}
        >
          <View
            style={[
              workspace.styles.aiPanelResizeRail,
              webCanvasResizeActive && workspace.styles.aiPanelResizeRailActive,
            ]}
          />
        </View>
      ) : null}
      <View style={[workspace.styles.aiCanvasHeader, isWebAiCanvasPanel && workspace.styles.aiCanvasHeaderWeb]}>
        <View style={workspace.styles.aiCanvasHeaderTitleWrap}>
          <Pressable
            style={workspace.styles.aiCanvasHeaderTitleButton}
            onPress={startRename}
            disabled={!canvas.activeNote || canvasControlsLocked}
          >
            <Text style={workspace.styles.aiCanvasTitle} numberOfLines={1}>
              {formatCanvasNoteTitle(canvas.activeNote, canvas.notes)}
            </Text>
            {canvas.activeNote ? (
              <MaterialCommunityIcons name="pencil-outline" size={14} color="#8A95A8" />
            ) : null}
          </Pressable>
        </View>
        <View style={workspace.styles.aiCanvasHeaderActions}>
          {isNativeApp ? (
            <View style={workspace.styles.aiTooltipAnchor}>
              <Pressable
                {...getTooltipTriggerProps('ai-canvas-mode', canvasEditModeEnabled ? '보기 모드' : '편집 모드')}
                style={getAiCanvasHeaderIconButtonStyle('ai-canvas-mode', canvasEditModeEnabled)}
                onPress={() => {
                  hideTooltip('ai-canvas-mode');
                  setNativeEditorMode((current) => (current === 'edit' ? 'view' : 'edit'));
                }}
                disabled={canvasControlsLocked}
              >
                <MaterialCommunityIcons name={canvasEditModeEnabled ? 'pencil' : 'eye-outline'} size={18} color="#303744" />
              </Pressable>
              {renderAiTooltip('ai-canvas-mode', canvasEditModeEnabled ? '보기 모드' : '편집 모드')}
            </View>
          ) : null}
          <View style={workspace.styles.aiTooltipAnchor}>
            <Pressable
              {...getTooltipTriggerProps('ai-canvas-undo', 'Canvas 되돌리기')}
              style={getAiCanvasHeaderHistoryButtonStyle('ai-canvas-undo', canUndoCanvas)}
              onPress={() => {
                hideTooltip('ai-canvas-undo');
                if (!canUndoCanvas) return;
                canvas.undoCanvasEdit();
              }}
              disabled={!canUndoCanvas}
            >
              <MaterialCommunityIcons name="undo-variant" size={18} color={canUndoCanvas ? '#303744' : '#A8B0BF'} />
            </Pressable>
            {renderAiTooltip('ai-canvas-undo', 'Canvas 되돌리기')}
          </View>
          <View style={workspace.styles.aiTooltipAnchor}>
            <Pressable
              {...getTooltipTriggerProps('ai-canvas-redo', 'Canvas 다시 실행')}
              style={getAiCanvasHeaderHistoryButtonStyle('ai-canvas-redo', canRedoCanvas)}
              onPress={() => {
                hideTooltip('ai-canvas-redo');
                if (!canRedoCanvas) return;
                canvas.redoCanvasEdit();
              }}
              disabled={!canRedoCanvas}
            >
              <MaterialCommunityIcons name="redo-variant" size={18} color={canRedoCanvas ? '#303744' : '#A8B0BF'} />
            </Pressable>
            {renderAiTooltip('ai-canvas-redo', 'Canvas 다시 실행')}
          </View>
          <View style={workspace.styles.aiTooltipAnchor}>
            <Pressable
              {...getTooltipTriggerProps('ai-canvas-new-note', '새 노트')}
              style={getAiCanvasHeaderNewButtonStyle('ai-canvas-new-note')}
              onPress={() => {
                hideTooltip('ai-canvas-new-note');
                if (canvasManagementDisabled || !canvas.canCreateNote) return;
                void canvas.createNote();
              }}
              disabled={canvasManagementDisabled || !canvas.canCreateNote}
            >
              <MaterialCommunityIcons name="note-edit-outline" size={18} color="#111827" />
            </Pressable>
            {renderAiTooltip('ai-canvas-new-note', '새 노트')}
          </View>
          <View style={workspace.styles.aiTooltipAnchor}>
            <Pressable
              {...getTooltipTriggerProps('ai-canvas-help', '도움말')}
              style={getAiCanvasHeaderIconButtonStyle('ai-canvas-help')}
              onPress={() => {
                hideTooltip('ai-canvas-help');
                setHelpOpen(true);
              }}
              disabled={canvasControlsLocked}
            >
              <MaterialCommunityIcons name="help-circle-outline" size={19} color="#303744" />
            </Pressable>
            {renderAiTooltip('ai-canvas-help', '도움말')}
          </View>
          <View style={workspace.styles.aiHeaderMenuWrap}>
            <Pressable
              {...getTooltipTriggerProps('ai-canvas-list', '목록')}
              style={getAiCanvasHeaderIconButtonStyle('ai-canvas-list')}
              onPress={() => {
                hideTooltip('ai-canvas-list');
                if (canvasControlsLocked) return;
                setNoteActionMenuId(null);
                setNoteListOpen((current) => !current);
              }}
              disabled={!canvas.notes.length || canvasControlsLocked}
            >
              <MaterialCommunityIcons name="dots-vertical" size={20} color="#303744" />
            </Pressable>
            {renderAiTooltip('ai-canvas-list', '목록')}
            {renderNoteListMenu()}
          </View>
          <View style={workspace.styles.aiTooltipAnchor}>
            <Pressable
              {...getTooltipTriggerProps('ai-canvas-close', '닫기')}
              style={getAiCanvasHeaderIconButtonStyle('ai-canvas-close')}
              onPress={() => {
                hideTooltip('ai-canvas-close');
                closeCanvasPanel();
              }}
            >
              <MaterialCommunityIcons name="close" size={20} color="#303744" />
            </Pressable>
            {renderAiTooltip('ai-canvas-close', '닫기')}
          </View>
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
              <AiCanvasMarkdownEditor
                key={canvas.activeNote.id}
                documentJson={canvas.documentDraft}
                fallbackMarkdown={canvas.markdownDraft}
                editable={editorEditable}
                placeholder="Markdown으로 정리 내용을 작성하세요."
                pendingOperations={canvas.pendingCanvasOperations}
                selectionToRestore={canvas.selectionDraft}
                resetUiKey={canvas.activeNote?.id ?? null}
                enableWebBlockLayers={isWebAiCanvasPanel}
                aiRequestBusy={recommendationBusy}
                onRequestBlockAi={submitBlockAiCommand}
                onChangeDocument={async (change) => {
                  canvas.setDocumentDraft(change);
                }}
                onChangeSelection={(selection) => {
                  canvas.setSelectionDraft(selection);
                }}
                onChangeHistoryState={(state) => {
                  canvas.setEditorHistoryState(state);
                }}
                onRegisterHistoryControls={(controls) => {
                  canvas.registerEditorHistoryControls(controls);
                }}
                onFocusEditor={async () => {
                  workspace.onFocusWorkspaceTarget('aiCanvas');
                }}
                onApplyOperationsResult={async (requestId, result) => {
                  canvas.completeCanvasOperations(requestId, result);
                }}
                dom={{
                  style: workspace.styles.aiCanvasMarkdownWebView,
                  scrollEnabled: true,
                  nestedScrollEnabled: true,
                  hideKeyboardAccessoryView: true,
                }}
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
      {canvas.enabled && canvas.activeNote && canvasAiEditingBusy ? (
        <View pointerEvents="none" style={workspace.styles.aiCanvasPanelBusyOverlay}>
          <View style={workspace.styles.aiCanvasEditorBusyPill}>
            <ActivityIndicator size="small" color="#405CD1" />
            <Text style={workspace.styles.aiCanvasEditorBusyText}>AI가 Canvas를 수정하는 중입니다.</Text>
          </View>
        </View>
      ) : null}
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
              editable={!canvasManagementDisabled}
              autoFocus
              showSoftInputOnFocus
            />
            {renameError ? <Text style={workspace.styles.aiRenameModalError}>{renameError}</Text> : null}
            <View style={workspace.styles.aiRenameModalActions}>
              <Pressable style={workspace.styles.aiRenameModalCancelButton} onPress={cancelRename} disabled={canvasManagementDisabled}>
                <Text style={workspace.styles.aiRenameModalCancelText}>취소</Text>
              </Pressable>
              <Pressable
                style={[workspace.styles.aiRenameModalSaveButton, (!renameDraft.trim() || canvasManagementDisabled) && workspace.styles.aiRenameModalSaveButtonDisabled]}
                onPress={saveRename}
                disabled={!renameDraft.trim() || canvasManagementDisabled}
              >
                <Text style={workspace.styles.aiRenameModalSaveText}>이름 바꾸기</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      ) : null}
      {helpOpen ? (
        <Pressable style={workspace.styles.aiPanelDialogOverlay} onPress={() => setHelpOpen(false)}>
          <Pressable style={workspace.styles.aiCanvasHelpModalCard} onPress={(event) => event.stopPropagation()}>
            <View style={workspace.styles.aiCanvasHelpHeader}>
              <Text style={workspace.styles.aiRenameModalTitle}>Canvas 사용법</Text>
              <Pressable style={workspace.styles.aiCanvasIconButton} onPress={() => setHelpOpen(false)}>
                <MaterialCommunityIcons name="close" size={18} color="#303744" />
              </Pressable>
            </View>
            <ScrollView style={workspace.styles.aiCanvasHelpScroll} contentContainerStyle={workspace.styles.aiCanvasHelpContent}>
              <Text style={workspace.styles.aiCanvasHelpSectionTitle}>빠르게 쓰기</Text>
              <Text style={workspace.styles.aiCanvasHelpBody}>빈 줄이나 줄 맨 앞에서 / 를 입력하면 제목, 본문, 목록, 코드, 구분선을 바로 만들 수 있어요.</Text>
              <Text style={workspace.styles.aiCanvasHelpSectionTitle}>기본 정리</Text>
              <Text style={workspace.styles.aiCanvasHelpBody}>큰 제목은 흐름을 나눌 때, 글머리 목록은 핵심 개념을 모을 때, 번호 목록은 순서가 있는 내용을 정리할 때 사용하세요.</Text>
              <Text style={workspace.styles.aiCanvasHelpSectionTitle}>AI에게 부탁하기</Text>
              <Text style={workspace.styles.aiCanvasHelpBody}>문단 오른쪽 AI 버튼으로 해당 내용을 물어보거나 수정 요청할 수 있어요. 오른쪽 하단 AI 버튼으로는 Canvas 전체에 대해 질문하거나 수정 요청할 수 있어요.</Text>
              <Text style={workspace.styles.aiCanvasHelpSectionTitle}>추천 버튼</Text>
              <Text style={workspace.styles.aiCanvasHelpBody}>마무리 다듬기, 수준 조정, 길이 조절을 선택하면 AI가 Canvas 전체를 바로 다듬어줘요.</Text>
            </ScrollView>
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
              "{formatCanvasNoteTitle(
                canvas.notes.find((note) => note.id === pendingDeleteNoteId) ?? canvas.activeNote,
                canvas.notes,
              )}" Canvas를 삭제할까요?
            </Text>
            <View style={workspace.styles.aiRenameModalActions}>
              <Pressable
                style={workspace.styles.aiRenameModalCancelButton}
                onPress={() => {
                  setDeleteConfirmOpen(false);
                  setPendingDeleteNoteId(null);
                }}
                disabled={canvasManagementDisabled}
              >
                <Text style={workspace.styles.aiRenameModalCancelText}>취소</Text>
              </Pressable>
              <Pressable style={workspace.styles.aiRenameModalDangerButton} onPress={confirmDelete} disabled={canvasManagementDisabled}>
                <Text style={workspace.styles.aiRenameModalSaveText}>삭제</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      ) : null}
    </View>
  );
}
