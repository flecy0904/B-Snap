import { useMemo } from 'react';
import type { BackendChatMessage, BackendChatSession } from '../../../services/backend-api';

export function useAiChatDerivedState(params: {
  studyDocumentId: number | null;
  currentBackendNoteId: number | null;
  chatSessionByDocument: Record<number, number>;
  viewingAiChatSessionId: number | null;
  aiMessagesBySession: Record<number, BackendChatMessage[]>;
  selectionPreviewByDocument: Record<number, string | null>;
  chatSessionsByDocument: Record<number, BackendChatSession[]>;
  allChatSessions: BackendChatSession[];
  aiChatScope: 'note' | 'all';
  aiChatSearchQuery: string;
  backendPageIdsByDocument: Record<number, Record<number, number>>;
}) {
  const activeAiChatSessionId = params.studyDocumentId
    ? params.viewingAiChatSessionId ?? params.chatSessionByDocument[params.studyDocumentId] ?? null
    : null;
  const aiMessages = activeAiChatSessionId ? params.aiMessagesBySession[activeAiChatSessionId] ?? [] : [];
  const activeAiChatSession = activeAiChatSessionId
    ? params.allChatSessions.find((session) => session.id === activeAiChatSessionId)
      ?? Object.values(params.chatSessionsByDocument).flat().find((session) => session.id === activeAiChatSessionId)
      ?? null
    : null;
  const aiChatReadOnly = Boolean(
    activeAiChatSession
    && params.currentBackendNoteId
    && activeAiChatSession.note_id !== params.currentBackendNoteId,
  );
  const selectionPreviewUri = params.studyDocumentId
    ? params.selectionPreviewByDocument[params.studyDocumentId] ?? null
    : null;
  const noteAiChatSessions = params.studyDocumentId
    ? params.chatSessionsByDocument[params.studyDocumentId] ?? []
    : [];
  const aiChatSearchTerm = params.aiChatSearchQuery.trim().toLowerCase();
  const shouldShowAllAiChatSessions = params.aiChatScope === 'all' || (params.aiChatScope === 'note' && noteAiChatSessions.length === 0);
  const visibleAiChatSessions = useMemo(
    () => (shouldShowAllAiChatSessions ? params.allChatSessions : noteAiChatSessions).filter((session) => {
      if (!aiChatSearchTerm) return true;
      return `${session.title} ${session.model ?? ''}`.toLowerCase().includes(aiChatSearchTerm);
    }),
    [aiChatSearchTerm, noteAiChatSessions, params.allChatSessions, shouldShowAllAiChatSessions],
  );
  const currentDocumentHasBackendPages = params.studyDocumentId
    ? Boolean(params.backendPageIdsByDocument[params.studyDocumentId])
    : false;

  return {
    activeAiChatSessionId,
    activeAiChatSession,
    aiChatReadOnly,
    aiMessages,
    selectionPreviewUri,
    noteAiChatSessions,
    visibleAiChatSessions,
    currentDocumentHasBackendPages,
  };
}
