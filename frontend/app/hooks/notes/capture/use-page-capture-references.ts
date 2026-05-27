import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { isBackendApiEnabled, resolveBackendAssetUrl } from '../../../services/backend-api';
import { cleanAiDisplayText, getDocumentPageLabel, isSameDocumentPage } from '../../../ui-helpers';
import type {
  CaptureAsset,
  DocumentPageView,
  GeneratedWorkspacePage,
  PageCaptureReference,
  StudyDocumentEntry,
  Subject,
} from '../../../types';
import { buildPageCaptureReference } from '../workspace/helpers';

type SetState<T> = Dispatch<SetStateAction<T>>;

type PageCaptureReferenceActionsParams = {
  studyDocumentId: number | null;
  studyDocument: StudyDocumentEntry | null;
  allStudyDocuments: StudyDocumentEntry[];
  availableSubjects: Subject[];
  currentDocumentPages: DocumentPageView[];
  currentDocumentPage: DocumentPageView | null;
  currentPdfPage: number;
  memoPages: GeneratedWorkspacePage[];
  currentDocumentHasBackendPages: boolean;
  pageCaptureReferencesByDocument: Record<number, PageCaptureReference[]>;
  setPageCaptureReferencesByDocument: SetState<Record<number, PageCaptureReference[]>>;
  setActivePageByDocument: SetState<Record<number, DocumentPageView>>;
  setCurrentPdfPageByDocument: SetState<Record<number, number>>;
  setIncomingAssetSuggestion: SetState<CaptureAsset | null>;
  setIncomingBannerQueue: SetState<CaptureAsset[]>;
  setAiQuestion: SetState<string>;
  setAiPanelOpen: SetState<boolean>;
  setViewingAiChatSessionId: SetState<number | null>;
  setWorkspaceFeedback: SetState<string | null>;
  updateAssetStatus: (assetId: string, nextStatus: CaptureAsset['status']) => void;
  findCaptureAssetById: (assetId: string) => CaptureAsset | null;
  createImageNoteFromAsset: (asset: CaptureAsset) => Promise<boolean>;
  openStudyDocument: (id: number | null) => void;
  requestAiAnswerForQuestion: (question: string, options?: {
    selectionImageUri?: string | null;
    pageNumber?: number | null;
    source?: 'general' | 'selection' | 'photo' | 'class-insight';
  }) => Promise<boolean>;
};

function clampPdfPage(rawPageNumber: number, pageCount: number) {
  return Math.max(1, Math.min(Math.max(1, pageCount), Math.round(rawPageNumber || 1)));
}

function buildPdfPagesForLabel(pageCount: number) {
  return Array.from({ length: Math.max(1, pageCount) }, (_, index) => ({
    kind: 'pdf' as const,
    pageNumber: index + 1,
  }));
}

function buildPageCaptureReferenceQuestion(reference: PageCaptureReference) {
  return [
    `${reference.pageLabel}에 연결한 자료 "${reference.title}"를 수업 맥락에 맞춰 설명해줘.`,
    `자료 설명: ${cleanAiDisplayText(reference.aiSummary || reference.summary)}`,
    reference.keywords.length ? `키워드: ${reference.keywords.join(', ')}` : '',
    '핵심 개념, 시험 포인트, 원본 PDF 페이지와 연결해서 볼 부분을 정리해줘.',
  ].filter(Boolean).join('\n');
}

