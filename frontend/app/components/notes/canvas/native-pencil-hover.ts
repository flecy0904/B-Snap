import { InkEraserMode, InkTool } from '../../../ui-types';

export type PencilHoverPoint = { x: number; y: number };

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
    ? Math.max(18, penWidth * 3.2)
    : Math.max(9, penWidth * 2.1);
}

export function getPencilHoverSize(tool: InkTool, penWidth: number, eraserMode: InkEraserMode = 'partial') {
  if (tool === 'erase') return getPencilEraserRadius(penWidth, eraserMode) * 2;
  if (tool === 'highlight') return Math.max(18, penWidth * 2.2);
  if (tool === 'select') return 18;
  return Math.max(10, penWidth * 3);
}

export function getPencilHoverToolLabel(tool: InkTool, eraserMode: InkEraserMode = 'partial') {
  if (tool === 'pen') return '필기';
  if (tool === 'highlight') return '형광펜';
  if (tool === 'erase') return eraserMode === 'stroke' ? '획 지우개' : '부분 지우개';
  if (tool === 'select') return '선택';
  if (tool === 'text') return '텍스트';
  if (tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'ellipse') return '도형';
  return '';
}
