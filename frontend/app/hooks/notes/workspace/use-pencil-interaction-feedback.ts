import { useEffect, useRef } from 'react';
import { addPencilInteractionListener, getPencilInteractionState, isPencilInteractionSupported, type PencilInteractionEvent } from '../../../services/pencil-interaction';

type Feedback = (message: string) => void;

function isPrimaryPencilAction(event: PencilInteractionEvent) {
  if (event.type === 'tap') return true;
  return event.type === 'squeeze' && event.phase === 'began';
}

export function usePencilInteractionFeedback(params: {
  enabled: boolean;
  onFeedback: Feedback;
  onPrimaryAction?: (event: PencilInteractionEvent) => void;
  getFeedbackMessage?: (event: PencilInteractionEvent) => string | null;
}) {
  const { enabled, getFeedbackMessage, onFeedback, onPrimaryAction } = params;
  const lastFeedbackAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || !isPencilInteractionSupported()) return undefined;

    void getPencilInteractionState().catch(() => undefined);

    const subscription = addPencilInteractionListener((event) => {
      if (!isPrimaryPencilAction(event)) return;
      onPrimaryAction?.(event);

      const now = Date.now();
      if (now - lastFeedbackAtRef.current < 900) return;
      lastFeedbackAtRef.current = now;

      const message = getFeedbackMessage?.(event) ?? (
        event.type === 'squeeze'
          ? 'Apple Pencil squeeze 입력을 감지했습니다.'
          : 'Apple Pencil double tap 입력을 감지했습니다.'
      );
      if (message) onFeedback(message);
    });

    return () => subscription.remove();
  }, [enabled, getFeedbackMessage, onFeedback, onPrimaryAction]);
}
