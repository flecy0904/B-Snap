import { resolveBackendHttpUrl } from '../root/backend-url';
import { Platform } from 'react-native';
import {
  EMPTY_AI_CANVAS_DOCUMENT,
  normalizeAiCanvasDocumentJson,
  type AiCanvasDocumentJson,
  type AiCanvasBlockContext,
  type CanvasOperation,
} from '../types/ai-canvas';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 12000;
const AI_MESSAGE_TIMEOUT_MS = 60000;

let backendAuthToken: string | null = null;

export function setBackendAuthToken(token: string | null) {
  backendAuthToken = token;
}

export function getBackendAuthToken() {
  return backendAuthToken;
}

export class BackendApiError extends Error {
  status: number | null;
  detail: string | null;

  constructor(message: string, status: number | null = null, detail: string | null = null) {
    super(message);
    this.name = 'BackendApiError';
    this.status = status;
    this.detail = detail;
  }
}

function parseBackendErrorDetail(body: any): string | null {
  if (!body) return null;
  if (typeof body.detail === 'string') return body.detail;
  if (Array.isArray(body.detail)) {
    const parts = body.detail
      .map((item: any) => {
        if (!item) return null;
        if (typeof item === 'string') return item;
        if (typeof item.msg === 'string') return item.msg;
        if (typeof item.message === 'string') return item.message;
        return null;
      })
      .filter((item: string | null): item is string => !!item);
    if (parts.length > 0) return parts.join(' · ');
  }
  if (typeof body.detail?.msg === 'string') return body.detail.msg;
  if (typeof body.message === 'string') return body.message;
  return null;
}

export type BackendFolder = {
  id: number;
  name: string;
  color: string | null;
};

export type BackendNote = {
  id: number;
  folder_id: number;
  title: string;
  summary: string | null;
  file_url?: string | null;
  thumbnail_url?: string | null;
  page_count?: number | null;
  original_filename?: string | null;
  file_size_bytes?: number | null;
  file_sha256?: string | null;
  subject_match_key?: string | null;
  document_match_key?: string | null;
};

export type BackendChatSession = {
  id: number;
  note_id: number;
  title: string;
  model: string | null;
  ragScope?: BackendRagScope | null;
};

export type BackendRagScopeSource = {
  id: string;
  // RAG v1 intentionally exposes only pinned notes and explicit Canvas notes.
  type: 'note' | 'canvas_note';
  title: string;
};

export type BackendRagScope = {
  sourceIds: string[];
  sources: BackendRagScopeSource[];
};

export type BackendChatMessage = {
  id: number;
  session_id: number;
  role: 'user' | 'assistant' | string;
  content: string;
  source: string;
  selection_image_url?: string | null;
  model: string | null;
  created_at: string;
};

export type BackendNotePage = {
  id: number;
  note_id: number;
  page_number: number;
  content: string | null;
  image_url: string | null;
};

export type BackendAiCanvasNoteSummary = {
  id: number;
  folder_id: number;
  note_id: number;
  title: string;
  revision: number;
  source_page_start: number | null;
  source_page_end: number | null;
  created_at: string;
  updated_at: string;
};

export type BackendAiCanvasNote = BackendAiCanvasNoteSummary & {
  markdown: string;
  documentJson: AiCanvasDocumentJson;
};

export type BackendClassInsightPageSignal = {
  page_number: number;
  importance_score: number;
  priority: 'very-high' | 'high' | 'medium' | string;
  reason_tags: string[];
  signal_count: number;
  bookmark_count?: number;
  highlight_count?: number;
  keyword_hits?: number;
  photo_reference_count?: number;
  ai_question_count?: number;
  memo_page_count?: number;
};

export type BackendClassInsight = {
  note_id: number;
  matched_note_count: number;
  participant_count: number;
  pages: BackendClassInsightPageSignal[];
};

export type BackendAiContextMode = 'general' | 'rag';

