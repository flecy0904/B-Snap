import type { ComponentProps } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { InkBrush, InkBrushSettings, InkLinePattern, InkSelectionMode, InkTool } from '../../../ui-types';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type DetailMode = 'pen' | 'highlight' | 'shape';
export type DetailAnchor = InkBrush | 'shape' | null;
export type PenBrush = Extract<InkBrush, 'ballpoint' | 'pencil' | 'marker'>;

export const SHAPE_TOOLS: Array<{ tool: InkTool; icon: IconName }> = [
  { tool: 'line', icon: 'vector-line' },
  { tool: 'arrow', icon: 'arrow-top-right' },
  { tool: 'rect', icon: 'rectangle-outline' },
  { tool: 'ellipse', icon: 'circle-outline' },
];

export const PEN_BRUSHES: Array<{ brush: PenBrush; label: string; icon: IconName }> = [
  { brush: 'ballpoint', label: '볼펜', icon: 'pencil-outline' },
  { brush: 'pencil', label: '연필', icon: 'lead-pencil' },
  { brush: 'marker', label: '마커', icon: 'marker' },
];

export const FAVORITE_PEN_COLORS = ['#111827', '#E11D48', '#2563EB', '#FFFFFF'];
export const FAVORITE_HIGHLIGHT_COLORS = ['#FDE047', '#FB7185', '#86EFAC', '#9FD1EE'];
export const PEN_COLORS = [...FAVORITE_PEN_COLORS, '#F5AFC8', '#8DBA98', '#C4B5FD'];
export const HIGHLIGHT_COLORS = [...FAVORITE_HIGHLIGHT_COLORS, '#FDBA74', '#C4B5FD'];
export const PEN_WIDTHS = [2, 3, 4, 6, 8, 10];
export const HIGHLIGHT_WIDTHS = [10, 12, 16, 20, 24, 30];
export const QUICK_PEN_WIDTHS = [2, 4, 8];
export const QUICK_HIGHLIGHT_WIDTHS = [12, 18, 24];

export const LINE_PATTERNS: Array<{ pattern: Exclude<InkLinePattern, 'dashed'>; label: string }> = [
  { pattern: 'solid', label: '실선' },
  { pattern: 'dotted', label: '점선' },
];

export const SELECTION_MODES: Array<{ mode: InkSelectionMode; label: string; icon: IconName }> = [
  { mode: 'rect', label: '네모', icon: 'selection-drag' },
  { mode: 'lasso', label: '올가미', icon: 'lasso' },
];

export const BRUSH_LABELS: Record<InkBrush, string> = {
  ballpoint: '볼펜',
  fountain: '볼펜',
  pencil: '연필',
  marker: '마커',
  highlighter: '형광펜',
};

export const ADVANCED_CONTROLS: Array<{ key: keyof InkBrushSettings; label: string; hint?: string }> = [
  { key: 'stability', label: '손떨림 보정', hint: '낮으면 펜슬 움직임 그대로, 높으면 선이 더 매끈해져요.' },
  { key: 'sharpness', label: '끝 처리' },
  { key: 'pressure', label: '압력 반응' },
  { key: 'density', label: '농도' },
];

export const PREVIEW_PATH = 'M 22 50 C 72 18 116 22 154 50 S 218 58 238 28';

export function isShapeTool(tool: InkTool) {
  return tool === 'line' || tool === 'arrow' || tool === 'rect' || tool === 'ellipse';
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
