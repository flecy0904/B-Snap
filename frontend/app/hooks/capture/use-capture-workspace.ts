import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { subjects as fallbackSubjects } from '../../app-defaults';
import { createCaptureAsset, useSyncBridge, useSyncBridgeStatus } from '../use-sync-bridge';
import { BackendApiError, createBackendCaptureUploadJob, getBackendCaptureUploadJob, isBackendApiEnabled, type BackendCaptureUploadJob, type BackendUpload, uploadBackendFile } from '../../services/backend-api';
import type { CaptureAsset, CaptureProcessingStage, CaptureProcessingState, Subject } from '../../types';
import { buildEmptyStudyWorkspaceState, loadStudyWorkspaceState, saveStudyWorkspaceState } from '../../storage/local-workspace-store';
import { cleanAiDisplayText } from '../../ui-helpers';

type UploadResult = BackendUpload;
type CapturePendingAction = 'camera' | 'library' | 'drop';
type PreprocessingFallbackChoice = 'continue' | 'use-original' | 'cancel';
type ProcessingSource = CaptureProcessingState['source'];
export type DroppedCaptureFile = {
  uri: string;
  name: string;
  type: string;
};

const PROCESSING_DISMISS_DELAY_MS = 650;
const PHOTO_VIEWER_OPEN_DELAY_MS = PROCESSING_DISMISS_DELAY_MS + 120;
const CAPTURE_JOB_POLL_INTERVAL_MS = 700;
const CAPTURE_JOB_TIMEOUT_MS = 90000;

function getCaptureErrorMessage(error: unknown, fallback: string) {
  if (error instanceof BackendApiError) return error.detail ?? error.message;
  return fallback;
}

function applyUploadAnalysis(asset: CaptureAsset, upload: UploadResult, options?: { useOriginalImage?: boolean }) {
  if (options?.useOriginalImage) {
    asset.processedUrl = undefined;
    asset.thumbnailUrl = upload.url ?? asset.fileUrl ?? asset.thumbnailUrl;
  } else {
    asset.processedUrl = upload.processed_url ?? asset.processedUrl;
    asset.thumbnailUrl = upload.thumbnail_url ?? asset.thumbnailUrl;
  }
  if (!upload.analysis) return asset;
  asset.analysisStatus = upload.analysis.status === 'failed' ? 'failed' : upload.analysis.status === 'pending' ? 'pending' : 'ready';
  const generatedTitle = cleanAiDisplayText(upload.analysis.title);
  if (generatedTitle) asset.title = generatedTitle.slice(0, 40);
  asset.analysisSummary = cleanAiDisplayText(upload.analysis.summary ?? asset.summary);
  asset.analysisKeywords = upload.analysis.keywords?.filter(Boolean) ?? asset.analysisKeywords;
  return asset;
}

function isTargetDetectionFallback(upload: UploadResult | null) {
  return upload?.preprocessing?.detail_code === 'segmentation_mask_not_found';
}

function resolvePreprocessingFallbackChoice(upload: UploadResult | null): Promise<PreprocessingFallbackChoice> {
  if (!isTargetDetectionFallback(upload)) {
    return Promise.resolve('continue');
  }

  return new Promise((resolve) => {
    Alert.alert(
      '강의자료/칠판을 찾지 못했어요.',
      '원본 이미지를 사용할까요?',
      [
        { text: '아니오', style: 'cancel', onPress: () => resolve('cancel') },
        { text: '네', onPress: () => resolve('use-original') },
      ],
      { cancelable: false },
    );
  });
}

const CAPTURE_FILE_DIR = `${FileSystem.documentDirectory ?? ''}bsnap-captures/`;

function getFileExtension(fileName: string | null | undefined, mimeType: string | null | undefined, fallback: string) {
  const nameExtension = fileName?.match(/\.([a-z0-9]+)$/i)?.[1];
  if (nameExtension) return nameExtension.toLowerCase();
  if (mimeType?.includes('png')) return 'png';
  if (mimeType?.includes('webp')) return 'webp';
  if (mimeType?.includes('pdf')) return 'pdf';
  return fallback;
}

