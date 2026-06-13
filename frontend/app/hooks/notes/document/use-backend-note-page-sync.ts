import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ensureFolderForSubject,
  extractBackendPdfText,
  isBackendApiEnabled,
  listBackendNotePages,
  updateBackendNotePage,
  uploadBackendPdfNote,
  BackendApiError,
  type BackendNotePage,
} from '../../../services/backend-api';
import type { InkImageAnnotation, InkStroke, InkTextAnnotation } from '../../../ui-types';
import type { BookmarkedPage, GeneratedWorkspacePage, PageCaptureReference, StudyDocumentEntry, Subject } from '../../../types';
import { getStudyDocumentBackendNoteId } from './backend-sync';
import { isPdfAssetUrl } from './document-file-utils';
import { parseNotePageContent, serializeNotePageContent } from './note-page-content';

type PendingPageSave = {
  pageId: number;
  documentId: number;
  pageNumber: number;
  content: string;
  attempts: number;
  updatedAt: number;
};

type UseBackendNotePageSyncParams = {
  workspaceHydrated: boolean;
  studyDocumentId: number | null;
  studyDocument: StudyDocumentEntry | null | undefined;
  availableSubjects: Subject[];
  userStudyDocuments: StudyDocumentEntry[];
  inkByDocument: Record<number, InkStroke[]>;
  textAnnotationsByDocument: Record<number, InkTextAnnotation[]>;
  imageAnnotationsByDocument: Record<number, InkImageAnnotation[]>;
  bookmarksByDocument: Record<number, BookmarkedPage[]>;
  pageCaptureReferencesByDocument: Record<number, PageCaptureReference[]>;
  generatedPagesByDocument: Record<number, GeneratedWorkspacePage[]>;
  setUserStudyDocuments: Dispatch<SetStateAction<StudyDocumentEntry[]>>;
  setInkByDocument: Dispatch<SetStateAction<Record<number, InkStroke[]>>>;
  setTextAnnotationsByDocument: Dispatch<SetStateAction<Record<number, InkTextAnnotation[]>>>;
  setImageAnnotationsByDocument: Dispatch<SetStateAction<Record<number, InkImageAnnotation[]>>>;
  setWorkspaceFeedback: Dispatch<SetStateAction<string | null>>;
  onPageSaveSuccess?: (documentId: number, pageNumber: number) => void;
  onBackendPagesLoaded?: (documentId: number, pages: BackendNotePage[]) => void;
};

const EMPTY_PAGE_CONTENT = serializeNotePageContent({ inkStrokes: [], textAnnotations: [] });

const getPageSaveKey = (documentId: number, pageNumber: number) => `${documentId}:${pageNumber}`;

function serializeBackendPageForSavedState(page: BackendNotePage) {
  const storedPage = parseNotePageContent(page.content);
  if (!storedPage) return page.content ?? EMPTY_PAGE_CONTENT;
  return serializeNotePageContent({
    inkStrokes: storedPage.inkStrokes,
    textAnnotations: storedPage.textAnnotations,
    imageAnnotations: storedPage.imageAnnotations,
    bookmarked: storedPage.bookmarked,
    photoReferenceCount: storedPage.photoReferenceCount,
    memoPageCount: storedPage.memoPageCount,
    handwritingRecognition: storedPage.handwritingRecognition,
  });
}

function isTransientWebPdfUri(uri: string | null | undefined) {
  if (typeof uri !== 'string') return false;
  const normalizedUri = uri.toLowerCase();
  return normalizedUri.startsWith('blob:') || normalizedUri.startsWith('data:application/pdf');
}

