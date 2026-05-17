import type { GestureResponderEvent } from 'react-native';

type PointerLikeTouch = {
  pointerType?: string;
  touchType?: string;
  type?: string;
};

type InkInputNativeEvent = GestureResponderEvent['nativeEvent'] & {
  buttons?: number;
  pointerType?: string;
  touchType?: string;
  touches?: PointerLikeTouch[];
  changedTouches?: PointerLikeTouch[];
};

function getPointerType(event: GestureResponderEvent) {
  const nativeEvent = event.nativeEvent as InkInputNativeEvent;
  const touch = nativeEvent.changedTouches?.[0] ?? nativeEvent.touches?.[0] ?? null;
  const pointerType =
    nativeEvent.pointerType ??
    nativeEvent.touchType ??
    touch?.pointerType ??
    touch?.touchType ??
    touch?.type ??
    '';

  return String(pointerType).toLowerCase();
}

export function hasMultipleTouches(event: GestureResponderEvent) {
  const nativeEvent = event.nativeEvent as InkInputNativeEvent;
  return Boolean(nativeEvent.touches && nativeEvent.touches.length > 1);
}

export function isLikelyStylusEvent(event: GestureResponderEvent) {
  const pointerType = getPointerType(event);
  return pointerType === 'pen' || pointerType === 'stylus' || pointerType === 'pencil';
}

export function shouldUsePrimaryPointer(event: GestureResponderEvent) {
  const nativeEvent = event.nativeEvent as InkInputNativeEvent;
  if (hasMultipleTouches(event)) return false;
  if (nativeEvent.buttons !== undefined && nativeEvent.buttons !== 1) return false;
  return true;
}

export function shouldCaptureInkPointer(event: GestureResponderEvent, fingerDrawingEnabled: boolean) {
  if (!shouldUsePrimaryPointer(event)) return false;
  if (fingerDrawingEnabled) return true;
  return isLikelyStylusEvent(event);
}
