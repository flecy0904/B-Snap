import type { Dispatch, SetStateAction } from 'react';
import { isBackendApiEnabled, updateBackendNote } from '../../../services/backend-api';
import type { InkTool } from '../../../ui-types';
import type { NoteEntry, NoteWorkspaceMode, StudyDocumentEntry } from '../../../types';
import { addUniqueId, removeId, upsertStudyDocument } from '../document/collection-helpers';
import { getStudyDocumentBackendNoteId } from '../document/backend-sync';
import { confirmDeleteAction } from '../ui/confirm-delete-action';

type SetState<T> = Dispatch<SetStateAction<T>>;

type WorkspaceDocumentIntentsParams = {
  visibleNotes: NoteEntry[];
  deletedNotes: NoteEntry[];
  allStudyDocuments: StudyDocumentEntry[];
  deletedStudyDocuments: StudyDocumentEntry[];
  noteId: number | null;
  onOpenNotesTab: () => void;
  setSubjectId: SetState<number | null>;
  setNoteId: SetState<number | null>;
  setQuery: SetState<string>;
  setNoteDetailTab: SetState<'original' | 'summary'>;
  setNoteWorkspaceMode: SetState<NoteWorkspaceMode>;
  setStudyDocumentId: SetState<number | null>;
  setInkTool: SetState<InkTool>;
  setAiPanelOpen: SetState<boolean>;
  setDeletedNoteIds: SetState<number[]>;
  setUserStudyDocuments: SetState<StudyDocumentEntry[]>;
  setWorkspaceFeedback: SetState<string | null>;
};

export function useWorkspaceDocumentIntents(params: WorkspaceDocumentIntentsParams) {
  const openSubject = (id: number) => {
    params.onOpenNotesTab();
    params.setSubjectId(id);
    params.setNoteId(null);
    params.setStudyDocumentId(null);
    params.setNoteDetailTab('original');
  };

  const openNote = (id: number) => {
    const selected = params.visibleNotes.find((value) => value.id === id);
    if (!selected) return;

    params.onOpenNotesTab();
    params.setSubjectId(selected.subjectId);
    params.setNoteId(id);
    params.setNoteDetailTab('original');
  };

  const requestDeleteNote = (id: number) => {
    const target = params.visibleNotes.find((value) => value.id === id);
    if (!target) return;

    confirmDeleteAction({
      title: 'Photo 삭제',
      message: `"${target.title}" Photo를 삭제할까요? 삭제 후에는 현재 기기 목록에서 보이지 않습니다.`,
      confirmText: '삭제',
      onConfirm: () => {
        params.setDeletedNoteIds((current) => addUniqueId(current, id));
        if (params.noteId === id) {
          params.setNoteId(null);
          params.setNoteDetailTab('original');
        }
        params.setWorkspaceFeedback('Photo를 삭제했습니다.');
      },
    });
  };

  const restoreNote = (id: number) => {
    const target = params.deletedNotes.find((value) => value.id === id);
    if (!target) return;

    params.setDeletedNoteIds((current) => removeId(current, id));
    params.setNoteWorkspaceMode('photo');
    params.setSubjectId(target.subjectId);
    params.setWorkspaceFeedback('Photo를 복구했습니다.');
  };

  const renameStudyDocument = (id: number, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      params.setWorkspaceFeedback('문서 제목을 입력해주세요.');
      return false;
    }

    const target = params.allStudyDocuments.find((value) => value.id === id) ?? params.deletedStudyDocuments.find((value) => value.id === id);
    if (!target) return false;
    const backendNoteId = getStudyDocumentBackendNoteId(target);
    const isBackendDocument = isBackendApiEnabled() && Boolean(backendNoteId);

    if (isBackendDocument) {
      void updateBackendNote({ noteId: backendNoteId!, title: nextTitle })
        .then((updated) => {
          params.setUserStudyDocuments((current) => upsertStudyDocument(current, {
            ...target,
            backendNoteId: updated.id,
            title: updated.title,
            preview: updated.summary ?? target.preview,
            updatedAt: 'DB 저장됨',
            backendSyncStatus: 'synced',
          }));
          params.setWorkspaceFeedback('문서 제목을 백엔드에 저장했습니다.');
        })
        .catch(() => {
          params.setWorkspaceFeedback('노트 제목 저장에 실패했습니다. backend 연결을 확인해주세요.');
        });
      return true;
    }

    params.setUserStudyDocuments((current) => upsertStudyDocument(current, {
      ...target,
      title: nextTitle,
      updatedAt: '방금 전',
    }));
    params.setWorkspaceFeedback('문서 제목을 수정했습니다.');
    return true;
  };

  const changeNoteWorkspaceMode = (next: NoteWorkspaceMode) => {
    params.setNoteWorkspaceMode(next);
    params.setNoteId(null);
    params.setStudyDocumentId(null);
    params.setInkTool('view');
    params.setAiPanelOpen(false);
  };

  const resetToSubjectList = () => {
    params.setNoteId(null);
    params.setSubjectId(null);
    params.setQuery('');
    params.setNoteDetailTab('original');
  };

  return {
    openSubject,
    openNote,
    requestDeleteNote,
    restoreNote,
    renameStudyDocument,
    changeNoteWorkspaceMode,
    resetToSubjectList,
  };
}
