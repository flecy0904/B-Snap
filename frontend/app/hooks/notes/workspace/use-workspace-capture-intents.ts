import type { Dispatch, SetStateAction } from 'react';
import type {
  BookmarkedPage,
  CaptureAsset,
  DocumentPageView,
  GeneratedWorkspacePage,
  NoteWorkspaceMode,
  WorkspaceAttachment,
} from '../../../types';

type SetState<T> = Dispatch<SetStateAction<T>>;

type WorkspaceCaptureIntentsParams = {
  studyDocumentId: number | null;
  incomingAssetSuggestion: CaptureAsset | null;
  incomingBannerQueue: CaptureAsset[];
  captureInbox: CaptureAsset[];
  attachmentsByDocument: Record<number, WorkspaceAttachment[]>;
  generatedPagesByDocument: Record<number, GeneratedWorkspacePage[]>;
  activePageByDocument: Record<number, DocumentPageView>;
  onOpenNotesTab: () => void;
  updateAssetStatus: (assetId: string, nextStatus: CaptureAsset['status']) => void;
  findCaptureAssetById: (assetId: string) => CaptureAsset | null;
  linkCaptureAssetToCurrentPage: (asset: CaptureAsset) => Promise<void>;
  setSubjectId: SetState<number | null>;
  setNoteId: SetState<number | null>;
  setNoteWorkspaceMode: SetState<NoteWorkspaceMode>;
  setStudyDocumentId: SetState<number | null>;
  setIncomingAssetSuggestion: SetState<CaptureAsset | null>;
  setIncomingBannerQueue: SetState<CaptureAsset[]>;
  setWorkspaceFeedback: SetState<string | null>;
  setAttachmentsByDocument: SetState<Record<number, WorkspaceAttachment[]>>;
  setGeneratedPagesByDocument: SetState<Record<number, GeneratedWorkspacePage[]>>;
  setBookmarksByDocument: SetState<Record<number, BookmarkedPage[]>>;
  setActivePageByDocument: SetState<Record<number, DocumentPageView>>;
  setCurrentPdfPageByDocument: SetState<Record<number, number>>;
};

export function useWorkspaceCaptureIntents(params: WorkspaceCaptureIntentsParams) {
  const acceptIncomingAsset = () => {
    if (!params.incomingAssetSuggestion) return;
    void params.linkCaptureAssetToCurrentPage(params.incomingAssetSuggestion);
  };

  const archiveIncomingAsset = () => {
    if (!params.incomingAssetSuggestion) return;
    params.updateAssetStatus(params.incomingAssetSuggestion.id, 'archived');
    params.setWorkspaceFeedback('자료를 보관함으로 넘겼습니다.');
    params.setIncomingAssetSuggestion(null);
  };

  const dismissIncomingAsset = () => {
    if (!params.incomingAssetSuggestion) return;
    params.updateAssetStatus(params.incomingAssetSuggestion.id, 'dismissed');
    params.setWorkspaceFeedback('이번 제안은 숨겼습니다.');
    params.setIncomingAssetSuggestion(null);
  };

  const insertInboxAsset = (assetId: string) => {
    const asset = params.captureInbox.find((value) => value.id === assetId) ?? params.findCaptureAssetById(assetId);
    if (!asset) return;
    void params.linkCaptureAssetToCurrentPage(asset);
  };

  const removeInboxAsset = (assetId: string) => {
    const asset = params.captureInbox.find((value) => value.id === assetId);
    if (!asset) return;
    params.updateAssetStatus(asset.id, 'dismissed');
    if (params.incomingAssetSuggestion?.id === asset.id) {
      params.setIncomingAssetSuggestion(null);
    }
    params.setWorkspaceFeedback('inbox에서 자료를 삭제했습니다.');
  };

  const removeWorkspaceAttachment = (attachmentId: string) => {
    if (!params.studyDocumentId) return;
    const target = (params.attachmentsByDocument[params.studyDocumentId] ?? []).find((attachment) => attachment.id === attachmentId);
    if (!target) return;
    const linkedGeneratedPage = target.generatedPageId
      ? (params.generatedPagesByDocument[params.studyDocumentId] ?? []).find((page) => page.id === target.generatedPageId) ?? null
      : null;

    params.setAttachmentsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((attachment) => attachment.id !== attachmentId),
    }));
    if (target.generatedPageId) {
      params.setGeneratedPagesByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((page) => page.id !== target.generatedPageId),
      }));
      params.setBookmarksByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((bookmark) => bookmark.page.kind !== 'generated' || bookmark.page.pageId !== target.generatedPageId),
      }));
    }
    const activePage = params.activePageByDocument[params.studyDocumentId];
    if (linkedGeneratedPage && activePage?.kind === 'generated' && activePage.pageId === linkedGeneratedPage.id) {
      params.setActivePageByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: { kind: 'pdf', pageNumber: linkedGeneratedPage.insertAfterPage },
      }));
      params.setCurrentPdfPageByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: linkedGeneratedPage.insertAfterPage,
      }));
    }
    params.updateAssetStatus(target.assetId, 'archived');
    params.setWorkspaceFeedback('추가한 정리 페이지를 삭제했습니다.');
  };

  const openWorkspaceAttachment = (attachmentId: string) => {
    if (!params.studyDocumentId) return;
    const target = (params.attachmentsByDocument[params.studyDocumentId] ?? []).find((attachment) => attachment.id === attachmentId);
    if (!target?.generatedPageId) return;
    params.setActivePageByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: { kind: 'generated', pageId: target.generatedPageId! },
    }));
  };

  const dismissIncomingBanner = () => {
    params.setIncomingBannerQueue((current) => current.slice(1));
  };

  const openIncomingBanner = () => {
    const asset = params.incomingBannerQueue[0];
    if (!asset) return;

    params.onOpenNotesTab();
    params.setSubjectId(asset.subjectId);
    params.setNoteWorkspaceMode(asset.type === 'image' ? 'photo' : 'note');
    params.setNoteId(null);
    params.setStudyDocumentId(null);
    params.setWorkspaceFeedback(asset.type === 'image' ? 'Photo 라이브러리에서 원본 사진을 확인할 수 있습니다.' : 'PDF 자료를 inbox에서 확인할 수 있습니다.');
    params.setIncomingBannerQueue((current) => current.slice(1));
  };

  return {
    acceptIncomingAsset,
    archiveIncomingAsset,
    dismissIncomingAsset,
    insertInboxAsset,
    removeInboxAsset,
    removeWorkspaceAttachment,
    openWorkspaceAttachment,
    dismissIncomingBanner,
    openIncomingBanner,
  };
}
