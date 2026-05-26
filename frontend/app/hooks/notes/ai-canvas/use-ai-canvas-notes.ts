import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createBackendAiCanvasNote,
  deleteBackendAiCanvasNote,
  getBackendAiCanvasNote,
  listBackendAiCanvasNotes,
  requestBackendAiCanvasEdit,
  updateBackendAiCanvasNote,
  type BackendAiCanvasNote,
  type BackendAiCanvasNoteSummary,
} from '../../../services/backend-api';

export type AiCanvasMode = 'preview' | 'edit';

export type UseAiCanvasNotesResult = {
  isOpen: boolean;
  mode: AiCanvasMode;
  notes: BackendAiCanvasNoteSummary[];
  activeNote: BackendAiCanvasNote | null;
  activeNoteId: number | null;
  markdownDraft: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  aiDraftMarkdown: string | null;
  aiEditing: boolean;
  enabled: boolean;
  canCreateNote: boolean;
  canUndo: boolean;
  canRedo: boolean;
  maxNotesPerNote: number;
  hasUnsavedChanges: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setMode: (mode: AiCanvasMode) => void;
  selectNote: (noteId: number) => void;
  setMarkdownDraft: (value: string) => void;
  createNote: () => Promise<void>;
  saveNote: () => Promise<void>;
  renameNote: (title: string, noteId?: number) => Promise<boolean>;
  renameActiveNote: (title: string) => Promise<boolean>;
  deleteNote: (noteId?: number) => Promise<void>;
  deleteActiveNote: () => Promise<void>;
  ensureNoteForChatEdit: () => Promise<{ note: BackendAiCanvasNote; needsTitle: boolean } | null>;
  applyChatCanvasEdit: (payload: { action: 'canvas_edit' | 'canvas_create'; canvasNote: BackendAiCanvasNote }) => void;
  requestAiEditFromChat: (payload: { question: string; answer: string }) => Promise<void>;
  applyAiDraft: () => void;
  discardAiDraft: () => void;
  undoCanvasEdit: () => void;
  redoCanvasEdit: () => void;
};

const DEFAULT_CANVAS_TITLE = 'AI Canvas Note';
const DEFAULT_CANVAS_MARKDOWN = '# AI Canvas Note\n\n정리할 내용을 입력하거나 AI에게 추가를 요청해보세요.';
const MAX_AI_CANVAS_NOTES_PER_NOTE = 3;
const DIRECT_EDIT_BATCH_DELAY_MS = 1200;
const TRANSIENT_ERROR_DELAY_MS = 3000;
const MAX_UNDO_STACK_SIZE = 50;

function appendUndoSnapshot(stack: string[], snapshot: string) {
  if (stack[stack.length - 1] === snapshot) return stack;
  return [...stack, snapshot].slice(-MAX_UNDO_STACK_SIZE);
}

function hasMeaningfulUndoState(markdown: string) {
  const normalized = markdown.trim();
  return Boolean(normalized) && normalized !== DEFAULT_CANVAS_MARKDOWN;
}

function buildChatCanvasInstruction({ question, answer }: { question: string; answer: string }) {
  return [
    '사용자가 AI Chat에서 Canvas 수정을 요청했습니다.',
    '',
    '사용자 요청:',
    question,
    '',
    'AI Chat이 현재 노트/페이지 맥락을 참고해 만든 답변:',
    answer,
    '',
    '위 답변을 현재 Canvas Note에 자연스럽게 반영해 주세요.',
    '기존 내용과 겹치면 중복을 줄이고, 필요한 경우 적절한 제목과 bullet로 정리해 주세요.',
  ].join('\n');
}

