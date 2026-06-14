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
  type AiCanvasOperationApplyResult,
  type AiCanvasDocumentJson,
  type AiCanvasEditorChange,
  type AiCanvasSelection,
  type CanvasOperation,
  type CanvasOperationRequest,
  type TiptapJsonNode,
} from '../../../types/ai-canvas';

type CanvasSnapshot = {
  documentJson: AiCanvasDocumentJson;
  markdown: string;
  selection: AiCanvasSelection | null;
};

type AiCanvasEditorHistoryControls = {
  undo: () => boolean;
  redo: () => boolean;
};

export type UseAiCanvasNotesResult = {
  isOpen: boolean;
  notes: BackendAiCanvasNoteSummary[];
  activeNote: BackendAiCanvasNote | null;
  activeNoteId: number | null;
  documentDraft: AiCanvasDocumentJson;
  markdownDraft: string;
  selectionDraft: AiCanvasSelection | null;
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
  setSelectionDraft: (selection: AiCanvasSelection | null) => void;
  setEditorHistoryState: (state: { canUndo: boolean; canRedo: boolean }) => void;
  registerEditorHistoryControls: (controls: AiCanvasEditorHistoryControls | null) => void;
  completeCanvasOperations: (requestId: number, result: AiCanvasOperationApplyResult) => Promise<void>;
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
const AUTOSAVE_DEBOUNCE_DELAY_MS = 2000;
const TRANSIENT_ERROR_DELAY_MS = 3000;
const MAX_UNDO_STACK_SIZE = 50;
const CREATE_CANVAS_TOP_LEVEL_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'codeBlock',
  'horizontalRule',
]);
const CREATE_CANVAS_TEXTBLOCK_NODE_TYPES = new Set(['paragraph', 'heading', 'codeBlock']);

function buildDefaultCanvasTitle(index: number) {
  return `${DEFAULT_CANVAS_TITLE} ${index}`;
}

function createEmptyCanvasSnapshot(): CanvasSnapshot {
  return {
    documentJson: cloneAiCanvasDocument(EMPTY_AI_CANVAS_DOCUMENT),
    markdown: DEFAULT_CANVAS_MARKDOWN,
    selection: null,
  };
}

function snapshotFromNote(note: BackendAiCanvasNote | null): CanvasSnapshot {
  if (!note) return createEmptyCanvasSnapshot();
  return {
    documentJson: normalizeAiCanvasDocumentJson(note.documentJson),
    markdown: note.markdown ?? '',
    selection: null,
  };
}

function snapshotEquals(left: CanvasSnapshot, right: CanvasSnapshot) {
  return left.markdown === right.markdown && areAiCanvasDocumentsEqual(left.documentJson, right.documentJson);
}

function appendUndoSnapshot(stack: CanvasSnapshot[], snapshot: CanvasSnapshot) {
  if (stack.length > 0 && snapshotEquals(stack[stack.length - 1], snapshot)) return stack;
  return [...stack, snapshot].slice(-MAX_UNDO_STACK_SIZE);
}

function cloneCanvasNode<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function getCanvasNodeBlockId(node: TiptapJsonNode | null | undefined) {
  return typeof node?.attrs?.blockId === 'string' && node.attrs.blockId ? node.attrs.blockId : null;
}

function collectCanvasNodeBlockIds(node: TiptapJsonNode, blockIds: Set<string>) {
  const blockId = getCanvasNodeBlockId(node);
  if (blockId) blockIds.add(blockId);
  node.content?.forEach((child) => collectCanvasNodeBlockIds(child, blockIds));
}

function createCanvasOperationBlockId(existingBlockIds: Set<string>) {
  let index = existingBlockIds.size + 1;
  while (existingBlockIds.has(`ai_canvas_${index}`)) index += 1;
  const blockId = `ai_canvas_${index}`;
  existingBlockIds.add(blockId);
  return blockId;
}

function prepareCreateCanvasNode(node: TiptapJsonNode, existingBlockIds: Set<string>): TiptapJsonNode {
  const next = cloneCanvasNode(node);
  if (next.type !== 'text') {
    const blockId = getCanvasNodeBlockId(next);
    next.attrs = {
      ...(next.attrs ?? {}),
      blockId: blockId && !existingBlockIds.has(blockId)
        ? blockId
        : createCanvasOperationBlockId(existingBlockIds),
    };
    if (typeof next.attrs.blockId === 'string') existingBlockIds.add(next.attrs.blockId);
  }
  if (next.content) {
    next.content = next.content.map((child) => prepareCreateCanvasNode(child, existingBlockIds));
  }
  return next;
}

