import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createBackendAiCanvasNote,
  deleteBackendAiCanvasNote,
  listBackendAiCanvasNotes,
  updateBackendAiCanvasNote,
  type BackendAiCanvasNote,
} from '../../../services/backend-api';

export type AiCanvasMode = 'preview' | 'edit';

export type UseAiCanvasNotesResult = {
  isOpen: boolean;
  mode: AiCanvasMode;
  notes: BackendAiCanvasNote[];
  activeNote: BackendAiCanvasNote | null;
  activeNoteId: number | null;
  titleDraft: string;
  markdownDraft: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  enabled: boolean;
  hasUnsavedChanges: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
  setMode: (mode: AiCanvasMode) => void;
  selectNote: (noteId: number) => void;
  setTitleDraft: (value: string) => void;
  setMarkdownDraft: (value: string) => void;
  createNote: () => Promise<void>;
  saveNote: () => Promise<void>;
  deleteActiveNote: () => Promise<void>;
};

export function useAiCanvasNotes({
  noteId,
  enabled,
  currentPageNumber,
  onFeedback,
}: {
  noteId: number | null;
  enabled: boolean;
  currentPageNumber: number | null;
  onFeedback: (message: string) => void;
}): UseAiCanvasNotesResult {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AiCanvasMode>('preview');
  const [notes, setNotes] = useState<BackendAiCanvasNote[]>([]);
  const [activeNoteId, setActiveNoteId] = useState<number | null>(null);
  const [titleDraft, setTitleDraft] = useState('');
  const [markdownDraft, setMarkdownDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeNoteId) ?? null,
    [activeNoteId, notes],
  );
  const hasUnsavedChanges = !!activeNote && (
    titleDraft.trim() !== activeNote.title
    || markdownDraft !== activeNote.markdown
  );

  const applyActiveNote = useCallback((note: BackendAiCanvasNote | null) => {
    setActiveNoteId(note?.id ?? null);
    setTitleDraft(note?.title ?? '');
    setMarkdownDraft(note?.markdown ?? '');
    setMode(note ? 'preview' : 'edit');
  }, []);

  useEffect(() => {
    if (!enabled || !noteId) {
      setNotes([]);
      applyActiveNote(null);
      setLoading(false);
      setError(null);
      return;
    }

    let mounted = true;
    setLoading(true);
    setError(null);

    listBackendAiCanvasNotes(noteId)
      .then((items) => {
        if (!mounted) return;
        setNotes(items);
        applyActiveNote(items[0] ?? null);
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
    };
  }, [applyActiveNote, enabled, noteId]);

  const selectNote = useCallback((nextNoteId: number) => {
    const next = notes.find((note) => note.id === nextNoteId) ?? null;
    applyActiveNote(next);
  }, [applyActiveNote, notes]);

  const createNote = useCallback(async () => {
    if (!enabled || !noteId) {
      setError('백엔드에 저장된 노트에서 사용할 수 있습니다.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const pageNumber = currentPageNumber ?? null;
      const created = await createBackendAiCanvasNote({
        noteId,
        title: '새 Canvas Note',
        markdown: '# 새 Canvas Note\n\n정리할 내용을 입력하거나 AI 답변을 추가해보세요.',
        sourcePageStart: pageNumber,
        sourcePageEnd: pageNumber,
      });
      setNotes((current) => [created, ...current]);
      applyActiveNote(created);
      setMode('edit');
      onFeedback('AI Canvas Note를 만들었습니다.');
    } catch {
      setError('AI Canvas Note를 만들지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }, [applyActiveNote, currentPageNumber, enabled, noteId, onFeedback]);

  const saveNote = useCallback(async () => {
    if (!activeNote) return;

    const title = titleDraft.trim();
    if (!title) {
      setError('제목을 입력해 주세요.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await updateBackendAiCanvasNote({
        canvasNoteId: activeNote.id,
        title,
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
  }, [activeNote, applyActiveNote, markdownDraft, onFeedback, titleDraft]);

  const deleteActiveNote = useCallback(async () => {
    if (!activeNote) return;

    setSaving(true);
    setError(null);
    try {
      await deleteBackendAiCanvasNote(activeNote.id);
      const nextNotes = notes.filter((note) => note.id !== activeNote.id);
      setNotes(nextNotes);
      applyActiveNote(nextNotes[0] ?? null);
      onFeedback('AI Canvas Note를 삭제했습니다.');
    } catch {
      setError('AI Canvas Note를 삭제하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  }, [activeNote, applyActiveNote, notes, onFeedback]);

  return {
    isOpen,
    mode,
    notes,
    activeNote,
    activeNoteId,
    titleDraft,
    markdownDraft,
    loading,
    saving,
    error,
    enabled,
    hasUnsavedChanges,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((current) => !current),
    setMode,
    selectNote,
    setTitleDraft,
    setMarkdownDraft,
    createNote,
    saveNote,
    deleteActiveNote,
  };
}
