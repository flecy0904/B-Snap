import type { ImageSourcePropType } from 'react-native';
import type { CaptureAsset, PageCaptureReference } from '../../../types';
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
  return asset.fileUrl
    ?? getPersistedLocalImageUri(asset)
    ?? asset.thumbnailUrl
    ?? derivePreprocessedCropUrl(asset.processedUrl)
    ?? asset.processedUrl
    ?? asset.previewImageKey;
}

export function getCaptureImageSource(asset: CaptureAsset) {
  return buildImageSource(getCapturePreviewUri(asset), asset.previewImage);
}

export function getCaptureOriginalImageSource(asset: CaptureAsset) {
  return buildImageSource(getCapturePreviewUri(asset), asset.previewImage);
}

export function getPageCaptureReferenceImageSource(reference: PageCaptureReference) {
  return buildImageSource(getCaptureOriginalUri(reference), reference.previewImage);
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
