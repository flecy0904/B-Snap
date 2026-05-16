import type { CaptureAsset, DocumentPageView, GeneratedWorkspacePage, NotebookPage, NoteEntry, NoteSummarySection, PageCaptureReference, StudyDocumentEntry, Subject, WorkspaceAttachment } from '../../../types';

export const PEN_BRUSH_COLORS = ['#1F2937', '#2563EB', '#7C3AED', '#D9485F', '#F59E0B', '#16A34A'] as const;
export const HIGHLIGHT_BRUSH_COLORS = ['#FDE047', '#FB7185', '#86EFAC', '#67E8F9', '#FDBA74'] as const;
export const DEFAULT_PEN_COLOR = PEN_BRUSH_COLORS[0];
export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_BRUSH_COLORS[0];

export function buildGeneratedSummary(asset: CaptureAsset, subjects: Subject[]): {
  summaryTitle: string;
  summaryIntro: string;
  summarySections: NoteSummarySection[];
  formulaText?: string;
} {
  const subjectName = subjects.find((value) => value.id === asset.subjectId)?.name ?? '해당 수업';

  return {
    summaryTitle: `${subjectName} 판서+LLM 정리본`,
    summaryIntro: '판서 흐름을 한 장 복습용으로 압축했습니다.',
    summarySections: [
      {
        title: '핵심 개념',
        body: '판서에서 나온 핵심 개념은 정의 하나만 외우는 구조가 아니라, 식과 그림이 같이 연결되는 흐름으로 보는 것이 중요합니다. 먼저 중심 개념이 무엇인지 잡고, 그다음 각 기호와 항이 어떤 의미를 갖는지 붙여서 보면 전체 맥락이 더 빠르게 정리됩니다.',
      },
      {
        title: '시험 포인트',
        body: '시험에서는 식을 그대로 쓰는 것보다 각 변수의 의미, 관계식이 왜 저 형태가 되는지, 판서에서 강조된 연결 포인트를 설명할 수 있어야 합니다. 정의, 식의 역할, 그래프 또는 예시 해석을 한 묶음으로 복기하는 쪽이 효율적입니다.',
        tone: 'highlight',
      },
    ],
    formulaText: 'a cos t + b sin t = R cos(t - Φ)',
  };
}

export function buildDocumentPageSequence(pageCount: number, generatedPages: GeneratedWorkspacePage[]): DocumentPageView[] {
  const sortedGenerated = [...generatedPages].sort((left, right) => {
    if (left.insertAfterPage !== right.insertAfterPage) {
      return left.insertAfterPage - right.insertAfterPage;
    }
    return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
  });

  const pages: DocumentPageView[] = [];

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    pages.push({ kind: 'pdf', pageNumber });
    sortedGenerated
      .filter((value) => value.insertAfterPage === pageNumber)
      .forEach((value) => pages.push({ kind: 'generated', pageId: value.id }));
  }

  return pages;
}

export function buildNotebookPageSequence(documentId: number, pageCount: number, generatedPages: GeneratedWorkspacePage[]): NotebookPage[] {
  const documentPages = buildDocumentPageSequence(pageCount, generatedPages);
  const generatedOrdinalBySource = new Map<number, number>();

  return documentPages.map((page) => {
    if (page.kind === 'pdf') {
      return {
        id: `pdf:${page.pageNumber}`,
        documentId,
        kind: 'pdf',
        label: `${page.pageNumber} 페이지`,
        pageNumber: page.pageNumber,
        sourcePage: page,
      };
    }

    const generatedPage = generatedPages.find((value) => value.id === page.pageId);
    const generatedKind = generatedPage?.pageKind === 'memo' ? 'blank' : 'summary';
    const sourcePage = generatedPage?.insertAfterPage ?? 1;
    const ordinal = (generatedOrdinalBySource.get(sourcePage) ?? 0) + 1;
    generatedOrdinalBySource.set(sourcePage, ordinal);

    return {
      id: `generated:${page.pageId}`,
      documentId,
      kind: generatedKind,
      label: generatedKind === 'blank' ? `${sourcePage}-${ordinal} 메모` : `${sourcePage}-${ordinal} AI 정리`,
      generatedPageId: page.pageId,
      insertAfterPage: sourcePage,
      template: generatedKind === 'blank' ? 'plain' : undefined,
      sourcePage: page,
    };
  });
}

