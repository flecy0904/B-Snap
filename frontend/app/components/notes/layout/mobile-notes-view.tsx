import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetBackdrop, BottomSheetScrollView, type BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { isClassInsightTargetDocument } from '../../../hooks/notes/class-insight';
import { PageReferenceText } from '../ai/page-reference-text';
import { PdfPreview } from '../pdf/pdf-preview';
import { BlankNoteCanvas } from '../canvas/blank-note-canvas';
import { NoteSummaryContent } from '../shared/notes-shared';
import type { BackendChatMessage, BackendChatSession } from '../../../services/backend-api';
import { AiAnswer, BookmarkedPage, CaptureAsset, DocumentPageView, GeneratedWorkspacePage, NotebookPage, NoteEntry, NoteWorkspaceMode, PageCaptureReference, StudyDocumentEntry, Subject, WorkspaceAttachment } from '../../../types';
import { InkBrush, InkLinePattern, InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { darkenHex, getDocumentPageLabel, isSameDocumentPage } from '../../../ui-helpers';

const PEN_COLORS = ['#1F2937', '#2563EB', '#7C3AED', '#D9485F', '#F59E0B', '#16A34A'];
const HIGHLIGHT_COLORS = ['#FDE047', '#FB7185', '#86EFAC', '#67E8F9', '#FDBA74'];
const PEN_WIDTHS = [2, 3, 4, 6, 8, 10];
const HIGHLIGHT_WIDTHS = [10, 12, 14, 18, 22, 26];
const PEN_BRUSHES: Array<{ label: string; value: InkBrush }> = [
  { label: '볼펜', value: 'ballpoint' },
  { label: '만년필', value: 'fountain' },
  { label: '연필', value: 'pencil' },
  { label: '마커', value: 'marker' },
];
const HIGHLIGHT_BRUSHES: Array<{ label: string; value: InkBrush }> = [
  { label: '형광펜', value: 'highlighter' },
];
const LINE_PATTERNS: Array<{ label: string; value: InkLinePattern }> = [
  { label: '실선', value: 'solid' },
  { label: '점선', value: 'dotted' },
  { label: '대시', value: 'dashed' },
];
const MOBILE_HANDWRITING_TOOLS: Array<{ value: InkTool; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] }> = [
  { value: 'view', icon: 'cursor-default-outline' },
  { value: 'pen', icon: 'pencil-outline' },
  { value: 'highlight', icon: 'marker' },
  { value: 'erase', icon: 'eraser-variant' },
  { value: 'select', icon: 'selection-drag' },
  { value: 'text', icon: 'format-textbox' },
  { value: 'line', icon: 'vector-line' },
  { value: 'arrow', icon: 'arrow-top-right' },
  { value: 'rect', icon: 'rectangle-outline' },
  { value: 'ellipse', icon: 'circle-outline' },
];

function getCaptureImageSource(asset: CaptureAsset) {
  const uri = asset.thumbnailUrl ?? asset.fileUrl ?? asset.previewImageKey;
  if (uri && (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('file://') || uri.startsWith('data:image/'))) {
    return { uri };
  }
  return asset.previewImage ?? null;
}

function formatCaptureDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getCapturePlacementLabel(asset: CaptureAsset, references: PageCaptureReference[]) {
  const matches = references.filter((reference) => reference.assetId === asset.id);
  if (!matches.length) return '미연결';
  const firstLabel = matches[0]?.pageLabel || '연결됨';
  return matches.length > 1 ? `${firstLabel} 외 ${matches.length - 1}` : firstLabel;
}

function getCaptureReferences(asset: CaptureAsset, references: PageCaptureReference[]) {
  return references.filter((reference) => reference.assetId === asset.id);
}

