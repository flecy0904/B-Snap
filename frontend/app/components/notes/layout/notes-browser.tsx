import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { subjects as allSubjects } from '../../../app-defaults';
import { CaptureAsset, NoteEntry, NoteWorkspaceMode, StudyDocumentEntry, Subject } from '../../../types';
import { darkenHex } from '../../../ui-helpers';

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
};

export function NotesBrowser(props: NotesBrowserProps) {
  const [recoveryOpen, setRecoveryOpen] = React.useState(false);
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
                    const keywords = (asset.analysisKeywords ?? []).slice(0, 3);
                    return (
                      <View key={asset.id} style={props.styles.photoGalleryCard}>
                        {imageSource ? (
                          <Image source={imageSource} style={props.styles.photoGalleryImage} resizeMode="cover" />
                        ) : (
                          <View style={props.styles.photoGalleryFallback}>
                            <MaterialCommunityIcons name="image-outline" size={28} color="#9AA6B8" />
                          </View>
                        )}
                        <View style={props.styles.photoGalleryCardBody}>
                          <Text style={props.styles.photoGalleryCardTitle} numberOfLines={2}>{asset.title}</Text>
                          <Text style={props.styles.photoGalleryCardMeta} numberOfLines={1}>{formatCaptureDate(asset.createdAt)} · {asset.sourceDeviceLabel}</Text>
                          <Text style={props.styles.photoGalleryCardSummary} numberOfLines={2}>{asset.analysisSummary ?? asset.summary}</Text>
                          {keywords.length ? (
                            <View style={props.styles.photoGalleryKeywordRow}>
                              {keywords.map((keyword) => (
                                <View key={`${asset.id}-${keyword}`} style={props.styles.photoGalleryKeyword}>
                                  <Text style={props.styles.photoGalleryKeywordText}>{keyword}</Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </View>
                      </View>
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
                const documentPreviewUri = item.thumbnailUrl ?? item.pageImageUrls?.[1] ?? (!isPdf && typeof item.file === 'object' && item.file && 'uri' in item.file ? item.file.uri : null);
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
    </ScrollView>
  );
}
