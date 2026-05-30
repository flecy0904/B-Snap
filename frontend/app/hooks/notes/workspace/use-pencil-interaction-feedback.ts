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
}) {
  const { enabled, onFeedback } = params;
  const lastFeedbackAtRef = useRef(0);

  useEffect(() => {
    if (!enabled || !isPencilInteractionSupported()) return undefined;

    void getPencilInteractionState().catch(() => undefined);

    const subscription = addPencilInteractionListener((event) => {
      if (!isPrimaryPencilAction(event)) return;

      const now = Date.now();
      if (now - lastFeedbackAtRef.current < 900) return;
      lastFeedbackAtRef.current = now;

      onFeedback(event.type === 'squeeze'
        ? 'Apple Pencil squeeze로 도구 팔레트를 열었습니다.'
        : 'Apple Pencil double tap으로 도구 팔레트를 열었습니다.');
    });

    return () => subscription.remove();
  }, [enabled, onFeedback]);
}
