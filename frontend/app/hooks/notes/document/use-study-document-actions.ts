import type { Dispatch, SetStateAction } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import {
  createBackendNote,
  createBackendNotePage,
  deleteBackendNote,
  ensureFolderForSubject,
  isBackendApiEnabled,
  type BackendChatSession,
} from '../../../services/backend-api';
import { buildEmptyStudyWorkspaceState, clearStudyWorkspaceState } from '../../../storage/local-workspace-store';
import type { InkStroke, InkTextAnnotation, InkTool } from '../../../ui-types';
import type {
  AiAnswer,
  BookmarkedPage,
  CaptureAsset,
  DocumentPageView,
  GeneratedWorkspacePage,
  NoteWorkspaceMode,
  PageCaptureReference,
  StudyDocumentEntry,
  Subject,
  WorkspaceAttachment,
} from '../../../types';
import { getStudyDocumentBackendNoteId } from './backend-sync';
import { addUniqueId, removeId } from './collection-helpers';
import { createLocalStudyDocumentId, persistPickedPdfAsset, readPdfPageCount } from './pdf-local-import';
import { serializeNotePageContent } from './note-page-content';
import { confirmDeleteAction } from '../ui/confirm-delete-action';

type SetState<T> = Dispatch<SetStateAction<T>>;

type StudyDocumentActionsParams = {
  wide: boolean;
  subjectId: number | null;
  studyDocumentId: number | null;
  availableSubjects: Subject[];
  allStudyDocuments: StudyDocumentEntry[];
  deletedStudyDocuments: StudyDocumentEntry[];
  currentPdfPageByDocument: Record<number, number>;
  lastChatSessionByDocument: Record<number, number>;
  onOpenNotesTab: () => void;
  syncPdfDocumentToBackend: (document: StudyDocumentEntry, subject: Subject) => void | Promise<void>;
  setSubjectId: SetState<number | null>;
  setNoteId: SetState<number | null>;
  setQuery: SetState<string>;
  setNoteDetailTab: SetState<'original' | 'summary'>;
  setNoteWorkspaceMode: SetState<NoteWorkspaceMode>;
  setStudyDocumentId: SetState<number | null>;
  setInkTool: SetState<InkTool>;
  setAiPanelOpen: SetState<boolean>;
  setViewingAiChatSessionId: SetState<number | null>;
  setChatSessionByDocument: SetState<Record<number, number>>;
  setLastChatSessionByDocument: SetState<Record<number, number>>;
  setChatSessionsByDocument: SetState<Record<number, BackendChatSession[]>>;
  setAllChatSessions: SetState<BackendChatSession[]>;
  setCurrentPdfPageByDocument: SetState<Record<number, number>>;
  setActivePageByDocument: SetState<Record<number, DocumentPageView>>;
  setUserStudyDocuments: SetState<StudyDocumentEntry[]>;
  setDeletedNoteIds: SetState<number[]>;
  setDeletedStudyDocumentIds: SetState<number[]>;
  setBackendPageIdsByDocument: SetState<Record<number, Record<number, number>>>;
  setInkByDocument: SetState<Record<number, InkStroke[]>>;
  setRedoInkByDocument: SetState<Record<number, InkStroke[]>>;
  setTextAnnotationsByDocument: SetState<Record<number, InkTextAnnotation[]>>;
  setBookmarksByDocument: SetState<Record<number, BookmarkedPage[]>>;
  setAttachmentsByDocument: SetState<Record<number, WorkspaceAttachment[]>>;
  setPageCaptureReferencesByDocument: SetState<Record<number, PageCaptureReference[]>>;
  setGeneratedPagesByDocument: SetState<Record<number, GeneratedWorkspacePage[]>>;
  setCaptureAssetsBySubject: SetState<Record<number, CaptureAsset[]>>;
  setIncomingAssetSuggestion: SetState<CaptureAsset | null>;
  setIncomingBannerQueue: SetState<CaptureAsset[]>;
  setAiAnswer: SetState<AiAnswer | null>;
  setAiError: SetState<string | null>;
  setAiLoading: SetState<boolean>;
  setWorkspaceFeedback: SetState<string | null>;
};

