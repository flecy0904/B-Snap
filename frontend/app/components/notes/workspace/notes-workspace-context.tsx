import React from 'react';
import type { BackendChatMessage, BackendChatSession, BackendClassInsight } from '../../../services/backend-api';
import type { UseAiCanvasNotesResult } from '../../../hooks/notes/ai-canvas/use-ai-canvas-notes';
import type { AppChatMode, AppRightSidebarPanel, WorkspaceFocusTarget } from '../../../hooks/notes/use-study-workspace';
import { AiAnswer, NoteSummarySection, BookmarkedPage, CaptureAsset, DocumentPageView, GeneratedWorkspacePage, NotebookPage, NoteWorkspaceMode, PageCaptureReference, StudyDocumentEntry, Subject, WorkspaceAttachment } from '../../../types';
import { InkBrush, InkBrushSettings, InkLinePattern, InkPoint, InkSelectionMode, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { CanvasProvider } from '../canvas/canvas-context';
import { DocumentProvider } from './document-context';
import { NavigationProvider } from './navigation-context';
import { NotesGlobalProvider } from './notes-global-context';

export type DesktopNotesWorkspaceContextValue = {
  styles: any;
  blueColor: string;
  usesAppAiPanelLayout: boolean;
  isAppChatSidebarPanel: boolean;
  isAppAiCanvasSidebarPanel: boolean;
  aiPanelOpen: boolean;
  aiPanelMode: 'floating' | 'sidebar';
  appRightSidebarPanel: AppRightSidebarPanel;
  appChatMode: AppChatMode;
  appRightSidebarWidth: number;
  focusedWorkspaceTarget: WorkspaceFocusTarget | null;
  canUndoFocusedWorkspaceAction: boolean;
  canRedoFocusedWorkspaceAction: boolean;
  selectionRect: SelectionRect | null;
  selectionPreviewUri: string | null;
  copiedSelectionImageUri: string | null;
  aiQuestion: string;
  normalizedQuestion: string;
  aiResponse: string;
  aiResponseSections?: NoteSummarySection[] | null;
  aiAnswer: AiAnswer | null;
  aiMessages: BackendChatMessage[];
  aiChatSessions: BackendChatSession[];
  noteAiChatSessions: BackendChatSession[];
  allAiChatSessions: BackendChatSession[];
  aiChatScope: 'note' | 'all';
  aiChatSearchQuery: string;
  activeAiChatSessionId: number | null;
  aiChatReadOnly: boolean;
  aiLoading: boolean;
  aiCanvasRequestBusy: boolean;
  aiError: string | null;
  aiCanvas: UseAiCanvasNotesResult;
  classInsight: BackendClassInsight | null;
  inkTool: InkTool;
  fingerDrawingEnabled: boolean;
  penColor: string;
  penWidth: number;
  brushType: InkBrush;
  linePattern: InkLinePattern;
  selectionMode: InkSelectionMode;
  brushSettings: InkBrushSettings;
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  inkByDocument: Record<number, InkStroke[]>;
  textAnnotationsByDocument: Record<number, InkTextAnnotation[]>;
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
  previewedPageReference: PageCaptureReference | null;
  incomingAssetSuggestion: CaptureAsset | null;
  workspaceAttachments: WorkspaceAttachment[];
  pageCaptureReferences: PageCaptureReference[];
  currentPageCaptureReferences: PageCaptureReference[];
  bookmarks: BookmarkedPage[];
  currentPageBookmarked: boolean;
  memoPages: GeneratedWorkspacePage[];
  captureInbox: CaptureAsset[];
  subject: Subject;
  studyDocumentId: number;
  studyDocument: StudyDocumentEntry;
  noteWorkspaceMode: NoteWorkspaceMode;
  subjects: Subject[];
  query: string;
  sort: 'latest' | 'oldest';
  currentDocumentPages: DocumentPageView[];
  notebookPages: NotebookPage[];
  currentPdfPage: number;
  currentDocumentPage: DocumentPageView | null;
  currentDocumentPageIndex: number;
  totalDocumentPageCount: number;
  generatedWorkspacePages: GeneratedWorkspacePage[];
  activeGeneratedPage: GeneratedWorkspacePage | null;
  pageListOpen: boolean;
  setPageListOpen: (open: boolean) => void;
  focusMode: boolean;
  onToggleFocusMode: () => void;
  activeGeneratedAttachment: WorkspaceAttachment | null;
  activeGeneratedPreviewImage?: number;
  onToggleAiPanel: () => void;
  onChangeAiPanelMode: (mode: 'floating' | 'sidebar') => void;
  onOpenAppChatSidebar: () => void;
  onOpenAppAiCanvasSidebar: () => void;
  onCloseAppRightSidebar: () => void;
  onFloatAppAiChatPanel: () => void;
  onDockAppAiChatPanel: () => void;
  onChangeAppRightSidebarWidth: (width: number) => void;
  onFocusWorkspaceTarget: (target: WorkspaceFocusTarget | null) => void;
  onUndoFocusedWorkspaceAction: () => void;
  onRedoFocusedWorkspaceAction: () => void;
  onChangeAiQuestion: (value: string) => void;
  onChangeAiChatScope: (scope: 'note' | 'all') => void;
  onLoadAllAiChatSessions: () => void;
  onChangeAiChatSearchQuery: (value: string) => void;
  onSelectAiChatSession: (sessionId: number) => void;
  onRenameAiChatSession: (sessionId: number, title: string) => Promise<boolean>;
  onRemoveAiChatSession: (sessionId: number) => void;
  onStartNewAiChatSession: () => void;
  onCreateAiChatSession: () => void;
  onRequestAiAnswer: () => void;
  onAskAiAboutSelection: () => void;
  onRequestAiCanvasCommand: (command: string, options?: { selectionImageUri?: string | null }) => Promise<boolean>;
  onInsertAiAnswerPage: () => void;
  onGoToPreviousDocumentPage: () => void;
  onGoToNextDocumentPage: () => void;
  onChangeInkTool: (tool: InkTool) => void;
  onToggleFingerDrawing: () => void;
  onChangePenColor: (color: string) => void;
  onChangePenWidth: (width: number) => void;
  onChangeBrushType: (brush: InkBrush) => void;
  onChangeLinePattern: (pattern: InkLinePattern) => void;
  onChangeSelectionMode: (mode: InkSelectionMode) => void;
  onChangeBrushSettings: (settings: Partial<InkBrushSettings>) => void;
  onUndoInk: () => void;
  onRedoInk: () => void;
  onClearInk: () => void;
  onToggleWorkspaceDock: () => void;
  onCloseWorkspaceDock: () => void;
  onToggleInboxPanel: () => void;
  onAcceptIncomingAsset: () => void;
  onArchiveIncomingAsset: () => void;
  onDismissIncomingAsset: () => void;
  onOpenWorkspaceAttachment: (attachmentId: string) => void;
  onOpenGeneratedPage: (pageId: string) => void;
  onRemoveWorkspaceAttachment: (attachmentId: string) => void;
  onToggleBookmarkCurrentPage: () => void;
  onOpenBookmarkedPage: (bookmarkId: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onExportCurrentDocument: () => void;
  onRemoveGeneratedPage: (pageId: string) => void;
  onDuplicateGeneratedPage: (pageId: string) => void;
  onMoveGeneratedPage: (pageId: string, delta: -1 | 1) => void;
  onDuplicatePdfPage: (pageNumber?: number) => void;
  onRemovePdfPage: (pageNumber?: number) => void;
  onMovePdfPage: (pageNumber: number | undefined, delta: -1 | 1) => void;
  onCreateMemoPage: (insertAfterPage?: number) => void;
  onInsertInboxAsset: (assetId: string) => void;
  onRemoveInboxAsset: (assetId: string) => void;
  onLinkCaptureAssetToPage: (assetId: string, documentId: number, pageNumber: number) => boolean;
  onOpenPageCaptureReference: (referenceId: string) => void;
  onMovePageCaptureReference: (referenceId: string, delta: -1 | 1) => void;
  onMovePageCaptureReferenceToPage: (referenceId: string, pageNumber: number) => void;
  onRemovePageCaptureReference: (referenceId: string) => void;
  onAskAiAboutPageCaptureReference: (referenceId: string) => void;
  onPreviewAttachment: (assetId: string, attachmentId: string) => void;
  onPreviewInboxAsset: (assetId: string) => void;
  onPreviewPageReference: (referenceId: string) => void;
  onCommitInkStroke: (stroke: InkStroke) => void;
  onRemoveInkStroke: (strokeId: string) => void;
  onAddTextAnnotation: (point: InkPoint) => void;
  onUpdateTextAnnotation: (id: string, text: string) => void;
  onRemoveTextAnnotation: (id: string) => void;
  onMoveTextAnnotation: (id: string, x: number, y: number) => void;
  onResizeTextAnnotation: (id: string, width: number, height: number) => void;
  onEraseInkAtPoint: (point: InkPoint, radius: number, snapshot?: boolean) => boolean;
  onSelectionChange: (rect: SelectionRect | null) => void;
  onSelectionPreviewChange: (uri: string | null) => void;
  onCopySelectionImage: () => void;
  onClearSelection: () => void;
  deleteSelectedStrokes: () => void;
  changeSelectedStrokesColor: (color: string) => void;
  duplicateSelectedStrokes: () => void;
  resizeSelectedStrokes: (scale: number) => void;
  resizeSelectedStrokesToRect: (rect: SelectionRect) => void;
  nudgeSelectedStrokes: (dx: number, dy: number) => void;
  onSetCurrentPdfPage: (pageNumber: number) => void;
  onUpdateStudyDocumentPageCount: (pageCount: number) => void;
};

const DesktopNotesWorkspaceContext = React.createContext<DesktopNotesWorkspaceContextValue | null>(null);

export function DesktopNotesWorkspaceProvider(props: {
  value: DesktopNotesWorkspaceContextValue;
  children: React.ReactNode;
}) {
  return (
    <DesktopNotesWorkspaceContext.Provider value={props.value}>
      <NotesGlobalProvider value={props.value}>
        <NavigationProvider>
          <DocumentProvider>
            <CanvasProvider>{props.children}</CanvasProvider>
          </DocumentProvider>
        </NavigationProvider>
      </NotesGlobalProvider>
    </DesktopNotesWorkspaceContext.Provider>
  );
}

export function useDesktopNotesWorkspaceContext() {
  const context = React.useContext(DesktopNotesWorkspaceContext);
  if (!context) {
    throw new Error('DesktopNotesWorkspaceContext is not available.');
  }
  return context;
}