export function MobileNotesView(props: {
  subject: Subject | null;
  note: NoteEntry | null;
  studyDocument: StudyDocumentEntry | null;
  notes: NoteEntry[];
  allNotes: NoteEntry[];
  deletedNotes: NoteEntry[];
  studyDocuments: StudyDocumentEntry[];
  allStudyDocuments: StudyDocumentEntry[];
  deletedStudyDocuments: StudyDocumentEntry[];
  subjects: Subject[];
  query: string;
  noteTab: 'original' | 'summary';
  noteMode: NoteWorkspaceMode;
  inkTool: InkTool;
  penColor: string;
  penWidth: number;
  brushType: InkBrush;
  linePattern: InkLinePattern;
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  inkByDocument: Record<number, InkStroke[]>;
  textAnnotationsByDocument: Record<number, InkTextAnnotation[]>;
  currentPdfPage: number;
  currentDocumentPages: DocumentPageView[];
  notebookPages: NotebookPage[];
  currentDocumentPage: DocumentPageView | null;
  memoPages: GeneratedWorkspacePage[];
  activeGeneratedPage: GeneratedWorkspacePage | null;
  aiPanelOpen: boolean;
  selectionRect: SelectionRect | null;
  aiQuestion: string;
  aiAnswer: AiAnswer | null;
  aiMessages: BackendChatMessage[];
  aiChatSessions: BackendChatSession[];
  noteAiChatSessions: BackendChatSession[];
  allAiChatSessions: BackendChatSession[];
  aiChatScope: 'note' | 'all';
  activeAiChatSessionId: number | null;
  aiChatReadOnly: boolean;
  aiLoading: boolean;
  aiError: string | null;
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
  onChangeNoteTab: (tab: 'original' | 'summary') => void;
  onChangeMode: (mode: NoteWorkspaceMode) => void;
  onChangeInkTool: (tool: InkTool) => void;
  onChangePenColor: (color: string) => void;
  onChangePenWidth: (width: number) => void;
  onChangeBrushType: (brush: InkBrush) => void;
  onChangeLinePattern: (pattern: InkLinePattern) => void;
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
  onCommitInkStroke: (stroke: InkStroke) => void;
  onRemoveInkStroke: (strokeId: string) => void;
  onMoveSelection?: (dx: number, dy: number) => void;
  deleteSelectedStrokes: () => void;
  changeSelectedStrokesColor: (color: string) => void;
  onAddTextAnnotation: (point: InkPoint) => void;
  onUpdateTextAnnotation: (id: string, text: string) => void;
  onRemoveTextAnnotation: (id: string) => void;
  onAcceptIncomingAsset: () => void;
  onArchiveIncomingAsset: () => void;
  onDismissIncomingAsset: () => void;
  onInsertInboxAsset: (assetId: string) => void;
  onRemoveInboxAsset: (assetId: string) => void;
  onRemoveCaptureAsset: (assetId: string) => void;
  onOpenPageCaptureReference: (referenceId: string) => void;
  onMovePageCaptureReference: (referenceId: string, delta: -1 | 1) => void;
  onRemovePageCaptureReference: (referenceId: string) => void;
  onAskAiAboutPageCaptureReference: (referenceId: string) => void;
  onRemoveWorkspaceAttachment: (attachmentId: string) => void;
  onToggleBookmarkCurrentPage: () => void;
  onOpenBookmarkedPage: (bookmarkId: string) => void;
  onRemoveBookmark: (bookmarkId: string) => void;
  onExportCurrentDocument: () => void;
  onOpenGeneratedPage?: (pageId: string) => void;
  onQuery: (value: string) => void;
  onOpenNote: (id: number) => void;
  onOpenStudyDocument: (id: number | null) => void;
  onOpenSubject: (id: number) => void;
  onDeleteNote: (id: number) => void;
  onDeleteStudyDocument: (id: number) => void;
  onRestoreNote: (id: number) => void;
  onRestoreStudyDocument: (id: number) => void;
  onRenameStudyDocument: (id: number, title: string) => boolean;
  onCreateBlankNote: () => void;
  onUploadPdf: () => void;
  onUpdateStudyDocumentPageCount: (pageCount: number) => void;
  onSetCurrentPdfPage: (pageNumber: number) => void;
  onBackToSubjectList: () => void;
  onBackToNoteList: () => void;
  styles: any;
  blueColor: string;
}) {
  const [inboxPanelOpen, setInboxPanelOpen] = React.useState(false);
  const [subjectActionsOpen, setSubjectActionsOpen] = React.useState(false);
  const [noteActionsOpen, setNoteActionsOpen] = React.useState(false);
  const [recoveryOpen, setRecoveryOpen] = React.useState(false);
  const [documentRenameOpen, setDocumentRenameOpen] = React.useState(false);
  const [documentTitleDraft, setDocumentTitleDraft] = React.useState('');
  const [previewAssetId, setPreviewAssetId] = React.useState<string | null>(null);
  const [activeBrushPopover, setActiveBrushPopover] = React.useState<'pen' | 'highlight' | null>(null);
  const { width } = useWindowDimensions();
  const phoneViewerOnly = width < 700;
  const isBrushTool = props.inkTool === 'pen' || props.inkTool === 'highlight';

  const [pageListOpen, setPageListOpen] = React.useState(false);
  const aiSheetSnapPoints = React.useMemo(() => ['42%', '72%'], []);
  const renderAiBackdrop = React.useCallback(
    (backdropProps: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...backdropProps} appearsOnIndex={0} disappearsOnIndex={-1} pressBehavior="close" />
    ),
    [],
  );

  React.useEffect(() => {
    if (!isBrushTool) setActiveBrushPopover(null);
  }, [isBrushTool]);

  const getPageLabel = (page: DocumentPageView) => (
    getDocumentPageLabel({
      page,
      pages: props.currentDocumentPages,
      memoPages: props.memoPages,
    })
  );

  const navigateToPage = (page: DocumentPageView) => {
    if (page.kind === 'pdf') {
      props.onSetCurrentPdfPage(page.pageNumber);
    } else {
      props.onOpenGeneratedPage?.(page.pageId);
    }
    setPageListOpen(false);
  };
  const getReferencePreview = (reference: PageCaptureReference) => (
    reference.thumbnailUrl
      ? { uri: reference.thumbnailUrl }
      : reference.type === 'image' && reference.fileUrl
        ? { uri: reference.fileUrl }
        : reference.previewImage ?? null
  );
  const toggleSelectionMode = () => {
    props.onChangeInkTool(props.inkTool === 'select' ? 'view' : 'select');
  };

  const normalizedQuestion = props.aiAnswer?.question ?? props.aiQuestion.trim();
  const aiResponseSections = props.aiAnswer?.sections ?? null;
  const aiResponse = props.aiAnswer?.response ?? (props.selectionRect ? '응답 생성을 누르면 선택 영역 기준으로 AI 답변을 요청합니다.' : '먼저 선택 모드로 문서 영역을 드래그해 주세요.');
  const activeDeletedNotes = React.useMemo(
    () => props.subject ? props.deletedNotes.filter((note) => note.subjectId === props.subject!.id) : props.deletedNotes,
    [props.deletedNotes, props.subject],
  );
  const activeDeletedStudyDocuments = React.useMemo(
    () => props.subject ? props.deletedStudyDocuments.filter((document) => document.subjectId === props.subject!.id) : props.deletedStudyDocuments,
    [props.deletedStudyDocuments, props.subject],
  );
  const recoverableCount = props.noteMode === 'photo' ? activeDeletedNotes.length : activeDeletedStudyDocuments.length;
  const getSubjectPhotoAssets = React.useCallback((subjectId: number) => {
    const normalizedQuery = props.query.trim().toLowerCase();
    let assets = (props.captureAssetsBySubject[subjectId] ?? []).filter((asset) => asset.type === 'image' && asset.status !== 'dismissed');

    if (normalizedQuery) {
      assets = assets.filter((asset) => {
        const subjectName = props.subjects.find((item) => item.id === asset.subjectId)?.name ?? '';
        const keywords = asset.analysisKeywords ?? [];
        return (
          asset.title.toLowerCase().includes(normalizedQuery) ||
          asset.summary.toLowerCase().includes(normalizedQuery) ||
          (asset.analysisSummary ?? '').toLowerCase().includes(normalizedQuery) ||
          asset.sourceDeviceLabel.toLowerCase().includes(normalizedQuery) ||
          subjectName.toLowerCase().includes(normalizedQuery) ||
          keywords.some((keyword) => keyword.toLowerCase().includes(normalizedQuery))
        );
      });
    }

    return [...assets].sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      return rightTime - leftTime;
    });
  }, [props.captureAssetsBySubject, props.query, props.subjects]);
  const currentSubjectPhotoAssets = React.useMemo(
    () => props.subject ? getSubjectPhotoAssets(props.subject.id) : [],
    [getSubjectPhotoAssets, props.subject],
  );
  const previewAsset = React.useMemo(
    () => currentSubjectPhotoAssets.find((asset) => asset.id === previewAssetId) ?? null,
    [currentSubjectPhotoAssets, previewAssetId],
  );
  const previewImageSource = previewAsset ? getCaptureImageSource(previewAsset) : null;
  const previewReferences = previewAsset ? getCaptureReferences(previewAsset, props.allPageCaptureReferences) : [];
  const previewPrimaryReference = previewReferences[0] ?? null;
  const aiSuggestionPrompts = React.useMemo(() => {
    const basePrompts = ['여기서 중요한 개념 3개만 알려줘', '시험 대비 관점으로 설명해줘'];
    return isClassInsightTargetDocument(props.studyDocument, props.subject)
      ? ['시험에 나올만한 중요 페이지 추천해줘', ...basePrompts]
      : ['이 그래프 의미 뭐야?', ...basePrompts];
  }, [props.studyDocument, props.subject]);

  React.useEffect(() => {
    if (recoverableCount === 0) setRecoveryOpen(false);
  }, [recoverableCount]);

  React.useEffect(() => {
    setDocumentRenameOpen(false);
    setDocumentTitleDraft('');
  }, [props.studyDocument?.id]);

  const startDocumentRename = () => {
    if (!props.studyDocument) return;
    setDocumentTitleDraft(props.studyDocument.title);
    setDocumentRenameOpen(true);
  };

  const saveDocumentRename = () => {
    if (!props.studyDocument) return;
    if (props.onRenameStudyDocument(props.studyDocument.id, documentTitleDraft)) {
      setDocumentRenameOpen(false);
    }
  };

  const renderRecoveryPanel = () => {
    if (!recoverableCount) return null;

    return (
      <>
        <Pressable style={props.styles.mobileRecoveryToggle} onPress={() => setRecoveryOpen((current) => !current)}>
          <Text style={props.styles.mobileRecoveryToggleText}>최근 삭제 {recoverableCount}</Text>
          <MaterialCommunityIcons name={recoveryOpen ? 'menu-up' : 'menu-down'} size={16} color="#4F68D2" />
        </Pressable>
        {recoveryOpen ? (
          <View style={props.styles.recoveryPanel}>
            <View style={props.styles.recoveryHeader}>
              <Text style={props.styles.recoveryTitle}>최근 삭제</Text>
              <Text style={props.styles.recoveryMeta}>{props.subject?.name ?? '전체'} · {recoverableCount}개</Text>
            </View>
            {props.noteMode === 'photo' ? activeDeletedNotes.map((item) => (
              <View key={item.id} style={props.styles.recoveryRow}>
                <View style={props.styles.recoveryRowMeta}>
                  <Text style={props.styles.recoveryRowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={props.styles.recoveryRowBody} numberOfLines={1}>{item.date}</Text>
                </View>
                <Pressable style={props.styles.recoveryRestoreButton} onPress={() => props.onRestoreNote(item.id)}>
                  <Text style={props.styles.recoveryRestoreButtonText}>복구</Text>
                </Pressable>
              </View>
            )) : activeDeletedStudyDocuments.map((item) => (
              <View key={item.id} style={props.styles.recoveryRow}>
                <View style={props.styles.recoveryRowMeta}>
                  <Text style={props.styles.recoveryRowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={props.styles.recoveryRowBody} numberOfLines={1}>{item.type === 'pdf' ? 'PDF' : item.type === 'image' ? '이미지' : '빈 노트'} · {item.pageCount}페이지</Text>
                </View>
                <Pressable style={props.styles.recoveryRestoreButton} onPress={() => props.onRestoreStudyDocument(item.id)}>
                  <Text style={props.styles.recoveryRestoreButtonText}>복구</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </>
    );
  };

  if (props.noteMode === 'note' && props.studyDocument && props.subject) {
    return (
      <View style={props.styles.main}>
        <View style={[props.styles.centerTopBar, { zIndex: 10 }]}>
          <Pressable onPress={props.onBackToNoteList} style={props.styles.navIcon}><Text style={props.styles.navIconText}>{'‹'}</Text></Pressable>
          <View style={[props.styles.noteCenterWrap, props.styles.mobileNoteCenterWrap]}>
            <Text style={props.styles.noteCenterTitle} numberOfLines={1}>{props.subject.name}</Text>
            <Pressable 
              style={props.styles.mobilePageTitleButton}
              onPress={() => setPageListOpen(true)}
            >
              <Text style={[props.styles.noteCenterDate, props.styles.mobileDocumentTitle]} numberOfLines={1} ellipsizeMode="tail">
                {props.studyDocument.title}
                {props.currentDocumentPages?.length > 0 ? ` · ${getPageLabel(props.currentDocumentPage || {kind: 'pdf', pageNumber: props.currentPdfPage})}` : ''}
              </Text>
              <MaterialCommunityIcons name={pageListOpen ? "menu-up" : "menu-down"} size={16} color="#A2AAB8" />
            </Pressable>
            <Text style={props.styles.mobileDocumentSaveStatus} numberOfLines={1}>{props.documentSaveStatus}</Text>
          </View>
          <View style={props.styles.mobileHeaderActions}>
            <Pressable style={props.styles.navIcon} onPress={startDocumentRename}>
              <MaterialCommunityIcons name="pencil-outline" size={18} color="#4F68D2" />
            </Pressable>
            <Pressable style={props.styles.navIcon} onPress={props.onToggleAiPanel}>
              <MaterialCommunityIcons name="star-four-points" size={18} color="#5F79FF" />
            </Pressable>
          </View>
        </View>
        {documentRenameOpen ? (
          <View style={props.styles.documentRenamePanel}>
            <TextInput
              value={documentTitleDraft}
              onChangeText={setDocumentTitleDraft}
              placeholder="문서 제목"
              placeholderTextColor="#A2AAB8"
              style={props.styles.documentRenameInput}
              returnKeyType="done"
              onSubmitEditing={saveDocumentRename}
            />
            <Pressable style={props.styles.documentRenameButton} onPress={() => setDocumentRenameOpen(false)}>
              <Text style={props.styles.documentRenameButtonText}>취소</Text>
            </Pressable>
            <Pressable style={[props.styles.documentRenameButton, props.styles.documentRenameButtonPrimary]} onPress={saveDocumentRename}>
              <Text style={[props.styles.documentRenameButtonText, props.styles.documentRenameButtonTextPrimary]}>저장</Text>
            </Pressable>
          </View>
        ) : null}
        {phoneViewerOnly ? (
          <View style={props.styles.mobileViewerToolbar}>
            <Pressable style={props.styles.mobileViewerPagePill} onPress={() => setPageListOpen(true)}>
              <Text style={props.styles.mobileViewerPagePillText} numberOfLines={1}>
                {getPageLabel(props.currentDocumentPage || { kind: 'pdf', pageNumber: props.currentPdfPage })}
              </Text>
              <MaterialCommunityIcons name="menu-down" size={15} color="#7D8797" />
            </Pressable>
            <Pressable
              style={[props.styles.mobileViewerToolButton, props.inkTool === 'select' && props.styles.mobileViewerToolButtonActive]}
              onPress={toggleSelectionMode}
            >
              <MaterialCommunityIcons name="selection-drag" size={18} color={props.inkTool === 'select' ? props.blueColor : '#7D8797'} />
            </Pressable>
            <Pressable
              style={[props.styles.mobileViewerToolButton, props.currentPageBookmarked && props.styles.mobileViewerToolButtonActive]}
              onPress={props.onToggleBookmarkCurrentPage}
            >
              <MaterialCommunityIcons name={props.currentPageBookmarked ? 'star' : 'star-outline'} size={18} color={props.currentPageBookmarked ? '#F59E0B' : '#7D8797'} />
            </Pressable>
            <Pressable style={props.styles.mobileViewerToolButton} onPress={props.onToggleAiPanel}>
              <MaterialCommunityIcons name="star-four-points" size={18} color="#5F79FF" />
            </Pressable>
            <Pressable style={props.styles.mobileViewerToolButton} onPress={props.onExportCurrentDocument}>
              <MaterialCommunityIcons name="share-variant-outline" size={18} color="#7D8797" />
            </Pressable>
          </View>
        ) : (
        <View style={props.styles.mobileDocToolbar}>
          <View style={props.styles.mobileDocTools}>
            <View style={props.styles.mobileInkToolCluster}>
              {MOBILE_HANDWRITING_TOOLS.map((tool) => {
                const isBrush = tool.value === 'pen' || tool.value === 'highlight';
                const active = props.inkTool === tool.value;
                const popoverOpen = activeBrushPopover === tool.value;

                return (
                  <View key={tool.value} style={props.styles.mobileInkToolAnchor}>
                    <Pressable
                      style={[
                        props.styles.mobileDocToolButton,
                        active && props.styles.inkToolButtonActive,
                        popoverOpen && props.styles.inkToolButtonPopoverOpen,
                      ]}
                      onPress={() => {
                        if (isBrush) {
                          props.onChangeInkTool(tool.value);
                          setActiveBrushPopover((current) => (current === tool.value ? null : (tool.value as 'pen' | 'highlight')));
                          return;
                        }
                        props.onChangeInkTool(tool.value);
                        setActiveBrushPopover(null);
                      }}
                    >
                      <MaterialCommunityIcons name={tool.icon} size={18} color={active ? props.blueColor : '#7D8797'} />
                    </Pressable>
                    {isBrush && popoverOpen ? (
                      <View style={props.styles.mobileInkPopoverAnchor} pointerEvents="box-none">
                        <View style={props.styles.mobileInkPopover}>
                          <Text style={props.styles.inkPopoverLabel}>{tool.value === 'highlight' ? '형광펜 설정' : '펜 설정'}</Text>
                          <View style={props.styles.mobileInkPopoverRow}>
                            {(tool.value === 'highlight' ? HIGHLIGHT_COLORS : PEN_COLORS).map((color) => (
                              <Pressable key={color} style={[props.styles.mobileInkColorSwatch, { backgroundColor: color }, props.penColor === color && props.styles.mobileInkColorSwatchActive]} onPress={() => props.onChangePenColor(color)} />
                            ))}
                          </View>
                          <View style={props.styles.mobileInkPopoverRow}>
                            {(tool.value === 'highlight' ? HIGHLIGHT_BRUSHES : PEN_BRUSHES).map((brush) => (
                              <Pressable
                                key={brush.value}
                                style={[props.styles.mobileInkBrushButton, props.brushType === brush.value && props.styles.mobileInkBrushButtonActive]}
                                onPress={() => props.onChangeBrushType(brush.value)}
                              >
                                <Text style={[props.styles.mobileInkBrushButtonText, props.brushType === brush.value && props.styles.mobileInkBrushButtonTextActive]}>{brush.label}</Text>
                              </Pressable>
                            ))}
                          </View>
                          <View style={props.styles.mobileInkPopoverRow}>
                            {(tool.value === 'highlight' ? HIGHLIGHT_WIDTHS : PEN_WIDTHS).map((width) => (
                              <Pressable key={width} style={[props.styles.mobileInkWidthButton, props.penWidth === width && props.styles.mobileInkWidthButtonActive]} onPress={() => props.onChangePenWidth(width)}>
                                <View style={[props.styles.mobileInkWidthDot, { width: width + 2, height: width + 2, borderRadius: 99 }]} />
                              </Pressable>
                            ))}
                          </View>
                          {tool.value === 'pen' ? (
                            <View style={props.styles.mobileInkPopoverRow}>
                              {LINE_PATTERNS.map((pattern) => (
                                <Pressable
                                  key={pattern.value}
                                  style={[props.styles.mobileInkBrushButton, props.linePattern === pattern.value && props.styles.mobileInkBrushButtonActive]}
                                  onPress={() => props.onChangeLinePattern(pattern.value)}
                                >
                                  <Text style={[props.styles.mobileInkBrushButtonText, props.linePattern === pattern.value && props.styles.mobileInkBrushButtonTextActive]}>{pattern.label}</Text>
                                </Pressable>
                              ))}
                            </View>
                          ) : null}
                        </View>
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
            <View style={props.styles.mobileInkSecondaryCluster}>
              {props.selectionRect ? (
                <Pressable style={props.styles.mobileDocToolButton} onPress={props.deleteSelectedStrokes}><MaterialCommunityIcons name="delete-outline" size={18} color="#EF4444" /></Pressable>
              ) : (
                <>
                  <Pressable style={props.styles.mobileDocToolButton} onPress={props.onUndoInk}><MaterialCommunityIcons name="undo-variant" size={18} color="#7D8797" /></Pressable>
                  <Pressable style={props.styles.mobileDocToolButton} onPress={props.onRedoInk}><MaterialCommunityIcons name="redo-variant" size={18} color="#7D8797" /></Pressable>
                  <Pressable style={props.styles.mobileDocToolButton} onPress={props.onClearInk}><MaterialCommunityIcons name="trash-can-outline" size={18} color="#7D8797" /></Pressable>
                </>
              )}
              <Pressable style={[props.styles.mobileDocToolButton, props.currentPageBookmarked && props.styles.inkToolButtonActive]} onPress={props.onToggleBookmarkCurrentPage}>
                <MaterialCommunityIcons name={props.currentPageBookmarked ? 'star' : 'star-outline'} size={18} color={props.currentPageBookmarked ? '#F59E0B' : '#7D8797'} />
              </Pressable>
              <Pressable style={props.styles.mobileDocToolButton} onPress={props.onExportCurrentDocument}>
                <MaterialCommunityIcons name="share-variant-outline" size={18} color="#7D8797" />
              </Pressable>
            </View>
          </View>
        </View>
        )}
        {props.incomingAssetSuggestion ? (
          <View style={props.styles.workspaceBanner}>
            <Text style={props.styles.workspaceBannerEyebrow}>{props.incomingAssetSuggestion.sourceDeviceLabel}</Text>
            <Text style={props.styles.workspaceBannerTitle}>
              새 {props.incomingAssetSuggestion.type === 'image' ? '이미지' : 'PDF'} 1건이 현재 PDF 워크스페이스에 도착했습니다
            </Text>
            <Text style={props.styles.workspaceBannerBody}>{props.incomingAssetSuggestion.summary}</Text>
            <View style={props.styles.workspaceBannerActions}>
              <Pressable style={props.styles.workspacePrimaryAction} onPress={props.onAcceptIncomingAsset}>
                <Text style={props.styles.workspacePrimaryActionText}>현재 페이지에 연결</Text>
              </Pressable>
              <Pressable style={props.styles.workspaceSecondaryAction} onPress={props.onArchiveIncomingAsset}>
                <Text style={props.styles.workspaceSecondaryActionText}>보관</Text>
              </Pressable>
              <Pressable style={props.styles.workspaceGhostAction} onPress={props.onDismissIncomingAsset}>
                <Text style={props.styles.workspaceGhostActionText}>무시</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
        <View style={props.styles.workspaceSection}>
          <View style={props.styles.workspaceSectionHeader}>
            <Text style={props.styles.workspaceSectionTitle}>현재 페이지 자료</Text>
            <Text style={props.styles.workspaceSectionMeta}>{props.currentPageCaptureReferences.length}건</Text>
          </View>
          {props.currentPageCaptureReferences.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={props.styles.workspaceCardsRow}>
              {props.currentPageCaptureReferences.map((reference) => {
                const preview = getReferencePreview(reference);
                return (
                  <View key={reference.id} style={[props.styles.workspaceCard, props.styles.workspaceInboxCard]}>
                    {preview ? (
                      <Image source={preview} style={props.styles.mobilePageReferenceImage} resizeMode="cover" />
                    ) : (
                      <View style={props.styles.mobilePageReferenceFallback}>
                        <MaterialCommunityIcons name={reference.type === 'pdf' ? 'file-pdf-box' : 'image-outline'} size={22} color="#6D7BD9" />
                      </View>
                    )}
                    <Text style={props.styles.workspaceCardType}>{reference.pageLabel}</Text>
                    <Text style={props.styles.workspaceCardTitle} numberOfLines={1}>{reference.title}</Text>
                    <Text style={props.styles.workspaceCardBody} numberOfLines={2}>{reference.aiSummary}</Text>
                    <View style={props.styles.workspaceInboxRowButtons}>
                      <Pressable style={props.styles.workspaceInlineAction} onPress={() => props.onAskAiAboutPageCaptureReference(reference.id)}>
                        <Text style={props.styles.workspaceInlineActionText}>AI 질문</Text>
                      </Pressable>
                      <Pressable style={props.styles.workspaceDeleteAction} onPress={() => props.onRemovePageCaptureReference(reference.id)}>
                        <Text style={props.styles.workspaceDeleteActionText}>삭제</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          ) : (
            <Text style={props.styles.workspaceCardBody}>사진을 찍으면 현재 PDF 페이지에 자료 카드로 연결됩니다.</Text>
          )}
        </View>
        {props.workspaceAttachments.length ? (
          <View style={props.styles.workspaceSection}>
            <View style={props.styles.workspaceSectionHeader}>
              <Text style={props.styles.workspaceSectionTitle}>현재 문서 첨부</Text>
              <Text style={props.styles.workspaceSectionMeta}>{props.workspaceAttachments.length}건</Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={props.styles.workspaceCardsRow}>
            {props.workspaceAttachments.map((asset, index) => (
              <View key={`${asset.id}-${asset.generatedPageId ?? asset.assetId}-${index}`} style={props.styles.workspaceCard}>
                <Text style={props.styles.workspaceCardType}>{asset.type === 'image' ? 'IMAGE OVERLAY' : 'PDF REFERENCE'}</Text>
                <Text style={props.styles.workspaceCardTitle} numberOfLines={1}>{asset.title}</Text>
                <Text style={props.styles.workspaceCardBody} numberOfLines={2}>{asset.summary}</Text>
                <Text style={props.styles.workspaceCardMeta}>
                  {asset.placementType === 'next_page_insert' ? '다음 페이지 삽입' : '참고자료 연결'}
                </Text>
                <Pressable style={props.styles.workspaceCardAction} onPress={() => props.onRemoveWorkspaceAttachment(asset.id)}>
                  <Text style={props.styles.workspaceCardActionText}>문서에서 제거</Text>
                </Pressable>
              </View>
            ))}
            </ScrollView>
          </View>
        ) : null}
        {props.captureInbox.length ? (
          <View style={props.styles.workspaceSection}>
            <View style={props.styles.workspaceSectionHeader}>
              <Text style={props.styles.workspaceSectionTitle}>Inbox</Text>
              <View style={props.styles.workspaceSectionHeaderActions}>
                <Text style={props.styles.workspaceSectionMeta}>{props.captureInbox.length}건</Text>
                <Pressable style={props.styles.workspaceSectionToggle} onPress={() => setInboxPanelOpen((current) => !current)}>
                  <Text style={props.styles.workspaceSectionToggleText}>{inboxPanelOpen ? '닫기' : '열기'}</Text>
                </Pressable>
              </View>
            </View>
            {inboxPanelOpen ? (
              <View style={props.styles.workspaceInboxPanel}>
                {props.captureInbox.map((asset, index) => (
                  <View key={asset.id} style={[props.styles.workspaceInboxRow, index === props.captureInbox.length - 1 && props.styles.workspaceInboxRowLast]}>
                    <View style={props.styles.workspaceInboxRowMeta}>
                      <Text style={props.styles.workspaceCardType}>{asset.type === 'image' ? 'IMAGE' : 'PDF'}</Text>
                      <Text style={props.styles.workspaceInboxRowTitle} numberOfLines={1}>{asset.title}</Text>
                      <Text style={props.styles.workspaceInboxRowBody} numberOfLines={2}>
                        {asset.sourceDeviceLabel} · {asset.createdAt}
                        {asset.pageCount ? ` · ${asset.pageCount}페이지` : ''}
                      </Text>
                    </View>
                    <View style={props.styles.workspaceInboxRowActions}>
                      <View style={props.styles.workspaceInboxStatusPill}>
                        <Text style={props.styles.workspaceInboxStatusText}>{asset.status.toUpperCase()}</Text>
                      </View>
                      <View style={props.styles.workspaceInboxRowButtons}>
                        {asset.status !== 'accepted' ? (
                          <Pressable style={props.styles.workspaceInlineAction} onPress={() => props.onInsertInboxAsset(asset.id)}>
                            <Text style={props.styles.workspaceInlineActionText}>현재 페이지 연결</Text>
                          </Pressable>
                        ) : null}
                        <Pressable style={props.styles.workspaceDeleteAction} onPress={() => props.onRemoveInboxAsset(asset.id)}>
                          <Text style={props.styles.workspaceDeleteActionText}>삭제</Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
        <View style={[props.styles.mobilePdfStage, phoneViewerOnly && props.styles.mobileViewerStage]}>
          {props.studyDocument.type === 'pdf' && props.studyDocument.file ? (
            <PdfPreview
              file={props.studyDocument.file}
              page={props.currentPdfPage}
              inkTool={phoneViewerOnly ? (props.inkTool === 'select' ? 'select' : 'view') : props.inkTool}
              penColor={props.penColor}
              penWidth={props.penWidth}
              brushType={props.brushType}
              linePattern={props.linePattern}
              inkStrokes={props.inkByDocument[props.studyDocument.id] ?? props.inkStrokes}
              textAnnotations={props.textAnnotationsByDocument[props.studyDocument.id] ?? props.textAnnotations}
              textAnnotationVariant={phoneViewerOnly ? 'marker' : undefined}
              selectionRect={props.selectionRect}
              onCommitInkStroke={props.onCommitInkStroke}
              onRemoveInkStroke={props.onRemoveInkStroke}
              onAddTextAnnotation={props.onAddTextAnnotation}
              onUpdateTextAnnotation={props.onUpdateTextAnnotation}
              onRemoveTextAnnotation={props.onRemoveTextAnnotation}
              onSelectionChange={props.onSelectionChange}
              onMoveSelection={props.onMoveSelection}
              onDocumentLoaded={props.onUpdateStudyDocumentPageCount}
              onPageChanged={props.onSetCurrentPdfPage}
              onOpenGeneratedPage={props.onOpenGeneratedPage}
              notebookPages={props.notebookPages}
              activeGeneratedPageId={props.currentDocumentPage?.kind === 'generated' ? props.currentDocumentPage.pageId : null}
              pageImageUrls={props.studyDocument.pageImageUrls}
              pageCaptureReferences={props.pageCaptureReferences}
              incomingAssetSuggestion={props.incomingAssetSuggestion}
              onAcceptIncomingAsset={props.onAcceptIncomingAsset}
              onArchiveIncomingAsset={props.onArchiveIncomingAsset}
              onDismissIncomingAsset={props.onDismissIncomingAsset}
              onOpenPageCaptureReference={props.onOpenPageCaptureReference}
              onAskAiAboutPageCaptureReference={props.onAskAiAboutPageCaptureReference}
              styles={props.styles}
            />
          ) : props.activeGeneratedPage?.pageKind === 'memo' && phoneViewerOnly ? (
            <View style={props.styles.mobileViewerFallbackCard}>
              <MaterialCommunityIcons name="notebook-outline" size={24} color="#5F79FF" />
              <Text style={props.styles.mobileViewerFallbackTitle}>메모 페이지</Text>
              <Text style={props.styles.mobileViewerFallbackBody}>폰에서는 보기 모드만 지원합니다. 필기 편집은 iPad에서 이어서 할 수 있습니다.</Text>
            </View>
          ) : props.activeGeneratedPage?.pageKind === 'memo' ? (
            <BlankNoteCanvas
              styles={props.styles}
            />
          ) : props.activeGeneratedPage ? (
            <View style={props.styles.generatedPageCard}>
              <View style={props.styles.generatedPagePaper}>
                <ScrollView contentContainerStyle={props.styles.generatedPagePaperContent} showsVerticalScrollIndicator={false}>
                  <Text style={props.styles.generatedSummaryTitle}>{props.activeGeneratedPage.summaryTitle}</Text>
                  <Text style={props.styles.generatedSummaryBody}>{props.activeGeneratedPage.summaryIntro}</Text>
                  {props.activeGeneratedPage.summarySections.map((section, index) => (
                    <View key={`${section.title}-${index}`} style={[props.styles.generatedSummaryCard, index === 1 && props.styles.generatedSummaryCardSoft]}>
                      <Text style={props.styles.generatedSummaryLabel}>{section.title}</Text>
                      <Text style={props.styles.generatedSummaryBody}>{section.body}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            </View>
          ) : props.studyDocument.type === 'image' && typeof props.studyDocument.file === 'object' ? (
            <BlankNoteCanvas
              backgroundImageUri={props.studyDocument.file.uri}
              styles={props.styles}
            />
          ) : phoneViewerOnly ? (
            <View style={props.styles.mobileViewerFallbackCard}>
              <MaterialCommunityIcons name="file-document-edit-outline" size={24} color="#5F79FF" />
              <Text style={props.styles.mobileViewerFallbackTitle}>빈 노트</Text>
              <Text style={props.styles.mobileViewerFallbackBody}>폰에서는 노트 확인만 지원합니다. 필기 편집은 iPad에서 사용하는 것을 권장합니다.</Text>
            </View>
          ) : (
            <BlankNoteCanvas
              styles={props.styles}
            />
          )}
        </View>
        {props.aiPanelOpen ? (
          <BottomSheet
            index={0}
            snapPoints={aiSheetSnapPoints}
            enablePanDownToClose
            backdropComponent={renderAiBackdrop}
            onClose={props.onToggleAiPanel}
            backgroundStyle={props.styles.mobileAiBottomSheetBackground}
            handleIndicatorStyle={props.styles.mobileAiHandle}
            style={props.styles.mobileAiBottomSheet}
          >
            <View style={props.styles.mobileAiHeader}>
              <MaterialCommunityIcons name="star-four-points" size={20} color="#5F79FF" />
              <Pressable style={props.styles.aiPanelClose} onPress={props.onToggleAiPanel}><MaterialCommunityIcons name="close" size={18} color="#7A8394" /></Pressable>
            </View>
            <BottomSheetScrollView contentContainerStyle={props.styles.mobileAiScrollContent} showsVerticalScrollIndicator={false}>
              <View style={props.styles.aiChatHeaderRow}>
                <Text style={props.styles.aiSectionLabel}>최근 채팅</Text>
                <Pressable style={props.styles.aiNewChatButton} onPress={props.onCreateAiChatSession} disabled={props.aiLoading}>
                  <MaterialCommunityIcons name="plus" size={15} color="#5169D8" />
                  <Text style={props.styles.aiNewChatButtonText}>새 채팅</Text>
                </Pressable>
              </View>
              <View style={props.styles.aiChatScopeTabs}>
                {[
                  { value: 'note' as const, label: `현재 노트 (${props.noteAiChatSessions.length})` },
                  { value: 'all' as const, label: `전체 채팅 (${props.allAiChatSessions.length})` },
                ].map((tab) => {
                  const active = props.aiChatScope === tab.value;
                  return (
                    <Pressable
                      key={tab.value}
                      style={[props.styles.aiChatScopeTab, active && props.styles.aiChatScopeTabActive]}
                      onPress={() => props.onChangeAiChatScope(tab.value)}
                    >
                      <Text style={[props.styles.aiChatScopeTabText, active && props.styles.aiChatScopeTabTextActive]}>{tab.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {props.aiChatSessions.length ? (
                <View style={props.styles.aiChatList}>
                  {props.aiChatSessions.map((session) => {
                    const active = session.id === props.activeAiChatSessionId;
                    return (
                      <Pressable
                        key={session.id}
                        style={[props.styles.aiChatListItem, active && props.styles.aiChatListItemActive]}
                        onPress={() => props.onSelectAiChatSession(session.id)}
                        disabled={props.aiLoading || active}
                      >
                        <Text style={[props.styles.aiChatListItemTitle, active && props.styles.aiChatListItemTitleActive]} numberOfLines={1}>{session.title}</Text>
                        <Text style={props.styles.aiChatListItemMeta} numberOfLines={1}>{session.model ?? '모델 미선택'}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              ) : (
                <Pressable style={props.styles.aiEmptyChatButton} onPress={props.onCreateAiChatSession} disabled={props.aiLoading}>
                  <Text style={props.styles.aiEmptyChatButtonText}>새 채팅 시작</Text>
                </Pressable>
              )}
              <View style={props.styles.aiStateCard}>
                <Text style={props.styles.aiStateTitle}>선택 영역</Text>
                <Text style={props.styles.aiStateBody}>{props.selectionRect ? `${Math.round(props.selectionRect.width)} × ${Math.round(props.selectionRect.height)} 영역 선택됨` : '아직 선택된 영역이 없습니다'}</Text>
              </View>
              {aiSuggestionPrompts.map((prompt) => (
                <Pressable key={prompt} style={props.styles.aiSuggestionChip} onPress={() => props.onChangeAiQuestion(prompt)}><Text style={props.styles.aiSuggestionText}>{prompt}</Text></Pressable>
              ))}
              {props.aiChatReadOnly ? (
                <View style={props.styles.aiReadOnlyNotice}>
                  <MaterialCommunityIcons name="lock-outline" size={14} color="#5B6472" />
                  <Text style={props.styles.aiReadOnlyNoticeText}>보고 있는 노트와 연결된 대화방이 아니라서 읽기만 가능합니다.</Text>
                </View>
              ) : null}
              <View style={props.styles.aiInputShell}>
                <TextInput value={props.aiQuestion} onChangeText={props.onChangeAiQuestion} placeholder="선택한 영역에 대해 물어보세요" placeholderTextColor="#A2AAB8" multiline style={props.styles.aiInput} />
              </View>
              <View style={props.styles.aiActionRow}>
                <Pressable style={props.styles.aiPrimaryButton} onPress={props.onRequestAiAnswer} disabled={props.aiLoading}>
                  {props.aiLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={props.styles.aiPrimaryButtonText}>응답 생성</Text>}
                </Pressable>
                <Pressable style={[props.styles.aiSecondaryButton, !props.aiAnswer && props.styles.aiSecondaryButtonDisabled]} onPress={props.onInsertAiAnswerPage} disabled={!props.aiAnswer}>
                  <Text style={[props.styles.aiSecondaryButtonText, !props.aiAnswer && props.styles.aiSecondaryButtonTextDisabled]}>정리 페이지로 추가</Text>
                </Pressable>
              </View>
              {props.aiError ? <Text style={props.styles.aiErrorText}>{props.aiError}</Text> : null}
              {props.aiMessages.length ? (
                <>
                  <Text style={props.styles.aiSectionLabel}>채팅 내역</Text>
                  <View style={props.styles.aiResponseCard}>
                    {props.aiMessages.map((message) => (
                      <View key={message.id} style={props.styles.aiResponseSection}>
                        <Text style={props.styles.aiResponseSectionTitle}>{message.role === 'user' ? '나' : 'AI'}</Text>
                        {message.role === 'user' ? (
                          <Text style={props.styles.aiResponseBody}>{message.content}</Text>
                        ) : (
                          <PageReferenceText
                            content={message.content}
                            pageCount={props.studyDocument?.pageCount}
                            textStyle={props.styles.aiResponseBody}
                            linkStyle={props.styles.aiResponsePageLink}
                            onOpenPage={props.onSetCurrentPdfPage}
                          />
                        )}
                      </View>
                    ))}
                  </View>
                </>
              ) : null}
              <View style={props.styles.aiResponseCard}>
                <Text style={props.styles.aiResponseTitle}>답변</Text>
                {props.selectionRect && normalizedQuestion ? <View style={props.styles.aiQuestionPill}><Text style={props.styles.aiQuestionPillText}>{normalizedQuestion}</Text></View> : null}
                {aiResponseSections ? aiResponseSections.map((section, index) => (
                  <View key={`${section.title}-${index}`} style={[props.styles.aiResponseSection, index === aiResponseSections.length - 1 && props.styles.aiResponseSectionLast]}>
                    <Text style={props.styles.aiResponseSectionTitle}>{section.title}</Text>
                    <PageReferenceText
                      content={section.body}
                      pageCount={props.studyDocument?.pageCount}
                      textStyle={props.styles.aiResponseBody}
                      linkStyle={props.styles.aiResponsePageLink}
                      onOpenPage={props.onSetCurrentPdfPage}
                    />
                  </View>
                )) : (
                  <PageReferenceText
                    content={aiResponse}
                    pageCount={props.studyDocument?.pageCount}
                    textStyle={props.styles.aiResponseBody}
                    linkStyle={props.styles.aiResponsePageLink}
                    onOpenPage={props.onSetCurrentPdfPage}
                  />
                )}
              </View>
            </BottomSheetScrollView>
          </BottomSheet>
        ) : null}
        
        {pageListOpen ? (
          <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, zIndex: 9999, elevation: 99 }}>
            <Pressable style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.1)' }} onPress={() => setPageListOpen(false)} />
            <View pointerEvents="box-none" style={{ position: 'absolute', top: 96, left: 0, right: 0, bottom: 0, alignItems: 'center' }}>
              <View style={{ width: 220, maxHeight: 400, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E6EAF2', shadowColor: '#9098A8', shadowOpacity: 0.16, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}>
                <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={true} style={{ padding: 8, maxHeight: 380 }}>
                  {props.currentDocumentPages.map((page) => {
                    const isActive = isSameDocumentPage(props.currentDocumentPage, page);
                    const bookmarked = props.bookmarks.some((bookmark) => isSameDocumentPage(bookmark.page, page));
                    return (
                      <Pressable 
                        key={`${page.kind}-${page.kind === 'pdf' ? page.pageNumber : page.pageId}`}
                        style={{ paddingVertical: 12, paddingHorizontal: 12, borderRadius: 6, backgroundColor: isActive ? '#F0F4FF' : 'transparent' }}
                        onPress={() => navigateToPage(page)}
                      >
                        <Text style={{ fontSize: 13, fontWeight: isActive ? '800' : '600', color: isActive ? '#4F68D2' : '#556070', textAlign: 'center' }}>
                          {bookmarked ? '★ ' : ''}{getPageLabel(page)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  if (props.note && props.subject) {
    return (
      <ScrollView style={props.styles.main} contentContainerStyle={props.styles.noteDetailPage}>
        <View style={props.styles.centerTopBar}>
          <Pressable onPress={props.onBackToNoteList} style={props.styles.navIcon}><Text style={props.styles.navIconText}>{'‹'}</Text></Pressable>
          <View style={props.styles.noteCenterWrap}>
            <Text style={props.styles.noteCenterTitle}>{props.subject.name}</Text>
            <Text style={props.styles.noteCenterDate}>{props.note.date}</Text>
          </View>
          <Pressable style={props.styles.navIcon} onPress={() => setNoteActionsOpen((current) => !current)}><Text style={props.styles.navIconText}>⋯</Text></Pressable>
        </View>
        {noteActionsOpen ? (
          <View style={props.styles.mobileActionPanel}>
            <Pressable style={props.styles.mobileActionButton} onPress={() => props.onChangeNoteTab('summary')}>
              <Text style={props.styles.mobileActionButtonText}>AI 정리 보기</Text>
            </Pressable>
            <Pressable style={props.styles.mobileActionButton} onPress={() => props.onChangeNoteTab('original')}>
              <Text style={props.styles.mobileActionButtonText}>원본 보기</Text>
            </Pressable>
            <Pressable
              style={[props.styles.mobileActionButton, props.styles.mobileActionButtonDanger]}
              onPress={() => {
                setNoteActionsOpen(false);
                props.onDeleteNote(props.note!.id);
              }}
            >
              <Text style={[props.styles.mobileActionButtonText, props.styles.mobileActionButtonTextDanger]}>삭제</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={props.styles.segment}>
          <Pressable style={[props.styles.segmentButton, props.noteTab === 'original' && props.styles.segmentButtonActive]} onPress={() => props.onChangeNoteTab('original')}><Text style={[props.styles.segmentText, props.noteTab === 'original' && props.styles.segmentTextActive]}>원본</Text></Pressable>
          <Pressable style={[props.styles.segmentButton, props.noteTab === 'summary' && props.styles.segmentButtonActive]} onPress={() => props.onChangeNoteTab('summary')}><Text style={[props.styles.segmentText, props.noteTab === 'summary' && props.styles.segmentTextActive]}>AI 정리</Text></Pressable>
        </View>
        {props.noteTab === 'original' ? (
          <>
            <View style={props.styles.notePreviewCard}>
              <Image source={props.note.image} style={props.styles.notePreviewImage} resizeMode="cover" />
            </View>
            <Text style={props.styles.notePreviewHint}>이미지를 탭하면 확대해서 볼 수 있어요</Text>
          </>
        ) : (
          <NoteSummaryContent note={props.note} subject={props.subject} styles={props.styles} />
        )}
      </ScrollView>
    );
  }

  if (props.subject) {
    const currentSubject = props.subject;
    const latestPhoto = currentSubjectPhotoAssets[0] ?? null;
    return (
      <ScrollView style={props.styles.main} contentContainerStyle={props.styles.mobilePage}>
        <View style={props.styles.centerTopBar}>
          <Pressable onPress={props.onBackToSubjectList} style={props.styles.navIcon}><Text style={props.styles.navIconText}>{'‹'}</Text></Pressable>
          <Text style={props.styles.centerTopTitle}>{currentSubject.name}</Text>
          <Pressable style={props.styles.navIcon} onPress={() => setSubjectActionsOpen((current) => !current)}><Text style={props.styles.navIconText}>⋯</Text></Pressable>
        </View>
        {subjectActionsOpen ? (
          <View style={props.styles.mobileActionPanel}>
            <Pressable
              style={[props.styles.mobileActionButton, props.styles.mobileActionButtonPrimary]}
              onPress={() => {
                setSubjectActionsOpen(false);
                props.onCreateBlankNote();
              }}
            >
              <Text style={[props.styles.mobileActionButtonText, props.styles.mobileActionButtonTextPrimary]}>새 노트 만들기</Text>
            </Pressable>
            <Pressable
              style={props.styles.mobileActionButton}
              onPress={() => {
                setSubjectActionsOpen(false);
                props.onUploadPdf();
              }}
            >
              <Text style={props.styles.mobileActionButtonText}>PDF 업로드</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={props.styles.segment}>
          <Pressable style={[props.styles.segmentButton, props.noteMode === 'note' && props.styles.segmentButtonActive]} onPress={() => props.onChangeMode('note')}><Text style={[props.styles.segmentText, props.noteMode === 'note' && props.styles.segmentTextActive]}>Note</Text></Pressable>
          <Pressable style={[props.styles.segmentButton, props.noteMode === 'photo' && props.styles.segmentButtonActive]} onPress={() => props.onChangeMode('photo')}><Text style={[props.styles.segmentText, props.noteMode === 'photo' && props.styles.segmentTextActive]}>Photo</Text></Pressable>
        </View>
        {renderRecoveryPanel()}
        <View style={[props.styles.subjectHeroCard, { backgroundColor: currentSubject.bgColor, borderColor: currentSubject.color }]}>
          <View style={[props.styles.subjectHeroDot, { backgroundColor: currentSubject.color }]} />
          <View style={props.styles.fill}>
            <Text style={[props.styles.subjectHeroMeta, { color: currentSubject.textColor }]}>
              {props.noteMode === 'photo' ? latestPhoto ? `최근 사진 · ${formatCaptureDate(latestPhoto.createdAt)}` : '촬영하거나 가져온 원본 사진이 아직 없습니다' : props.studyDocuments[0] ? `최근 문서 · ${props.studyDocuments[0].title}` : '아직 등록된 문서가 없습니다'}
            </Text>
          </View>
        </View>
        {props.noteMode === 'photo'
          ? currentSubjectPhotoAssets.length
            ? (
                <View style={props.styles.photoGalleryPanel}>
                  <View style={props.styles.photoGalleryHeader}>
                    <View>
                      <Text style={props.styles.photoGalleryTitle}>{currentSubject.name} 원본 사진</Text>
                      <Text style={props.styles.photoGalleryMeta}>{currentSubjectPhotoAssets.length}장 · Photo 라이브러리</Text>
                    </View>
                  </View>
                  <View style={props.styles.photoGalleryGrid}>
                    {currentSubjectPhotoAssets.map((asset) => {
                      const imageSource = getCaptureImageSource(asset);
                      const placementLabel = getCapturePlacementLabel(asset, props.allPageCaptureReferences);
                      const linked = placementLabel !== '미연결';
                      return (
                        <Pressable key={asset.id} style={props.styles.photoGalleryCard} onPress={() => setPreviewAssetId(asset.id)}>
                          <View style={props.styles.photoGalleryImageWrap}>
                            {imageSource ? (
                              <Image source={imageSource} style={props.styles.photoGalleryImage} resizeMode="cover" />
                            ) : (
                              <View style={props.styles.photoGalleryFallback}>
                                <MaterialCommunityIcons name="image-outline" size={28} color="#9AA6B8" />
                              </View>
                            )}
                            <View style={[props.styles.photoGalleryStatusBadge, linked && props.styles.photoGalleryStatusBadgeLinked]}>
                              <Text style={[props.styles.photoGalleryStatusBadgeText, linked && props.styles.photoGalleryStatusBadgeTextLinked]}>
                                {linked ? '연결됨' : '미연결'}
                              </Text>
                            </View>
                          </View>
                          <View style={props.styles.photoGalleryCardBody}>
                            <Text style={props.styles.photoGalleryCardMeta} numberOfLines={1}>{formatCaptureDate(asset.createdAt)}</Text>
                            <View style={props.styles.photoGalleryPlacementRow}>
                              <MaterialCommunityIcons name={linked ? 'file-link-outline' : 'link-off'} size={14} color={linked ? '#4F68D2' : '#9AA3B2'} />
                              <Text style={[props.styles.photoGalleryPlacementText, linked && props.styles.photoGalleryPlacementTextLinked]} numberOfLines={1}>
                                {placementLabel}
                              </Text>
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )
            : (
                <View style={[props.styles.emptyCard, { borderColor: currentSubject.color, backgroundColor: currentSubject.bgColor }]}>
                  <Text style={[props.styles.emptyTitle, { color: currentSubject.textColor }]}>저장된 사진이 없습니다</Text>
                  <Text style={[props.styles.emptyBody, { color: currentSubject.textColor }]}>카메라나 사진첩에서 가져온 원본 사진은 이 과목 Photo 라이브러리에 모입니다.</Text>
                </View>
              )
          : props.studyDocuments.length
            ? props.studyDocuments.map((item) => {
                const isPdf = item.type === 'pdf';
                const isImage = item.type === 'image';
                return (
                  <Pressable key={item.id} style={[props.styles.mobileDocumentCard, { borderColor: currentSubject.bgColor }]} onPress={() => props.onOpenStudyDocument(item.id)}>
                    <View style={[props.styles.noteListRail, { backgroundColor: currentSubject.color }]} />
                    <View style={[props.styles.mobileDocumentThumb, isPdf ? props.styles.mobileDocumentThumbPdf : props.styles.mobileDocumentThumbBlank, isImage && { backgroundColor: '#F3FAF7' }]}>
                      <Text style={[props.styles.mobileDocumentThumbText, { color: isPdf ? props.blueColor : isImage ? '#23845F' : '#6B7280' }]}>{isPdf ? 'PDF' : isImage ? 'IMG' : 'NOTE'}</Text>
                    </View>
                    <View style={props.styles.fill}>
                      <Text style={props.styles.noteListTitle} numberOfLines={2}>{item.title}</Text>
                      <Text style={props.styles.noteListDate}>{item.updatedAt} · {item.pageCount}페이지</Text>
                    </View>
                    <Pressable
                      style={props.styles.libraryDeleteButton}
                      onPress={(event) => {
                        event.stopPropagation();
                        props.onDeleteStudyDocument(item.id);
                      }}
                    >
                      <MaterialCommunityIcons name="trash-can-outline" size={18} color="#C04B4B" />
                    </Pressable>
                  </Pressable>
                );
              })
            : (
                <View style={[props.styles.emptyCard, { borderColor: currentSubject.color, backgroundColor: currentSubject.bgColor }]}>
                  <Text style={[props.styles.emptyTitle, { color: currentSubject.textColor }]}>아직 등록된 문서가 없습니다</Text>
                  <Text style={[props.styles.emptyBody, { color: currentSubject.textColor }]}>PDF 업로드와 빈 노트는 모바일에서도 같은 방식으로 열 수 있습니다.</Text>
                </View>
              )}
        <Modal
          visible={!!previewAsset}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewAssetId(null)}
        >
          <View style={props.styles.photoViewerOverlay}>
            <Pressable style={props.styles.photoViewerBackdrop} onPress={() => setPreviewAssetId(null)} />
            {previewAsset ? (
              <View style={props.styles.photoViewerCard}>
                <View style={props.styles.photoViewerHeader}>
                  <View style={props.styles.fill}>
                    <Text style={props.styles.photoViewerTitle}>원본 사진</Text>
                    <Text style={props.styles.photoViewerMeta}>{formatCaptureDate(previewAsset.createdAt)}</Text>
                  </View>
                  <Pressable style={props.styles.photoViewerCloseButton} onPress={() => setPreviewAssetId(null)}>
                    <MaterialCommunityIcons name="close" size={20} color="#5F6876" />
                  </Pressable>
                </View>
                <View style={props.styles.photoViewerImageFrame}>
                  {previewImageSource ? (
                    <Image source={previewImageSource} style={props.styles.photoViewerImage} resizeMode="contain" />
                  ) : (
                    <View style={props.styles.photoViewerFallback}>
                      <MaterialCommunityIcons name="image-off-outline" size={36} color="#9AA6B8" />
                    </View>
                  )}
                </View>
                <View style={props.styles.photoViewerInfo}>
                  <View style={props.styles.photoViewerInfoRow}>
                    <Text style={props.styles.photoViewerInfoLabel}>연결 위치</Text>
                    <Text style={props.styles.photoViewerInfoValue} numberOfLines={1}>
                      {previewReferences.length ? previewReferences.map((reference) => reference.pageLabel).join(', ') : '미연결'}
                    </Text>
                  </View>
                  <View style={props.styles.photoViewerInfoRow}>
                    <Text style={props.styles.photoViewerInfoLabel}>AI 설명</Text>
                    <Text style={props.styles.photoViewerInfoValue} numberOfLines={3}>
                      {previewAsset.analysisSummary ?? previewAsset.summary}
                    </Text>
                  </View>
                </View>
                <View style={props.styles.photoViewerActionRow}>
                  {previewPrimaryReference ? (
                    <Pressable
                      style={[props.styles.photoViewerActionButton, props.styles.photoViewerActionButtonPrimary]}
                      onPress={() => {
                        props.onOpenPageCaptureReference(previewPrimaryReference.id);
                        setPreviewAssetId(null);
                      }}
                    >
                      <MaterialCommunityIcons name="notebook-outline" size={16} color="#FFFFFF" />
                      <Text style={[props.styles.photoViewerActionText, props.styles.photoViewerActionTextPrimary]}>노트에서 열기</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    style={props.styles.photoViewerActionButton}
                    onPress={() => {
                      props.onInsertInboxAsset(previewAsset.id);
                      setPreviewAssetId(null);
                    }}
                  >
                    <MaterialCommunityIcons name="file-image-plus-outline" size={16} color="#4F68D2" />
                    <Text style={props.styles.photoViewerActionText}>이미지 노트 만들기</Text>
                  </Pressable>
                  <Pressable
                    style={[props.styles.photoViewerActionButton, props.styles.photoViewerActionButtonDanger]}
                    onPress={() => {
                      props.onRemoveCaptureAsset(previewAsset.id);
                      setPreviewAssetId(null);
                    }}
                  >
                    <MaterialCommunityIcons name="trash-can-outline" size={16} color="#D64B4B" />
                    <Text style={[props.styles.photoViewerActionText, props.styles.photoViewerActionTextDanger]}>삭제</Text>
                  </Pressable>
                </View>
              </View>
            ) : null}
          </View>
        </Modal>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={props.styles.main} contentContainerStyle={props.styles.mobilePage}>
      <Text style={props.styles.pageTitle}>노트</Text>
      <View style={props.styles.segment}>
        <Pressable style={[props.styles.segmentButton, props.noteMode === 'note' && props.styles.segmentButtonActive]} onPress={() => props.onChangeMode('note')}><Text style={[props.styles.segmentText, props.noteMode === 'note' && props.styles.segmentTextActive]}>Note</Text></Pressable>
        <Pressable style={[props.styles.segmentButton, props.noteMode === 'photo' && props.styles.segmentButtonActive]} onPress={() => props.onChangeMode('photo')}><Text style={[props.styles.segmentText, props.noteMode === 'photo' && props.styles.segmentTextActive]}>Photo</Text></Pressable>
      </View>
      <View style={props.styles.searchBox}>
        <Text style={props.styles.searchIcon}>⌕</Text>
        <TextInput value={props.query} onChangeText={props.onQuery} placeholder={props.noteMode === 'photo' ? 'Photo 검색' : 'Note 검색'} placeholderTextColor="#C3C8D5" style={props.styles.searchInput} />
      </View>
      {renderRecoveryPanel()}
      {props.subjects.filter((item) => !props.query.trim() || item.name.includes(props.query.trim())).map((item) => (
        <Pressable key={item.id} style={props.styles.subjectRow} onPress={() => props.onOpenSubject(item.id)}>
          <View style={[props.styles.subjectIconBox, { backgroundColor: item.bgColor }]}>
            <View style={[props.styles.subjectDot, { backgroundColor: darkenHex(item.bgColor, 0.28) }]} />
          </View>
          <View style={props.styles.fill}>
            <Text style={props.styles.subjectTitle}>{item.name}</Text>
            <Text style={props.styles.subjectMeta}>{props.noteMode === 'photo' ? `${getSubjectPhotoAssets(item.id).length}장 사진` : `${props.allStudyDocuments.filter((document) => document.subjectId === item.id).length}개 문서`}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
