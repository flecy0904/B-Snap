import React from 'react';
import { resolvePreviewImage } from '../../preview-images';
import { CaptureAsset, DocumentPageView, GeneratedWorkspacePage, PageCaptureReference, StudyDocumentEntry, WorkspaceAttachment } from '../../types';
import { InkTextAnnotation } from '../../ui-types';
import { derivePreprocessedCropUrl } from '../../ui-helpers';

type SelectedPreview = { source: 'incoming' | 'attachment' | 'inbox' | 'page-reference'; assetId: string } | null;

export type DesktopNotesWorkspaceViewModelParams = {
  incomingAssetSuggestion: CaptureAsset | null;
  workspaceAttachments: WorkspaceAttachment[];
  pageCaptureReferences: PageCaptureReference[];
  currentPageCaptureReferences: PageCaptureReference[];
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

  React.useEffect(() => {
    if (!params.incomingAssetSuggestion) return;
    setSelectedPreview({ source: 'incoming', assetId: params.incomingAssetSuggestion.id });
  }, [params.incomingAssetSuggestion?.id]);

  const hasWorkspaceDockContent =
    params.studyDocument?.type === 'pdf' ||
    !!params.incomingAssetSuggestion ||
    params.pageCaptureReferences.length > 0 ||
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
  const totalPageCount = Math.max(params.totalDocumentPageCount, params.studyDocument?.pageCount ?? 0, 1);
  const currentPageLabel =
    params.currentDocumentPage?.kind === 'generated'
      ? `${params.activeGeneratedPage?.insertAfterPage ?? params.currentPdfPage}-${activeGeneratedOrdinal} ${params.activeGeneratedPage?.pageKind === 'memo' ? '메모' : '정리'}`
      : `${params.currentPdfPage} / ${totalPageCount} · ${params.studyDocument?.type === 'pdf' ? '원본 PDF' : params.studyDocument?.type === 'image' ? '이미지 노트' : '빈 노트'}`;

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
  const previewedPageReference =
    selectedPreview?.source === 'page-reference'
      ? params.pageCaptureReferences.find((reference) => reference.id === selectedPreview.assetId) ?? null
      : null;

  const previewTitle = previewedIncoming?.title ?? previewedAttachment?.title ?? previewedInbox?.title ?? previewedPageReference?.title ?? null;
  const previewMeta =
    previewedIncoming?.sourceDeviceLabel ??
    previewedInbox?.sourceDeviceLabel ??
    previewedPageReference?.pageLabel ??
    (previewedAttachment ? '판서+LLM 정리본' : null);
  const previewUri =
    derivePreprocessedCropUrl(previewedIncoming?.processedUrl) ??
    previewedIncoming?.thumbnailUrl ??
    previewedIncoming?.processedUrl ??
    (previewedIncoming?.type === 'image' ? previewedIncoming.fileUrl : undefined) ??
    derivePreprocessedCropUrl(previewedAttachment?.processedUrl) ??
    previewedAttachment?.thumbnailUrl ??
    previewedAttachment?.processedUrl ??
    (previewedAttachment?.type === 'image' ? previewedAttachment.fileUrl : undefined) ??
    derivePreprocessedCropUrl(previewedInbox?.processedUrl) ??
    previewedInbox?.thumbnailUrl ??
    previewedInbox?.processedUrl ??
    (previewedInbox?.type === 'image' ? previewedInbox.fileUrl : undefined) ??
    derivePreprocessedCropUrl(previewedPageReference?.processedUrl) ??
    previewedPageReference?.thumbnailUrl ??
    previewedPageReference?.processedUrl ??
    (previewedPageReference?.type === 'image' ? previewedPageReference.fileUrl : undefined);
  const previewImage =
    (previewUri ? { uri: previewUri } : null) ??
    resolvePreviewImage(previewedIncoming?.previewImageKey) ??
    resolvePreviewImage(previewedAttachment?.previewImageKey) ??
    resolvePreviewImage(previewedInbox?.previewImageKey) ??
    resolvePreviewImage(previewedPageReference?.previewImageKey) ??
    previewedIncoming?.previewImage ??
    previewedAttachment?.previewImage ??
    previewedInbox?.previewImage ??
    previewedPageReference?.previewImage;

  const activeGeneratedAttachment = params.activeGeneratedPage
    ? params.workspaceAttachments.find((value) => value.generatedPageId === params.activeGeneratedPage?.id) ?? null
    : null;
  const activeGeneratedCropPreviewUri = derivePreprocessedCropUrl(activeGeneratedAttachment?.processedUrl);
  const activeGeneratedPreviewImage =
    (activeGeneratedCropPreviewUri ? { uri: activeGeneratedCropPreviewUri } : null) ??
    (params.activeGeneratedPage?.thumbnailUrl ? { uri: params.activeGeneratedPage.thumbnailUrl } : null) ??
    (params.activeGeneratedPage?.processedUrl ? { uri: params.activeGeneratedPage.processedUrl } : null) ??
    (activeGeneratedAttachment?.thumbnailUrl ? { uri: activeGeneratedAttachment.thumbnailUrl } : null) ??
    (activeGeneratedAttachment?.processedUrl ? { uri: activeGeneratedAttachment.processedUrl } : null) ??
    (activeGeneratedAttachment?.type === 'image' && activeGeneratedAttachment.fileUrl ? { uri: activeGeneratedAttachment.fileUrl } : null) ??
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
    previewedPageReference,
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
    previewPageReference: (referenceId: string) => setSelectedPreview({ source: 'page-reference', assetId: referenceId }),
  };
}
