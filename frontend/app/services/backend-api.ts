import { resolveBackendHttpUrl } from '../root/backend-url';
import { Platform } from 'react-native';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
};

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
};

export type BackendChatSession = {
  id: number;
  note_id: number;
  title: string;
  model: string | null;
};

export type BackendChatMessage = {
  id: number;
  session_id: number;
  role: 'user' | 'assistant' | string;
  content: string;
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

export type BackendAiCanvasNote = {
  id: number;
  folder_id: number;
  note_id: number;
  title: string;
  markdown: string;
  source_page_start: number | null;
  source_page_end: number | null;
  created_at: string;
  updated_at: string;
};

export type BackendAiCanvasEditResponse = {
  markdown: string;
  model: string;
};

export type BackendAiMessageResponse = {
  model: string;
  user_message: BackendChatMessage;
  assistant_message: {
    id: number;
    session_id: number;
    role: 'assistant';
    content: string;
    model: string | null;
    created_at: string;
  };
  chat_session?: BackendChatSession | null;
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
  page_count: number;
  page_numbers: number[];
  page_image_urls?: string[];
  thumbnail_url?: string | null;
  url: string;
  processed_url?: string | null;
  analysis?: {
    status?: 'pending' | 'ready' | 'failed' | string;
    summary?: string | null;
    keywords?: string[] | null;
    confidence?: number | null;
  } | null;
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
  if (/^https?:\/\//i.test(url) || url.startsWith('file://')) return url;

  const baseUrl = getBackendUrl();
  if (!baseUrl) return url;
  return `${baseUrl.replace(/\/$/, '')}/${url.replace(/^\//, '')}`;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = getBackendUrl();
  if (!baseUrl) {
    throw new BackendApiError('Backend URL is not configured.');
  }

  let response: Response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12000);
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

async function appendUploadFile(formData: FormData, fieldName: string, file: {
  uri: string;
  name: string;
  type: string;
}) {
  if (Platform.OS === 'web') {
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
  return {
    ...upload,
    url: resolveBackendAssetUrl(upload.url) ?? upload.url,
    processed_url: resolveBackendAssetUrl(upload.processed_url) ?? upload.processed_url,
    thumbnail_url: resolveBackendAssetUrl(upload.thumbnail_url) ?? upload.thumbnail_url,
    page_image_urls: upload.page_image_urls?.map((url) => resolveBackendAssetUrl(url) ?? url) ?? [],
  };
}

export async function uploadBackendPdfNote(payload: {
  file: {
    uri: string;
    name: string;
    type: string;
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
    upload: {
      ...result.upload,
      url: resolveBackendAssetUrl(result.upload.url) ?? result.upload.url,
      processed_url: resolveBackendAssetUrl(result.upload.processed_url) ?? result.upload.processed_url,
      thumbnail_url: resolveBackendAssetUrl(result.upload.thumbnail_url) ?? result.upload.thumbnail_url,
      page_image_urls: result.upload.page_image_urls?.map((url) => resolveBackendAssetUrl(url) ?? url) ?? [],
    },
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
  return request<BackendNote[]>('/notes');
}

export function listBackendNotePages(noteId: number) {
  return request<BackendNotePage[]>(`/notes/${noteId}/pages`).then((pages) => (
    pages.map((page) => ({
      ...page,
      image_url: resolveBackendAssetUrl(page.image_url) ?? page.image_url,
    }))
  ));
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
  });
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
  });
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
  pdfData: string;
}) {
  return request<BackendPdfTextExtractionResponse>(`/notes/${payload.noteId}/extract-pdf-text`, {
    method: 'POST',
    body: {
      pdf_data: payload.pdfData,
    },
  });
}

export function listBackendAiCanvasNotes(noteId: number) {
  return request<BackendAiCanvasNote[]>(`/notes/${noteId}/ai-canvas-notes`);
}

export function listBackendAiCanvasNotesByFolder(folderId: number) {
  return request<BackendAiCanvasNote[]>(`/folders/${folderId}/ai-canvas-notes`);
}

export async function createBackendAiCanvasNote(payload: {
  noteId: number;
  title: string;
  markdown?: string;
  sourcePageStart?: number | null;
  sourcePageEnd?: number | null;
}) {
  return request<BackendAiCanvasNote>(`/notes/${payload.noteId}/ai-canvas-notes`, {
    method: 'POST',
    body: {
      title: payload.title,
      markdown: payload.markdown ?? '',
      source_page_start: payload.sourcePageStart ?? null,
      source_page_end: payload.sourcePageEnd ?? null,
    },
  });
}

export async function updateBackendAiCanvasNote(payload: {
  canvasNoteId: number;
  title?: string;
  markdown?: string;
  sourcePageStart?: number | null;
  sourcePageEnd?: number | null;
}) {
  return request<BackendAiCanvasNote>(`/ai-canvas-notes/${payload.canvasNoteId}`, {
    method: 'PATCH',
    body: {
      title: payload.title,
      markdown: payload.markdown,
      source_page_start: payload.sourcePageStart,
      source_page_end: payload.sourcePageEnd,
    },
  });
}

export function deleteBackendAiCanvasNote(canvasNoteId: number) {
  return request<void>(`/ai-canvas-notes/${canvasNoteId}`, {
    method: 'DELETE',
  });
}

export async function requestBackendAiCanvasEdit(payload: {
  canvasNoteId: number;
  instruction: string;
  model?: string | null;
}) {
  return request<BackendAiCanvasEditResponse>(`/ai-canvas-notes/${payload.canvasNoteId}/ai-edit`, {
    method: 'POST',
    body: {
      instruction: payload.instruction,
      model: payload.model ?? null,
    },
  });
}

export async function createBackendChatSession(payload: {
  noteId: number;
  title: string;
  model?: string | null;
}) {
  return request<BackendChatSession>(`/notes/${payload.noteId}/chat-sessions`, {
    method: 'POST',
    body: {
      title: payload.title,
      model: payload.model ?? null,
    },
  });
}

export function listBackendChatSessions(noteId: number) {
  return request<BackendChatSession[]>(`/notes/${noteId}/chat-sessions`);
}

export function listAllBackendChatSessions() {
  return request<BackendChatSession[]>('/chat-sessions');
}

export async function updateBackendChatSession(payload: {
  sessionId: number;
  title?: string;
  model?: string | null;
}) {
  return request<BackendChatSession>(`/chat-sessions/${payload.sessionId}`, {
    method: 'PATCH',
    body: {
      title: payload.title,
      model: payload.model,
    },
  });
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
    pageWidth?: number;
    pageHeight?: number;
  } | null;
  pageNumber?: number | null;
  selectionImageUri?: string | null;
}) {
  return request<BackendAiMessageResponse>(`/chat-sessions/${payload.sessionId}/ai-messages`, {
    method: 'POST',
    body: {
      content: payload.content,
      model: payload.model ?? null,
      selection_image: payload.selectionImage ?? payload.selectionImageUri ?? null,
      selection_rect: payload.selectionRect ?? null,
      page_number: payload.pageNumber ?? null,
      selection_image_url: payload.selectionImageUri ?? null,
    },
  });
}