async function persistPickedFileUri(file: {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  fallbackExtension: string;
}) {
  if (!FileSystem.documentDirectory || !file.uri.startsWith('file://')) return null;
  const extension = getFileExtension(file.fileName, file.mimeType, file.fallbackExtension);
  const targetUri = `${CAPTURE_FILE_DIR}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  try {
    await FileSystem.makeDirectoryAsync(CAPTURE_FILE_DIR, { intermediates: true });
    await FileSystem.copyAsync({ from: file.uri, to: targetUri });
    return targetUri;
  } catch {
    return null;
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapBackendCaptureJobStage(stage: string | null | undefined): CaptureProcessingStage | null {
  if (stage === 'target-detecting') return 'target-detecting';
  if (stage === 'preprocessing') return 'preprocessing';
  if (stage === 'ai-commenting') return 'ai-commenting';
  return null;
}

export function useCaptureWorkspace(props: {
  subjectId: number;
  subjects?: Subject[];
}) {
  const syncBridge = useSyncBridge();
  const syncStatus = useSyncBridgeStatus();
  const [recentUploads, setRecentUploads] = useState<CaptureAsset[]>([]);
  const [pendingAction, setPendingAction] = useState<CapturePendingAction | null>(null);
  const [lastFailedAction, setLastFailedAction] = useState<'camera' | 'library' | null>(null);
  const [captureFeedback, setCaptureFeedback] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureProcessing, setCaptureProcessing] = useState<CaptureProcessingState | null>(null);
  const [completedPreviewAssetId, setCompletedPreviewAssetId] = useState<string | null>(null);
  const processingTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const subjectOptions = props.subjects?.length ? props.subjects : fallbackSubjects;
  const subject = useMemo(() => subjectOptions.find((value) => value.id === props.subjectId) ?? null, [props.subjectId, subjectOptions]);

  const clearProcessingTimers = () => {
    const timers = Array.isArray(processingTimers.current) ? processingTimers.current : [];
    timers.forEach((timer) => clearTimeout(timer));
    processingTimers.current = [];
  };

  const setProcessingStage = (stage: CaptureProcessingStage) => {
    setCaptureProcessing((current) => {
      if (!current || current.stage === stage) return current;
      return { ...current, stage };
    });
  };

  const showProcessingModal = (source: ProcessingSource, imageUri: string) => {
    clearProcessingTimers();
    setCompletedPreviewAssetId(null);
    setCaptureProcessing({ source, imageUri, stage: 'uploading' });
  };

  const completeProcessingModal = (previewAssetId?: string) => {
    clearProcessingTimers();
    setProcessingStage('ai-commenting');
    processingTimers.current.push(setTimeout(() => setCaptureProcessing(null), PROCESSING_DISMISS_DELAY_MS));
    if (previewAssetId) {
      processingTimers.current.push(setTimeout(() => setCompletedPreviewAssetId(previewAssetId), PHOTO_VIEWER_OPEN_DELAY_MS));
    }
  };

  const hideProcessingModal = () => {
    clearProcessingTimers();
    setCaptureProcessing(null);
  };

  const consumeCompletedPreviewAsset = () => {
    setCompletedPreviewAssetId(null);
  };

  const applyBackendCaptureJobStage = (job: BackendCaptureUploadJob) => {
    const mappedStage = mapBackendCaptureJobStage(job.stage);
    if (mappedStage) setProcessingStage(mappedStage);
  };

  const waitForBackendCaptureJob = async (initialJob: BackendCaptureUploadJob): Promise<UploadResult> => {
    let currentJob = initialJob;
    const startedAt = Date.now();

    while (true) {
      applyBackendCaptureJobStage(currentJob);

      if (currentJob.status === 'completed') {
        if (!currentJob.upload) {
          throw new BackendApiError('촬영 이미지 처리 결과를 받지 못했습니다.');
        }
        return currentJob.upload;
      }

      if (currentJob.status === 'failed') {
        throw new BackendApiError(currentJob.error || currentJob.message || '촬영 이미지 처리에 실패했습니다.');
      }

      if (Date.now() - startedAt > CAPTURE_JOB_TIMEOUT_MS) {
        throw new BackendApiError('촬영 이미지 처리 시간이 초과되었습니다.');
      }

      await wait(CAPTURE_JOB_POLL_INTERVAL_MS);
      currentJob = await getBackendCaptureUploadJob(currentJob.job_id);
    }
  };

  const uploadCaptureImageWithProgress = async (file: {
    uri: string;
    name: string;
    type: string;
  }) => {
    const job = await createBackendCaptureUploadJob(file);
    applyBackendCaptureJobStage(job);
    return waitForBackendCaptureJob(job);
  };

  useEffect(() => () => clearProcessingTimers(), []);

  useEffect(() => {
    let mounted = true;
    loadStudyWorkspaceState().then((state) => {
      if (!mounted || !state || !state.captureAssetsBySubject) return;
      const allAssets = Object.values(state.captureAssetsBySubject).flat();
      allAssets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setRecentUploads(allAssets.slice(0, 5));
    });
    return () => { mounted = false; };
  }, []);

  const buildFeedbackMessage = (asset: CaptureAsset, localOnly: boolean) => {
    const assetLabel = asset.type === 'image' ? '이미지' : 'PDF';
    if (localOnly) {
      return `실시간 업로드 서버 없이 이 기기에서만 ${assetLabel}를 저장했습니다.`;
    }
    return `${assetLabel}를 업로드했어요.`;
  };

  const normalizeDroppedFileType = (file: DroppedCaptureFile) => {
    const type = file.type || '';
    const lowerName = file.name.toLowerCase();
    if (type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(lowerName)) return 'image';
    if (type === 'application/pdf' || /\.pdf$/i.test(lowerName)) return 'pdf';
    return null;
  };

  const pushAsset = async (asset: CaptureAsset) => {
    try {
      const result = await syncBridge.publishAsset(asset);
      setRecentUploads((current) => [asset, ...current.filter((item) => item.id !== asset.id)].slice(0, 5));
      setCaptureError(null);
      setLastFailedAction(null);
      setCaptureFeedback(buildFeedbackMessage(asset, result.delivery === 'local'));
      
      const state = await loadStudyWorkspaceState() || buildEmptyStudyWorkspaceState();

      const subjectAssets = state.captureAssetsBySubject[asset.subjectId] || [];
      state.captureAssetsBySubject[asset.subjectId] = [asset, ...subjectAssets];
      await saveStudyWorkspaceState(state);

    } catch {
      setCaptureError('서버에 연결하지 못했어요.');
    }
  };

  const captureFromCamera = async () => {
    if (!subject || pendingAction) return;
    setCaptureFeedback(null);
    setCaptureError(null);
    setLastFailedAction(null);
    setPendingAction('camera');
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setCaptureError('카메라 권한이 없어 촬영을 진행할 수 없습니다.');
        setPendingAction(null);
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.8,
      });

      if (result.canceled || !result.assets.length) {
        setCaptureFeedback('촬영을 취소 했어요.');
        setPendingAction(null);
        return;
      }

      const picked = result.assets[0];
      showProcessingModal('camera', picked.uri);
      const localFileUri = await persistPickedFileUri({
        uri: picked.uri,
        fileName: picked.fileName,
        mimeType: picked.mimeType,
        fallbackExtension: 'jpg',
      });
      let previewUri = picked.uri;
      let backendUpload: UploadResult | null = null;
      if (isBackendApiEnabled()) {
        backendUpload = await uploadCaptureImageWithProgress({
          uri: picked.uri,
          name: picked.fileName || `${subject.name} 카메라 캡처.jpg`,
          type: picked.mimeType || 'image/jpeg',
        });
        previewUri = backendUpload.url;
      }
      if (isTargetDetectionFallback(backendUpload)) {
        setProcessingStage('target-detecting');
        await wait(120);
      }
      const fallbackChoice = await resolvePreprocessingFallbackChoice(backendUpload);
      if (fallbackChoice === 'cancel') {
        hideProcessingModal();
        setCaptureFeedback('촬영을 취소 했어요.');
        return;
      }
      const newAsset = createCaptureAsset({
        subjectId: subject.id,
        subjectName: subject.name,
        type: 'image',
        source: 'camera',
        fileName: picked.fileName || `${subject.name} 카메라 캡처`,
      });
      
      newAsset.fileUrl = previewUri;
      newAsset.thumbnailUrl = previewUri;
      newAsset.previewImageKey = localFileUri ?? newAsset.previewImageKey;
      if (backendUpload) applyUploadAnalysis(newAsset, backendUpload, { useOriginalImage: fallbackChoice === 'use-original' });
      
      await pushAsset(newAsset);
      completeProcessingModal(newAsset.id);
    } catch (error) {
      hideProcessingModal();
      setLastFailedAction('camera');
      setCaptureError(getCaptureErrorMessage(error, '카메라를 실행하지 못했습니다.'));
    } finally {
      setPendingAction(null);
    }
  };

  const pickImageFromLibrary = async () => {
    if (!subject || pendingAction) return;
    setCaptureFeedback(null);
    setCaptureError(null);
    setLastFailedAction(null);
    setPendingAction('library');
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setCaptureError('사진첩 권한이 없어 이미지를 가져올 수 없습니다.');
        setPendingAction(null);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsMultipleSelection: false,
      });

      if (result.canceled || !result.assets.length) {
        setCaptureFeedback('사진 선택을 취소 했어요.');
        setPendingAction(null);
        return;
      }

      const picked = result.assets[0];
      showProcessingModal('library', picked.uri);
      const localFileUri = await persistPickedFileUri({
        uri: picked.uri,
        fileName: picked.fileName,
        mimeType: picked.mimeType,
        fallbackExtension: 'jpg',
      });
      let previewUri = picked.uri;
      let backendUpload: UploadResult | null = null;
      if (isBackendApiEnabled()) {
        backendUpload = await uploadCaptureImageWithProgress({
          uri: picked.uri,
          name: picked.fileName || `${subject.name} 갤러리 이미지.jpg`,
          type: picked.mimeType || 'image/jpeg',
        });
        previewUri = backendUpload.url;
      }
      if (isTargetDetectionFallback(backendUpload)) {
        setProcessingStage('target-detecting');
        await wait(120);
      }
      const fallbackChoice = await resolvePreprocessingFallbackChoice(backendUpload);
      if (fallbackChoice === 'cancel') {
        hideProcessingModal();
        setCaptureFeedback('이미지 저장을 취소 할게요.');
        return;
      }
      const newAsset = createCaptureAsset({
        subjectId: subject.id,
        subjectName: subject.name,
        type: 'image',
        source: 'library',
        fileName: picked.fileName || `${subject.name} 갤러리 이미지`,
      });
      
      newAsset.fileUrl = previewUri;
      newAsset.thumbnailUrl = previewUri;
      newAsset.previewImageKey = localFileUri ?? newAsset.previewImageKey;
      if (backendUpload) applyUploadAnalysis(newAsset, backendUpload, { useOriginalImage: fallbackChoice === 'use-original' });
      
      await pushAsset(newAsset);
      completeProcessingModal(newAsset.id);
    } catch (error) {
      hideProcessingModal();
      setLastFailedAction('library');
      setCaptureError(getCaptureErrorMessage(error, '사진첩에서 이미지를 가져오지 못했습니다.'));
    } finally {
      setPendingAction(null);
    }
  };

  const importDroppedFile = async (file: DroppedCaptureFile) => {
    if (!subject || pendingAction) return;
    const droppedType = normalizeDroppedFileType(file);
    setCaptureFeedback(null);
    setCaptureError(null);
    setLastFailedAction(null);

    if (!droppedType) {
      setCaptureError('이미지 또는 PDF 파일만 업로드할 수 있습니다.');
      return;
    }

    setPendingAction('drop');
    try {
      if (droppedType === 'image') {
        showProcessingModal('library', file.uri);
        let previewUri = file.uri;
        let backendUpload: UploadResult | null = null;

        if (isBackendApiEnabled()) {
          backendUpload = await uploadCaptureImageWithProgress({
            uri: file.uri,
            name: file.name || `${subject.name} 웹 업로드 이미지.jpg`,
            type: file.type || 'image/jpeg',
          });
          previewUri = backendUpload.url;
        }

        if (isTargetDetectionFallback(backendUpload)) {
          setProcessingStage('target-detecting');
          await wait(120);
        }
        const fallbackChoice = await resolvePreprocessingFallbackChoice(backendUpload);
        if (fallbackChoice === 'cancel') {
          hideProcessingModal();
          setCaptureFeedback('이미지 저장을 취소 할게요.');
          return;
        }

        const newAsset = createCaptureAsset({
          subjectId: subject.id,
          subjectName: subject.name,
          type: 'image',
          source: 'library',
          fileName: file.name || `${subject.name} 웹 업로드 이미지`,
        });
        newAsset.fileUrl = previewUri;
        newAsset.thumbnailUrl = previewUri;
        newAsset.previewImageKey = file.uri.startsWith('data:image/') ? file.uri : newAsset.previewImageKey;
        newAsset.createdAt = '방금 전 · web';
        newAsset.sourceDeviceLabel = 'Web upload';
        if (backendUpload) applyUploadAnalysis(newAsset, backendUpload, { useOriginalImage: fallbackChoice === 'use-original' });

        await pushAsset(newAsset);
        completeProcessingModal(newAsset.id);
        return;
      }

      let backendUpload: UploadResult | null = null;
      let fileUrl = file.uri;
      let thumbnailUrl: string | undefined;
      let pageCount: number | undefined;

      if (isBackendApiEnabled()) {
        backendUpload = await uploadBackendFile({
          uri: file.uri,
          name: file.name || `${subject.name} 웹 업로드.pdf`,
          type: file.type || 'application/pdf',
        });
        fileUrl = backendUpload.url;
        thumbnailUrl = backendUpload.thumbnail_url ?? undefined;
        pageCount = backendUpload.page_count || undefined;
      }

      const newAsset = createCaptureAsset({
        subjectId: subject.id,
        subjectName: subject.name,
        type: 'pdf',
        source: 'document',
        fileName: file.name || `${subject.name} 웹 업로드.pdf`,
        pageCount,
      });
      newAsset.fileUrl = fileUrl;
      newAsset.thumbnailUrl = thumbnailUrl;
      newAsset.pageCount = pageCount ?? newAsset.pageCount;
      newAsset.createdAt = '방금 전 · web';
      newAsset.sourceDeviceLabel = 'Web upload';
      if (backendUpload?.filename) newAsset.title = backendUpload.filename;

      await pushAsset(newAsset);
    } catch (error) {
      hideProcessingModal();
      setCaptureError(getCaptureErrorMessage(error, '파일을 업로드하지 못했습니다.'));
    } finally {
      setPendingAction(null);
    }
  };

  const retryLastFailedAction = async () => {
    if (!lastFailedAction || pendingAction) return;
    if (lastFailedAction === 'camera') {
      await captureFromCamera();
      return;
    }
    if (lastFailedAction === 'library') {
      await pickImageFromLibrary();
    }
  };

  return {
    selectedSubject: subject,
    recentUploads,
    syncStatus,
    pendingAction,
    captureProcessing,
    completedPreviewAssetId,
    lastFailedAction,
    captureFeedback,
    captureError,
    retryLastFailedAction,
    consumeCompletedPreviewAsset,
    captureFromCamera,
    pickImageFromLibrary,
    importDroppedFile,
  };
}
