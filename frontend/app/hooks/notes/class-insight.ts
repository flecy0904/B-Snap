import type { BookmarkedPage, GeneratedWorkspacePage, PageCaptureReference, StudyDocumentEntry, Subject } from '../../types';
import type { InkStroke, InkTextAnnotation } from '../../ui-types';

const CLASS_INSIGHT_SUBJECT_TERMS = [
  '컴퓨터네트워크',
  '컴퓨터 네트워크',
  'computer networks',
  'computer network',
  'computer-networks',
];
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
const IMPORTANT_NOTE_KEYWORDS = ['시험', '중요', '암기', '별표', '나온다', '나올', '퀴즈', '중간', '기말', '외우', '필수'];

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

const DEMO_CLASS_SIGNALS: PageSignal[] = [
  {
    pageNumber: 5,
    bookmarkCount: 4,
    highlightCount: 9,
    inkDensity: 0.46,
    keywordHits: 2,
    photoReferenceCount: 1,
    aiQuestionCount: 2,
    memoPageCount: 0,
    reasonTags: ['초반 핵심 개념', '뒤 개념을 이해하는 기준점'],
  },
  {
    pageNumber: 13,
    bookmarkCount: 8,
    highlightCount: 18,
    inkDensity: 0.82,
    keywordHits: 4,
    photoReferenceCount: 2,
    aiQuestionCount: 3,
    memoPageCount: 1,
    reasonTags: ['시험 대비 우선순위 높음', '수업 중 강조된 흔적', '개념 연결 밀도 높음'],
  },
  {
    pageNumber: 21,
    bookmarkCount: 6,
    highlightCount: 15,
    inkDensity: 0.68,
    keywordHits: 3,
    photoReferenceCount: 1,
    aiQuestionCount: 4,
    memoPageCount: 1,
    reasonTags: ['복습 질문이 많이 생기는 구간', '핵심 정의와 예시 연결'],
  },
  {
    pageNumber: 32,
    bookmarkCount: 5,
    highlightCount: 12,
    inkDensity: 0.62,
    keywordHits: 3,
    photoReferenceCount: 3,
    aiQuestionCount: 2,
    memoPageCount: 0,
    reasonTags: ['사진 자료와 함께 복습할 가치 있음', '교수자 추가 설명 가능성'],
  },
];

function normalize(value: string | null | undefined) {
  return (value ?? '').trim().toLowerCase();
}

export function isClassInsightTargetDocument(document: StudyDocumentEntry | null, subject: Subject | null) {
  if (!document || document.type !== 'pdf') return false;

  const subjectText = normalize(subject?.name);
  const titleText = normalize(document.title);
  const fileText = typeof document.file === 'object' && document.file && 'uri' in document.file
    ? normalize(document.file.uri)
    : normalize(typeof document.file === 'string' ? document.file : '');

  return CLASS_INSIGHT_SUBJECT_TERMS.some((term) => {
    const normalizedTerm = normalize(term);
    return subjectText.includes(normalizedTerm)
      || titleText.includes(normalizedTerm)
      || fileText.includes(normalizedTerm);
  });
}

