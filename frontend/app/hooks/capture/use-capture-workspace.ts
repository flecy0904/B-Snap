import { useEffect, useMemo, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { subjects as fallbackSubjects } from '../../app-defaults';
import { createCaptureAsset, useSyncBridge, useSyncBridgeStatus } from '../use-sync-bridge';
import { BackendApiError, isBackendApiEnabled, uploadBackendFile } from '../../services/backend-api';
import type { CaptureAsset, Subject } from '../../types';
import { buildEmptyStudyWorkspaceState, loadStudyWorkspaceState, saveStudyWorkspaceState } from '../../storage/local-workspace-store';
import { cleanAiDisplayText } from '../../ui-helpers';

function getCaptureErrorMessage(error: unknown, fallback: string) {
  if (error instanceof BackendApiError && error.detail) return error.detail;
  return fallback;
}

function applyUploadAnalysis(asset: CaptureAsset, upload: Awaited<ReturnType<typeof uploadBackendFile>>) {
  if (!upload.analysis) return asset;
  asset.analysisStatus = upload.analysis.status === 'failed' ? 'failed' : upload.analysis.status === 'pending' ? 'pending' : 'ready';
  asset.analysisSummary = cleanAiDisplayText(upload.analysis.summary ?? asset.summary);
  asset.analysisKeywords = upload.analysis.keywords?.filter(Boolean) ?? asset.analysisKeywords;
  return asset;
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
      let previewUri = picked.uri;
      let backendUpload: Awaited<ReturnType<typeof uploadBackendFile>> | null = null;
      if (isBackendApiEnabled()) {
        backendUpload = await uploadBackendFile({
          uri: picked.uri,
          name: picked.fileName || `${subject.name} 카메라 캡처.jpg`,
          type: picked.mimeType || 'image/jpeg',
        });
        previewUri = backendUpload.url;
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
      if (backendUpload) applyUploadAnalysis(newAsset, backendUpload);
      
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
      let previewUri = picked.uri;
      let backendUpload: Awaited<ReturnType<typeof uploadBackendFile>> | null = null;
      if (isBackendApiEnabled()) {
        backendUpload = await uploadBackendFile({
          uri: picked.uri,
          name: picked.fileName || `${subject.name} 갤러리 이미지.jpg`,
          type: picked.mimeType || 'image/jpeg',
        });
        previewUri = backendUpload.url;
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
      if (backendUpload) applyUploadAnalysis(newAsset, backendUpload);
      
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
      let previewUri = picked.uri;
      let backendUpload: Awaited<ReturnType<typeof uploadBackendFile>> | null = null;
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
