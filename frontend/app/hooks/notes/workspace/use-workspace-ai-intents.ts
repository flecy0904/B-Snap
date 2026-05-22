import type { Dispatch, SetStateAction } from 'react';
import type { SelectionRect } from '../../../ui-types';

type SetState<T> = Dispatch<SetStateAction<T>>;

type WorkspaceAiIntentsParams = {
  selectionRect: SelectionRect | null;
  selectionPreviewUri: string | null;
  setAiPanelOpen: SetState<boolean>;
  setAiPanelMode: SetState<'floating' | 'sidebar'>;
  setAiQuestion: SetState<string>;
  setViewingAiChatSessionId: SetState<number | null>;
  setWorkspaceFeedback: SetState<string | null>;
  attachSelectionPreviewToAi: (selectionPreviewUri?: string | null) => void;
};

export function useWorkspaceAiIntents(params: WorkspaceAiIntentsParams) {
  const toggleAiPanel = () => {
    params.setAiPanelOpen((current) => {
      const next = !current;
      if (next) params.setViewingAiChatSessionId(null);
      return next;
    });
  };

  const askAiAboutSelection = (selectionPreviewUri?: string | null) => {
    const resolvedSelectionPreviewUri = selectionPreviewUri ?? params.selectionPreviewUri;
    if (!params.selectionRect && !resolvedSelectionPreviewUri) {
      params.setWorkspaceFeedback('AI에게 물어볼 영역을 먼저 선택해 주세요.');
      return;
    }

    params.setViewingAiChatSessionId(null);
    params.attachSelectionPreviewToAi(selectionPreviewUri);
    params.setAiPanelOpen(true);
    params.setAiQuestion((current) => current.trim() || '이 선택 영역을 설명해줘');
    params.setWorkspaceFeedback(resolvedSelectionPreviewUri
      ? '선택 영역을 AI 질문창에 첨부했습니다.'
      : '선택 영역 미리보기를 준비 중입니다. 잠시 후 질문을 보내세요.');
  };

  return {
    toggleAiPanel,
    askAiAboutSelection,
  };
}
