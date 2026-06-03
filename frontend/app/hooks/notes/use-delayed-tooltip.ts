import React from 'react';

export const DEFAULT_TOOLTIP_DELAY_MS = 400;

export function useDelayedTooltip(delayMs = DEFAULT_TOOLTIP_DELAY_MS) {
  const [activeTooltipId, setActiveTooltipId] = React.useState<string | null>(null);
  const [hoveredTooltipId, setHoveredTooltipId] = React.useState<string | null>(null);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTooltipTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  React.useEffect(() => clearTooltipTimer, [clearTooltipTimer]);

  const showTooltip = React.useCallback((id: string) => {
    clearTooltipTimer();
    setHoveredTooltipId(id);
    timerRef.current = setTimeout(() => {
      setActiveTooltipId(id);
      timerRef.current = null;
    }, delayMs);
  }, [clearTooltipTimer, delayMs]);

  const hideTooltip = React.useCallback((id?: string) => {
    clearTooltipTimer();
    setHoveredTooltipId((current) => (!id || current === id ? null : current));
    setActiveTooltipId((current) => (!id || current === id ? null : current));
  }, [clearTooltipTimer]);

  const getTooltipTriggerProps = React.useCallback((id: string, accessibilityLabel?: string) => ({
    accessibilityLabel: accessibilityLabel ?? id,
    onHoverIn: () => showTooltip(id),
    onHoverOut: () => hideTooltip(id),
    onFocus: () => showTooltip(id),
    onBlur: () => hideTooltip(id),
  }), [hideTooltip, showTooltip]);

  return {
    activeTooltipId,
    hoveredTooltipId,
    getTooltipTriggerProps,
    hideTooltip,
  };
}
