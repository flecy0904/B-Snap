'use dom';

import React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Markdown } from '@tiptap/markdown';
import { Strike } from '@tiptap/extension-strike';
import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Bold } from '@tiptap/extension-bold';
import { BulletList, ListItem, ListKeymap, OrderedList } from '@tiptap/extension-list';
import { CodeBlock } from '@tiptap/extension-code-block';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Heading } from '@tiptap/extension-heading';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Italic } from '@tiptap/extension-italic';
import { Paragraph } from '@tiptap/extension-paragraph';
import { Text } from '@tiptap/extension-text';

import {
  EMPTY_AI_CANVAS_DOCUMENT,
  normalizeAiCanvasDocumentJson,
  stringifyAiCanvasDocument,
  type AiCanvasDocumentJson,
  type AiCanvasEditorChange,
  type CanvasOperation,
  type CanvasOperationRequest,
  type TiptapJsonNode,
} from '../../../types/ai-canvas';

type AiCanvasMarkdownEditorProps = {
  documentJson: AiCanvasDocumentJson;
  fallbackMarkdown?: string;
  editable: boolean;
  placeholder: string;
  pendingOperations?: CanvasOperationRequest | null;
  onChangeDocument: (change: AiCanvasEditorChange) => Promise<void>;
  onFocusEditor: () => Promise<void>;
  onApplyOperationsResult?: (requestId: number, applied: boolean) => Promise<void>;
  dom?: import('expo/dom').DOMProps;
};

const BLOCK_NODE_TYPES = ['paragraph', 'heading', 'codeBlock', 'horizontalRule', 'bulletList', 'orderedList', 'listItem'];
const BLOCK_NODE_TYPE_SET = new Set(BLOCK_NODE_TYPES);

const AiCanvasBlockId = Extension.create({
  name: 'aiCanvasBlockId',
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_NODE_TYPES,
        attributes: {
          blockId: {
            default: null,
            parseHTML: (element) => element.getAttribute('data-block-id'),
            renderHTML: (attributes) => (
              typeof attributes.blockId === 'string' ? { 'data-block-id': attributes.blockId } : {}
            ),
          },
        },
      },
    ];
  },
});

function createBlockId() {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `block_${random.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`;
}

function createEditorExtensions() {
  return [
    AiCanvasBlockId,
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    Heading.configure({
      levels: [1, 2, 3],
    }),
    BulletList,
    OrderedList.configure({
      HTMLAttributes: {
        class: 'ai-canvas-ordered-list',
      },
    }),
    ListItem,
    ListKeymap,
    HorizontalRule,
    CodeBlock,
    HardBreak,
    Strike,
    Markdown.configure({
      indentation: {
        style: 'space',
        size: 2,
      },
      markedOptions: {
        breaks: false,
        gfm: true,
      },
    }),
  ];
}

function normalizeMarkdownValue(markdown: string | null | undefined) {
  return typeof markdown === 'string' ? markdown : '';
}

function isMeaningfullyEmptyMarkdown(markdown: string | null | undefined) {
  return normalizeMarkdownValue(markdown).replace(/&nbsp;/g, '').replace(/\u00A0/g, '').trim().length === 0;
}

function isEmptyEditableNode(node: ProseMirrorNode): boolean {
  if (node.isTextblock) {
    return node.content.size === 0 && ['paragraph', 'heading', 'codeBlock'].includes(node.type.name);
  }
  if (['bulletList', 'orderedList', 'listItem'].includes(node.type.name)) {
    if (node.childCount === 0) return true;
    for (let index = 0; index < node.childCount; index += 1) {
      const child = node.child(index);
      if (!isEmptyEditableNode(child)) return false;
    }
    return true;
  }
  return false;
}

function isEmptyEditableDocumentNode(doc: ProseMirrorNode) {
  if (doc.textContent.trim().length > 0 || doc.childCount === 0) return false;
  for (let index = 0; index < doc.childCount; index += 1) {
    const child = doc.child(index);
    if (!isEmptyEditableNode(child)) return false;
  }
  return true;
}

function isEmptyEditableDocument(editor: Editor) {
  return isEmptyEditableDocumentNode(editor.state.doc);
}

function getEditorMarkdown(editor: Editor) {
  if (isEmptyEditableDocument(editor)) return '';
  try {
    const markdown = normalizeMarkdownValue(editor.getMarkdown());
    return isMeaningfullyEmptyMarkdown(markdown) ? '' : markdown;
  } catch {
    const text = editor.state.doc.textContent;
    return isMeaningfullyEmptyMarkdown(text) ? '' : text;
  }
}

