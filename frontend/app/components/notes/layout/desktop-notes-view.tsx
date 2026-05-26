import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, PanResponder, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { subjects as allSubjects } from '../../../app-defaults';
import { useDesktopNotesWorkspaceViewModel } from '../../../hooks/notes/use-desktop-notes-workspace-view-model';
import { buildAiResponse, NoteSummaryContent } from '../shared/notes-shared';
import { NotesAiAssistantPanel } from '../ai/notes-ai-assistant-panel';
import { NotesAiCanvasPanel } from '../ai-canvas/notes-ai-canvas-panel';
import { NotesDocumentViewer } from '../workspace/notes-document-viewer';
import { NotesWorkspaceToolbar, NotesPageListOverlay } from '../workspace/notes-workspace-toolbar';
import { NotesWorkspaceDock } from '../workspace/notes-workspace-dock';
import { NotesDetailHeader } from './notes-detail-header';
import { NotesBrowser } from './notes-browser';
import { DesktopNotesWorkspaceProvider, useDesktopNotesWorkspaceContext } from '../workspace/notes-workspace-context';
import type { BackendChatMessage, BackendChatSession, BackendClassInsight } from '../../../services/backend-api';
import type { UseAiCanvasNotesResult } from '../../../hooks/notes/ai-canvas/use-ai-canvas-notes';
import type { AppChatMode, AppRightSidebarPanel, WorkspaceFocusTarget } from '../../../hooks/notes/use-study-workspace';
import {
  AiAnswer,
  CaptureAsset,
  BookmarkedPage,
  DocumentPageView,
  GeneratedWorkspacePage,
  NotebookPage,
  NoteEntry,
  NoteWorkspaceMode,
  PageCaptureReference,
  StudyDocumentEntry,
  Subject,
  WorkspaceAttachment,
} from '../../../types';
import { InkBrush, InkBrushSettings, InkLinePattern, InkPoint, InkSelectionMode, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';

const APP_RIGHT_SIDEBAR_MIN_WIDTH = 320;
const APP_RIGHT_SIDEBAR_MAX_WIDTH = 560;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function AppRightSidebar() {
  const workspace = useDesktopNotesWorkspaceContext();
  const { width } = useWindowDimensions();
  const widthRef = React.useRef(workspace.appRightSidebarWidth);
  const maxWidth = Math.max(APP_RIGHT_SIDEBAR_MIN_WIDTH, Math.min(APP_RIGHT_SIDEBAR_MAX_WIDTH, Math.floor(width * 0.48)));

  React.useEffect(() => {
    widthRef.current = clamp(workspace.appRightSidebarWidth, APP_RIGHT_SIDEBAR_MIN_WIDTH, maxWidth);
  }, [maxWidth, workspace.appRightSidebarWidth]);

  const resizePanResponder = React.useMemo(
    () => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 3,
      onPanResponderMove: (_, gesture) => {
        workspace.onChangeAppRightSidebarWidth(clamp(widthRef.current - gesture.dx, APP_RIGHT_SIDEBAR_MIN_WIDTH, maxWidth));
      },
      onPanResponderRelease: (_, gesture) => {
        const next = clamp(widthRef.current - gesture.dx, APP_RIGHT_SIDEBAR_MIN_WIDTH, maxWidth);
        widthRef.current = next;
        workspace.onChangeAppRightSidebarWidth(next);
      },
      onPanResponderTerminate: (_, gesture) => {
        const next = clamp(widthRef.current - gesture.dx, APP_RIGHT_SIDEBAR_MIN_WIDTH, maxWidth);
        widthRef.current = next;
        workspace.onChangeAppRightSidebarWidth(next);
      },
    }),
    [maxWidth, workspace],
  );

  if (!workspace.appRightSidebarPanel) return null;

  return (
    <View style={[workspace.styles.appRightSidebar, { width: clamp(workspace.appRightSidebarWidth, APP_RIGHT_SIDEBAR_MIN_WIDTH, maxWidth) }]}>
      <View style={workspace.styles.appRightSidebarResizeHandle} {...resizePanResponder.panHandlers}>
        <View style={workspace.styles.appRightSidebarResizeGrip}>
          <View style={workspace.styles.appRightSidebarResizeDot} />
          <View style={workspace.styles.appRightSidebarResizeDot} />
          <View style={workspace.styles.appRightSidebarResizeDot} />
        </View>
      </View>
      <View style={workspace.styles.appRightSidebarBody}>
        {workspace.appRightSidebarPanel === 'chat' ? <NotesAiAssistantPanel /> : <NotesAiCanvasPanel />}
      </View>
    </View>
  );
}