export function useStudyDocumentActions(params: StudyDocumentActionsParams) {
  const clearOpenDocumentState = (documentId: number) => {
    params.setUserStudyDocuments((current) => current.filter((document) => document.id !== documentId));
    params.setBackendPageIdsByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    params.setInkByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    params.setRedoInkByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    params.setTextAnnotationsByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    params.setBookmarksByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    params.setAttachmentsByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    params.setPageCaptureReferencesByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    params.setGeneratedPagesByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    params.setCurrentPdfPageByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    params.setActivePageByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    params.setChatSessionByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    params.setLastChatSessionByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
    params.setChatSessionsByDocument((current) => {
      const next = { ...current };
      delete next[documentId];
      return next;
    });
  };

  const closeCurrentDocumentIfNeeded = (documentId: number) => {
    if (params.studyDocumentId !== documentId) return;
    params.setStudyDocumentId(null);
    params.setInkTool('view');
    params.setAiPanelOpen(false);
    params.setIncomingAssetSuggestion(null);
    params.setAiAnswer(null);
    params.setAiError(null);
    params.setAiLoading(false);
  };

  const openStudyDocument = (id: number | null) => {
    if (id === null) {
      params.setStudyDocumentId(null);
      params.setInkTool('view');
      params.setAiPanelOpen(false);
      return;
    }

    const selected = params.allStudyDocuments.find((value) => value.id === id);
    if (!selected) return;

    params.onOpenNotesTab();
    params.setSubjectId(selected.subjectId);
    params.setNoteId(null);
    params.setStudyDocumentId(id);
    params.setViewingAiChatSessionId(null);
    params.setChatSessionByDocument((current) => {
      const next = { ...current };
      const lastSessionId = params.lastChatSessionByDocument[id];
      if (lastSessionId) next[id] = lastSessionId;
      else delete next[id];
      return next;
    });
    params.setInkTool('view');
    params.setActivePageByDocument((current) => ({
      ...current,
      [id]: current[id] ?? { kind: 'pdf', pageNumber: params.currentPdfPageByDocument[id] ?? 1 },
    }));
  };

  const openCreatedStudyDocument = (document: StudyDocumentEntry, feedback: string) => {
    params.setUserStudyDocuments((current) => [document, ...current]);
    params.onOpenNotesTab();
    params.setSubjectId(document.subjectId);
    params.setNoteId(null);
    params.setStudyDocumentId(document.id);
    params.setNoteWorkspaceMode('note');
    params.setInkTool('view');
    params.setAiPanelOpen(false);
    params.setWorkspaceFeedback(feedback);
    params.setCurrentPdfPageByDocument((current) => ({
      ...current,
      [document.id]: 1,
    }));
    params.setActivePageByDocument((current) => ({
      ...current,
      [document.id]: { kind: 'pdf', pageNumber: 1 },
    }));
  };

  const createBlankNote = async () => {
    const targetSubjectId = params.subjectId ?? params.availableSubjects[0]?.id ?? null;
    if (!targetSubjectId) return;

    const targetSubject = params.availableSubjects.find((value) => value.id === targetSubjectId);
    if (!targetSubject) return;

    if (isBackendApiEnabled()) {
      try {
        const folder = await ensureFolderForSubject({ name: targetSubject.name, color: targetSubject.color });
        const backendNote = await createBackendNote({
          folderId: folder.id,
          title: `${targetSubject.name} 새 노트`,
          summary: '빈 노트',
        });
        const backendPage = await createBackendNotePage({
          noteId: backendNote.id,
          pageNumber: 1,
          content: serializeNotePageContent({ inkStrokes: [], textAnnotations: [] }),
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
          subjectId: targetSubjectId,
          title: backendNote.title,
          type: 'blank',
          updatedAt: '방금 전',
          pageCount: 1,
          preview: backendNote.summary ?? '새 빈 노트입니다.',
          backendSyncStatus: 'synced',
        };
        openCreatedStudyDocument(document, '새 빈 노트를 백엔드에 저장했습니다.');
        return;
      } catch {
        params.setWorkspaceFeedback('백엔드 저장에 실패해 이 기기에만 빈 노트를 만들었습니다.');
      }
    }

    const document: StudyDocumentEntry = {
      id: Date.now(),
      subjectId: targetSubjectId,
      title: `${targetSubject?.name ?? '수업'} 새 노트`,
      type: 'blank',
      updatedAt: '방금 전',
      pageCount: 1,
      preview: '새로 만든 빈 필기 노트입니다.',
      backendSyncStatus: 'local',
    };

    openCreatedStudyDocument(document, '새 빈 노트를 만들었습니다.');
  };

  const requestDeleteStudyDocument = (id: number) => {
    const target = params.allStudyDocuments.find((value) => value.id === id);
    if (!target) return;
    const backendNoteId = getStudyDocumentBackendNoteId(target);
    const isBackendDocument = isBackendApiEnabled() && Boolean(backendNoteId);

    confirmDeleteAction({
      title: 'Note 삭제',
      message: isBackendDocument
        ? `"${target.title}" Note 문서와 이 문서에 남긴 필기를 백엔드에서도 삭제할까요?`
        : `"${target.title}" Note 문서와 이 문서에 남긴 필기를 삭제할까요?`,
      confirmText: '삭제',
      onConfirm: () => {
        if (isBackendDocument) {
          void deleteBackendNote(backendNoteId!)
            .then(() => {
              clearOpenDocumentState(id);
              params.setAllChatSessions((current) => current.filter((session) => session.note_id !== backendNoteId));
              closeCurrentDocumentIfNeeded(id);
              params.setWorkspaceFeedback('Note 문서를 백엔드에서 삭제했습니다.');
            })
            .catch(() => {
              params.setWorkspaceFeedback('백엔드 노트 삭제에 실패했습니다. 다시 시도해주세요.');
            });
          return;
        }

        params.setDeletedStudyDocumentIds((current) => addUniqueId(current, id));
        closeCurrentDocumentIfNeeded(id);
        params.setWorkspaceFeedback('Note 문서를 삭제했습니다.');
      },
    });
  };

  const restoreStudyDocument = (id: number) => {
    const target = params.deletedStudyDocuments.find((value) => value.id === id);
    if (!target) return;

    params.setDeletedStudyDocumentIds((current) => removeId(current, id));
    params.setNoteWorkspaceMode('note');
    params.setSubjectId(target.subjectId);
    params.setWorkspaceFeedback('Note 문서를 복구했습니다.');
  };

  const uploadPdfDocument = async () => {
    const targetSubjectId = params.subjectId ?? params.availableSubjects[0]?.id ?? null;
    if (!targetSubjectId) return;

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'application/pdf',
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets.length) {
        params.setWorkspaceFeedback('PDF 업로드를 취소했습니다.');
        return;
      }

      const picked = result.assets[0];
      const targetSubject = params.availableSubjects.find((value) => value.id === targetSubjectId);
      if (!targetSubject) return;
      params.setWorkspaceFeedback('PDF를 이 기기에 저장하는 중입니다.');
      const localPdfFileUri = await persistPickedPdfAsset(picked);
      const localPageCount = await readPdfPageCount(picked, localPdfFileUri);
      const localDocumentId = createLocalStudyDocumentId();
      const localDocument: StudyDocumentEntry = {
        id: localDocumentId,
        subjectId: targetSubjectId,
        title: picked.name || `${targetSubject.name} PDF`,
        type: 'pdf',
        updatedAt: '방금 전',
        pageCount: localPageCount,
        preview: isBackendApiEnabled()
          ? '이 기기에서 바로 열고 백엔드 동기화 중입니다.'
          : '이 기기에 저장된 PDF입니다.',
        file: { uri: localPdfFileUri },
        localFileUri: localPdfFileUri,
        backendSyncStatus: isBackendApiEnabled() ? 'syncing' : 'local',
      };

      openCreatedStudyDocument(
        localDocument,
        isBackendApiEnabled() ? 'PDF를 열었습니다. 백엔드 동기화 중입니다.' : 'PDF 파일을 업로드했습니다.',
      );

      if (isBackendApiEnabled()) {
        void params.syncPdfDocumentToBackend(localDocument, targetSubject);
      }
    } catch {
      params.setWorkspaceFeedback('PDF 파일을 가져오지 못했습니다.');
    }
  };

  const resetNotes = () => {
    params.setNoteId(null);
    params.setStudyDocumentId(null);
    params.setQuery('');
    params.setNoteDetailTab('original');
    params.setInkTool('view');
    params.setAiPanelOpen(false);
    if (!params.wide) params.setSubjectId(null);
  };

  const resetLocalWorkspaceData = async () => {
    const emptyState = buildEmptyStudyWorkspaceState();
    params.setUserStudyDocuments(emptyState.userStudyDocuments);
    params.setDeletedNoteIds(emptyState.deletedNoteIds);
    params.setDeletedStudyDocumentIds(emptyState.deletedStudyDocumentIds);
    params.setCaptureAssetsBySubject(emptyState.captureAssetsBySubject);
    params.setAttachmentsByDocument(emptyState.attachmentsByDocument);
    params.setPageCaptureReferencesByDocument(emptyState.pageCaptureReferencesByDocument ?? {});
    params.setGeneratedPagesByDocument(emptyState.generatedPagesByDocument);
    params.setInkByDocument(emptyState.inkByDocument);
    params.setRedoInkByDocument({});
    params.setTextAnnotationsByDocument(emptyState.textAnnotationsByDocument);
    params.setCurrentPdfPageByDocument(emptyState.currentPdfPageByDocument);
    params.setActivePageByDocument(emptyState.activePageByDocument);
    params.setBookmarksByDocument(emptyState.bookmarksByDocument ?? {});
    params.setIncomingAssetSuggestion(null);
    params.setIncomingBannerQueue([]);
    params.setStudyDocumentId(null);
    params.setAiAnswer(null);
    params.setAiError(null);
    params.setAiLoading(false);
    await clearStudyWorkspaceState();
    params.setWorkspaceFeedback('로컬 작업 데이터를 초기화했습니다.');
  };

  const backToNoteList = () => {
    params.setNoteId(null);
    params.setStudyDocumentId(null);
    params.setAiPanelOpen(false);
    params.setInkTool('view');
    params.setIncomingAssetSuggestion(null);
  };

  return {
    openStudyDocument,
    openCreatedStudyDocument,
    createBlankNote,
    requestDeleteStudyDocument,
    restoreStudyDocument,
    uploadPdfDocument,
    resetNotes,
    resetLocalWorkspaceData,
    backToNoteList,
  };
}