function ensureEditorBlockIds(editor: Editor) {
  let tr = editor.state.tr;
  const seenBlockIds = new Set<string>();
  editor.state.doc.descendants((node, pos) => {
    if (!BLOCK_NODE_TYPE_SET.has(node.type.name)) return;
    const currentBlockId = typeof node.attrs.blockId === 'string' ? node.attrs.blockId : null;
    if (currentBlockId && !seenBlockIds.has(currentBlockId)) {
      seenBlockIds.add(currentBlockId);
      return;
    }
    const nextBlockId = createUniqueBlockId(seenBlockIds);
    tr = tr.setNodeMarkup(pos, undefined, {
      ...node.attrs,
      blockId: nextBlockId,
    });
    seenBlockIds.add(nextBlockId);
  });
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr);
  return true;
}

function createUniqueBlockId(existingBlockIds: Set<string>) {
  let nextBlockId = createBlockId();
  while (existingBlockIds.has(nextBlockId)) {
    nextBlockId = createBlockId();
  }
  return nextBlockId;
}

function collectDocumentBlockIds(doc: ProseMirrorNode) {
  const blockIds = new Set<string>();
  doc.descendants((node) => {
    if (typeof node.attrs?.blockId === 'string' && node.attrs.blockId) {
      blockIds.add(node.attrs.blockId);
    }
    return undefined;
  });
  return blockIds;
}

function removeTargetBlockIds(blockIds: Set<string>, node: ProseMirrorNode) {
  node.descendants((child) => {
    if (typeof child.attrs?.blockId === 'string' && child.attrs.blockId) {
      blockIds.delete(child.attrs.blockId);
    }
    return undefined;
  });
  if (typeof node.attrs?.blockId === 'string' && node.attrs.blockId) {
    blockIds.delete(node.attrs.blockId);
  }
}

function assignJsonBlockIds(node: TiptapJsonNode, existingBlockIds: Set<string>): TiptapJsonNode {
  const next: TiptapJsonNode = { ...node };
  if (BLOCK_NODE_TYPE_SET.has(next.type)) {
    const currentBlockId = typeof next.attrs?.blockId === 'string' ? next.attrs.blockId : null;
    const blockId = currentBlockId && !existingBlockIds.has(currentBlockId)
      ? currentBlockId
      : createUniqueBlockId(existingBlockIds);
    existingBlockIds.add(blockId);
    next.attrs = {
      ...(next.attrs ?? {}),
      blockId,
    };
  }
  if (Array.isArray(next.content)) {
    next.content = next.content.map((child) => assignJsonBlockIds(child, existingBlockIds));
  }
  return next;
}

function findBlockPosition(doc: ProseMirrorNode, blockId: string): { pos: number; node: ProseMirrorNode } | null {
  let match: { pos: number; node: ProseMirrorNode } | null = null;
  doc.descendants((node, pos) => {
    if (node.attrs?.blockId === blockId) {
      match = { pos, node };
      return false;
    }
    return undefined;
  });
  return match as { pos: number; node: ProseMirrorNode } | null;
}

