import React from 'react';
import { resolvePreviewImage } from '../mock-preview-images';
import { CaptureAsset, DocumentPageView, GeneratedWorkspacePage, StudyDocumentEntry, WorkspaceAttachment } from '../types';
import { InkTextAnnotation } from '../ui-types';

type SelectedPreview = { source: 'incoming' | 'attachment' | 'inbox'; assetId: string } | null;

export type DesktopNotesWorkspaceViewModelParams = {
  incomingAssetSuggestion: CaptureAsset | null;
  workspaceAttachments: WorkspaceAttachment[];
  captureInbox: CaptureAsset[];
  generatedWorkspacePages: GeneratedWorkspacePage[];
  activeGeneratedPage: GeneratedWorkspacePage | null;
  currentDocumentPage: DocumentPageView | null;
  currentPdfPage: number;
  totalDocumentPageCount: number;
  studyDocument: StudyDocumentEntry | null;
  textAnnotations: InkTextAnnotation[];
};

export function useDesktopNotesWorkspaceViewModel(params: DesktopNotesWorkspaceViewModelParams) {
  const [inboxPanelOpen, setInboxPanelOpen] = React.useState(true);
  const [workspaceDockOpen, setWorkspaceDockOpen] = React.useState(false);
  const [selectedPreview, setSelectedPreview] = React.useState<SelectedPreview>(null);

  // 자동 팝업 로직 제거됨

  const hasWorkspaceDockContent =
    params.studyDocument?.type === 'pdf' ||
    !!params.incomingAssetSuggestion ||
    params.workspaceAttachments.length > 0 ||
    params.captureInbox.length > 0 ||
    params.generatedWorkspacePages.some((value) => value.pageKind === 'memo') ||
    params.textAnnotations.length > 0;
  const showWorkspaceDock = workspaceDockOpen && hasWorkspaceDockContent;
  const generatedPagesAfterActiveInsertPage = params.activeGeneratedPage
    ? params.generatedWorkspacePages.filter((value) => value.insertAfterPage === params.activeGeneratedPage?.insertAfterPage)
    : [];
  const activeGeneratedOrdinal =
    params.activeGeneratedPage ? generatedPagesAfterActiveInsertPage.findIndex((value) => value.id === params.activeGeneratedPage?.id) + 1 : 0;
  const currentPageLabel =
    params.currentDocumentPage?.kind === 'generated'
      ? `${params.activeGeneratedPage?.insertAfterPage ?? params.currentPdfPage}-${activeGeneratedOrdinal} ${params.activeGeneratedPage?.pageKind === 'memo' ? '메모' : '정리'}`
      : `${params.currentPdfPage} / ${params.totalDocumentPageCount} · ${params.studyDocument?.type === 'pdf' ? '원본 PDF' : '빈 노트'}`;

  const previewedIncoming =
    selectedPreview?.source === 'incoming' && params.incomingAssetSuggestion?.id === selectedPreview.assetId
      ? params.incomingAssetSuggestion
      : null;
  const previewedAttachment =
    selectedPreview?.source === 'attachment'
      ? params.workspaceAttachments.find((asset) => asset.assetId === selectedPreview.assetId) ?? null
      : null;
  const previewedInbox =
    selectedPreview?.source === 'inbox'
      ? params.captureInbox.find((asset) => asset.id === selectedPreview.assetId) ?? null
      : null;

  const previewTitle = previewedIncoming?.title ?? previewedAttachment?.title ?? previewedInbox?.title ?? null;
  const previewMeta =
    previewedIncoming?.sourceDeviceLabel ??
    previewedInbox?.sourceDeviceLabel ??
    (previewedAttachment ? '판서+LLM 정리본' : null);
  const previewImage =
    resolvePreviewImage(previewedIncoming?.previewImageKey) ??
    resolvePreviewImage(previewedAttachment?.previewImageKey) ??
    resolvePreviewImage(previewedInbox?.previewImageKey) ??
    previewedIncoming?.previewImage ??
    previewedAttachment?.previewImage ??
    previewedInbox?.previewImage;

  const activeGeneratedAttachment = params.activeGeneratedPage
    ? params.workspaceAttachments.find((value) => value.generatedPageId === params.activeGeneratedPage?.id) ?? null
    : null;
  const activeGeneratedPreviewImage =
    resolvePreviewImage(params.activeGeneratedPage?.previewImageKey) ??
    resolvePreviewImage(activeGeneratedAttachment?.previewImageKey) ??
    params.activeGeneratedPage?.previewImage ??
    activeGeneratedAttachment?.previewImage;

  return {
    inboxPanelOpen,
    workspaceDockOpen,
    hasWorkspaceDockContent,
    showWorkspaceDock,
    currentPageLabel,
    previewedIncoming,
    previewedAttachment,
    previewedInbox,
    previewTitle,
    previewMeta,
    previewImage,
    activeGeneratedAttachment,
    activeGeneratedPreviewImage,
    toggleWorkspaceDock: () => setWorkspaceDockOpen((current) => !current),
    closeWorkspaceDock: () => setWorkspaceDockOpen(false),
    toggleInboxPanel: () => setInboxPanelOpen((current) => !current),
    previewAttachment: (assetId: string) => setSelectedPreview({ source: 'attachment', assetId }),
    previewInboxAsset: (assetId: string) => setSelectedPreview({ source: 'inbox', assetId }),
  };
}
