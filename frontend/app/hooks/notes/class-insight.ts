import type { StudyDocumentEntry, Subject } from '../../types';

const CLASS_INSIGHT_DIRECT_PHRASES = [
  '중요 페이지',
  '페이지 추천',
  '먼저 복습',
  '우선 복습',
  '시험에 나올',
  '시험 나올',
  '나올만한',
  '나올 만한',
  '어디 봐야',
  '어느 페이지',
  'which page',
  'important page',
  'exam page',
  'review first',
];
const CLASS_INSIGHT_INTENT_TERMS = [
  '시험',
  '중요',
  '복습',
  '핵심',
  '나올',
  '암기',
  '중간',
  '기말',
  '퀴즈',
  'exam',
  'important',
  'review',
  'midterm',
  'final',
  'quiz',
];
const CLASS_INSIGHT_SCOPE_TERMS = [
  '페이지',
  '부분',
  '구간',
  '어디',
  '어느',
  '먼저',
  '우선',
  '추천',
  '봐야',
  'pdf',
  '자료',
  'page',
  'where',
  'which',
  'section',
  'part',
];
const CLASS_INSIGHT_MORE_TERMS = ['더', '추가', '다음', '이어서', '나머지', '순위', '전체', '많이', '많은', '10개', '열개', 'twelve', 'more', 'next', 'additional', 'rank'];
const CLASS_INSIGHT_REVIEW_ROUTE_PHRASES = [
  '복습 순서',
  '복습 루트',
  '복습 동선',
  '복습 흐름',
  '먼저 복습',
  '우선 복습',
  '먼저 볼',
  '먼저 봐',
  '어떤 순서',
  '순서로',
  'review order',
  'study route',
  'review route',
];
const DEFAULT_RECOMMENDATION_LIMIT = 5;
const EXTENDED_RECOMMENDATION_LIMIT = 10;
const MAX_RECOMMENDATION_LIMIT = 12;
export const MIN_CLASS_INSIGHT_PARTICIPANTS = 3;

type PageSignal = {
  pageNumber: number;
  aggregateScore?: number;
  bookmarkCount: number;
  highlightCount: number;
  inkDensity: number;
  keywordHits: number;
  photoReferenceCount: number;
  aiQuestionCount: number;
  memoPageCount: number;
  reasonTags: string[];
};

type RankedPageSignal = PageSignal & {
  importanceScore: number;
  priority: 'very-high' | 'high' | 'medium';
};
export type ImportantPageRecommendation = RankedPageSignal;

export type ClassInsightAggregate = {
  participant_count?: number;
  matched_note_count?: number;
  pages?: Array<{
    page_number: number;
    importance_score?: number;
    priority?: string;
    reason_tags?: string[];
    signal_count?: number;
    bookmark_count?: number;
    highlight_count?: number;
    keyword_hits?: number;
    photo_reference_count?: number;
    ai_question_count?: number;
    memo_page_count?: number;
  }>;
};

