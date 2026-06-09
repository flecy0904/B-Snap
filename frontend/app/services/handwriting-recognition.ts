import { NativeModules, Platform } from 'react-native';
import type { InkStroke } from '../ui-types';
import {
  clusterInkStrokesForRecognition,
  prepareClusterStrokesForRecognition,
  type InkRecognitionCluster,
} from './handwriting-clusters';

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

const STRONG_STUDY_KEYWORDS = ['중요', '시험', '중간', '기말', '암기', '필수'] as const;
type StrongStudyKeyword = typeof STRONG_STUDY_KEYWORDS[number];

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

const HANGUL_BASE = 0xac00;
const HANGUL_END = 0xd7a3;
const HANGUL_MEDIAL_COUNT = 21;
const HANGUL_FINAL_COUNT = 28;
const SIMILAR_MEDIALS = [
  new Set([8, 12]),
  new Set([13, 17]),
  new Set([4, 6]),
  new Set([0, 2]),
  new Set([18, 19]),
];

const MLKIT_CANDIDATE_RESCUES: Record<StrongStudyKeyword, string[]> = {
  중요: ['중오', '즁요', '증요', '종요', '중여', '쥬요', '충', '쌩'],
  시험: ['시혐', '시헙', '시엄', '시함', '시염'],
  중간: ['중칸', '중긴', '증간'],
  기말: ['기맣', '기마', '가말', '거말', '기발', '말', '매', '마'],
  암기: ['암가', '암키', '임기', '암끼'],
  필수: ['필쑤', '필슈'],
};

