import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createBackendAiCanvasNote,
  deleteBackendAiCanvasNote,
  listBackendAiCanvasNotes,
  requestBackendAiCanvasEdit,
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
  markdownDraft: string;
  loading: boolean;
  saving: boolean;
  error: string | null;
  aiDraftMarkdown: string | null;
  aiEditing: boolean;
  enabled: boolean;
  canCreateNote: boolean;
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
  renameActiveNote: (title: string) => Promise<boolean>;
  deleteActiveNote: () => Promise<void>;
  requestAiEditFromChat: (payload: { question: string; answer: string }) => Promise<void>;
  applyAiDraft: () => void;
  discardAiDraft: () => void;
};

const DEFAULT_CANVAS_TITLE = 'AI Canvas Note';
const DEFAULT_CANVAS_MARKDOWN = '# AI Canvas Note\n\n정리할 내용을 입력하거나 AI에게 추가를 요청해보세요.';
const MAX_AI_CANVAS_NOTES_PER_NOTE = 3;

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
  const [markdownDraft, setMarkdownDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiDraftMarkdown, setAiDraftMarkdown] = useState<string | null>(null);
  const [aiEditing, setAiEditing] = useState(false);

  const activeNote = useMemo(
    () => notes.find((note) => note.id === activeNoteId) ?? null,
    [activeNoteId, notes],
  );
  const hasUnsavedChanges = !!activeNote && (
    markdownDraft !== activeNote.markdown
  );
  const canCreateNote = notes.length < MAX_AI_CANVAS_NOTES_PER_NOTE;

  const applyActiveNote = useCallback((note: BackendAiCanvasNote | null) => {
    setActiveNoteId(note?.id ?? null);
    setMarkdownDraft(note?.markdown ?? '');
    setMode(note ? 'preview' : 'edit');
    setAiDraftMarkdown(null);
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

  const createCanvasNote = useCallback(async () => {
    if (!enabled || !noteId) {
      setError('백엔드에 저장된 노트에서만 사용할 수 있습니다.');
      return null;
    }
    if (!canCreateNote) {
      setError(`이 노트에서는 Canvas Note를 최대 ${MAX_AI_CANVAS_NOTES_PER_NOTE}개까지 만들 수 있습니다.`);
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
  }, [applyActiveNote, canCreateNote, currentPageNumber, enabled, noteId]);

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

  const renameActiveNote = useCallback(async (title: string) => {
    if (!activeNote) return false;

    const nextTitle = title.trim();
    if (!nextTitle) {
      setError('제목을 입력해 주세요.');
      return false;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await updateBackendAiCanvasNote({
        canvasNoteId: activeNote.id,
        title: nextTitle,
        markdown: markdownDraft,
      });
      setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)));
      applyActiveNote(updated);
      onFeedback('AI Canvas Note 이름을 변경했습니다.');
      return true;
    } catch {
      setError('AI Canvas Note 이름을 변경하지 못했습니다.');
      return false;
    } finally {
      setSaving(false);
    }
  }, [activeNote, applyActiveNote, markdownDraft, onFeedback]);

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
    setMarkdownDraft(aiDraftMarkdown);
    setAiDraftMarkdown(null);
    setMode('edit');
  }, [aiDraftMarkdown]);

  const discardAiDraft = useCallback(() => {
    setAiDraftMarkdown(null);
  }, []);

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
    maxNotesPerNote: MAX_AI_CANVAS_NOTES_PER_NOTE,
    hasUnsavedChanges,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
    toggle: () => setIsOpen((current) => !current),
    setMode,
    selectNote,
    setMarkdownDraft,
    createNote,
    saveNote,
    renameActiveNote,
    deleteActiveNote,
    requestAiEditFromChat,
    applyAiDraft,
    discardAiDraft,
  };
}
