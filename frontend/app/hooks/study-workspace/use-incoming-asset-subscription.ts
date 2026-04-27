import { useEffect, type Dispatch, type SetStateAction } from 'react';
import type { CaptureAsset, NoteWorkspaceMode } from '../../types';
import { useSyncBridge } from '../use-sync-bridge';

export function useIncomingAssetSubscription(params: {
  noteWorkspaceMode: NoteWorkspaceMode;
  studyDocumentId: number | null;
  subjectId: number | null;
  setCaptureAssetsBySubject: Dispatch<SetStateAction<Record<number, CaptureAsset[]>>>;
  setIncomingBannerQueue: Dispatch<SetStateAction<CaptureAsset[]>>;
  setIncomingAssetSuggestion: Dispatch<SetStateAction<CaptureAsset | null>>;
}) {
  const syncBridge = useSyncBridge();
  const {
    noteWorkspaceMode,
    studyDocumentId,
    subjectId,
    setCaptureAssetsBySubject,
    setIncomingBannerQueue,
    setIncomingAssetSuggestion,
  } = params;

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
  }, [
    noteWorkspaceMode,
    setCaptureAssetsBySubject,
    setIncomingAssetSuggestion,
    setIncomingBannerQueue,
    studyDocumentId,
    subjectId,
    syncBridge,
  ]);
}
