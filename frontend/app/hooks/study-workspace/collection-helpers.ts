import type { StudyDocumentEntry } from '../../types';

export function addUniqueId(ids: number[], id: number) {
  return ids.includes(id) ? ids : [...ids, id];
}

export function removeId(ids: number[], id: number) {
  return ids.filter((value) => value !== id);
}

export function upsertStudyDocument(documents: StudyDocumentEntry[], nextDocument: StudyDocumentEntry) {
  const exists = documents.some((document) => document.id === nextDocument.id);
  if (!exists) return [nextDocument, ...documents];

  return documents.map((document) => (
    document.id === nextDocument.id ? nextDocument : document
  ));
}
