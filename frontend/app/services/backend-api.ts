import { resolveBackendHttpUrl } from '../root/backend-url';

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
};

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
};

function getBackendUrl() {
  return resolveBackendHttpUrl();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = getBackendUrl();
  if (!baseUrl) {
    throw new Error('Backend URL is not configured.');
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(`Backend request failed: ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function isBackendApiEnabled() {
  return !!getBackendUrl();
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
  return request<BackendNotePage[]>(`/notes/${noteId}/pages`);
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
  return request<BackendNotePage>(`/notes/${payload.noteId}/pages`, {
    method: 'POST',
    body: {
      page_number: payload.pageNumber,
      content: payload.content ?? null,
      image_url: payload.imageUrl ?? null,
    },
  });
}

export async function updateBackendNotePage(payload: {
  pageId: number;
  pageNumber?: number;
  content?: string | null;
  imageUrl?: string | null;
}) {
  return request<BackendNotePage>(`/note-pages/${payload.pageId}`, {
    method: 'PATCH',
    body: {
      page_number: payload.pageNumber,
      content: payload.content,
      image_url: payload.imageUrl,
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

export function listBackendChatMessages(sessionId: number) {
  return request<BackendChatMessage[]>(`/chat-sessions/${sessionId}/messages`);
}

export async function sendBackendAiMessage(payload: {
  sessionId: number;
  content: string;
  model?: string | null;
}) {
  return request<BackendAiMessageResponse>(`/chat-sessions/${payload.sessionId}/ai-messages`, {
    method: 'POST',
    body: {
      content: payload.content,
      model: payload.model ?? null,
    },
  });
}
