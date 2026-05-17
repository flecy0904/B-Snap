import type { StudyDocumentEntry } from '../../../types';

export function getStudyDocumentBackendNoteId(document: StudyDocumentEntry | null | undefined) {
  if (!document) return null;
  if (typeof document.backendNoteId === 'number') return document.backendNoteId;
  if (document.backendSyncStatus === 'local' || document.backendSyncStatus === 'syncing' || document.backendSyncStatus === 'failed') {
    return null;
  }
  return document.id;
}

export function hasBackendNoteId(document: StudyDocumentEntry | null | undefined) {
  return getStudyDocumentBackendNoteId(document) !== null;
}
