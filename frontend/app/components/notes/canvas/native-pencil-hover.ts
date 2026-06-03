import { InkEraserMode, InkTool } from '../../../ui-types';

export type PencilHoverPoint = { x: number; y: number };

const MIN_VISIBLE_HOVER_Z_OFFSET = 2.5;

export function shouldPreviewPencilHover(tool: InkTool) {
  return tool !== 'view' && tool !== 'text';
}

export function isStylusHoverEvent(event: unknown) {
  const nativeEvent = (event as { nativeEvent?: Record<string, unknown> } | null)?.nativeEvent ?? {};
  const pointerType = String(nativeEvent.pointerType ?? nativeEvent.touchType ?? nativeEvent.type ?? '').toLowerCase();

  if (pointerType === 'pen' || pointerType === 'stylus' || pointerType === 'pencil') return true;

  return typeof nativeEvent.altitudeAngle === 'number'
    || typeof nativeEvent.azimuthAngle === 'number'
    || typeof nativeEvent.tiltX === 'number'
    || typeof nativeEvent.tiltY === 'number'
    || typeof nativeEvent.tangentialPressure === 'number';
}

export function isPencilHoverFarEnough(event: unknown) {
  const nativeEvent = (event as { nativeEvent?: Record<string, unknown> } | null)?.nativeEvent ?? {};
  const phase = String(nativeEvent.phase ?? '').toLowerCase();
  if (phase === 'ended' || phase === 'cancelled') return false;

  const rawZOffset = nativeEvent.zOffset;
  const zOffset = typeof rawZOffset === 'number' ? rawZOffset : Number(rawZOffset);
  if (!Number.isFinite(zOffset)) return true;
  if (zOffset <= 0) {
    return typeof nativeEvent.altitudeAngle === 'number'
      || typeof nativeEvent.azimuthAngle === 'number'
      || typeof nativeEvent.rollAngle === 'number'
      || typeof nativeEvent.tiltX === 'number'
      || typeof nativeEvent.tiltY === 'number';
  }
  return zOffset >= MIN_VISIBLE_HOVER_Z_OFFSET;
}

export function getPencilHoverPoint(event: unknown): PencilHoverPoint | null {
  const nativeEvent = (event as { nativeEvent?: Record<string, unknown> } | null)?.nativeEvent ?? {};
  const rawX = nativeEvent.locationX ?? nativeEvent.x;
  const rawY = nativeEvent.locationY ?? nativeEvent.y;
  const x = typeof rawX === 'number' ? rawX : Number(rawX);
  const y = typeof rawY === 'number' ? rawY : Number(rawY);

  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

export function getPencilEraserRadius(penWidth: number, mode: InkEraserMode = 'partial') {
  return mode === 'stroke'
    ? Math.max(14, penWidth * 1.35)
    : Math.max(10, penWidth * 1.35);
}

export function getPencilHoverSize(tool: InkTool, penWidth: number, eraserMode: InkEraserMode = 'partial') {
  if (tool === 'erase') return getPencilEraserRadius(penWidth, eraserMode) * 2;
  if (tool === 'highlight') return 10;
  if (tool === 'select') return 10;
  return Math.max(8, Math.min(12, penWidth * 1.2));
}
