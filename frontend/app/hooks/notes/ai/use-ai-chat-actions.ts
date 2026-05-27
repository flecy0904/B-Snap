import type { Dispatch, SetStateAction } from 'react';
import * as FileSystem from 'expo-file-system/legacy';
import {
  createBackendChatSession,
  deleteBackendChatSession,
  isBackendApiEnabled,
  listBackendChatMessages,
  sendBackendAiMessage,
  updateBackendChatSession,
  type BackendAiCanvasNote,
  type BackendChatMessage,
  type BackendChatSession,
} from '../../../services/backend-api';
import type { AiAnswer, StudyDocumentEntry } from '../../../types';
import type { SelectionRect } from '../../../ui-types';
import { getStudyDocumentBackendNoteId } from '../document/backend-sync';
import { buildAiChatTitle } from './ai-chat-title';
import { getAiBackendErrorMessage } from './ai-errors';

type SetState<T> = Dispatch<SetStateAction<T>>;
type CanvasAction = 'auto' | 'chat_only' | 'canvas_edit' | 'canvas_create';

function getCanvasAction(question: string, source: 'chat' | 'canvas-mini' = 'chat'): CanvasAction {
  const lowerQuestion = question.toLowerCase();
  const createKeywords = [
    'new canvas',
    '새 canvas',
    '새 캔버스',
    '새로운 canvas',
    '새로운 캔버스',
    '별도 canvas',
    '별도 캔버스',
    '다른 canvas',
    '다른 캔버스',
    '새 정리본',
    '새 요약본',
    '새 정리 노트',
    '새 노트',
  ];
  if (createKeywords.some((keyword) => lowerQuestion.includes(keyword))) {
    return 'canvas_create';
  }

  if (source === 'canvas-mini') return 'canvas_edit';

  const mentionsCanvas = lowerQuestion.includes('canvas') || question.includes('캔버스') || question.includes('정리 노트');
  const editKeywords = [
    '적어',
    '써',
    '정리',
    '요약',
    '추가',
    '수정',
    '반영',
    '넣어',
    '만들',
    '작성',
    '고쳐',
  ];
  if (mentionsCanvas && editKeywords.some((keyword) => question.includes(keyword))) {
    return 'canvas_edit';
  }

  return 'auto';
}

function mightRequestCanvasEdit(question: string, source: 'chat' | 'canvas-mini' = 'chat') {
  if (source === 'canvas-mini') return true;
  const lowerQuestion = question.toLowerCase();
  if (getCanvasAction(question, source) === 'canvas_edit') return true;
  const possibleCanvasEditKeywords = [
    'canvas',
    '캔버스',
    '정리 노트',
    '정리',
    '요약',
    '추가',
    '작성',
    '반영',
    '수정',
    '고쳐',
    '고치',
    '바꿔',
    '바꾸',
    '다듬',
    '마무리',
    '쉽게',
    '전문',
    '짧게',
    '길게',
    '늘려',
    '줄여',
    '개선',
  ];
  return possibleCanvasEditKeywords.some((keyword) => lowerQuestion.includes(keyword));
}