export type DesktopNotesViewProps = {
  compact: boolean;
  subject: Subject | null;
  note: NoteEntry | null;
  studyDocument: StudyDocumentEntry | null;
  notes: NoteEntry[];
  allNotes: NoteEntry[];
  deletedNotes: NoteEntry[];
  noteMode: NoteWorkspaceMode;
  studyDocuments: StudyDocumentEntry[];
  allStudyDocuments: StudyDocumentEntry[];
  deletedStudyDocuments: StudyDocumentEntry[];
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
  aiError: string | null;
  aiCanvas: UseAiCanvasNotesResult;
  classInsight: BackendClassInsight | null;
  incomingAssetSuggestion: CaptureAsset | null;
  inboxHint: string | null;
  inboxPendingCount: number;
  workspaceFeedback: string | null;
  documentSaveStatus: string;
  captureAssetsBySubject: Record<number, CaptureAsset[]>;
  captureInbox: CaptureAsset[];
  workspaceAttachments: WorkspaceAttachment[];
  pageCaptureReferences: PageCaptureReference[];
  allPageCaptureReferences: PageCaptureReference[];
  currentPageCaptureReferences: PageCaptureReference[];
  bookmarks: BookmarkedPage[];
  currentPageBookmarked: boolean;
  generatedWorkspacePages: GeneratedWorkspacePage[];
  memoPages: GeneratedWorkspacePage[];
  activeGeneratedPage: GeneratedWorkspacePage | null;
  currentDocumentPage: DocumentPageView | null;
  currentPdfPage: number;
  currentDocumentPages: DocumentPageView[];
  notebookPages: NotebookPage[];
  currentDocumentPageIndex: number;
  totalDocumentPageCount: number;
  subjects: Subject[];
  query: string;
  sort: 'latest' | 'oldest';
  onChangeMode: (mode: NoteWorkspaceMode) => void;
  onChangeInkTool: (tool: InkTool) => void;
  onToggleFingerDrawing: () => void;
  onChangePenColor: (color: string) => void;
  onChangePenWidth: (width: number) => void;
  onChangeBrushType: (brush: InkBrush) => void;
  onChangeLinePattern: (pattern: InkLinePattern) => void;
  onChangeSelectionMode: (mode: InkSelectionMode) => void;
  onChangeBrushSettings: (settings: Partial<InkBrushSettings>) => void;
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
  onSelectionChange: (rect: SelectionRect | null) => void;
  onSelectionPreviewChange: (uri: string | null) => void;
  onCopySelectionImage: () => void;
  onClearSelection: () => void;
  onUndoInk: () => void;
  onRedoInk: () => void;
  onClearInk: () => void;
  deleteSelectedStrokes: () => void;
  changeSelectedStrokesColor: (color: string) => void;
  duplicateSelectedStrokes: () => void;
  resizeSelectedStrokes: (scale: number) => void;
  resizeSelectedStrokesToRect: (rect: SelectionRect) => void;
  nudgeSelectedStrokes: (dx: number, dy: number) => void;
  onCommitInkStroke: (stroke: InkStroke) => void;
  onRemoveInkStroke: (strokeId: string) => void;
  onAddTextAnnotation: (point: InkPoint) => void;
  onUpdateTextAnnotation: (id: string, text: string) => void;
  onRemoveTextAnnotation: (id: string) => void;
  onMoveTextAnnotation: (id: string, x: number, y: number) => void;
  onResizeTextAnnotation: (id: string, width: number, height: number) => void;
  onEraseInkAtPoint: (point: InkPoint, radius: number, snapshot?: boolean) => boolean;
  onAcceptIncomingAsset: () => void;
  onArchiveIncomingAsset: () => void;
  onDismissIncomingAsset: () => void;
  onInsertInboxAsset: (assetId: string) => void;
  onRemoveInboxAsset: (assetId: string) => void;
  onRemoveCaptureAsset: (assetId: string) => void;
  onLinkCaptureAssetToPage: (assetId: string, documentId: number, pageNumber: number) => boolean;
  onOpenPageCaptureReference: (referenceId: string) => void;
  onMovePageCaptureReference: (referenceId: string, delta: -1 | 1) => void;
  onMovePageCaptureReferenceToPage: (referenceId: string, pageNumber: number) => void;
  onRemovePageCaptureReference: (referenceId: string) => void;
  onAskAiAboutPageCaptureReference: (referenceId: string) => void;
  onRemoveWorkspaceAttachment: (attachmentId: string) => void;
  onToggleBookmarkCurrentPage: () => void;
  onOpenBookmarkedPage: (bookmarkId: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onExportCurrentDocument: () => void;
  onOpenWorkspaceAttachment: (attachmentId: string) => void;
  onOpenGeneratedPage: (pageId: string) => void;
  onRemoveGeneratedPage: (pageId: string) => void;
  onDuplicateGeneratedPage: (pageId: string) => void;
  onMoveGeneratedPage: (pageId: string, delta: -1 | 1) => void;
  onDuplicatePdfPage: (pageNumber?: number) => void;
  onRemovePdfPage: (pageNumber?: number) => void;
  onMovePdfPage: (pageNumber: number | undefined, delta: -1 | 1) => void;
  onCreateMemoPage: (insertAfterPage?: number) => void;
  onQuery: (value: string) => void;
  onSort: () => void;
  onOpenStudyDocument: (id: number | null) => void;
  onOpenNote: (id: number) => void;
  onOpenSubject: (id: number) => void;
  onDeleteNote: (id: number) => void;
  onDeleteStudyDocument: (id: number) => void;
  onRestoreNote: (id: number) => void;
  onRestoreStudyDocument: (id: number) => void;
  onRenameStudyDocument: (id: number, title: string) => boolean;
  onCreateBlankNote: () => void;
  onUploadPdf: () => void;
  onUpdateStudyDocumentPageCount: (pageCount: number) => void;
  onReset: () => void;
  onSetCurrentPdfPage: (pageNumber: number) => void;
  onGoToPreviousDocumentPage: () => void;
  onGoToNextDocumentPage: () => void;
  styles: any;
  blueColor: string;
  isWeb?: boolean;
};

export function DesktopNotesView(props: DesktopNotesViewProps) {
  const [pageListOpen, setPageListOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [focusMode, setFocusMode] = React.useState(false);
  const isNativeWideApp = props.isWeb === false;
  const showAppRightSidebar = isNativeWideApp && props.appRightSidebarPanel !== null;
  const showFloatingChat = !focusMode && (
    isNativeWideApp
      ? props.appChatMode === 'floating' && props.aiPanelOpen
      : props.aiPanelMode === 'floating'
  );
  const { normalizedQuestion, aiResponse, aiResponseSections } = buildAiResponse(props.aiQuestion, props.selectionRect, true);
  const workspace = useDesktopNotesWorkspaceViewModel({
    incomingAssetSuggestion: props.incomingAssetSuggestion,
    workspaceAttachments: props.workspaceAttachments,
    pageCaptureReferences: props.pageCaptureReferences,
    currentPageCaptureReferences: props.currentPageCaptureReferences,
    captureInbox: props.captureInbox,
    generatedWorkspacePages: props.generatedWorkspacePages,
    activeGeneratedPage: props.activeGeneratedPage,
    currentDocumentPage: props.currentDocumentPage,
    currentPdfPage: props.currentPdfPage,
    totalDocumentPageCount: props.totalDocumentPageCount,
    studyDocument: props.studyDocument,
    textAnnotations: props.textAnnotations,
  });

  React.useEffect(() => {
    setRenameOpen(false);
    setRenameDraft('');
    setFocusMode(false);
    setPageListOpen(false);
  }, [props.studyDocument?.id]);

  React.useEffect(() => {
    if (!isNativeWideApp || !props.studyDocument || props.appChatMode !== 'sidebar' || props.appRightSidebarPanel !== 'chat' || props.aiPanelOpen) return;
    props.onOpenAppChatSidebar();
  }, [isNativeWideApp, props.appChatMode, props.appRightSidebarPanel, props.aiPanelOpen, props.onOpenAppChatSidebar, props.studyDocument]);

  const toggleFocusMode = () => {
    setFocusMode((current) => !current);
    setRenameOpen(false);
    setPageListOpen(false);
  };

  const startRename = () => {
    if (!props.studyDocument) return;
    setRenameDraft(props.studyDocument.title);
    setRenameOpen(true);
  };

  const saveRename = () => {
    if (!props.studyDocument) return;
    if (props.onRenameStudyDocument(props.studyDocument.id, renameDraft)) {
      setRenameOpen(false);
    }
  };

  if (props.noteMode === 'photo' && props.note) {
    const note = props.note;
    const subject = props.subjects.find((item) => item.id === note.subjectId) ?? allSubjects.find((item) => item.id === note.subjectId);
    if (!subject) return null;

    return (
      <View style={props.styles.fill}>
        <NotesDetailHeader
          styles={props.styles}
          compact={props.compact}
          caption={subject.name}
          title={note.title}
          onBack={() => props.onOpenSubject(subject.id)}
          rightAction={
            <Pressable style={[props.styles.libraryDeleteButton, props.styles.headerIconButton]} onPress={() => props.onDeleteNote(note.id)}>
              <MaterialCommunityIcons name="trash-can-outline" size={18} color="#C04B4B" />
            </Pressable>
          }
        />
        <View style={props.styles.desktopDetailBody}>
          <View style={[props.styles.desktopImagePanel, props.compact && props.styles.desktopImagePanelCompact]}>
            <Image source={note.image} style={[props.styles.desktopDetailImage, props.compact && props.styles.desktopDetailImageCompact]} resizeMode="cover" />
          </View>
          <ScrollView style={props.styles.desktopSummaryPanel} contentContainerStyle={[props.styles.desktopSummaryPanelInner, props.compact && props.styles.desktopSummaryPanelInnerCompact]}>
            <NoteSummaryContent note={note} subject={subject} styles={props.styles} />
          </ScrollView>
        </View>
      </View>
    );
  }

  if (props.noteMode === 'note' && props.studyDocument && props.subject) {
    return (
      <DesktopNotesWorkspaceProvider
        value={{
          styles: props.styles,
          blueColor: props.blueColor,
          usesAppAiPanelLayout: isNativeWideApp,
          isAppChatSidebarPanel: isNativeWideApp && props.appRightSidebarPanel === 'chat' && props.appChatMode === 'sidebar',
          isAppAiCanvasSidebarPanel: isNativeWideApp && props.appRightSidebarPanel === 'canvas',
          aiPanelOpen: props.aiPanelOpen,
          aiPanelMode: isNativeWideApp && props.appChatMode === 'sidebar' && props.appRightSidebarPanel === 'chat' ? 'sidebar' : props.aiPanelMode,
          appRightSidebarPanel: props.appRightSidebarPanel,
          appChatMode: props.appChatMode,
          appRightSidebarWidth: props.appRightSidebarWidth,
          focusedWorkspaceTarget: props.focusedWorkspaceTarget,
          canUndoFocusedWorkspaceAction: props.canUndoFocusedWorkspaceAction,
          canRedoFocusedWorkspaceAction: props.canRedoFocusedWorkspaceAction,
          selectionRect: props.selectionRect,
          selectionPreviewUri: props.selectionPreviewUri,
          copiedSelectionImageUri: props.copiedSelectionImageUri,
          aiQuestion: props.aiQuestion,
          normalizedQuestion,
          aiResponse,
          aiResponseSections,
          aiAnswer: props.aiAnswer,
          aiMessages: props.aiMessages,
          aiChatSessions: props.aiChatSessions,
          noteAiChatSessions: props.noteAiChatSessions,
          allAiChatSessions: props.allAiChatSessions,
          aiChatScope: props.aiChatScope,
          aiChatSearchQuery: props.aiChatSearchQuery,
          activeAiChatSessionId: props.activeAiChatSessionId,
          aiChatReadOnly: props.aiChatReadOnly,
          aiLoading: props.aiLoading,
          aiError: props.aiError,
          aiCanvas: props.aiCanvas,
          classInsight: props.classInsight,
          inkTool: props.inkTool,
          fingerDrawingEnabled: props.fingerDrawingEnabled,
          penColor: props.penColor,
          penWidth: props.penWidth,
          brushType: props.brushType,
          linePattern: props.linePattern,
          selectionMode: props.selectionMode,
          brushSettings: props.brushSettings,
          inkStrokes: props.inkStrokes,
          textAnnotations: props.textAnnotations,
          inkByDocument: props.inkByDocument,
          textAnnotationsByDocument: props.textAnnotationsByDocument,
          currentPageLabel: workspace.currentPageLabel,
          hasWorkspaceDockContent: workspace.hasWorkspaceDockContent,
          showWorkspaceDock: workspace.showWorkspaceDock,
          inboxPanelOpen: workspace.inboxPanelOpen,
          previewTitle: workspace.previewTitle,
          previewMeta: workspace.previewMeta,
          previewImage: workspace.previewImage,
          previewedIncoming: workspace.previewedIncoming,
          previewedAttachment: workspace.previewedAttachment,
          previewedInbox: workspace.previewedInbox,
          previewedPageReference: workspace.previewedPageReference,
          incomingAssetSuggestion: props.incomingAssetSuggestion,
          workspaceAttachments: props.workspaceAttachments,
          pageCaptureReferences: props.pageCaptureReferences,
          currentPageCaptureReferences: props.currentPageCaptureReferences,
          bookmarks: props.bookmarks,
          currentPageBookmarked: props.currentPageBookmarked,
          memoPages: props.memoPages,
          captureInbox: props.captureInbox,
          subject: props.subject,
          studyDocumentId: props.studyDocument.id,
          studyDocument: props.studyDocument,
          noteWorkspaceMode: props.noteMode,
          subjects: props.subjects,
          query: props.query,
          sort: props.sort,
          currentDocumentPages: props.currentDocumentPages,
          notebookPages: props.notebookPages,
          currentPdfPage: props.currentPdfPage,
          currentDocumentPage: props.currentDocumentPage,
          currentDocumentPageIndex: props.currentDocumentPageIndex,
          totalDocumentPageCount: props.totalDocumentPageCount,
          generatedWorkspacePages: props.generatedWorkspacePages,
          activeGeneratedPage: props.activeGeneratedPage,
          pageListOpen,
          setPageListOpen,
          focusMode,
          onToggleFocusMode: toggleFocusMode,
          activeGeneratedAttachment: workspace.activeGeneratedAttachment,
          activeGeneratedPreviewImage: workspace.activeGeneratedPreviewImage,
          onToggleAiPanel: props.onToggleAiPanel,
          onChangeAiPanelMode: props.onChangeAiPanelMode,
          onOpenAppChatSidebar: props.onOpenAppChatSidebar,
          onOpenAppAiCanvasSidebar: props.onOpenAppAiCanvasSidebar,
          onCloseAppRightSidebar: props.onCloseAppRightSidebar,
          onFloatAppAiChatPanel: props.onFloatAppAiChatPanel,
          onDockAppAiChatPanel: props.onDockAppAiChatPanel,
          onChangeAppRightSidebarWidth: props.onChangeAppRightSidebarWidth,
          onFocusWorkspaceTarget: props.onFocusWorkspaceTarget,
          onUndoFocusedWorkspaceAction: props.onUndoFocusedWorkspaceAction,
          onRedoFocusedWorkspaceAction: props.onRedoFocusedWorkspaceAction,
          onChangeAiQuestion: props.onChangeAiQuestion,
          onChangeAiChatScope: props.onChangeAiChatScope,
          onLoadAllAiChatSessions: props.onLoadAllAiChatSessions,
          onChangeAiChatSearchQuery: props.onChangeAiChatSearchQuery,
          onSelectAiChatSession: props.onSelectAiChatSession,
          onRenameAiChatSession: props.onRenameAiChatSession,
          onRemoveAiChatSession: props.onRemoveAiChatSession,
          onStartNewAiChatSession: props.onStartNewAiChatSession,
          onCreateAiChatSession: props.onCreateAiChatSession,
          onRequestAiAnswer: props.onRequestAiAnswer,
          onAskAiAboutSelection: props.onAskAiAboutSelection,
          onRequestAiCanvasCommand: props.onRequestAiCanvasCommand,
          onInsertAiAnswerPage: props.onInsertAiAnswerPage,
          onGoToPreviousDocumentPage: props.onGoToPreviousDocumentPage,
          onGoToNextDocumentPage: props.onGoToNextDocumentPage,
          onChangeInkTool: props.onChangeInkTool,
          onToggleFingerDrawing: props.onToggleFingerDrawing,
          onChangePenColor: props.onChangePenColor,
          onChangePenWidth: props.onChangePenWidth,
          onChangeBrushType: props.onChangeBrushType,
          onChangeLinePattern: props.onChangeLinePattern,
          onChangeSelectionMode: props.onChangeSelectionMode,
          onChangeBrushSettings: props.onChangeBrushSettings,
          onUndoInk: props.onUndoInk,
          onRedoInk: props.onRedoInk,
          onClearInk: props.onClearInk,
          onToggleWorkspaceDock: workspace.toggleWorkspaceDock,
          onCloseWorkspaceDock: workspace.closeWorkspaceDock,
          onToggleInboxPanel: workspace.toggleInboxPanel,
          onAcceptIncomingAsset: props.onAcceptIncomingAsset,
          onArchiveIncomingAsset: props.onArchiveIncomingAsset,
          onDismissIncomingAsset: props.onDismissIncomingAsset,
          onOpenWorkspaceAttachment: props.onOpenWorkspaceAttachment,
          onOpenGeneratedPage: props.onOpenGeneratedPage,
          onRemoveWorkspaceAttachment: props.onRemoveWorkspaceAttachment,
          onToggleBookmarkCurrentPage: props.onToggleBookmarkCurrentPage,
          onOpenBookmarkedPage: props.onOpenBookmarkedPage,
          onRemoveBookmark: props.onRemoveBookmark,
          onExportCurrentDocument: props.onExportCurrentDocument,
          onRemoveGeneratedPage: props.onRemoveGeneratedPage,
          onDuplicateGeneratedPage: props.onDuplicateGeneratedPage,
          onMoveGeneratedPage: props.onMoveGeneratedPage,
          onDuplicatePdfPage: props.onDuplicatePdfPage,
          onRemovePdfPage: props.onRemovePdfPage,
          onMovePdfPage: props.onMovePdfPage,
          onCreateMemoPage: props.onCreateMemoPage,
          onInsertInboxAsset: props.onInsertInboxAsset,
          onRemoveInboxAsset: props.onRemoveInboxAsset,
          onLinkCaptureAssetToPage: props.onLinkCaptureAssetToPage,
          onOpenPageCaptureReference: props.onOpenPageCaptureReference,
          onMovePageCaptureReference: props.onMovePageCaptureReference,
          onMovePageCaptureReferenceToPage: props.onMovePageCaptureReferenceToPage,
          onRemovePageCaptureReference: props.onRemovePageCaptureReference,
          onAskAiAboutPageCaptureReference: props.onAskAiAboutPageCaptureReference,
          onPreviewAttachment: (assetId, attachmentId) => {
            workspace.previewAttachment(assetId);
            props.onOpenWorkspaceAttachment(attachmentId);
          },
          onPreviewInboxAsset: workspace.previewInboxAsset,
          onPreviewPageReference: workspace.previewPageReference,
          onCommitInkStroke: props.onCommitInkStroke,
          onRemoveInkStroke: props.onRemoveInkStroke,
          onAddTextAnnotation: props.onAddTextAnnotation,
          onUpdateTextAnnotation: props.onUpdateTextAnnotation,
          onRemoveTextAnnotation: props.onRemoveTextAnnotation,
          onMoveTextAnnotation: props.onMoveTextAnnotation,
          onResizeTextAnnotation: props.onResizeTextAnnotation,
          onEraseInkAtPoint: props.onEraseInkAtPoint,
          onSelectionChange: props.onSelectionChange,
          onSelectionPreviewChange: props.onSelectionPreviewChange,
          onCopySelectionImage: props.onCopySelectionImage,
          onClearSelection: props.onClearSelection,
          deleteSelectedStrokes: props.deleteSelectedStrokes,
          changeSelectedStrokesColor: props.changeSelectedStrokesColor,
          duplicateSelectedStrokes: props.duplicateSelectedStrokes,
          resizeSelectedStrokes: props.resizeSelectedStrokes,
          resizeSelectedStrokesToRect: props.resizeSelectedStrokesToRect,
          nudgeSelectedStrokes: props.nudgeSelectedStrokes,
          onSetCurrentPdfPage: props.onSetCurrentPdfPage,
          onUpdateStudyDocumentPageCount: props.onUpdateStudyDocumentPageCount,
        }}
      >
        <View style={props.styles.fill}>
          {focusMode ? (
            <View style={props.styles.notebookFocusBar}>
              <Pressable style={props.styles.notebookFocusBackButton} onPress={() => props.onOpenStudyDocument(null)}>
                <MaterialCommunityIcons name="chevron-left" size={24} color="#151A22" />
              </Pressable>
              <Text style={props.styles.notebookFocusTitle} numberOfLines={1}>{props.studyDocument.title}</Text>
              <View style={props.styles.notebookSaveStatusPill}>
                <MaterialCommunityIcons name="cloud-check-outline" size={14} color="#5D6A7C" />
                <Text style={props.styles.notebookSaveStatusText} numberOfLines={1}>{props.documentSaveStatus}</Text>
              </View>
              <Pressable style={[props.styles.notebookFocusBackButton, props.styles.inkToolButtonActive]} onPress={toggleFocusMode}>
                <MaterialCommunityIcons name="fullscreen-exit" size={18} color="#4F68D2" />
              </Pressable>
            </View>
          ) : (
          <View style={props.styles.notebookTitleBar}>
            <Pressable style={props.styles.notebookTitleButton} onPress={() => props.onOpenStudyDocument(null)}>
              <MaterialCommunityIcons name="chevron-left" size={24} color="#151A22" />
            </Pressable>
            <Text style={props.styles.notebookTitleText} numberOfLines={1}>
              {props.studyDocument.title}
            </Text>
            <View style={props.styles.notebookTitleActions}>
              <View style={props.styles.notebookSaveStatusPill}>
                <MaterialCommunityIcons name="cloud-check-outline" size={14} color="#5D6A7C" />
                <Text style={props.styles.notebookSaveStatusText} numberOfLines={1}>{props.documentSaveStatus}</Text>
              </View>
              <Pressable style={props.styles.notebookTitleButton} onPress={startRename}>
                <MaterialCommunityIcons name="pencil-outline" size={18} color="#4F68D2" />
              </Pressable>
              <Pressable style={[props.styles.notebookTitleButton, props.styles.notebookTitleButtonDanger]} onPress={() => props.onDeleteStudyDocument(props.studyDocument!.id)}>
                <MaterialCommunityIcons name="trash-can-outline" size={18} color="#C04B4B" />
              </Pressable>
            </View>
          </View>
          )}
          {renameOpen && !focusMode ? (
            <View style={props.styles.documentRenamePanel}>
              <TextInput
                value={renameDraft}
                onChangeText={setRenameDraft}
                placeholder="문서 제목"
                placeholderTextColor="#A2AAB8"
                style={props.styles.documentRenameInput}
                returnKeyType="done"
                onSubmitEditing={saveRename}
              />
              <Pressable style={props.styles.documentRenameButton} onPress={() => setRenameOpen(false)}>
                <Text style={props.styles.documentRenameButtonText}>취소</Text>
              </Pressable>
              <Pressable style={[props.styles.documentRenameButton, props.styles.documentRenameButtonPrimary]} onPress={saveRename}>
                <Text style={[props.styles.documentRenameButtonText, props.styles.documentRenameButtonTextPrimary]}>저장</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={[props.styles.desktopDocumentDetailBody, focusMode && props.styles.desktopDocumentDetailBodyFocus]}>
            {showFloatingChat ? <NotesAiAssistantPanel /> : null}
            <NotesWorkspaceToolbar />
            {props.workspaceFeedback ? (
              <View style={props.styles.workspaceToast}>
                <MaterialCommunityIcons name="check-circle-outline" size={16} color="#4D67D8" />
                <Text style={props.styles.workspaceToastText}>{props.workspaceFeedback}</Text>
              </View>
            ) : null}
            <View
              style={[
                props.styles.desktopDocumentSidebarContentRow,
                !isNativeWideApp && !focusMode && props.styles.desktopDocumentSidebarContentRowGapped,
                focusMode && props.styles.desktopDocumentSidebarContentRowFocus,
              ]}
            >
              {!focusMode && !isNativeWideApp && props.aiPanelMode === 'sidebar' ? <NotesAiAssistantPanel /> : null}
              <View
                style={[props.styles.desktopDocumentViewerPane, focusMode && props.styles.desktopDocumentViewerPaneFocus]}
                onTouchStart={() => props.onFocusWorkspaceTarget('document')}
              >
                {!focusMode && workspace.showWorkspaceDock ? <NotesWorkspaceDock /> : null}
                <NotesDocumentViewer />
              </View>
              {!focusMode && showAppRightSidebar ? (
                <AppRightSidebar />
              ) : !focusMode && !isNativeWideApp && props.aiCanvas.isOpen ? (
                <NotesAiCanvasPanel />
              ) : null}
            </View>
          </View>
        </View>
        <NotesPageListOverlay />
      </DesktopNotesWorkspaceProvider>
    );
  }

  return (
    <NotesBrowser
      styles={props.styles}
      compact={props.compact}
      noteMode={props.noteMode}
      query={props.query}
      sort={props.sort}
      subjects={props.subjects}
      selectedSubject={props.subject}
      notes={props.notes}
      allNotes={props.allNotes}
      deletedNotes={props.deletedNotes}
      studyDocuments={props.studyDocuments}
      allStudyDocuments={props.allStudyDocuments}
      deletedStudyDocuments={props.deletedStudyDocuments}
      captureAssetsBySubject={props.captureAssetsBySubject}
      pageCaptureReferences={props.allPageCaptureReferences}
      blueColor={props.blueColor}
      onChangeMode={props.onChangeMode}
      onQuery={props.onQuery}
      onSort={props.onSort}
      onCreateBlankNote={props.onCreateBlankNote}
      onUploadPdf={props.onUploadPdf}
      onReset={props.onReset}
      onOpenSubject={props.onOpenSubject}
      onOpenNote={props.onOpenNote}
      onOpenStudyDocument={props.onOpenStudyDocument}
      onDeleteNote={props.onDeleteNote}
      onDeleteStudyDocument={props.onDeleteStudyDocument}
      onRestoreNote={props.onRestoreNote}
      onRestoreStudyDocument={props.onRestoreStudyDocument}
      onInsertInboxAsset={props.onInsertInboxAsset}
      onLinkCaptureAssetToPage={props.onLinkCaptureAssetToPage}
      onOpenPageCaptureReference={props.onOpenPageCaptureReference}
      onAskAiAboutPageCaptureReference={props.onAskAiAboutPageCaptureReference}
      onRemoveCaptureAsset={props.onRemoveCaptureAsset}
    />
  );
}