export function useAiCanvasNotes({
  noteId,
  enabled,
  currentPageNumber,
  onFeedback,
  onRecordWorkspaceAction,
}: {
  noteId: number | null;
  enabled: boolean;
  currentPageNumber: number | null;
  onFeedback: (message: string) => void;
  onRecordWorkspaceAction?: () => void;
}): UseAiCanvasNotesResult {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AiCanvasMode>('preview');
  const [notes, setNotes] = useState<BackendAiCanvasNoteSummary[]>([]);
  const [activeNote, setActiveNote] = useState<BackendAiCanvasNote | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null);
  const [markdownDraft, setMarkdownDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiDraftMarkdown, setAiDraftMarkdown] = useState<string | null>(null);
  const [aiEditing, setAiEditing] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const detailRequestIdRef = useRef(0);
  const directEditBaselineRef = useRef<string | null>(null);
  const directEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transientErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishDirectEditBatch = useCallback(() => {
    if (directEditTimerRef.current) {
      clearTimeout(directEditTimerRef.current);
      directEditTimerRef.current = null;
    }
    directEditBaselineRef.current = null;
  }, []);

  const setTransientError = useCallback((message: string) => {
    if (transientErrorTimerRef.current) {
      clearTimeout(transientErrorTimerRef.current);
      transientErrorTimerRef.current = null;
    }
    setError(message);
    transientErrorTimerRef.current = setTimeout(() => {
      setError((current) => (current === message ? null : current));
      transientErrorTimerRef.current = null;
    }, TRANSIENT_ERROR_DELAY_MS);
  }, []);

  useEffect(() => () => {
    finishDirectEditBatch();
    if (transientErrorTimerRef.current) {
      clearTimeout(transientErrorTimerRef.current);
      transientErrorTimerRef.current = null;
    }
  }, [finishDirectEditBatch]);

  const hasUnsavedChanges = !!activeNote && markdownDraft !== activeNote.markdown;
  const canCreateNote = notes.length < MAX_AI_CANVAS_NOTES_PER_NOTE;
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const applyActiveNote = useCallback((note: BackendAiCanvasNote | null) => {
    finishDirectEditBatch();
    setActiveNote(note);
    setActiveNoteId(note?.id ?? null);
    setMarkdownDraft(note?.markdown ?? '');
    setMode(note ? 'preview' : 'edit');
    setAiDraftMarkdown(null);
    setUndoStack([]);
    setRedoStack([]);
  }, [finishDirectEditBatch]);

  const loadCanvasNoteDetail = useCallback(async (canvasNoteId: number) => {
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    try {
      const detail = await getBackendAiCanvasNote(canvasNoteId);
      if (detailRequestIdRef.current !== requestId) return null;
      applyActiveNote(detail);
      return detail;
    } catch {
      if (detailRequestIdRef.current === requestId) setError('AI 캔버스 노트를 불러오지 못했습니다.');
      return null;
    } finally {
      if (detailRequestIdRef.current === requestId) setLoading(false);
    }
  }, [applyActiveNote]);

  useEffect(() => {
    if (!enabled || !noteId) {
      detailRequestIdRef.current += 1;
      setNotes([]);
      applyActiveNote(null);
      setLoading(false);
      setError(null);
      return;
    }
    if (!isOpen) {
      detailRequestIdRef.current += 1;
      setLoading(false);
      setError(null);
      return;
    }

    let mounted = true;
    setLoading(true);
    setError(null);

    listBackendAiCanvasNotes(noteId)
      .then(async (items) => {
        if (!mounted) return;
        setNotes(items);
        const nextActive = activeNoteId
          ? items.find((item) => item.id === activeNoteId) ?? items[0] ?? null
          : items[0] ?? null;
        if (nextActive) {
          await loadCanvasNoteDetail(nextActive.id);
        } else {
          applyActiveNote(null);
        }
      })
      .catch(() => {
        if (!mounted) return;
        setError('AI Canvas Notes를 불러오지 못했습니다.');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      detailRequestIdRef.current += 1;
    };
  }, [activeNoteId, applyActiveNote, enabled, isOpen, loadCanvasNoteDetail, noteId]);

  const selectNote = useCallback((nextNoteId: number) => {
    const next = notes.find((note) => note.id === nextNoteId) ?? null;
    if (!next) {
      applyActiveNote(null);
      return;
    }
    void loadCanvasNoteDetail(next.id);
  }, [applyActiveNote, loadCanvasNoteDetail, notes]);

  const changeMarkdownDraft = useCallback((value: string) => {
    if (value === markdownDraft) return;

    const lineCountChanged = value.split('\n').length !== markdownDraft.split('\n').length;
    const likelyPaste = Math.abs(value.length - markdownDraft.length) > 8;

    if (directEditBaselineRef.current === null) {
      directEditBaselineRef.current = markdownDraft;
      setUndoStack((current) => appendUndoSnapshot(current, markdownDraft));
      setRedoStack([]);
      onRecordWorkspaceAction?.();
    }
    setMarkdownDraft(value);

    if (directEditTimerRef.current) {
      clearTimeout(directEditTimerRef.current);
    }
    directEditTimerRef.current = setTimeout(() => {
      directEditBaselineRef.current = null;
      directEditTimerRef.current = null;
    }, DIRECT_EDIT_BATCH_DELAY_MS);

    if (lineCountChanged || likelyPaste) {
      finishDirectEditBatch();
    }
  }, [finishDirectEditBatch, markdownDraft, onRecordWorkspaceAction]);

  const createCanvasNote = useCallback(async () => {
    if (!enabled || !noteId) {
      setError('백엔드에 저장된 노트에서만 사용할 수 있습니다.');
      return null;
    }
    if (!canCreateNote) {
      const message = `Canvas는 노트당 최대 ${MAX_AI_CANVAS_NOTES_PER_NOTE}개까지 만들 수 있습니다.`;
      setTransientError(message);
      onFeedback(message);
      return null;
    }

    const pageNumber = currentPageNumber ?? null;
    const created = await createBackendAiCanvasNote({
      noteId,
      title: DEFAULT_CANVAS_TITLE,
      markdown: DEFAULT_CANVAS_MARKDOWN,
      sourcePageStart: pageNumber,
      sourcePageEnd: pageNumber,
    });
    setNotes((current) => [created, ...current]);
    applyActiveNote(created);
    return created;
  }, [applyActiveNote, canCreateNote, currentPageNumber, enabled, noteId, onFeedback, setTransientError]);

  const createNote = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const created = await createCanvasNote();
      if (!created) return;
      setMode('edit');
      onFeedback('AI Canvas Note를 만들었습니다.');
    } catch {
      setError('AI Canvas Note를 만들지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }, [createCanvasNote, onFeedback]);

  const saveNote = useCallback(async () => {
    if (!activeNote) return;

    setSaving(true);
    setError(null);
    try {
      const updated = await updateBackendAiCanvasNote({
        canvasNoteId: activeNote.id,
        markdown: markdownDraft,
      });
      setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)));
      applyActiveNote(updated);
      onFeedback('AI Canvas Note를 저장했습니다.');
    } catch {
      setError('AI Canvas Note를 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }, [activeNote, applyActiveNote, markdownDraft, onFeedback]);

  const renameNote = useCallback(async (title: string, noteIdToRename?: number) => {
    const targetNoteId = noteIdToRename ?? activeNote?.id ?? null;
    if (!targetNoteId) return false;

    const nextTitle = title.trim();
    if (!nextTitle) {
      setError('제목을 입력해 주세요.');
      return false;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await updateBackendAiCanvasNote({
        canvasNoteId: targetNoteId,
        title: nextTitle,
        markdown: targetNoteId === activeNote?.id ? markdownDraft : undefined,
      });
      setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)));
      if (updated.id === activeNote?.id) {
        applyActiveNote(updated);
      }
      onFeedback('AI Canvas Note 이름을 변경했습니다.');
      return true;
    } catch {
      setError('AI Canvas Note 이름을 변경하지 못했습니다.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [activeNote, applyActiveNote, markdownDraft, onFeedback]);

  const renameActiveNote = useCallback((title: string) => renameNote(title), [renameNote]);

  const deleteNote = useCallback(async (noteIdToDelete?: number) => {
    const targetNoteId = noteIdToDelete ?? activeNote?.id ?? null;
    if (!targetNoteId) return;

    setSaving(true);
    setError(null);
    try {
      await deleteBackendAiCanvasNote(targetNoteId);
      const nextNotes = notes.filter((note) => note.id !== targetNoteId);
      setNotes(nextNotes);
      if (targetNoteId === activeNote?.id) {
        const nextActive = nextNotes[0] ?? null;
        if (nextActive) {
          await loadCanvasNoteDetail(nextActive.id);
        } else {
          applyActiveNote(null);
        }
      }
      onFeedback('AI Canvas Note를 삭제했습니다.');
    } catch {
      setError('AI Canvas Note를 삭제하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }, [activeNote, applyActiveNote, loadCanvasNoteDetail, notes, onFeedback]);

  const deleteActiveNote = useCallback(() => deleteNote(), [deleteNote]);

  useEffect(() => {
    if (!activeNote || markdownDraft === activeNote.markdown) return;

    const timer = setTimeout(() => {
      setSaving(true);
      setError(null);
      updateBackendAiCanvasNote({
        canvasNoteId: activeNote.id,
        markdown: markdownDraft,
      })
        .then((updated) => {
          setActiveNote(updated);
          setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)));
        })
        .catch(() => {
          setError('AI Canvas Note 자동 저장에 실패했습니다.');
        })
        .finally(() => {
          setSaving(false);
        });
    }, 700);

    return () => clearTimeout(timer);
  }, [activeNote, markdownDraft]);

  const ensureNoteForChatEdit = useCallback(async () => {
    if (!enabled || !noteId) {
      setError('백엔드에 저장된 노트에서만 Canvas를 수정할 수 있습니다.');
      return null;
    }
    if (activeNote) return { note: activeNote, needsTitle: false };
    const created = await createCanvasNote();
    return created ? { note: created, needsTitle: true } : null;
  }, [activeNote, createCanvasNote, enabled, noteId]);

  const applyChatCanvasEdit = useCallback(({ action, canvasNote }: { action: 'canvas_edit' | 'canvas_create'; canvasNote: BackendAiCanvasNote }) => {
    setIsOpen(true);
    finishDirectEditBatch();
    const previousMarkdown = action === 'canvas_create' ? DEFAULT_CANVAS_MARKDOWN : markdownDraft;
    if (hasMeaningfulUndoState(previousMarkdown) && previousMarkdown !== canvasNote.markdown) {
      setUndoStack((current) => appendUndoSnapshot(current, previousMarkdown));
      setRedoStack([]);
      onRecordWorkspaceAction?.();
    }
    setActiveNote(canvasNote);
    setActiveNoteId(canvasNote.id);
    setMarkdownDraft(canvasNote.markdown);
    setMode('preview');
    setAiDraftMarkdown(null);
    setNotes((current) => {
      const exists = current.some((note) => note.id === canvasNote.id);
      if (!exists) return [canvasNote, ...current];
      return current.map((note) => (note.id === canvasNote.id ? canvasNote : note));
    });
    setError(null);
    onFeedback(action === 'canvas_create' ? 'AI Chat에서 Canvas를 만들었습니다.' : 'AI Chat이 Canvas를 수정했습니다.');
  }, [finishDirectEditBatch, markdownDraft, onFeedback, onRecordWorkspaceAction]);

  const requestAiEditFromChat = useCallback(async ({ question, answer }: { question: string; answer: string }) => {
    if (!enabled || !noteId) {
      setError('백엔드에 저장된 노트에서만 Canvas를 수정할 수 있습니다.');
      return;
    }

    setIsOpen(true);
    setAiEditing(true);
    setError(null);
    try {
      const targetNote = activeNote ?? (await createCanvasNote());
      if (!targetNote) return;

      const result = await requestBackendAiCanvasEdit({
        canvasNoteId: targetNote.id,
        instruction: buildChatCanvasInstruction({ question, answer }),
      });
      setAiDraftMarkdown(result.markdown);
      setMode('preview');
      onFeedback('AI Chat 기반 Canvas 수정안이 생성되었습니다.');
    } catch {
      setError('AI Chat 답변을 Canvas 수정안으로 만들지 못했습니다.');
    } finally {
      setAiEditing(false);
    }
  }, [activeNote, createCanvasNote, enabled, noteId, onFeedback]);

  const applyAiDraft = useCallback(() => {
    if (aiDraftMarkdown === null) return;
    const previousMarkdown = markdownDraft;
    if (hasMeaningfulUndoState(previousMarkdown) && previousMarkdown !== aiDraftMarkdown) {
      setUndoStack((current) => appendUndoSnapshot(current, previousMarkdown));
      setRedoStack([]);
      onRecordWorkspaceAction?.();
    }
    setMarkdownDraft(aiDraftMarkdown);
    setAiDraftMarkdown(null);
    setMode('edit');
  }, [aiDraftMarkdown, markdownDraft, onRecordWorkspaceAction]);

  const discardAiDraft = useCallback(() => {
    setAiDraftMarkdown(null);
  }, []);

  const undoCanvasEdit = useCallback(() => {
    if (!canUndo) return;
    const previous = undoStack[undoStack.length - 1];
    finishDirectEditBatch();
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => appendUndoSnapshot(current, markdownDraft));
    setMarkdownDraft(previous);
  }, [canUndo, finishDirectEditBatch, markdownDraft, undoStack]);

  const redoCanvasEdit = useCallback(() => {
    if (!canRedo) return;
    const next = redoStack[redoStack.length - 1];
    finishDirectEditBatch();
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => appendUndoSnapshot(current, markdownDraft));
    setMarkdownDraft(next);
  }, [canRedo, finishDirectEditBatch, markdownDraft, redoStack]);

  return {
    isOpen,
    mode,
    notes,
    activeNote,
    activeNoteId,
    markdownDraft,
    loading,
    saving,
    error,
    aiDraftMarkdown,
    aiEditing,
    enabled,
    canCreateNote,
    canUndo,
    canRedo,
    maxNotesPerNote: MAX_AI_CANVAS_NOTES_PER_NOTE,
    hasUnsavedChanges,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((current) => !current),
    setMode,
    selectNote,
    setMarkdownDraft: changeMarkdownDraft,
    createNote,
    saveNote,
    renameNote,
    renameActiveNote,
    deleteNote,
    deleteActiveNote,
    ensureNoteForChatEdit,
    applyChatCanvasEdit,
    requestAiEditFromChat,
    applyAiDraft,
    discardAiDraft,
    undoCanvasEdit,
    redoCanvasEdit,
  };
}