type KeywordRecognitionContext = {
  bbox?: { width: number; height: number };
  strokeCount?: number;
  pointCount?: number;
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

function normalizeKeywords(text: string, candidates: string[] = [], context?: KeywordRecognitionContext) {
  const haystack = [text, ...candidates].join(' ').toLowerCase();
  const keywords: string[] = [];
  CANONICAL_KEYWORDS.forEach((keyword) => {
    if (haystack.includes(keyword.toLowerCase())) keywords.push(keyword);
  });
  Object.entries(KEYWORD_VARIANTS).forEach(([variant, canonical]) => {
    if (haystack.includes(variant.toLowerCase())) keywords.push(canonical);
  });
  [text, ...candidates].forEach((value) => {
    const tokens = value.toLowerCase().match(/[a-zA-Z가-힣0-9]+/g) ?? [];
    tokens.forEach((token) => {
      const normalizedToken = normalizeKeywordText(token);
      STRONG_STUDY_KEYWORDS.forEach((keyword) => {
        const normalizedKeyword = normalizeKeywordText(keyword);
        const threshold = normalizedKeyword.length <= 2 ? 0.84 : 0.82;
        const matched = keywordWindows(normalizedToken, normalizedKeyword.length).some((window) => (
          hangulKeywordSimilarity(window, normalizedKeyword) >= threshold
        ));
        if (matched) keywords.push(keyword);
      });
    });
  });
  Object.entries(MLKIT_CANDIDATE_RESCUES).forEach(([keyword, variants]) => {
    const canonical = keyword as StrongStudyKeyword;
    const canonicalLength = normalizeKeywordText(canonical).length;
    const matched = candidates.some((candidate) => {
      const normalizedCandidate = normalizeKeywordText(candidate);
      if (!normalizedCandidate) return false;
      return variants.some((variant) => {
        const normalizedVariant = normalizeKeywordText(variant);
        if (normalizedCandidate !== normalizedVariant) return false;
        if (normalizedCandidate.length >= canonicalLength) return true;
        return looksLikeMultiSyllableInk(context);
      });
    });
    if (matched) keywords.push(canonical);
  });
  return Array.from(new Set(keywords));
}

function normalizeKeywordText(value: string) {
  return value.trim().toLowerCase().replace(/[^0-9a-zA-Z가-힣]+/g, '');
}

function decomposeHangulSyllable(char: string) {
  const code = char.charCodeAt(0);
  if (code < HANGUL_BASE || code > HANGUL_END) return null;
  const offset = code - HANGUL_BASE;
  return {
    initial: Math.floor(offset / (HANGUL_MEDIAL_COUNT * HANGUL_FINAL_COUNT)),
    medial: Math.floor((offset % (HANGUL_MEDIAL_COUNT * HANGUL_FINAL_COUNT)) / HANGUL_FINAL_COUNT),
    final: offset % HANGUL_FINAL_COUNT,
  };
}

function similarMedial(left: number, right: number) {
  return SIMILAR_MEDIALS.some((group) => group.has(left) && group.has(right));
}

function hangulSyllableSimilarity(left: string, right: string) {
  if (left === right) return 1;
  const leftParts = decomposeHangulSyllable(left);
  const rightParts = decomposeHangulSyllable(right);
  if (!leftParts || !rightParts) return 0;
  let score = 0;
  if (leftParts.initial === rightParts.initial) score += 0.45;
  if (leftParts.medial === rightParts.medial) score += 0.35;
  else if (similarMedial(leftParts.medial, rightParts.medial)) score += 0.28;
  if (leftParts.final === rightParts.final) score += 0.2;
  return score;
}

function hangulKeywordSimilarity(left: string, right: string) {
  if (!left || left.length !== right.length) return 0;
  const total = Array.from(left).reduce((sum, char, index) => (
    sum + hangulSyllableSimilarity(char, Array.from(right)[index] ?? '')
  ), 0);
  return total / right.length;
}

function keywordWindows(value: string, length: number) {
  if (length <= 0 || value.length < length) return [];
  if (value.length === length) return [value];
  return Array.from({ length: value.length - length + 1 }, (_, index) => value.slice(index, index + length));
}

function looksLikeMultiSyllableInk(context?: KeywordRecognitionContext) {
  if (!context?.bbox) return false;
  const width = Math.max(0, context.bbox.width);
  const height = Math.max(0, context.bbox.height);
  const strokeCount = context.strokeCount ?? 0;
  const pointCount = context.pointCount ?? 0;
  if (width < 24 || height < 12 || pointCount < 8) return false;
  return width >= height * 0.78 || strokeCount >= 3;
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

function getOptionPageNumber(options?: Record<string, unknown>) {
  const value = options?.pageNumber;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeClusterFromResult(
  cluster: InkRecognitionCluster,
  result: HandwritingRecognitionResult,
): RecognizedCluster | null {
  const candidates = Array.isArray(result.candidates)
    ? result.candidates.filter((candidate) => candidate && typeof candidate.text === 'string')
    : [];
  const text = result.text || candidates[0]?.text || '';
  const keywords = normalizeKeywords(text, candidates.map((candidate) => candidate.text), {
    bbox: cluster.bbox,
    strokeCount: cluster.strokeCount,
    pointCount: cluster.pointCount,
  });
  const mergedKeywords = Array.from(new Set([
    ...(Array.isArray(result.keywords) ? result.keywords : []),
    ...keywords,
  ]));
  const hasUsefulResult = Boolean(text || candidates.length || mergedKeywords.length);

  if (!hasUsefulResult) return null;

  return {
    id: cluster.id,
    pageNumber: cluster.pageNumber,
    bbox: cluster.bbox,
    text,
    candidates,
    keywords: mergedKeywords,
    symbols: Array.isArray(result.symbols) ? result.symbols : [],
    confidence: typeof result.confidence === 'number' ? Math.max(0, Math.min(1, result.confidence)) : 0,
    source: 'mlkit-digital-ink',
  };
}

function buildClusterRecognitionResult(
  clusters: RecognizedCluster[],
  detail?: string,
  modelState?: HandwritingRecognitionResult['modelState'],
): HandwritingRecognitionResult {
  const text = clusters
    .map((cluster) => cluster.text)
    .filter(Boolean)
    .join('\n');
  const candidates = clusters
    .flatMap((cluster) => cluster.candidates)
    .filter((candidate, index, array) => (
      index === array.findIndex((other) => other.text === candidate.text)
    ));
  const keywords = Array.from(new Set([
    ...clusters.flatMap((cluster) => cluster.keywords),
    ...normalizeKeywords(text, candidates.map((candidate) => candidate.text)),
  ]));
  const confidenceValues = clusters
    .map((cluster) => cluster.confidence)
    .filter((confidence) => typeof confidence === 'number' && confidence > 0);
  const confidence = confidenceValues.length
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 0;

  return {
    status: 'ready',
    engine: 'mlkit-digital-ink',
    text,
    keywords,
    symbols: Array.from(new Set(clusters.flatMap((cluster) => cluster.symbols))),
    confidence: Math.max(0, Math.min(1, confidence)),
    clusters,
    candidates,
    modelState,
    detail,
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

export async function recognizeKoreanHandwritingByClusters(
  strokes: InkStroke[],
  options?: Record<string, unknown>,
): Promise<HandwritingRecognitionResult> {
  const pageNumber = getOptionPageNumber(options);
  const clusters = clusterInkStrokesForRecognition(strokes, { pageNumber });

  if (!clusters.length) {
    const fallback = await recognizeKoreanHandwriting(strokes, options);
    return {
      ...fallback,
      detail: fallback.detail || 'cluster recognition skipped: no recognizable text clusters; used page-level fallback',
    };
  }

  const recognizedClusters: RecognizedCluster[] = [];
  let latestModelState: HandwritingRecognitionResult['modelState'];
  let unavailableResult: HandwritingRecognitionResult | null = null;

  for (const cluster of clusters) {
    const preparedCluster = prepareClusterStrokesForRecognition(cluster);
    const result = await recognizeKoreanHandwriting(preparedCluster.strokes, {
      ...(options ?? {}),
      pageNumber: cluster.pageNumber,
      clusterId: cluster.id,
      clusterBbox: cluster.bbox,
      writingAreaWidth: preparedCluster.writingArea.width,
      writingAreaHeight: preparedCluster.writingArea.height,
      recognitionCoordinateSpace: 'cluster-local',
    });
    latestModelState = result.modelState ?? latestModelState;

    if (result.status !== 'ready') {
      if (result.status === 'unavailable' || (result.modelState && result.modelState !== 'ready')) {
        unavailableResult = result;
        break;
      }
      continue;
    }

    const normalizedCluster = normalizeClusterFromResult(cluster, result);
    if (normalizedCluster) recognizedClusters.push(normalizedCluster);
  }

  if (!recognizedClusters.length) {
    const fallback = await recognizeKoreanHandwriting(strokes, options);
    return {
      ...fallback,
      detail: fallback.detail || unavailableResult?.detail || `cluster recognition found ${clusters.length} clusters but produced no candidates; used page-level fallback`,
    };
  }

  return buildClusterRecognitionResult(
    recognizedClusters,
    `cluster recognition completed: ${recognizedClusters.length}/${clusters.length} clusters`,
    latestModelState ?? 'ready',
  );
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
