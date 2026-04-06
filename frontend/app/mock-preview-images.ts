export const MOCK_PREVIEW_IMAGE_KEY = 'mock_presentation_4837';

const mockPreviewImages = {
  [MOCK_PREVIEW_IMAGE_KEY]: require('../assets/notes/mock-presentation/img-4837-mock.jpg'),
} as const;

export function resolvePreviewImage(key?: string | null) {
  if (!key) return undefined;
  return mockPreviewImages[key as keyof typeof mockPreviewImages];
}
