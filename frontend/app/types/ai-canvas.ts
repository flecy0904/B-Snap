export type TiptapJsonNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapJsonNode[];
  marks?: Array<Record<string, unknown>>;
  text?: string;
};

export type AiCanvasDocumentJson = {
  type: 'doc';
  content?: TiptapJsonNode[];
};

export type TiptapBlockNode = TiptapJsonNode;

export type AiCanvasRecommendationMode =
  | 'polish'
  | 'simplify'
  | 'professionalize'
  | 'shorten'
  | 'expand'
  | 'restructure'
  | 'extract_key_points'
  | 'mark_uncertain';

export type CanvasOperation =
  | { op: 'insert_after'; targetBlockId: string | null; node: TiptapBlockNode }
  | { op: 'insert_before'; targetBlockId: string; node: TiptapBlockNode }
  | { op: 'replace'; targetBlockId: string; node: TiptapBlockNode }
  | { op: 'delete'; targetBlockId: string };

export type AiCanvasOperationApplyResult = 'applied' | 'unchanged' | 'failed';

export type CanvasOperationRequest = {
  id: number;
  action: 'canvas_edit' | 'canvas_create';
  canvasNoteId: number;
  operations: CanvasOperation[];
};

export type AiCanvasSelection = {
  from: number;
  to: number;
  context?: AiCanvasBlockContext | null;
};

export type AiCanvasEditorChange = {
  documentJson: AiCanvasDocumentJson;
  markdown: string;
  selection: AiCanvasSelection | null;
  source?: 'editor' | 'editor-history' | 'external';
};

export type AiCanvasBlockContext = {
  blockId: string;
  type: string;
  text: string;
  markdown: string;
  sectionHeading: string | null;
  sectionExcerpt: string;
  beforeText: string | null;
  afterText: string | null;
  scope?: 'block' | 'selection';
  selectedBlockIds?: string[];
  selectionFrom?: number;
  selectionTo?: number;
};

export const EMPTY_AI_CANVAS_DOCUMENT: AiCanvasDocumentJson = {
  type: 'doc',
  content: [],
};

export function cloneAiCanvasDocument(documentJson: AiCanvasDocumentJson): AiCanvasDocumentJson {
  return JSON.parse(JSON.stringify(documentJson)) as AiCanvasDocumentJson;
}

export function normalizeAiCanvasDocumentJson(value: unknown): AiCanvasDocumentJson {
  if (!value || typeof value !== 'object') return cloneAiCanvasDocument(EMPTY_AI_CANVAS_DOCUMENT);
  const candidate = value as Partial<AiCanvasDocumentJson>;
  if (candidate.type !== 'doc') return cloneAiCanvasDocument(EMPTY_AI_CANVAS_DOCUMENT);
  return {
    type: 'doc',
    content: Array.isArray(candidate.content) ? candidate.content : [],
  };
}

export function stringifyAiCanvasDocument(documentJson: AiCanvasDocumentJson) {
  return JSON.stringify(normalizeAiCanvasDocumentJson(documentJson));
}

export function areAiCanvasDocumentsEqual(left: AiCanvasDocumentJson, right: AiCanvasDocumentJson) {
  return stringifyAiCanvasDocument(left) === stringifyAiCanvasDocument(right);
}
