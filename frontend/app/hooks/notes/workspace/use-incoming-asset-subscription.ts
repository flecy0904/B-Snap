import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import type { CaptureAsset, NoteWorkspaceMode } from '../../../types';
import { useSyncBridge } from '../../use-sync-bridge';

export function useIncomingAssetSubscription(params: {
  noteWorkspaceMode: NoteWorkspaceMode;
  studyDocumentId: number | null;
  subjectId: number | null;
  setCaptureAssetsBySubject: Dispatch<SetStateAction<Record<number, CaptureAsset[]>>>;
  setIncomingBannerQueue: Dispatch<SetStateAction<CaptureAsset[]>>;
  setIncomingAssetSuggestion: Dispatch<SetStateAction<CaptureAsset | null>>;
  onAutoLinkAsset?: (asset: CaptureAsset) => void | Promise<void>;
}) {
  const syncBridge = useSyncBridge();
  const {
    noteWorkspaceMode,
    studyDocumentId,
    subjectId,
    setCaptureAssetsBySubject,
    setIncomingBannerQueue,
    setIncomingAssetSuggestion,
    onAutoLinkAsset,
  } = params;
  const autoLinkAssetRef = useRef(onAutoLinkAsset);

  useEffect(() => {
    autoLinkAssetRef.current = onAutoLinkAsset;
  }, [onAutoLinkAsset]);

  useEffect(() => {
    return syncBridge.subscribeToAssets(({ asset }) => {
      const shouldSuggest = noteWorkspaceMode === 'note' && !!studyDocumentId && subjectId === asset.subjectId;
      const autoLinkAsset = autoLinkAssetRef.current;
      const nextAsset = shouldSuggest
        ? { ...asset, status: autoLinkAsset ? 'accepted' as const : 'suggested' as const }
        : asset;

      setCaptureAssetsBySubject((current) => {
        const currentSubjectAssets = current[asset.subjectId] ?? [];
        if (currentSubjectAssets.some((item) => item.id === asset.id)) return current;
        return {
          ...current,
          [asset.subjectId]: [nextAsset, ...currentSubjectAssets],
        };
      });

      if (shouldSuggest && autoLinkAsset) {
        void autoLinkAsset(asset);
      } else if (shouldSuggest) {
        setIncomingBannerQueue((current) => (
          current.some((item) => item.id === asset.id) ? current : [...current, asset]
        ));
        setIncomingAssetSuggestion(nextAsset);
      } else {
        setIncomingBannerQueue((current) => (
          current.some((item) => item.id === asset.id) ? current : [...current, asset]
        ));
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