export function useBackendNotePageSync({
  workspaceHydrated,
  studyDocumentId,
  studyDocument,
  availableSubjects,
  userStudyDocuments,
  inkByDocument,
  textAnnotationsByDocument,
  imageAnnotationsByDocument,
  bookmarksByDocument,
  pageCaptureReferencesByDocument,
  generatedPagesByDocument,
  setUserStudyDocuments,
  setInkByDocument,
  setTextAnnotationsByDocument,
  setImageAnnotationsByDocument,
  setWorkspaceFeedback,
  onPageSaveSuccess,
  onBackendPagesLoaded,
}: UseBackendNotePageSyncParams) {
  const [backendPageIdsByDocument, setBackendPageIdsByDocument] = useState<Record<number, Record<number, number>>>({});
  const [pendingPageSaves, setPendingPageSaves] = useState<Record<string, PendingPageSave>>({});
  const [savingPageKeys, setSavingPageKeys] = useState<Record<string, true>>({});
  const [failedPageSaveKeys, setFailedPageSaveKeys] = useState<Record<string, true>>({});
  const lastQueuedPageContentRef = useRef<Record<string, string>>({});
  const lastSavedPageContentRef = useRef<Record<string, string>>({});
  const backendPageLoadsInFlightRef = useRef<Record<number, true>>({});
  const dirtyPageKeysRef = useRef<Set<string>>(new Set());
  const pdfSyncInFlightRef = useRef<Record<number, true>>({});

  const applyLoadedBackendPages = useCallback((documentId: number, pages: Awaited<ReturnType<typeof listBackendNotePages>>) => {
    const pageIdsByNumber: Record<number, number> = {};
    const documentInk: InkStroke[] = [];
    const documentTextAnnotations: InkTextAnnotation[] = [];
    const documentImageAnnotations: InkImageAnnotation[] = [];
    const savedPageContentByKey: Record<string, string> = {};
    let hasStoredPageContent = false;
    const firstPageImageUrl = pages[0]?.image_url ?? null;

    pages.forEach((page) => {
      pageIdsByNumber[page.page_number] = page.id;
      const storedPage = parseNotePageContent(page.content);
      if (!storedPage) {
        savedPageContentByKey[getPageSaveKey(documentId, page.page_number)] = EMPTY_PAGE_CONTENT;
        return;
      }

      hasStoredPageContent = true;
      const normalizedInkStrokes = storedPage.inkStrokes.map((stroke) => ({
        ...stroke,
        generatedPageId: undefined,
        pageNumber: page.page_number,
      }));
      const normalizedTextAnnotations = storedPage.textAnnotations.map((annotation) => ({
        ...annotation,
        generatedPageId: undefined,
        pageNumber: page.page_number,
      }));
      const normalizedImageAnnotations = storedPage.imageAnnotations.map((annotation) => ({
        ...annotation,
        generatedPageId: undefined,
        pageNumber: page.page_number,
      }));

      savedPageContentByKey[getPageSaveKey(documentId, page.page_number)] = serializeNotePageContent({
        inkStrokes: normalizedInkStrokes,
        textAnnotations: normalizedTextAnnotations,
        imageAnnotations: normalizedImageAnnotations,
        bookmarked: storedPage.bookmarked,
        photoReferenceCount: storedPage.photoReferenceCount,
        memoPageCount: storedPage.memoPageCount,
        handwritingRecognition: storedPage.handwritingRecognition,
      });
      documentInk.push(...normalizedInkStrokes);
      documentTextAnnotations.push(...normalizedTextAnnotations);
      documentImageAnnotations.push(...normalizedImageAnnotations);
    });

    setBackendPageIdsByDocument((current) => ({
      ...current,
      [documentId]: pageIdsByNumber,
    }));
    if (firstPageImageUrl || pages.length) {
      setUserStudyDocuments((current) => current.map((document) => {
        if (document.id !== documentId) return document;
        const legacyImageFile = firstPageImageUrl && !isPdfAssetUrl(firstPageImageUrl) ? { uri: firstPageImageUrl } : undefined;
        const legacyFile = !document.file && document.type !== 'pdf' ? legacyImageFile : document.file;
        const legacyFileUri = legacyFile && typeof legacyFile === 'object' && 'uri' in legacyFile ? legacyFile.uri : null;
        return {
          ...document,
          type: legacyFileUri && !isPdfAssetUrl(legacyFileUri) ? 'image' : document.type,
          pageCount: Math.max(document.pageCount, pages.length || 1),
          file: legacyFile,
        };
      }));
    }
    lastSavedPageContentRef.current = {
      ...lastSavedPageContentRef.current,
      ...savedPageContentByKey,
    };
    lastQueuedPageContentRef.current = {
      ...lastQueuedPageContentRef.current,
      ...savedPageContentByKey,
    };

    if (hasStoredPageContent) {
      setInkByDocument((current) => ({ ...current, [documentId]: documentInk }));
      setTextAnnotationsByDocument((current) => ({ ...current, [documentId]: documentTextAnnotations }));
      setImageAnnotationsByDocument((current) => ({ ...current, [documentId]: documentImageAnnotations }));
    }
    onBackendPagesLoaded?.(documentId, pages);
  }, [onBackendPagesLoaded, setImageAnnotationsByDocument, setInkByDocument, setTextAnnotationsByDocument, setUserStudyDocuments]);

  const markBackendPageDirty = useCallback((documentId: number, pageNumber: number) => {
    dirtyPageKeysRef.current.add(getPageSaveKey(documentId, pageNumber));
  }, []);

  const rememberSavedBackendNotePage = useCallback((documentId: number, page: BackendNotePage) => {
    const key = getPageSaveKey(documentId, page.page_number);
    const content = serializeBackendPageForSavedState(page);
    lastSavedPageContentRef.current[key] = content;
    lastQueuedPageContentRef.current[key] = content;
    dirtyPageKeysRef.current.delete(key);
    setPendingPageSaves((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setFailedPageSaveKeys((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!workspaceHydrated || !isBackendApiEnabled() || !studyDocumentId) return;
    const backendNoteId = getStudyDocumentBackendNoteId(studyDocument);
    if (!backendNoteId) return;
    if (backendPageIdsByDocument[studyDocumentId] || backendPageLoadsInFlightRef.current[studyDocumentId]) return;

    let mounted = true;
    backendPageLoadsInFlightRef.current[studyDocumentId] = true;

    const loadDocumentPages = async () => {
      try {
        const pages = await listBackendNotePages(backendNoteId);
        if (!mounted) return;
        applyLoadedBackendPages(studyDocumentId, pages);
      } catch {
        if (mounted) {
          setWorkspaceFeedback('노트 페이지를 불러오지 못했습니다. 서버 연결을 확인해주세요.');
        }
      } finally {
        delete backendPageLoadsInFlightRef.current[studyDocumentId];
      }
    };

    void loadDocumentPages();

    return () => {
      mounted = false;
    };
  }, [applyLoadedBackendPages, backendPageIdsByDocument, setWorkspaceFeedback, studyDocument, studyDocumentId, workspaceHydrated]);

  useEffect(() => {
    if (!workspaceHydrated || !isBackendApiEnabled()) return;

    const timer = setTimeout(() => {
      const nextPendingSaves: Record<string, PendingPageSave> = {};
      const clearedSaveKeys = new Set<string>();

      Array.from(dirtyPageKeysRef.current).forEach((key) => {
        const [documentIdText, pageNumberText] = key.split(':');
        const documentId = Number(documentIdText);
        const pageNumber = Number(pageNumberText);
        const pageId = backendPageIdsByDocument[documentId]?.[pageNumber];
        if (!documentId || !pageNumber || !pageId) return;

        const documentInk = inkByDocument[documentId] ?? [];
        const documentTextAnnotations = textAnnotationsByDocument[documentId] ?? [];
        const documentImageAnnotations = imageAnnotationsByDocument[documentId] ?? [];
        const pageInkStrokes = documentInk.filter((stroke) => !stroke.generatedPageId && (stroke.pageNumber ?? 1) === pageNumber);
        const pageTextAnnotations = documentTextAnnotations.filter((annotation) => !annotation.generatedPageId && annotation.pageNumber === pageNumber);
        const pageImageAnnotations = documentImageAnnotations.filter((annotation) => !annotation.generatedPageId && annotation.pageNumber === pageNumber);
        const pageBookmarked = (bookmarksByDocument[documentId] ?? []).some((bookmark) => (
          bookmark.page.kind === 'pdf' && bookmark.page.pageNumber === pageNumber
        ));
        const photoReferenceCount = (pageCaptureReferencesByDocument[documentId] ?? []).filter((reference) => (
          reference.page.kind === 'pdf' && reference.page.pageNumber === pageNumber
        )).length;
        const memoPageCount = (generatedPagesByDocument[documentId] ?? []).filter((page) => (
          page.pageKind === 'memo' && page.insertAfterPage === pageNumber
        )).length;

        const content = serializeNotePageContent({
          inkStrokes: pageInkStrokes,
          textAnnotations: pageTextAnnotations,
          imageAnnotations: pageImageAnnotations,
          bookmarked: pageBookmarked,
          photoReferenceCount,
          memoPageCount,
        });
        const savedContent = lastSavedPageContentRef.current[key];
        if (savedContent === undefined && content === EMPTY_PAGE_CONTENT) {
          lastSavedPageContentRef.current[key] = content;
          lastQueuedPageContentRef.current[key] = content;
          dirtyPageKeysRef.current.delete(key);
          return;
        }
        if (savedContent === content) {
          lastQueuedPageContentRef.current[key] = content;
          dirtyPageKeysRef.current.delete(key);
          clearedSaveKeys.add(key);
          return;
        }
        if (lastQueuedPageContentRef.current[key] === content) return;
        lastQueuedPageContentRef.current[key] = content;

        nextPendingSaves[key] = {
          pageId,
          documentId,
          pageNumber,
          content,
          attempts: 0,
          updatedAt: Date.now(),
        };
      });

      if (!Object.keys(nextPendingSaves).length && !clearedSaveKeys.size) return;

      setPendingPageSaves((current) => {
        let next = current;
        if (clearedSaveKeys.size) {
          next = { ...next };
          clearedSaveKeys.forEach((key) => {
            delete next[key];
          });
        }
        return {
          ...next,
          ...nextPendingSaves,
        };
      });
    }, 700);

    return () => clearTimeout(timer);
  }, [
    backendPageIdsByDocument,
    bookmarksByDocument,
    generatedPagesByDocument,
    imageAnnotationsByDocument,
    inkByDocument,
    pageCaptureReferencesByDocument,
    textAnnotationsByDocument,
    workspaceHydrated,
  ]);

  useEffect(() => {
    if (!workspaceHydrated || !isBackendApiEnabled()) return;

    const now = Date.now();
    const saveEntries = Object.entries(pendingPageSaves).filter(([key, pending]) => {
      if (savingPageKeys[key]) return false;
      if (pending.attempts === 0) return true;
      return now - pending.updatedAt >= Math.min(15000, 2500 * pending.attempts);
    });
    if (!saveEntries.length) return;

    saveEntries.forEach(([key, pending]) => {
      setSavingPageKeys((current) => ({ ...current, [key]: true }));
      void updateBackendNotePage({
        pageId: pending.pageId,
        content: pending.content,
      })
        .then(() => {
          lastSavedPageContentRef.current[key] = pending.content;
          lastQueuedPageContentRef.current[key] = pending.content;
          dirtyPageKeysRef.current.delete(key);
          setPendingPageSaves((current) => {
            const currentPending = current[key];
            if (!currentPending || currentPending.content !== pending.content) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
          setFailedPageSaveKeys((current) => {
            if (!current[key]) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
          onPageSaveSuccess?.(pending.documentId, pending.pageNumber);
        })
        .catch(() => {
          lastQueuedPageContentRef.current[key] = '';
          setPendingPageSaves((current) => {
            const currentPending = current[key];
            if (!currentPending || currentPending.content !== pending.content) return current;
            return {
              ...current,
              [key]: {
                ...currentPending,
                attempts: currentPending.attempts + 1,
                updatedAt: Date.now(),
              },
            };
          });
          setFailedPageSaveKeys((current) => ({ ...current, [key]: true }));
        })
        .finally(() => {
          setSavingPageKeys((current) => {
            const next = { ...current };
            delete next[key];
            return next;
          });
        });
    });
  }, [onPageSaveSuccess, pendingPageSaves, savingPageKeys, workspaceHydrated]);

  useEffect(() => {
    if (!Object.keys(failedPageSaveKeys).length) return;
    const timer = setTimeout(() => {
      setFailedPageSaveKeys({});
      setPendingPageSaves((current) => ({ ...current }));
    }, 3500);
    return () => clearTimeout(timer);
  }, [failedPageSaveKeys]);

  useEffect(() => {
    const now = Date.now();
    const retryDelays = Object.entries(pendingPageSaves)
      .filter(([key, pending]) => pending.attempts > 0 && !savingPageKeys[key])
      .map(([, pending]) => Math.max(0, Math.min(15000, 2500 * pending.attempts) - (now - pending.updatedAt)));
    if (!retryDelays.length) return;

    const timer = setTimeout(() => {
      setPendingPageSaves((current) => ({ ...current }));
    }, Math.min(...retryDelays));
    return () => clearTimeout(timer);
  }, [pendingPageSaves, savingPageKeys]);

  const syncPdfDocumentToBackend = useCallback(async (
    document: StudyDocumentEntry,
    targetSubject: Subject,
    uploadBlob?: Blob | null,
  ) => {
    if (!isBackendApiEnabled() || document.type !== 'pdf' || document.backendNoteId || pdfSyncInFlightRef.current[document.id]) {
      return;
    }

    const sourceUri = document.localFileUri
      ?? (document.file && typeof document.file === 'object' && 'uri' in document.file ? document.file.uri : null);
    if (!sourceUri) return;

    pdfSyncInFlightRef.current[document.id] = true;
    setUserStudyDocuments((current) => current.map((item) => (
      item.id === document.id
        ? { ...item, backendSyncStatus: 'syncing', backendSyncError: undefined }
        : item
    )));

    try {
      const folder = await ensureFolderForSubject({ name: targetSubject.name, color: targetSubject.color });
      const result = await uploadBackendPdfNote({
        file: {
          uri: sourceUri,
          name: document.title || `${targetSubject.name} PDF`,
          type: 'application/pdf',
          blob: uploadBlob ?? null,
        },
        folderId: folder.id,
        title: document.title || `${targetSubject.name} PDF`,
        summary: '업로드한 PDF 문서',
      });
      const pagesByNumber = Object.fromEntries(
        result.pages.map((page) => [page.page_number, page.id]),
      );
      setBackendPageIdsByDocument((current) => ({
        ...current,
        [document.id]: pagesByNumber,
      }));
      const remotePdfUrl = result.note.file_url ?? result.upload.url;
      setUserStudyDocuments((current) => current.map((item) => (
        item.id === document.id
          ? (() => {
            const hasTransientLocalFileUri = isTransientWebPdfUri(item.localFileUri);
            const shouldUseRemotePdf = Boolean(remotePdfUrl) && (!item.localFileUri || hasTransientLocalFileUri);
            return {
              ...item,
              backendNoteId: result.note.id,
              backendFolderId: result.note.folder_id,
              title: result.note.title,
              updatedAt: 'DB 저장됨',
              pageCount: Math.max(item.pageCount, result.note.page_count ?? result.upload.page_count),
              preview: result.note.summary ?? '업로드한 PDF 문서입니다.',
              file: shouldUseRemotePdf ? { uri: remotePdfUrl } : item.file,
              localFileUri: hasTransientLocalFileUri ? undefined : item.localFileUri,
              remoteFileUrl: remotePdfUrl,
              thumbnailUrl: result.note.thumbnail_url ?? result.upload.thumbnail_url ?? undefined,
              backendSyncStatus: 'synced',
              backendSyncError: undefined,
            };
          })()
          : item
      )));

      void extractBackendPdfText({ noteId: result.note.id })
        .then((textResult) => {
          const textPageIdsByNumber = textResult.pages.reduce<Record<number, number>>((next, page) => {
            next[page.page_number] = page.id;
            return next;
          }, {});
          setBackendPageIdsByDocument((current) => ({
            ...current,
            [document.id]: {
              ...(current[document.id] ?? {}),
              ...textPageIdsByNumber,
            },
          }));
          setUserStudyDocuments((current) => current.map((item) => (
            item.id === document.id
              ? { ...item, pageCount: Math.max(item.pageCount, textResult.pages_extracted) }
              : item
          )));
        })
        .catch(() => {
          setWorkspaceFeedback('PDF에서 텍스트 추출에 실패했어요.');
        });

      setWorkspaceFeedback(`${Math.max(document.pageCount, result.note.page_count ?? result.upload.page_count)}페이지 PDF를 서버에 저장했어요.`);
    } catch (error) {
      const syncError = error instanceof BackendApiError
        ? error.detail ?? (error.status ? `백엔드 저장에 실패했습니다. (${error.status})` : error.message)
        : '백엔드 저장에 실패했습니다.';
      setWorkspaceFeedback(`${syncError} PDF는 이 기기에 유지할게요.`);
      setUserStudyDocuments((current) => current.map((item) => (
        item.id === document.id
          ? {
            ...item,
            backendSyncStatus: 'failed',
            backendSyncError: syncError,
          }
          : item
      )));
    } finally {
      delete pdfSyncInFlightRef.current[document.id];
    }
  }, [setUserStudyDocuments, setWorkspaceFeedback]);

  useEffect(() => {
    if (!workspaceHydrated || !isBackendApiEnabled()) return;

    userStudyDocuments.forEach((document) => {
      if (document.type !== 'pdf' || document.backendSyncStatus !== 'syncing' || document.backendNoteId) return;
      const targetSubject = availableSubjects.find((item) => item.id === document.subjectId);
      if (!targetSubject) return;
      void syncPdfDocumentToBackend(document, targetSubject);
    });
  }, [availableSubjects, syncPdfDocumentToBackend, userStudyDocuments, workspaceHydrated]);

  return {
    backendPageIdsByDocument,
    setBackendPageIdsByDocument,
    markBackendPageDirty,
    rememberSavedBackendNotePage,
    syncPdfDocumentToBackend,
    failedPageSaveCount: Object.keys(failedPageSaveKeys).length,
    pendingPageSaveCount: Object.keys(pendingPageSaves).length,
    savingPageCount: Object.keys(savingPageKeys).length,
  };
}
