export type InkShape = 'line' | 'arrow' | 'rect' | 'ellipse';
export type InkTool = 'view' | 'pen' | 'highlight' | 'erase' | 'select' | 'text' | InkShape;
export type InkPageSize = { pageWidth?: number; pageHeight?: number };
export type InkPoint = { x: number; y: number; pageNumber?: number; generatedPageId?: string } & InkPageSize;
export type InkStroke = {
  id: string;
  points: InkPoint[];
  color: string;
  width: number;
  style?: 'pen' | 'highlight' | 'shape';
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
  text: string;
  anchorRect?: SelectionRect | null;
} & InkPageSize;
export type SelectionRect = { x: number; y: number; width: number; height: number } & InkPageSize;