export type BackendRetrievedContext = {
  source_type: string;
  source_id: string;
  title: string;
  content: string;
  score: number;
  folder_id?: number | null;
  note_id?: number | null;
  page_number?: number | null;
  chunk_index?: number | null;
  metadata?: Record<string, unknown>;
};

export type BackendAiMessageResponse = {
  model: string;
  user_message: BackendChatMessage;
  assistant_message: {
    id: number;
    session_id: number;
    role: 'assistant';
    content: string;
    source: string;
    model: string | null;
    created_at: string;
  };
  chat_session?: BackendChatSession | null;
  canvas_edit?: {
    action: 'canvas_edit' | 'canvas_create';
    canvas_note_id: number;
    title: string;
    canvas_note: BackendAiCanvasNote;
    operations: CanvasOperation[];
  } | null;
  context_mode?: BackendAiContextMode | null;
  rewritten_query?: string | null;
  rag_scope?: BackendRagScope | null;
  ragScope?: BackendRagScope | null;
  sources?: BackendRetrievedContext[];
  debug?: {
    mode?: BackendAiContextMode | string;
    scope_count?: number;
    retrieved_source_count?: number;
    retrieved_chunk_count?: number;
    fallback?: boolean;
    fallback_reason?: string | null;
    router_reason?: string | null;
  } | null;
};

export type BackendRagDebugResult = {
  source_type: string;
  source_id?: string | number | null;
  title: string;
  score?: number | null;
  folder_id?: number | null;
  note_id?: number | null;
  page_number?: number | null;
  chunk_index?: number | null;
  metadata?: Record<string, unknown>;
  content_length: number;
  content_snippet: string;
  content: string;
  embedding_model?: string | null;
  indexed_at?: string | null;
  updated_at?: string | null;
};

export type BackendRagDebugIndexResponse = {
  note: {
    id: number;
    folder_id: number;
    title: string;
  };
  summary: {
    page_count: number;
    chunk_count: number;
    chunks_returned: number;
    chunk_limit: number;
    source_counts: Record<string, number>;
    embedding_model?: string | null;
    embedding_models?: string[];
    last_indexed_at?: string | null;
  };
  pages: Array<{
    id: number;
    page_number: number;
    text_length: number;
    text_snippet: string;
    text: string;
    updated_at?: string | null;
  }>;
  chunks: BackendRagDebugResult[];
};

export type BackendRagDebugContextSection = {
  title: string;
  count: number;
  items: BackendRagDebugResult[];
};

export type BackendRagDebugContext = {
  mode: BackendAiContextMode;
  scope_count: number;
  source_count: number;
  retrieved_chunk_count: number;
  current_page_included: boolean;
  nearby_pages_included: boolean;
  canvas_context_included: boolean;
  vision_image_attached: boolean;
  fallback: boolean;
  fallback_reason?: string | null;
  context_preview: string;
  sections: BackendRagDebugContextSection[];
};

export type BackendRagDebugEvaluateResponse = {
  mode: BackendAiContextMode;
  rewritten_query: string;
  router_reason: string;
  rag_scope: BackendRagScope;
  ragScope?: BackendRagScope | null;
  search_targets: {
    note_ids: number[];
    canvas_note_ids: number[];
  };
  debug: {
    fallback?: boolean;
    fallback_reason?: string | null;
    retrieved_source_count?: number;
    retrieved_chunk_count?: number;
    scope_count?: number;
  };
  context?: BackendRagDebugContext | null;
  results: BackendRagDebugResult[];
};

export type BackendRagDebugStatusResponse = {
  pgvector_available: boolean;
  document_chunks_total_count: number;
  current_note_chunk_count: number;
  current_scope_chunk_count: number;
  embedding_models: Array<{ model: string; count: number }>;
  recent_index_status: Array<{
    note_id?: number | null;
    source_type?: string | null;
    chunk_count: number;
    last_indexed_at?: string | null;
  }>;
  failed_indexes: Array<Record<string, unknown>>;
  last_error?: string | null;
  rag_scope: BackendRagScope;
  ragScope?: BackendRagScope | null;
};

