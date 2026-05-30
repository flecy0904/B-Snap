import type { Dispatch, SetStateAction } from 'react';
import {
  BackendApiError,
  createBackendNote,
  createBackendNotePage,
  ensureFolderForSubject,
  isBackendApiEnabled,
} from '../../../services/backend-api';
import { derivePreprocessedCropUrl } from '../../../ui-helpers';
import type {
  CaptureAsset,
  DocumentPageView,
  GeneratedWorkspacePage,
  PageCaptureReference,
  StudyDocumentEntry,
  Subject,
  WorkspaceAttachment,
} from '../../../types';
import { getStudyDocumentBackendNoteId } from '../document/backend-sync';
import { serializeNotePageContent } from '../document/note-page-content';
import { buildGeneratedSummary, buildWorkspaceAttachment } from '../workspace/helpers';

type SetState<T> = Dispatch<SetStateAction<T>>;

type CaptureAssetActionsParams = {
  availableSubjects: Subject[];
  subject: Subject | null;
  studyDocumentId: number | null;
  studyDocument: StudyDocumentEntry | null;
  currentPdfPageByDocument: Record<number, number>;
  backendPageIdsByDocument: Record<number, Record<number, number>>;
  captureAssetsBySubject: Record<number, CaptureAsset[]>;
  setCaptureAssetsBySubject: SetState<Record<number, CaptureAsset[]>>;
  setAttachmentsByDocument: SetState<Record<number, WorkspaceAttachment[]>>;
  setGeneratedPagesByDocument: SetState<Record<number, GeneratedWorkspacePage[]>>;
  setPageCaptureReferencesByDocument: SetState<Record<number, PageCaptureReference[]>>;
  setActivePageByDocument: SetState<Record<number, DocumentPageView>>;
  setBackendPageIdsByDocument: SetState<Record<number, Record<number, number>>>;
  setIncomingAssetSuggestion: SetState<CaptureAsset | null>;
  setIncomingBannerQueue: SetState<CaptureAsset[]>;
  setWorkspaceFeedback: SetState<string | null>;
  openCreatedStudyDocument: (document: StudyDocumentEntry, feedback: string) => void;
};