export function buildWorkspaceAttachment(asset: CaptureAsset, generatedPageId: string): WorkspaceAttachment {
  return {
    id: `attachment-${generatedPageId}`,
    assetId: asset.id,
    generatedPageId,
    type: asset.type,
    title: asset.title,
    summary: asset.summary,
    createdAt: asset.createdAt,
    pageCount: asset.pageCount,
    previewImageKey: asset.previewImageKey,
    previewImage: asset.previewImage,
    fileUrl: asset.fileUrl,
    thumbnailUrl: asset.thumbnailUrl,
    placementType: asset.type === 'image' ? 'next_page_insert' : 'side_reference',
  };
}

function pickCaptureKeywords(asset: CaptureAsset, subjectName: string) {
  const sourceWords = `${asset.title} ${asset.summary}`
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 2)
    .slice(0, 4);

  return Array.from(new Set([subjectName, ...sourceWords, asset.type === 'image' ? '판서사진' : 'PDF자료'])).slice(0, 5);
}

export function buildPageCaptureReference(props: {
  asset: CaptureAsset;
  documentId: number;
  page: DocumentPageView;
  pageLabel: string;
  subjects: Subject[];
}): PageCaptureReference {
  const subjectName = props.subjects.find((subject) => subject.id === props.asset.subjectId)?.name ?? '수업';
  const keywords = props.asset.analysisKeywords?.length
    ? props.asset.analysisKeywords
    : pickCaptureKeywords(props.asset, subjectName);
  const summary = props.asset.analysisSummary ?? props.asset.summary;
  const aiSummary =
    props.asset.analysisSummary ??
    `${props.pageLabel}에서 참고할 ${props.asset.type === 'image' ? '판서/사진 자료' : 'PDF 자료'}입니다. 원본은 사진 탭에 보관하고, 이 카드에는 복습할 때 바로 맥락을 찾을 수 있도록 자료 설명과 연결 위치만 남깁니다.`;

  return {
    id: `page-ref-${props.documentId}-${props.asset.id}-${Date.now()}`,
    documentId: props.documentId,
    assetId: props.asset.id,
    subjectId: props.asset.subjectId,
    page: props.page,
    pageLabel: props.pageLabel,
    type: props.asset.type,
    title: props.asset.title,
    summary,
    aiSummary,
    keywords,
    createdAt: new Date().toISOString(),
    sourceDeviceLabel: props.asset.sourceDeviceLabel,
    previewImageKey: props.asset.previewImageKey,
    previewImage: props.asset.previewImage,
    fileUrl: props.asset.fileUrl,
    thumbnailUrl: props.asset.thumbnailUrl,
    pageCount: props.asset.pageCount,
  };
}

export function filterNotesByQuery(params: {
  notes: NoteEntry[];
  subjects: Subject[];
  subjectId: number | null;
  query: string;
  sort: 'latest' | 'oldest';
}) {
  let list = params.subjectId ? params.notes.filter((value) => value.subjectId === params.subjectId) : params.notes;
  const normalizedQuery = params.query.trim().toLowerCase();

  if (normalizedQuery) {
    list = list.filter((value) => {
      const subjectName = params.subjects.find((item) => item.id === value.subjectId)?.name ?? '';
      return (
        value.title.toLowerCase().includes(normalizedQuery) ||
        value.preview.toLowerCase().includes(normalizedQuery) ||
        value.keywords.some((keyword) => keyword.toLowerCase().includes(normalizedQuery)) ||
        subjectName.toLowerCase().includes(normalizedQuery)
      );
    });
  }

  return [...list].sort((left, right) => {
    const leftTime = new Date(left.date.replace(/\./g, '-')).getTime();
    const rightTime = new Date(right.date.replace(/\./g, '-')).getTime();
    return params.sort === 'latest' ? rightTime - leftTime : leftTime - rightTime;
  });
}

export function filterStudyDocumentsByQuery(params: {
  studyDocuments: StudyDocumentEntry[];
  subjects: Subject[];
  subjectId: number | null;
  query: string;
  sort: 'latest' | 'oldest';
}) {
  let list = params.subjectId ? params.studyDocuments.filter((value) => value.subjectId === params.subjectId) : params.studyDocuments;
  const normalizedQuery = params.query.trim().toLowerCase();

  if (normalizedQuery) {
    list = list.filter((value) => {
      const subjectName = params.subjects.find((item) => item.id === value.subjectId)?.name ?? '';
      return (
        value.title.toLowerCase().includes(normalizedQuery) ||
        value.preview.toLowerCase().includes(normalizedQuery) ||
        value.type.toLowerCase().includes(normalizedQuery) ||
        subjectName.toLowerCase().includes(normalizedQuery)
      );
    });
  }

  return params.sort === 'latest' ? list : [...list].reverse();
}