export function useAiChatActions(params: {
  studyDocumentId: number | null;
  studyDocument: StudyDocumentEntry | null;
  currentDocumentHasBackendPages: boolean;
  selectionRect: SelectionRect | null;
  selectionPreviewUri: string | null;
  currentPageNumber: number | null;
  activeAiChatSessionId: number | null;
  aiChatReadOnly: boolean;
  aiQuestion: string;
  chatSessionByDocument: Record<number, number>;
  chatSessionsByDocument: Record<number, BackendChatSession[]>;
  allChatSessions: BackendChatSession[];
  setAiAnswer: SetState<AiAnswer | null>;
  setAiQuestion: SetState<string>;
  setAiError: SetState<string | null>;
  setAiLoading: SetState<boolean>;
  setAiCanvasRequestBusy?: SetState<boolean>;
  setSelectionPreviewByDocument: SetState<Record<number, string | null>>;
  setChatSessionByDocument: SetState<Record<number, number>>;
  setViewingAiChatSessionId: SetState<number | null>;
  setLastChatSessionByDocument: SetState<Record<number, number>>;
  setChatSessionsByDocument: SetState<Record<number, BackendChatSession[]>>;
  setAllChatSessions: SetState<BackendChatSession[]>;
  setAiMessagesBySession: SetState<Record<number, BackendChatMessage[]>>;
  activeCanvasNoteId?: number | null;
  activeCanvasMarkdown?: string | null;
  onApplyCanvasEditFromChat?: (payload: { action: 'canvas_edit' | 'canvas_create'; canvasNote: BackendAiCanvasNote }) => void;
  clearSelection?: () => void;
  buildContextHint?: (question: string) => string | null;
}) {
  const getCurrentBackendNoteId = () => getStudyDocumentBackendNoteId(params.studyDocument);
  const getSessionDocumentKey = (session: BackendChatSession) => {
    const backendNoteId = getCurrentBackendNoteId();
    if (params.studyDocumentId && backendNoteId === session.note_id) return params.studyDocumentId;
    return session.note_id;
  };

  const buildSelectionImagePayload = async (overrideUri?: string | null) => {
    const uri = overrideUri ?? params.selectionPreviewUri;
    if (!uri) return null;
    if (/^data:image\//i.test(uri) || /^https?:\/\//i.test(uri)) return uri;

    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      return `data:image/png;base64,${base64}`;
    } catch {
      params.setAiError('선택 이미지를 첨부하지 못했습니다. 텍스트 질문만으로 답변을 요청합니다.');
      return null;
    }
  };

  const upsertSession = (session: BackendChatSession) => {
    const documentKey = getSessionDocumentKey(session);
    params.setAllChatSessions((current) => [session, ...current.filter((item) => item.id !== session.id)]);
    params.setChatSessionsByDocument((current) => ({
      ...current,
      [documentKey]: [
        session,
        ...(current[documentKey] ?? []).filter((item) => item.id !== session.id),
      ],
    }));
  };

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
      const isCurrentDocumentSession = Boolean(params.studyDocumentId && targetDocumentId === getCurrentBackendNoteId());
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
    if (!params.studyDocumentId) {
      params.setAiAnswer(null);
      params.setAiQuestion('');
      params.setAiError('AI 채팅을 시작할 노트를 먼저 선택해 주세요.');
      return;
    }

    if (!isBackendApiEnabled()) {
      params.setAiAnswer(null);
      params.setAiQuestion('');
      params.setAiError('백엔드 서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해 주세요.');
      return;
    }

    if (!params.currentDocumentHasBackendPages) {
      params.setAiAnswer(null);
      params.setAiQuestion('');
      params.setAiError('AI 채팅은 백엔드에 저장된 노트에서 사용할 수 있습니다. 새 빈 노트나 PDF 업로드로 만든 노트에서 다시 시도해 주세요.');
      return;
    }
    const backendNoteId = getCurrentBackendNoteId();
    if (!backendNoteId) {
      params.setAiAnswer(null);
      params.setAiQuestion('');
      params.setAiError('AI 채팅은 백엔드 동기화가 끝난 노트에서 사용할 수 있습니다.');
      return;
    }

    params.setAiLoading(true);
    params.setAiError(null);
    try {
      const session = await createBackendChatSession({
        noteId: backendNoteId,
        title: params.studyDocument?.title ? `${params.studyDocument.title} AI 채팅` : 'AI 채팅',
      });
      upsertSession(session);
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

  const requestAiAnswerInternal = async (override?: {
    question?: string;
    selectionImageUri?: string | null;
    pageNumber?: number | null;
    source?: 'chat' | 'canvas-mini';
    canvasAction?: CanvasAction;
    canvasMarkdown?: string | null;
  }) => {
    if (!params.studyDocumentId) return false;
    if (params.aiChatReadOnly) {
      params.setAiError('보고 있는 노트와 연결된 대화방이 아니라서 읽기만 가능합니다.');
      return false;
    }

    const explicitSelectionImageUri = Object.prototype.hasOwnProperty.call(override ?? {}, 'selectionImageUri')
      ? override?.selectionImageUri ?? null
      : undefined;
    const selectionPreviewUri = explicitSelectionImageUri !== undefined
      ? explicitSelectionImageUri
      : override?.source === 'canvas-mini'
        ? null
        : params.selectionPreviewUri;
    const selectionRect = override?.source === 'canvas-mini' && !selectionPreviewUri
      ? null
      : params.selectionRect;
    const hasSelection = Boolean(selectionRect || selectionPreviewUri);
    const shouldHideSelectionAttachment = Boolean(selectionRect || params.selectionPreviewUri);
    const rawQuestion = override?.question?.trim() ?? params.aiQuestion.trim();
    if (override?.source === 'canvas-mini' && !rawQuestion) return false;

    const question = rawQuestion || (hasSelection ? '선택한 영역을 설명해줘' : '현재 페이지를 요약해줘');
    const canvasAction = override?.canvasAction ?? getCanvasAction(question, override?.source ?? 'chat');
    const isCanvasRequest = canvasAction === 'canvas_edit' || canvasAction === 'canvas_create';
    const shouldLockCanvas = isCanvasRequest || (
      canvasAction === 'auto' && mightRequestCanvasEdit(question, override?.source ?? 'chat')
    );
    const requestContent = override?.source === 'canvas-mini'
      ? `${canvasAction === 'canvas_create' ? '새 Canvas' : 'Canvas 수정'}: ${question}`
      : question;
    const messageSource = override?.source === 'canvas-mini' ? 'canvas-mini' : 'chat';
    const contextHint = params.buildContextHint?.(question) ?? null;
    params.setAiLoading(true);
    if (shouldLockCanvas) params.setAiCanvasRequestBusy?.(true);
    params.setAiError(null);
    params.setAiQuestion('');
    if (hasSelection && override?.source !== 'canvas-mini') {
      params.clearSelection?.();
    } else if (selectionPreviewUri && override?.source !== 'canvas-mini') {
      params.setSelectionPreviewByDocument((current) => ({ ...current, [params.studyDocumentId!]: null }));
    }
    let aiRequestStage: 'chat-session' | 'ai-answer' = 'ai-answer';

    try {
      if (!isBackendApiEnabled()) {
        params.setAiAnswer(null);
        params.setAiError('백엔드 서버에 연결할 수 없습니다. 백엔드가 실행 중인지 확인해 주세요.');
        return false;
      }

      if (!params.currentDocumentHasBackendPages) {
        params.setAiAnswer(null);
        params.setAiError('AI 채팅은 백엔드에 저장된 노트에서 사용할 수 있습니다. 새 빈 노트나 PDF 업로드로 만든 노트에서 다시 시도해 주세요.');
        return false;
      }
      const backendNoteId = getCurrentBackendNoteId();
      if (!backendNoteId) {
        params.setAiAnswer(null);
        params.setAiError('AI 채팅은 백엔드 동기화가 끝난 노트에서 사용할 수 있습니다.');
        return false;
      }

      let sessionId = params.chatSessionByDocument[params.studyDocumentId];
      if (!sessionId) {
        aiRequestStage = 'chat-session';
        const session = await createBackendChatSession({
          noteId: backendNoteId,
          title: buildAiChatTitle(requestContent, params.studyDocument?.title),
        });
        sessionId = session.id;
        params.setChatSessionByDocument((current) => ({
          ...current,
          [params.studyDocumentId!]: session.id,
        }));
        params.setLastChatSessionByDocument((current) => ({
          ...current,
          [params.studyDocumentId!]: session.id,
        }));
        upsertSession(session);
      }

      aiRequestStage = 'ai-answer';
      const pendingUserMessage: BackendChatMessage = {
        id: -Date.now(),
        session_id: sessionId,
        role: 'user',
        content: requestContent,
        source: messageSource,
        selection_image_url: shouldHideSelectionAttachment ? null : selectionPreviewUri,
        model: null,
        created_at: new Date().toISOString(),
      };
      params.setAiMessagesBySession((current) => ({
        ...current,
        [sessionId]: [...(current[sessionId] ?? []), pendingUserMessage],
      }));

      const selectionImage = await buildSelectionImagePayload(selectionPreviewUri);
      const response = await sendBackendAiMessage({
        sessionId,
        content: requestContent,
        selectionImage,
        selectionImageUri: selectionPreviewUri,
        selectionRect,
        pageNumber: override?.pageNumber ?? params.currentPageNumber,
        source: messageSource,
        canvasNoteId: canvasAction === 'canvas_create' ? null : params.activeCanvasNoteId ?? null,
        canvasAction,
        canvasNoteNeedsTitle: canvasAction === 'canvas_create',
        canvasMarkdown: canvasAction === 'canvas_edit' || (canvasAction === 'auto' && shouldLockCanvas)
          ? override?.canvasMarkdown ?? params.activeCanvasMarkdown ?? null
          : null,
        contextHint,
      });
      const userMessageWithAttachment = {
        ...response.user_message,
        selection_image_url: shouldHideSelectionAttachment ? null : selectionPreviewUri,
      };
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
              ? [userMessageWithAttachment, response.assistant_message]
              : [message]
          ))
          : [
            ...(current[sessionId] ?? []),
            userMessageWithAttachment,
            response.assistant_message,
          ],
      }));
      if (response.chat_session) {
        upsertSession(response.chat_session);
      } else {
        params.setAllChatSessions((current) => {
          const target = current.find((session) => session.id === sessionId);
          if (!target) return current;
          return [target, ...current.filter((session) => session.id !== sessionId)];
        });
      }
      params.setAiAnswer({
        question: requestContent,
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
      if (response.canvas_edit && params.onApplyCanvasEditFromChat) {
        params.onApplyCanvasEditFromChat({
          action: response.canvas_edit.action,
          canvasNote: response.canvas_edit.canvas_note,
        });
      } else if (canvasAction === 'canvas_edit' || canvasAction === 'canvas_create') {
        params.setAiError('Canvas 수정 응답을 받지 못했습니다. 백엔드 서버를 다시 실행해 주세요.');
      }
      return true;
    } catch (error) {
      params.setAiError(getAiBackendErrorMessage(
        error,
        aiRequestStage === 'chat-session'
          ? 'AI 채팅방을 만들지 못했습니다.'
          : 'AI 응답을 받아오지 못했습니다.',
      ));
      return false;
    } finally {
      if (shouldLockCanvas) params.setAiCanvasRequestBusy?.(false);
      params.setAiLoading(false);
    }
  };

  const requestAiAnswer = async (options?: {
    question?: string;
    source?: 'chat' | 'canvas-mini';
    canvasAction?: CanvasAction;
    selectionImageUri?: string | null;
    canvasMarkdown?: string | null;
  }) => requestAiAnswerInternal(options);

  const requestAiAnswerForQuestion = async (question: string, options?: {
    selectionImageUri?: string | null;
    pageNumber?: number | null;
  }) => requestAiAnswerInternal({
    question,
    selectionImageUri: options?.selectionImageUri ?? null,
    pageNumber: options?.pageNumber ?? params.currentPageNumber,
  });

  return {
    selectAiChatSession,
    renameAiChatSession,
    removeAiChatSession,
    createAiChatSession,
    startNewAiChatSession,
    requestAiAnswer,
    requestAiAnswerForQuestion,
  };
}
