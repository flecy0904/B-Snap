'use dom';

import React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Markdown } from '@tiptap/markdown';
import { Strike } from '@tiptap/extension-strike';
import { Extension, nodeInputRule, renderNestedMarkdownContent, textblockTypeInputRule, type Editor, wrappingInputRule } from '@tiptap/core';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import { Bold } from '@tiptap/extension-bold';
import { BulletList, ListItem, ListKeymap, OrderedList } from '@tiptap/extension-list';
import { Code } from '@tiptap/extension-code';
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
  canUndoShortcut?: boolean;
  canRedoShortcut?: boolean;
  onUndoShortcut?: () => void;
  onRedoShortcut?: () => void;
  onApplyOperationsResult?: (requestId: number, applied: boolean) => Promise<void>;
  dom?: import('expo/dom').DOMProps;
};

const BLOCK_NODE_TYPES = ['paragraph', 'heading', 'codeBlock', 'horizontalRule', 'bulletList', 'orderedList', 'listItem'];
const BLOCK_NODE_TYPE_SET = new Set(BLOCK_NODE_TYPES);
const EMPTY_TEXTBLOCK_TYPES = new Set(['paragraph', 'heading', 'codeBlock']);
const MIN_INDENT_LEVEL = 0;
const MAX_INDENT_LEVEL = 6;
const AI_CANVAS_BULLET_LIST_INPUT_REGEX = /^\s*([-*])\s$/;
const AI_CANVAS_ORDERED_LIST_INPUT_REGEX = /^(\d+)\.\s$/;
const AI_CANVAS_CODE_BLOCK_INPUT_REGEX = /^```([a-z]+)?[\s\n]$/;
const INLINE_TAB = '\t';

function normalizeIndentLevel(value: unknown) {
  const numeric = typeof value === 'number' || typeof value === 'string' ? Number(value) : 0;
  if (!Number.isFinite(numeric)) return MIN_INDENT_LEVEL;
  return Math.min(MAX_INDENT_LEVEL, Math.max(MIN_INDENT_LEVEL, Math.trunc(numeric)));
}

function buildNodeAttrsWithIndent(attrs: Record<string, unknown>, indentLevel: number) {
  const nextAttrs = { ...attrs };
  const normalizedIndentLevel = normalizeIndentLevel(indentLevel);

  if (normalizedIndentLevel > 0) {
    nextAttrs.indentLevel = normalizedIndentLevel;
  } else {
    delete nextAttrs.indentLevel;
  }

  return nextAttrs;
}

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

function getActiveListItemInfo(editor: Editor) {
  const { selection } = editor.state;
  const { $from } = selection;
  let listItemDepth: number | null = null;
  let listDepth = 0;

  for (let depth = 1; depth <= $from.depth; depth += 1) {
    if ($from.node(depth).type.name === 'listItem') {
      listDepth += 1;
      listItemDepth = depth;
    }
  }

  if (listItemDepth === null || !$from.parent.isTextblock) return null;

  return {
    listItemPos: $from.before(listItemDepth),
    listItemNode: $from.node(listItemDepth),
    parentListPos: $from.before(listItemDepth - 1),
    parentListNode: $from.node(listItemDepth - 1),
    listItemIndex: $from.index(listItemDepth - 1),
    listDepth,
    isPrimaryTextblock: $from.index(listItemDepth) === 0,
    parentListType: $from.node(listItemDepth - 1).type.name,
    isMarkerless: $from.node(listItemDepth).attrs.markerless === true,
    isCursorSelection: selection.from === selection.to,
    isAtTextblockStart: selection.from === selection.to && $from.parentOffset === 0,
    isTextblockEmpty: $from.parent.content.size === 0,
  };
}

function getActiveTextblockInfo(editor: Editor) {
  const { selection } = editor.state;
  if (selection.from !== selection.to) return null;

  const { $from } = selection;
  if (!$from.parent.isTextblock) return null;

  return {
    node: $from.parent,
    pos: $from.before($from.depth),
    typeName: $from.parent.type.name,
    isAtStart: $from.parentOffset === 0,
    parentOffset: $from.parentOffset,
  };
}

function getActiveParagraphIndentLevel(editor: Editor) {
  const textblock = getActiveTextblockInfo(editor);
  if (!textblock || textblock.typeName !== 'paragraph') return MIN_INDENT_LEVEL;
  return normalizeIndentLevel(textblock.node.attrs.indentLevel);
}

function getListInputRuleAttributes(editor: Editor) {
  const listItem = getActiveListItemInfo(editor);
  if (listItem && !listItem.isPrimaryTextblock) return {};
  return buildNodeAttrsWithIndent({}, getActiveParagraphIndentLevel(editor));
}

function buildNodeAttrsWithMarkerless(attrs: Record<string, unknown>, markerless: boolean) {
  const nextAttrs = { ...attrs };
  if (markerless) {
    nextAttrs.markerless = true;
  } else {
    delete nextAttrs.markerless;
  }
  return nextAttrs;
}

function getNodeChildren(node: ProseMirrorNode) {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => {
    children.push(child);
  });
  return children;
}

function liftActiveListItem(editor: Editor) {
  return editor.commands.liftListItem('listItem');
}

function splitActiveListItem(editor: Editor) {
  return editor.commands.splitListItem('listItem');
}

function setActiveParagraphIndentLevel(editor: Editor, indentLevel: number) {
  const textblock = getActiveTextblockInfo(editor);
  if (!textblock || textblock.typeName !== 'paragraph') return false;

  const nextAttrs = buildNodeAttrsWithIndent(textblock.node.attrs, indentLevel);
  editor.view.dispatch(
    editor.state.tr
      .setNodeMarkup(textblock.pos, undefined, nextAttrs)
      .scrollIntoView(),
  );
  return true;
}

function adjustActiveParagraphIndentLevel(editor: Editor, delta: number) {
  const textblock = getActiveTextblockInfo(editor);
  if (!textblock || textblock.typeName !== 'paragraph' || !textblock.isAtStart) return false;

  const currentIndentLevel = normalizeIndentLevel(textblock.node.attrs.indentLevel);
  const nextIndentLevel = normalizeIndentLevel(currentIndentLevel + delta);
  if (nextIndentLevel === currentIndentLevel) return true;

  return setActiveParagraphIndentLevel(editor, nextIndentLevel);
}

function removeActiveListMarkerPreservingIndent(editor: Editor) {
  const listItem = getActiveListItemInfo(editor);
  if (!listItem?.isAtTextblockStart || !listItem.isPrimaryTextblock) return false;

  if (listItem.isMarkerless) return liftActiveMarkerlessListItem(editor);
  return setActiveListItemMarkerless(editor, true);
}

function liftActiveMarkerlessListItem(editor: Editor) {
  const listItem = getActiveListItemInfo(editor);
  if (!listItem?.isMarkerless || !listItem.isAtTextblockStart || !listItem.isPrimaryTextblock) return false;
  if (listItem.listDepth <= 1) return true;

  const lifted = liftActiveListItem(editor);
  if (!lifted) return true;

  const liftedListItem = getActiveListItemInfo(editor);
  if (liftedListItem && !liftedListItem.isMarkerless) {
    setActiveListItemMarkerless(editor, true);
  }
  return true;
}

function setActiveListItemMarkerless(editor: Editor, markerless: boolean) {
  const listItem = getActiveListItemInfo(editor);
  if (!listItem?.isPrimaryTextblock) return false;

  const { state, view } = editor;
  const nextAttrs = buildNodeAttrsWithMarkerless(listItem.listItemNode.attrs, markerless);
  const tr = state.tr.setNodeMarkup(listItem.listItemPos, undefined, nextAttrs);
  tr.setSelection(TextSelection.create(tr.doc, Math.min(state.selection.from, tr.doc.content.size)));
  view.dispatch(tr.scrollIntoView());
  return true;
}

function restoreActiveMarkerlessListItem(editor: Editor, listTypeName: 'bulletList' | 'orderedList', markerText: string, orderedStart?: number) {
  const listItem = getActiveListItemInfo(editor);
  const textblock = getActiveTextblockInfo(editor);
  if (!listItem?.isMarkerless || !listItem.isPrimaryTextblock || !textblock || textblock.typeName !== 'paragraph') return false;
  if (!listItem.isCursorSelection || textblock.parentOffset !== markerText.length) return false;
  if (textblock.node.textBetween(0, textblock.parentOffset, '\n', '\n') !== markerText) return false;

  const { state, view } = editor;
  const listType = state.schema.nodes[listTypeName];
  if (!listType) return false;

  if (listItem.parentListType !== listTypeName) {
    return restoreActiveMarkerlessListItemAsSeparateList(editor, listTypeName, markerText, orderedStart);
  }

  let tr = state.tr;
  tr = tr.setNodeMarkup(
    listItem.listItemPos,
    undefined,
    buildNodeAttrsWithMarkerless(listItem.listItemNode.attrs, false),
  );
  const markerStart = state.selection.from - markerText.length;
  tr = tr.delete(markerStart, state.selection.from);
  tr.setSelection(TextSelection.create(tr.doc, markerStart));
  view.dispatch(tr.scrollIntoView());
  return true;
}

function createListWithItems(
  editor: Editor,
  sourceList: ProseMirrorNode,
  listTypeName: 'bulletList' | 'orderedList',
  items: ProseMirrorNode[],
  options: { preserveBlockId: boolean; orderedStart?: number },
) {
  if (items.length === 0) return null;

  const listType = editor.schema.nodes[listTypeName];
  if (!listType) return null;

  const attrs = { ...sourceList.attrs };
  if (!options.preserveBlockId) delete attrs.blockId;
  if (listTypeName === 'orderedList') {
    attrs.start = options.orderedStart ?? attrs.start ?? 1;
  } else {
    delete attrs.start;
  }

  return listType.create(attrs, Fragment.fromArray(items));
}

function restoreActiveMarkerlessListItemAsSeparateList(
  editor: Editor,
  listTypeName: 'bulletList' | 'orderedList',
  markerText: string,
  orderedStart?: number,
) {
  const listItem = getActiveListItemInfo(editor);
  const textblock = getActiveTextblockInfo(editor);
  if (!listItem?.isMarkerless || !textblock || textblock.typeName !== 'paragraph') return false;

  const parentListItems = getNodeChildren(listItem.parentListNode);
  const currentListItem = parentListItems[listItem.listItemIndex];
  if (!currentListItem || currentListItem.type.name !== 'listItem') return false;

  const currentChildren = getNodeChildren(currentListItem);
  const currentParagraph = currentChildren[0];
  if (!currentParagraph || currentParagraph.type.name !== 'paragraph') return false;

  const restoredParagraph = currentParagraph.type.create(
    currentParagraph.attrs,
    currentParagraph.content.cut(markerText.length),
    currentParagraph.marks,
  );
  const restoredListItem = currentListItem.type.create(
    buildNodeAttrsWithMarkerless(currentListItem.attrs, false),
    Fragment.fromArray([restoredParagraph, ...currentChildren.slice(1)]),
    currentListItem.marks,
  );

  const beforeItems = parentListItems.slice(0, listItem.listItemIndex);
  const afterItems = parentListItems.slice(listItem.listItemIndex + 1);
  const parentOrderedStart = Number(listItem.parentListNode.attrs.start) || 1;
  const replacementLists = [
    createListWithItems(editor, listItem.parentListNode, listItem.parentListType as 'bulletList' | 'orderedList', beforeItems, {
      preserveBlockId: beforeItems.length > 0,
    }),
    createListWithItems(editor, listItem.parentListNode, listTypeName, [restoredListItem], {
      preserveBlockId: beforeItems.length === 0 && afterItems.length === 0,
      orderedStart,
    }),
    createListWithItems(editor, listItem.parentListNode, listItem.parentListType as 'bulletList' | 'orderedList', afterItems, {
      preserveBlockId: beforeItems.length === 0,
      orderedStart: listItem.parentListType === 'orderedList' ? parentOrderedStart + listItem.listItemIndex + 1 : undefined,
    }),
  ].filter((node): node is ProseMirrorNode => Boolean(node));

  if (replacementLists.length === 0) return false;

  const { state, view } = editor;
  const restoredBlockId = typeof restoredListItem.attrs.blockId === 'string' ? restoredListItem.attrs.blockId : null;
  const tr = state.tr.replaceWith(
    listItem.parentListPos,
    listItem.parentListPos + listItem.parentListNode.nodeSize,
    Fragment.fromArray(replacementLists),
  );

  let selectionPos: number | null = null;
  if (restoredBlockId) {
    tr.doc.descendants((node, pos) => {
      if (node.type.name !== 'listItem' || node.attrs.blockId !== restoredBlockId) return undefined;
      const firstChild = node.firstChild;
      if (firstChild?.type.name === 'paragraph') {
        selectionPos = pos + 2;
      }
      return false;
    });
  }

  tr.setSelection(TextSelection.create(tr.doc, selectionPos ?? Math.min(state.selection.from - markerText.length, tr.doc.content.size)));
  view.dispatch(tr.scrollIntoView());
  return true;
}

function insertInlineTab(editor: Editor) {
  const { state, view } = editor;
  view.dispatch(state.tr.insertText(INLINE_TAB, state.selection.from, state.selection.to).scrollIntoView());
  return true;
}

function removeInlineTabBeforeCursor(editor: Editor) {
  const { state, view } = editor;
  const { selection } = state;
  if (selection.from !== selection.to) return false;

  const { $from } = selection;
  const start = $from.start();
  if (selection.from - start < INLINE_TAB.length) return false;
  if (state.doc.textBetween(selection.from - INLINE_TAB.length, selection.from, '\n', '\n') !== INLINE_TAB) return false;

  view.dispatch(state.tr.delete(selection.from - INLINE_TAB.length, selection.from).scrollIntoView());
  return true;
}

function isHorizontalRuleSelection(editor: Editor) {
  const { selection } = editor.state;
  return selection instanceof NodeSelection && selection.node.type.name === 'horizontalRule';
}

function deleteSelectedHorizontalRule(editor: Editor) {
  if (!isHorizontalRuleSelection(editor)) return false;

  const { state, view } = editor;
  const { selection } = state;
  let tr = state.tr.delete(selection.from, selection.to);

  if (tr.doc.childCount === 0) {
    const paragraph = state.schema.nodes.paragraph?.create();
    if (paragraph) {
      tr = tr.insert(0, paragraph);
      tr = tr.setSelection(TextSelection.create(tr.doc, 1));
    }
  } else {
    const nextPos = Math.min(selection.from, tr.doc.content.size);
    tr = tr.setSelection(Selection.near(tr.doc.resolve(nextPos), -1));
  }

  view.dispatch(tr.scrollIntoView());
  return true;
}

const AiCanvasEditingKeymap = Extension.create({
  name: 'aiCanvasEditingKeymap',
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      Space: () => {
        const textblock = getActiveTextblockInfo(this.editor);
        if (!textblock || textblock.typeName !== 'paragraph') return false;
        const textBeforeCursor = textblock.node.textBetween(0, textblock.parentOffset, '\n', '\n');
        if (textBeforeCursor === '-' || textBeforeCursor === '*') {
          return restoreActiveMarkerlessListItem(this.editor, 'bulletList', textBeforeCursor);
        }
        const orderedMatch = textBeforeCursor.match(/^(\d+)\.$/);
        if (orderedMatch) {
          return restoreActiveMarkerlessListItem(this.editor, 'orderedList', orderedMatch[0], Number(orderedMatch[1]));
        }
        return false;
      },
      Enter: () => {
        const listItem = getActiveListItemInfo(this.editor);
        if (!listItem) return false;
        if (!listItem.isPrimaryTextblock) return false;
        if (!listItem.isCursorSelection) return false;
        if (listItem.isTextblockEmpty) return liftActiveListItem(this.editor);
        return splitActiveListItem(this.editor);
      },
      Backspace: () => {
        if (deleteSelectedHorizontalRule(this.editor)) return true;
        const listItem = getActiveListItemInfo(this.editor);
        if (listItem?.isAtTextblockStart && listItem.isPrimaryTextblock) return removeActiveListMarkerPreservingIndent(this.editor);

        const textblock = getActiveTextblockInfo(this.editor);
        if (!listItem && textblock?.typeName === 'paragraph' && textblock.isAtStart && normalizeIndentLevel(textblock.node.attrs.indentLevel) > 0) {
          return adjustActiveParagraphIndentLevel(this.editor, -1);
        }

        return false;
      },
      Delete: () => deleteSelectedHorizontalRule(this.editor),
      Tab: () => {
        const listItem = getActiveListItemInfo(this.editor);
        if (listItem?.isAtTextblockStart && listItem.isPrimaryTextblock) return this.editor.commands.sinkListItem('listItem') || true;

        const textblock = getActiveTextblockInfo(this.editor);
        if (!listItem && textblock?.typeName === 'paragraph' && textblock.isAtStart) {
          return adjustActiveParagraphIndentLevel(this.editor, 1);
        }

        return insertInlineTab(this.editor);
      },
      'Shift-Tab': () => {
        const listItem = getActiveListItemInfo(this.editor);
        if (listItem?.isAtTextblockStart && listItem.isPrimaryTextblock) return liftActiveListItem(this.editor) || true;

        const textblock = getActiveTextblockInfo(this.editor);
        if (!listItem && textblock?.typeName === 'paragraph' && textblock.isAtStart) {
          return adjustActiveParagraphIndentLevel(this.editor, -1);
        }

        return removeInlineTabBeforeCursor(this.editor);
      },
      'Shift-Enter': () => this.editor.commands.setHardBreak(),
    };
  },
});

const AiCanvasParagraph = Paragraph.extend({
  addAttributes() {
    return {
      indentLevel: {
        default: null,
        parseHTML: (element) => {
          const indentLevel = normalizeIndentLevel(element.getAttribute('data-indent-level'));
          return indentLevel > 0 ? indentLevel : null;
        },
        renderHTML: (attributes) => {
          const indentLevel = normalizeIndentLevel(attributes.indentLevel);
          return indentLevel > 0 ? { 'data-indent-level': String(indentLevel) } : {};
        },
      },
    };
  },
});

const AiCanvasListIndent = Extension.create({
  name: 'aiCanvasListIndent',

  addGlobalAttributes() {
    return [
      {
        types: ['bulletList', 'orderedList'],
        attributes: {
          indentLevel: {
            default: null,
            parseHTML: (element) => {
              const indentLevel = normalizeIndentLevel(element.getAttribute('data-indent-level'));
              return indentLevel > 0 ? indentLevel : null;
            },
            renderHTML: (attributes) => {
              const indentLevel = normalizeIndentLevel(attributes.indentLevel);
              return indentLevel > 0 ? { 'data-indent-level': String(indentLevel) } : {};
            },
          },
        },
      },
    ];
  },
});

const AiCanvasListItem = ListItem.extend({
  addAttributes() {
    return {
      markerless: {
        default: null,
        parseHTML: (element) => (element.getAttribute('data-markerless') === 'true' ? true : null),
        renderHTML: (attributes) => (attributes.markerless === true ? { 'data-markerless': 'true' } : {}),
      },
    };
  },

  renderMarkdown: (node, h, ctx) => (
    renderNestedMarkdownContent(
      node,
      h,
      (context: any) => {
        if (node.attrs?.markerless === true) return '';
        if (context.parentType === 'orderedList') {
          const start = context.meta?.parentAttrs?.start || 1;
          return `${start + context.index}. `;
        }
        return '- ';
      },
      ctx,
    )
  ),
});

const AiCanvasBulletList = BulletList.extend({
  addInputRules() {
    return [
      wrappingInputRule({
        find: AI_CANVAS_BULLET_LIST_INPUT_REGEX,
        type: this.type,
        keepMarks: this.options.keepMarks,
        keepAttributes: this.options.keepAttributes,
        getAttributes: () => getListInputRuleAttributes(this.editor),
        editor: this.editor,
      }),
    ];
  },
});

const AiCanvasOrderedList = OrderedList.extend({
  addInputRules() {
    return [
      wrappingInputRule({
        find: AI_CANVAS_ORDERED_LIST_INPUT_REGEX,
        type: this.type,
        getAttributes: (match) => ({
          ...getListInputRuleAttributes(this.editor),
          start: Number(match[1]),
        }),
        joinPredicate: (match, node) => (
          normalizeIndentLevel(node.attrs.indentLevel) === getActiveParagraphIndentLevel(this.editor)
          && node.childCount + node.attrs.start === Number(match[1])
        ),
      }),
    ];
  },
});

const AiCanvasHorizontalRule = HorizontalRule.extend({
  addInputRules() {
    return [
      nodeInputRule({
        find: /^---$/,
        type: this.type,
      }),
    ];
  },
});

const AiCanvasCodeBlock = CodeBlock.extend({
  addInputRules() {
    return [
      textblockTypeInputRule({
        find: AI_CANVAS_CODE_BLOCK_INPUT_REGEX,
        type: this.type,
        getAttributes: (match) => ({
          language: match[1],
        }),
      }),
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
    AiCanvasListIndent,
    AiCanvasEditingKeymap,
    Document,
    AiCanvasParagraph,
    Text,
    Bold,
    Italic,
    Code,
    Heading.configure({
      levels: [1, 2, 3],
    }),
    AiCanvasBulletList,
    AiCanvasOrderedList.configure({
      HTMLAttributes: {
        class: 'ai-canvas-ordered-list',
      },
    }),
    AiCanvasListItem,
    ListKeymap,
    AiCanvasHorizontalRule,
    AiCanvasCodeBlock,
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
    return node.content.size === 0 && EMPTY_TEXTBLOCK_TYPES.has(node.type.name);
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

function shouldShowEditorPlaceholder(editor: Editor) {
  const doc = editor.state.doc;
  if (doc.textContent.replace(/&nbsp;/g, '').replace(/\u00A0/g, '').trim().length > 0) return false;
  if (doc.childCount === 0) return true;
  if (doc.childCount !== 1) return false;

  const onlyChild = doc.child(0);
  return onlyChild.type.name === 'paragraph' && onlyChild.content.size === 0;
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

function sanitizeEditorJsonNode(node: TiptapJsonNode, parentType?: string): TiptapJsonNode {
  const nextNode: TiptapJsonNode = { ...node };

  if (nextNode.attrs) {
    const attrs = { ...nextNode.attrs };
    const isListItemParagraph = nextNode.type === 'paragraph' && parentType === 'listItem';
    const isNestedList = (nextNode.type === 'bulletList' || nextNode.type === 'orderedList') && parentType === 'listItem';
    if (['paragraph', 'bulletList', 'orderedList'].includes(nextNode.type) && !isListItemParagraph && !isNestedList) {
      const indentLevel = normalizeIndentLevel(attrs.indentLevel);
      if (indentLevel > 0) {
        attrs.indentLevel = indentLevel;
      } else {
        delete attrs.indentLevel;
      }
    } else {
      delete attrs.indentLevel;
    }

    if (nextNode.type === 'listItem') {
      if (attrs.markerless === true) {
        attrs.markerless = true;
      } else {
        delete attrs.markerless;
      }
    } else {
      delete attrs.markerless;
    }

    if (Object.keys(attrs).length > 0) {
      nextNode.attrs = attrs;
    } else {
      delete nextNode.attrs;
    }
  }

  if (Array.isArray(nextNode.content)) {
    nextNode.content = nextNode.content.map((child) => sanitizeEditorJsonNode(child, nextNode.type));
  }

  return nextNode;
}

function getEditorDocumentJson(editor: Editor) {
  const documentJson = normalizeAiCanvasDocumentJson(editor.getJSON());
  return {
    type: 'doc',
    content: Array.isArray(documentJson.content)
      ? documentJson.content.map((node) => sanitizeEditorJsonNode(node, 'doc'))
      : [],
  } satisfies AiCanvasDocumentJson;
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
    documentJson: getEditorDocumentJson(editor),
    markdown: getEditorMarkdown(editor),
  };
}

function isEmptyAiCanvasDocument(documentJson: AiCanvasDocumentJson) {
  return stringifyAiCanvasDocument(documentJson) === stringifyAiCanvasDocument(EMPTY_AI_CANVAS_DOCUMENT);
}

function shouldShowInitialPlaceholder(documentJson: AiCanvasDocumentJson, fallbackMarkdown: string | undefined) {
  return isEmptyAiCanvasDocument(normalizeAiCanvasDocumentJson(documentJson)) && isMeaningfullyEmptyMarkdown(fallbackMarkdown ?? '');
}

function syncEditorEmptyState(editor: Editor, setEditorEmpty: React.Dispatch<React.SetStateAction<boolean>>) {
  setEditorEmpty(shouldShowEditorPlaceholder(editor));
}

function getEditorHistoryShortcut(event: KeyboardEvent): 'undo' | 'redo' | null {
  if (!event.ctrlKey && !event.metaKey) return null;
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'y' && !event.shiftKey) return 'redo';
  if (key !== 'z') return null;
  return event.shiftKey ? 'redo' : 'undo';
}

export default function AiCanvasMarkdownEditor({
  documentJson,
  fallbackMarkdown,
  editable,
  placeholder,
  pendingOperations,
  onChangeDocument,
  onFocusEditor,
  canUndoShortcut,
  canRedoShortcut,
  onUndoShortcut,
  onRedoShortcut,
  onApplyOperationsResult,
}: AiCanvasMarkdownEditorProps) {
  const applyingExternalUpdateRef = React.useRef(false);
  const lastDocumentStringRef = React.useRef(stringifyAiCanvasDocument(documentJson));
  const lastMarkdownRef = React.useRef(fallbackMarkdown ?? '');
  const appliedOperationRequestIdRef = React.useRef<number | null>(null);
  const onChangeDocumentRef = React.useRef(onChangeDocument);
  const onApplyOperationsResultRef = React.useRef(onApplyOperationsResult);
  const shortcutRef = React.useRef({
    canUndoShortcut,
    canRedoShortcut,
    onUndoShortcut,
    onRedoShortcut,
  });
  const editorExtensions = React.useMemo(() => createEditorExtensions(), []);
  const [editorEmpty, setEditorEmpty] = React.useState(() => shouldShowInitialPlaceholder(documentJson, fallbackMarkdown));

  React.useEffect(() => {
    onChangeDocumentRef.current = onChangeDocument;
  }, [onChangeDocument]);

  React.useEffect(() => {
    onApplyOperationsResultRef.current = onApplyOperationsResult;
  }, [onApplyOperationsResult]);

  React.useEffect(() => {
    shortcutRef.current = {
      canUndoShortcut,
      canRedoShortcut,
      onUndoShortcut,
      onRedoShortcut,
    };
  }, [canRedoShortcut, canUndoShortcut, onRedoShortcut, onUndoShortcut]);

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
      handleClickOn: (view, pos, node) => {
        if (node.type.name !== 'horizontalRule') return false;
        view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
        return true;
      },
      handleDOMEvents: {
        focus: () => {
          void onFocusEditor();
          return false;
        },
        keydown: (_view, event) => {
          const shortcut = getEditorHistoryShortcut(event);
          if (!shortcut) return false;
          const shortcutState = shortcutRef.current;
          const canRun = shortcut === 'undo' ? shortcutState.canUndoShortcut : shortcutState.canRedoShortcut;
          const runShortcut = shortcut === 'undo' ? shortcutState.onUndoShortcut : shortcutState.onRedoShortcut;
          if (!canRun || !runShortcut) return false;
          event.preventDefault();
          event.stopPropagation();
          runShortcut();
          return true;
        },
      },
    },
    onUpdate: ({ editor: currentEditor }) => {
      if (applyingExternalUpdateRef.current) return;
      if (ensureEditorBlockIds(currentEditor)) return;
      const nextChange = readEditorChange(currentEditor);
      const nextDocumentString = stringifyAiCanvasDocument(nextChange.documentJson);
      if (nextDocumentString === lastDocumentStringRef.current && nextChange.markdown === lastMarkdownRef.current) {
        syncEditorEmptyState(currentEditor, setEditorEmpty);
        return;
      }
      lastDocumentStringRef.current = nextDocumentString;
      lastMarkdownRef.current = nextChange.markdown;
      syncEditorEmptyState(currentEditor, setEditorEmpty);
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
    syncEditorEmptyState(editor, setEditorEmpty);
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
    try {
      editor.commands.setContent((shouldUseMarkdown ? fallbackMarkdown ?? '' : nextDocument) as any, {
        contentType: shouldUseMarkdown ? 'markdown' : undefined,
        emitUpdate: false,
      });
      ensureEditorBlockIds(editor);
      const nextChange = readEditorChange(editor);
      lastDocumentStringRef.current = stringifyAiCanvasDocument(nextChange.documentJson);
      lastMarkdownRef.current = nextChange.markdown;
      syncEditorEmptyState(editor, setEditorEmpty);
    } finally {
      applyingExternalUpdateRef.current = false;
    }
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
          font-size: 14px;
          line-height: 21px;
          font-weight: 400;
          letter-spacing: 0;
          white-space: pre-wrap;
          word-break: break-word;
          tab-size: 3;
        }

        .ai-canvas-prosemirror > *:first-child {
          margin-top: 0;
        }

        .ai-canvas-prosemirror > *:last-child {
          margin-bottom: 0;
        }

        .ai-canvas-prosemirror p {
          margin: 0 0 10px;
          font-family: inherit;
          font-size: 14px;
          line-height: 21px;
          font-weight: 400;
        }

        .ai-canvas-prosemirror > p[data-indent-level="1"] {
          margin-left: 25px;
        }

        .ai-canvas-prosemirror > p[data-indent-level="2"] {
          margin-left: 50px;
        }

        .ai-canvas-prosemirror > p[data-indent-level="3"] {
          margin-left: 75px;
        }

        .ai-canvas-prosemirror > p[data-indent-level="4"] {
          margin-left: 100px;
        }

        .ai-canvas-prosemirror > p[data-indent-level="5"] {
          margin-left: 125px;
        }

        .ai-canvas-prosemirror > p[data-indent-level="6"] {
          margin-left: 150px;
        }

        .ai-canvas-prosemirror > ul[data-indent-level="1"],
        .ai-canvas-prosemirror > ol[data-indent-level="1"] {
          margin-left: 0;
        }

        .ai-canvas-prosemirror > ul[data-indent-level="2"],
        .ai-canvas-prosemirror > ol[data-indent-level="2"] {
          margin-left: 25px;
        }

        .ai-canvas-prosemirror > ul[data-indent-level="3"],
        .ai-canvas-prosemirror > ol[data-indent-level="3"] {
          margin-left: 50px;
        }

        .ai-canvas-prosemirror > ul[data-indent-level="4"],
        .ai-canvas-prosemirror > ol[data-indent-level="4"] {
          margin-left: 75px;
        }

        .ai-canvas-prosemirror > ul[data-indent-level="5"],
        .ai-canvas-prosemirror > ol[data-indent-level="5"] {
          margin-left: 100px;
        }

        .ai-canvas-prosemirror > ul[data-indent-level="6"],
        .ai-canvas-prosemirror > ol[data-indent-level="6"] {
          margin-left: 125px;
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
          margin: 0 0 10px;
          padding-left: 25px;
        }

        .ai-canvas-prosemirror ul {
          list-style-type: disc;
        }

        .ai-canvas-prosemirror ul > li::marker {
          content: "●  ";
          color: #455166;
          font-size: 12px;
        }

        .ai-canvas-prosemirror ul ul > li::marker {
          content: "○  ";
          color: #344158;
          font-size: 8px;
          font-weight: 900;
        }

        .ai-canvas-prosemirror ul ul ul > li::marker {
          content: "■  ";
          color: #5c687c;
          font-size: 7px;
        }

        .ai-canvas-prosemirror li[data-markerless="true"]::marker {
          content: "";
        }

        .ai-canvas-prosemirror li {
          margin: 2px 0;
          padding-left: 2px;
          font-family: inherit;
          font-size: 14px;
          line-height: 21px;
          font-weight: 400;
        }

        .ai-canvas-prosemirror li > p {
          margin: 0;
        }

        .ai-canvas-prosemirror li > p:not(:first-child) {
          margin-left: 25px;
        }

        .ai-canvas-prosemirror li > ul,
        .ai-canvas-prosemirror li > ol {
          margin: 2px 0 0;
        }

        .ai-canvas-prosemirror hr {
          border: 0;
          height: 13px;
          margin: 13px 0 10px;
          background: linear-gradient(to right, #d9e2ef, #d9e2ef) center / 100% 1px no-repeat;
          cursor: pointer;
        }

        .ai-canvas-prosemirror hr.ProseMirror-selectednode {
          border-radius: 4px;
          background:
            linear-gradient(to right, #d9e2ef, #d9e2ef) center / 100% 1px no-repeat,
            rgba(46, 117, 255, 0.1);
          background-clip: border-box, content-box;
          padding: 2px 0;
          box-shadow: none;
          outline: none;
        }

        .ai-canvas-prosemirror pre {
          margin: 10px 0;
          padding: 11px 12px;
          border: 1px solid #d8e1ee;
          border-radius: 8px;
          background: #f4f7fb;
          color: #253044;
          overflow-x: auto;
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
          font-size: 12px;
          line-height: 18px;
          font-weight: 500;
          tab-size: 3;
        }

        .ai-canvas-prosemirror code {
          font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
        }

        .ai-canvas-prosemirror p code,
        .ai-canvas-prosemirror li code,
        .ai-canvas-prosemirror h1 code,
        .ai-canvas-prosemirror h2 code,
        .ai-canvas-prosemirror h3 code {
          padding: 1px 4px;
          border: 1px solid #d7e0ec;
          border-radius: 5px;
          background: #f3f6fb;
          color: #27364c;
          font-size: 12px;
          font-weight: 500;
        }

        .ai-canvas-prosemirror pre code {
          padding: 0;
          border: 0;
          background: transparent;
          color: inherit;
          font-size: inherit;
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
          font-size: 14px;
          line-height: 21px;
          font-weight: 400;
        }
      `}</style>
      {editorEmpty ? <div className="ai-canvas-placeholder">{placeholder}</div> : null}
      <EditorContent editor={editor} />
    </div>
  );
}
