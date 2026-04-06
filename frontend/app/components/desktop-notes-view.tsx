import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { studyDocuments as allStudyDocuments, subjects as allSubjects } from '../data';
import { PdfPreview } from './pdf-preview';
import { buildAiResponse, NoteSummaryContent } from './notes-shared';
import { resolvePreviewImage } from '../mock-preview-images';
import { CaptureAsset, DocumentPageView, GeneratedWorkspacePage, NoteEntry, NoteWorkspaceMode, StudyDocumentEntry, Subject, WorkspaceAttachment } from '../types';
import { InkStroke, InkTool, SelectionRect } from '../ui-types';
import { darkenHex } from '../ui-helpers';

export function DesktopNotesView(props: {
  compact: boolean;
  subject: Subject | null;
  note: NoteEntry | null;
  studyDocument: StudyDocumentEntry | null;
  notes: NoteEntry[];
  noteMode: NoteWorkspaceMode;
  studyDocuments: StudyDocumentEntry[];
  inkTool: InkTool;
  inkStrokes: InkStroke[];
  aiPanelOpen: boolean;
  selectionRect: SelectionRect | null;
  aiQuestion: string;
  incomingAssetSuggestion: CaptureAsset | null;
  inboxHint: string | null;
  inboxPendingCount: number;
  workspaceFeedback: string | null;
  captureInbox: CaptureAsset[];
  workspaceAttachments: WorkspaceAttachment[];
  generatedWorkspacePages: GeneratedWorkspacePage[];
  activeGeneratedPage: GeneratedWorkspacePage | null;
  currentDocumentPage: DocumentPageView | null;
  currentPdfPage: number;
  currentDocumentPageIndex: number;
  totalDocumentPageCount: number;
  subjects: Subject[];
  query: string;
  sort: 'latest' | 'oldest';
  onChangeMode: (mode: NoteWorkspaceMode) => void;
  onChangeInkTool: (tool: InkTool) => void;
  onToggleAiPanel: () => void;
  onChangeAiQuestion: (value: string) => void;
  onSelectionChange: (rect: SelectionRect | null) => void;
  onUndoInk: () => void;
  onClearInk: () => void;
  onCommitInkStroke: (stroke: InkStroke) => void;
  onAcceptIncomingAsset: () => void;
  onArchiveIncomingAsset: () => void;
  onDismissIncomingAsset: () => void;
  onInsertInboxAsset: (assetId: string) => void;
  onRemoveInboxAsset: (assetId: string) => void;
  onRemoveWorkspaceAttachment: (attachmentId: string) => void;
  onOpenWorkspaceAttachment: (attachmentId: string) => void;
  onQuery: (value: string) => void;
  onSort: () => void;
  onOpenStudyDocument: (id: number | null) => void;
  onOpenNote: (id: number) => void;
  onOpenSubject: (id: number) => void;
  onReset: () => void;
  onSetCurrentPdfPage: (pageNumber: number) => void;
  onGoToPreviousDocumentPage: () => void;
  onGoToNextDocumentPage: () => void;
  styles: any;
  blueColor: string;
}) {
  const [inboxPanelOpen, setInboxPanelOpen] = React.useState(true);
  const [workspaceDockOpen, setWorkspaceDockOpen] = React.useState(false);
  const [selectedPreview, setSelectedPreview] = React.useState<{ source: 'incoming' | 'attachment' | 'inbox'; assetId: string } | null>(null);
  const { normalizedQuestion, aiResponse, aiResponseSections } = buildAiResponse(props.aiQuestion, props.selectionRect, true);

  React.useEffect(() => {
    if (props.incomingAssetSuggestion) {
      setWorkspaceDockOpen(true);
      setSelectedPreview({ source: 'incoming', assetId: props.incomingAssetSuggestion.id });
    }
  }, [props.incomingAssetSuggestion]);

  if (props.noteMode === 'photo' && props.note) {
    const note = props.note;
    const subject = allSubjects.find((item) => item.id === note.subjectId)!;
    return (
      <View style={props.styles.fill}>
        <View style={[props.styles.desktopDetailHeader, props.compact && props.styles.desktopDetailHeaderCompact]}>
          <Pressable onPress={() => props.onOpenSubject(subject.id)} style={props.styles.navIcon}><Text style={props.styles.navIconText}>{'‹'}</Text></Pressable>
          <View style={props.styles.fill}>
            <Text style={props.styles.desktopCaption}>{subject.name}</Text>
            <Text style={[props.styles.desktopDetailTitle, props.compact && props.styles.desktopDetailTitleCompact]}>{note.title}</Text>
          </View>
        </View>
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
    const hasWorkspaceDockContent = !!props.incomingAssetSuggestion || props.workspaceAttachments.length > 0 || props.captureInbox.length > 0;
    const showWorkspaceDock = workspaceDockOpen && hasWorkspaceDockContent;
    const generatedPagesAfterActiveInsertPage = props.activeGeneratedPage
      ? props.generatedWorkspacePages.filter((value) => value.insertAfterPage === props.activeGeneratedPage?.insertAfterPage)
      : [];
    const activeGeneratedOrdinal =
      props.activeGeneratedPage ? generatedPagesAfterActiveInsertPage.findIndex((value) => value.id === props.activeGeneratedPage?.id) + 1 : 0;
    const currentPageLabel =
      props.currentDocumentPage?.kind === 'generated'
        ? `${props.activeGeneratedPage?.insertAfterPage ?? props.currentPdfPage}-${activeGeneratedOrdinal} 정리`
        : `${props.currentPdfPage} / ${props.totalDocumentPageCount} · 원본 PDF`;
    const previewedIncoming =
      selectedPreview?.source === 'incoming' && props.incomingAssetSuggestion?.id === selectedPreview.assetId
        ? props.incomingAssetSuggestion
        : null;
    const previewedAttachment =
      selectedPreview?.source === 'attachment'
        ? props.workspaceAttachments.find((asset) => asset.assetId === selectedPreview.assetId) ?? null
        : null;
    const previewedInbox =
      selectedPreview?.source === 'inbox'
        ? props.captureInbox.find((asset) => asset.id === selectedPreview.assetId) ?? null
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
    const activeGeneratedAttachment = props.activeGeneratedPage
      ? props.workspaceAttachments.find((value) => value.generatedPageId === props.activeGeneratedPage?.id) ?? null
      : null;
    const activeGeneratedPreviewImage =
      resolvePreviewImage(props.activeGeneratedPage?.previewImageKey) ??
      resolvePreviewImage(activeGeneratedAttachment?.previewImageKey) ??
      props.activeGeneratedPage?.previewImage ??
      activeGeneratedAttachment?.previewImage;

    return (
      <View style={props.styles.fill}>
        <View style={[props.styles.desktopDetailHeader, props.compact && props.styles.desktopDetailHeaderCompact]}>
          <Pressable onPress={() => props.onOpenStudyDocument(null)} style={props.styles.navIcon}><Text style={props.styles.navIconText}>{'‹'}</Text></Pressable>
          <View style={props.styles.fill}>
            <Text style={props.styles.desktopCaption}>{props.subject.name}</Text>
            <Text style={[props.styles.desktopDetailTitle, props.compact && props.styles.desktopDetailTitleCompact]}>{props.studyDocument.title}</Text>
          </View>
          <View style={props.styles.documentDetailMetaPill}>
            <Text style={props.styles.documentDetailMetaText}>{props.studyDocument.type === 'pdf' ? 'PDF' : '빈 노트'} · {props.studyDocument.pageCount}페이지</Text>
          </View>
        </View>
        <View style={props.styles.desktopDocumentDetailBody}>
          {props.aiPanelOpen ? (
            <View style={props.styles.aiPanel}>
              <View style={props.styles.aiPanelHeader}>
                <MaterialCommunityIcons name="star-four-points" size={24} color="#5F79FF" />
                <Pressable style={props.styles.aiPanelClose} onPress={props.onToggleAiPanel}><MaterialCommunityIcons name="close" size={18} color="#7A8394" /></Pressable>
              </View>
              <ScrollView style={props.styles.aiPanelScroll} contentContainerStyle={props.styles.aiPanelScrollContent} showsVerticalScrollIndicator={false}>
                <Text style={props.styles.aiPanelSubtitle}>선택 영역을 기준으로 질문할 수 있습니다.</Text>
                <View style={props.styles.aiStateCard}>
                  <Text style={props.styles.aiStateTitle}>선택 영역</Text>
                  <Text style={props.styles.aiStateBody}>{props.selectionRect ? `${Math.round(props.selectionRect.width)} × ${Math.round(props.selectionRect.height)} 영역 선택됨` : '아직 선택된 영역이 없습니다'}</Text>
                </View>
                <Text style={props.styles.aiSectionLabel}>추천 질문</Text>
                {['이 영역 핵심만 요약해줘', '여기서 중요한 개념 3개만 알려줘', '시험 대비 관점으로 설명해줘'].map((prompt) => (
                  <Pressable key={prompt} style={props.styles.aiSuggestionChip} onPress={() => props.onChangeAiQuestion(prompt)}><Text style={props.styles.aiSuggestionText}>{prompt}</Text></Pressable>
                ))}
                <Text style={props.styles.aiSectionLabel}>질문</Text>
                <View style={props.styles.aiInputShell}>
                  <TextInput value={props.aiQuestion} onChangeText={props.onChangeAiQuestion} placeholder="선택한 영역에 대해 물어보세요" placeholderTextColor="#A2AAB8" multiline style={props.styles.aiInput} />
                </View>
                <View style={props.styles.aiResponseCard}>
                  <Text style={props.styles.aiResponseTitle}>답변</Text>
                  {props.selectionRect && normalizedQuestion ? <View style={props.styles.aiQuestionPill}><Text style={props.styles.aiQuestionPillText}>{normalizedQuestion}</Text></View> : null}
                  {aiResponseSections ? aiResponseSections.map((section, index) => (
                    <View key={`${section.title}-${index}`} style={[props.styles.aiResponseSection, index === aiResponseSections.length - 1 && props.styles.aiResponseSectionLast]}>
                      <Text style={props.styles.aiResponseSectionTitle}>{section.title}</Text>
                      <Text style={props.styles.aiResponseBody}>{section.body}</Text>
                    </View>
                  )) : <Text style={props.styles.aiResponseBody}>{aiResponse}</Text>}
                </View>
              </ScrollView>
            </View>
          ) : null}
          <View style={props.styles.inkToolbar}>
            <View style={props.styles.documentPageNavigator}>
              <Pressable style={props.styles.documentPageNavButton} onPress={props.onGoToPreviousDocumentPage}>
                <MaterialCommunityIcons name="chevron-left" size={18} color="#5B6474" />
              </Pressable>
              <Text style={props.styles.documentPageLabel}>{currentPageLabel}</Text>
              <Pressable style={props.styles.documentPageNavButton} onPress={props.onGoToNextDocumentPage}>
                <MaterialCommunityIcons name="chevron-right" size={18} color="#5B6474" />
              </Pressable>
            </View>
            <View style={props.styles.inkToolbarTools}>
              {[
                ['view', 'cursor-default-outline'],
                ['pen', 'pencil-outline'],
                ['select', 'selection-drag'],
              ].map(([value, icon]) => (
                <Pressable key={value} style={[props.styles.inkToolButton, props.inkTool === value && props.styles.inkToolButtonActive]} onPress={() => props.onChangeInkTool(value as InkTool)}>
                  <MaterialCommunityIcons name={icon as any} size={18} color={props.inkTool === value ? props.blueColor : '#556070'} />
                </Pressable>
              ))}
              <View style={props.styles.inkToolbarDivider} />
              <Pressable style={props.styles.inkActionButton} onPress={props.onUndoInk}><MaterialCommunityIcons name="undo-variant" size={18} color="#556070" /></Pressable>
              <Pressable style={props.styles.inkActionButton} onPress={props.onClearInk}><MaterialCommunityIcons name="trash-can-outline" size={18} color="#556070" /></Pressable>
              <Pressable
                style={[props.styles.inkActionButton, props.styles.workspaceDockButton, showWorkspaceDock && props.styles.workspaceDockButtonActive]}
                onPress={() => setWorkspaceDockOpen((current) => !current)}
              >
                <MaterialCommunityIcons
                  name="image-multiple-outline"
                  size={18}
                  color={showWorkspaceDock ? '#5A74E8' : hasWorkspaceDockContent ? '#556EDB' : '#77839A'}
                />
                {hasWorkspaceDockContent ? <View style={props.styles.workspaceDockBadge} /> : null}
              </Pressable>
              <Pressable style={[props.styles.inkActionButton, props.styles.aiIconButton, props.aiPanelOpen && props.styles.aiIconButtonActive]} onPress={props.onToggleAiPanel}>
                <MaterialCommunityIcons name="star-four-points" size={18} color={props.aiPanelOpen ? '#5A74E8' : '#7786D8'} />
              </Pressable>
            </View>
          </View>
          {props.workspaceFeedback ? (
            <View style={props.styles.workspaceToast}>
              <MaterialCommunityIcons name="check-circle-outline" size={16} color="#4D67D8" />
              <Text style={props.styles.workspaceToastText}>{props.workspaceFeedback}</Text>
            </View>
          ) : null}
          {showWorkspaceDock ? (
            <View style={[props.styles.workspaceDock, props.aiPanelOpen && props.styles.workspaceDockShifted]}>
              <View style={props.styles.workspaceDockTop}>
                <MaterialCommunityIcons name="image-multiple-outline" size={20} color="#5F79FF" />
                <Pressable style={props.styles.workspaceDockClose} onPress={() => setWorkspaceDockOpen(false)}>
                  <MaterialCommunityIcons name="close" size={18} color="#7A8394" />
                </Pressable>
              </View>
              <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={props.styles.workspaceDockContent}>
                {previewTitle ? (
                  <View style={props.styles.workspaceDockCard}>
                    <Text style={props.styles.workspaceDockLabel}>
                      {previewedIncoming ? '새 자료' : previewedAttachment ? '삽입 미리보기' : 'Inbox 미리보기'}
                    </Text>
                    {previewImage ? (
                      <View style={props.styles.workspaceDockPreviewFrame}>
                        <Image source={previewImage} style={props.styles.workspaceDockPreviewImage} resizeMode="cover" />
                      </View>
                    ) : (
                      <View style={props.styles.workspaceDockPreviewFallback}>
                        <MaterialCommunityIcons name="image-outline" size={24} color="#6D7BD9" />
                      </View>
                    )}
                    <Text style={props.styles.workspaceDockTitle}>
                      {previewedIncoming ? '사진 1장 도착' : previewedAttachment ? '삽입된 정리본 미리보기' : 'Inbox 사진 미리보기'}
                    </Text>
                    <Text style={props.styles.workspaceDockMeta}>{previewTitle}</Text>
                    {previewMeta ? <Text style={props.styles.workspaceDockMetaMuted}>{previewMeta}</Text> : null}
                    <View style={props.styles.workspaceDockActions}>
                      {previewedIncoming ? (
                        <>
                          <Pressable style={props.styles.workspacePrimaryAction} onPress={props.onAcceptIncomingAsset}>
                            <Text style={props.styles.workspacePrimaryActionText}>삽입</Text>
                          </Pressable>
                          <Pressable style={props.styles.workspaceGhostAction} onPress={props.onDismissIncomingAsset}>
                            <Text style={props.styles.workspaceGhostActionText}>무시</Text>
                          </Pressable>
                        </>
                      ) : null}
                      {previewedAttachment ? (
                        <>
                          <Pressable style={props.styles.workspacePrimaryAction} onPress={() => props.onOpenWorkspaceAttachment(previewedAttachment.id)}>
                            <Text style={props.styles.workspacePrimaryActionText}>열기</Text>
                          </Pressable>
                          <Pressable style={props.styles.workspaceDockDeleteAction} onPress={() => props.onRemoveWorkspaceAttachment(previewedAttachment.id)}>
                            <Text style={props.styles.workspaceDockDeleteActionText}>삭제</Text>
                          </Pressable>
                        </>
                      ) : null}
                      {previewedInbox ? (
                        <>
                          <Pressable style={props.styles.workspacePrimaryAction} onPress={() => props.onInsertInboxAsset(previewedInbox.id)}>
                            <Text style={props.styles.workspacePrimaryActionText}>삽입</Text>
                          </Pressable>
                          <Pressable style={props.styles.workspaceDockDeleteAction} onPress={() => props.onRemoveInboxAsset(previewedInbox.id)}>
                            <Text style={props.styles.workspaceDockDeleteActionText}>삭제</Text>
                          </Pressable>
                        </>
                      ) : null}
                    </View>
                  </View>
                ) : null}
                {props.workspaceAttachments.length ? (
                  <View style={props.styles.workspaceDockSection}>
                    <View style={props.styles.workspaceDockSectionHeader}>
                      <Text style={props.styles.workspaceDockSectionTitle}>추가한 정리 페이지</Text>
                      <Text style={props.styles.workspaceDockSectionMeta}>{props.workspaceAttachments.length}</Text>
                    </View>
                    {props.workspaceAttachments.map((asset, index) => (
                      <View key={`${asset.id}-${asset.generatedPageId ?? asset.assetId}-${index}`} style={props.styles.workspaceDockRow}>
                        <Pressable
                          style={props.styles.workspaceDockRowMeta}
                          onPress={() => {
                            setSelectedPreview({ source: 'attachment', assetId: asset.assetId });
                            props.onOpenWorkspaceAttachment(asset.id);
                          }}
                        >
                          <Text style={props.styles.workspaceDockRowTitle} numberOfLines={1}>{asset.title}</Text>
                          <Text style={props.styles.workspaceDockRowBody} numberOfLines={2}>
                            {asset.type === 'image' ? '다음 정리 페이지' : 'PDF 참고자료'}
                          </Text>
                        </Pressable>
                        <Pressable style={props.styles.workspaceDockInlineAction} onPress={() => props.onRemoveWorkspaceAttachment(asset.id)}>
                          <Text style={props.styles.workspaceDockInlineActionText}>삭제</Text>
                        </Pressable>
                      </View>
                    ))}
                  </View>
                ) : null}
                {props.captureInbox.length ? (
                  <View style={props.styles.workspaceDockSection}>
                    <View style={props.styles.workspaceDockSectionHeader}>
                      <Text style={props.styles.workspaceDockSectionTitle}>Inbox</Text>
                      <Pressable style={props.styles.workspaceDockToggle} onPress={() => setInboxPanelOpen((current) => !current)}>
                        <Text style={props.styles.workspaceDockToggleText}>{inboxPanelOpen ? '접기' : `${props.captureInbox.length}건`}</Text>
                      </Pressable>
                    </View>
                    {inboxPanelOpen
                      ? props.captureInbox.map((asset) => (
                          <View key={asset.id} style={props.styles.workspaceDockRow}>
                            <Pressable style={props.styles.workspaceDockRowMeta} onPress={() => setSelectedPreview({ source: 'inbox', assetId: asset.id })}>
                              <Text style={props.styles.workspaceDockRowTitle} numberOfLines={1}>{asset.title}</Text>
                              <Text style={props.styles.workspaceDockRowBody} numberOfLines={2}>
                                {asset.sourceDeviceLabel}
                              </Text>
                            </Pressable>
                            {asset.status !== 'accepted' ? (
                              <View style={props.styles.workspaceDockRowButtons}>
                                <Pressable style={props.styles.workspaceDockInlineAction} onPress={() => props.onInsertInboxAsset(asset.id)}>
                                  <Text style={props.styles.workspaceDockInlineActionText}>삽입</Text>
                                </Pressable>
                                <Pressable style={props.styles.workspaceDockDeleteAction} onPress={() => props.onRemoveInboxAsset(asset.id)}>
                                  <Text style={props.styles.workspaceDockDeleteActionText}>삭제</Text>
                                </Pressable>
                              </View>
                            ) : (
                              <Pressable style={props.styles.workspaceDockDeleteAction} onPress={() => props.onRemoveInboxAsset(asset.id)}>
                                <Text style={props.styles.workspaceDockDeleteActionText}>삭제</Text>
                              </Pressable>
                            )}
                          </View>
                        ))
                      : null}
                  </View>
                ) : null}
              </ScrollView>
            </View>
          ) : null}
          {props.activeGeneratedPage?.status === 'generating' ? (
            <View style={props.styles.generatedPageCard}>
              <View style={props.styles.generatedPageContent}>
                {activeGeneratedAttachment ? (
                  <View style={props.styles.generatedPageHeader}>
                    <View style={props.styles.fill} />
                    <Pressable style={props.styles.generatedPageDeleteButton} onPress={() => props.onRemoveWorkspaceAttachment(activeGeneratedAttachment.id)}>
                      <Text style={props.styles.generatedPageDeleteText}>삭제</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={props.styles.generatedPageLoading}>
                  <ActivityIndicator size="large" color={props.blueColor} />
                  <Text style={props.styles.generatedPageLoadingTitle}>판서+LLM 정리본을 만드는 중입니다.</Text>
                  <Text style={props.styles.generatedPageLoadingBody}>완료되면 현재 PDF 다음 위치에 새 페이지로 추가됩니다.</Text>
                </View>
              </View>
            </View>
          ) : props.activeGeneratedPage ? (
            <View style={props.styles.generatedPageCard}>
              <View style={props.styles.generatedPageSheet}>
                <View style={props.styles.generatedPageContent}>
                {activeGeneratedAttachment ? (
                  <View style={props.styles.generatedPageHeader}>
                    <View style={props.styles.fill} />
                    <Pressable style={props.styles.generatedPageDeleteButton} onPress={() => props.onRemoveWorkspaceAttachment(activeGeneratedAttachment.id)}>
                      <Text style={props.styles.generatedPageDeleteText}>삭제</Text>
                    </Pressable>
                  </View>
                ) : null}
                <View style={props.styles.generatedPageLayout}>
                  <View style={props.styles.generatedPageImageColumn}>
                    {activeGeneratedPreviewImage ? (
                      <Image source={activeGeneratedPreviewImage} style={props.styles.generatedPageImage} resizeMode="cover" />
                    ) : (
                      <View style={props.styles.generatedPageImageFallback}>
                        <MaterialCommunityIcons name="image-outline" size={32} color="#6D7BD9" />
                      </View>
                    )}
                  </View>
                  <View style={props.styles.generatedPagePaper}>
                    <ScrollView contentContainerStyle={props.styles.generatedPagePaperContent} showsVerticalScrollIndicator={false}>
                      <Text style={props.styles.generatedSummaryTitle}>{props.activeGeneratedPage.summaryTitle}</Text>
                      {props.activeGeneratedPage.summarySections.slice(0, 2).map((section, index) => (
                        <View
                          key={`${section.title}-${index}`}
                          style={[
                            props.styles.generatedSummaryCard,
                            index === 1 && props.styles.generatedSummaryCardSoft,
                          ]}
                        >
                          <Text style={props.styles.generatedSummaryLabel}>{section.title}</Text>
                          <Text style={props.styles.generatedSummaryBody}>{section.body}</Text>
                        </View>
                      ))}
                      {props.activeGeneratedPage.formulaText ? (
                        <View style={props.styles.generatedFormulaCallout}>
                          <Text style={props.styles.generatedSummaryLabel}>필기 핵심</Text>
                          <Text style={props.styles.generatedSummaryBody}>{props.activeGeneratedPage.formulaText}</Text>
                        </View>
                      ) : null}
                    </ScrollView>
                  </View>
                </View>
              </View>
              </View>
            </View>
          ) : props.studyDocument.type === 'pdf' && props.studyDocument.file ? (
            <PdfPreview
              file={props.studyDocument.file}
              page={props.currentPdfPage}
              inkTool={props.inkTool}
              inkStrokes={props.inkStrokes}
              selectionRect={props.selectionRect}
              onCommitInkStroke={props.onCommitInkStroke}
              onSelectionChange={props.onSelectionChange}
              onPageChanged={props.onSetCurrentPdfPage}
              styles={props.styles}
            />
          ) : (
            <View style={props.styles.blankNotebookStage}>
              <Text style={props.styles.blankNotebookTitle}>빈 노트</Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  const selectedSubject = props.subject;
  return (
    <ScrollView style={props.styles.main} contentContainerStyle={[props.styles.desktopPage, props.compact && props.styles.desktopPageCompact]}>
      <View style={props.styles.desktopNotesTopRow}>
        <View><Text style={[props.styles.desktopTitle, props.compact && props.styles.desktopTitleCompact]}>{props.noteMode === 'photo' ? 'Photo' : 'Note'}</Text></View>
        <View style={props.styles.desktopModeSegment}>
          <Pressable style={[props.styles.desktopModeButton, props.noteMode === 'photo' && props.styles.desktopModeButtonActive]} onPress={() => props.onChangeMode('photo')}><Text style={[props.styles.desktopModeButtonText, props.noteMode === 'photo' && props.styles.desktopModeButtonTextActive]}>Photo</Text></Pressable>
          <Pressable style={[props.styles.desktopModeButton, props.noteMode === 'note' && props.styles.desktopModeButtonActive]} onPress={() => props.onChangeMode('note')}><Text style={[props.styles.desktopModeButtonText, props.noteMode === 'note' && props.styles.desktopModeButtonTextActive]}>Note</Text></Pressable>
        </View>
      </View>
      <View style={props.styles.desktopFilters}>
        <View style={props.styles.desktopSearch}>
          <Text style={props.styles.searchIcon}>⌕</Text>
          <TextInput value={props.query} onChangeText={props.onQuery} placeholder={props.noteMode === 'photo' ? 'Photo 검색' : 'Note 검색'} placeholderTextColor="#C3C8D5" style={props.styles.searchInput} />
        </View>
        <Pressable style={props.styles.desktopFilterButton} onPress={props.onSort}><Text style={props.styles.desktopFilterButtonText}>{props.sort === 'latest' ? '최신순' : '오래된순'}</Text></Pressable>
        {props.noteMode === 'note' ? (
          <>
            <Pressable style={[props.styles.desktopFilterButton, props.styles.desktopPrimaryAction]}><Text style={[props.styles.desktopFilterButtonText, props.styles.desktopPrimaryActionText]}>+ 새 노트</Text></Pressable>
            <Pressable style={props.styles.desktopFilterButton}><Text style={props.styles.desktopFilterButtonText}>PDF 업로드</Text></Pressable>
          </>
        ) : null}
        <Pressable style={props.styles.desktopFilterButton} onPress={props.onReset}><Text style={props.styles.desktopFilterButtonText}>초기화</Text></Pressable>
      </View>
      <View style={[props.styles.desktopNotesLayout, props.compact && props.styles.desktopNotesLayoutCompact]}>
        <View style={[props.styles.desktopSubjects, props.compact && props.styles.desktopSubjectsCompact]}>
          {props.subjects.map((item) => (
            <Pressable key={item.id} style={[props.styles.subjectRow, selectedSubject?.id === item.id && { borderColor: item.color, backgroundColor: '#FFFFFF', shadowColor: item.color }, selectedSubject?.id === item.id && props.styles.subjectRowActive]} onPress={() => props.onOpenSubject(item.id)}>
              <View style={[props.styles.subjectIconBox, { backgroundColor: item.bgColor }, selectedSubject?.id === item.id && { backgroundColor: item.color }]}>
                <View style={[props.styles.subjectDot, { backgroundColor: darkenHex(item.bgColor, 0.28) }]} />
              </View>
              <View style={props.styles.fill}>
                <Text style={[props.styles.subjectTitle, selectedSubject?.id === item.id && props.styles.subjectTitleActive]}>{item.name}</Text>
                <Text style={[props.styles.subjectMeta, selectedSubject?.id === item.id && props.styles.subjectMetaActive]}>
                  {props.noteMode === 'photo' ? `${item.noteCount}개 노트` : `${allStudyDocuments.filter((document) => document.subjectId === item.id).length}개 문서`}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
        <View style={props.styles.fill}>
          {props.noteMode === 'photo' ? (
            props.notes.length ? props.notes.map((item) => {
              const subject = allSubjects.find((v) => v.id === item.subjectId)!;
              return (
                <Pressable key={item.id} style={props.styles.noteListCard} onPress={() => props.onOpenNote(item.id)}>
                  <View style={[props.styles.noteListRail, { backgroundColor: subject.color }]} />
                  <Image source={item.image} style={props.styles.noteListThumb} resizeMode="cover" />
                  <View style={props.styles.fill}>
                    <Text style={props.styles.noteListDate}>{item.date}</Text>
                    <Text style={props.styles.noteListTitle} numberOfLines={2}>{item.title}</Text>
                  </View>
                </Pressable>
              );
            }) : <View style={props.styles.emptyCard}><Text style={props.styles.emptyTitle}>표시할 노트가 없습니다</Text><Text style={props.styles.emptyBody}>현재는 시간표와 과목 정보만 실제 데이터로 교체한 상태입니다.</Text></View>
          ) : (
            <View style={props.styles.desktopDocumentsPanel}>
              {props.studyDocuments.length ? props.studyDocuments.map((item) => {
                const subject = allSubjects.find((v) => v.id === item.subjectId)!;
                const isPdf = item.type === 'pdf';
                return (
                  <Pressable key={item.id} style={props.styles.documentListCard} onPress={() => props.onOpenStudyDocument(item.id)}>
                    <View style={[props.styles.documentListRail, { backgroundColor: subject.color }]} />
                    <View style={[props.styles.documentThumb, { backgroundColor: isPdf ? '#F6F8FE' : '#EEF1F6' }]}>
                      <Text style={[props.styles.documentThumbText, { color: isPdf ? props.blueColor : '#6B7280' }]}>{isPdf ? 'PDF' : 'NOTE'}</Text>
                    </View>
                    <View style={props.styles.fill}>
                      <View style={props.styles.documentTitleRow}>
                        <Text style={props.styles.documentTitle} numberOfLines={1}>{item.title}</Text>
                        <View style={[props.styles.documentTypePill, { backgroundColor: isPdf ? '#EEF1FF' : '#F1F3F6' }]}>
                          <Text style={[props.styles.documentTypeText, { color: isPdf ? props.blueColor : '#6B7280' }]}>{isPdf ? 'PDF' : '빈 노트'}</Text>
                        </View>
                      </View>
                      <Text style={props.styles.documentMeta}>{item.updatedAt} · {item.pageCount}페이지</Text>
                    </View>
                  </Pressable>
                );
              }) : <View style={props.styles.emptyCard}><Text style={props.styles.emptyTitle}>문서가 없습니다</Text></View>}
            </View>
          )}
        </View>
      </View>
    </ScrollView>
  );
}