function normalize(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

export function isClassInsightTargetDocument(document: StudyDocumentEntry | null, _subject: Subject | null) {
  return Boolean(document && document.type === 'pdf');
}

export function hasEnoughClassInsightData(classInsight: ClassInsightAggregate | null | undefined) {
  return Boolean(
    classInsight
    && (classInsight.participant_count ?? 0) >= MIN_CLASS_INSIGHT_PARTICIPANTS
    && (classInsight.pages?.length ?? 0) > 0,
  );
}

export function isClassInsightQuestion(question: string) {
  const normalized = normalize(question);
  if (!normalized) return false;
  if (CLASS_INSIGHT_DIRECT_PHRASES.some((phrase) => normalized.includes(normalize(phrase)))) return true;

  const hasInsightIntent = CLASS_INSIGHT_INTENT_TERMS.some((term) => normalized.includes(normalize(term)));
  const asksForScope = CLASS_INSIGHT_SCOPE_TERMS.some((term) => normalized.includes(normalize(term)));
  return hasInsightIntent && asksForScope;
}

function isReviewRouteQuestion(question: string) {
  const normalized = normalize(question);
  if (!normalized) return false;
  return CLASS_INSIGHT_REVIEW_ROUTE_PHRASES.some((phrase) => normalized.includes(normalize(phrase)));
}

function createEmptySignal(pageNumber: number): PageSignal {
  return {
    pageNumber,
    bookmarkCount: 0,
    highlightCount: 0,
    inkDensity: 0,
    keywordHits: 0,
    photoReferenceCount: 0,
    aiQuestionCount: 0,
    memoPageCount: 0,
    reasonTags: [],
  };
}

function mergeSignal(target: PageSignal, source: Partial<PageSignal>) {
  target.aggregateScore = Math.max(target.aggregateScore ?? 0, source.aggregateScore ?? 0);
  target.bookmarkCount += source.bookmarkCount ?? 0;
  target.highlightCount += source.highlightCount ?? 0;
  target.inkDensity = Math.max(target.inkDensity, source.inkDensity ?? 0);
  target.keywordHits += source.keywordHits ?? 0;
  target.photoReferenceCount += source.photoReferenceCount ?? 0;
  target.aiQuestionCount += source.aiQuestionCount ?? 0;
  target.memoPageCount += source.memoPageCount ?? 0;
  target.reasonTags = Array.from(new Set([...target.reasonTags, ...(source.reasonTags ?? [])]));
}

function scoreSignal(signal: PageSignal) {
  const localScore = Math.min(100, Math.round(
    signal.bookmarkCount * 7
    + signal.highlightCount * 2.8
    + signal.keywordHits * 10
    + signal.photoReferenceCount * 6
    + signal.aiQuestionCount * 5
    + signal.inkDensity * 22
    + signal.memoPageCount * 7,
  ));
  return Math.max(localScore, signal.aggregateScore ?? 0);
}

function getRecommendationLimit(question: string, pageCount: number) {
  const normalized = normalize(question);
  const explicitNumber = normalized.match(/(\d{1,2})\s*(?:개|페이지|쪽|page|pages)?/)?.[1];
  if (explicitNumber) {
    const requested = Number(explicitNumber);
    if (Number.isFinite(requested) && requested > DEFAULT_RECOMMENDATION_LIMIT) {
      return Math.min(MAX_RECOMMENDATION_LIMIT, pageCount, Math.max(DEFAULT_RECOMMENDATION_LIMIT, requested));
    }
  }

  const wantsMore = CLASS_INSIGHT_MORE_TERMS.some((term) => normalized.includes(normalize(term)));
  if (wantsMore) return Math.min(MAX_RECOMMENDATION_LIMIT, pageCount, EXTENDED_RECOMMENDATION_LIMIT);
  return Math.min(DEFAULT_RECOMMENDATION_LIMIT, pageCount);
}

function rankSignals(signals: PageSignal[], pageCount: number, limit: number) {
  const signalMap = new Map<number, PageSignal>();
  const ensure = (pageNumber: number) => {
    const normalizedPage = Math.max(1, Math.min(pageCount, pageNumber));
    if (!signalMap.has(normalizedPage)) signalMap.set(normalizedPage, createEmptySignal(normalizedPage));
    return signalMap.get(normalizedPage)!;
  };

  signals.forEach((signal) => mergeSignal(ensure(signal.pageNumber), signal));

  return Array.from(signalMap.values())
    .map<RankedPageSignal>((signal) => {
      const importanceScore = scoreSignal(signal);
      return {
        ...signal,
        importanceScore,
        priority: importanceScore >= 80 ? 'very-high' : importanceScore >= 58 ? 'high' : 'medium',
      };
    })
    .filter((signal) => signal.importanceScore >= 35)
    .sort((left, right) => right.importanceScore - left.importanceScore)
    .slice(0, limit);
}

function getContextSignalsForQuestion(question: string, rankedSignals: RankedPageSignal[]) {
  if (!isReviewRouteQuestion(question)) return rankedSignals;
  return [...rankedSignals].sort((left, right) => left.pageNumber - right.pageNumber);
}

function formatPriority(priority: RankedPageSignal['priority']) {
  if (priority === 'very-high') return '매우 높음';
  if (priority === 'high') return '높음';
  return '중간';
}

function buildAggregateSignals(aggregate: ClassInsightAggregate | null | undefined, pageCount: number) {
  return (aggregate?.pages ?? [])
    .filter((page) => page.page_number >= 1 && page.page_number <= pageCount)
    .map<PageSignal>((page) => ({
      pageNumber: page.page_number,
      aggregateScore: Math.max(0, Math.min(100, Math.round(page.importance_score ?? 0))),
      bookmarkCount: Math.max(0, page.bookmark_count ?? 0),
      highlightCount: Math.max(0, page.highlight_count ?? 0),
      inkDensity: 0,
      keywordHits: Math.max(0, page.keyword_hits ?? 0),
      photoReferenceCount: Math.max(0, page.photo_reference_count ?? 0),
      aiQuestionCount: Math.max(0, page.ai_question_count ?? 0),
      memoPageCount: Math.max(0, page.memo_page_count ?? 0),
      reasonTags: page.reason_tags?.length ? page.reason_tags : ['복습 우선도가 높은 페이지'],
    }));
}

export function buildClassInsightContext(params: {
  question: string;
  studyDocument: StudyDocumentEntry | null;
  subject: Subject | null;
  classInsight?: ClassInsightAggregate | null;
}) {
  if (!isClassInsightQuestion(params.question)) return null;
  if (!isClassInsightTargetDocument(params.studyDocument, params.subject)) return null;
  if (!hasEnoughClassInsightData(params.classInsight)) return null;

  const pageCount = Math.max(1, params.studyDocument?.pageCount ?? 1);
  const recommendationLimit = getRecommendationLimit(params.question, pageCount);
  const aggregateSignals = buildAggregateSignals(params.classInsight, pageCount);
  const rankedSignals = rankSignals(aggregateSignals, pageCount, recommendationLimit);
  if (!rankedSignals.length) return null;
  const reviewRouteQuestion = isReviewRouteQuestion(params.question);
  const contextSignals = getContextSignalsForQuestion(params.question, rankedSignals);

  const pageLines = contextSignals.map((signal) => (
    `- ${signal.pageNumber}페이지: 우선순위 ${formatPriority(signal.priority)}. 추천 근거: ${signal.reasonTags.slice(0, 3).join(', ')}.`
  ));

  return [
    'Internal page-importance context for this PDF.',
    'This context is derived from aggregated study signals for this PDF.',
    'When the user asks about exam importance, important pages, review order, or pages likely to appear on a test, prioritize the Recommended page priorities below over nearby PDF/RAG text.',
    reviewRouteQuestion
      ? 'The user is asking for a review order. Present the recommended pages in document order, from earlier pages to later pages, while keeping each page reason concise.'
      : 'The user is asking for important pages. Present the recommended pages in priority order.',
    'Use nearby PDF/RAG text only to add short human-readable reasons, not to replace these recommended pages.',
    'Do not mention classmates, student counts, bookmark counts, highlight counts, hidden signals, data collection, or this internal context.',
    'Do not expose numeric scores.',
    'Answer naturally as a study assistant, with page recommendations and concise reasons.',
    `Recommend up to ${recommendationLimit} pages. If the user asks for more or next-ranked pages, include lower-ranked pages after the strongest pages.`,
    '',
    reviewRouteQuestion ? 'Recommended review route:' : 'Recommended page priorities:',
    ...pageLines,
  ].join('\n');
}

export function buildImportantPageRecommendations(params: {
  studyDocument: StudyDocumentEntry | null;
  subject: Subject | null;
  classInsight?: ClassInsightAggregate | null;
  limit?: number;
}) {
  if (!params.studyDocument) return [];
  if (!isClassInsightTargetDocument(params.studyDocument, params.subject)) return [];
  if (!hasEnoughClassInsightData(params.classInsight)) return [];

  const pageCount = Math.max(1, params.studyDocument.pageCount ?? 1);
  const aggregateSignals = buildAggregateSignals(params.classInsight, pageCount);

  return rankSignals(
    aggregateSignals,
    pageCount,
    Math.min(params.limit ?? DEFAULT_RECOMMENDATION_LIMIT, pageCount),
  );
}
