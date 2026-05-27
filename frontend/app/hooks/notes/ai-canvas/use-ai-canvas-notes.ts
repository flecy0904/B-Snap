import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createBackendAiCanvasNote,
  deleteBackendAiCanvasNote,
  getBackendAiCanvasNote,
  listBackendAiCanvasNotes,
  updateBackendAiCanvasNote,
  type BackendAiCanvasNote,
  type BackendAiCanvasNoteSummary,
} from '../../../services/backend-api';

export type UseAiCanvasNotesResult = {
  isOpen: boolean;
  notes: BackendAiCanvasNoteSummary[];
  activeNote: BackendAiCanvasNote | null;
  activeNoteId: number | null;
  markdownDraft: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  enabled: boolean;
  canCreateNote: boolean;
  canUndo: boolean;
  canRedo: boolean;
  maxNotesPerNote: number;
  hasUnsavedChanges: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  selectNote: (noteId: number) => void;
  setMarkdownDraft: (value: string) => void;
  createNote: () => Promise<void>;
  renameNote: (title: string, noteId?: number) => Promise<boolean>;
  deleteNote: (noteId?: number) => Promise<void>;
  ensureNoteForChatEdit: () => Promise<{ note: BackendAiCanvasNote; needsTitle: boolean } | null>;
  applyChatCanvasEdit: (payload: { action: 'canvas_edit' | 'canvas_create'; canvasNote: BackendAiCanvasNote }) => void;
  undoCanvasEdit: () => void;
  redoCanvasEdit: () => void;
  showFeedback: (message: string) => void;
};

const DEFAULT_CANVAS_TITLE = 'Canvas Note';
const DEFAULT_CANVAS_MARKDOWN = '';
const MAX_AI_CANVAS_NOTES_PER_NOTE = 3;
const DIRECT_EDIT_BATCH_DELAY_MS = 1200;
const TRANSIENT_ERROR_DELAY_MS = 3000;
const MAX_UNDO_STACK_SIZE = 50;

function normalizeAiCanvasMarkdown(markdown: string) {
  return markdown.replace(/&nbsp;/g, '').replace(/\u00A0/g, '').trim();
}

function appendUndoSnapshot(stack: string[], snapshot: string) {
  if (stack[stack.length - 1] === snapshot) return stack;
  return [...stack, snapshot].slice(-MAX_UNDO_STACK_SIZE);
}

function hasMeaningfulUndoState(markdown: string) {
  const normalized = normalizeAiCanvasMarkdown(markdown);
  return Boolean(normalized);
}

export function hasUsefulAiCanvasMarkdown(markdown: string) {
  const normalized = normalizeAiCanvasMarkdown(markdown);
  return Boolean(normalized);
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
  const [notes, setNotes] = useState<BackendAiCanvasNoteSummary[]>([]);
  const [activeNote, setActiveNote] = useState<BackendAiCanvasNote | null>(null);
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null);
  const [markdownDraft, setMarkdownDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const detailRequestIdRef = useRef(0);
  const autosaveRequestIdRef = useRef(0);
  const autosaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeNoteIdRef = useRef<number | null>(null);
  const activeNoteRevisionRef = useRef<number | null>(null);
  const markdownDraftRef = useRef('');
  const directEditBaselineRef = useRef<string | null>(null);
  const directEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transientErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeNoteIdRef.current = activeNote?.id ?? null;
    activeNoteRevisionRef.current = activeNote?.revision ?? null;
    markdownDraftRef.current = markdownDraft;
  }, [activeNote?.id, activeNote?.revision, markdownDraft]);

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
      onFeedback('AI Canvas Note를 만들었습니다.');
    } catch {
      setError('AI Canvas Note를 만들지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }, [createCanvasNote, onFeedback]);

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
        expectedRevision: targetNoteId === activeNote?.id
          ? activeNote.revision
          : notes.find((note) => note.id === targetNoteId)?.revision,
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

  useEffect(() => {
    if (!activeNote || markdownDraft === activeNote.markdown) return;

    const timer = setTimeout(() => {
      const requestId = autosaveRequestIdRef.current + 1;
      autosaveRequestIdRef.current = requestId;
      const targetNoteId = activeNote.id;
      const targetMarkdown = markdownDraft;

      autosaveQueueRef.current = autosaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (
            autosaveRequestIdRef.current !== requestId
            || activeNoteIdRef.current !== targetNoteId
            || markdownDraftRef.current !== targetMarkdown
          ) {
            return;
          }
          try {
            const expectedRevision = activeNoteRevisionRef.current;
            if (expectedRevision === null) return;
            const updated = await updateBackendAiCanvasNote({
              canvasNoteId: targetNoteId,
              markdown: targetMarkdown,
              expectedRevision,
            });
            setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)));
            if (activeNoteIdRef.current === updated.id) {
              activeNoteRevisionRef.current = updated.revision;
            }
            if (
              autosaveRequestIdRef.current === requestId
              && activeNoteIdRef.current === updated.id
              && markdownDraftRef.current === targetMarkdown
            ) {
              setActiveNote(updated);
            }
          } catch {
            if (autosaveRequestIdRef.current === requestId) {
              onFeedback('Canvas 자동 저장에 실패했습니다.');
            }
          }
        });
    }, 700);

    return () => clearTimeout(timer);
  }, [activeNote, markdownDraft, onFeedback]);

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
    activeNoteIdRef.current = canvasNote.id;
    activeNoteRevisionRef.current = canvasNote.revision;
    markdownDraftRef.current = canvasNote.markdown;
    setNotes((current) => {
      const exists = current.some((note) => note.id === canvasNote.id);
      if (!exists) return [canvasNote, ...current];
      return current.map((note) => (note.id === canvasNote.id ? canvasNote : note));
    });
    autosaveRequestIdRef.current += 1;
    setError(null);
    onFeedback(action === 'canvas_create' ? 'AI Chat에서 Canvas를 만들었습니다.' : 'AI Chat이 Canvas를 수정했습니다.');
  }, [finishDirectEditBatch, markdownDraft, onFeedback, onRecordWorkspaceAction]);

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
    notes,
    activeNote,
    activeNoteId,
    markdownDraft,
    loading,
    saving,
    error,
    enabled,
    canCreateNote,
    canUndo,
    canRedo,
    maxNotesPerNote: MAX_AI_CANVAS_NOTES_PER_NOTE,
    hasUnsavedChanges,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((current) => !current),
    selectNote,
    setMarkdownDraft: changeMarkdownDraft,
    createNote,
    renameNote,
    deleteNote,
    ensureNoteForChatEdit,
    applyChatCanvasEdit,
    undoCanvasEdit,
    redoCanvasEdit,
    showFeedback: onFeedback,
  };
}
