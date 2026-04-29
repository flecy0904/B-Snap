import React from 'react';
import type { MockAiAnswer } from '../services/mock-ai-service';
import type { BackendChatMessage, BackendChatSession } from '../services/backend-api';
import { NoteSummarySection, BookmarkedPage, CaptureAsset, DocumentPageView, GeneratedWorkspacePage, StudyDocumentEntry, WorkspaceAttachment } from '../types';
import { InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../ui-types';

export type DesktopNotesWorkspaceContextValue = {
  styles: any;
  blueColor: string;
  aiPanelOpen: boolean;
  selectionRect: SelectionRect | null;
  selectionPreviewUri: string | null;
  aiQuestion: string;
  normalizedQuestion: string;
  aiResponse: string;
  aiResponseSections?: NoteSummarySection[] | null;
  aiAnswer: MockAiAnswer | null;
  aiMessages: BackendChatMessage[];
  aiChatSessions: BackendChatSession[];
  noteAiChatSessions: BackendChatSession[];
  allAiChatSessions: BackendChatSession[];
  aiChatScope: 'note' | 'all';
  aiChatSearchQuery: string;
  activeAiChatSessionId: number | null;
  aiLoading: boolean;
  aiError: string | null;
  inkTool: InkTool;
  penColor: string;
  penWidth: number;
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  currentPageLabel: string;
  hasWorkspaceDockContent: boolean;
  showWorkspaceDock: boolean;
  inboxPanelOpen: boolean;
  previewTitle: string | null;
  previewMeta: string | null;
  previewImage: any;
  previewedIncoming: CaptureAsset | null;
  previewedAttachment: WorkspaceAttachment | null;
  previewedInbox: CaptureAsset | null;
  workspaceAttachments: WorkspaceAttachment[];
  bookmarks: BookmarkedPage[];
  currentPageBookmarked: boolean;
  memoPages: GeneratedWorkspacePage[];
  captureInbox: CaptureAsset[];
  studyDocument: StudyDocumentEntry;
  currentDocumentPages: DocumentPageView[];
  currentPdfPage: number;
  currentDocumentPage: DocumentPageView | null;
  activeGeneratedPage: GeneratedWorkspacePage | null;
  pageListOpen: boolean;
  setPageListOpen: (open: boolean) => void;
  activeGeneratedAttachment: WorkspaceAttachment | null;
  activeGeneratedPreviewImage?: number;
  onToggleAiPanel: () => void;
  onChangeAiQuestion: (value: string) => void;
  onChangeAiChatScope: (scope: 'note' | 'all') => void;
  onChangeAiChatSearchQuery: (value: string) => void;
  onSelectAiChatSession: (sessionId: number) => void;
  onRenameAiChatSession: (sessionId: number, title: string) => Promise<boolean>;
  onRemoveAiChatSession: (sessionId: number) => void;
  onStartNewAiChatSession: () => void;
  onCreateAiChatSession: () => void;
  onRequestAiAnswer: () => void;
  onInsertAiAnswerPage: () => void;
  onGoToPreviousDocumentPage: () => void;
  onGoToNextDocumentPage: () => void;
  onChangeInkTool: (tool: InkTool) => void;
  onChangePenColor: (color: string) => void;
  onChangePenWidth: (width: number) => void;
  onUndoInk: () => void;
  onRedoInk: () => void;
  onClearInk: () => void;
  onToggleWorkspaceDock: () => void;
  onCloseWorkspaceDock: () => void;
  onToggleInboxPanel: () => void;
  onAcceptIncomingAsset: () => void;
  onDismissIncomingAsset: () => void;
  onOpenWorkspaceAttachment: (attachmentId: string) => void;
  onOpenGeneratedPage: (pageId: string) => void;
  onRemoveWorkspaceAttachment: (attachmentId: string) => void;
  onToggleBookmarkCurrentPage: () => void;
  onOpenBookmarkedPage: (bookmarkId: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onExportCurrentDocument: () => void;
  onRemoveGeneratedPage: (pageId: string) => void;
  onCreateMemoPage: () => void;
  onInsertInboxAsset: (assetId: string) => void;
  onRemoveInboxAsset: (assetId: string) => void;
  onPreviewAttachment: (assetId: string, attachmentId: string) => void;
  onPreviewInboxAsset: (assetId: string) => void;
  onCommitInkStroke: (stroke: InkStroke) => void;
  onRemoveInkStroke: (strokeId: string) => void;
  onAddTextAnnotation: (point: InkPoint) => void;
  onUpdateTextAnnotation: (id: string, text: string) => void;
  onRemoveTextAnnotation: (id: string) => void;
  onSelectionChange: (rect: SelectionRect | null) => void;
  onSelectionPreviewChange: (uri: string | null) => void;
  deleteSelectedStrokes: () => void;
  changeSelectedStrokesColor: (color: string) => void;
  onSetCurrentPdfPage: (pageNumber: number) => void;
  onUpdateStudyDocumentPageCount: (pageCount: number) => void;
};

const DesktopNotesWorkspaceContext = React.createContext<DesktopNotesWorkspaceContextValue | null>(null);

export function DesktopNotesWorkspaceProvider(props: {
  value: DesktopNotesWorkspaceContextValue;
  children: React.ReactNode;
}) {
  return <DesktopNotesWorkspaceContext.Provider value={props.value}>{props.children}</DesktopNotesWorkspaceContext.Provider>;
}

export function useDesktopNotesWorkspaceContext() {
  const context = React.useContext(DesktopNotesWorkspaceContext);
  if (!context) {
    throw new Error('DesktopNotesWorkspaceContext is not available.');
  }
  return context;
}