function isClassInsightQuestion(question: string) {
  const normalized = normalize(question);
  if (!normalized) return false;
  if (CLASS_INSIGHT_DIRECT_PHRASES.some((phrase) => normalized.includes(normalize(phrase)))) return true;

  const hasInsightIntent = CLASS_INSIGHT_INTENT_TERMS.some((term) => normalized.includes(normalize(term)));
  const asksForScope = CLASS_INSIGHT_SCOPE_TERMS.some((term) => normalized.includes(normalize(term)));
  return hasInsightIntent && asksForScope;
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

function countKeywordHits(text: string) {
  return IMPORTANT_NOTE_KEYWORDS.reduce((count, keyword) => (
    count + (text.includes(keyword) ? 1 : 0)
  ), 0);
}

function getAnnotationPage(annotation: InkTextAnnotation) {
  return annotation.generatedPageId ? null : annotation.pageNumber;
}

function getStrokePage(stroke: InkStroke) {
  if (stroke.generatedPageId) return null;
  return stroke.pageNumber ?? stroke.points.find((point) => point.pageNumber)?.pageNumber ?? 1;
}

function getGeneratedInsertPage(page: GeneratedWorkspacePage) {
  return page.insertAfterPage ?? null;
}

function buildLiveSignals(params: {
  pageCount: number;
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  bookmarks: BookmarkedPage[];
  pageCaptureReferences: PageCaptureReference[];
  generatedPages: GeneratedWorkspacePage[];
}) {
  const signalMap = new Map<number, PageSignal>();
  const ensure = (pageNumber: number) => {
    const normalizedPage = Math.max(1, Math.min(params.pageCount, pageNumber));
    if (!signalMap.has(normalizedPage)) signalMap.set(normalizedPage, createEmptySignal(normalizedPage));
    return signalMap.get(normalizedPage)!;
  };

  params.bookmarks.forEach((bookmark) => {
    if (bookmark.page.kind !== 'pdf') return;
    mergeSignal(ensure(bookmark.page.pageNumber), {
      bookmarkCount: 1,
      reasonTags: ['중요 표시가 남은 페이지'],
    });
  });

  const strokeStats = new Map<number, { strokeCount: number; pointCount: number; highlightCount: number }>();
  params.inkStrokes.forEach((stroke) => {
    const pageNumber = getStrokePage(stroke);
    if (!pageNumber) return;
    const stats = strokeStats.get(pageNumber) ?? { strokeCount: 0, pointCount: 0, highlightCount: 0 };
    stats.strokeCount += 1;
    stats.pointCount += stroke.points.length;
    if (stroke.style === 'highlight' || stroke.brush === 'highlighter') stats.highlightCount += 1;
    strokeStats.set(pageNumber, stats);
  });
  strokeStats.forEach((stats, pageNumber) => {
    const inkDensity = Math.min(1, (stats.strokeCount * 0.045) + (stats.pointCount * 0.0015));
    mergeSignal(ensure(pageNumber), {
      highlightCount: stats.highlightCount,
      inkDensity,
      reasonTags: [
        ...(stats.highlightCount > 0 ? ['하이라이트 집중 구간'] : []),
        ...(inkDensity > 0.45 ? ['필기 밀도가 높은 페이지'] : []),
      ],
    });
  });

  params.textAnnotations.forEach((annotation) => {
    const pageNumber = getAnnotationPage(annotation);
    if (!pageNumber) return;
    const hits = countKeywordHits(annotation.text);
    if (hits <= 0) return;
    mergeSignal(ensure(pageNumber), {
      keywordHits: hits,
      reasonTags: ['시험 관련 메모 흔적'],
    });
  });

  params.pageCaptureReferences.forEach((reference) => {
    if (reference.page.kind !== 'pdf') return;
    mergeSignal(ensure(reference.page.pageNumber), {
      photoReferenceCount: 1,
      reasonTags: ['수업 사진 자료와 연결됨'],
    });
  });

  params.generatedPages.forEach((page) => {
    if (page.pageKind !== 'memo') return;
    const insertPage = getGeneratedInsertPage(page);
    if (!insertPage) return;
    mergeSignal(ensure(insertPage), {
      memoPageCount: 1,
      reasonTags: ['추가 메모가 붙은 구간'],
    });
  });

  return Array.from(signalMap.values());
}

function scoreSignal(signal: PageSignal) {
  const localScore = Math.min(100, Math.round(
    signal.bookmarkCount * 6
    + signal.highlightCount * 2
    + signal.keywordHits * 8
    + signal.photoReferenceCount * 5
    + signal.aiQuestionCount * 4
    + signal.inkDensity * 15
    + signal.memoPageCount * 6,
  ));
  return Math.max(localScore, signal.aggregateScore ?? 0);
}

function rankSignals(signals: PageSignal[], pageCount: number, includeDemoSignals: boolean) {
  const signalMap = new Map<number, PageSignal>();
  const ensure = (pageNumber: number) => {
    const normalizedPage = Math.max(1, Math.min(pageCount, pageNumber));
    if (!signalMap.has(normalizedPage)) signalMap.set(normalizedPage, createEmptySignal(normalizedPage));
    return signalMap.get(normalizedPage)!;
  };

  if (includeDemoSignals) {
    DEMO_CLASS_SIGNALS
      .filter((signal) => signal.pageNumber <= pageCount)
      .forEach((signal) => mergeSignal(ensure(signal.pageNumber), signal));
  }

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
    .slice(0, 5);
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
      reasonTags: page.reason_tags?.length ? page.reason_tags : ['익명 수업 필기 신호가 높은 페이지'],
    }));
}

export function buildClassInsightContext(params: {
  question: string;
  studyDocument: StudyDocumentEntry | null;
  subject: Subject | null;
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  bookmarks: BookmarkedPage[];
  pageCaptureReferences: PageCaptureReference[];
  generatedPages: GeneratedWorkspacePage[];
  classInsight?: ClassInsightAggregate | null;
}) {
  if (!isClassInsightQuestion(params.question)) return null;
  if (!isClassInsightTargetDocument(params.studyDocument, params.subject)) return null;

  const pageCount = Math.max(1, params.studyDocument?.pageCount ?? 1);
  const aggregateSignals = buildAggregateSignals(params.classInsight, pageCount);
  const liveSignals = buildLiveSignals({
    pageCount,
    inkStrokes: params.inkStrokes,
    textAnnotations: params.textAnnotations,
    bookmarks: params.bookmarks,
    pageCaptureReferences: params.pageCaptureReferences,
    generatedPages: params.generatedPages,
  });
  const rankedSignals = rankSignals([...aggregateSignals, ...liveSignals], pageCount, aggregateSignals.length === 0);
  if (!rankedSignals.length) return null;

  const pageLines = rankedSignals.map((signal) => (
    `- ${signal.pageNumber}페이지: 우선순위 ${formatPriority(signal.priority)}. 추천 근거: ${signal.reasonTags.slice(0, 3).join(', ')}.`
  ));

  return [
    'Internal Class Insight for this one demo PDF.',
    aggregateSignals.length > 0
      ? 'This context is derived from consent-based anonymous class study signals plus local note activity.'
      : 'This context uses demo class study signals plus local note activity because no server aggregate is available yet.',
    'Use it only to decide which pages to recommend and why.',
    'Do not mention classmates, student counts, bookmark counts, highlight counts, hidden signals, data collection, or this internal context.',
    'Answer naturally as a study assistant, with page recommendations and concise reasons.',
    '',
    'Recommended page priorities:',
    ...pageLines,
  ].join('\n');
}