function canUseNodeForCreatedCanvas(node: TiptapJsonNode, parentType: string | null = null): boolean {
  if (parentType === null && !CREATE_CANVAS_TOP_LEVEL_NODE_TYPES.has(node.type)) return false;
  if (node.type === 'text') return parentType !== null;
  if (CREATE_CANVAS_TEXTBLOCK_NODE_TYPES.has(node.type)) {
    return (node.content ?? []).every((child) => child.type === 'text' && canUseNodeForCreatedCanvas(child, node.type));
  }
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    if (parentType !== null && parentType !== 'listItem') return false;
    const children = node.content ?? [];
    return children.length > 0 && children.every((child) => canUseNodeForCreatedCanvas(child, node.type));
  }
  if (node.type === 'listItem') {
    if (parentType !== 'bulletList' && parentType !== 'orderedList') return false;
    const children = node.content ?? [];
    return children.length > 0 && children.every((child) => (
      child.type === 'paragraph'
      || child.type === 'bulletList'
      || child.type === 'orderedList'
    ) && canUseNodeForCreatedCanvas(child, node.type));
  }
  return node.type === 'horizontalRule' && parentType === null;
}

function findCreateCanvasTopLevelIndex(content: TiptapJsonNode[], blockId: string) {
  const containsBlockId = (node: TiptapJsonNode): boolean => (
    getCanvasNodeBlockId(node) === blockId || Boolean(node.content?.some(containsBlockId))
  );
  return content.findIndex(containsBlockId);
}

function operationNodesForCreate(operation: CanvasOperation, existingBlockIds: Set<string>) {
  const rawNode = 'node' in operation ? operation.node : null;
  if (!rawNode) return [];
  const rawNodes = rawNode.type === 'doc' ? rawNode.content ?? [] : [rawNode];
  if (!rawNodes.every((node) => canUseNodeForCreatedCanvas(node))) return null;
  return rawNodes.map((node) => prepareCreateCanvasNode(node, existingBlockIds));
}

function normalizeCreateCanvasTargetBlockId(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'null' || normalized === 'none' || normalized === 'undefined') return null;
  return value;
}

function buildCreatedCanvasDocumentFromOperations(operations: CanvasOperation[]): AiCanvasDocumentJson | null {
  const content: TiptapJsonNode[] = [];
  const existingBlockIds = new Set<string>();

  for (const operation of operations) {
    if (operation.op === 'delete') continue;
    const nodes = operationNodesForCreate(operation, existingBlockIds);
    if (nodes === null) return null;
    if (!nodes.length) continue;

    const targetBlockId = normalizeCreateCanvasTargetBlockId(operation.targetBlockId);
    if (operation.op === 'insert_after' && targetBlockId === null) {
      content.push(...nodes);
      nodes.forEach((node) => collectCanvasNodeBlockIds(node, existingBlockIds));
      continue;
    }

    if (!targetBlockId) {
      content.push(...nodes);
      nodes.forEach((node) => collectCanvasNodeBlockIds(node, existingBlockIds));
      continue;
    }
    const targetIndex = findCreateCanvasTopLevelIndex(content, targetBlockId);
    if (targetIndex < 0) {
      content.push(...nodes);
      nodes.forEach((node) => collectCanvasNodeBlockIds(node, existingBlockIds));
      continue;
    }

    if (operation.op === 'replace') {
      content.splice(targetIndex, 1, ...nodes);
    } else if (operation.op === 'insert_before') {
      content.splice(targetIndex, 0, ...nodes);
    } else if (operation.op === 'insert_after') {
      content.splice(targetIndex + 1, 0, ...nodes);
    }
    nodes.forEach((node) => collectCanvasNodeBlockIds(node, existingBlockIds));
  }

  return content.length ? { type: 'doc', content } : null;
}

