import type { StudyDocumentEntry } from '../../../types';

export function getStudyDocumentBackendNoteId(document: StudyDocumentEntry | null | undefined) {
  if (!document) return null;
  if (typeof document.backendNoteId === 'number') return document.backendNoteId;
  if (document.backendSyncStatus === 'synced') return document.id;
  return null;
}

export function hasBackendNoteId(document: StudyDocumentEntry | null | undefined) {
  return getStudyDocumentBackendNoteId(document) !== null;
}