export type BackendPdfTextExtractionResponse = {
  note_id: number;
  pages_extracted: number;
  pages: BackendNotePage[];
};

export type BackendUpload = {
  filename: string;
  stored_filename: string;
  content_type: string | null;
  size_bytes: number;
  sha256?: string | null;
  page_count: number;
  page_numbers: number[];
  thumbnail_url?: string | null;
  url: string;
  processed_url?: string | null;
  preprocessing?: {
    status?: 'completed' | 'fallback' | string;
    fallback_used?: boolean | null;
    source?: string | null;
    detail_code?: string | null;
    failure_stage?: string | null;
    message?: string | null;
    segmentation_error?: string | null;
    detections?: number | null;
    image_size?: string | null;
    write_error?: string | null;
    fallback_url?: string | null;
  } | null;
  analysis?: {
    status?: 'pending' | 'ready' | 'failed' | string;
    title?: string | null;
    summary?: string | null;
    keywords?: string[] | null;
    confidence?: number | null;
  } | null;
};

export type BackendCaptureUploadJob = {
  job_id: string;
  status: 'processing' | 'completed' | 'failed' | string;
  stage: 'target-detecting' | 'preprocessing' | 'ai-commenting' | 'completed' | 'failed' | string;
  message?: string | null;
  upload?: BackendUpload | null;
  error?: string | null;
  created_at?: number;
  updated_at?: number;
};

export type BackendAuthUser = {
  id: number;
  email: string;
  name: string;
  created_at: string;
};

export type BackendAuthSession = {
  access_token: string;
  token_type: 'bearer' | string;
  user: BackendAuthUser;
};

export type BackendPdfNoteUpload = {
  upload: BackendUpload;
  note: BackendNote;
  pages: BackendNotePage[];
};

function getBackendUrl() {
  return resolveBackendHttpUrl();
}

export function resolveBackendAssetUrl(url: string | null | undefined) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.pathname.startsWith('/uploads/')) {
        const baseUrl = getBackendUrl();
        if (baseUrl) return `${baseUrl.replace(/\/$/, '')}${parsed.pathname}${parsed.search}`;
      }
    } catch {
      return url;
    }
    return url;
  }
  if (url.startsWith('file://')) return url;

  const baseUrl = getBackendUrl();
  if (!baseUrl) return url;
  return `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
}

function normalizeBackendNote(note: BackendNote): BackendNote {
  return {
    ...note,
    file_url: resolveBackendAssetUrl(note.file_url) ?? note.file_url,
    thumbnail_url: resolveBackendAssetUrl(note.thumbnail_url) ?? note.thumbnail_url,
  };
}

function normalizeBackendAiCanvasNote(note: any): BackendAiCanvasNote {
  const { document_json: documentJsonWire, documentJson, ...rest } = note ?? {};
  return {
    ...rest,
    markdown: typeof rest.markdown === 'string' ? rest.markdown : '',
    documentJson: normalizeAiCanvasDocumentJson(documentJson ?? documentJsonWire ?? EMPTY_AI_CANVAS_DOCUMENT),
  } as BackendAiCanvasNote;
}

function normalizeBackendRagScope(scope: any): BackendRagScope | null {
  if (!scope || !Array.isArray(scope.sources)) return null;
  const sources: BackendRagScopeSource[] = [];
  scope.sources.forEach((source: any) => {
    const type = source?.type === 'canvas_note' ? 'canvas_note' : source?.type === 'note' ? 'note' : null;
    const id = String(source?.id ?? '');
    const title = String(source?.title ?? '');
    if (!type || !id || !title) return;
    sources.push({ id, type, title });
  });
  return {
    sourceIds: Array.isArray(scope.sourceIds)
      ? scope.sourceIds.map((value: unknown) => String(value))
      : sources.map((source) => `${source.type}:${source.id}`),
    sources,
  };
}

function normalizeBackendChatSession(session: any): BackendChatSession {
  return {
    ...session,
    ragScope: normalizeBackendRagScope(session?.ragScope ?? session?.rag_scope),
  } as BackendChatSession;
}

function normalizeBackendAiMessageResponse(response: BackendAiMessageResponse): BackendAiMessageResponse {
  const normalized = {
    ...response,
    chat_session: response.chat_session ? normalizeBackendChatSession(response.chat_session) : response.chat_session,
    ragScope: normalizeBackendRagScope(response.ragScope ?? response.rag_scope),
  };
  if (!normalized.canvas_edit) return normalized;
  return {
    ...normalized,
    canvas_edit: {
      ...normalized.canvas_edit,
      operations: Array.isArray(normalized.canvas_edit.operations) ? normalized.canvas_edit.operations : [],
      canvas_note: normalizeBackendAiCanvasNote(normalized.canvas_edit.canvas_note),
    },
  };
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = getBackendUrl();
  if (!baseUrl) {
    throw new BackendApiError('Backend URL is not configured.');
  }

  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      signal: controller.signal,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(backendAuthToken ? { Authorization: `Bearer ${backendAuthToken}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new BackendApiError('Backend request timed out.');
    }
    throw new BackendApiError('Backend server is unreachable.');
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let detail: string | null = null;
    try {
      const body = await response.json();
      detail = parseBackendErrorDetail(body);
    } catch {
      detail = null;
    }
    throw new BackendApiError(`Backend request failed: ${response.status}`, response.status, detail);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function isBackendApiEnabled() {
  return !!getBackendUrl();
}

