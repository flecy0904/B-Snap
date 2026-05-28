import type { ImageSourcePropType } from 'react-native';
import type { CaptureAsset, PageCaptureReference, StudyDocumentEntry } from '../../../types';
import { resolveBackendAssetUrl } from '../../../services/backend-api';
import { derivePreprocessedCropUrl } from '../../../ui-helpers';

function isRenderableImageUri(uri: string | undefined) {
  if (!uri) return false;
  return uri.startsWith('http://')
    || uri.startsWith('https://')
    || uri.startsWith('file://')
    || uri.startsWith('data:image/');
}

function normalizeImageUri(uri: string | null | undefined) {
  return resolveBackendAssetUrl(uri) ?? uri ?? undefined;
}

function buildImageSource(uri: string | null | undefined, fallback: number | undefined): ImageSourcePropType | null {
  const normalizedUri = normalizeImageUri(uri);
  if (normalizedUri && isRenderableImageUri(normalizedUri)) return { uri: normalizedUri };
  return fallback ?? null;
}

function getPersistedLocalImageUri(asset: Pick<CaptureAsset, 'previewImageKey'> | Pick<PageCaptureReference, 'previewImageKey'>) {
  return asset.previewImageKey?.startsWith('file://') ? asset.previewImageKey : undefined;
}

function getCapturePreviewUri(asset: Pick<CaptureAsset, 'fileUrl' | 'processedUrl' | 'thumbnailUrl' | 'previewImageKey'>) {
  return derivePreprocessedCropUrl(asset.processedUrl)
    ?? asset.thumbnailUrl
    ?? asset.processedUrl
    ?? asset.fileUrl
    ?? getPersistedLocalImageUri(asset)
    ?? asset.previewImageKey;
}

function getCaptureOriginalUri(asset: Pick<CaptureAsset, 'fileUrl' | 'processedUrl' | 'thumbnailUrl' | 'previewImageKey'> | Pick<PageCaptureReference, 'fileUrl' | 'processedUrl' | 'thumbnailUrl' | 'previewImageKey'>) {
  return derivePreprocessedCropUrl(asset.processedUrl)
    ?? asset.thumbnailUrl
    ?? asset.fileUrl
    ?? getPersistedLocalImageUri(asset)
    ?? asset.processedUrl
    ?? asset.previewImageKey;
}

export function getCaptureImageSource(asset: CaptureAsset) {
  return buildImageSource(getCapturePreviewUri(asset), asset.previewImage);
}

export function getCaptureOriginalImageSource(asset: CaptureAsset) {
  return buildImageSource(getCaptureOriginalUri(asset), asset.previewImage);
}

export function getPageCaptureReferenceImageSource(reference: PageCaptureReference) {
  return buildImageSource(getCaptureOriginalUri(reference), reference.previewImage);
}

export function getPageCaptureReferenceImageUri(reference: PageCaptureReference) {
  return normalizeImageUri(getCaptureOriginalUri(reference)) ?? undefined;
}

export function formatCaptureDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getCaptureReferences(asset: CaptureAsset, references: PageCaptureReference[]) {
  return references.filter((reference) => reference.assetId === asset.id);
}

export function getCapturePlacementLabel(asset: CaptureAsset, references: PageCaptureReference[]) {
  const matches = getCaptureReferences(asset, references);
  if (!matches.length) return '미연결';
  const firstLabel = matches[0]?.pageLabel || '연결됨';
  return matches.length > 1 ? `${firstLabel} 외 ${matches.length - 1}` : firstLabel;
}

export function getCaptureLibraryContextLabel(
  asset: CaptureAsset,
  references: PageCaptureReference[],
  documents: StudyDocumentEntry[],
) {
  const matches = getCaptureReferences(asset, references);
  if (!matches.length) return '연결된 PDF 없음';

  const first = matches[0];
  const documentTitle = documents.find((document) => document.id === first.documentId)?.title ?? '연결된 PDF';
  const pageLabel = first.pageLabel || '페이지 연결';
  const extra = matches.length > 1 ? ` 외 ${matches.length - 1}` : '';
  return `${documentTitle} · ${pageLabel}${extra}`;
}
