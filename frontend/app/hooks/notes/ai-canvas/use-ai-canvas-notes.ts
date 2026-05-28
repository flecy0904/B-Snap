import { useCallback, useEffect, useRef, useState } from 'react';

import {
  BackendApiError,
  createBackendAiCanvasNote,
  deleteBackendAiCanvasNote,
  getBackendAiCanvasNote,
  listBackendAiCanvasNotes,
  updateBackendAiCanvasNote,
  type BackendAiCanvasNote,
  type BackendAiCanvasNoteSummary,
} from '../../../services/backend-api';
import {
  EMPTY_AI_CANVAS_DOCUMENT,
  areAiCanvasDocumentsEqual,
  cloneAiCanvasDocument,
  normalizeAiCanvasDocumentJson,
  stringifyAiCanvasDocument,
  type AiCanvasDocumentJson,
  type AiCanvasEditorChange,
  type CanvasOperation,
  type CanvasOperationRequest,
} from '../../../types/ai-canvas';

type CanvasSnapshot = {
  documentJson: AiCanvasDocumentJson;
  markdown: string;
};

export type UseAiCanvasNotesResult = {
  isOpen: boolean;
  notes: BackendAiCanvasNoteSummary[];
  activeNote: BackendAiCanvasNote | null;
  activeNoteId: number | null;
  documentDraft: AiCanvasDocumentJson;
  markdownDraft: string;
  pendingCanvasOperations: CanvasOperationRequest | null;
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
  setDocumentDraft: (change: AiCanvasEditorChange) => void;
  completeCanvasOperations: (requestId: number, applied: boolean) => Promise<void>;
  createNote: () => Promise<void>;
  renameNote: (title: string, noteId?: number) => Promise<boolean>;
  deleteNote: (noteId?: number) => Promise<void>;
  ensureNoteForChatEdit: () => Promise<{ note: BackendAiCanvasNote; needsTitle: boolean } | null>;
  applyChatCanvasEdit: (payload: {
    action: 'canvas_edit' | 'canvas_create';
    canvasNote: BackendAiCanvasNote;
    operations: CanvasOperation[];
  }) => void;
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

function createEmptyCanvasSnapshot(): CanvasSnapshot {
  return {
    documentJson: cloneAiCanvasDocument(EMPTY_AI_CANVAS_DOCUMENT),
    markdown: DEFAULT_CANVAS_MARKDOWN,
  };
}

function snapshotFromNote(note: BackendAiCanvasNote | null): CanvasSnapshot {
  if (!note) return createEmptyCanvasSnapshot();
  return {
    documentJson: normalizeAiCanvasDocumentJson(note.documentJson),
    markdown: note.markdown ?? '',
  };
}

function snapshotEquals(left: CanvasSnapshot, right: CanvasSnapshot) {
  return left.markdown === right.markdown && areAiCanvasDocumentsEqual(left.documentJson, right.documentJson);
}

function appendUndoSnapshot(stack: CanvasSnapshot[], snapshot: CanvasSnapshot) {
  if (stack.length > 0 && snapshotEquals(stack[stack.length - 1], snapshot)) return stack;
  return [...stack, snapshot].slice(-MAX_UNDO_STACK_SIZE);
}

function normalizeAiCanvasMarkdown(markdown: string) {
  return markdown.replace(/&nbsp;/g, '').replace(/\u00A0/g, '').trim();
}

function hasMeaningfulSnapshot(snapshot: CanvasSnapshot) {
  return Boolean(normalizeAiCanvasMarkdown(snapshot.markdown)) || stringifyAiCanvasDocument(snapshot.documentJson) !== stringifyAiCanvasDocument(EMPTY_AI_CANVAS_DOCUMENT);
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
  const [documentDraft, setDocumentDraftState] = useState<AiCanvasDocumentJson>(() => cloneAiCanvasDocument(EMPTY_AI_CANVAS_DOCUMENT));
  const [markdownDraft, setMarkdownDraft] = useState('');
  const [pendingCanvasOperations, setPendingCanvasOperations] = useState<CanvasOperationRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<CanvasSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<CanvasSnapshot[]>([]);
  const detailRequestIdRef = useRef(0);
  const autosaveRequestIdRef = useRef(0);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeNoteIdRef = useRef<number | null>(null);
  const activeNoteRevisionRef = useRef<number | null>(null);
  const documentDraftRef = useRef<AiCanvasDocumentJson>(cloneAiCanvasDocument(EMPTY_AI_CANVAS_DOCUMENT));
  const markdownDraftRef = useRef('');
  const directEditBaselineRef = useRef<CanvasSnapshot | null>(null);
  const directEditTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transientErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const operationRequestIdRef = useRef(0);

  useEffect(() => {
    activeNoteIdRef.current = activeNote?.id ?? null;
    activeNoteRevisionRef.current = activeNote?.revision ?? null;
  }, [activeNote?.id, activeNote?.revision]);

  useEffect(() => {
    documentDraftRef.current = documentDraft;
    markdownDraftRef.current = markdownDraft;
  }, [documentDraft, markdownDraft]);

  const currentSnapshot = useCallback((): CanvasSnapshot => ({
    documentJson: documentDraft,
    markdown: markdownDraft,
  }), [documentDraft, markdownDraft]);

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
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (transientErrorTimerRef.current) {
      clearTimeout(transientErrorTimerRef.current);
      transientErrorTimerRef.current = null;
    }
  }, [finishDirectEditBatch]);

  const activeSnapshot = snapshotFromNote(activeNote);
  const draftSnapshot = currentSnapshot();
  const hasUnsavedChanges = !!activeNote && !snapshotEquals(draftSnapshot, activeSnapshot);
  const canCreateNote = notes.length < MAX_AI_CANVAS_NOTES_PER_NOTE;
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  const setDraftSnapshot = useCallback((snapshot: CanvasSnapshot) => {
    const nextDocument = normalizeAiCanvasDocumentJson(snapshot.documentJson);
    setDocumentDraftState(nextDocument);
    setMarkdownDraft(snapshot.markdown);
    documentDraftRef.current = nextDocument;
    markdownDraftRef.current = snapshot.markdown;
  }, []);

  const applyActiveNote = useCallback((note: BackendAiCanvasNote | null) => {
    finishDirectEditBatch();
    setActiveNote(note);
    setActiveNoteId(note?.id ?? null);
    setDraftSnapshot(snapshotFromNote(note));
    setPendingCanvasOperations(null);
    setUndoStack([]);
    setRedoStack([]);
  }, [finishDirectEditBatch, setDraftSnapshot]);

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
      if (detailRequestIdRef.current === requestId) setError('Failed to load AI Canvas Note.');
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
        setError('Failed to load AI Canvas Notes.');
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

  const changeDocumentDraft = useCallback((change: AiCanvasEditorChange) => {
    const nextSnapshot: CanvasSnapshot = {
      documentJson: normalizeAiCanvasDocumentJson(change.documentJson),
      markdown: change.markdown,
    };
    const previousSnapshot = currentSnapshot();
    if (snapshotEquals(nextSnapshot, previousSnapshot)) return;

    const lineCountChanged = nextSnapshot.markdown.split('\n').length !== previousSnapshot.markdown.split('\n').length;
    const likelyPaste = Math.abs(nextSnapshot.markdown.length - previousSnapshot.markdown.length) > 8;

    if (directEditBaselineRef.current === null) {
      directEditBaselineRef.current = previousSnapshot;
      setUndoStack((current) => appendUndoSnapshot(current, previousSnapshot));
      setRedoStack([]);
      onRecordWorkspaceAction?.();
    }
    setDraftSnapshot(nextSnapshot);

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
  }, [currentSnapshot, finishDirectEditBatch, onRecordWorkspaceAction, setDraftSnapshot]);

  const createCanvasNote = useCallback(async () => {
    if (!enabled || !noteId) {
      setError('Canvas is only available for backend-saved notes.');
      return null;
    }
    if (!canCreateNote) {
      const message = `Canvas notes are limited to ${MAX_AI_CANVAS_NOTES_PER_NOTE}.`;
      setTransientError(message);
      onFeedback(message);
      return null;
    }

    const pageNumber = currentPageNumber ?? null;
    const created = await createBackendAiCanvasNote({
      noteId,
      title: DEFAULT_CANVAS_TITLE,
      markdown: DEFAULT_CANVAS_MARKDOWN,
      documentJson: EMPTY_AI_CANVAS_DOCUMENT,
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
      onFeedback('AI Canvas Note created.');
    } catch {
      setError('Failed to create AI Canvas Note.');
    } finally {
      setSaving(false);
    }
  }, [createCanvasNote, onFeedback]);

  const enqueueCanvasMutation = useCallback(<T,>(task: () => Promise<T>) => {
    const nextTask = autosaveQueueRef.current
      .catch(() => undefined)
      .then(task);
    autosaveQueueRef.current = nextTask.then(() => undefined, () => undefined);
    return nextTask;
  }, []);

  const renameNote = useCallback(async (title: string, noteIdToRename?: number) => {
    const targetNoteId = noteIdToRename ?? activeNote?.id ?? null;
    if (!targetNoteId) return false;

    const nextTitle = title.trim();
    if (!nextTitle) {
      setError('Enter a title.');
      return false;
    }

    setSaving(true);
    setError(null);
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    autosaveRequestIdRef.current += 1;

    const isActiveTarget = targetNoteId === activeNote?.id;
    const renameMarkdown = isActiveTarget ? markdownDraftRef.current : undefined;
    const renameDocumentJson = isActiveTarget ? documentDraftRef.current : undefined;
    const renameDocumentString = renameDocumentJson ? stringifyAiCanvasDocument(renameDocumentJson) : null;
    try {
      const updated = await enqueueCanvasMutation(() => updateBackendAiCanvasNote({
        canvasNoteId: targetNoteId,
        title: nextTitle,
        markdown: renameMarkdown,
        documentJson: renameDocumentJson,
        expectedRevision: isActiveTarget
          ? activeNoteRevisionRef.current ?? activeNote?.revision
          : notes.find((note) => note.id === targetNoteId)?.revision,
      }));
      setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)));
      if (updated.id === activeNoteIdRef.current) {
        activeNoteRevisionRef.current = updated.revision;
        const draftUnchanged = markdownDraftRef.current === renameMarkdown
          && stringifyAiCanvasDocument(documentDraftRef.current) === renameDocumentString;
        if (draftUnchanged) {
          applyActiveNote(updated);
        } else {
          setActiveNote(updated);
          setActiveNoteId(updated.id);
        }
      }
      onFeedback('AI Canvas Note renamed.');
      return true;
    } catch {
      setError('Failed to rename AI Canvas Note.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [activeNote, applyActiveNote, enqueueCanvasMutation, notes, onFeedback]);

  const deleteNote = useCallback(async (noteIdToDelete?: number) => {
    const targetNoteId = noteIdToDelete ?? activeNote?.id ?? null;
    if (!targetNoteId) return;

    setSaving(true);
    setError(null);
    const isActiveTarget = targetNoteId === activeNote?.id;
    if (isActiveTarget) {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      autosaveRequestIdRef.current += 1;
    }
    try {
      await enqueueCanvasMutation(() => deleteBackendAiCanvasNote(targetNoteId));
      const nextNotes = notes.filter((note) => note.id !== targetNoteId);
      setNotes(nextNotes);
      if (isActiveTarget) {
        const nextActive = nextNotes[0] ?? null;
        if (nextActive) {
          await loadCanvasNoteDetail(nextActive.id);
        } else {
          applyActiveNote(null);
        }
      }
      onFeedback('AI Canvas Note deleted.');
    } catch {
      setError('Failed to delete AI Canvas Note.');
    } finally {
      setSaving(false);
    }
  }, [activeNote, applyActiveNote, enqueueCanvasMutation, loadCanvasNoteDetail, notes, onFeedback]);

  const refreshActiveNoteAfterConflict = useCallback(async (canvasNoteId: number) => {
    try {
      const latest = await getBackendAiCanvasNote(canvasNoteId);
      if (activeNoteIdRef.current !== canvasNoteId) return false;
      activeNoteRevisionRef.current = latest.revision;
      setNotes((current) => current.map((note) => (note.id === latest.id ? latest : note)));
      setActiveNote((current) => (current?.id === latest.id ? latest : current));
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!activeNote || !hasUnsavedChanges) return;

    const timer = setTimeout(() => {
      if (autosaveTimerRef.current === timer) {
        autosaveTimerRef.current = null;
      }
      const requestId = autosaveRequestIdRef.current + 1;
      autosaveRequestIdRef.current = requestId;
      const targetNoteId = activeNote.id;
      const targetMarkdown = markdownDraft;
      const targetDocumentJson = documentDraft;
      const targetDocumentString = stringifyAiCanvasDocument(targetDocumentJson);

      void enqueueCanvasMutation(async () => {
          if (
            autosaveRequestIdRef.current !== requestId
            || activeNoteIdRef.current !== targetNoteId
            || markdownDraftRef.current !== targetMarkdown
            || stringifyAiCanvasDocument(documentDraftRef.current) !== targetDocumentString
          ) {
            return;
          }
          try {
            const expectedRevision = activeNoteRevisionRef.current;
            if (expectedRevision === null) return;
            const updated = await updateBackendAiCanvasNote({
              canvasNoteId: targetNoteId,
              markdown: targetMarkdown,
              documentJson: targetDocumentJson,
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
              && stringifyAiCanvasDocument(documentDraftRef.current) === targetDocumentString
            ) {
              setActiveNote(updated);
            }
          } catch (error) {
            if (autosaveRequestIdRef.current === requestId) {
              if (error instanceof BackendApiError && error.status === 409) {
                const refreshed = await refreshActiveNoteAfterConflict(targetNoteId);
                if (refreshed) return;
              }
              onFeedback('Canvas autosave failed.');
            }
          }
        });
    }, 700);
    autosaveTimerRef.current = timer;

    return () => {
      clearTimeout(timer);
      if (autosaveTimerRef.current === timer) {
        autosaveTimerRef.current = null;
      }
    };
  }, [activeNote, documentDraft, enqueueCanvasMutation, hasUnsavedChanges, markdownDraft, onFeedback, refreshActiveNoteAfterConflict]);

  const ensureNoteForChatEdit = useCallback(async () => {
    if (!enabled || !noteId) {
      setError('Canvas can only be edited for backend-saved notes.');
      return null;
    }
    if (activeNote) return { note: activeNote, needsTitle: false };
    const created = await createCanvasNote();
    return created ? { note: created, needsTitle: true } : null;
  }, [activeNote, createCanvasNote, enabled, noteId]);

  const applyChatCanvasEdit = useCallback(({
    action,
    canvasNote,
    operations,
  }: {
    action: 'canvas_edit' | 'canvas_create';
    canvasNote: BackendAiCanvasNote;
    operations: CanvasOperation[];
  }) => {
    setIsOpen(true);
    finishDirectEditBatch();
    if (!operations.length) {
      setTransientError('AI returned no Canvas edits.');
      return;
    }

    const previousSnapshot = action === 'canvas_create' ? createEmptyCanvasSnapshot() : currentSnapshot();
    if (hasMeaningfulSnapshot(previousSnapshot)) {
      setUndoStack((current) => appendUndoSnapshot(current, previousSnapshot));
      setRedoStack([]);
      onRecordWorkspaceAction?.();
    }

    const preservedRevision = action === 'canvas_edit'
      ? Math.max(activeNoteRevisionRef.current ?? canvasNote.revision, canvasNote.revision)
      : canvasNote.revision;
    const nextCanvasNote: BackendAiCanvasNote = action === 'canvas_edit' && activeNote?.id === canvasNote.id
      ? {
        ...canvasNote,
        markdown: activeNote.markdown,
        documentJson: activeNote.documentJson,
        revision: preservedRevision,
      }
      : {
        ...canvasNote,
        revision: preservedRevision,
      };

    setActiveNote(nextCanvasNote);
    setActiveNoteId(canvasNote.id);
    activeNoteIdRef.current = canvasNote.id;
    activeNoteRevisionRef.current = preservedRevision;

    if (action === 'canvas_create') {
      setDraftSnapshot(snapshotFromNote(nextCanvasNote));
    }

    setNotes((current) => {
      const exists = current.some((note) => note.id === canvasNote.id);
      if (!exists) return [nextCanvasNote, ...current];
      return current.map((note) => (note.id === canvasNote.id ? nextCanvasNote : note));
    });
    autosaveRequestIdRef.current += 1;
    operationRequestIdRef.current += 1;
    setPendingCanvasOperations({
      id: operationRequestIdRef.current,
      action,
      canvasNoteId: canvasNote.id,
      operations,
    });
    setError(null);
  }, [activeNote, currentSnapshot, finishDirectEditBatch, onRecordWorkspaceAction, setDraftSnapshot, setTransientError]);

  const completeCanvasOperations = useCallback(async (requestId: number, applied: boolean) => {
    const pendingRequest = pendingCanvasOperations;
    if (!pendingRequest || pendingRequest.id !== requestId) return;
    setPendingCanvasOperations(null);
    if (!applied) {
      setTransientError('Canvas 수정 적용 실패');
      onFeedback('Canvas 수정 적용 실패');
      if (pendingRequest.action === 'canvas_create') {
        try {
          await deleteBackendAiCanvasNote(pendingRequest.canvasNoteId);
          const nextNotes = notes.filter((note) => note.id !== pendingRequest.canvasNoteId);
          setNotes(nextNotes);
          if (activeNoteIdRef.current === pendingRequest.canvasNoteId) {
            const nextActive = nextNotes[0] ?? null;
            if (nextActive) {
              await loadCanvasNoteDetail(nextActive.id);
            } else {
              applyActiveNote(null);
            }
          }
        } catch {
          setTransientError('Canvas 수정 적용 실패');
        }
      }
      return;
    }
    onFeedback('AI updated the Canvas.');
  }, [applyActiveNote, loadCanvasNoteDetail, notes, onFeedback, pendingCanvasOperations, setTransientError]);

  const undoCanvasEdit = useCallback(() => {
    if (!canUndo) return;
    const previous = undoStack[undoStack.length - 1];
    finishDirectEditBatch();
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => appendUndoSnapshot(current, currentSnapshot()));
    setDraftSnapshot(previous);
  }, [canUndo, currentSnapshot, finishDirectEditBatch, setDraftSnapshot, undoStack]);

  const redoCanvasEdit = useCallback(() => {
    if (!canRedo) return;
    const next = redoStack[redoStack.length - 1];
    finishDirectEditBatch();
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => appendUndoSnapshot(current, currentSnapshot()));
    setDraftSnapshot(next);
  }, [canRedo, currentSnapshot, finishDirectEditBatch, redoStack, setDraftSnapshot]);

  return {
    isOpen,
    notes,
    activeNote,
    activeNoteId,
    documentDraft,
    markdownDraft,
    pendingCanvasOperations,
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
    setDocumentDraft: changeDocumentDraft,
    completeCanvasOperations,
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
