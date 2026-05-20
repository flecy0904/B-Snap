import { useEffect, useRef, useState } from 'react';

import { isBackendApiEnabled, updateBackendNotePage } from '../../../services/backend-api';
import type { InkStroke, InkTextAnnotation } from '../../../ui-types';
import { serializeNotePageContent } from './note-page-content';

type PendingPageSave = {
  pageId: number;
  documentId: number;
  pageNumber: number;
  content: string;
  attempts: number;
  updatedAt: number;
};

type UseBackendPageAutosaveParams = {
  workspaceHydrated: boolean;
  backendPageIdsByDocument: Record<number, Record<number, number>>;
  inkByDocument: Record<number, InkStroke[]>;
  textAnnotationsByDocument: Record<number, InkTextAnnotation[]>;
};

export function useBackendPageAutosave({
  workspaceHydrated,
  backendPageIdsByDocument,
  inkByDocument,
  textAnnotationsByDocument,
}: UseBackendPageAutosaveParams) {
  const [pendingPageSaves, setPendingPageSaves] = useState<Record<string, PendingPageSave>>({});
  const [savingPageKeys, setSavingPageKeys] = useState<Record<string, true>>({});
  const [failedPageSaveKeys, setFailedPageSaveKeys] = useState<Record<string, true>>({});
  const lastQueuedPageContentRef = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!workspaceHydrated || !isBackendApiEnabled()) return;

    const timer = setTimeout(() => {
      const nextPendingSaves: Record<string, PendingPageSave> = {};

      Object.entries(backendPageIdsByDocument).forEach(([documentIdText, pagesByNumber]) => {
        const documentId = Number(documentIdText);
        const documentInk = inkByDocument[documentId] ?? [];
        const documentTextAnnotations = textAnnotationsByDocument[documentId] ?? [];

        Object.entries(pagesByNumber).forEach(([pageNumberText, pageId]) => {
          const pageNumber = Number(pageNumberText);
          const pageInkStrokes = documentInk.filter((stroke) => !stroke.generatedPageId && (stroke.pageNumber ?? 1) === pageNumber);
          const pageTextAnnotations = documentTextAnnotations.filter((annotation) => !annotation.generatedPageId && annotation.pageNumber === pageNumber);
          const key = `${documentId}:${pageNumber}`;

          const content = serializeNotePageContent({
            inkStrokes: pageInkStrokes,
            textAnnotations: pageTextAnnotations,
          });
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
      });

      setPendingPageSaves((current) => ({
        ...current,
        ...nextPendingSaves,
      }));
    }, 700);

    return () => clearTimeout(timer);
  }, [backendPageIdsByDocument, inkByDocument, textAnnotationsByDocument, workspaceHydrated]);

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
  }, [pendingPageSaves, savingPageKeys, workspaceHydrated]);

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

  return {
    failedPageSaveCount: Object.keys(failedPageSaveKeys).length,
    pendingPageSaveCount: Object.keys(pendingPageSaves).length,
    savingPageCount: Object.keys(savingPageKeys).length,
  };
}
