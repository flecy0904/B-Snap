import { NativeModules, Platform } from 'react-native';
import type { InkStroke } from '../ui-types';

export type RecognitionCandidate = {
  text: string;
  confidence?: number;
};

export type RecognizedCluster = {
  id: string;
  pageNumber: number;
  bbox: { x: number; y: number; width: number; height: number };
  text: string;
  candidates: RecognitionCandidate[];
  keywords: string[];
  symbols: string[];
  confidence: number;
  source: 'mlkit-digital-ink' | 'geometry' | 'openai-vision' | 'hybrid';
};

export type HandwritingRecognitionResult = {
  status: 'ready' | 'unavailable' | 'failed';
  engine: string;
  text: string;
  keywords: string[];
  symbols: string[];
  confidence: number;
  clusters: RecognizedCluster[];
  candidates?: RecognitionCandidate[];
  modelState?: 'missing' | 'downloading' | 'ready' | 'failed' | string;
  detail?: string;
};

export type GestureRecognitionResult = {
  status: 'ready' | 'unavailable' | 'failed';
  engine: string;
  symbols: string[];
  confidence: number;
  detail?: string;
};

export type HandwritingRecognitionAvailabilityResult = {
  available: boolean;
  state?: 'missing' | 'downloading' | 'ready' | 'failed' | string;
  detail?: string;
};

export type MlKitHandwritingDebugState = {
  available: boolean | null;
  modelReady: boolean | null;
  modelState?: 'missing' | 'downloading' | 'ready' | 'failed' | string;
  busy: boolean;
  detail?: string;
  result?: HandwritingRecognitionResult | null;
};

type NativeHandwritingRecognitionModule = {
  isAvailable?: () => Promise<HandwritingRecognitionAvailabilityResult>;
  ensureKoreanModel?: () => Promise<HandwritingRecognitionAvailabilityResult>;
  recognizeKoreanInk?: (
    strokes: InkStroke[],
    options?: Record<string, unknown>,
  ) => Promise<HandwritingRecognitionResult>;
  recognizeGestureInk?: (
    strokes: InkStroke[],
    options?: Record<string, unknown>,
  ) => Promise<GestureRecognitionResult>;
};

const nativeModule = Platform.OS === 'ios'
  ? NativeModules.BsnHandwritingRecognition as NativeHandwritingRecognitionModule | undefined
  : undefined;

const CANONICAL_KEYWORDS = [
  '중요',
  '시험',
  '중간',
  '기말',
  '퀴즈',
  '암기',
  '필수',
  '공식',
  '주의',
  '체크',
  '별표',
  '복습',
  '정리',
] as const;

const KEYWORD_VARIANTS: Record<string, typeof CANONICAL_KEYWORDS[number]> = {
  시험범위: '시험',
  기말고사: '기말',
  중간고사: '중간',
  중요함: '중요',
  중요표시: '중요',
  외우기: '암기',
  외워: '암기',
  암기할것: '암기',
  나옴: '시험',
  나온다: '시험',
  나올듯: '시험',
  출제: '시험',
  출제예상: '시험',
  별: '별표',
  별표시: '별표',
  check: '체크',
};

function unavailableHandwriting(detail = 'native handwriting recognition module is unavailable'): HandwritingRecognitionResult {
  return {
    status: 'unavailable',
    engine: 'mlkit-digital-ink',
    text: '',
    keywords: [],
    symbols: [],
    confidence: 0,
    clusters: [],
    candidates: [],
    detail,
  };
}

function unavailableGesture(detail = 'native gesture recognition module is unavailable'): GestureRecognitionResult {
  return {
    status: 'unavailable',
    engine: 'mlkit-digital-ink',
    symbols: [],
    confidence: 0,
    detail,
  };
}

function normalizeKeywords(text: string, candidates: string[] = []) {
  const haystack = [text, ...candidates].join(' ').toLowerCase();
  const keywords: string[] = [];
  CANONICAL_KEYWORDS.forEach((keyword) => {
    if (haystack.includes(keyword.toLowerCase())) keywords.push(keyword);
  });
  Object.entries(KEYWORD_VARIANTS).forEach(([variant, canonical]) => {
    if (haystack.includes(variant.toLowerCase())) keywords.push(canonical);
  });
  return Array.from(new Set(keywords));
}

function normalizeRecognitionResult(value: HandwritingRecognitionResult): HandwritingRecognitionResult {
  const candidates = Array.isArray(value.candidates)
    ? value.candidates.filter((candidate) => candidate && typeof candidate.text === 'string')
    : [];
  const text = typeof value.text === 'string' ? value.text : candidates[0]?.text ?? '';
  const keywords = normalizeKeywords(text, candidates.map((candidate) => candidate.text));
  return {
    status: value.status === 'ready' || value.status === 'failed' ? value.status : 'unavailable',
    engine: value.engine || 'mlkit-digital-ink',
    text,
    keywords: Array.from(new Set([...(Array.isArray(value.keywords) ? value.keywords : []), ...keywords])),
    symbols: Array.isArray(value.symbols) ? value.symbols : [],
    confidence: typeof value.confidence === 'number' ? Math.max(0, Math.min(1, value.confidence)) : 0,
    clusters: Array.isArray(value.clusters) ? value.clusters : [],
    candidates,
    modelState: value.modelState,
    detail: value.detail,
  };
}

export async function isHandwritingRecognitionAvailable(): Promise<boolean> {
  if (!nativeModule?.isAvailable) return false;
  try {
    const result = await nativeModule.isAvailable();
    return Boolean(result.available);
  } catch {
    return false;
  }
}

export async function getHandwritingRecognitionAvailability(): Promise<HandwritingRecognitionAvailabilityResult> {
  if (!nativeModule?.isAvailable) {
    return { available: false, state: 'missing', detail: Platform.OS === 'web' ? 'web fallback' : 'native module unavailable' };
  }
  try {
    return await nativeModule.isAvailable();
  } catch (error) {
    return { available: false, state: 'failed', detail: error instanceof Error ? error.message : 'availability check failed' };
  }
}

export async function ensureKoreanHandwritingModel(): Promise<HandwritingRecognitionAvailabilityResult> {
  if (!nativeModule?.ensureKoreanModel) {
    return { available: false, state: 'missing', detail: Platform.OS === 'web' ? 'web fallback' : 'native module unavailable' };
  }
  try {
    return await nativeModule.ensureKoreanModel();
  } catch (error) {
    return { available: false, state: 'failed', detail: error instanceof Error ? error.message : 'model preparation failed' };
  }
}

export async function recognizeKoreanHandwriting(
  strokes: InkStroke[],
  options?: Record<string, unknown>,
): Promise<HandwritingRecognitionResult> {
  if (!nativeModule?.recognizeKoreanInk) return unavailableHandwriting();
  try {
    return normalizeRecognitionResult(await nativeModule.recognizeKoreanInk(strokes, options));
  } catch (error) {
    return {
      ...unavailableHandwriting(error instanceof Error ? error.message : 'recognition failed'),
      status: 'failed',
    };
  }
}

export async function recognizeGestureSymbols(
  strokes: InkStroke[],
  options?: Record<string, unknown>,
): Promise<GestureRecognitionResult> {
  if (!nativeModule?.recognizeGestureInk) return unavailableGesture();
  try {
    return await nativeModule.recognizeGestureInk(strokes, options);
  } catch (error) {
    return {
      ...unavailableGesture(error instanceof Error ? error.message : 'gesture recognition failed'),
      status: 'failed',
    };
  }
}
