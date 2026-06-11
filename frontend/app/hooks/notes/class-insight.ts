import type { StudyDocumentEntry, Subject } from '../../types';

const CLASS_INSIGHT_DIRECT_PHRASES = [
  '중요 페이지',
  '중요한 페이지',
  '중요하게 볼 페이지',
  '페이지 추천',
  '봐야 할 페이지',
  '봐야하는 페이지',
  '봐야 하는 페이지',
  '먼저 복습',
  '우선 복습',
  '시험에 나올 페이지',
  '시험 나올 페이지',
  '나올만한 페이지',
  '나올 만한 페이지',
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
const CURRENT_PAGE_REFERENCE_TERMS = [
  '현재 페이지',
  '보고있는 페이지',
  '보고 있는 페이지',
  '이 페이지',
  '이번 페이지',
  '현재 부분',
  '이 부분',
  '이 구역',
  '선택한 부분',
  '선택 영역',
  'current page',
  'this page',
  'this section',
  'selected region',
];
const PAGE_RECOMMENDATION_ACTION_TERMS = [
  '추천',
  '어디',
  '어느',
  '먼저',
  '우선',
  '봐야',
  '볼 페이지',
  '복습 순서',
  '복습 루트',
  'recommend',
  'which',
  'where',
  'review first',
  'review order',
  'study route',
];
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
const PAGE_MENTION_PATTERN = /((?:\d{1,3}\s*(?:[-~–—]\s*\d{1,3})?\s*(?:[,，]|\s*(?:및|와|과|그리고)\s*)?\s*)+)\s*(?:페이지|쪽|p(?:age)?\.?)/gi;
const PAGE_RANGE_PATTERN = /(\d{1,3})(?:\s*[-~–—]\s*(\d{1,3}))?/g;
export const MIN_CLASS_INSIGHT_PARTICIPANTS = 3;
const SEMANTIC_KEYWORD_WEIGHTS: Record<string, number> = {
  시험: 20,
  중요: 18,
  기말: 18,
  중간: 16,
  암기: 14,
  필수: 14,
};
const SEMANTIC_SYMBOL_WEIGHTS: Record<string, number> = {
  star: 22,
};

type PageSignal = {
  pageNumber: number;
  aggregateScore?: number;
  contentHint?: string | null;
  bookmarkCount: number;
  highlightCount: number;
  inkDensity: number;
  keywordHits: number;
  photoReferenceCount: number;
  aiQuestionCount: number;
  memoPageCount: number;
  handwritingKeywordHits: number;
  handwritingSymbolCount: number;
  semanticKeywords: string[];
  semanticSymbols: string[];
  reasonTags: string[];
};

type RankedPageSignal = PageSignal & {
  importanceScore: number;
  priority: 'very-high' | 'high' | 'medium';
};
export type ImportantPageRecommendation = RankedPageSignal;

type RecommendationGroup = {
  startPageNumber: number;
  endPageNumber: number;
  signals: RankedPageSignal[];
  importanceScore: number;
  priority: RankedPageSignal['priority'];
  reasonTags: string[];
  contentHints: string[];
};

export type ClassInsightAggregate = {
  participant_count?: number;
  matched_note_count?: number;
  pages?: Array<{
    page_number: number;
    importance_score?: number;
    priority?: string;
    reason_tags?: string[];
    content_hint?: string | null;
    signal_count?: number;
    bookmark_count?: number;
    highlight_count?: number;
    keyword_hits?: number;
    photo_reference_count?: number;
    ai_question_count?: number;
    memo_page_count?: number;
    handwriting_keyword_hits?: number;
    handwriting_symbol_count?: number;
    semantic_keywords?: string[];
    semantic_symbols?: string[];
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
  const refersToCurrentPage = CURRENT_PAGE_REFERENCE_TERMS.some((term) => normalized.includes(normalize(term)));
  const asksForRecommendationAction = PAGE_RECOMMENDATION_ACTION_TERMS.some((term) => normalized.includes(normalize(term)));
  if (refersToCurrentPage && !asksForRecommendationAction) return false;
  if (CLASS_INSIGHT_DIRECT_PHRASES.some((phrase) => normalized.includes(normalize(phrase)))) return true;

  const hasInsightIntent = CLASS_INSIGHT_INTENT_TERMS.some((term) => normalized.includes(normalize(term)));
  const asksForScope = CLASS_INSIGHT_SCOPE_TERMS.some((term) => normalized.includes(normalize(term)));
  return hasInsightIntent && asksForScope && asksForRecommendationAction;
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
    handwritingKeywordHits: 0,
    handwritingSymbolCount: 0,
    semanticKeywords: [],
    semanticSymbols: [],
    reasonTags: [],
  };
}

function mergeSignal(target: PageSignal, source: Partial<PageSignal>) {
  target.aggregateScore = Math.max(target.aggregateScore ?? 0, source.aggregateScore ?? 0);
  target.contentHint = target.contentHint || source.contentHint || null;
  target.bookmarkCount += source.bookmarkCount ?? 0;
  target.highlightCount += source.highlightCount ?? 0;
  target.inkDensity = Math.max(target.inkDensity, source.inkDensity ?? 0);
  target.keywordHits += source.keywordHits ?? 0;
  target.photoReferenceCount += source.photoReferenceCount ?? 0;
  target.aiQuestionCount += source.aiQuestionCount ?? 0;
  target.memoPageCount += source.memoPageCount ?? 0;
  target.handwritingKeywordHits += source.handwritingKeywordHits ?? 0;
  target.handwritingSymbolCount += source.handwritingSymbolCount ?? 0;
  target.semanticKeywords = Array.from(new Set([...target.semanticKeywords, ...(source.semanticKeywords ?? [])]));
  target.semanticSymbols = Array.from(new Set([...target.semanticSymbols, ...(source.semanticSymbols ?? [])]));
  target.reasonTags = Array.from(new Set([...target.reasonTags, ...(source.reasonTags ?? [])]));
}

function scoreSignal(signal: PageSignal) {
  const semanticKeywordScore = Math.min(60, signal.semanticKeywords.reduce((sum, keyword) => sum + (SEMANTIC_KEYWORD_WEIGHTS[keyword] ?? 0), 0));
  const semanticSymbolScore = Math.min(22, signal.semanticSymbols.reduce((sum, symbol) => sum + (SEMANTIC_SYMBOL_WEIGHTS[symbol] ?? 0), 0));
  const localScore = Math.min(100, Math.round(
    signal.bookmarkCount * 8
    + Math.min(10, signal.highlightCount * 2)
    + signal.keywordHits * 4
    + signal.photoReferenceCount * 4
    + signal.aiQuestionCount * 6
    + signal.inkDensity * 6
    + signal.memoPageCount * 7
    + semanticKeywordScore
    + semanticSymbolScore,
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

function isMoreRecommendationQuestion(question: string) {
  const normalized = normalize(question);
  return CLASS_INSIGHT_MORE_TERMS.some((term) => normalized.includes(normalize(term)));
}

export function extractRecommendedPageNumbersFromText(text: string, pageCount?: number | null) {
  const pages = new Set<number>();
  const maxPage = Math.max(1, pageCount ?? Number.MAX_SAFE_INTEGER);
  const addPage = (pageNumber: number) => {
    if (!Number.isFinite(pageNumber)) return;
    if (pageNumber < 1 || pageNumber > maxPage) return;
    pages.add(pageNumber);
  };

  let mentionMatch: RegExpExecArray | null;
  PAGE_MENTION_PATTERN.lastIndex = 0;
  while ((mentionMatch = PAGE_MENTION_PATTERN.exec(text)) !== null) {
    const pageChunk = mentionMatch[1] ?? '';
    let rangeMatch: RegExpExecArray | null;
    PAGE_RANGE_PATTERN.lastIndex = 0;
    while ((rangeMatch = PAGE_RANGE_PATTERN.exec(pageChunk)) !== null) {
      const start = Number(rangeMatch[1]);
      const end = rangeMatch[2] ? Number(rangeMatch[2]) : start;
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const rangeStart = Math.max(1, Math.min(start, end));
      const rangeEnd = Math.min(maxPage, Math.max(start, end));
      for (let pageNumber = rangeStart; pageNumber <= rangeEnd; pageNumber += 1) {
        addPage(pageNumber);
      }
    }
  }

  return pages;
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
    .filter((signal) => signal.importanceScore > 0)
    .sort((left, right) => right.importanceScore - left.importanceScore)
    .slice(0, limit);
}

function getContextSignalsForQuestion(question: string, rankedSignals: RankedPageSignal[]) {
  if (!isReviewRouteQuestion(question)) return rankedSignals;
  return [...rankedSignals].sort((left, right) => left.pageNumber - right.pageNumber);
}

function groupAdjacentSignals(signals: RankedPageSignal[]) {
  const sortedSignals = [...signals].sort((left, right) => left.pageNumber - right.pageNumber);
  const groups: RankedPageSignal[][] = [];
  sortedSignals.forEach((signal) => {
    const current = groups[groups.length - 1];
    const previous = current?.[current.length - 1];
    if (current && previous && signal.pageNumber === previous.pageNumber + 1) {
      current.push(signal);
      return;
    }
    groups.push([signal]);
  });

  return groups.map<RecommendationGroup>((group) => {
    const importanceScore = Math.max(...group.map((signal) => signal.importanceScore));
    return {
      startPageNumber: group[0].pageNumber,
      endPageNumber: group[group.length - 1].pageNumber,
      signals: group,
      importanceScore,
      priority: importanceScore >= 80 ? 'very-high' : importanceScore >= 58 ? 'high' : 'medium',
      reasonTags: Array.from(new Set(group.flatMap((signal) => signal.reasonTags))).slice(0, 4),
      contentHints: Array.from(new Set(group.map((signal) => signal.contentHint).filter(Boolean) as string[])).slice(0, 2),
    };
  });
}

function getContextGroupsForQuestion(question: string, rankedSignals: RankedPageSignal[]) {
  const groups = groupAdjacentSignals(rankedSignals);
  if (isReviewRouteQuestion(question)) {
    return groups.sort((left, right) => left.startPageNumber - right.startPageNumber);
  }
  return groups.sort((left, right) => (
    right.importanceScore - left.importanceScore
    || left.startPageNumber - right.startPageNumber
  ));
}

function formatPageLabel(group: RecommendationGroup) {
  return group.startPageNumber === group.endPageNumber
    ? `${group.startPageNumber}페이지`
    : `${group.startPageNumber}-${group.endPageNumber}페이지`;
}

function formatContentHint(group: RecommendationGroup) {
  if (!group.contentHints.length) return '';
  return ` 본문 힌트: ${group.contentHints.join(' / ')}.`;
}

function formatNaturalRecommendationReason(group: RecommendationGroup) {
  const keywords = new Set(group.signals.flatMap((signal) => signal.semanticKeywords));
  const symbols = new Set(group.signals.flatMap((signal) => signal.semanticSymbols));
  const reasonTags = new Set(group.reasonTags);
  const sentences: string[] = [];

  if (keywords.has('시험') || keywords.has('기말') || keywords.has('중간')) {
    sentences.push('시험 대비에 먼저 확인하기 좋은 페이지입니다');
  }
  if (keywords.has('중요') || keywords.has('암기') || keywords.has('필수')) {
    sentences.push('핵심 내용을 빠르게 정리하기 좋은 구간입니다');
  }
  if (symbols.has('star')) {
    sentences.push('복습 우선도가 높게 잡힌 페이지입니다');
  }
  if (reasonTags.has('여러 학생의 중요 표시가 겹친 페이지') || reasonTags.has('여러 학습 신호가 함께 모인 페이지')) {
    sentences.push('먼저 짚고 넘어가기 좋은 구간입니다');
  }

  return Array.from(new Set(sentences)).slice(0, 3).join('. ') || '복습 우선도가 높은 페이지입니다';
}

function buildAggregateSignals(aggregate: ClassInsightAggregate | null | undefined, pageCount: number) {
  return (aggregate?.pages ?? [])
    .filter((page) => page.page_number >= 1 && page.page_number <= pageCount)
    .map<PageSignal>((page) => ({
      pageNumber: page.page_number,
      aggregateScore: Math.max(0, Math.min(100, Math.round(page.importance_score ?? 0))),
      contentHint: page.content_hint ?? null,
      bookmarkCount: Math.max(0, page.bookmark_count ?? 0),
      highlightCount: Math.max(0, page.highlight_count ?? 0),
      inkDensity: 0,
      keywordHits: Math.max(0, page.keyword_hits ?? 0),
      photoReferenceCount: Math.max(0, page.photo_reference_count ?? 0),
      aiQuestionCount: Math.max(0, page.ai_question_count ?? 0),
      memoPageCount: Math.max(0, page.memo_page_count ?? 0),
      handwritingKeywordHits: Math.max(0, page.handwriting_keyword_hits ?? 0),
      handwritingSymbolCount: Math.max(0, page.handwriting_symbol_count ?? 0),
      semanticKeywords: page.semantic_keywords ?? [],
      semanticSymbols: page.semantic_symbols ?? [],
      reasonTags: page.reason_tags?.length ? page.reason_tags : ['복습 우선도가 높은 페이지'],
    }));
}

export function buildClassInsightContext(params: {
  question: string;
  studyDocument: StudyDocumentEntry | null;
  subject: Subject | null;
  classInsight?: ClassInsightAggregate | null;
  previouslyRecommendedPageNumbers?: Iterable<number> | null;
}) {
  if (!isClassInsightQuestion(params.question)) return null;
  if (!isClassInsightTargetDocument(params.studyDocument, params.subject)) return null;
  if (!hasEnoughClassInsightData(params.classInsight)) return null;

  const pageCount = Math.max(1, params.studyDocument?.pageCount ?? 1);
  const recommendationLimit = getRecommendationLimit(params.question, pageCount);
  const aggregateSignals = buildAggregateSignals(params.classInsight, pageCount);
  const wantsMoreRecommendations = isMoreRecommendationQuestion(params.question);
  const previouslyRecommendedPageNumbers = new Set(
    Array.from(params.previouslyRecommendedPageNumbers ?? [])
      .filter((pageNumber) => pageNumber >= 1 && pageNumber <= pageCount),
  );
  const rankedSignals = rankSignals(aggregateSignals, pageCount, recommendationLimit);
  if (!rankedSignals.length) return null;
  const reviewRouteQuestion = isReviewRouteQuestion(params.question);
  const remainingSignals = wantsMoreRecommendations && previouslyRecommendedPageNumbers.size > 0
    ? rankedSignals.filter((signal) => !previouslyRecommendedPageNumbers.has(signal.pageNumber))
    : rankedSignals;

  if (!remainingSignals.length) {
    return [
      'Internal page-importance context for this PDF.',
      'The user asked for more important pages, but every ranked page currently available from this PDF has already been recommended in this conversation.',
      'Do not include a 추천 페이지 section, page recommendation card, page list, or page links.',
      'Do not mention the current page, excluded pages, remaining pages, or why no more pages are shown.',
      'Reply with this exact Korean sentence only: 시험 대비는 위에서 추천한 페이지들을 중심으로 복습하시면 좋겠습니다.',
      'Do not mention classmates, student counts, bookmark counts, highlight counts, hidden signals, data collection, handwriting analysis, or this internal context.',
      'Do not expose numeric scores.',
    ].join('\n');
  }

  const contextGroups = getContextGroupsForQuestion(params.question, getContextSignalsForQuestion(params.question, remainingSignals));

  const pageLines = contextGroups.map((group) => (
    `- ${formatPageLabel(group)}: ${formatNaturalRecommendationReason(group)}.${formatContentHint(group)}`
  ));

  return [
    'Internal page-importance context for this PDF.',
    'This context is derived from aggregated study signals for this PDF.',
    'When the user asks about exam importance, important pages, review order, or pages likely to appear on a test, prioritize the Recommended page priorities below over nearby PDF/RAG text.',
    'Prioritize strong semantic handwriting signals: handwritten 중요, 시험, 기말, 중간, 암기, 필수, and visual star marks. Treat check/circle/box/underline/arrow-like marks as weak debug-only signals unless paired with strong text/star signals.',
    'Do not explicitly say that a page was selected because of handwriting, star marks, recognized keywords, classmates, shared notes, aggregated data, or hidden study signals. Phrase reasons as natural review guidance only.',
    'Do not mention the currently viewed page, and do not explain that the current page was excluded. Just recommend the next useful pages.',
    reviewRouteQuestion
      ? 'The user is asking for a review order. Present the recommended pages in document order, from earlier pages to later pages, while keeping each page reason concise.'
      : 'The user is asking for important pages. Present the recommended pages in priority order.',
    'If adjacent recommended pages are shown as a page range, keep them together as one recommendation card and explain the shared concept briefly.',
    'Use nearby PDF/RAG text only to add short human-readable reasons, not to replace these recommended pages.',
    'Do not mention classmates, student counts, bookmark counts, highlight counts, hidden signals, data collection, handwriting analysis, or this internal context.',
    'Do not expose numeric scores.',
    'Answer naturally as a study assistant, with page recommendations and concise reasons such as exam preparation priority, quick review value, and useful review order.',
    wantsMoreRecommendations && previouslyRecommendedPageNumbers.size > 0
      ? 'Recommend only the remaining pages below. Do not repeat pages already recommended in this conversation.'
      : `Recommend up to ${recommendationLimit} pages. If the user asks for more or next-ranked pages, include lower-ranked pages after the strongest pages.`,
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