function normalizeBackendUpload(upload: BackendUpload): BackendUpload {
  return {
    ...upload,
    url: resolveBackendAssetUrl(upload.url) ?? upload.url,
    processed_url: resolveBackendAssetUrl(upload.processed_url) ?? upload.processed_url,
    thumbnail_url: resolveBackendAssetUrl(upload.thumbnail_url) ?? upload.thumbnail_url,
  };
}

function normalizeBackendCaptureUploadJob(job: BackendCaptureUploadJob): BackendCaptureUploadJob {
  return {
    ...job,
    upload: job.upload ? normalizeBackendUpload(job.upload) : job.upload,
  };
}

type BackendUploadFilePayload = {
  uri: string;
  name: string;
  type: string;
  blob?: Blob | null;
};

async function appendUploadFile(formData: FormData, fieldName: string, file: BackendUploadFilePayload) {
  if (Platform.OS === 'web') {
    if (file.blob) {
      formData.append(fieldName, file.blob, file.name);
      return;
    }

    try {
      const response = await fetch(file.uri);
      const blob = await response.blob();
      formData.append(fieldName, blob, file.name);
    } catch {
      throw new BackendApiError('선택한 파일을 읽지 못했습니다.');
    }
    return;
  }

  formData.append(fieldName, {
    uri: file.uri,
    name: file.name,
    type: file.type,
  } as unknown as Blob);
}

export async function uploadBackendFile(file: {
  uri: string;
  name: string;
  type: string;
}) {
  const baseUrl = getBackendUrl();
  if (!baseUrl) {
    throw new BackendApiError('Backend URL is not configured.');
  }

  const formData = new FormData();
  await appendUploadFile(formData, 'file', file);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/uploads`, {
      method: 'POST',
      headers: backendAuthToken ? { Authorization: `Bearer ${backendAuthToken}` } : undefined,
      body: formData,
    });
  } catch {
    throw new BackendApiError('Backend server is unreachable.');
  }

  if (!response.ok) {
    let detail: string | null = null;
    try {
      const body = await response.json();
      detail = parseBackendErrorDetail(body);
    } catch {
      detail = null;
    }
    throw new BackendApiError(`Backend upload failed: ${response.status}`, response.status, detail);
  }

  const upload = await response.json() as BackendUpload;
  return normalizeBackendUpload(upload);
}

export async function createBackendCaptureUploadJob(file: {
  uri: string;
  name: string;
  type: string;
}) {
  const baseUrl = getBackendUrl();
  if (!baseUrl) {
    throw new BackendApiError('Backend URL is not configured.');
  }

  const formData = new FormData();
  await appendUploadFile(formData, 'file', file);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/uploads/capture-jobs`, {
      method: 'POST',
      headers: backendAuthToken ? { Authorization: `Bearer ${backendAuthToken}` } : undefined,
      body: formData,
    });
  } catch {
    throw new BackendApiError('Backend server is unreachable.');
  }

  if (!response.ok) {
    let detail: string | null = null;
    try {
      const body = await response.json();
      detail = parseBackendErrorDetail(body);
    } catch {
      detail = null;
    }
    throw new BackendApiError(`Backend capture upload failed: ${response.status}`, response.status, detail);
  }

  const job = await response.json() as BackendCaptureUploadJob;
  return normalizeBackendCaptureUploadJob(job);
}

