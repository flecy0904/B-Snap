import { InkTool } from '../../../ui-types';

export type NativeStylusData = {
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  altitudeAngle?: number;
  azimuthAngle?: number;
};

export type NativeInkGestureEvent = {
  x: number;
  y: number;
  numberOfPointers?: number;
  pointerType?: string | number;
  stylusData?: NativeStylusData;
};

export type NativeInkTouchEvent = {
  numberOfTouches?: number;
  pointerType?: string | number;
  stylusData?: NativeStylusData;
};

export type NativeGestureStateManager = {
  activate: () => void;
  fail: () => void;
};

function isNativeDrawingTool(tool: InkTool) {
  'worklet';
  return tool === 'pen'
    || tool === 'highlight'
    || tool === 'line'
    || tool === 'arrow'
    || tool === 'rect'
    || tool === 'ellipse';
}

function isNativeStylusOnlyTool(tool: InkTool) {
  'worklet';
  return isNativeDrawingTool(tool) || tool === 'erase';
}

function isNativeStylusPointer(pointerType: string | number | undefined) {
  'worklet';
  if (pointerType === 1) return true;
  const normalized = String(pointerType ?? '').toLowerCase();
  return normalized === 'stylus' || normalized === 'pen' || normalized === 'pencil';
}

function isNativeMousePointer(pointerType: string | number | undefined) {
  'worklet';
  if (pointerType === 2) return true;
  const normalized = String(pointerType ?? '').toLowerCase();
  return normalized === 'mouse';
}

function hasNativeStylusData(stylusData: NativeStylusData | undefined) {
  'worklet';
  if (!stylusData) return false;
  return typeof stylusData.pressure === 'number'
    || typeof stylusData.tiltX === 'number'
    || typeof stylusData.tiltY === 'number'
    || typeof stylusData.altitudeAngle === 'number'
    || typeof stylusData.azimuthAngle === 'number';
}

function isNativeStylusEvent(event: NativeInkTouchEvent | NativeInkGestureEvent) {
  'worklet';
  return isNativeStylusPointer(event.pointerType) || hasNativeStylusData(event.stylusData);
}

export function shouldActivateNativeInkGesture(
  tool: InkTool,
  event: NativeInkTouchEvent | NativeInkGestureEvent,
  fingerDrawingEnabled: boolean | undefined,
  allowUnknownPointerAsStylus = false,
  allowMousePointer = false,
) {
  'worklet';
  const pointerCount = (event as NativeInkTouchEvent).numberOfTouches ?? (event as NativeInkGestureEvent).numberOfPointers;
  if ((pointerCount ?? 1) > 1) return false;
  const pointerType = event.pointerType;
  const hasPointerType = pointerType !== undefined && pointerType !== null && String(pointerType).length > 0;
  const mouseEvent = allowMousePointer && isNativeMousePointer(pointerType);
  const stylusEvent = isNativeStylusEvent(event)
    || (allowUnknownPointerAsStylus && !hasPointerType && !hasNativeStylusData(event.stylusData));
  if (tool === 'select') return stylusEvent || mouseEvent;
  if (isNativeStylusOnlyTool(tool)) return Boolean(fingerDrawingEnabled) || stylusEvent || mouseEvent;
  return tool === 'text' && (stylusEvent || mouseEvent);
}
