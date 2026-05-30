import { useEffect, useMemo, useState } from 'react';

const WORKSPACE_FEEDBACK_CLEAR_MS = 2200;

export function useWorkspaceFeedback() {
  const [workspaceFeedback, setWorkspaceFeedback] = useState<string | null>(null);

  useEffect(() => {
    if (!workspaceFeedback) return undefined;
    const timer = setTimeout(() => setWorkspaceFeedback(null), WORKSPACE_FEEDBACK_CLEAR_MS);
    return () => clearTimeout(timer);
  }, [workspaceFeedback]);

  return {
    workspaceFeedback,
    setWorkspaceFeedback,
  };
}

export function useWorkspaceSaveStatus(params: {
  workspaceFeedback: string | null;
  failedPageSaveCount: number;
  pendingPageSaveCount: number;
  savingPageCount: number;
  workspaceHydrated: boolean;
}) {
  return useMemo(() => {
    const documentSaveStatus = params.failedPageSaveCount
      ? `저장 실패 ${params.failedPageSaveCount} · 재시도 중`
      : params.savingPageCount
        ? `저장 중 ${params.savingPageCount}`
        : params.pendingPageSaveCount
          ? `저장 대기 ${params.pendingPageSaveCount}`
          : params.workspaceHydrated
            ? '저장됨'
            : '저장 준비 중';

    return {
      effectiveWorkspaceFeedback: null,
      documentSaveStatus,
    };
  }, [
    params.failedPageSaveCount,
    params.pendingPageSaveCount,
    params.savingPageCount,
    params.workspaceFeedback,
    params.workspaceHydrated,
  ]);
}
