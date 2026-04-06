import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { PdfPreview } from './pdf-preview';
import { buildAiResponse, NoteSummaryContent } from './notes-shared';
import { CaptureAsset, NoteEntry, NoteWorkspaceMode, StudyDocumentEntry, Subject, WorkspaceAttachment } from '../types';
import { InkStroke, InkTool, SelectionRect } from '../ui-types';
import { darkenHex } from '../ui-helpers';

export function MobileNotesView(props: {
  subject: Subject | null;
  note: NoteEntry | null;
  studyDocument: StudyDocumentEntry | null;
  notes: NoteEntry[];
  studyDocuments: StudyDocumentEntry[];
  subjects: Subject[];
  query: string;
  noteTab: 'original' | 'summary';
  noteMode: NoteWorkspaceMode;
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
  onChangeNoteTab: (tab: 'original' | 'summary') => void;
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
  onQuery: (value: string) => void;
  onOpenNote: (id: number) => void;
  onOpenStudyDocument: (id: number | null) => void;
  onOpenSubject: (id: number) => void;
  onBackToSubjectList: () => void;
  onBackToNoteList: () => void;
  styles: any;
  blueColor: string;
}) {
  const [inboxPanelOpen, setInboxPanelOpen] = React.useState(false);
  const { normalizedQuestion, aiResponse, aiResponseSections } = buildAiResponse(props.aiQuestion, props.selectionRect, false);

  if (props.noteMode === 'note' && props.studyDocument && props.subject) {
    return (
      <View style={props.styles.main}>
        <View style={props.styles.centerTopBar}>
          <Pressable onPress={props.onBackToNoteList} style={props.styles.navIcon}><Text style={props.styles.navIconText}>{'‹'}</Text></Pressable>
          <View style={props.styles.noteCenterWrap}>
            <Text style={props.styles.noteCenterTitle}>{props.subject.name}</Text>
            <Text style={props.styles.noteCenterDate}>{props.studyDocument.title}</Text>
          </View>
          <Pressable style={props.styles.navIcon} onPress={props.onToggleAiPanel}>
            <MaterialCommunityIcons name="star-four-points" size={18} color="#5F79FF" />
          </Pressable>
        </View>
        <View style={props.styles.mobileDocToolbar}>
          <View style={props.styles.mobileDocTools}>
            {[
              ['view', 'cursor-default-outline'],
              ['pen', 'pencil-outline'],
              ['select', 'selection-drag'],
            ].map(([value, icon]) => (
              <Pressable key={value} style={[props.styles.mobileDocToolButton, props.inkTool === value && props.styles.inkToolButtonActive]} onPress={() => props.onChangeInkTool(value as InkTool)}>
                <MaterialCommunityIcons name={icon as any} size={18} color={props.inkTool === value ? props.blueColor : '#7D8797'} />
              </Pressable>
            ))}
            <Pressable style={props.styles.mobileDocToolButton} onPress={props.onUndoInk}><MaterialCommunityIcons name="undo-variant" size={18} color="#7D8797" /></Pressable>
            <Pressable style={props.styles.mobileDocToolButton} onPress={props.onClearInk}><MaterialCommunityIcons name="trash-can-outline" size={18} color="#7D8797" /></Pressable>
          </View>
        </View>
        {props.incomingAssetSuggestion ? (
          <View style={props.styles.workspaceBanner}>
            <Text style={props.styles.workspaceBannerEyebrow}>{props.incomingAssetSuggestion.sourceDeviceLabel}</Text>
            <Text style={props.styles.workspaceBannerTitle}>
              새 {props.incomingAssetSuggestion.type === 'image' ? '이미지' : 'PDF'} 1건이 현재 PDF 워크스페이스에 도착했습니다
            </Text>
            <Text style={props.styles.workspaceBannerBody}>{props.incomingAssetSuggestion.summary}</Text>
            <View style={props.styles.workspaceBannerActions}>
              <Pressable style={props.styles.workspacePrimaryAction} onPress={props.onAcceptIncomingAsset}>
                <Text style={props.styles.workspacePrimaryActionText}>삽입</Text>
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
        {props.workspaceFeedback ? (
          <View style={props.styles.workspaceToast}>
            <MaterialCommunityIcons name="check-circle-outline" size={16} color="#4D67D8" />
            <Text style={props.styles.workspaceToastText}>{props.workspaceFeedback}</Text>
          </View>
        ) : null}
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
        ) : (
          <View style={props.styles.workspaceEmptyState}>
            <Text style={props.styles.workspaceEmptyTitle}>첨부된 자료가 없습니다</Text>
          </View>
        )}
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
                            <Text style={props.styles.workspaceInlineActionText}>다음 페이지 삽입</Text>
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
        <View style={props.styles.mobilePdfStage}>
          {props.studyDocument.file ? (
            <PdfPreview file={props.studyDocument.file} page={1} inkTool={props.inkTool} inkStrokes={props.inkStrokes} selectionRect={props.selectionRect} onCommitInkStroke={props.onCommitInkStroke} onSelectionChange={props.onSelectionChange} styles={props.styles} />
          ) : (
            <View style={props.styles.blankNotebookStage}>
              <Text style={props.styles.blankNotebookTitle}>빈 노트</Text>
            </View>
          )}
        </View>
        {props.aiPanelOpen ? (
          <View style={props.styles.mobileAiSheet}>
            <View style={props.styles.mobileAiHandle} />
            <View style={props.styles.mobileAiHeader}>
              <MaterialCommunityIcons name="star-four-points" size={20} color="#5F79FF" />
              <Pressable style={props.styles.aiPanelClose} onPress={props.onToggleAiPanel}><MaterialCommunityIcons name="close" size={18} color="#7A8394" /></Pressable>
            </View>
            <ScrollView contentContainerStyle={props.styles.mobileAiScrollContent} showsVerticalScrollIndicator={false}>
              <View style={props.styles.aiStateCard}>
                <Text style={props.styles.aiStateTitle}>선택 영역</Text>
                <Text style={props.styles.aiStateBody}>{props.selectionRect ? `${Math.round(props.selectionRect.width)} × ${Math.round(props.selectionRect.height)} 영역 선택됨` : '아직 선택된 영역이 없습니다'}</Text>
              </View>
              {['이 그래프 의미 뭐야?', '여기서 중요한 개념 3개만 알려줘', '시험 대비 관점으로 설명해줘'].map((prompt) => (
                <Pressable key={prompt} style={props.styles.aiSuggestionChip} onPress={() => props.onChangeAiQuestion(prompt)}><Text style={props.styles.aiSuggestionText}>{prompt}</Text></Pressable>
              ))}
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
          <Pressable style={props.styles.navIcon}><Text style={props.styles.navIconText}>⋯</Text></Pressable>
        </View>
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
    const latestNote = props.notes[0] ?? null;
    return (
      <ScrollView style={props.styles.main} contentContainerStyle={props.styles.mobilePage}>
        <View style={props.styles.centerTopBar}>
          <Pressable onPress={props.onBackToSubjectList} style={props.styles.navIcon}><Text style={props.styles.navIconText}>{'‹'}</Text></Pressable>
          <Text style={props.styles.centerTopTitle}>{currentSubject.name}</Text>
          <Pressable style={props.styles.navIcon}><Text style={props.styles.navIconText}>⋯</Text></Pressable>
        </View>
        <View style={props.styles.segment}>
          <Pressable style={[props.styles.segmentButton, props.noteMode === 'photo' && props.styles.segmentButtonActive]} onPress={() => props.onChangeMode('photo')}><Text style={[props.styles.segmentText, props.noteMode === 'photo' && props.styles.segmentTextActive]}>Photo</Text></Pressable>
          <Pressable style={[props.styles.segmentButton, props.noteMode === 'note' && props.styles.segmentButtonActive]} onPress={() => props.onChangeMode('note')}><Text style={[props.styles.segmentText, props.noteMode === 'note' && props.styles.segmentTextActive]}>Note</Text></Pressable>
        </View>
        <View style={[props.styles.subjectHeroCard, { backgroundColor: currentSubject.bgColor, borderColor: currentSubject.color }]}>
          <View style={[props.styles.subjectHeroDot, { backgroundColor: currentSubject.color }]} />
          <View style={props.styles.fill}>
            <Text style={[props.styles.subjectHeroMeta, { color: currentSubject.textColor }]}>
              {props.noteMode === 'photo' ? latestNote ? `최근 업데이트 · ${latestNote.preview}` : '최근 업데이트가 아직 없습니다' : props.studyDocuments[0] ? `최근 문서 · ${props.studyDocuments[0].title}` : '아직 등록된 문서가 없습니다'}
            </Text>
          </View>
        </View>
        {props.noteMode === 'photo'
          ? props.notes.length
            ? props.notes.map((item) => (
                <Pressable key={item.id} style={[props.styles.noteListCard, { borderColor: currentSubject.bgColor }]} onPress={() => props.onOpenNote(item.id)}>
                  <View style={[props.styles.noteListRail, { backgroundColor: currentSubject.color }]} />
                  <Image source={item.image} style={props.styles.noteListThumb} resizeMode="cover" />
                  <View style={props.styles.fill}>
                    <Text style={props.styles.noteListDate}>{item.date}</Text>
                    <Text style={props.styles.noteListTitle} numberOfLines={2}>{item.title}</Text>
                  </View>
                </Pressable>
              ))
            : (
                <View style={[props.styles.emptyCard, { borderColor: currentSubject.color, backgroundColor: currentSubject.bgColor }]}>
                  <Text style={[props.styles.emptyTitle, { color: currentSubject.textColor }]}>아직 등록된 노트가 없습니다</Text>
                  <Text style={[props.styles.emptyBody, { color: currentSubject.textColor }]}>시간표에서 이 과목을 누르면 바로 여기로 이동합니다. 이후 과목별 노트만 연결하면 흐름이 완성됩니다.</Text>
                </View>
              )
          : props.studyDocuments.length
            ? props.studyDocuments.map((item) => {
                const isPdf = item.type === 'pdf';
                return (
                  <Pressable key={item.id} style={[props.styles.mobileDocumentCard, { borderColor: currentSubject.bgColor }]} onPress={() => props.onOpenStudyDocument(item.id)}>
                    <View style={[props.styles.noteListRail, { backgroundColor: currentSubject.color }]} />
                    <View style={[props.styles.mobileDocumentThumb, isPdf ? props.styles.mobileDocumentThumbPdf : props.styles.mobileDocumentThumbBlank]}>
                      <Text style={[props.styles.mobileDocumentThumbText, { color: isPdf ? props.blueColor : '#6B7280' }]}>{isPdf ? 'PDF' : 'NOTE'}</Text>
                    </View>
                    <View style={props.styles.fill}>
                      <Text style={props.styles.noteListTitle} numberOfLines={2}>{item.title}</Text>
                      <Text style={props.styles.noteListDate}>{item.updatedAt} · {item.pageCount}페이지</Text>
                    </View>
                  </Pressable>
                );
              })
            : (
                <View style={[props.styles.emptyCard, { borderColor: currentSubject.color, backgroundColor: currentSubject.bgColor }]}>
                  <Text style={[props.styles.emptyTitle, { color: currentSubject.textColor }]}>아직 등록된 문서가 없습니다</Text>
                  <Text style={[props.styles.emptyBody, { color: currentSubject.textColor }]}>PDF 업로드와 빈 노트는 모바일에서도 같은 방식으로 열 수 있습니다.</Text>
                </View>
              )}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={props.styles.main} contentContainerStyle={props.styles.mobilePage}>
      <Text style={props.styles.pageTitle}>노트</Text>
      <View style={props.styles.segment}>
        <Pressable style={[props.styles.segmentButton, props.noteMode === 'photo' && props.styles.segmentButtonActive]} onPress={() => props.onChangeMode('photo')}><Text style={[props.styles.segmentText, props.noteMode === 'photo' && props.styles.segmentTextActive]}>Photo</Text></Pressable>
        <Pressable style={[props.styles.segmentButton, props.noteMode === 'note' && props.styles.segmentButtonActive]} onPress={() => props.onChangeMode('note')}><Text style={[props.styles.segmentText, props.noteMode === 'note' && props.styles.segmentTextActive]}>Note</Text></Pressable>
      </View>
      <View style={props.styles.searchBox}>
        <Text style={props.styles.searchIcon}>⌕</Text>
        <TextInput value={props.query} onChangeText={props.onQuery} placeholder={props.noteMode === 'photo' ? 'Photo 검색' : 'Note 검색'} placeholderTextColor="#C3C8D5" style={props.styles.searchInput} />
      </View>
      {props.subjects.filter((item) => !props.query.trim() || item.name.includes(props.query.trim())).map((item) => (
        <Pressable key={item.id} style={props.styles.subjectRow} onPress={() => props.onOpenSubject(item.id)}>
          <View style={[props.styles.subjectIconBox, { backgroundColor: item.bgColor }]}>
            <View style={[props.styles.subjectDot, { backgroundColor: darkenHex(item.bgColor, 0.28) }]} />
          </View>
          <View style={props.styles.fill}>
            <Text style={props.styles.subjectTitle}>{item.name}</Text>
            <Text style={props.styles.subjectMeta}>{props.noteMode === 'photo' ? `${props.notes.filter((note) => note.subjectId === item.id).length}개 노트` : `${props.studyDocuments.filter((document) => document.subjectId === item.id).length}개 문서`}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
