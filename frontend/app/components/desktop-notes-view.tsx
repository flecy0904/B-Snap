import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { subjects as allSubjects } from '../data';
import { useDesktopNotesWorkspaceViewModel } from '../hooks/use-desktop-notes-workspace-view-model';
import { buildAiResponse, NoteSummaryContent } from './notes-shared';
import { NotesAiAssistantPanel } from './notes-ai-assistant-panel';
import { NotesDocumentViewer } from './notes-document-viewer';
import { NotesWorkspaceToolbar, NotesPageListOverlay } from './notes-workspace-toolbar';
import { NotesWorkspaceDock } from './notes-workspace-dock';
import { NotesDetailHeader } from './notes-detail-header';
import { NotesBrowser } from './notes-browser';
import { DesktopNotesWorkspaceProvider } from './notes-workspace-context';
import type { MockAiAnswer } from '../services/mock-ai-service';
import type { BackendChatMessage, BackendChatSession } from '../services/backend-api';
import {
  CaptureAsset,
  BookmarkedPage,
  DocumentPageView,
  GeneratedWorkspacePage,
  NoteEntry,
  NoteWorkspaceMode,
  StudyDocumentEntry,
  Subject,
  WorkspaceAttachment,
} from '../types';
import { InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../ui-types';

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
  penColor: string;
  penWidth: number;
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  aiPanelOpen: boolean;
  selectionRect: SelectionRect | null;
  aiQuestion: string;
  aiAnswer: MockAiAnswer | null;
  aiMessages: BackendChatMessage[];
  aiChatSessions: BackendChatSession[];
  noteAiChatSessions: BackendChatSession[];
  allAiChatSessions: BackendChatSession[];
  aiChatScope: 'note' | 'all';
  activeAiChatSessionId: number | null;
  aiLoading: boolean;
  aiError: string | null;
  incomingAssetSuggestion: CaptureAsset | null;
  inboxHint: string | null;
  inboxPendingCount: number;
  workspaceFeedback: string | null;
  captureInbox: CaptureAsset[];
  workspaceAttachments: WorkspaceAttachment[];
  bookmarks: BookmarkedPage[];
  currentPageBookmarked: boolean;
  generatedWorkspacePages: GeneratedWorkspacePage[];
  memoPages: GeneratedWorkspacePage[];
  activeGeneratedPage: GeneratedWorkspacePage | null;
  currentDocumentPage: DocumentPageView | null;
  currentPdfPage: number;
  currentDocumentPages: DocumentPageView[];
  currentDocumentPageIndex: number;
  totalDocumentPageCount: number;
  subjects: Subject[];
  query: string;
  sort: 'latest' | 'oldest';
  onChangeMode: (mode: NoteWorkspaceMode) => void;
  onChangeInkTool: (tool: InkTool) => void;
  onChangePenColor: (color: string) => void;
  onChangePenWidth: (width: number) => void;
  onToggleAiPanel: () => void;
  onChangeAiQuestion: (value: string) => void;
  onChangeAiChatScope: (scope: 'note' | 'all') => void;
  onSelectAiChatSession: (sessionId: number) => void;
  onCreateAiChatSession: () => void;
  onRequestAiAnswer: () => void;
  onInsertAiAnswerPage: () => void;
  onSelectionChange: (rect: SelectionRect | null) => void;
  onUndoInk: () => void;
  onRedoInk: () => void;
  onClearInk: () => void;
  deleteSelectedStrokes: () => void;
  changeSelectedStrokesColor: (color: string) => void;
  onCommitInkStroke: (stroke: InkStroke) => void;
  onRemoveInkStroke: (strokeId: string) => void;
  onAddTextAnnotation: (point: InkPoint) => void;
  onUpdateTextAnnotation: (id: string, text: string) => void;
  onRemoveTextAnnotation: (id: string) => void;
  onAcceptIncomingAsset: () => void;
  onArchiveIncomingAsset: () => void;
  onDismissIncomingAsset: () => void;
  onInsertInboxAsset: (assetId: string) => void;
  onRemoveInboxAsset: (assetId: string) => void;
  onRemoveWorkspaceAttachment: (attachmentId: string) => void;
  onToggleBookmarkCurrentPage: () => void;
  onOpenBookmarkedPage: (bookmarkId: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onExportCurrentDocument: () => void;
  onOpenWorkspaceAttachment: (attachmentId: string) => void;
  onOpenGeneratedPage: (pageId: string) => void;
  onRemoveGeneratedPage: (pageId: string) => void;
  onCreateMemoPage: () => void;
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
  const { normalizedQuestion, aiResponse, aiResponseSections } = buildAiResponse(props.aiQuestion, props.selectionRect, true);
  const workspace = useDesktopNotesWorkspaceViewModel({
    incomingAssetSuggestion: props.incomingAssetSuggestion,
    workspaceAttachments: props.workspaceAttachments,
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
  }, [props.studyDocument?.id]);

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
          aiPanelOpen: props.aiPanelOpen,
          selectionRect: props.selectionRect,
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
          activeAiChatSessionId: props.activeAiChatSessionId,
          aiLoading: props.aiLoading,
          aiError: props.aiError,
          inkTool: props.inkTool,
          penColor: props.penColor,
          penWidth: props.penWidth,
          inkStrokes: props.inkStrokes,
          textAnnotations: props.textAnnotations,
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
          workspaceAttachments: props.workspaceAttachments,
          bookmarks: props.bookmarks,
          currentPageBookmarked: props.currentPageBookmarked,
          memoPages: props.memoPages,
          captureInbox: props.captureInbox,
          studyDocument: props.studyDocument,
          currentDocumentPages: props.currentDocumentPages,
          currentPdfPage: props.currentPdfPage,
          currentDocumentPage: props.currentDocumentPage,
          activeGeneratedPage: props.activeGeneratedPage,
          pageListOpen,
          setPageListOpen,
          activeGeneratedAttachment: workspace.activeGeneratedAttachment,
          activeGeneratedPreviewImage: workspace.activeGeneratedPreviewImage,
          onToggleAiPanel: props.onToggleAiPanel,
          onChangeAiQuestion: props.onChangeAiQuestion,
          onChangeAiChatScope: props.onChangeAiChatScope,
          onSelectAiChatSession: props.onSelectAiChatSession,
          onCreateAiChatSession: props.onCreateAiChatSession,
          onRequestAiAnswer: props.onRequestAiAnswer,
          onInsertAiAnswerPage: props.onInsertAiAnswerPage,
          onGoToPreviousDocumentPage: props.onGoToPreviousDocumentPage,
          onGoToNextDocumentPage: props.onGoToNextDocumentPage,
          onChangeInkTool: props.onChangeInkTool,
          onChangePenColor: props.onChangePenColor,
          onChangePenWidth: props.onChangePenWidth,
          onUndoInk: props.onUndoInk,
          onRedoInk: props.onRedoInk,
          onClearInk: props.onClearInk,
          onToggleWorkspaceDock: workspace.toggleWorkspaceDock,
          onCloseWorkspaceDock: workspace.closeWorkspaceDock,
          onToggleInboxPanel: workspace.toggleInboxPanel,
          onAcceptIncomingAsset: props.onAcceptIncomingAsset,
          onDismissIncomingAsset: props.onDismissIncomingAsset,
          onOpenWorkspaceAttachment: props.onOpenWorkspaceAttachment,
          onOpenGeneratedPage: props.onOpenGeneratedPage,
          onRemoveWorkspaceAttachment: props.onRemoveWorkspaceAttachment,
          onToggleBookmarkCurrentPage: props.onToggleBookmarkCurrentPage,
          onOpenBookmarkedPage: props.onOpenBookmarkedPage,
          onRemoveBookmark: props.onRemoveBookmark,
          onExportCurrentDocument: props.onExportCurrentDocument,
          onRemoveGeneratedPage: props.onRemoveGeneratedPage,
          onCreateMemoPage: props.onCreateMemoPage,
          onInsertInboxAsset: props.onInsertInboxAsset,
          onRemoveInboxAsset: props.onRemoveInboxAsset,
          onPreviewAttachment: (assetId, attachmentId) => {
            workspace.previewAttachment(assetId);
            props.onOpenWorkspaceAttachment(attachmentId);
          },
          onPreviewInboxAsset: workspace.previewInboxAsset,
          onCommitInkStroke: props.onCommitInkStroke,
          onRemoveInkStroke: props.onRemoveInkStroke,
          onAddTextAnnotation: props.onAddTextAnnotation,
          onUpdateTextAnnotation: props.onUpdateTextAnnotation,
          onRemoveTextAnnotation: props.onRemoveTextAnnotation,
          onSelectionChange: props.onSelectionChange,
          deleteSelectedStrokes: props.deleteSelectedStrokes,
          changeSelectedStrokesColor: props.changeSelectedStrokesColor,
          onSetCurrentPdfPage: props.onSetCurrentPdfPage,
          onUpdateStudyDocumentPageCount: props.onUpdateStudyDocumentPageCount,
        }}
      >
        <View style={props.styles.fill}>
          <NotesDetailHeader
            styles={props.styles}
            compact={props.compact}
            caption={props.subject.name}
            title={props.studyDocument.title}
            metaText={`${props.studyDocument.type === 'pdf' ? 'PDF' : '빈 노트'} · ${props.studyDocument.pageCount}페이지`}
            onBack={() => props.onOpenStudyDocument(null)}
            rightAction={
              <View style={props.styles.headerActionRow}>
                <Pressable style={[props.styles.libraryEditButton, props.styles.headerIconButton]} onPress={startRename}>
                  <MaterialCommunityIcons name="pencil-outline" size={18} color="#4F68D2" />
                </Pressable>
                <Pressable style={[props.styles.libraryDeleteButton, props.styles.headerIconButton]} onPress={() => props.onDeleteStudyDocument(props.studyDocument!.id)}>
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color="#C04B4B" />
                </Pressable>
              </View>
            }
          />
          {renameOpen ? (
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
          <View style={props.styles.desktopDocumentDetailBody}>
            <NotesAiAssistantPanel />
            <NotesWorkspaceToolbar />
            {props.workspaceFeedback ? (
              <View style={props.styles.workspaceToast}>
                <MaterialCommunityIcons name="check-circle-outline" size={16} color="#4D67D8" />
                <Text style={props.styles.workspaceToastText}>{props.workspaceFeedback}</Text>
              </View>
            ) : null}
            {workspace.showWorkspaceDock ? <NotesWorkspaceDock /> : null}
            <NotesDocumentViewer />
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
    />
  );
}
