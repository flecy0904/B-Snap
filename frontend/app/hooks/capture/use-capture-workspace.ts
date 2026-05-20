import { useEffect, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { subjects as fallbackSubjects } from '../../app-defaults';
import { createCaptureAsset, useSyncBridge, useSyncBridgeStatus } from '../use-sync-bridge';
import { BackendApiError, isBackendApiEnabled, uploadBackendFile } from '../../services/backend-api';
import type { CaptureAsset, Subject } from '../../types';
import { buildEmptyStudyWorkspaceState, loadStudyWorkspaceState, saveStudyWorkspaceState } from '../../storage/local-workspace-store';
import { cleanAiDisplayText } from '../../ui-helpers';

type UploadResult = Awaited<ReturnType<typeof uploadBackendFile>>;
type PreprocessingFallbackChoice = 'continue' | 'use-original' | 'cancel';

function getCaptureErrorMessage(error: unknown, fallback: string) {
  if (error instanceof BackendApiError && error.detail) return error.detail;
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
  asset.analysisSummary = cleanAiDisplayText(upload.analysis.summary ?? asset.summary);
  asset.analysisKeywords = upload.analysis.keywords?.filter(Boolean) ?? asset.analysisKeywords;
  return asset;
}

function resolvePreprocessingFallbackChoice(upload: UploadResult | null): Promise<PreprocessingFallbackChoice> {
  if (upload?.preprocessing?.detail_code !== 'segmentation_mask_not_found') {
    return Promise.resolve('continue');
  }

  return new Promise((resolve) => {
    Alert.alert(
      '사진에서 판서 영역을 찾지 못했어요.',
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

export function useCaptureWorkspace(props: {
  subjectId: number;
  subjects?: Subject[];
}) {
  const syncBridge = useSyncBridge();
  const syncStatus = useSyncBridgeStatus();
  const [recentUploads, setRecentUploads] = useState<CaptureAsset[]>([]);
  const [pendingAction, setPendingAction] = useState<'camera' | 'library' | 'pdf' | null>(null);
  const [lastFailedAction, setLastFailedAction] = useState<'camera' | 'library' | 'pdf' | null>(null);
  const [captureFeedback, setCaptureFeedback] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const subjectOptions = props.subjects?.length ? props.subjects : fallbackSubjects;
  const subject = useMemo(() => subjectOptions.find((value) => value.id === props.subjectId) ?? null, [props.subjectId, subjectOptions]);

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
    return `${assetLabel}를 업로드했습니다.`;
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
      setCaptureError('실시간 업로드 서버에 연결하지 못했습니다. backend가 켜져 있는지 확인해주세요.');
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
        setCaptureFeedback('촬영을 취소했습니다.');
        setPendingAction(null);
        return;
      }

      const picked = result.assets[0];
      const localFileUri = await persistPickedFileUri({
        uri: picked.uri,
        fileName: picked.fileName,
        mimeType: picked.mimeType,
        fallbackExtension: 'jpg',
      });
      let previewUri = picked.uri;
      let backendUpload: UploadResult | null = null;
      if (isBackendApiEnabled()) {
        backendUpload = await uploadBackendFile({
          uri: picked.uri,
          name: picked.fileName || `${subject.name} 카메라 캡처.jpg`,
          type: picked.mimeType || 'image/jpeg',
        });
        previewUri = backendUpload.url;
      }
      const fallbackChoice = await resolvePreprocessingFallbackChoice(backendUpload);
      if (fallbackChoice === 'cancel') {
        setCaptureFeedback('촬영을 취소했습니다.');
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
    } catch (error) {
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
        setCaptureFeedback('사진 선택을 취소했습니다.');
        setPendingAction(null);
        return;
      }

      const picked = result.assets[0];
      const localFileUri = await persistPickedFileUri({
        uri: picked.uri,
        fileName: picked.fileName,
        mimeType: picked.mimeType,
        fallbackExtension: 'jpg',
      });
      let previewUri = picked.uri;
      let backendUpload: UploadResult | null = null;
      if (isBackendApiEnabled()) {
        backendUpload = await uploadBackendFile({
          uri: picked.uri,
          name: picked.fileName || `${subject.name} 갤러리 이미지.jpg`,
          type: picked.mimeType || 'image/jpeg',
        });
        previewUri = backendUpload.url;
      }
      const fallbackChoice = await resolvePreprocessingFallbackChoice(backendUpload);
      if (fallbackChoice === 'cancel') {
        setCaptureFeedback('이미지 저장을 취소했습니다.');
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
    } catch (error) {
      setLastFailedAction('library');
      setCaptureError(getCaptureErrorMessage(error, '사진첩에서 이미지를 가져오지 못했습니다.'));
    } finally {
      setPendingAction(null);
    }
  };

  const pickPdfDocument = async () => {
    if (!subject || pendingAction) return;
    setCaptureFeedback(null);
    setCaptureError(null);
    setLastFailedAction(null);
    setPendingAction('pdf');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets.length) {
        setCaptureFeedback('PDF 선택을 취소했습니다.');
        setPendingAction(null);
        return;
      }

      const picked = result.assets[0];
      const localFileUri = await persistPickedFileUri({
        uri: picked.uri,
        fileName: picked.name,
        mimeType: picked.mimeType,
        fallbackExtension: 'pdf',
      });
      let previewUri = picked.uri;
      let backendUpload: UploadResult | null = null;
      if (isBackendApiEnabled()) {
        backendUpload = await uploadBackendFile({
          uri: picked.uri,
          name: picked.name || `${subject.name} 참고 PDF.pdf`,
          type: picked.mimeType || 'application/pdf',
        });
        previewUri = backendUpload.url;
      }
      const newAsset = createCaptureAsset({
        subjectId: subject.id,
        subjectName: subject.name,
        type: 'pdf',
        source: 'document',
        fileName: picked.name || `${subject.name} 참고 PDF`,
      });
      
      newAsset.fileUrl = previewUri;
      newAsset.previewImageKey = localFileUri ?? newAsset.previewImageKey;
      if (backendUpload) applyUploadAnalysis(newAsset, backendUpload);
      
      await pushAsset(newAsset);
    } catch (error) {
      setLastFailedAction('pdf');
      setCaptureError(getCaptureErrorMessage(error, 'PDF를 가져오지 못했습니다.'));
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
      return;
    }
    await pickPdfDocument();
  };

  return {
    selectedSubject: subject,
    recentUploads,
    syncStatus,
    pendingAction,
    lastFailedAction,
    captureFeedback,
    captureError,
    retryLastFailedAction,
    captureFromCamera,
    pickImageFromLibrary,
    pickPdfDocument,
  };
}