function applyCanvasOperations(editor: Editor, operations: CanvasOperation[]) {
  let tr = editor.state.tr;
  for (const operation of operations) {
    if (operation.op === 'insert_after' && operation.targetBlockId === null) {
      const existingBlockIds = collectDocumentBlockIds(tr.doc);
      const node = editor.schema.nodeFromJSON(assignJsonBlockIds(operation.node, existingBlockIds));
      tr = tr.insert(tr.doc.content.size, node);
      continue;
    }

    const targetBlockId = operation.targetBlockId;
    if (!targetBlockId) return false;
    const target = findBlockPosition(tr.doc, targetBlockId);
    if (!target) return false;

    if (operation.op === 'delete') {
      tr = tr.delete(target.pos, target.pos + target.node.nodeSize);
      continue;
    }

    const existingBlockIds = collectDocumentBlockIds(tr.doc);
    if (operation.op === 'replace') {
      removeTargetBlockIds(existingBlockIds, target.node);
    }
    const node = editor.schema.nodeFromJSON(assignJsonBlockIds(operation.node, existingBlockIds));
    if (operation.op === 'replace') {
      tr = tr.replaceWith(target.pos, target.pos + target.node.nodeSize, node);
    } else if (operation.op === 'insert_before') {
      tr = tr.insert(target.pos, node);
    } else if (operation.op === 'insert_after') {
      tr = tr.insert(target.pos + target.node.nodeSize, node);
    }
  }
  if (!tr.docChanged) return false;
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

function readEditorChange(editor: Editor): AiCanvasEditorChange {
  return {
    documentJson: normalizeAiCanvasDocumentJson(editor.getJSON()),
    markdown: getEditorMarkdown(editor),
  };
}

function isEmptyAiCanvasDocument(documentJson: AiCanvasDocumentJson) {
  return stringifyAiCanvasDocument(documentJson) === stringifyAiCanvasDocument(EMPTY_AI_CANVAS_DOCUMENT);
}

export default function AiCanvasMarkdownEditor({
  documentJson,
  fallbackMarkdown,
  editable,
  placeholder,
  pendingOperations,
  onChangeDocument,
  onFocusEditor,
  onApplyOperationsResult,
}: AiCanvasMarkdownEditorProps) {
  const applyingExternalUpdateRef = React.useRef(false);
  const lastDocumentStringRef = React.useRef(stringifyAiCanvasDocument(documentJson));
  const lastMarkdownRef = React.useRef(fallbackMarkdown ?? '');
  const appliedOperationRequestIdRef = React.useRef<number | null>(null);
  const onChangeDocumentRef = React.useRef(onChangeDocument);
  const onApplyOperationsResultRef = React.useRef(onApplyOperationsResult);
  const editorExtensions = React.useMemo(() => createEditorExtensions(), []);
  const [editorEmpty, setEditorEmpty] = React.useState(isMeaningfullyEmptyMarkdown(fallbackMarkdown ?? ''));

  React.useEffect(() => {
    onChangeDocumentRef.current = onChangeDocument;
  }, [onChangeDocument]);

  React.useEffect(() => {
    onApplyOperationsResultRef.current = onApplyOperationsResult;
  }, [onApplyOperationsResult]);

  const initialDocument = React.useMemo(() => normalizeAiCanvasDocumentJson(documentJson ?? EMPTY_AI_CANVAS_DOCUMENT), []);
  const initialUsesMarkdown = isEmptyAiCanvasDocument(initialDocument) && !isMeaningfullyEmptyMarkdown(fallbackMarkdown);
  const editor = useEditor({
    extensions: editorExtensions,
    content: (initialUsesMarkdown ? fallbackMarkdown ?? '' : initialDocument) as any,
    contentType: initialUsesMarkdown ? 'markdown' : undefined,
    editable,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        class: 'ai-canvas-prosemirror',
      },
      handleDOMEvents: {
        focus: () => {
          void onFocusEditor();
          return false;
        },
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (applyingExternalUpdateRef.current) return;
      if (ensureEditorBlockIds(currentEditor)) return;
      const nextChange = readEditorChange(currentEditor);
      const nextDocumentString = stringifyAiCanvasDocument(nextChange.documentJson);
      if (nextDocumentString === lastDocumentStringRef.current && nextChange.markdown === lastMarkdownRef.current) {
        setEditorEmpty(isMeaningfullyEmptyMarkdown(nextChange.markdown));
        return;
      }
      lastDocumentStringRef.current = nextDocumentString;
      lastMarkdownRef.current = nextChange.markdown;
      setEditorEmpty(isMeaningfullyEmptyMarkdown(nextChange.markdown));
      void onChangeDocumentRef.current(nextChange);
    },
  });

  React.useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  React.useEffect(() => {
    if (!editor) return;
    if (ensureEditorBlockIds(editor)) return;
    const nextChange = readEditorChange(editor);
    lastDocumentStringRef.current = stringifyAiCanvasDocument(nextChange.documentJson);
    lastMarkdownRef.current = nextChange.markdown;
    setEditorEmpty(isMeaningfullyEmptyMarkdown(nextChange.markdown));
    if (
      stringifyAiCanvasDocument(nextChange.documentJson) !== stringifyAiCanvasDocument(documentJson)
      || nextChange.markdown !== (fallbackMarkdown ?? '')
    ) {
      void onChangeDocumentRef.current(nextChange);
    }
  }, [editor]);

  React.useEffect(() => {
    if (!editor) return;
    const nextDocument = normalizeAiCanvasDocumentJson(documentJson);
    const nextDocumentString = stringifyAiCanvasDocument(nextDocument);
    const shouldUseMarkdown = isEmptyAiCanvasDocument(nextDocument) && !isMeaningfullyEmptyMarkdown(fallbackMarkdown);
    if (nextDocumentString === lastDocumentStringRef.current && (!shouldUseMarkdown || fallbackMarkdown === lastMarkdownRef.current)) return;

    applyingExternalUpdateRef.current = true;
    editor.commands.setContent((shouldUseMarkdown ? fallbackMarkdown ?? '' : nextDocument) as any, {
      contentType: shouldUseMarkdown ? 'markdown' : undefined,
      emitUpdate: false,
    });
    ensureEditorBlockIds(editor);
    const nextChange = readEditorChange(editor);
    lastDocumentStringRef.current = stringifyAiCanvasDocument(nextChange.documentJson);
    lastMarkdownRef.current = nextChange.markdown;
    setEditorEmpty(isMeaningfullyEmptyMarkdown(nextChange.markdown));
    applyingExternalUpdateRef.current = false;
  }, [documentJson, editor, fallbackMarkdown]);

  React.useEffect(() => {
    if (!editor || !pendingOperations) return;
    if (appliedOperationRequestIdRef.current === pendingOperations.id) return;
    appliedOperationRequestIdRef.current = pendingOperations.id;
    try {
      const applied = applyCanvasOperations(editor, pendingOperations.operations);
      void onApplyOperationsResultRef.current?.(pendingOperations.id, applied);
    } catch {
      void onApplyOperationsResultRef.current?.(pendingOperations.id, false);
    }
  }, [editor, pendingOperations]);

  return (
    <div className={`ai-canvas-editor-root ${editable ? 'is-editable' : 'is-readonly'}`}>
      <style>{`
        html,
        body,
        #root {
          height: 100%;
          margin: 0;
          background: transparent;
          overflow: hidden;
          overscroll-behavior: contain;
          -webkit-text-size-adjust: 100%;
        }

        * {
          box-sizing: border-box;
        }

        .ai-canvas-editor-root {
          position: relative;
          height: 100%;
          width: 100%;
          min-height: 0;
          overflow: auto;
          background: #ffffff;
          color: #263144;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          -webkit-overflow-scrolling: touch;
        }

        .ai-canvas-editor-root.is-readonly {
          cursor: default;
        }

        .ai-canvas-prosemirror {
          min-height: 100%;
          padding: 3px 13px 64px;
          outline: none;
          font-size: 13px;
          line-height: 20px;
          font-weight: 700;
          letter-spacing: 0;
          white-space: pre-wrap;
          word-break: break-word;
        }

        .ai-canvas-prosemirror > *:first-child {
          margin-top: 0;
        }

        .ai-canvas-prosemirror > *:last-child {
          margin-bottom: 0;
        }

        .ai-canvas-prosemirror p {
          margin: 0 0 8px;
        }

        .ai-canvas-prosemirror h1 {
          margin: 0 0 12px;
          font-size: 22px;
          line-height: 29px;
          font-weight: 900;
          color: #1f2937;
        }

        .ai-canvas-prosemirror h2 {
          margin: 14px 0 8px;
          font-size: 18px;
          line-height: 25px;
          font-weight: 900;
          color: #263144;
        }

        .ai-canvas-prosemirror h3 {
          margin: 12px 0 7px;
          font-size: 15px;
          line-height: 22px;
          font-weight: 900;
          color: #31405b;
        }

        .ai-canvas-prosemirror ul,
        .ai-canvas-prosemirror ol {
          margin: 0 0 8px;
          padding-left: 26px;
        }

        .ai-canvas-prosemirror li {
          margin: 2px 0;
          padding-left: 2px;
        }

        .ai-canvas-prosemirror li > p {
          margin: 0;
        }

        .ai-canvas-prosemirror hr {
          border: 0;
          border-top: 1px solid #dfe6f1;
          margin: 16px 0;
        }

        .ai-canvas-prosemirror pre {
          margin: 10px 0;
          padding: 11px 12px;
          border-radius: 10px;
          background: #111827;
          color: #f8fafc;
          overflow-x: auto;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 12px;
          line-height: 18px;
          font-weight: 600;
        }

        .ai-canvas-prosemirror code {
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        }

        .ai-canvas-prosemirror s {
          color: #7a8394;
        }

        .ai-canvas-placeholder {
          position: absolute;
          top: 3px;
          left: 13px;
          right: 13px;
          color: #a2aab8;
          pointer-events: none;
          font-size: 13px;
          line-height: 20px;
          font-weight: 700;
        }
      `}</style>
      {editorEmpty ? <div className="ai-canvas-placeholder">{placeholder}</div> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