export async function getBackendCaptureUploadJob(jobId: string) {
  const job = await request<BackendCaptureUploadJob>(`/uploads/capture-jobs/${encodeURIComponent(jobId)}`, {
    timeoutMs: 8000,
  });
  return normalizeBackendCaptureUploadJob(job);
}

export async function uploadBackendPdfNote(payload: {
  file: {
    uri: string;
    name: string;
    type: string;
    blob?: Blob | null;
  };
  folderId: number;
  title: string;
  summary?: string | null;
}) {
  const baseUrl = getBackendUrl();
  if (!baseUrl) {
    throw new BackendApiError('Backend URL is not configured.');
  }

  const formData = new FormData();
  formData.append('folder_id', String(payload.folderId));
  formData.append('title', payload.title);
  if (payload.summary !== undefined && payload.summary !== null) {
    formData.append('summary', payload.summary);
  }
  await appendUploadFile(formData, 'file', payload.file);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/uploads/pdf-note`, {
      method: 'POST',
      headers: backendAuthToken ? { Authorization: `Bearer ${backendAuthToken}` } : undefined,
      body: formData,
    });
  } catch {
    throw new BackendApiError('Backend server is unreachable.');
  }

  if (!response.ok) {
    let detail: string | null = null;
    try {
      const body = await response.json();
      detail = parseBackendErrorDetail(body);
    } catch {
      detail = null;
    }
    throw new BackendApiError(`Backend PDF upload failed: ${response.status}`, response.status, detail);
  }

  const result = await response.json() as BackendPdfNoteUpload;
  return {
    ...result,
    upload: normalizeBackendUpload(result.upload),
    note: normalizeBackendNote(result.note),
    pages: result.pages.map((page) => ({
      ...page,
      image_url: resolveBackendAssetUrl(page.image_url) ?? page.image_url,
    })),
  };
}

export async function registerBackendUser(payload: {
  email: string;
  password: string;
  name?: string | null;
}) {
  return request<BackendAuthSession>('/auth/register', {
    method: 'POST',
    body: {
      email: payload.email,
      password: payload.password,
      name: payload.name ?? null,
    },
  });
}

export async function loginBackendUser(payload: {
  email: string;
  password: string;
}) {
  return request<BackendAuthSession>('/auth/login', {
    method: 'POST',
    body: payload,
  });
}

export function getBackendCurrentUser() {
  return request<BackendAuthUser>('/auth/me');
}

export async function ensureFolderForSubject(subject: { name: string; color?: string }) {
  const folders = await request<BackendFolder[]>('/folders');
  const existing = folders.find((folder) => folder.name === subject.name);
  if (existing) return existing;

  return request<BackendFolder>('/folders', {
    method: 'POST',
    body: {
      name: subject.name,
      color: subject.color ?? null,
    },
  });
}

export function listBackendFolders() {
  return request<BackendFolder[]>('/folders');
}

export function listBackendNotes() {
  return request<BackendNote[]>('/notes').then((notes) => notes.map(normalizeBackendNote));
}

export function listBackendNotePages(noteId: number) {
  return request<BackendNotePage[]>(`/notes/${noteId}/pages`).then((pages) => (
    pages.map((page) => ({
      ...page,
      image_url: resolveBackendAssetUrl(page.image_url) ?? page.image_url,
    }))
  ));
}

export function getBackendClassInsight(noteId: number, limit = 12) {
  return request<BackendClassInsight>(`/notes/${noteId}/class-insights?limit=${limit}`);
}

export async function createBackendNote(payload: {
  folderId: number;
  title: string;
  summary?: string | null;
}) {
  return request<BackendNote>('/notes', {
    method: 'POST',
    body: {
      folder_id: payload.folderId,
      title: payload.title,
      summary: payload.summary ?? null,
    },
  }).then(normalizeBackendNote);
}

export async function updateBackendNote(payload: {
  noteId: number;
  title?: string;
  summary?: string | null;
}) {
  return request<BackendNote>(`/notes/${payload.noteId}`, {
    method: 'PATCH',
    body: {
      title: payload.title,
      summary: payload.summary,
    },
  }).then(normalizeBackendNote);
}

export async function deleteBackendNote(noteId: number) {
  await request<void>(`/notes/${noteId}`, {
    method: 'DELETE',
  });
}

export async function createBackendNotePage(payload: {
  noteId: number;
  pageNumber: number;
  content?: string | null;
  imageUrl?: string | null;
}) {
  const page = await request<BackendNotePage>(`/notes/${payload.noteId}/pages`, {
    method: 'POST',
    body: {
      page_number: payload.pageNumber,
      content: payload.content ?? null,
      image_url: payload.imageUrl ?? null,
    },
  });
  return {
    ...page,
    image_url: resolveBackendAssetUrl(page.image_url) ?? page.image_url,
  };
}

export async function updateBackendNotePage(payload: {
  pageId: number;
  pageNumber?: number;
  content?: string | null;
  imageUrl?: string | null;
}) {
  const page = await request<BackendNotePage>(`/note-pages/${payload.pageId}`, {
    method: 'PATCH',
    body: {
      page_number: payload.pageNumber,
      content: payload.content,
      image_url: payload.imageUrl,
    },
  });
  return {
    ...page,
    image_url: resolveBackendAssetUrl(page.image_url) ?? page.image_url,
  };
}

function normalizeBackendNotePages(pages: BackendNotePage[]) {
  return pages.map((page) => ({
    ...page,
    image_url: resolveBackendAssetUrl(page.image_url) ?? page.image_url,
  }));
}

export async function duplicateBackendNotePage(payload: {
  noteId: number;
  pageNumber: number;
}) {
  return request<BackendNotePage[]>(`/notes/${payload.noteId}/pages/${payload.pageNumber}/duplicate`, {
    method: 'POST',
  }).then(normalizeBackendNotePages);
}

export async function deleteBackendNotePageByNumber(payload: {
  noteId: number;
  pageNumber: number;
}) {
  return request<BackendNotePage[]>(`/notes/${payload.noteId}/pages/by-number/${payload.pageNumber}`, {
    method: 'DELETE',
  }).then(normalizeBackendNotePages);
}

export async function moveBackendNotePage(payload: {
  noteId: number;
  pageNumber: number;
  delta: -1 | 1;
}) {
  return request<BackendNotePage[]>(`/notes/${payload.noteId}/pages/${payload.pageNumber}/move?delta=${payload.delta}`, {
    method: 'POST',
  }).then(normalizeBackendNotePages);
}

export async function extractBackendPdfText(payload: {
  noteId: number;
  pdfData?: string;
}) {
  return request<BackendPdfTextExtractionResponse>(`/notes/${payload.noteId}/extract-pdf-text`, {
    method: 'POST',
    body: payload.pdfData ? { pdf_data: payload.pdfData } : {},
  });
}

export function listBackendAiCanvasNotes(noteId: number) {
  return request<BackendAiCanvasNoteSummary[]>(`/notes/${noteId}/ai-canvas-notes`);
}

export function listBackendAiCanvasNotesByFolder(folderId: number) {
  return request<BackendAiCanvasNoteSummary[]>(`/folders/${folderId}/ai-canvas-notes`);
}

export function getBackendAiCanvasNote(canvasNoteId: number) {
  return request<any>(`/ai-canvas-notes/${canvasNoteId}`).then(normalizeBackendAiCanvasNote);
}

export async function createBackendAiCanvasNote(payload: {
  noteId: number;
  title: string;
  markdown?: string;
  documentJson?: AiCanvasDocumentJson;
  sourcePageStart?: number | null;
  sourcePageEnd?: number | null;
}) {
  return request<any>(`/notes/${payload.noteId}/ai-canvas-notes`, {
    method: 'POST',
    body: {
      title: payload.title,
      markdown: payload.markdown ?? '',
      document_json: payload.documentJson ?? EMPTY_AI_CANVAS_DOCUMENT,
      source_page_start: payload.sourcePageStart ?? null,
      source_page_end: payload.sourcePageEnd ?? null,
    },
  }).then(normalizeBackendAiCanvasNote);
}

export async function updateBackendAiCanvasNote(payload: {
  canvasNoteId: number;
  title?: string;
  markdown?: string;
  documentJson?: AiCanvasDocumentJson;
  expectedRevision?: number;
  sourcePageStart?: number | null;
  sourcePageEnd?: number | null;
}) {
  return request<any>(`/ai-canvas-notes/${payload.canvasNoteId}`, {
    method: 'PATCH',
    body: {
      title: payload.title,
      markdown: payload.markdown,
      document_json: payload.documentJson,
      expected_revision: payload.expectedRevision,
      source_page_start: payload.sourcePageStart,
      source_page_end: payload.sourcePageEnd,
    },
  }).then(normalizeBackendAiCanvasNote);
}

export function deleteBackendAiCanvasNote(canvasNoteId: number) {
  return request<void>(`/ai-canvas-notes/${canvasNoteId}`, {
    method: 'DELETE',
  });
}

export async function createBackendChatSession(payload: {
  noteId: number;
  title: string;
  model?: string | null;
  ragScope?: BackendRagScope | null;
}) {
  return request<BackendChatSession>(`/notes/${payload.noteId}/chat-sessions`, {
    method: 'POST',
    body: {
      title: payload.title,
      model: payload.model ?? null,
      rag_scope: payload.ragScope ?? null,
    },
  }).then(normalizeBackendChatSession);
}

export function listBackendChatSessions(noteId: number) {
  return request<BackendChatSession[]>(`/notes/${noteId}/chat-sessions`).then((sessions) => sessions.map(normalizeBackendChatSession));
}

export function listAllBackendChatSessions() {
  return request<BackendChatSession[]>('/chat-sessions').then((sessions) => sessions.map(normalizeBackendChatSession));
}

export async function updateBackendChatSession(payload: {
  sessionId: number;
  title?: string;
  model?: string | null;
  ragScope?: BackendRagScope | null;
}) {
  return request<BackendChatSession>(`/chat-sessions/${payload.sessionId}`, {
    method: 'PATCH',
    body: {
      title: payload.title,
      model: payload.model,
      rag_scope: payload.ragScope,
    },
  }).then(normalizeBackendChatSession);
}

export function deleteBackendChatSession(sessionId: number) {
  return request<void>(`/chat-sessions/${sessionId}`, {
    method: 'DELETE',
  });
}

export function listBackendChatMessages(sessionId: number) {
  return request<BackendChatMessage[]>(`/chat-sessions/${sessionId}/messages`);
}

export async function sendBackendAiMessage(payload: {
  sessionId: number;
  content: string;
  model?: string | null;
  selectionImage?: string | null;
  selectionRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    mode?: 'rect' | 'lasso';
    pageWidth?: number;
    pageHeight?: number;
  } | null;
  pageNumber?: number | null;
  selectionImageUri?: string | null;
  contextHint?: string | null;
  source?: 'chat' | 'canvas-mini' | 'canvas-block';
  canvasNoteId?: number | null;
  canvasAction?: 'auto' | 'chat_only' | 'canvas_edit' | 'canvas_create';
  canvasNoteNeedsTitle?: boolean;
  canvasMarkdown?: string | null;
  canvasDocumentJson?: AiCanvasDocumentJson | null;
  canvasBlockContext?: AiCanvasBlockContext | null;
  ragScope?: BackendRagScope | null;
  useRag?: boolean;
  topK?: number;
}) {
  return request<BackendAiMessageResponse>(`/chat-sessions/${payload.sessionId}/ai-messages`, {
    method: 'POST',
    timeoutMs: AI_MESSAGE_TIMEOUT_MS,
    body: {
      content: payload.content,
      model: payload.model ?? null,
      selection_image: payload.selectionImage ?? payload.selectionImageUri ?? null,
      selection_rect: payload.selectionRect ?? null,
      page_number: payload.pageNumber ?? null,
      selection_image_url: payload.selectionImageUri ?? null,
      context_hint: payload.contextHint ?? null,
      source: payload.source ?? 'chat',
      canvas_note_id: payload.canvasNoteId ?? null,
      canvas_action: payload.canvasAction ?? 'auto',
      canvas_note_needs_title: payload.canvasNoteNeedsTitle ?? false,
      canvas_markdown: payload.canvasMarkdown ?? null,
      canvas_document_json: payload.canvasDocumentJson ?? null,
      canvas_block_context: payload.canvasBlockContext ?? null,
      rag_scope: payload.ragScope ?? null,
      use_rag: payload.useRag ?? false,
      top_k: payload.topK ?? 5,
    },
  }).then(normalizeBackendAiMessageResponse);
}

export function getBackendRagDebugIndex(noteId: number) {
  return request<BackendRagDebugIndexResponse>(`/notes/${noteId}/rag-debug/index`);
}

export function reindexBackendNoteRag(noteId: number) {
  return request<{ status: string; note_count: number }>(`/ai/rag/reindex/notes/${noteId}`, {
    method: 'POST',
  });
}

export async function evaluateBackendRagDebug(payload: {
  sessionId: number;
  content: string;
  model?: string | null;
  pageNumber?: number | null;
  contextHint?: string | null;
  selectionImage?: string | null;
  selectionImageUri?: string | null;
  selectionRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    mode?: 'rect' | 'lasso';
    pageWidth?: number;
    pageHeight?: number;
  } | null;
  canvasBlockContext?: AiCanvasBlockContext | null;
  ragScope?: BackendRagScope | null;
  useRag?: boolean;
  topK?: number;
}) {
  return request<BackendRagDebugEvaluateResponse>(`/chat-sessions/${payload.sessionId}/rag-debug/evaluate`, {
    method: 'POST',
    body: {
      content: payload.content,
      page_number: payload.pageNumber ?? null,
      context_hint: payload.contextHint ?? null,
      selection_image: payload.selectionImage ?? payload.selectionImageUri ?? null,
      selection_image_url: payload.selectionImageUri ?? null,
      selection_rect: payload.selectionRect ?? null,
      canvas_block_context: payload.canvasBlockContext ?? null,
      rag_scope: payload.ragScope ?? null,
      use_rag: payload.useRag ?? false,
      top_k: payload.topK ?? 5,
    },
  }).then((response) => ({
    ...response,
    ragScope: normalizeBackendRagScope(response.ragScope ?? response.rag_scope),
  }));
}

export async function getBackendRagDebugStatus(payload: {
  sessionId: number;
  ragScope?: BackendRagScope | null;
}) {
  return request<BackendRagDebugStatusResponse>(`/chat-sessions/${payload.sessionId}/rag-debug/status`, {
    method: 'POST',
    body: {
      rag_scope: payload.ragScope ?? null,
    },
  }).then((response) => ({
    ...response,
    ragScope: normalizeBackendRagScope(response.ragScope ?? response.rag_scope),
  }));
}
