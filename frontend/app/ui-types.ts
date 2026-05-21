export type InkShape = 'line' | 'arrow' | 'rect' | 'ellipse';
export type InkTool = 'view' | 'pen' | 'highlight' | 'erase' | 'select' | 'text' | InkShape;
export type InkBrush = 'ballpoint' | 'fountain' | 'pencil' | 'marker' | 'highlighter';
export type InkLinePattern = 'solid' | 'dotted' | 'dashed';
export type InkSelectionMode = 'rect' | 'lasso';
export type InkBrushSettings = {
  stability: number;
  sharpness: number;
  density: number;
  pressure: number;
};
export type InkPageSize = { pageWidth?: number; pageHeight?: number };
export type InkPoint = { x: number; y: number; pageNumber?: number; generatedPageId?: string } & InkPageSize;
export type InkStroke = {
  id: string;
  points: InkPoint[];
  color: string;
  width: number;
  style?: 'pen' | 'highlight' | 'shape';
  brush?: InkBrush;
  brushSettings?: InkBrushSettings;
  linePattern?: InkLinePattern;
  shape?: InkShape;
  pageNumber?: number;
  generatedPageId?: string;
  historyGroupId?: string;
} & InkPageSize;
export type InkTextAnnotation = {
  id: string;
  pageNumber: number;
  generatedPageId?: string;
  x: number;
  y: number;
  width: number;
  height?: number;
  text: string;
  anchorRect?: SelectionRect | null;
} & InkPageSize;
export type SelectionRect = { x: number; y: number; width: number; height: number; mode?: InkSelectionMode; path?: InkPoint[] } & InkPageSize;
