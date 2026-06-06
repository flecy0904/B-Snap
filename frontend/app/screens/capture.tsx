import React, { useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { subjects as fallbackSubjects } from '../app-defaults';
import { CaptureAsset, CaptureProcessingState, PageCaptureReference, StudyDocumentEntry, Subject, SyncBridgeStatus } from '../types';
import { CaptureProcessingModal } from '../components/capture/capture-processing-modal';
import { PhotoViewerModal } from '../components/notes/layout/photo-viewer-modal';
import type { DroppedCaptureFile } from '../hooks/capture/use-capture-workspace';

type CapturePendingAction = 'camera' | 'library' | 'drop';

function getSyncStatusText(status: SyncBridgeStatus) {
  if (status === 'connected') return '실시간 연결됨';
  if (status === 'connecting') return '실시간 연결 중';
  if (status === 'reconnecting') return '재연결 중';
  if (status === 'offline') return '오프라인 · 로컬 저장';
  return '로컬 저장 모드';
}

function getPendingActionText(action: CapturePendingAction | null) {
  if (action === 'camera') return '카메라 업로드 중';
  if (action === 'library') return '사진첩 업로드 중';
  if (action === 'drop') return '파일 업로드 중';
  return null;
}

function getWebFileType(file: File) {
  if (file.type) return file.type;
  if (/\.pdf$/i.test(file.name)) return 'application/pdf';
  if (/\.png$/i.test(file.name)) return 'image/png';
  if (/\.webp$/i.test(file.name)) return 'image/webp';
  return 'image/jpeg';
}

function readWebFileAsDataUri(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('unsupported-file-result'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('file-read-failed'));
    reader.readAsDataURL(file);
  });
}

async function toDroppedCaptureFile(file: File): Promise<DroppedCaptureFile> {
  return {
    uri: await readWebFileAsDataUri(file),
    name: file.name || 'upload',
    type: getWebFileType(file),
  };
}

