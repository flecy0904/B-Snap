import type { ImageSourcePropType } from 'react-native';
import type { CaptureAsset, PageCaptureReference } from '../../../types';

function isRenderableImageUri(uri: string | undefined) {
  if (!uri) return false;
  return uri.startsWith('http://')
    || uri.startsWith('https://')
    || uri.startsWith('file://')
    || uri.startsWith('data:image/');
}

function buildImageSource(uri: string | undefined, fallback: number | undefined): ImageSourcePropType | null {
  if (uri && isRenderableImageUri(uri)) return { uri };
  return fallback ?? null;
}

export function getCaptureImageSource(asset: CaptureAsset) {
  return buildImageSource(asset.thumbnailUrl ?? asset.fileUrl ?? asset.previewImageKey, asset.previewImage);
}

export function getCaptureOriginalImageSource(asset: CaptureAsset) {
  return buildImageSource(asset.fileUrl ?? asset.thumbnailUrl ?? asset.previewImageKey, asset.previewImage);
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
