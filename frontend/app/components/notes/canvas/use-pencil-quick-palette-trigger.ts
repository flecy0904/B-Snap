import { useEffect, useRef, useState } from 'react';
import { addPencilInteractionListener, isPencilInteractionSupported, type PencilInteractionEvent } from '../../../services/pencil-interaction';

const QUICK_PALETTE_VISIBLE_MS = 2600;

function shouldOpenQuickPalette(event: PencilInteractionEvent) {
  if (event.type === 'tap') return true;
  return event.type === 'squeeze' && event.phase === 'began';
}

export function usePencilQuickPaletteTrigger(enabled: boolean) {
  const [visible, setVisible] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeInteractionSupported = isPencilInteractionSupported();

  useEffect(() => {
    if (!enabled || !nativeInteractionSupported) return undefined;

    const subscription = addPencilInteractionListener((event) => {
      if (!shouldOpenQuickPalette(event)) return;

      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
      }

      setVisible(true);
      closeTimerRef.current = setTimeout(() => {
        setVisible(false);
        closeTimerRef.current = null;
      }, QUICK_PALETTE_VISIBLE_MS);
    });

    return () => {
      subscription.remove();
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [enabled, nativeInteractionSupported]);

  return enabled && (!nativeInteractionSupported || visible);
}
