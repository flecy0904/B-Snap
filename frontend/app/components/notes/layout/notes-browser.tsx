import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Svg from 'react-native-svg';
import { subjects as allSubjects } from '../../../app-defaults';
import { CaptureAsset, NoteEntry, NoteWorkspaceMode, PageCaptureReference, StudyDocumentEntry, Subject } from '../../../types';
import type { InkStroke, InkTextAnnotation } from '../../../ui-types';
import { darkenHex, scaleInkStrokeToPageSize, scaleTextAnnotationToPageSize } from '../../../ui-helpers';
import { PhotoViewerModal } from './photo-viewer-modal';
import { InkPath } from '../canvas/ink-path';
import {
  formatCaptureDate,
  getCaptureLibraryContextLabel,
  getCaptureImageSource,
} from '../shared/capture-assets';

type DocumentViewMode = 'list' | 'grid';

const NOTE_THUMBNAIL_PAGE_WIDTH = 612;
const NOTE_THUMBNAIL_PAGE_HEIGHT = 792;
const DOCUMENT_VIEW_MODE_STORAGE_KEY = 'bsnap-notes-document-view-mode';

function isDocumentViewMode(value: string | null | undefined): value is DocumentViewMode {
  return value === 'list' || value === 'grid';
}

function readStoredDocumentViewMode(): DocumentViewMode {
  if (Platform.OS !== 'web') return 'list';
  try {
    const value = globalThis.localStorage?.getItem(DOCUMENT_VIEW_MODE_STORAGE_KEY);
    return isDocumentViewMode(value) ? value : 'list';
  } catch {
    return 'list';
  }
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
  inkByDocument?: Record<number, InkStroke[]>;
  textAnnotationsByDocument?: Record<number, InkTextAnnotation[]>;
  captureAssetsBySubject: Record<number, CaptureAsset[]>;
  pageCaptureReferences: PageCaptureReference[];
  blueColor: string;
  backendDocumentSyncing: boolean;
  onChangeMode: (mode: NoteWorkspaceMode) => void;
  onQuery: (value: string) => void;
  onSort: () => void;
  onSyncBackendDocuments: (options?: { showFeedback?: boolean }) => void | Promise<boolean>;
  onCreateBlankNote: () => void;
  onUploadPdf: () => void;
  onReset: () => void;
  onOpenSubject: (id: number) => void;
  onOpenNote: (id: number) => void;
  onOpenStudyDocument: (id: number) => void;
  onDeleteNote: (id: number) => void;
  onDeleteStudyDocument: (id: number) => void;
  onRenameStudyDocument: (id: number, title: string) => boolean;
  onRestoreNote: (id: number) => void;
  onRestoreStudyDocument: (id: number) => void;
  onInsertInboxAsset: (assetId: string) => void;
  onLinkCaptureAssetToPage: (assetId: string, documentId: number, pageNumber: number) => boolean;
  onOpenPageCaptureReference: (referenceId: string) => void;
  onAskAiAboutPageCaptureReference: (referenceId: string) => void;
  onRemoveCaptureAsset: (assetId: string) => void;
  isWeb?: boolean;
};