export function useCaptureAssetActions(params: CaptureAssetActionsParams) {
  const updateAssetStatus = (assetId: string, nextStatus: CaptureAsset['status']) => {
    params.setCaptureAssetsBySubject((current) => {
      const next = { ...current };

      Object.keys(next).forEach((key) => {
        const subjectAssets = next[Number(key)] ?? [];
        next[Number(key)] = subjectAssets.map((asset) => (asset.id === assetId ? { ...asset, status: nextStatus } : asset));
      });

      return next;
    });
  };

  const findCaptureAssetById = (assetId: string) => (
    Object.values(params.captureAssetsBySubject)
      .flat()
      .find((asset) => asset.id === assetId) ?? null
  );

  const resolveAssetUri = (asset: CaptureAsset) => {
    const uri = derivePreprocessedCropUrl(asset.processedUrl) ?? asset.thumbnailUrl ?? asset.processedUrl ?? asset.fileUrl ?? asset.previewImageKey;
    return (
      uri?.startsWith('http://') ||
      uri?.startsWith('https://') ||
      uri?.startsWith('file://') ||
      uri?.startsWith('data:image/') ||
      uri?.startsWith('data:application/pdf')
        ? uri
        : null
    );
  };

  const createImageNoteFromAsset = async (asset: CaptureAsset) => {
    if (asset.type !== 'image') return false;
    const imageUrl = resolveAssetUri(asset);
    if (!imageUrl) {
      params.setWorkspaceFeedback('이미지 파일 URL을 찾지 못했어요.');
      return false;
    }

    const targetSubject = params.availableSubjects.find((value) => value.id === asset.subjectId)
      ?? params.subject
      ?? params.availableSubjects[0]
      ?? null;
    if (!targetSubject) return false;

    if (isBackendApiEnabled()) {
      try {
        const folder = await ensureFolderForSubject({ name: targetSubject.name, color: targetSubject.color });
        const backendNote = await createBackendNote({
          folderId: folder.id,
          title: asset.title,
          summary: asset.summary,
        });
        const backendPage = await createBackendNotePage({
          noteId: backendNote.id,
          pageNumber: 1,
          content: serializeNotePageContent({ inkStrokes: [], textAnnotations: [] }),
          imageUrl,
        });
        params.setBackendPageIdsByDocument((current) => ({
          ...current,
          [backendNote.id]: {
            ...(current[backendNote.id] ?? {}),
            1: backendPage.id,
          },
        }));
        const document: StudyDocumentEntry = {
          id: backendNote.id,
          backendNoteId: backendNote.id,
          subjectId: targetSubject.id,
          title: backendNote.title,
          type: 'image',
          updatedAt: '방금 전',
          pageCount: 1,
          preview: backendNote.summary ?? '이미지로 만든 노트입니다.',
          file: { uri: imageUrl },
          remoteFileUrl: imageUrl,
          backendSyncStatus: 'synced',
        };
        params.openCreatedStudyDocument(document, '이미지를 노트에 추가했어요.');
        updateAssetStatus(asset.id, 'accepted');
        return true;
      } catch (error) {
        params.setWorkspaceFeedback(
          error instanceof BackendApiError && error.detail
            ? error.detail
            : '이미지를 노트에 추가하는 중에 문제가 발생했어요.',
        );
        return false;
      }
    }

    const document: StudyDocumentEntry = {
      id: Date.now(),
      subjectId: targetSubject.id,
      title: asset.title,
      type: 'image',
      updatedAt: '방금 전',
      pageCount: 1,
      preview: asset.summary,
      file: { uri: imageUrl },
      localFileUri: imageUrl,
      backendSyncStatus: 'local',
    };
    params.openCreatedStudyDocument(document, '이미지를 새 노트로 만들었어요.');
    updateAssetStatus(asset.id, 'accepted');
    return true;
  };

  const persistAssetForCurrentDocument = async (asset: CaptureAsset) => {
    if (!params.studyDocumentId || !isBackendApiEnabled() || !params.backendPageIdsByDocument[params.studyDocumentId]) return;
    const backendNoteId = getStudyDocumentBackendNoteId(params.studyDocument);
    if (!backendNoteId) return;
    const assetUrl = resolveAssetUri(asset);
    if (!assetUrl) return;

    const existingPageNumbers = Object.keys(params.backendPageIdsByDocument[params.studyDocumentId]).map(Number).filter(Number.isFinite);
    const nextPageNumber = Math.max(0, ...existingPageNumbers) + 1;
    try {
      const backendPage = await createBackendNotePage({
        noteId: backendNoteId,
        pageNumber: nextPageNumber,
        content: serializeNotePageContent({ inkStrokes: [], textAnnotations: [] }),
        imageUrl: assetUrl,
      });
      params.setBackendPageIdsByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: {
          ...(current[params.studyDocumentId!] ?? {}),
          [backendPage.page_number]: backendPage.id,
        },
      }));
    } catch {
      params.setWorkspaceFeedback('이미지를 페이지로 저장하는 중 문제가 발생했어요.');
    }
  };

  const insertAssetIntoWorkspace = async (asset: CaptureAsset) => {
    if (!params.studyDocumentId) {
      await createImageNoteFromAsset(asset);
      return;
    }

    if (asset.type === 'image') {
      void persistAssetForCurrentDocument(asset);
    }

    const insertAfterPage = params.currentPdfPageByDocument[params.studyDocumentId] ?? 1;
    const croppedImageUrl = derivePreprocessedCropUrl(asset.processedUrl) ?? asset.thumbnailUrl;
    const generatedPageId = `generated-page-${asset.id}-${Date.now()}`;
    const generatedPage: GeneratedWorkspacePage = {
      id: generatedPageId,
      documentId: params.studyDocumentId,
      sourceAssetId: asset.id,
      pageKind: 'summary',
      title: asset.title,
      createdAt: new Date().toISOString(),
      insertAfterPage,
      status: 'generating',
      previewImageKey: asset.previewImageKey,
      previewImage: asset.previewImage,
      fileUrl: asset.fileUrl,
      thumbnailUrl: croppedImageUrl ?? asset.thumbnailUrl,
      processedUrl: asset.processedUrl,
      ...buildGeneratedSummary(asset, params.availableSubjects),
    };

    params.setAttachmentsByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [buildWorkspaceAttachment(asset, generatedPageId), ...(current[params.studyDocumentId!] ?? [])],
    }));
    params.setGeneratedPagesByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: [generatedPage, ...(current[params.studyDocumentId!] ?? [])],
    }));
    params.setActivePageByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: { kind: 'generated', pageId: generatedPageId },
    }));
    updateAssetStatus(asset.id, 'accepted');
    params.setWorkspaceFeedback(asset.type === 'image' ? '이미지를 저장하고 정리본을 만들고 있어요. 조금만 기다려주세요.' : '다음 페이지의 정리본을 만들고 있어요. 조금만 기다려주세요.');

    setTimeout(() => {
      params.setGeneratedPagesByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((value) =>
          value.id === generatedPageId ? { ...value, status: 'ready' } : value,
        ),
      }));
      params.setWorkspaceFeedback('정리본이 준비됐어요!');
    }, 1600);
  };

  const removeCaptureAsset = (assetId: string) => {
    params.setCaptureAssetsBySubject((current) => {
      const next: Record<number, CaptureAsset[]> = {};

      Object.keys(current).forEach((key) => {
        next[Number(key)] = (current[Number(key)] ?? []).filter((asset) => asset.id !== assetId);
      });

      return next;
    });
    params.setIncomingBannerQueue((current) => current.filter((asset) => asset.id !== assetId));
    params.setIncomingAssetSuggestion((current) => (current?.id === assetId ? null : current));
    params.setAttachmentsByDocument((current) => {
      const next: Record<number, WorkspaceAttachment[]> = {};

      Object.keys(current).forEach((key) => {
        next[Number(key)] = (current[Number(key)] ?? []).filter((attachment) => attachment.assetId !== assetId);
      });

      return next;
    });
    params.setPageCaptureReferencesByDocument((current) => {
      const next: Record<number, PageCaptureReference[]> = {};

      Object.keys(current).forEach((key) => {
        next[Number(key)] = (current[Number(key)] ?? []).filter((reference) => reference.assetId !== assetId);
      });

      return next;
    });
    params.setGeneratedPagesByDocument((current) => {
      const next: Record<number, GeneratedWorkspacePage[]> = {};

      Object.keys(current).forEach((key) => {
        next[Number(key)] = (current[Number(key)] ?? []).filter((page) => page.sourceAssetId !== assetId);
      });

      return next;
    });
    params.setWorkspaceFeedback('Photo 라이브러리에서 이미지를 삭제했어요.');
  };

  return {
    updateAssetStatus,
    findCaptureAssetById,
    resolveAssetUri,
    createImageNoteFromAsset,
    persistAssetForCurrentDocument,
    insertAssetIntoWorkspace,
    removeCaptureAsset,
  };
}
