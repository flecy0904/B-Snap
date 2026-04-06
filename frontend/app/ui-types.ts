export type InkTool = 'view' | 'pen' | 'select';
export type InkPoint = { x: number; y: number };
export type InkStroke = { id: string; points: InkPoint[]; color: string; width: number };
export type SelectionRect = { x: number; y: number; width: number; height: number };
