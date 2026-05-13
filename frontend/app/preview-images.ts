export const DEFAULT_CAPTURE_PREVIEW_IMAGE_KEY = 'default_capture_preview';

const previewImages = {
  [DEFAULT_CAPTURE_PREVIEW_IMAGE_KEY]: require('../assets/icon.png'),
};

export function resolvePreviewImage(key?: string | null) {
  if (!key) return null;
  if (/^(file|https?):\/\//i.test(key) || key.startsWith('data:image/')) return { uri: key };
  return previewImages[key as keyof typeof previewImages] ?? null;
}