function canvasInlineMarkdown(node: TiptapJsonNode | null | undefined): string {
  if (!node) return '';
  if (node.type === 'text') {
    let text = typeof node.text === 'string' ? node.text : '';
    (node.marks ?? []).forEach((mark) => {
      if (mark.type === 'code') text = `\`${text}\``;
      if (mark.type === 'bold') text = `**${text}**`;
      if (mark.type === 'italic') text = `*${text}*`;
      if (mark.type === 'strike') text = `~~${text}~~`;
    });
    return text;
  }
  return (node.content ?? []).map(canvasInlineMarkdown).join('');
}

function canvasListItemMarkdown(node: TiptapJsonNode, depth: number, ordered: boolean, index: number): string {
  const marker = ordered ? `${index + 1}. ` : '- ';
  const indent = '  '.repeat(depth);
  const childLines = (node.content ?? []).flatMap((child) => {
    if (child.type === 'paragraph') return [canvasInlineMarkdown(child).trim()];
    if (child.type === 'bulletList' || child.type === 'orderedList') {
      return canvasBlockMarkdownLines(child, depth + 1);
    }
    return canvasBlockMarkdownLines(child, depth);
  });
  const firstTextIndex = childLines.findIndex((line) => line.trim().length > 0);
  if (firstTextIndex < 0) return '';
  const firstLine = `${indent}${marker}${childLines[firstTextIndex].trim()}`;
  const rest = childLines
    .slice(firstTextIndex + 1)
    .filter((line) => line.trim().length > 0)
    .map((line) => (line.startsWith('  ') ? line : `${indent}  ${line}`));
  return [firstLine, ...rest].join('\n');
}

function canvasBlockMarkdownLines(node: TiptapJsonNode, depth = 0): string[] {
  if (node.type === 'heading') {
    const level = typeof node.attrs?.level === 'number' ? Math.min(Math.max(node.attrs.level, 1), 6) : 2;
    const text = canvasInlineMarkdown(node).trim();
    return text ? [`${'#'.repeat(level)} ${text}`] : [];
  }
  if (node.type === 'paragraph') {
    const text = canvasInlineMarkdown(node).trim();
    return text ? [text] : [];
  }
  if (node.type === 'codeBlock') {
    return ['```', canvasInlineMarkdown(node), '```'];
  }
  if (node.type === 'horizontalRule') return ['---'];
  if (node.type === 'bulletList' || node.type === 'orderedList') {
    return (node.content ?? [])
      .filter((child) => child.type === 'listItem')
      .map((child, index) => canvasListItemMarkdown(child, depth, node.type === 'orderedList', index))
      .filter(Boolean);
  }
  if (node.type === 'listItem') return [canvasListItemMarkdown(node, depth, false, 0)].filter(Boolean);
  return (node.content ?? []).flatMap((child) => canvasBlockMarkdownLines(child, depth));
}

