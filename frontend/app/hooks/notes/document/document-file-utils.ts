import { resolveBackendAssetUrl } from '../../../services/backend-api';
import type { StudyDocumentEntry } from '../../../types';

export function isPdfAssetUrl(url: string | null | undefined) {
  return !!url && /\.pdf(?:$|[?#])/i.test(url);
}

export function normalizeDocumentFile(file: StudyDocumentEntry['file']) {
  if (!file || typeof file !== 'object' || !('uri' in file)) return file;
  return {
    ...file,
    uri: resolveBackendAssetUrl(file.uri) ?? file.uri,
  };
}
