import type { Dispatch, SetStateAction } from 'react';
import { File } from 'expo-file-system';
import { requestMockAiAnswer, type MockAiAnswer } from '../../../services/mock-ai-service';
import {
  createBackendChatSession,
  deleteBackendChatSession,
  isBackendApiEnabled,
  listBackendChatMessages,
  sendBackendAiMessage,
  updateBackendChatSession,
  type BackendChatMessage,
  type BackendChatSession,
} from '../../../services/backend-api';
import type { SelectionRect } from '../../../ui-types';
import type { StudyDocumentEntry } from '../../../types';
import { buildAiChatTitle } from './ai-chat-title';
import { getAiBackendErrorMessage } from './ai-errors';

type SetState<T> = Dispatch<SetStateAction<T>>;

async function buildAiImageInputUri(uri: string | null) {
  if (!uri) return null;
  if (uri.startsWith('data:') || uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }

  const base64 = await new File(uri).base64();
  return `data:image/png;base64,${base64}`;
}

export function useAiChatActions(params: {
  studyDocumentId: number | null;
  studyDocument: StudyDocumentEntry | null;
  selectionRect: SelectionRect | null;
  selectionPreviewUri: string | null;
  currentAiPageLabel: string;
  currentAiPageNumber: number | null;
  currentDocumentHasBackendPages: boolean;
  activeAiChatSessionId: number | null;
  aiChatReadOnly: boolean;
  aiQuestion: string;
  chatSessionByDocument: Record<number, number>;
  chatSessionsByDocument: Record<number, BackendChatSession[]>;
  allChatSessions: BackendChatSession[];
  setAiAnswer: SetState<MockAiAnswer | null>;
  setAiQuestion: SetState<string>;
  setAiError: SetState<string | null>;
  setAiLoading: SetState<boolean>;
  setChatSessionByDocument: SetState<Record<number, number>>;
  setViewingAiChatSessionId: SetState<number | null>;
  setLastChatSessionByDocument: SetState<Record<number, number>>;
  setChatSessionsByDocument: SetState<Record<number, BackendChatSession[]>>;
  setAllChatSessions: SetState<BackendChatSession[]>;
  setAiMessagesBySession: SetState<Record<number, BackendChatMessage[]>>;
}) {
  const selectAiChatSession = async (sessionId: number) => {
    if (!isBackendApiEnabled()) {
      params.setAiAnswer(null);
      params.setAiQuestion('');
      params.setAiError(null);
      return;
    }

    params.setAiLoading(true);
    params.setAiError(null);
    try {
      const messages = await listBackendChatMessages(sessionId);
      const selectedSession = params.allChatSessions.find((session) => session.id === sessionId)
        ?? Object.values(params.chatSessionsByDocument).flat().find((session) => session.id === sessionId)
        ?? null;
      const targetDocumentId = selectedSession?.note_id ?? params.studyDocumentId ?? null;
      const isCurrentDocumentSession = Boolean(params.studyDocumentId && targetDocumentId === params.studyDocumentId);
      params.setViewingAiChatSessionId(isCurrentDocumentSession ? null : sessionId);
      if (isCurrentDocumentSession) {
        params.setChatSessionByDocument((current) => ({
          ...current,
          [params.studyDocumentId!]: sessionId,
        }));
        params.setLastChatSessionByDocument((current) => ({
          ...current,
          [params.studyDocumentId!]: sessionId,
        }));
      }
      params.setAiMessagesBySession((current) => ({ ...current, [sessionId]: messages }));

      const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
      const lastUser = [...messages].reverse().find((message) => message.role === 'user');
      params.setAiAnswer(lastAssistant ? {
        question: lastUser?.content ?? '이전 질문',
        response: lastAssistant.content,
        sections: [{
          title: 'AI 답변',
          body: lastAssistant.content,
        }],
        createdAt: lastAssistant.created_at,
      } : null);
    } catch (error) {
      params.setAiError(getAiBackendErrorMessage(error, 'AI 채팅 내역을 불러오지 못했습니다.'));
    } finally {
      params.setAiLoading(false);
    }
  };

  const renameAiChatSession = async (sessionId: number, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      params.setAiError('채팅방 이름을 입력해주세요.');
      return false;
    }
    if (!isBackendApiEnabled()) {
      params.setAiError('backend 연결을 확인해주세요.');
      return false;
    }

    params.setAiLoading(true);
    params.setAiError(null);
    try {
      const updated = await updateBackendChatSession({ sessionId, title: nextTitle });
      params.setAllChatSessions((current) => current.map((session) => (session.id === sessionId ? updated : session)));
      params.setChatSessionsByDocument((current) => {
        const next = { ...current };
        Object.entries(next).forEach(([documentId, sessions]) => {
          next[Number(documentId)] = sessions.map((session) => (session.id === sessionId ? updated : session));
        });
        return next;
      });
      return true;
    } catch {
      params.setAiError('채팅방 이름을 변경하지 못했습니다.');
      return false;
    } finally {
      params.setAiLoading(false);
    }
  };

  const removeAiChatSession = async (sessionId: number) => {
    if (!isBackendApiEnabled()) {
      params.setAiError('backend 연결을 확인해주세요.');
      return;
    }

    params.setAiLoading(true);
    params.setAiError(null);
    try {
      await deleteBackendChatSession(sessionId);
      const currentDocumentSessions = params.studyDocumentId ? params.chatSessionsByDocument[params.studyDocumentId] ?? [] : [];
      const nextCurrentDocumentSession = currentDocumentSessions.find((session) => session.id !== sessionId) ?? null;

      params.setAllChatSessions((current) => current.filter((session) => session.id !== sessionId));
      params.setChatSessionsByDocument((current) => {
        const next = { ...current };
        Object.entries(next).forEach(([documentId, sessions]) => {
          next[Number(documentId)] = sessions.filter((session) => session.id !== sessionId);
        });
        return next;
      });
      params.setAiMessagesBySession((current) => {
        const next = { ...current };
        delete next[sessionId];
        return next;
      });
      params.setViewingAiChatSessionId((current) => (current === sessionId ? null : current));
      params.setChatSessionByDocument((current) => {
        const next = { ...current };
        Object.entries(next).forEach(([documentId, activeSessionId]) => {
          if (activeSessionId !== sessionId) return;
          if (params.studyDocumentId && Number(documentId) === params.studyDocumentId && nextCurrentDocumentSession) {
            next[Number(documentId)] = nextCurrentDocumentSession.id;
            return;
          }
          delete next[Number(documentId)];
        });
        return next;
      });
      params.setLastChatSessionByDocument((current) => {
        const next = { ...current };
        Object.entries(next).forEach(([documentId, lastSessionId]) => {
          if (lastSessionId !== sessionId) return;
          if (params.studyDocumentId && Number(documentId) === params.studyDocumentId && nextCurrentDocumentSession) {
            next[Number(documentId)] = nextCurrentDocumentSession.id;
            return;
          }
          delete next[Number(documentId)];
        });
        return next;
      });
      if (params.activeAiChatSessionId === sessionId) {
        params.setAiAnswer(null);
        params.setAiQuestion('');
        if (nextCurrentDocumentSession) {
          void selectAiChatSession(nextCurrentDocumentSession.id);
        }
      }
    } catch {
      params.setAiError('채팅방을 삭제하지 못했습니다.');
    } finally {
      params.setAiLoading(false);
    }
  };

  const createAiChatSession = async () => {
    if (!params.studyDocumentId || !isBackendApiEnabled() || !params.currentDocumentHasBackendPages) {
      params.setAiAnswer(null);
      params.setAiQuestion('');
      params.setAiError(isBackendApiEnabled() ? null : '백엔드 서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해 주세요.');
      return;
    }

    params.setAiLoading(true);
    params.setAiError(null);
    try {
      const session = await createBackendChatSession({
        noteId: params.studyDocumentId,
        title: params.studyDocument?.title ? `${params.studyDocument.title} AI 채팅` : 'AI 채팅',
      });
      params.setChatSessionsByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: [session, ...(current[params.studyDocumentId!] ?? [])],
      }));
      params.setAllChatSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
      params.setChatSessionByDocument((current) => ({ ...current, [params.studyDocumentId!]: session.id }));
      params.setViewingAiChatSessionId(null);
      params.setAiMessagesBySession((current) => ({ ...current, [session.id]: [] }));
      params.setAiAnswer(null);
      params.setAiQuestion('');
    } catch (error) {
      params.setAiError(getAiBackendErrorMessage(error, 'AI 채팅방을 만들지 못했습니다.'));
    } finally {
      params.setAiLoading(false);
    }
  };

  const startNewAiChatSession = () => {
    if (params.studyDocumentId) {
      params.setViewingAiChatSessionId(null);
      params.setChatSessionByDocument((current) => {
        const next = { ...current };
        delete next[params.studyDocumentId!];
        return next;
      });
    }
    params.setAiAnswer(null);
    params.setAiQuestion('');
    params.setAiError(null);
  };

  const requestAiAnswer = async () => {
    if (!params.studyDocumentId) return;
    if (params.aiChatReadOnly) {
      params.setAiError('보고 있는 노트와 연결된 대화방이 아니라서 읽기만 가능합니다.');
      return;
    }

    const question = params.aiQuestion.trim() || '현재 페이지를 요약해줘';
    params.setAiLoading(true);
    params.setAiError(null);
    params.setAiQuestion('');
    let aiRequestStage: 'chat-session' | 'ai-answer' = 'ai-answer';

    try {
      let sessionId = params.chatSessionByDocument[params.studyDocumentId];
      const canUseBackendChat = isBackendApiEnabled() && (
        params.currentDocumentHasBackendPages || Boolean(sessionId)
      );

      if (canUseBackendChat) {
        if (!sessionId) {
          aiRequestStage = 'chat-session';
          const session = await createBackendChatSession({
            noteId: params.studyDocumentId,
            title: buildAiChatTitle(question, params.studyDocument?.title),
          });
          sessionId = session.id;
          params.setChatSessionByDocument((current) => ({
            ...current,
            [params.studyDocumentId!]: session.id,
          }));
          params.setViewingAiChatSessionId(null);
          params.setLastChatSessionByDocument((current) => ({
            ...current,
            [params.studyDocumentId!]: session.id,
          }));
          params.setChatSessionsByDocument((current) => ({
            ...current,
            [params.studyDocumentId!]: [session, ...(current[params.studyDocumentId!] ?? [])],
          }));
          params.setAllChatSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
        }

        aiRequestStage = 'ai-answer';
        const pendingUserMessage: BackendChatMessage = {
          id: -Date.now(),
          session_id: sessionId,
          role: 'user',
          content: question,
          model: null,
          created_at: new Date().toISOString(),
        };
        params.setAiMessagesBySession((current) => ({
          ...current,
          [sessionId]: [...(current[sessionId] ?? []), pendingUserMessage],
        }));

        const selectionImageUri = await buildAiImageInputUri(params.selectionPreviewUri);
        const response = await sendBackendAiMessage({
          sessionId,
          content: question,
          pageNumber: params.currentAiPageNumber,
          selectionImageUri,
        });
        params.setLastChatSessionByDocument((current) => ({
          ...current,
          [params.studyDocumentId!]: sessionId,
        }));
        const content = response.assistant_message.content;
        params.setAiMessagesBySession((current) => ({
          ...current,
          [sessionId]: (current[sessionId] ?? []).some((message) => message.id === pendingUserMessage.id)
            ? (current[sessionId] ?? []).flatMap((message) => (
              message.id === pendingUserMessage.id
                ? [response.user_message, response.assistant_message]
                : [message]
            ))
            : [
              ...(current[sessionId] ?? []),
              response.user_message,
              response.assistant_message,
            ],
        }));
        params.setAllChatSessions((current) => {
          const target = current.find((session) => session.id === sessionId);
          if (!target) return current;
          return [target, ...current.filter((session) => session.id !== sessionId)];
        });
        params.setAiAnswer({
          question,
          response: content,
          sections: [
            {
              title: 'AI 답변',
              body: content,
              tone: 'highlight',
            },
          ],
          createdAt: response.assistant_message.created_at,
        });
        return;
      }

      const answer = await requestMockAiAnswer({
        question,
        selectionRect: params.selectionRect,
        currentPageLabel: params.currentAiPageLabel,
      });
      params.setAiAnswer(answer);
    } catch (error) {
      params.setAiError(getAiBackendErrorMessage(
        error,
        aiRequestStage === 'chat-session'
          ? 'AI 채팅방을 만들지 못했습니다.'
          : 'AI 응답을 받아오지 못했습니다.',
      ));
    } finally {
      params.setAiLoading(false);
    }
  };

  return {
    selectAiChatSession,
    renameAiChatSession,
    removeAiChatSession,
    createAiChatSession,
    startNewAiChatSession,
    requestAiAnswer,
  };
}