export function NotesBrowser(props: NotesBrowserProps) {
  const [recoveryOpen, setRecoveryOpen] = React.useState(false);
  const [previewAssetId, setPreviewAssetId] = React.useState<string | null>(null);
  const [documentViewMode, setDocumentViewMode] = React.useState<DocumentViewMode>(() => readStoredDocumentViewMode());
  const [documentActionMenuId, setDocumentActionMenuId] = React.useState<number | null>(null);
  const [renameDocumentId, setRenameDocumentId] = React.useState<number | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const isWeb = Boolean(props.isWeb);
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
  const photoGalleryTitle = selectedPhotoAssets.length === 1
    ? selectedPhotoAssets[0].title
    : `${props.selectedSubject?.name ?? 'Photo'} 사진 모음`;
  const previewAsset = React.useMemo(
    () => selectedPhotoAssets.find((asset) => asset.id === previewAssetId) ?? null,
    [previewAssetId, selectedPhotoAssets],
  );
  const visibleItemCount = props.noteMode === 'photo' ? selectedPhotoAssets.length : props.studyDocuments.length;
  const totalItemCount = props.noteMode === 'photo'
    ? Object.values(props.captureAssetsBySubject).reduce((total, assets) => (
        total + assets.filter((asset) => asset.type === 'image' && asset.status !== 'dismissed').length
      ), 0)
    : props.allStudyDocuments.length;
  const itemUnit = props.noteMode === 'photo' ? '장' : '개';
  const scopeLabel = props.selectedSubject?.name ?? '전체 과목';
  const renamingDocument = React.useMemo(
    () => props.allStudyDocuments.find((item) => item.id === renameDocumentId) ?? null,
    [props.allStudyDocuments, renameDocumentId],
  );
  const notePreviewByDocumentId = React.useMemo(() => {
    const previews = new Map<number, { strokes: InkStroke[]; textAnnotations: InkTextAnnotation[] }>();
    props.studyDocuments
      .filter((item) => item.type === 'blank')
      .forEach((item) => {
        const strokes = (props.inkByDocument?.[item.id] ?? [])
          .filter((stroke) => !stroke.generatedPageId && (!stroke.pageNumber || stroke.pageNumber === 1) && stroke.points.length > 0)
          .slice(-24)
          .map((stroke) => scaleInkStrokeToPageSize(stroke, NOTE_THUMBNAIL_PAGE_WIDTH, NOTE_THUMBNAIL_PAGE_HEIGHT));
        const textAnnotations = (props.textAnnotationsByDocument?.[item.id] ?? [])
          .filter((annotation) => !annotation.generatedPageId && annotation.pageNumber === 1 && annotation.text.trim().length > 0)
          .slice(-4)
          .map((annotation) => scaleTextAnnotationToPageSize(annotation, NOTE_THUMBNAIL_PAGE_WIDTH, NOTE_THUMBNAIL_PAGE_HEIGHT));
        previews.set(item.id, { strokes, textAnnotations });
      });
    return previews;
  }, [props.inkByDocument, props.studyDocuments, props.textAnnotationsByDocument]);
  const getDocumentVisual = React.useCallback((item: StudyDocumentEntry) => {
    const subject = findSubject(item.subjectId);
    const subjectColor = subject?.color ?? '#D6DCE8';
    const isPdf = item.type === 'pdf';
    const isImage = item.type === 'image';
    const isBlank = item.type === 'blank';
    const documentPreviewUri = item.thumbnailUrl ?? (isImage && typeof item.file === 'object' && item.file && 'uri' in item.file ? item.file.uri : null);
    return {
      subject,
      subjectColor,
      isPdf,
      isImage,
      isBlank,
      documentPreviewUri,
      thumbBg: isPdf ? '#F6F8FE' : isImage ? '#F3FAF7' : '#EEF1F6',
      typeBg: isPdf ? '#EEF1FF' : isImage ? '#EAF8F2' : '#F1F3F6',
      typeColor: isPdf ? props.blueColor : isImage ? '#23845F' : '#6B7280',
      typeLabel: isPdf ? 'PDF' : isImage ? '이미지' : '빈 노트',
      thumbLabel: isPdf ? 'PDF' : isImage ? 'IMG' : 'NOTE',
    };
  }, [findSubject, props.blueColor]);
  const renderNotebookPaperPreview = (item: StudyDocumentEntry, mode: DocumentViewMode) => {
    const preview = notePreviewByDocumentId.get(item.id) ?? { strokes: [], textAnnotations: [] };
    const hasPreviewContent = preview.strokes.length > 0 || preview.textAnnotations.length > 0;

    return (
      <View style={[props.styles.documentNotebookPaper, mode === 'grid' && props.styles.documentGridNotebookPaper]}>
        <View pointerEvents="none" style={props.styles.documentNotebookTopRule} />
        <View pointerEvents="none" style={props.styles.documentNotebookLines}>
          {Array.from({ length: mode === 'grid' ? 7 : 5 }, (_, index) => (
            <View key={index} style={[props.styles.documentNotebookLine, { top: `${18 + index * 11}%` }]} />
          ))}
        </View>
        {preview.strokes.length ? (
          <Svg
            width="100%"
            height="100%"
            viewBox={`0 0 ${NOTE_THUMBNAIL_PAGE_WIDTH} ${NOTE_THUMBNAIL_PAGE_HEIGHT}`}
            preserveAspectRatio="none"
            style={props.styles.documentNotebookInkSvg}
          >
            {preview.strokes.map((stroke) => <InkPath key={stroke.id} stroke={stroke} />)}
          </Svg>
        ) : null}
        {preview.textAnnotations.map((annotation) => (
          <View
            key={annotation.id}
            style={[
              props.styles.documentNotebookTextMark,
              {
                left: `${(annotation.x / NOTE_THUMBNAIL_PAGE_WIDTH) * 100}%`,
                top: `${(annotation.y / NOTE_THUMBNAIL_PAGE_HEIGHT) * 100}%`,
                width: `${(Math.max(48, annotation.width) / NOTE_THUMBNAIL_PAGE_WIDTH) * 100}%`,
              },
            ]}
          >
            <Text style={props.styles.documentNotebookText} numberOfLines={2}>{annotation.text}</Text>
          </View>
        ))}
        {!hasPreviewContent ? (
          <View pointerEvents="none" style={props.styles.documentNotebookEmptyHint}>
            <Text style={props.styles.documentNotebookEmptyText}>1p</Text>
          </View>
        ) : null}
      </View>
    );
  };
  const renderDocumentThumb = (item: StudyDocumentEntry, mode: DocumentViewMode) => {
    const visual = getDocumentVisual(item);
    const thumbStyle = mode === 'grid' ? props.styles.documentGridThumb : props.styles.documentThumb;
    const imageStyle = mode === 'grid' ? props.styles.documentGridThumbImage : props.styles.documentThumbImage;
    return (
      <View style={[thumbStyle, { backgroundColor: visual.thumbBg }]}>
        {visual.isBlank ? (
          renderNotebookPaperPreview(item, mode)
        ) : visual.documentPreviewUri ? (
          <Image source={{ uri: visual.documentPreviewUri }} style={imageStyle} resizeMode="cover" />
        ) : (
          <Text style={[props.styles.documentThumbText, { color: visual.typeColor }]}>{visual.thumbLabel}</Text>
        )}
      </View>
    );
  };
  const renderDocumentTypePill = (item: StudyDocumentEntry) => {
    const visual = getDocumentVisual(item);
    return (
      <View style={[props.styles.documentTypePill, { backgroundColor: visual.typeBg }]}>
        <Text style={[props.styles.documentTypeText, { color: visual.typeColor }]}>{visual.typeLabel}</Text>
      </View>
    );
  };
  const getDocumentRecencyLabel = (item: StudyDocumentEntry) => {
    if (!item.updatedAt || item.updatedAt === 'DB 저장됨') return '최근 수정';
    return item.updatedAt;
  };
  const formatDocumentMeta = (item: StudyDocumentEntry) => {
    const visual = getDocumentVisual(item);
    return `${visual.typeLabel} · ${item.pageCount}p · ${getDocumentRecencyLabel(item)}`;
  };
  const openDocumentRename = (item: StudyDocumentEntry) => {
    setDocumentActionMenuId(null);
    setRenameDocumentId(item.id);
    setRenameDraft(item.title);
    setRenameError(null);
  };
  const closeDocumentRename = () => {
    setRenameDocumentId(null);
    setRenameDraft('');
    setRenameError(null);
  };
  const saveDocumentRename = () => {
    if (!renamingDocument) return;
    if (!renameDraft.trim()) {
      setRenameError('제목을 입력해주세요.');
      return;
    }
    if (props.onRenameStudyDocument(renamingDocument.id, renameDraft)) {
      closeDocumentRename();
    }
  };
  const renderDocumentActionMenu = (item: StudyDocumentEntry, grid = false) => {
    if (documentActionMenuId !== item.id) return null;
    const visual = getDocumentVisual(item);
    const subjectName = visual.subject?.name ?? '과목 없음';

    return (
      <Pressable
        style={[props.styles.documentActionMenu, grid && props.styles.documentActionMenuGrid]}
        onPress={(event) => event.stopPropagation()}
      >
        <View style={props.styles.documentActionMenuHeader}>
          <View style={[props.styles.documentActionMenuDot, { backgroundColor: visual.subjectColor }]} />
          <View style={props.styles.fill}>
            <Text style={props.styles.documentActionMenuTitle} numberOfLines={2}>{item.title}</Text>
            <Text style={props.styles.documentActionMenuMeta} numberOfLines={1}>
              {subjectName} · {formatDocumentMeta(item)}
            </Text>
          </View>
        </View>
        <Pressable
          style={props.styles.documentActionMenuItem}
          onPress={(event) => {
            event.stopPropagation();
            setDocumentActionMenuId(null);
            props.onOpenStudyDocument(item.id);
          }}
        >
          <MaterialCommunityIcons name="book-open-page-variant-outline" size={18} color="#4F68D2" />
          <Text style={props.styles.documentActionMenuItemText}>열기</Text>
        </Pressable>
        <Pressable
          style={props.styles.documentActionMenuItem}
          onPress={(event) => {
            event.stopPropagation();
            openDocumentRename(item);
          }}
        >
          <MaterialCommunityIcons name="pencil-outline" size={18} color="#4F68D2" />
          <Text style={props.styles.documentActionMenuItemText}>이름 바꾸기</Text>
        </Pressable>
        <Pressable
          style={[props.styles.documentActionMenuItem, props.styles.documentActionMenuDangerItem]}
          onPress={(event) => {
            event.stopPropagation();
            setDocumentActionMenuId(null);
            props.onDeleteStudyDocument(item.id);
          }}
        >
          <MaterialCommunityIcons name="trash-can-outline" size={18} color="#C04B4B" />
          <Text style={[props.styles.documentActionMenuItemText, props.styles.documentActionMenuDangerText]}>삭제하기</Text>
        </Pressable>
      </Pressable>
    );
  };
  const renderDocumentMoreButton = (item: StudyDocumentEntry, grid = false) => (
    <View style={[props.styles.documentActionWrap, grid && props.styles.documentGridActionWrap]}>
      <Pressable
        accessibilityLabel="문서 작업"
        style={[
          props.styles.documentMoreButton,
          grid && props.styles.documentGridMoreButton,
          documentActionMenuId === item.id && props.styles.documentMoreButtonActive,
        ]}
        onPress={(event) => {
          event.stopPropagation();
          setDocumentActionMenuId((current) => current === item.id ? null : item.id);
        }}
      >
        <MaterialCommunityIcons name="dots-horizontal" size={grid ? 17 : 19} color={documentActionMenuId === item.id ? '#4F68D2' : '#7F8999'} />
      </Pressable>
      {renderDocumentActionMenu(item, grid)}
    </View>
  );
  const renderDocumentViewToggle = () => (
    <View style={props.styles.documentViewSegment}>
      <Pressable
        accessibilityLabel="목록 보기"
        style={[
          props.styles.documentViewButton,
          documentViewMode === 'list' && props.styles.documentViewButtonActive,
        ]}
        onPress={() => {
          setDocumentActionMenuId(null);
          setDocumentViewMode('list');
        }}
      >
        <MaterialCommunityIcons name="format-list-bulleted" size={19} color={documentViewMode === 'list' ? '#263144' : '#8A95A8'} />
      </Pressable>
      <Pressable
        accessibilityLabel="격자 보기"
        style={[
          props.styles.documentViewButton,
          documentViewMode === 'grid' && props.styles.documentViewButtonActive,
        ]}
        onPress={() => {
          setDocumentActionMenuId(null);
          setDocumentViewMode('grid');
        }}
      >
        <MaterialCommunityIcons name="view-grid-outline" size={18} color={documentViewMode === 'grid' ? '#263144' : '#8A95A8'} />
      </Pressable>
    </View>
  );

  React.useEffect(() => {
    if (recoverableCount === 0) setRecoveryOpen(false);
  }, [recoverableCount]);

  React.useEffect(() => {
    setDocumentActionMenuId(null);
  }, [props.noteMode, props.selectedSubject?.id, props.query, props.sort]);

  React.useEffect(() => {
    if (Platform.OS !== 'web') return;
    try {
      globalThis.localStorage?.setItem(DOCUMENT_VIEW_MODE_STORAGE_KEY, documentViewMode);
    } catch {
      // Ignore private browsing or storage quota failures; the view still works.
    }
  }, [documentViewMode]);

  return (
    <ScrollView style={props.styles.main} contentContainerStyle={[props.styles.desktopPage, props.compact && props.styles.desktopPageCompact, isWeb && props.styles.webDesktopPage]}>
      <View style={isWeb ? props.styles.webPageHeader : props.styles.desktopNotesTopRow}>
        <View style={isWeb ? props.styles.webPageHeaderMeta : undefined}>
          {isWeb ? <Text style={props.styles.desktopCaption}>{scopeLabel}</Text> : null}
          <Text style={[props.styles.desktopTitle, props.compact && props.styles.desktopTitleCompact]}>{props.noteMode === 'photo' ? 'Photo' : 'Note'}</Text>
          {isWeb ? (
            <View style={props.styles.webNotesHeaderStats}>
              <View style={props.styles.webNotesHeaderStat}>
                <MaterialCommunityIcons name={props.noteMode === 'photo' ? 'image-multiple-outline' : 'file-document-outline'} size={14} color="#4F68D2" />
                <Text style={props.styles.webNotesHeaderStatText}>{visibleItemCount}{itemUnit} 표시</Text>
              </View>
              <View style={props.styles.webNotesHeaderStat}>
                <MaterialCommunityIcons name="folder-multiple-outline" size={14} color="#617083" />
                <Text style={props.styles.webNotesHeaderStatText}>전체 {totalItemCount}{itemUnit}</Text>
              </View>
            </View>
          ) : null}
        </View>
        <View style={props.styles.desktopModeSegment}>
          <Pressable style={[props.styles.desktopModeButton, props.noteMode === 'note' && props.styles.desktopModeButtonActive]} onPress={() => props.onChangeMode('note')}><Text style={[props.styles.desktopModeButtonText, props.noteMode === 'note' && props.styles.desktopModeButtonTextActive]}>Note</Text></Pressable>
          <Pressable style={[props.styles.desktopModeButton, props.noteMode === 'photo' && props.styles.desktopModeButtonActive]} onPress={() => props.onChangeMode('photo')}><Text style={[props.styles.desktopModeButtonText, props.noteMode === 'photo' && props.styles.desktopModeButtonTextActive]}>Photo</Text></Pressable>
        </View>
      </View>
      <View style={[props.styles.desktopFilters, isWeb && props.styles.webLibrarySearchCard]}>
        <View style={props.styles.desktopSearch}>
          <Text style={props.styles.searchIcon}>⌕</Text>
          <TextInput value={props.query} onChangeText={props.onQuery} placeholder={props.noteMode === 'photo' ? 'Photo 검색' : 'Note 검색'} placeholderTextColor="#C3C8D5" style={props.styles.searchInput} />
        </View>
        {props.noteMode === 'note' ? (
          <Pressable
            accessibilityLabel="클라우드 양방향 동기화"
            disabled={props.backendDocumentSyncing}
            style={[
              props.styles.desktopSyncButton,
              props.backendDocumentSyncing && props.styles.desktopSyncButtonBusy,
            ]}
            onPress={() => props.onSyncBackendDocuments({ showFeedback: true })}
          >
            <MaterialCommunityIcons
              name={props.backendDocumentSyncing ? 'cloud-refresh-outline' : 'cloud-sync-outline'}
              size={22}
              color={props.backendDocumentSyncing ? '#8D95A6' : props.blueColor}
            />
          </Pressable>
        ) : null}
        <Pressable style={props.styles.desktopFilterButton} onPress={props.onSort}><Text style={props.styles.desktopFilterButtonText}>{props.sort === 'latest' ? '최신순' : '오래된순'}</Text></Pressable>
        {props.noteMode === 'note' ? renderDocumentViewToggle() : null}
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
        {!isWeb ? (
          <Pressable style={props.styles.desktopFilterButton} onPress={props.onReset}><Text style={props.styles.desktopFilterButtonText}>초기화</Text></Pressable>
        ) : null}
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
      <View style={[props.styles.desktopNotesLayout, props.compact && props.styles.desktopNotesLayoutCompact, isWeb && props.styles.webLibraryShell]}>
        <View style={[props.styles.desktopSubjects, props.compact && props.styles.desktopSubjectsCompact, isWeb && props.styles.webSubjectList]}>
          {props.subjects.map((item) => (
            <Pressable key={item.id} style={[props.styles.subjectRow, isWeb && props.styles.webSubjectRow, props.selectedSubject?.id === item.id && { borderColor: item.color, backgroundColor: '#FFFFFF' }, props.selectedSubject?.id === item.id && props.styles.subjectRowActive]} onPress={() => props.onOpenSubject(item.id)}>
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
        <View style={[props.styles.fill, isWeb && props.styles.webLibraryContent]}>
          {props.noteMode === 'photo' ? (
            selectedPhotoAssets.length ? (
              <View style={[props.styles.photoGalleryPanel, isWeb && props.styles.webLibraryCard]}>
                <View style={props.styles.photoGalleryHeader}>
                  <View>
                    <Text style={props.styles.photoGalleryTitle}>{photoGalleryTitle}</Text>
                    <Text style={props.styles.photoGalleryMeta}>{selectedPhotoAssets.length}장 · 전처리된 사진</Text>
                  </View>
                </View>
                <View style={props.styles.photoGalleryGrid}>
                  {selectedPhotoAssets.map((asset) => {
                    const imageSource = getCaptureImageSource(asset);
                    const contextLabel = getCaptureLibraryContextLabel(asset, props.pageCaptureReferences, props.allStudyDocuments);
                    const linked = contextLabel !== '연결된 PDF 없음';
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
                        </View>
                        <View style={props.styles.photoGalleryCardBody}>
                          <Text style={props.styles.photoGalleryCardTitle} numberOfLines={2}>{asset.title}</Text>
                          <Text style={props.styles.photoGalleryCardMeta} numberOfLines={1}>{formatCaptureDate(asset.createdAt)}</Text>
                          <View style={props.styles.photoGalleryPlacementRow}>
                            <MaterialCommunityIcons name={linked ? 'file-link-outline' : 'link-off'} size={14} color={linked ? '#4F68D2' : '#9AA3B2'} />
                            <Text style={[props.styles.photoGalleryPlacementText, linked && props.styles.photoGalleryPlacementTextLinked]} numberOfLines={1}>
                              {contextLabel}
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
                <Text style={props.styles.emptyTitle}>저장된 이미지가 없습니다.</Text>
                {isWeb ? <Text style={props.styles.emptyBody}>캡처 탭에서 이미지를 올리면 이곳에서 과목별로 정리됩니다.</Text> : null}
              </View>
            )
          ) : (
            <View style={[props.styles.desktopDocumentsPanel, isWeb && props.styles.webLibraryCard]}>
              {documentActionMenuId !== null ? (
                <Pressable style={props.styles.documentActionMenuDismissLayer} onPress={() => setDocumentActionMenuId(null)} />
              ) : null}
              {isWeb ? (
                <View style={props.styles.webDocumentsHeader}>
                  <View style={props.styles.fill}>
                    <Text style={props.styles.webDocumentsTitle} numberOfLines={1}>{scopeLabel}</Text>
                    <Text style={props.styles.webDocumentsMeta}>{visibleItemCount}{itemUnit} · {props.sort === 'latest' ? '최신순' : '오래된순'}</Text>
                  </View>
                  {props.noteMode === 'note' ? (
                    <View style={props.styles.webDocumentsTypeBadge}>
                      <MaterialCommunityIcons name="note-edit-outline" size={14} color="#4F68D2" />
                      <Text style={props.styles.webDocumentsTypeText}>Note</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
              {props.studyDocuments.length ? (
                documentViewMode === 'grid' ? (
                  <View style={props.styles.documentGrid}>
                    {props.studyDocuments.map((item) => {
                      return (
                        <Pressable
                          key={item.id}
                          style={[
                            props.styles.documentGridCard,
                            documentActionMenuId === item.id && props.styles.documentCardMenuOpen,
                          ]}
                          onPress={() => {
                            setDocumentActionMenuId(null);
                            props.onOpenStudyDocument(item.id);
                          }}
                        >
                          {renderDocumentThumb(item, 'grid')}
                          <View style={props.styles.documentGridBody}>
                            <View style={props.styles.documentGridTitleRow}>
                              <Text style={props.styles.documentGridTitle} numberOfLines={2}>{item.title}</Text>
                              {renderDocumentMoreButton(item, true)}
                            </View>
                            <Text style={props.styles.documentGridMeta} numberOfLines={1}>{formatDocumentMeta(item)}</Text>
                            <View style={props.styles.documentGridFooter}>
                              {renderDocumentTypePill(item)}
                            </View>
                          </View>
                        </Pressable>
                      );
                    })}
                  </View>
                ) : props.studyDocuments.map((item) => {
                  const visual = getDocumentVisual(item);
                  return (
                    <Pressable
                      key={item.id}
                      style={[
                        props.styles.documentListCard,
                        isWeb && props.styles.webDocumentCard,
                        documentActionMenuId === item.id && props.styles.documentCardMenuOpen,
                      ]}
                      onPress={() => {
                        setDocumentActionMenuId(null);
                        props.onOpenStudyDocument(item.id);
                      }}
                    >
                      <View style={[props.styles.documentListRail, { backgroundColor: visual.subjectColor }]} />
                      {renderDocumentThumb(item, 'list')}
                      <View style={props.styles.fill}>
                        <View style={props.styles.documentTitleRow}>
                          <Text style={props.styles.documentTitle} numberOfLines={1}>{item.title}</Text>
                          {renderDocumentTypePill(item)}
                        </View>
                        <Text style={props.styles.documentMeta}>{formatDocumentMeta(item)}</Text>
                      </View>
                      {renderDocumentMoreButton(item)}
                    </Pressable>
                  );
                })
              ) : (
                <View style={[props.styles.emptyCard, isWeb && props.styles.webLibraryEmptyCard]}>
                  <Text style={props.styles.emptyTitle}>문서가 없어요.</Text>
                  {isWeb ? (
                    <>
                      <Text style={props.styles.emptyBody}>빈 노트를 만들거나 PDF를 업로드해서 수업 자료를 정리해보세요.</Text>
                      <View style={props.styles.webLibraryEmptyActions}>
                        <Pressable style={[props.styles.desktopFilterButton, props.styles.desktopPrimaryAction]} onPress={props.onCreateBlankNote}>
                          <Text style={[props.styles.desktopFilterButtonText, props.styles.desktopPrimaryActionText]}>+ 새 노트</Text>
                        </Pressable>
                        <Pressable style={props.styles.desktopFilterButton} onPress={props.onUploadPdf}>
                          <Text style={props.styles.desktopFilterButtonText}>PDF 업로드</Text>
                        </Pressable>
                      </View>
                    </>
                  ) : null}
                </View>
              )}
            </View>
          )}
        </View>
      </View>
      <PhotoViewerModal
        asset={previewAsset}
        references={props.pageCaptureReferences}
        documents={props.allStudyDocuments}
        styles={props.styles}
        onClose={() => setPreviewAssetId(null)}
        onInsertInboxAsset={props.onInsertInboxAsset}
        onLinkCaptureAssetToPage={props.onLinkCaptureAssetToPage}
        onOpenPageCaptureReference={props.onOpenPageCaptureReference}
        onAskAiAboutPageCaptureReference={props.onAskAiAboutPageCaptureReference}
        onRemoveCaptureAsset={props.onRemoveCaptureAsset}
      />
      <Modal
        visible={!!renamingDocument}
        transparent
        animationType="fade"
        onRequestClose={closeDocumentRename}
      >
        <View style={props.styles.documentLibraryRenameOverlay}>
          <Pressable style={props.styles.documentLibraryRenameBackdrop} onPress={closeDocumentRename} />
          {renamingDocument ? (
            <View style={props.styles.documentLibraryRenameCard}>
              <Text style={props.styles.documentLibraryRenameTitle}>이름 바꾸기</Text>
              <Text style={props.styles.documentLibraryRenameMeta} numberOfLines={1}>{formatDocumentMeta(renamingDocument)}</Text>
              <TextInput
                value={renameDraft}
                onChangeText={(value) => {
                  setRenameDraft(value);
                  if (renameError && value.trim()) setRenameError(null);
                }}
                placeholder="문서 제목"
                placeholderTextColor="#A2AAB8"
                style={[props.styles.documentLibraryRenameInput, renameError && props.styles.documentLibraryRenameInputError]}
                returnKeyType="done"
                autoFocus
                onSubmitEditing={saveDocumentRename}
              />
              {renameError ? <Text style={props.styles.documentLibraryRenameError}>{renameError}</Text> : null}
              <View style={props.styles.documentLibraryRenameActions}>
                <Pressable style={props.styles.documentLibraryRenameButton} onPress={closeDocumentRename}>
                  <Text style={props.styles.documentLibraryRenameButtonText}>취소</Text>
                </Pressable>
                <Pressable
                  style={[
                    props.styles.documentLibraryRenameButton,
                    props.styles.documentLibraryRenameButtonPrimary,
                    !renameDraft.trim() && props.styles.documentLibraryRenameButtonDisabled,
                  ]}
                  disabled={!renameDraft.trim()}
                  onPress={saveDocumentRename}
                >
                  <Text style={[props.styles.documentLibraryRenameButtonText, props.styles.documentLibraryRenameButtonTextPrimary]}>저장</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </ScrollView>
  );
}
