import process from 'node:process';
import { Editor } from '@tiptap/core';
import { Markdown } from '@tiptap/markdown';
import { Strike } from '@tiptap/extension-strike';
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

const BLOCK_NODE_TYPES = new Set([
  'paragraph',
  'heading',
  'codeBlock',
  'horizontalRule',
  'bulletList',
  'orderedList',
  'listItem',
]);

function createBlockId() {
  return `block_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function assignBlockIds(node) {
  if (!node || typeof node !== 'object') return node;
  const next = { ...node };
  if (BLOCK_NODE_TYPES.has(next.type)) {
    next.attrs = {
      ...(next.attrs && typeof next.attrs === 'object' ? next.attrs : {}),
      blockId: typeof next.attrs?.blockId === 'string' ? next.attrs.blockId : createBlockId(),
    };
  }
  if (Array.isArray(next.content)) {
    next.content = next.content.map(assignBlockIds);
  }
  return next;
}

function createExtensions() {
  return [
    Document,
    Paragraph,
    Text,
    Bold,
    Italic,
    Heading.configure({ levels: [1, 2, 3] }),
    BulletList,
    OrderedList,
    ListItem,
    ListKeymap,
    HorizontalRule,
    CodeBlock,
    HardBreak,
    Strike,
    Markdown.configure({
      indentation: { style: 'space', size: 2 },
      markedOptions: { breaks: false, gfm: true },
    }),
  ];
}

let input = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) {
  input += chunk;
}

const payload = input.trim() ? JSON.parse(input) : {};
const markdown = typeof payload.markdown === 'string' ? payload.markdown : '';
const editor = new Editor({
  extensions: createExtensions(),
  content: markdown,
  contentType: 'markdown',
});

process.stdout.write(JSON.stringify(assignBlockIds(editor.getJSON())));
editor.destroy();
