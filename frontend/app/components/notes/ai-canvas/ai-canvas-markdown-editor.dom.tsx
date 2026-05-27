'use dom';

import React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Markdown } from '@tiptap/markdown';
import { Strike } from '@tiptap/extension-strike';
import type { Editor } from '@tiptap/core';
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

type AiCanvasMarkdownEditorProps = {
  markdown: string;
  editable: boolean;
  placeholder: string;
  onChangeMarkdown: (markdown: string) => Promise<void>;
  onFocusEditor: () => Promise<void>;
  dom?: import('expo/dom').DOMProps;
};

function createEditorExtensions() {
  return [
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

export default function AiCanvasMarkdownEditor({
  markdown,
  editable,
  placeholder,
  onChangeMarkdown,
  onFocusEditor,
}: AiCanvasMarkdownEditorProps) {
  const applyingExternalUpdateRef = React.useRef(false);
  const lastMarkdownRef = React.useRef(markdown);
  const onChangeMarkdownRef = React.useRef(onChangeMarkdown);
  const editorExtensions = React.useMemo(() => createEditorExtensions(), []);
  const [editorEmpty, setEditorEmpty] = React.useState(isMeaningfullyEmptyMarkdown(markdown));

  React.useEffect(() => {
    onChangeMarkdownRef.current = onChangeMarkdown;
  }, [onChangeMarkdown]);

  const editor = useEditor({
    extensions: editorExtensions,
    content: markdown || '',
    contentType: 'markdown',
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
      const nextMarkdown = getEditorMarkdown(currentEditor);
      if (nextMarkdown === lastMarkdownRef.current) {
        setEditorEmpty(isMeaningfullyEmptyMarkdown(nextMarkdown));
        return;
      }
      lastMarkdownRef.current = nextMarkdown;
      setEditorEmpty(isMeaningfullyEmptyMarkdown(nextMarkdown));
      void onChangeMarkdownRef.current(nextMarkdown);
    },
  });

  React.useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  React.useEffect(() => {
    if (!editor) return;
    const nextMarkdown = isMeaningfullyEmptyMarkdown(markdown) ? '' : markdown;
    if (nextMarkdown === lastMarkdownRef.current) return;

    applyingExternalUpdateRef.current = true;
    editor.commands.setContent(nextMarkdown || '', {
      contentType: 'markdown',
      emitUpdate: false,
    });
    lastMarkdownRef.current = nextMarkdown;
    setEditorEmpty(isMeaningfullyEmptyMarkdown(nextMarkdown));
    applyingExternalUpdateRef.current = false;
  }, [editor, markdown]);

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