function markdownFromCanvasDocument(documentJson: AiCanvasDocumentJson) {
  return (documentJson.content ?? [])
    .flatMap((node) => canvasBlockMarkdownLines(node))
    .filter((line) => line.trim().length > 0)
    .join('\n\n')
    .trim();
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
  const [selectionDraft, setSelectionDraft] = useState<AiCanvasSelection | null>(null);
  const [pendingCanvasOperations, setPendingCanvasOperations] = useState<CanvasOperationRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<CanvasSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<CanvasSnapshot[]>([]);
  const [editorHistoryState, setEditorHistoryState] = useState({ canUndo: false, canRedo: false });
  const detailRequestIdRef = useRef(0);
  const autosaveRequestIdRef = useRef(0);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const activeNoteIdRef = useRef<number | null>(null);
  const activeNoteRevisionRef = useRef<number | null>(null);
  const documentDraftRef = useRef<AiCanvasDocumentJson>(cloneAiCanvasDocument(EMPTY_AI_CANVAS_DOCUMENT));
  const markdownDraftRef = useRef('');
  const selectionDraftRef = useRef<AiCanvasSelection | null>(null);
  const editorHistoryControlsRef = useRef<AiCanvasEditorHistoryControls | null>(null);
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
    selection: selectionDraftRef.current,
  }), [documentDraft, markdownDraft]);

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
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
    if (transientErrorTimerRef.current) {
      clearTimeout(transientErrorTimerRef.current);
      transientErrorTimerRef.current = null;
    }
  }, []);

  const activeSnapshot = snapshotFromNote(activeNote);
  const draftSnapshot = currentSnapshot();
  const hasUnsavedChanges = !!activeNote && !snapshotEquals(draftSnapshot, activeSnapshot);
  const canCreateNote = notes.length < MAX_AI_CANVAS_NOTES_PER_NOTE;
  const canUndo = editorHistoryState.canUndo || undoStack.length > 0;
  const canRedo = editorHistoryState.canRedo || redoStack.length > 0;

  const setDraftSnapshot = useCallback((snapshot: CanvasSnapshot) => {
    const nextDocument = normalizeAiCanvasDocumentJson(snapshot.documentJson);
    setDocumentDraftState(nextDocument);
    setMarkdownDraft(snapshot.markdown);
    setSelectionDraft(snapshot.selection ?? null);
    documentDraftRef.current = nextDocument;
    markdownDraftRef.current = snapshot.markdown;
    selectionDraftRef.current = snapshot.selection ?? null;
  }, []);

  const applyActiveNote = useCallback((note: BackendAiCanvasNote | null) => {
    setActiveNote(note);
    setActiveNoteId(note?.id ?? null);
    setDraftSnapshot(snapshotFromNote(note));
    setPendingCanvasOperations(null);
    setUndoStack([]);
    setRedoStack([]);
    setEditorHistoryState({ canUndo: false, canRedo: false });
    editorHistoryControlsRef.current = null;
  }, [setDraftSnapshot]);

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
      selection: change.selection,
    };
    const previousSnapshot = currentSnapshot();
    if (snapshotEquals(nextSnapshot, previousSnapshot)) return;

    if (change.source === 'editor-history' || change.source === 'external') {
      setDraftSnapshot(nextSnapshot);
      return;
    }
    setDraftSnapshot(nextSnapshot);
  }, [currentSnapshot, setDraftSnapshot]);

  const changeSelectionDraft = useCallback((selection: AiCanvasSelection | null) => {
    const current = selectionDraftRef.current;
    if (
      current?.from === selection?.from
      && current?.to === selection?.to
      && Boolean(current) === Boolean(selection)
    ) {
      return;
    }
    selectionDraftRef.current = selection;
    setSelectionDraft(selection);
  }, []);

  const changeEditorHistoryState = useCallback((state: { canUndo: boolean; canRedo: boolean }) => {
    setEditorHistoryState((current) => (
      current.canUndo === state.canUndo && current.canRedo === state.canRedo ? current : state
    ));
  }, []);

  const registerEditorHistoryControls = useCallback((controls: AiCanvasEditorHistoryControls | null) => {
    editorHistoryControlsRef.current = controls;
    if (!controls) {
      setEditorHistoryState({ canUndo: false, canRedo: false });
    }
  }, []);

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
      title: buildDefaultCanvasTitle(notes.length + 1),
      markdown: DEFAULT_CANVAS_MARKDOWN,
      documentJson: EMPTY_AI_CANVAS_DOCUMENT,
      sourcePageStart: pageNumber,
      sourcePageEnd: pageNumber,
    });
    setNotes((current) => [created, ...current]);
    applyActiveNote(created);
    return created;
  }, [applyActiveNote, canCreateNote, currentPageNumber, enabled, noteId, notes.length, onFeedback, setTransientError]);

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
              setActiveNote(updated);
            }
            if (
              autosaveRequestIdRef.current === requestId
              && activeNoteIdRef.current === updated.id
              && markdownDraftRef.current === targetMarkdown
              && stringifyAiCanvasDocument(documentDraftRef.current) === targetDocumentString
            ) {
              setDraftSnapshot(snapshotFromNote(updated));
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
    }, AUTOSAVE_DEBOUNCE_DELAY_MS);
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
    if (!operations.length) {
      setError(null);
      onFeedback('고칠 내용이 없어 현재 Canvas를 유지했어요.');
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
    const createdDocumentJson = action === 'canvas_create'
      ? buildCreatedCanvasDocumentFromOperations(operations)
      : null;
    const createdMarkdown = createdDocumentJson ? markdownFromCanvasDocument(createdDocumentJson) : null;
    const nextCanvasNote: BackendAiCanvasNote = action === 'canvas_edit' && activeNote?.id === canvasNote.id
      ? {
        ...canvasNote,
        markdown: activeNote.markdown,
        documentJson: activeNote.documentJson,
        revision: preservedRevision,
      }
      : action === 'canvas_create' && createdDocumentJson
        ? {
          ...canvasNote,
          markdown: createdMarkdown ?? DEFAULT_CANVAS_MARKDOWN,
          documentJson: createdDocumentJson,
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
      setDraftSnapshot(createdDocumentJson
        ? { documentJson: createdDocumentJson, markdown: createdMarkdown ?? DEFAULT_CANVAS_MARKDOWN, selection: null }
        : snapshotFromNote(nextCanvasNote));
    }

    setNotes((current) => {
      const exists = current.some((note) => note.id === canvasNote.id);
      if (!exists) return [nextCanvasNote, ...current];
      return current.map((note) => (note.id === canvasNote.id ? nextCanvasNote : note));
    });
    autosaveRequestIdRef.current += 1;
    if (createdDocumentJson) {
      setPendingCanvasOperations(null);
      onFeedback('AI updated the Canvas.');
      const targetDocumentString = stringifyAiCanvasDocument(createdDocumentJson);
      const targetMarkdown = createdMarkdown ?? DEFAULT_CANVAS_MARKDOWN;
      void enqueueCanvasMutation(async () => {
        try {
          const updated = await updateBackendAiCanvasNote({
            canvasNoteId: canvasNote.id,
            markdown: targetMarkdown,
            documentJson: createdDocumentJson,
            expectedRevision: preservedRevision,
          });
          setNotes((current) => current.map((note) => (note.id === updated.id ? updated : note)));
          if (activeNoteIdRef.current === updated.id) {
            activeNoteRevisionRef.current = updated.revision;
            setActiveNote(updated);
            if (
              markdownDraftRef.current === targetMarkdown
              && stringifyAiCanvasDocument(documentDraftRef.current) === targetDocumentString
            ) {
              setDraftSnapshot(snapshotFromNote(updated));
            }
          }
        } catch {
          onFeedback('Canvas autosave failed.');
        }
      });
    } else {
      operationRequestIdRef.current += 1;
      setPendingCanvasOperations({
        id: operationRequestIdRef.current,
        action,
        canvasNoteId: canvasNote.id,
        operations,
      });
    }
    setError(null);
  }, [activeNote, currentSnapshot, enqueueCanvasMutation, onFeedback, onRecordWorkspaceAction, setDraftSnapshot]);

  const completeCanvasOperations = useCallback(async (requestId: number, result: AiCanvasOperationApplyResult) => {
    const pendingRequest = pendingCanvasOperations;
    if (!pendingRequest || pendingRequest.id !== requestId) return;
    setPendingCanvasOperations(null);
    if (result === 'failed') {
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
    if (result === 'unchanged') {
      onFeedback('고칠 내용이 없어 현재 Canvas를 유지했어요.');
      return;
    }
    onFeedback('AI updated the Canvas.');
  }, [applyActiveNote, loadCanvasNoteDetail, notes, onFeedback, pendingCanvasOperations, setTransientError]);

  const undoCanvasEdit = useCallback(() => {
    if (editorHistoryState.canUndo) {
      const applied = editorHistoryControlsRef.current?.undo() ?? false;
      if (applied) return;
      setEditorHistoryState((current) => ({ ...current, canUndo: false }));
    }
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setUndoStack((current) => current.slice(0, -1));
    setRedoStack((current) => appendUndoSnapshot(current, currentSnapshot()));
    setDraftSnapshot(previous);
  }, [currentSnapshot, editorHistoryState.canUndo, setDraftSnapshot, undoStack]);

  const redoCanvasEdit = useCallback(() => {
    if (editorHistoryState.canRedo) {
      const applied = editorHistoryControlsRef.current?.redo() ?? false;
      if (applied) return;
      setEditorHistoryState((current) => ({ ...current, canRedo: false }));
    }
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    setRedoStack((current) => current.slice(0, -1));
    setUndoStack((current) => appendUndoSnapshot(current, currentSnapshot()));
    setDraftSnapshot(next);
  }, [currentSnapshot, editorHistoryState.canRedo, redoStack, setDraftSnapshot]);

  return {
    isOpen,
    notes,
    activeNote,
    activeNoteId,
    documentDraft,
    markdownDraft,
    selectionDraft,
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
    setSelectionDraft: changeSelectionDraft,
    setEditorHistoryState: changeEditorHistoryState,
    registerEditorHistoryControls,
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
