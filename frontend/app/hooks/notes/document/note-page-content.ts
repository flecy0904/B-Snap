import type { InkImageAnnotation, InkStroke, InkTextAnnotation } from '../../../ui-types';

export type HandwritingRecognitionCluster = {
  id: string;
  pageNumber: number;
  bbox: { x: number; y: number; width: number; height: number };
  text: string;
  candidates?: Array<{ text: string; confidence?: number }>;
  keywords: string[];
  symbols: string[];
  confidence: number;
  source?: string;
  clusterKind?: 'text_like' | 'symbol_like' | 'mixed' | 'unknown' | string;
  textLikeScore?: number;
  symbolLikeScore?: number;
  symbolCandidates?: Array<{
    symbol: string;
    confidence: number;
    accepted: boolean;
    rejectionReason?: string;
  }>;
};

export type HandwritingRecognitionState = {
  status: 'pending' | 'ready' | 'failed' | 'unavailable' | string;
  strokeHash?: string;
  engine?: string;
  text?: string;
  keywords?: string[];
  symbols?: string[];
  confidence?: number;
  clusters?: HandwritingRecognitionCluster[];
  updatedAt?: string;
  visionFallbackUsed?: boolean;
  visionFallbackSkippedReason?: string;
  analyzedClusterCount?: number;
  visionAnalyzedClusterCount?: number;
  cached?: boolean;
  stale?: boolean;
};

export type StoredNotePageContent = {
  kind: 'bsnap-page-state';
  version: 1;
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  imageAnnotations: InkImageAnnotation[];
  bookmarked: boolean;
  photoReferenceCount: number;
  memoPageCount: number;
  handwritingRecognition?: HandwritingRecognitionState | null;
};

export function serializeNotePageContent(params: {
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  imageAnnotations?: InkImageAnnotation[];
  bookmarked?: boolean;
  photoReferenceCount?: number;
  memoPageCount?: number;
}) {
  const photoReferenceCount = Math.max(0, Math.floor(params.photoReferenceCount ?? 0));
  const memoPageCount = Math.max(0, Math.floor(params.memoPageCount ?? 0));
  return JSON.stringify({
    kind: 'bsnap-page-state',
    version: 1,
    inkStrokes: params.inkStrokes,
    textAnnotations: params.textAnnotations,
    imageAnnotations: params.imageAnnotations ?? [],
    bookmarked: Boolean(params.bookmarked),
    photoReferenceCount,
    memoPageCount,
  } satisfies StoredNotePageContent);
}

function normalizeCount(value: unknown) {
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (Array.isArray(value)) return value.length;
  return 0;
}

export function parseNotePageContent(content: string | null): StoredNotePageContent | null {
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as Partial<StoredNotePageContent> & Record<string, unknown>;
    if (parsed.kind !== 'bsnap-page-state' || parsed.version !== 1) return null;
    const bookmarkCount = normalizeCount(parsed.bookmarked)
      + normalizeCount(parsed.bookmarkCount)
      + normalizeCount(parsed.bookmark_count)
      + normalizeCount(parsed.bookmarks);
    return {
      kind: 'bsnap-page-state',
      version: 1,
      inkStrokes: Array.isArray(parsed.inkStrokes) ? parsed.inkStrokes : [],
      textAnnotations: Array.isArray(parsed.textAnnotations) ? parsed.textAnnotations : [],
      imageAnnotations: Array.isArray(parsed.imageAnnotations) ? parsed.imageAnnotations : [],
      bookmarked: bookmarkCount > 0,
      photoReferenceCount: Math.max(
        normalizeCount(parsed.photoReferenceCount),
        normalizeCount(parsed.photo_reference_count),
        normalizeCount(parsed.captureReferenceCount),
        normalizeCount(parsed.capture_reference_count),
        normalizeCount(parsed.pageCaptureReferences),
        normalizeCount(parsed.captureReferences),
        normalizeCount(parsed.photoReferences),
      ),
      memoPageCount: Math.max(
        normalizeCount(parsed.memoPageCount),
        normalizeCount(parsed.memo_page_count),
        normalizeCount(parsed.memoPages),
        normalizeCount(parsed.generatedMemoPages),
      ),
      handwritingRecognition: typeof parsed.handwritingRecognition === 'object' && parsed.handwritingRecognition !== null
        ? parsed.handwritingRecognition as HandwritingRecognitionState
        : null,
    };
  } catch {
    return null;
  }
}
