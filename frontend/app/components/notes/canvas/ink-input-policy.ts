import type { GestureResponderEvent } from 'react-native';

type PointerLikeTouch = {
  pointerType?: string;
  touchType?: string;
  type?: string;
  altitudeAngle?: number;
  azimuthAngle?: number;
  altitude?: number;
  azimuth?: number;
};

type InkInputNativeEvent = GestureResponderEvent['nativeEvent'] & {
  buttons?: number;
  pointerType?: string;
  touchType?: string;
  touches?: PointerLikeTouch[];
  changedTouches?: PointerLikeTouch[];
  altitudeAngle?: number;
  azimuthAngle?: number;
  altitude?: number;
  azimuth?: number;
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

function hasStylusOnlyMetrics(input: PointerLikeTouch | InkInputNativeEvent | null | undefined) {
  if (!input) return false;
  return (
    typeof input.altitudeAngle === 'number'
    || typeof input.azimuthAngle === 'number'
    || typeof input.altitude === 'number'
    || typeof input.azimuth === 'number'
  );
}

export function hasMultipleTouches(event: GestureResponderEvent) {
  const nativeEvent = event.nativeEvent as InkInputNativeEvent;
  return Boolean(nativeEvent.touches && nativeEvent.touches.length > 1);
}

export function isLikelyStylusEvent(event: GestureResponderEvent) {
  const nativeEvent = event.nativeEvent as InkInputNativeEvent;
  const touch = nativeEvent.changedTouches?.[0] ?? nativeEvent.touches?.[0] ?? null;
  const pointerType = getPointerType(event);
  return (
    pointerType === 'pen'
    || pointerType === 'stylus'
    || pointerType === 'pencil'
    || hasStylusOnlyMetrics(nativeEvent)
    || hasStylusOnlyMetrics(touch)
  );
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
