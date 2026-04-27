import { useEffect, useState } from 'react';
import {
  loadStudyWorkspaceState,
  saveStudyWorkspaceState,
  type PersistedStudyWorkspaceState,
} from '../../storage/local-workspace-store';

export function useStudyWorkspacePersistence({
  state,
  onHydrate,
}: {
  state: PersistedStudyWorkspaceState;
  onHydrate: (state: PersistedStudyWorkspaceState | null) => void;
}) {
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false);
  const [localPersistenceError, setLocalPersistenceError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    loadStudyWorkspaceState()
      .then((snapshot) => {
        if (!mounted) return;
        onHydrate(snapshot?.version === 1 ? snapshot : null);
        setWorkspaceHydrated(true);
      })
      .catch(() => {
        if (!mounted) return;
        setLocalPersistenceError('로컬 저장소를 불러오지 못했습니다.');
        setWorkspaceHydrated(true);
      });

    return () => {
      mounted = false;
    };
  }, [onHydrate]);

  useEffect(() => {
    if (!workspaceHydrated) return;

    const timer = setTimeout(() => {
      saveStudyWorkspaceState(state)
        .then(() => setLocalPersistenceError(null))
        .catch(() => setLocalPersistenceError('로컬 저장소에 저장하지 못했습니다.'));
    }, 450);

    return () => clearTimeout(timer);
  }, [state, workspaceHydrated]);

  return {
    workspaceHydrated,
    localPersistenceError,
  };
}
