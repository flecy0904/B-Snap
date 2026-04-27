import { useEffect, useMemo, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { subjects as fallbackSubjects } from '../data';
import { createCaptureAsset, createMockCaptureAsset, useSyncBridge } from './use-sync-bridge';
import type { CaptureAsset, CaptureAssetType, Subject } from '../types';
import { buildEmptyStudyWorkspaceState, loadStudyWorkspaceState, saveStudyWorkspaceState } from '../storage/local-workspace-store';

export function useCaptureWorkspace(props: {
  subjectId: number;
  subjects?: Subject[];
}) {
  const syncBridge = useSyncBridge();
  const [recentUploads, setRecentUploads] = useState<CaptureAsset[]>([]);
  const [pendingAction, setPendingAction] = useState<'camera' | 'library' | 'pdf' | null>(null);
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

  const buildFeedbackMessage = (asset: CaptureAsset, localOnly: boolean, cameraFallback: boolean) => {
    const assetLabel = asset.type === 'image' ? '이미지' : 'PDF';
    if (cameraFallback && localOnly) {
      return `실기기 카메라를 사용할 수 없어 mock 업로드로 전환했고, 이 기기에서만 ${assetLabel}를 저장했습니다.`;
    }
    if (cameraFallback) {
      return '실기기 카메라를 사용할 수 없어 mock 업로드로 전환했습니다.';
    }
    if (localOnly) {
      return `실시간 업로드 서버 없이 이 기기에서만 ${assetLabel}를 저장했습니다.`;
    }
    return `${assetLabel}를 업로드했습니다.`;
  };

  const pushAsset = async (asset: CaptureAsset, options?: { cameraFallback?: boolean }) => {
    try {
      const result = await syncBridge.publishAsset(asset);
      setRecentUploads((current) => [asset, ...current].slice(0, 5));
      setCaptureError(null);
      setCaptureFeedback(buildFeedbackMessage(asset, result.delivery === 'local', options?.cameraFallback ?? false));
      
      const state = await loadStudyWorkspaceState() || buildEmptyStudyWorkspaceState();

      const subjectAssets = state.captureAssetsBySubject[asset.subjectId] || [];
      state.captureAssetsBySubject[asset.subjectId] = [asset, ...subjectAssets];
      await saveStudyWorkspaceState(state);

    } catch {
      setCaptureError('실시간 업로드 서버에 연결하지 못했습니다. backend가 켜져 있는지 확인해주세요.');
    }
  };

  const createMockUpload = async (type: CaptureAssetType, options?: { cameraFallback?: boolean }) => {
    if (!subject) return;

    const asset = createMockCaptureAsset({
      subjectId: subject.id,
      subjectName: subject.name,
      type,
    });

    await pushAsset(asset, options);
  };

  const captureFromCamera = async () => {
    if (!subject) return;
    setCaptureFeedback(null);
    setCaptureError(null);
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
      const newAsset = createCaptureAsset({
        subjectId: subject.id,
        subjectName: subject.name,
        type: 'image',
        source: 'camera',
        fileName: picked.fileName || `${subject.name} 카메라 캡처`,
      });
      
      newAsset.previewImageKey = picked.uri;
      
      await pushAsset(newAsset);
    } catch {
      await createMockUpload('image', { cameraFallback: true });
    } finally {
      setPendingAction(null);
    }
  };

  const pickImageFromLibrary = async () => {
    if (!subject) return;
    setCaptureFeedback(null);
    setCaptureError(null);
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
      const newAsset = createCaptureAsset({
        subjectId: subject.id,
        subjectName: subject.name,
        type: 'image',
        source: 'library',
        fileName: picked.fileName || `${subject.name} 갤러리 이미지`,
      });
      
      newAsset.previewImageKey = picked.uri;
      
      await pushAsset(newAsset);
    } catch {
      setCaptureError('사진첩에서 이미지를 가져오지 못했습니다.');
    } finally {
      setPendingAction(null);
    }
  };

  const pickPdfDocument = async () => {
    if (!subject) return;
    setCaptureFeedback(null);
    setCaptureError(null);
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
      const newAsset = createCaptureAsset({
        subjectId: subject.id,
        subjectName: subject.name,
        type: 'pdf',
        source: 'document',
        fileName: picked.name || `${subject.name} 참고 PDF`,
      });
      
      newAsset.previewImageKey = picked.uri;
      
      await pushAsset(newAsset);
    } catch {
      setCaptureError('PDF를 가져오지 못했습니다.');
    } finally {
      setPendingAction(null);
    }
  };

  return {
    selectedSubject: subject,
    recentUploads,
    pendingAction,
    captureFeedback,
    captureError,
    createMockUpload,
    captureFromCamera,
    pickImageFromLibrary,
    pickPdfDocument,
  };
}