export function MobileCapture(props: {
  captureId: number;
  subjects: Subject[];
  recentUploads: CaptureAsset[];
  completedPreviewAssetId: string | null;
  pageCaptureReferences: PageCaptureReference[];
  allStudyDocuments: StudyDocumentEntry[];
  pickerOpen: boolean;
  onCaptureId: (id: number) => void;
  onTogglePicker: () => void;
  pendingAction: CapturePendingAction | null;
  captureProcessing: CaptureProcessingState | null;
  syncStatus: SyncBridgeStatus;
  captureFeedback: string | null;
  captureError: string | null;
  onCaptureFromCamera: () => Promise<void>;
  onPickFromLibrary: () => Promise<void>;
  onRetryUpload: () => Promise<void>;
  onConsumeCompletedPreviewAsset: () => void;
  onInsertInboxAsset: (assetId: string) => void;
  onLinkCaptureAssetToPage: (assetId: string, documentId: number, pageNumber: number) => boolean;
  onOpenPageCaptureReference: (referenceId: string) => void;
  onAskAiAboutPageCaptureReference: (referenceId: string) => void;
  onRemoveCaptureAsset: (assetId: string) => void;
  styles: any;
}) {
  const current = props.subjects.find((item) => item.id === props.captureId) ?? props.subjects[0] ?? fallbackSubjects[0];
  const busy = props.pendingAction !== null;
  const pendingText = getPendingActionText(props.pendingAction);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const previewAsset = React.useMemo(
    () => props.recentUploads.find((asset) => asset.id === previewAssetId && asset.type === 'image' && asset.status !== 'dismissed') ?? null,
    [previewAssetId, props.recentUploads],
  );
  React.useEffect(() => {
    if (!props.completedPreviewAssetId) return;
    const completedAsset = props.recentUploads.find((asset) => asset.id === props.completedPreviewAssetId);
    if (!completedAsset || completedAsset.type !== 'image' || completedAsset.status === 'dismissed') return;
    setPreviewAssetId(completedAsset.id);
    props.onConsumeCompletedPreviewAsset();
  }, [props.completedPreviewAssetId, props.onConsumeCompletedPreviewAsset, props.recentUploads]);

  return (
    <ScrollView style={props.styles.main} contentContainerStyle={props.styles.mobilePage}>
      <Text style={props.styles.pageTitle}>촬영</Text>

      <Text style={props.styles.fieldLabel}>과목 선택</Text>
      <Pressable style={[props.styles.selectBox, props.pickerOpen && props.styles.selectBoxOpen]} onPress={props.onTogglePicker}>
        <Text style={props.styles.selectText}>{current.name}</Text>
        <Text style={props.styles.selectArrow}>{props.pickerOpen ? '⌃' : '⌄'}</Text>
      </Pressable>

      {props.pickerOpen ? (
        <View style={props.styles.dropdown}>
          {props.subjects.map((item) => {
            const active = item.id === props.captureId;
            return (
              <Pressable key={item.id} style={[props.styles.dropdownRow, active && props.styles.dropdownRowActive]} onPress={() => props.onCaptureId(item.id)}>
                <Text style={[props.styles.dropdownText, active && props.styles.dropdownTextActive]}>{item.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={props.styles.captureActions}>
        <Pressable style={[props.styles.primaryButton, busy && props.styles.disabledButton]} onPress={props.onCaptureFromCamera} disabled={busy}>
          <Text style={props.styles.primaryButtonText}>{props.pendingAction === 'camera' ? '촬영 업로드 중...' : '◉ 촬영 시작'}</Text>
        </Pressable>
        <Pressable style={[props.styles.secondaryButton, busy && props.styles.disabledButton]} onPress={props.onPickFromLibrary} disabled={busy}>
          <Text style={props.styles.secondaryButtonText}>{props.pendingAction === 'library' ? '사진 업로드 중...' : '⌲ 사진첩에서 불러오기'}</Text>
        </Pressable>
      </View>

      <View style={props.styles.captureStatusCard}>
        <Text style={props.styles.captureStatusTitle}>업로드 상태</Text>
        <Text style={props.styles.capturePendingText}>동기화: {getSyncStatusText(props.syncStatus)}</Text>
        {pendingText ? <Text style={props.styles.capturePendingText}>현재 작업: {pendingText}</Text> : null}
        {props.captureFeedback ? <Text style={props.styles.captureFeedbackText}>{props.captureFeedback}</Text> : null}
        {props.captureError ? <Text style={props.styles.captureErrorText}>{props.captureError}</Text> : null}
        {props.captureError ? (
          <Pressable style={props.styles.captureRetryButton} onPress={props.onRetryUpload} disabled={busy}>
            <Text style={props.styles.captureRetryButtonText}>다시 시도</Text>
          </Pressable>
        ) : null}
      </View>
      {props.recentUploads.length ? (
        <View style={props.styles.captureRecentCard}>
          <Text style={props.styles.captureRecentTitle}>최근 업로드</Text>
          {props.recentUploads.map((asset, index) => (
            <Pressable
              key={asset.id}
              style={[props.styles.captureRecentRow, index === 0 && props.styles.captureRecentRowFirst]}
              onPress={() => {
                if (asset.type === 'image') setPreviewAssetId(asset.id);
              }}
              disabled={asset.type !== 'image'}
            >
              <View style={props.styles.captureRecentMeta}>
                <Text style={props.styles.captureRecentType}>{asset.type === 'image' ? 'IMAGE' : 'PDF'}</Text>
                <Text style={props.styles.captureRecentName} numberOfLines={1}>{asset.title}</Text>
                <Text style={props.styles.captureRecentTime} numberOfLines={1}>
                  {asset.createdAt}
                  {asset.pageCount ? ` · ${asset.pageCount}페이지` : ''}
                </Text>
              </View>
              <View style={props.styles.captureRecentStatusPill}>
                <Text style={props.styles.captureRecentStatusText}>전송됨</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ) : (
        <View style={props.styles.captureEmptyCard}>
          <Text style={props.styles.captureEmptyTitle}>아직 자료가 없어요. 첫 자료를 추가해 보세요</Text>
        </View>
      )}

      <Text style={props.styles.captureHint}>촬영한 이미지는 각 과목의 페이지에서 확인할 수 있어요.</Text>
      <CaptureProcessingModal processing={props.captureProcessing} styles={props.styles} />
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
    </ScrollView>
  );
}

export function DesktopCapture(props: {
  compact: boolean;
  captureId: number;
  subjects: Subject[];
  recentUploads: CaptureAsset[];
  completedPreviewAssetId: string | null;
  pageCaptureReferences: PageCaptureReference[];
  allStudyDocuments: StudyDocumentEntry[];
  onCaptureId: (id: number) => void;
  pendingAction: CapturePendingAction | null;
  captureProcessing: CaptureProcessingState | null;
  syncStatus: SyncBridgeStatus;
  captureFeedback: string | null;
  captureError: string | null;
  onCaptureFromCamera: () => Promise<void>;
  onPickFromLibrary: () => Promise<void>;
  onImportDroppedFile: (file: DroppedCaptureFile) => Promise<void>;
  onRetryUpload: () => Promise<void>;
  onConsumeCompletedPreviewAsset: () => void;
  onInsertInboxAsset: (assetId: string) => void;
  onLinkCaptureAssetToPage: (assetId: string, documentId: number, pageNumber: number) => boolean;
  onOpenPageCaptureReference: (referenceId: string) => void;
  onAskAiAboutPageCaptureReference: (referenceId: string) => void;
  onRemoveCaptureAsset: (assetId: string) => void;
  styles: any;
  isWeb?: boolean;
}) {
  const current = props.subjects.find((item) => item.id === props.captureId) ?? props.subjects[0] ?? fallbackSubjects[0];
  const [pickerOpen, setPickerOpen] = useState(false);
  const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
  const dropZoneRef = React.useRef<any>(null);
  const [dragActive, setDragActive] = useState(false);
  const [dropFeedback, setDropFeedback] = useState<string | null>(null);
  const busy = props.pendingAction !== null;
  const pendingText = getPendingActionText(props.pendingAction);
  const previewAsset = React.useMemo(
    () => props.recentUploads.find((asset) => asset.id === previewAssetId && asset.type === 'image' && asset.status !== 'dismissed') ?? null,
    [previewAssetId, props.recentUploads],
  );
  React.useEffect(() => {
    if (!props.completedPreviewAssetId) return;
    const completedAsset = props.recentUploads.find((asset) => asset.id === props.completedPreviewAssetId);
    if (!completedAsset || completedAsset.type !== 'image' || completedAsset.status === 'dismissed') return;
    setPreviewAssetId(completedAsset.id);
    props.onConsumeCompletedPreviewAsset();
  }, [props.completedPreviewAssetId, props.onConsumeCompletedPreviewAsset, props.recentUploads]);

  const importWebFiles = React.useCallback(async (fileList: FileList | File[] | null | undefined) => {
    const files = Array.from(fileList ?? []).filter((file) => (
      file.type.startsWith('image/')
      || file.type === 'application/pdf'
      || /\.(png|jpe?g|webp|gif|pdf)$/i.test(file.name)
    ));
    const file = files[0];
    if (!file) {
      setDropFeedback('이미지 또는 PDF 파일을 올려주세요.');
      return;
    }
    setDropFeedback(null);
    await props.onImportDroppedFile(await toDroppedCaptureFile(file));
  }, [props]);

  const openWebFilePicker = React.useCallback(() => {
    if (!props.isWeb || busy || typeof document === 'undefined') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf';
    input.multiple = false;
    input.onchange = () => {
      void importWebFiles(input.files);
    };
    input.click();
  }, [busy, importWebFiles, props.isWeb]);

  React.useEffect(() => {
    if (!props.isWeb) return undefined;
    const node = dropZoneRef.current as HTMLElement | null;
    if (!node?.addEventListener) return undefined;

    const handleDragEnter = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) setDragActive(true);
    };
    const handleDragOver = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
      if (!busy) setDragActive(true);
    };
    const handleDragLeave = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.currentTarget === event.target) setDragActive(false);
    };
    const handleDrop = (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDragActive(false);
      if (busy) return;
      void importWebFiles(event.dataTransfer?.files);
    };

    node.addEventListener('dragenter', handleDragEnter);
    node.addEventListener('dragover', handleDragOver);
    node.addEventListener('dragleave', handleDragLeave);
    node.addEventListener('drop', handleDrop);
    return () => {
      node.removeEventListener('dragenter', handleDragEnter);
      node.removeEventListener('dragover', handleDragOver);
      node.removeEventListener('dragleave', handleDragLeave);
      node.removeEventListener('drop', handleDrop);
    };
  }, [busy, importWebFiles, props.isWeb]);

  return (
    <ScrollView style={props.styles.main} contentContainerStyle={[props.styles.desktopPage, props.compact && props.styles.desktopPageCompact, props.isWeb && props.styles.webDesktopPage]}>
      <View style={props.isWeb ? props.styles.webPageHeader : [props.styles.desktopHeader, props.compact && props.styles.desktopHeaderCompact]}>
        {props.isWeb ? (
          <>
            <View style={props.styles.webPageHeaderMeta}>
              <Text style={props.styles.webPageEyebrow}>CAPTURE HUB</Text>
              <Text style={props.styles.webPageTitle}>자료 캡처</Text>
              <Text style={props.styles.webPageBody}>사진과 외부 이미지를 과목별로 정리해 노트 작업공간에 바로 연결합니다.</Text>
            </View>
            <View style={props.styles.webHeaderBadgeRow}>
              <View style={props.styles.webHeaderBadge}>
                <Text style={props.styles.webHeaderBadgeText}>최근 업로드 {props.recentUploads.length}건</Text>
              </View>
            </View>
          </>
        ) : (
          <Text style={[props.styles.desktopTitle, props.compact && props.styles.desktopTitleCompact]}>촬영</Text>
        )}
      </View>
      <View style={[props.styles.desktopCaptureForm, props.compact && props.styles.desktopCaptureFormCompact, props.isWeb && props.styles.webCaptureGrid]}>
        {props.isWeb ? (
          <View
            ref={dropZoneRef}
            style={[
              props.styles.webCaptureDropZone,
              dragActive && props.styles.webCaptureDropZoneActive,
              busy && props.styles.webCaptureDropZoneDisabled,
            ]}
          >
            <View style={props.styles.webCaptureDropIcon}>
              <Text style={props.styles.webCaptureDropIconText}>+</Text>
            </View>
            <Text style={props.styles.webCaptureDropTitle}>
              {props.pendingAction === 'drop' ? '파일 업로드 중' : '이미지나 PDF를 여기에 놓기'}
            </Text>
            <Text style={props.styles.webCaptureDropBody}>수업 사진, 보조 PDF, 스크린샷을 현재 과목 inbox로 보냅니다.</Text>
            <Pressable style={[props.styles.webCaptureDropButton, busy && props.styles.disabledButton]} onPress={openWebFilePicker} disabled={busy}>
              <Text style={props.styles.webCaptureDropButtonText}>파일 선택</Text>
            </Pressable>
            {dropFeedback ? <Text style={props.styles.captureErrorText}>{dropFeedback}</Text> : null}
          </View>
        ) : null}

        <Text style={props.styles.fieldLabel}>과목 선택</Text>
        <Pressable style={[props.styles.selectBox, pickerOpen && props.styles.selectBoxOpen]} onPress={() => setPickerOpen((value) => !value)}>
          <Text style={props.styles.selectText}>{current.name}</Text>
          <Text style={props.styles.selectArrow}>{pickerOpen ? '⌃' : '⌄'}</Text>
        </Pressable>

        {pickerOpen ? (
          <View style={[props.styles.dropdown, props.styles.desktopDropdown]}>
            {props.subjects.map((item) => {
              const active = item.id === props.captureId;
              return (
                <Pressable
                  key={item.id}
                  style={[props.styles.dropdownRow, active && props.styles.dropdownRowActive]}
                  onPress={() => {
                    props.onCaptureId(item.id);
                    setPickerOpen(false);
                  }}
                >
                  <Text style={[props.styles.dropdownText, active && props.styles.dropdownTextActive]}>{item.name}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {!props.isWeb ? (
          <View style={props.styles.desktopCaptureActions}>
            <Pressable style={[props.styles.primaryButton, busy && props.styles.disabledButton]} onPress={props.onCaptureFromCamera} disabled={busy}>
              <Text style={props.styles.primaryButtonText}>{props.pendingAction === 'camera' ? '촬영 업로드 중...' : '◉ 촬영 시작'}</Text>
            </Pressable>
            <Pressable style={[props.styles.secondaryButton, busy && props.styles.disabledButton]} onPress={props.onPickFromLibrary} disabled={busy}>
              <Text style={props.styles.secondaryButtonText}>{props.pendingAction === 'library' ? '사진 업로드 중...' : '⌲ 사진첩에서 불러오기'}</Text>
            </Pressable>
          </View>
        ) : null}
        <View style={props.styles.captureStatusCard}>
          <Text style={props.styles.captureStatusTitle}>업로드 상태</Text>
          <Text style={props.styles.capturePendingText}>동기화: {getSyncStatusText(props.syncStatus)}</Text>
          {pendingText ? <Text style={props.styles.capturePendingText}>현재 작업: {pendingText}</Text> : null}
          {props.captureFeedback ? <Text style={props.styles.captureFeedbackText}>{props.captureFeedback}</Text> : null}
          {props.captureError ? <Text style={props.styles.captureErrorText}>{props.captureError}</Text> : null}
          {props.captureError ? (
            <Pressable style={props.styles.captureRetryButton} onPress={props.onRetryUpload} disabled={busy}>
              <Text style={props.styles.captureRetryButtonText}>다시 시도</Text>
            </Pressable>
          ) : null}
        </View>
        {props.recentUploads.length ? (
          <View style={[props.styles.captureRecentCard, props.isWeb && props.styles.webCaptureRecentCard]}>
            <View style={props.isWeb ? props.styles.webCaptureRecentHeader : null}>
              <View>
                <Text style={props.styles.captureRecentTitle}>최근 업로드</Text>
                {props.isWeb ? <Text style={props.styles.webCaptureRecentSubtitle}>가장 최근 자료 5개를 과목 inbox에서 확인합니다.</Text> : null}
              </View>
              {props.isWeb ? (
                <View style={props.styles.webCaptureRecentCountPill}>
                  <Text style={props.styles.webCaptureRecentCountText}>{props.recentUploads.length}건</Text>
                </View>
              ) : null}
            </View>
            {props.recentUploads.map((asset, index) => (
              <Pressable
                key={asset.id}
                style={[
                  props.styles.captureRecentRow,
                  props.isWeb && props.styles.webCaptureRecentRow,
                  index === 0 && props.styles.captureRecentRowFirst,
                ]}
                onPress={() => {
                  if (asset.type === 'image') setPreviewAssetId(asset.id);
                }}
                disabled={asset.type !== 'image'}
              >
                {props.isWeb ? (
                  <View style={[props.styles.webCaptureRecentIcon, asset.type === 'pdf' && props.styles.webCaptureRecentIconPdf]}>
                    <MaterialCommunityIcons name={asset.type === 'pdf' ? 'file-pdf-box' : 'image-outline'} size={19} color={asset.type === 'pdf' ? '#D95C5C' : '#4F68D2'} />
                  </View>
                ) : null}
                <View style={props.styles.captureRecentMeta}>
                  <Text style={props.styles.captureRecentType}>{asset.type === 'image' ? 'IMAGE' : 'PDF'}</Text>
                  <Text style={props.styles.captureRecentName} numberOfLines={1}>{asset.title}</Text>
                  <Text style={props.styles.captureRecentTime} numberOfLines={1}>
                    {asset.createdAt}
                    {asset.pageCount ? ` · ${asset.pageCount}페이지` : ''}
                  </Text>
                </View>
                <View style={props.styles.captureRecentStatusPill}>
                  <Text style={props.styles.captureRecentStatusText}>{asset.type === 'image' ? '미리보기' : '저장됨'}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={[props.styles.captureEmptyCard, props.isWeb && props.styles.webCaptureEmptyCard]}>
            <Text style={props.styles.captureEmptyTitle}>아직 자료가 없어요. 첫 자료를 추가해 보세요</Text>
            {props.isWeb ? <Text style={props.styles.captureEmptyBody}>이미지 또는 PDF를 드롭하면 현재 과목의 캡처 inbox에 저장됩니다.</Text> : null}
          </View>
        )}
        <Text style={props.styles.captureHint}>
          {props.isWeb ? '올린 자료는 노트 작업공간에서 과목별로 연결할 수 있어요.' : '촬영한 이미지는 각 과목의 페이지에서 확인할 수 있어요.'}
        </Text>
      </View>
      <CaptureProcessingModal processing={props.captureProcessing} styles={props.styles} />
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
    </ScrollView>
  );
}
