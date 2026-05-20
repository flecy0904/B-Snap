import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { subjects as allSubjects } from '../../../app-defaults';
import { CaptureAsset, NoteEntry, NoteWorkspaceMode, PageCaptureReference, StudyDocumentEntry, Subject } from '../../../types';
import { cleanAiDisplayText, darkenHex, derivePreprocessedCropUrl } from '../../../ui-helpers';
import { PhotoViewerLinkPanel } from './photo-viewer-link-panel';

function getCaptureImageSource(asset: CaptureAsset) {
  const uri = derivePreprocessedCropUrl(asset.processedUrl) ?? asset.thumbnailUrl ?? asset.processedUrl ?? asset.fileUrl ?? asset.previewImageKey;
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

export type NotesBrowserProps = {
  styles: any;
  compact: boolean;
  noteMode: NoteWorkspaceMode;
  query: string;
  sort: 'latest' | 'oldest';
  subjects: Subject[];
  selectedSubject: Subject | null;
  notes: NoteEntry[];
  allNotes: NoteEntry[];
  deletedNotes: NoteEntry[];
  studyDocuments: StudyDocumentEntry[];
  allStudyDocuments: StudyDocumentEntry[];
  deletedStudyDocuments: StudyDocumentEntry[];
  captureAssetsBySubject: Record<number, CaptureAsset[]>;
  pageCaptureReferences: PageCaptureReference[];
  blueColor: string;
  onChangeMode: (mode: NoteWorkspaceMode) => void;
  onQuery: (value: string) => void;
  onSort: () => void;
  onCreateBlankNote: () => void;
  onUploadPdf: () => void;
  onReset: () => void;
  onOpenSubject: (id: number) => void;
  onOpenNote: (id: number) => void;
  onOpenStudyDocument: (id: number) => void;
  onDeleteNote: (id: number) => void;
  onDeleteStudyDocument: (id: number) => void;
  onRestoreNote: (id: number) => void;
  onRestoreStudyDocument: (id: number) => void;
  onInsertInboxAsset: (assetId: string) => void;
  onLinkCaptureAssetToPage: (assetId: string, documentId: number, pageNumber: number) => boolean;
  onOpenPageCaptureReference: (referenceId: string) => void;
  onAskAiAboutPageCaptureReference: (referenceId: string) => void;
  onRemoveCaptureAsset: (assetId: string) => void;
};

export function NotesBrowser(props: NotesBrowserProps) {
  const [recoveryOpen, setRecoveryOpen] = React.useState(false);
  const [previewAssetId, setPreviewAssetId] = React.useState<string | null>(null);
  const subjectById = React.useMemo(() => {
    const map = new Map<number, Subject>();
    allSubjects.forEach((subject) => map.set(subject.id, subject));
    props.subjects.forEach((subject) => map.set(subject.id, subject));
    return map;
  }, [props.subjects]);
  const activeDeletedNotes = React.useMemo(
    () => props.selectedSubject ? props.deletedNotes.filter((note) => note.subjectId === props.selectedSubject?.id) : props.deletedNotes,
    [props.deletedNotes, props.selectedSubject?.id],
  );
  const activeDeletedStudyDocuments = React.useMemo(
    () => props.selectedSubject ? props.deletedStudyDocuments.filter((document) => document.subjectId === props.selectedSubject?.id) : props.deletedStudyDocuments,
    [props.deletedStudyDocuments, props.selectedSubject?.id],
  );
  const recoverableCount = props.noteMode === 'photo' ? activeDeletedNotes.length : activeDeletedStudyDocuments.length;
  const findSubject = React.useCallback((subjectId: number) => subjectById.get(subjectId), [subjectById]);
  const getSubjectPhotoAssets = React.useCallback((subjectId: number) => {
    const normalizedQuery = props.query.trim().toLowerCase();
    let assets = (props.captureAssetsBySubject[subjectId] ?? []).filter((asset) => asset.type === 'image' && asset.status !== 'dismissed');

    if (normalizedQuery) {
      assets = assets.filter((asset) => {
        const subjectName = findSubject(asset.subjectId)?.name ?? '';
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
      return props.sort === 'latest' ? rightTime - leftTime : leftTime - rightTime;
    });
  }, [findSubject, props.captureAssetsBySubject, props.query, props.sort]);
  const selectedPhotoAssets = React.useMemo(
    () => props.selectedSubject ? getSubjectPhotoAssets(props.selectedSubject.id) : [],
    [getSubjectPhotoAssets, props.selectedSubject],
  );
  const previewAsset = React.useMemo(
    () => selectedPhotoAssets.find((asset) => asset.id === previewAssetId) ?? null,
    [previewAssetId, selectedPhotoAssets],
  );
  const previewImageSource = previewAsset ? getCaptureImageSource(previewAsset) : null;
  const previewReferences = React.useMemo(
    () => previewAsset ? getCaptureReferences(previewAsset, props.pageCaptureReferences) : [],
    [previewAsset, props.pageCaptureReferences],
  );
  const previewPrimaryReference = previewReferences[0] ?? null;
  const linkableDocuments = React.useMemo(() => {
    if (!previewAsset) return [];
    return props.allStudyDocuments
      .filter((document) => document.subjectId === previewAsset.subjectId && document.type !== 'image' && document.pageCount > 0)
      .sort((left, right) => (left.id === previewPrimaryReference?.documentId ? -1 : right.id === previewPrimaryReference?.documentId ? 1 : right.id - left.id));
  }, [previewAsset, previewPrimaryReference?.documentId, props.allStudyDocuments]);
  const selectedLinkDocument = React.useMemo(
    () => linkableDocuments.find((document) => document.id === previewPrimaryReference?.documentId) ?? linkableDocuments[0] ?? null,
    [linkableDocuments, previewPrimaryReference?.documentId],
  );
  const selectedLinkInitialPageNumber = previewPrimaryReference?.page.kind === 'pdf' ? previewPrimaryReference.page.pageNumber : 1;

  React.useEffect(() => {
    if (recoverableCount === 0) setRecoveryOpen(false);
  }, [recoverableCount]);

  return (
    <ScrollView style={props.styles.main} contentContainerStyle={[props.styles.desktopPage, props.compact && props.styles.desktopPageCompact]}>
      <View style={props.styles.desktopNotesTopRow}>
        <View><Text style={[props.styles.desktopTitle, props.compact && props.styles.desktopTitleCompact]}>{props.noteMode === 'photo' ? 'Photo' : 'Note'}</Text></View>
        <View style={props.styles.desktopModeSegment}>
          <Pressable style={[props.styles.desktopModeButton, props.noteMode === 'note' && props.styles.desktopModeButtonActive]} onPress={() => props.onChangeMode('note')}><Text style={[props.styles.desktopModeButtonText, props.noteMode === 'note' && props.styles.desktopModeButtonTextActive]}>Note</Text></Pressable>
          <Pressable style={[props.styles.desktopModeButton, props.noteMode === 'photo' && props.styles.desktopModeButtonActive]} onPress={() => props.onChangeMode('photo')}><Text style={[props.styles.desktopModeButtonText, props.noteMode === 'photo' && props.styles.desktopModeButtonTextActive]}>Photo</Text></Pressable>
        </View>
      </View>
      <View style={props.styles.desktopFilters}>
        <View style={props.styles.desktopSearch}>
          <Text style={props.styles.searchIcon}>⌕</Text>
          <TextInput value={props.query} onChangeText={props.onQuery} placeholder={props.noteMode === 'photo' ? 'Photo 검색' : 'Note 검색'} placeholderTextColor="#C3C8D5" style={props.styles.searchInput} />
        </View>
        <Pressable style={props.styles.desktopFilterButton} onPress={props.onSort}><Text style={props.styles.desktopFilterButtonText}>{props.sort === 'latest' ? '최신순' : '오래된순'}</Text></Pressable>
        {recoverableCount ? (
          <Pressable style={[props.styles.desktopFilterButton, props.styles.recoveryFilterButton]} onPress={() => setRecoveryOpen((current) => !current)}>
            <Text style={props.styles.desktopFilterButtonText}>최근 삭제 {recoverableCount}</Text>
          </Pressable>
        ) : null}
        {props.noteMode === 'note' ? (
          <>
            <Pressable style={[props.styles.desktopFilterButton, props.styles.desktopPrimaryAction]} onPress={props.onCreateBlankNote}><Text style={[props.styles.desktopFilterButtonText, props.styles.desktopPrimaryActionText]}>+ 새 노트</Text></Pressable>
            <Pressable style={props.styles.desktopFilterButton} onPress={props.onUploadPdf}><Text style={props.styles.desktopFilterButtonText}>PDF 업로드</Text></Pressable>
          </>
        ) : null}
        <Pressable style={props.styles.desktopFilterButton} onPress={props.onReset}><Text style={props.styles.desktopFilterButtonText}>초기화</Text></Pressable>
      </View>
      {recoveryOpen && recoverableCount ? (
        <View style={props.styles.recoveryPanel}>
          <View style={props.styles.recoveryHeader}>
            <Text style={props.styles.recoveryTitle}>최근 삭제</Text>
            <Text style={props.styles.recoveryMeta}>{props.selectedSubject ? props.selectedSubject.name : '전체'} · {recoverableCount}개</Text>
          </View>
          {props.noteMode === 'photo' ? activeDeletedNotes.map((item) => {
            const subject = findSubject(item.subjectId);
            return (
              <View key={item.id} style={props.styles.recoveryRow}>
                <View style={props.styles.recoveryRowMeta}>
                  <Text style={props.styles.recoveryRowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={props.styles.recoveryRowBody} numberOfLines={1}>{subject?.name ?? '과목 없음'} · {item.date}</Text>
                </View>
                <Pressable style={props.styles.recoveryRestoreButton} onPress={() => props.onRestoreNote(item.id)}>
                  <Text style={props.styles.recoveryRestoreButtonText}>복구</Text>
                </Pressable>
              </View>
            );
          }) : activeDeletedStudyDocuments.map((item) => {
            const subject = findSubject(item.subjectId);
            return (
              <View key={item.id} style={props.styles.recoveryRow}>
                <View style={props.styles.recoveryRowMeta}>
                  <Text style={props.styles.recoveryRowTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={props.styles.recoveryRowBody} numberOfLines={1}>{subject?.name ?? '과목 없음'} · {item.type === 'pdf' ? 'PDF' : item.type === 'image' ? '이미지' : '빈 노트'} · {item.pageCount}페이지</Text>
                </View>
                <Pressable style={props.styles.recoveryRestoreButton} onPress={() => props.onRestoreStudyDocument(item.id)}>
                  <Text style={props.styles.recoveryRestoreButtonText}>복구</Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}
      <View style={[props.styles.desktopNotesLayout, props.compact && props.styles.desktopNotesLayoutCompact]}>
        <View style={[props.styles.desktopSubjects, props.compact && props.styles.desktopSubjectsCompact]}>
          {props.subjects.map((item) => (
            <Pressable key={item.id} style={[props.styles.subjectRow, props.selectedSubject?.id === item.id && { borderColor: item.color, backgroundColor: '#FFFFFF' }, props.selectedSubject?.id === item.id && props.styles.subjectRowActive]} onPress={() => props.onOpenSubject(item.id)}>
              <View style={[props.styles.subjectIconBox, { backgroundColor: item.bgColor }, props.selectedSubject?.id === item.id && { backgroundColor: item.color }]}>
                <View style={[props.styles.subjectDot, { backgroundColor: darkenHex(item.bgColor, 0.28) }]} />
              </View>
              <View style={props.styles.fill}>
                <Text style={[props.styles.subjectTitle, props.selectedSubject?.id === item.id && props.styles.subjectTitleActive]}>{item.name}</Text>
                <Text style={[props.styles.subjectMeta, props.selectedSubject?.id === item.id && props.styles.subjectMetaActive]}>
                  {props.noteMode === 'photo' ? `${getSubjectPhotoAssets(item.id).length}장 사진` : `${props.allStudyDocuments.filter((document) => document.subjectId === item.id).length}개 문서`}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
        <View style={props.styles.fill}>
          {props.noteMode === 'photo' ? (
            selectedPhotoAssets.length ? (
              <View style={props.styles.photoGalleryPanel}>
                <View style={props.styles.photoGalleryHeader}>
                  <View>
                    <Text style={props.styles.photoGalleryTitle}>{props.selectedSubject?.name ?? 'Photo'} 원본 사진</Text>
                    <Text style={props.styles.photoGalleryMeta}>{selectedPhotoAssets.length}장 · 촬영/가져오기 원본 저장</Text>
                  </View>
                </View>
                <View style={props.styles.photoGalleryGrid}>
                  {selectedPhotoAssets.map((asset) => {
                    const imageSource = getCaptureImageSource(asset);
                    const placementLabel = getCapturePlacementLabel(asset, props.pageCaptureReferences);
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
            ) : (
              <View style={props.styles.emptyCard}>
                <Text style={props.styles.emptyTitle}>저장된 사진이 없습니다</Text>
                <Text style={props.styles.emptyBody}>카메라나 사진첩에서 가져온 원본 사진은 이 과목 Photo 라이브러리에 모입니다. 필기 중 페이지에 연결해도 여기에는 계속 남아 있어요.</Text>
              </View>
            )
          ) : (
            <View style={props.styles.desktopDocumentsPanel}>
              {props.studyDocuments.length ? props.studyDocuments.map((item) => {
                const subject = findSubject(item.subjectId);
                const subjectColor = subject?.color ?? '#D6DCE8';
                const isPdf = item.type === 'pdf';
                const isImage = item.type === 'image';
                const documentPreviewUri = item.thumbnailUrl ?? (!isPdf && typeof item.file === 'object' && item.file && 'uri' in item.file ? item.file.uri : null);
                return (
                  <Pressable key={item.id} style={props.styles.documentListCard} onPress={() => props.onOpenStudyDocument(item.id)}>
                    <View style={[props.styles.documentListRail, { backgroundColor: subjectColor }]} />
                    <View style={[props.styles.documentThumb, { backgroundColor: isPdf ? '#F6F8FE' : isImage ? '#F3FAF7' : '#EEF1F6' }]}>
                      {documentPreviewUri ? (
                        <Image source={{ uri: documentPreviewUri }} style={props.styles.documentThumbImage} resizeMode="cover" />
                      ) : (
                        <Text style={[props.styles.documentThumbText, { color: isPdf ? props.blueColor : isImage ? '#23845F' : '#6B7280' }]}>{isPdf ? 'PDF' : isImage ? 'IMG' : 'NOTE'}</Text>
                      )}
                    </View>
                    <View style={props.styles.fill}>
                      <View style={props.styles.documentTitleRow}>
                        <Text style={props.styles.documentTitle} numberOfLines={1}>{item.title}</Text>
                        <View style={[props.styles.documentTypePill, { backgroundColor: isPdf ? '#EEF1FF' : isImage ? '#EAF8F2' : '#F1F3F6' }]}>
                          <Text style={[props.styles.documentTypeText, { color: isPdf ? props.blueColor : isImage ? '#23845F' : '#6B7280' }]}>{isPdf ? 'PDF' : isImage ? '이미지' : '빈 노트'}</Text>
                        </View>
                      </View>
                      <Text style={props.styles.documentMeta}>{item.updatedAt} · {item.pageCount}페이지</Text>
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
              }) : <View style={props.styles.emptyCard}><Text style={props.styles.emptyTitle}>문서가 없습니다</Text></View>}
            </View>
          )}
        </View>
      </View>
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
                  <Text style={props.styles.photoViewerTitle} numberOfLines={1}>{previewAsset.title || '원본 사진'}</Text>
                  <View style={props.styles.photoViewerMetaRow}>
                    <View style={props.styles.photoViewerMetaPill}>
                      <MaterialCommunityIcons name="calendar-clock-outline" size={13} color="#7E8798" />
                      <Text style={props.styles.photoViewerMetaPillText}>{formatCaptureDate(previewAsset.createdAt)}</Text>
                    </View>
                    <View style={[props.styles.photoViewerMetaPill, previewReferences.length && props.styles.photoViewerMetaPillLinked]}>
                      <MaterialCommunityIcons name={previewReferences.length ? 'link-variant' : 'link-off'} size={13} color={previewReferences.length ? '#4F68D2' : '#7E8798'} />
                      <Text style={[props.styles.photoViewerMetaPillText, previewReferences.length && props.styles.photoViewerMetaPillTextLinked]}>
                        {previewReferences.length ? `${previewReferences.length}곳 연결` : '미연결'}
                      </Text>
                    </View>
                  </View>
                </View>
                <Pressable style={props.styles.photoViewerCloseButton} onPress={() => setPreviewAssetId(null)}>
                  <MaterialCommunityIcons name="close" size={20} color="#5F6876" />
                </Pressable>
              </View>
              <ScrollView contentContainerStyle={props.styles.photoViewerBody} showsVerticalScrollIndicator={false}>
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
                  <View style={props.styles.photoViewerInfoCard}>
                    <View style={props.styles.photoViewerInfoHeader}>
                      <MaterialCommunityIcons name="file-link-outline" size={15} color="#5F79FF" />
                      <Text style={props.styles.photoViewerInfoTitle}>연결 위치</Text>
                    </View>
                    {previewReferences.length ? (
                      <View style={props.styles.photoViewerReferenceRow}>
                        {previewReferences.map((reference) => (
                          <Pressable
                            key={reference.id}
                            style={props.styles.photoViewerReferencePill}
                            onPress={() => {
                              props.onOpenPageCaptureReference(reference.id);
                              setPreviewAssetId(null);
                            }}
                          >
                            <Text style={props.styles.photoViewerReferencePillText}>{reference.pageLabel}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : (
                      <Text style={props.styles.photoViewerInfoValue}>아직 노트 페이지에 연결되지 않았습니다.</Text>
                    )}
                    <PhotoViewerLinkPanel
                      styles={props.styles}
                      assetId={previewAsset.id}
                      documents={linkableDocuments}
                      initialDocumentId={selectedLinkDocument?.id ?? null}
                      initialPageNumber={selectedLinkInitialPageNumber}
                      onLink={(assetId, documentId, pageNumber) => {
                        props.onLinkCaptureAssetToPage(assetId, documentId, pageNumber);
                        setPreviewAssetId(null);
                      }}
                    />
                  </View>
                  <View style={props.styles.photoViewerInfoCard}>
                    <View style={props.styles.photoViewerInfoHeader}>
                      <MaterialCommunityIcons name="star-four-points" size={15} color="#5F79FF" />
                      <Text style={props.styles.photoViewerInfoTitle}>AI 설명</Text>
                    </View>
                    <Text style={props.styles.photoViewerInfoValue}>
                      {cleanAiDisplayText(previewAsset.analysisSummary ?? previewAsset.summary)}
                    </Text>
                  </View>
                </View>
              </ScrollView>
              <View style={props.styles.photoViewerActionRow}>
                {previewPrimaryReference ? (
                  <Pressable
                    style={props.styles.photoViewerActionButton}
                    onPress={() => {
                      props.onAskAiAboutPageCaptureReference(previewPrimaryReference.id);
                      setPreviewAssetId(null);
                    }}
                  >
                    <MaterialCommunityIcons name="star-four-points" size={16} color="#4F68D2" />
                    <Text style={props.styles.photoViewerActionText}>AI에게 질문</Text>
                  </Pressable>
                ) : null}
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
