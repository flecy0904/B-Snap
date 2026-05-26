import React, { createContext, useContext, useState, useMemo } from 'react';
import type { AiAnswer } from '../../../types';
import type { BackendChatMessage, BackendChatSession } from '../../../services/backend-api';
import { useAiChatActions } from '../../../hooks/notes/ai/use-ai-chat-actions';
import { isBackendApiEnabled } from '../../../services/backend-api';
import { useNotesGlobalContext } from '../workspace/notes-global-context';

export type AiChatState = {
  aiPanelOpen: boolean;
  aiQuestion: string;
  aiAnswer: AiAnswer | null;
  aiMessages: BackendChatMessage[];
  aiChatSessions: BackendChatSession[];
  allAiChatSessions: BackendChatSession[];
  aiChatScope: 'note' | 'all';
  aiChatSearchQuery: string;
  activeAiChatSessionId: number | null;
  aiLoading: boolean;
  aiError: string | null;
};

export type AiChatActions = {
  setAiPanelOpen: (open: boolean) => void;
  toggleAiPanel: () => void;
  setAiQuestion: (question: string) => void;
  setAiChatScope: (scope: 'note' | 'all') => void;
  setAiChatSearchQuery: (query: string) => void;
  selectAiChatSession: (sessionId: number) => Promise<void>;
  renameAiChatSession: (sessionId: number, title: string) => Promise<boolean>;
  removeAiChatSession: (sessionId: number) => Promise<void>;
  createAiChatSession: () => Promise<void>;
  startNewAiChatSession: () => void;
  requestAiAnswer: () => Promise<boolean>;
};

const AiChatContext = createContext<(AiChatState & AiChatActions) | null>(null);

export function AiChatProvider({ children }: { children: React.ReactNode }) {
  const globalContext = useNotesGlobalContext();
  const studyDocumentId = globalContext?.studyDocument?.id ?? null;
  const studyDocument = globalContext?.studyDocument ?? null;
  const currentDocumentHasBackendPages = true; // Simplified for extraction

  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState<AiAnswer | null>(null);
  const [aiChatScope, setAiChatScope] = useState<'note' | 'all'>('note');
  const [aiChatSearchQuery, setAiChatSearchQuery] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const [chatSessionByDocument, setChatSessionByDocument] = useState<Record<number, number>>({});
  const [lastChatSessionByDocument, setLastChatSessionByDocument] = useState<Record<number, number>>({});
  const [chatSessionsByDocument, setChatSessionsByDocument] = useState<Record<number, BackendChatSession[]>>({});
  const [allChatSessions, setAllChatSessions] = useState<BackendChatSession[]>([]);
  const [aiMessagesBySession, setAiMessagesBySession] = useState<Record<number, BackendChatMessage[]>>({});
  const [, setSelectionPreviewByDocument] = useState<Record<number, string | null>>({});
  const [viewingAiChatSessionId, setViewingAiChatSessionId] = useState<number | null>(null);

  const activeAiChatSessionId = viewingAiChatSessionId ?? (studyDocumentId ? chatSessionByDocument[studyDocumentId] ?? null : null);
  const aiMessages = activeAiChatSessionId ? aiMessagesBySession[activeAiChatSessionId] ?? [] : [];

  const noteAiChatSessions = useMemo(() => {
    if (!studyDocumentId) return [];
    return chatSessionsByDocument[studyDocumentId] ?? [];
  }, [studyDocumentId, chatSessionsByDocument]);

  const visibleAiChatSessions = useMemo(() => {
    const list = aiChatScope === 'note' ? noteAiChatSessions : allChatSessions;
    if (!aiChatSearchQuery) return list;
    const lowerQuery = aiChatSearchQuery.toLowerCase();
    return list.filter((session) => session.title.toLowerCase().includes(lowerQuery));
  }, [aiChatScope, noteAiChatSessions, allChatSessions, aiChatSearchQuery]);

  const actions = useAiChatActions({
    studyDocumentId,
    studyDocument,
    currentDocumentHasBackendPages,
    selectionRect: null,
    selectionPreviewUri: null,
    currentPageNumber: null,
    activeAiChatSessionId,
    aiChatReadOnly: false,
    aiQuestion,
    chatSessionByDocument,
    chatSessionsByDocument,
    allChatSessions,
    setAiAnswer,
    setAiQuestion,
    setAiError,
    setAiLoading,
    setSelectionPreviewByDocument,
    setChatSessionByDocument,
    setViewingAiChatSessionId,
    setLastChatSessionByDocument,
    setChatSessionsByDocument,
    setAllChatSessions,
    setAiMessagesBySession,
  });

  const value = {
    aiPanelOpen,
    aiQuestion,
    aiAnswer,
    aiMessages,
    aiChatSessions: visibleAiChatSessions,
    allAiChatSessions: allChatSessions,
    aiChatScope,
    aiChatSearchQuery,
    activeAiChatSessionId,
    aiLoading,
    aiError,
    setAiPanelOpen,
    toggleAiPanel: () => setAiPanelOpen((prev) => !prev),
    setAiQuestion,
    setAiChatScope,
    setAiChatSearchQuery,
    ...actions,
  };

  return <AiChatContext.Provider value={value}>{children}</AiChatContext.Provider>;
}

export function useAiChatContext() {
  const context = useContext(AiChatContext);
  if (!context) {
    throw new Error('useAiChatContext must be used within an AiChatProvider');
  }
  return context;
}