export function usePageCaptureReferenceActions(params: PageCaptureReferenceActionsParams) {
  const markAssetAccepted = useCallback((assetId: string) => {
    params.updateAssetStatus(assetId, 'accepted');
    params.setIncomingAssetSuggestion((current) => (current?.id === assetId ? null : current));
    params.setIncomingBannerQueue((current) => current.filter((value) => value.id !== assetId));
  }, [params]);

  const getReferencePageLabel = useCallback((page: DocumentPageView) => getDocumentPageLabel({
    page,
    pages: params.currentDocumentPages,
    memoPages: params.memoPages,
    pdfSuffix: '페이지',
  }), [params.currentDocumentPages, params.memoPages]);

  const getReferencePageLabelForDocument = useCallback((documentId: number, page: DocumentPageView) => {
    if (documentId === params.studyDocumentId) return getReferencePageLabel(page);
    const targetDocument = params.allStudyDocuments.find((document) => document.id === documentId);
    return getDocumentPageLabel({
      page,
      pages: page.kind === 'pdf' ? buildPdfPagesForLabel(targetDocument?.pageCount ?? 1) : [],
      memoPages: [],
      pdfSuffix: '페이지',
    });
  }, [getReferencePageLabel, params.allStudyDocuments, params.studyDocumentId]);

  const linkCaptureAssetToPage = useCallback((assetId: string, documentId: number, rawPageNumber: number) => {
    const asset = params.findCaptureAssetById(assetId);
    const targetDocument = params.allStudyDocuments.find((document) => document.id === documentId);
    if (!asset || !targetDocument) {
      params.setWorkspaceFeedback('연결할 사진 또는 노트를 찾지 못했습니다.');
      return false;
    }

    const pageNumber = clampPdfPage(rawPageNumber, targetDocument.pageCount);
    const page: DocumentPageView = { kind: 'pdf', pageNumber };
    const pageLabel = getReferencePageLabelForDocument(documentId, page);
    const existingReferences = params.pageCaptureReferencesByDocument[documentId] ?? [];
    const alreadyLinked = existingReferences.some((reference) => (
      reference.assetId === asset.id && isSameDocumentPage(reference.page, page)
    ));

    params.setPageCaptureReferencesByDocument((current) => {
      if (alreadyLinked) return current;
      const reference = buildPageCaptureReference({
        asset,
        documentId,
        page,
        pageLabel,
        subjects: params.availableSubjects,
      });

      return {
        ...current,
        [documentId]: [reference, ...(current[documentId] ?? [])],
      };
    });

    markAssetAccepted(asset.id);
    params.setWorkspaceFeedback(alreadyLinked ? `${pageLabel}에 이미 연결된 사진입니다.` : `${targetDocument.title} ${pageLabel}에 사진을 연결했습니다.`);
    return !alreadyLinked;
  }, [getReferencePageLabelForDocument, markAssetAccepted, params]);

  const linkCaptureAssetToCurrentPage = useCallback(async (asset: CaptureAsset) => {
    if (!params.studyDocumentId || !params.studyDocument) {
      await params.createImageNoteFromAsset(asset);
      return;
    }

    const page = params.currentDocumentPage ?? { kind: 'pdf' as const, pageNumber: params.currentPdfPage };
    const pageLabel = getReferencePageLabel(page);
    const existingReferences = params.pageCaptureReferencesByDocument[params.studyDocumentId] ?? [];
    const alreadyLinked = existingReferences.some((reference) => (
      reference.assetId === asset.id && isSameDocumentPage(reference.page, page)
    ));

    if (!alreadyLinked) {
      const reference = buildPageCaptureReference({
        asset,
        documentId: params.studyDocumentId,
        page,
        pageLabel,
        subjects: params.availableSubjects,
      });

      params.setPageCaptureReferencesByDocument((current) => ({
        ...current,
        [params.studyDocumentId!]: [reference, ...(current[params.studyDocumentId!] ?? [])],
      }));
    }

    markAssetAccepted(asset.id);
    params.setWorkspaceFeedback(
      alreadyLinked
        ? `${pageLabel}에 이미 연결된 자료입니다.`
        : `${pageLabel}에 ${asset.type === 'image' ? '사진' : 'PDF'} 자료를 연결했습니다.`,
    );
  }, [getReferencePageLabel, markAssetAccepted, params]);

  const openPageCaptureReference = useCallback((referenceId: string) => {
    let targetDocumentId = params.studyDocumentId;
    let reference = targetDocumentId
      ? (params.pageCaptureReferencesByDocument[targetDocumentId] ?? []).find((value) => value.id === referenceId)
      : null;

    if (!reference) {
      const matchedEntry = Object.entries(params.pageCaptureReferencesByDocument)
        .find(([, references]) => references.some((value) => value.id === referenceId));
      if (matchedEntry) {
        targetDocumentId = Number(matchedEntry[0]);
        reference = matchedEntry[1].find((value) => value.id === referenceId) ?? null;
      }
    }

    if (!targetDocumentId || !reference) return;

    if (params.studyDocumentId !== targetDocumentId) {
      params.openStudyDocument(targetDocumentId);
    }
    params.setActivePageByDocument((current) => ({
      ...current,
      [targetDocumentId]: reference.page,
    }));
    if (reference.page.kind === 'pdf') {
      const pageNumber = reference.page.pageNumber;
      params.setCurrentPdfPageByDocument((current) => ({
        ...current,
        [targetDocumentId]: pageNumber,
      }));
    }
    params.setWorkspaceFeedback(`${reference.pageLabel}로 이동했습니다.`);
  }, [params]);

  const movePageCaptureReference = useCallback((referenceId: string, delta: -1 | 1) => {
    if (!params.studyDocumentId || !params.studyDocument) return;
    const maxPage = Math.max(1, params.studyDocument.pageCount);

    params.setPageCaptureReferencesByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).map((reference) => {
        if (reference.id !== referenceId) return reference;
        const basePage = reference.page.kind === 'pdf' ? reference.page.pageNumber : params.currentPdfPage;
        const nextPageNumber = Math.min(maxPage, Math.max(1, basePage + delta));
        const nextPage: DocumentPageView = { kind: 'pdf', pageNumber: nextPageNumber };
        return {
          ...reference,
          page: nextPage,
          pageLabel: getReferencePageLabel(nextPage),
        };
      }),
    }));
    params.setWorkspaceFeedback('자료 연결 위치를 이동했습니다.');
  }, [getReferencePageLabel, params]);

  const movePageCaptureReferenceToPage = useCallback((referenceId: string, rawPageNumber: number) => {
    let moved = false;
    let targetLabel = '';

    params.setPageCaptureReferencesByDocument((current) => {
      const matchedEntry = Object.entries(current).find(([, references]) => references.some((reference) => reference.id === referenceId));
      if (!matchedEntry) return current;

      const documentId = Number(matchedEntry[0]);
      const targetDocument = params.allStudyDocuments.find((document) => document.id === documentId);
      if (!targetDocument) return current;

      const pageNumber = clampPdfPage(rawPageNumber, targetDocument.pageCount);
      const nextPage: DocumentPageView = { kind: 'pdf', pageNumber };
      targetLabel = getReferencePageLabelForDocument(documentId, nextPage);

      return {
        ...current,
        [documentId]: (current[documentId] ?? []).map((reference) => {
          if (reference.id !== referenceId) return reference;
          moved = true;
          return {
            ...reference,
            page: nextPage,
            pageLabel: targetLabel,
          };
        }),
      };
    });

    if (moved) {
      params.setWorkspaceFeedback(`${targetLabel}로 자료 연결 위치를 옮겼습니다.`);
    }
  }, [getReferencePageLabelForDocument, params]);

  const removePageCaptureReference = useCallback((referenceId: string) => {
    if (!params.studyDocumentId) return;
    params.setPageCaptureReferencesByDocument((current) => ({
      ...current,
      [params.studyDocumentId!]: (current[params.studyDocumentId!] ?? []).filter((reference) => reference.id !== referenceId),
    }));
    params.setWorkspaceFeedback('페이지에서 사진 자료 연결을 제거했습니다.');
  }, [params]);

  const prepareAiQuestionForPageCaptureReference = useCallback((referenceId: string) => {
    if (!params.studyDocumentId) return;
    const reference = (params.pageCaptureReferencesByDocument[params.studyDocumentId] ?? []).find((value) => value.id === referenceId);
    if (!reference) return;

    params.setAiQuestion(buildPageCaptureReferenceQuestion(reference));
    params.setAiPanelOpen(true);
    params.setViewingAiChatSessionId(null);
    params.setWorkspaceFeedback('AI 질문창에 연결 자료 맥락을 넣었습니다.');
  }, [params]);

  const askAiAboutPageCaptureReference = useCallback((referenceId: string) => {
    if (!params.studyDocumentId) return;
    const reference = (params.pageCaptureReferencesByDocument[params.studyDocumentId] ?? []).find((value) => value.id === referenceId);
    if (!reference) return;
    if (!isBackendApiEnabled() || !params.currentDocumentHasBackendPages) {
      prepareAiQuestionForPageCaptureReference(referenceId);
      return;
    }

    const question = buildPageCaptureReferenceQuestion(reference);
    const referenceImageUri = resolveBackendAssetUrl(reference.processedUrl ?? reference.fileUrl ?? reference.thumbnailUrl ?? '') || null;
    params.setAiPanelOpen(true);
    params.setViewingAiChatSessionId(null);
    void params.requestAiAnswerForQuestion(question, {
      pageNumber: reference.page.kind === 'pdf' ? reference.page.pageNumber : params.currentPdfPage,
      selectionImageUri: referenceImageUri,
      source: 'photo',
    });
    params.setWorkspaceFeedback('연결 자료로 AI 채팅을 시작했습니다.');
  }, [params, prepareAiQuestionForPageCaptureReference]);

  return {
    linkCaptureAssetToPage,
    linkCaptureAssetToCurrentPage,
    openPageCaptureReference,
    movePageCaptureReference,
    movePageCaptureReferenceToPage,
    removePageCaptureReference,
    prepareAiQuestionForPageCaptureReference,
    askAiAboutPageCaptureReference,
  };
}
