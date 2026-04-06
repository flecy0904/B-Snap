import { useEffect, useMemo, useState } from 'react';
import { notes, studyDocuments, subjects } from '../data';
import { useSyncBridge } from './use-sync-bridge';
import type { InkStroke, InkTool, SelectionRect } from '../ui-types';
import type { CaptureAsset, DocumentPageView, GeneratedWorkspacePage, NoteSummarySection, NoteWorkspaceMode, WorkspaceAttachment } from '../types';

function buildGeneratedSummary(asset: CaptureAsset): {
  summaryTitle: string;
  summaryIntro: string;
  summarySections: NoteSummarySection[];
  formulaText?: string;
} {
  const subjectName = subjects.find((value) => value.id === asset.subjectId)?.name ?? '해당 수업';
  const subjectTemplateNote =
    notes
      .filter((value) => value.subjectId === asset.subjectId && value.summarySections?.length)
      .sort((left, right) => new Date(right.date.replace(/\./g, '-')).getTime() - new Date(left.date.replace(/\./g, '-')).getTime())[0] ?? null;

  if (subjectTemplateNote?.summarySections?.length) {
    const formulaSection = subjectTemplateNote.summarySections.find((section) => section.tone === 'formula') ?? null;

    return {
      summaryTitle: subjectTemplateNote.title,
      summaryIntro: subjectTemplateNote.preview,
      summarySections: subjectTemplateNote.summarySections.filter((section) => section.tone !== 'formula'),
      formulaText: formulaSection?.body,
    };
  }

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

function buildDocumentPageSequence(pageCount: number, generatedPages: GeneratedWorkspacePage[]): DocumentPageView[] {
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

export function useStudyWorkspace(props: {
  wide: boolean;
  initialSubjectId: number | null;
  onOpenNotesTab: () => void;
}) {
  const syncBridge = useSyncBridge();
  const [subjectId, setSubjectId] = useState<number | null>(props.initialSubjectId);
  const [noteId, setNoteId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'latest' | 'oldest'>('latest');
  const [noteDetailTab, setNoteDetailTab] = useState<'original' | 'summary'>('original');
  const [noteWorkspaceMode, setNoteWorkspaceMode] = useState<NoteWorkspaceMode>('photo');
  const [studyDocumentId, setStudyDocumentId] = useState<number | null>(null);
  const [inkTool, setInkTool] = useState<InkTool>('view');
  const [inkByDocument, setInkByDocument] = useState<Record<number, InkStroke[]>>({});
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [selectionByDocument, setSelectionByDocument] = useState<Record<number, SelectionRect | null>>({});
  const [aiQuestion, setAiQuestion] = useState('');
  const [incomingAssetSuggestion, setIncomingAssetSuggestion] = useState<CaptureAsset | null>(null);
  const [captureAssetsBySubject, setCaptureAssetsBySubject] = useState<Record<number, CaptureAsset[]>>({});
  const [attachmentsByDocument, setAttachmentsByDocument] = useState<Record<number, WorkspaceAttachment[]>>({});
  const [generatedPagesByDocument, setGeneratedPagesByDocument] = useState<Record<number, GeneratedWorkspacePage[]>>({});
  const [currentPdfPageByDocument, setCurrentPdfPageByDocument] = useState<Record<number, number>>({});
  const [activePageByDocument, setActivePageByDocument] = useState<Record<number, DocumentPageView>>({});
  const [workspaceFeedback, setWorkspaceFeedback] = useState<string | null>(null);
  const [incomingBannerQueue, setIncomingBannerQueue] = useState<CaptureAsset[]>([]);

  const subject = useMemo(() => subjects.find((value) => value.id === subjectId) ?? null, [subjectId]);
  const note = useMemo(() => notes.find((value) => value.id === noteId) ?? null, [noteId]);
  const studyDocument = useMemo(() => studyDocuments.find((value) => value.id === studyDocumentId) ?? null, [studyDocumentId]);
  const inkStrokes = studyDocumentId ? inkByDocument[studyDocumentId] ?? [] : [];
  const selectionRect = studyDocumentId ? selectionByDocument[studyDocumentId] ?? null : null;
  const captureInbox = useMemo(() => {
    if (!subjectId) return [];
    return (captureAssetsBySubject[subjectId] ?? []).filter((asset) => asset.status !== 'dismissed');
  }, [captureAssetsBySubject, subjectId]);
  const workspaceAttachments = useMemo(() => {
    if (!studyDocumentId) return [];
    return attachmentsByDocument[studyDocumentId] ?? [];
  }, [attachmentsByDocument, studyDocumentId]);
  const generatedWorkspacePages = useMemo(() => {
    if (!studyDocumentId) return [];
    return generatedPagesByDocument[studyDocumentId] ?? [];
  }, [generatedPagesByDocument, studyDocumentId]);
  const currentPdfPage = studyDocumentId ? currentPdfPageByDocument[studyDocumentId] ?? 1 : 1;
  const currentDocumentPages = useMemo(() => {
    if (!studyDocument) return [];
    return buildDocumentPageSequence(studyDocument.pageCount, generatedWorkspacePages);
  }, [generatedWorkspacePages, studyDocument]);
  const currentDocumentPage = useMemo(() => {
    if (!studyDocumentId) return null;
    return activePageByDocument[studyDocumentId] ?? { kind: 'pdf' as const, pageNumber: currentPdfPage };
  }, [activePageByDocument, currentPdfPage, studyDocumentId]);
  const currentDocumentPageIndex = useMemo(() => {
    if (!currentDocumentPage) return 0;
    return currentDocumentPages.findIndex((value) =>
      value.kind === 'generated' && currentDocumentPage.kind === 'generated'
        ? value.pageId === currentDocumentPage.pageId
        : value.kind === 'pdf' && currentDocumentPage.kind === 'pdf'
          ? value.pageNumber === currentDocumentPage.pageNumber
          : false,
    );
  }, [currentDocumentPage, currentDocumentPages]);
  const totalDocumentPageCount = currentDocumentPages.length;
  const activeGeneratedPage = useMemo(() => {
    if (!studyDocumentId || currentDocumentPage?.kind !== 'generated') return null;
    return (generatedPagesByDocument[studyDocumentId] ?? []).find((value) => value.id === currentDocumentPage.pageId) ?? null;
  }, [currentDocumentPage, generatedPagesByDocument, studyDocumentId]);
  const activeIncomingBanner = incomingBannerQueue[0] ?? null;
  const inboxPendingCount = useMemo(
    () => captureInbox.filter((asset) => asset.status === 'uploaded' || asset.status === 'archived').length,
    [captureInbox],
  );
  const inboxHint = useMemo(() => {
    if (incomingAssetSuggestion || !studyDocumentId || inboxPendingCount === 0) return null;
    return `현재 문서와 다른 흐름의 자료 ${inboxPendingCount}건이 inbox에 쌓였습니다.`;
  }, [incomingAssetSuggestion, inboxPendingCount, studyDocumentId]);

  useEffect(() => {
    if (!workspaceFeedback) return;
    const timer = setTimeout(() => setWorkspaceFeedback(null), 2200);
    return () => clearTimeout(timer);
  }, [workspaceFeedback]);

  useEffect(() => {
    if (!activeIncomingBanner) return;
    const timer = setTimeout(() => {
      setIncomingBannerQueue((current) => (
        current[0]?.id === activeIncomingBanner.id ? current.slice(1) : current
      ));
    }, 4500);
    return () => clearTimeout(timer);
  }, [activeIncomingBanner]);

  useEffect(() => {
    return syncBridge.subscribeToAssets(({ asset }) => {
      const shouldSuggest = noteWorkspaceMode === 'note' && !!studyDocumentId && subjectId === asset.subjectId;
      const nextAsset = shouldSuggest ? { ...asset, status: 'suggested' as const } : asset;

      setCaptureAssetsBySubject((current) => ({
        ...current,
        [asset.subjectId]: [nextAsset, ...(current[asset.subjectId] ?? [])],
      }));
      setIncomingBannerQueue((current) => [...current, asset]);

      if (shouldSuggest) {
        setIncomingAssetSuggestion(nextAsset);
      }
    });
  }, [noteWorkspaceMode, studyDocumentId, subjectId, syncBridge]);

  const filteredNotes = useMemo(() => {
    let list = subjectId ? notes.filter((value) => value.subjectId === subjectId) : notes;
    const normalizedQuery = query.trim().toLowerCase();

    if (normalizedQuery) {
      list = list.filter((value) => {
        const subjectName = subjects.find((item) => item.id === value.subjectId)?.name ?? '';
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
      return sort === 'latest' ? rightTime - leftTime : leftTime - rightTime;
    });
  }, [query, sort, subjectId]);

  const filteredStudyDocuments = useMemo(() => {
    let list = subjectId ? studyDocuments.filter((value) => value.subjectId === subjectId) : studyDocuments;
    const normalizedQuery = query.trim().toLowerCase();

    if (normalizedQuery) {
      list = list.filter((value) => {
        const subjectName = subjects.find((item) => item.id === value.subjectId)?.name ?? '';
        return (
          value.title.toLowerCase().includes(normalizedQuery) ||
          value.preview.toLowerCase().includes(normalizedQuery) ||
          value.type.toLowerCase().includes(normalizedQuery) ||
          subjectName.toLowerCase().includes(normalizedQuery)
        );
      });
    }

    return sort === 'latest' ? list : [...list].reverse();
  }, [query, sort, subjectId]);

  const openSubject = (id: number) => {
    props.onOpenNotesTab();
    setSubjectId(id);
    setNoteId(null);
    setStudyDocumentId(null);
    setNoteDetailTab('original');
  };

  const openNote = (id: number) => {
    const selected = notes.find((value) => value.id === id);
    if (!selected) return;

    props.onOpenNotesTab();
    setSubjectId(selected.subjectId);
    setNoteId(id);
    setNoteDetailTab('original');
  };

  const openStudyDocument = (id: number | null) => {
    if (id === null) {
      setStudyDocumentId(null);
      setInkTool('view');
      setAiPanelOpen(false);
      return;
    }

    const selected = studyDocuments.find((value) => value.id === id);
    if (!selected) return;

    props.onOpenNotesTab();
    setSubjectId(selected.subjectId);
    setNoteId(null);
    setStudyDocumentId(id);
    setInkTool('view');
    setActivePageByDocument((current) => ({
      ...current,
      [id]: current[id] ?? { kind: 'pdf', pageNumber: currentPdfPageByDocument[id] ?? 1 },
    }));
  };

  const resetNotes = () => {
    setNoteId(null);
    setStudyDocumentId(null);
    setQuery('');
    setNoteDetailTab('original');
    setInkTool('view');
    setAiPanelOpen(false);
    if (!props.wide) setSubjectId(null);
  };

  const changeNoteWorkspaceMode = (next: NoteWorkspaceMode) => {
    setNoteWorkspaceMode(next);
    setNoteId(null);
    setStudyDocumentId(null);
    setInkTool('view');
    setAiPanelOpen(false);
  };

  const resetToSubjectList = () => {
    setNoteId(null);
    setSubjectId(null);
    setQuery('');
    setNoteDetailTab('original');
  };

  const backToNoteList = () => {
    setNoteId(null);
    setStudyDocumentId(null);
    setAiPanelOpen(false);
    setInkTool('view');
    setIncomingAssetSuggestion(null);
  };

  const changeInkTool = (tool: InkTool) => {
    if (tool === 'select' && inkTool === 'select') {
      setInkTool('view');
      if (studyDocumentId) {
        setSelectionByDocument((current) => ({ ...current, [studyDocumentId]: null }));
      }
      return;
    }

    setInkTool(tool);
    if (tool !== 'select' && studyDocumentId) {
      setSelectionByDocument((current) => ({ ...current, [studyDocumentId]: null }));
    }
  };

  const changeSelection = (rect: SelectionRect | null) => {
    if (!studyDocumentId) return;
    setSelectionByDocument((current) => ({ ...current, [studyDocumentId]: rect }));
  };

  const clearInk = () => {
    if (!studyDocumentId) return;
    setInkByDocument((current) => ({ ...current, [studyDocumentId]: [] }));
  };

  const undoInk = () => {
    if (!studyDocumentId) return;
    setInkByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).slice(0, -1),
    }));
  };

  const commitInkStroke = (stroke: InkStroke) => {
    if (!studyDocumentId) return;
    setInkByDocument((current) => ({
      ...current,
      [studyDocumentId]: [...(current[studyDocumentId] ?? []), stroke],
    }));
  };

  const updateAssetStatus = (assetId: string, nextStatus: CaptureAsset['status']) => {
    setCaptureAssetsBySubject((current) => {
      const next = { ...current };

      Object.keys(next).forEach((key) => {
        const subjectAssets = next[Number(key)] ?? [];
        next[Number(key)] = subjectAssets.map((asset) => (asset.id === assetId ? { ...asset, status: nextStatus } : asset));
      });

      return next;
    });
  };

  const buildAttachment = (asset: CaptureAsset, generatedPageId: string): WorkspaceAttachment => ({
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
    placementType: asset.type === 'image' ? 'next_page_insert' : 'side_reference',
  });

  const insertAssetIntoWorkspace = (asset: CaptureAsset) => {
    if (!studyDocumentId) return;

    const insertAfterPage = currentPdfPageByDocument[studyDocumentId] ?? 1;
    const generatedPageId = `generated-page-${asset.id}-${Date.now()}`;
    const generatedPage: GeneratedWorkspacePage = {
      id: generatedPageId,
      documentId: studyDocumentId,
      sourceAssetId: asset.id,
      title: asset.title,
      createdAt: new Date().toISOString(),
      insertAfterPage,
      status: 'generating',
      previewImageKey: asset.previewImageKey,
      previewImage: asset.previewImage,
      ...buildGeneratedSummary(asset),
    };

    setAttachmentsByDocument((current) => ({
      ...current,
      [studyDocumentId]: [buildAttachment(asset, generatedPageId), ...(current[studyDocumentId] ?? [])],
    }));
    setGeneratedPagesByDocument((current) => ({
      ...current,
      [studyDocumentId]: [generatedPage, ...(current[studyDocumentId] ?? [])],
    }));
    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: { kind: 'generated', pageId: generatedPageId },
    }));
    updateAssetStatus(asset.id, 'accepted');
    setWorkspaceFeedback('다음 페이지 정리본을 생성하고 있습니다.');

    setTimeout(() => {
      setGeneratedPagesByDocument((current) => ({
        ...current,
        [studyDocumentId]: (current[studyDocumentId] ?? []).map((value) =>
          value.id === generatedPageId ? { ...value, status: 'ready' } : value,
        ),
      }));
      setWorkspaceFeedback('다음 페이지 정리본이 준비됐습니다.');
    }, 1600);
  };

  const acceptIncomingAsset = () => {
    if (!incomingAssetSuggestion || !studyDocumentId) return;
    insertAssetIntoWorkspace(incomingAssetSuggestion);
    setWorkspaceFeedback(`${incomingAssetSuggestion.type === 'image' ? '이미지' : 'PDF'}를 다음 PDF 페이지에 삽입했습니다.`);
    setIncomingAssetSuggestion(null);
  };

  const archiveIncomingAsset = () => {
    if (!incomingAssetSuggestion) return;
    updateAssetStatus(incomingAssetSuggestion.id, 'archived');
    setWorkspaceFeedback('자료를 보관함으로 넘겼습니다.');
    setIncomingAssetSuggestion(null);
  };

  const dismissIncomingAsset = () => {
    if (!incomingAssetSuggestion) return;
    updateAssetStatus(incomingAssetSuggestion.id, 'dismissed');
    setWorkspaceFeedback('이번 제안은 숨겼습니다.');
    setIncomingAssetSuggestion(null);
  };

  const insertInboxAsset = (assetId: string) => {
    const asset = captureInbox.find((value) => value.id === assetId);
    if (!asset || !studyDocumentId) return;
    insertAssetIntoWorkspace(asset);
    setWorkspaceFeedback(`${asset.type === 'image' ? '이미지' : 'PDF'}를 inbox에서 다음 PDF 페이지에 삽입했습니다.`);
  };

  const removeInboxAsset = (assetId: string) => {
    const asset = captureInbox.find((value) => value.id === assetId);
    if (!asset) return;
    updateAssetStatus(asset.id, 'dismissed');
    if (incomingAssetSuggestion?.id === asset.id) {
      setIncomingAssetSuggestion(null);
    }
    setWorkspaceFeedback('inbox에서 자료를 삭제했습니다.');
  };

  const removeWorkspaceAttachment = (attachmentId: string) => {
    if (!studyDocumentId) return;
    const target = (attachmentsByDocument[studyDocumentId] ?? []).find((attachment) => attachment.id === attachmentId);
    if (!target) return;
    const linkedGeneratedPage = target.generatedPageId
      ? (generatedPagesByDocument[studyDocumentId] ?? []).find((page) => page.id === target.generatedPageId) ?? null
      : null;

    setAttachmentsByDocument((current) => ({
      ...current,
      [studyDocumentId]: (current[studyDocumentId] ?? []).filter((attachment) => attachment.id !== attachmentId),
    }));
    if (target.generatedPageId) {
      setGeneratedPagesByDocument((current) => ({
        ...current,
        [studyDocumentId]: (current[studyDocumentId] ?? []).filter((page) => page.id !== target.generatedPageId),
      }));
    }
    if (linkedGeneratedPage && activePageByDocument[studyDocumentId]?.kind === 'generated' && activePageByDocument[studyDocumentId]?.pageId === linkedGeneratedPage.id) {
      setActivePageByDocument((current) => ({
        ...current,
        [studyDocumentId]: { kind: 'pdf', pageNumber: linkedGeneratedPage.insertAfterPage },
      }));
      setCurrentPdfPageByDocument((current) => ({
        ...current,
        [studyDocumentId]: linkedGeneratedPage.insertAfterPage,
      }));
    }
    updateAssetStatus(target.assetId, 'archived');
    setWorkspaceFeedback('추가한 정리 페이지를 삭제했습니다.');
  };

  const setCurrentPdfPage = (pageNumber: number) => {
    if (!studyDocumentId || !studyDocument) return;

    const nextPage = Math.max(1, Math.min(pageNumber, studyDocument.pageCount));
    setCurrentPdfPageByDocument((current) => ({
      ...current,
      [studyDocumentId]: nextPage,
    }));
    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: { kind: 'pdf', pageNumber: nextPage },
    }));
  };

  const moveDocumentPage = (delta: -1 | 1) => {
    if (!studyDocumentId || currentDocumentPages.length === 0) return;
    const currentIndex = currentDocumentPageIndex >= 0 ? currentDocumentPageIndex : 0;
    const nextPage = currentDocumentPages[currentIndex + delta];
    if (!nextPage) return;

    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: nextPage,
    }));
    if (nextPage.kind === 'pdf') {
      setCurrentPdfPageByDocument((current) => ({
        ...current,
        [studyDocumentId]: nextPage.pageNumber,
      }));
    }
  };

  const openWorkspaceAttachment = (attachmentId: string) => {
    if (!studyDocumentId) return;
    const target = (attachmentsByDocument[studyDocumentId] ?? []).find((attachment) => attachment.id === attachmentId);
    if (!target?.generatedPageId) return;
    setActivePageByDocument((current) => ({
      ...current,
      [studyDocumentId]: { kind: 'generated', pageId: target.generatedPageId! },
    }));
  };

  const dismissIncomingBanner = () => {
    setIncomingBannerQueue((current) => current.slice(1));
  };

  const openIncomingBanner = () => {
    const asset = incomingBannerQueue[0];
    if (!asset) return;

    props.onOpenNotesTab();
    setSubjectId(asset.subjectId);
    setNoteId(null);
    setStudyDocumentId(null);
    setWorkspaceFeedback(`${asset.type === 'image' ? '이미지' : 'PDF'}를 inbox에서 확인할 수 있습니다.`);
    setIncomingBannerQueue((current) => current.slice(1));
  };

  return {
    subjectId,
    subject,
    note,
    noteDetailTab,
    noteWorkspaceMode,
    studyDocument,
    inkTool,
    inkStrokes,
    aiPanelOpen,
    selectionRect,
    aiQuestion,
    query,
    sort,
    incomingAssetSuggestion,
    inboxHint,
    inboxPendingCount,
    workspaceFeedback,
    activeIncomingBanner,
    captureInbox,
    workspaceAttachments,
    generatedWorkspacePages,
    activeGeneratedPage,
    currentPdfPage,
    currentDocumentPage,
    currentDocumentPageIndex,
    totalDocumentPageCount,
    filteredNotes,
    filteredStudyDocuments,
    openSubject,
    openNote,
    openStudyDocument,
    resetNotes,
    changeNoteWorkspaceMode,
    resetToSubjectList,
    backToNoteList,
    changeInkTool,
    toggleAiPanel: () => setAiPanelOpen((current) => !current),
    setAiQuestion,
    changeSelection,
    clearInk,
    undoInk,
    commitInkStroke,
    acceptIncomingAsset,
    archiveIncomingAsset,
    dismissIncomingAsset,
    dismissIncomingBanner,
    insertInboxAsset,
    removeInboxAsset,
    openIncomingBanner,
    removeWorkspaceAttachment,
    openWorkspaceAttachment,
    setCurrentPdfPage,
    goToPreviousDocumentPage: () => moveDocumentPage(-1),
    goToNextDocumentPage: () => moveDocumentPage(1),
    setQuery,
    toggleSort: () => setSort((current) => (current === 'latest' ? 'oldest' : 'latest')),
    setNoteDetailTab,
  };
}
