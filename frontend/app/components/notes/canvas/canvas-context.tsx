import React, { createContext, useContext } from 'react';
import type { InkBrush, InkBrushSettings, InkEraserMode, InkLinePattern, InkPoint, InkSelectionMode, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { useNotesGlobalContext } from '../workspace/notes-global-context';

export type CanvasState = {
  inkTool: InkTool;
  fingerDrawingEnabled: boolean;
  penColor: string;
  penWidth: number;
  brushType: InkBrush;
  linePattern: InkLinePattern;
  eraserMode: InkEraserMode;
  eraserWidth: number;
  selectionMode: InkSelectionMode;
  brushSettings: InkBrushSettings;
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  selectionRect: SelectionRect | null;
  selectionPreviewUri: string | null;
  inkByDocument: Record<number, InkStroke[]>;
  redoInkByDocument: Record<number, InkStroke[]>;
  textAnnotationsByDocument: Record<number, InkTextAnnotation[]>;
};

export type CanvasActions = {
  setInkTool: (tool: InkTool) => void;
  setPenColor: (color: string) => void;
  setPenWidth: (width: number) => void;
  setBrushType: (brush: InkBrush) => void;
  setLinePattern: (pattern: InkLinePattern) => void;
  setEraserMode: (mode: InkEraserMode) => void;
  setEraserWidth: (width: number) => void;
  setSelectionMode: (mode: InkSelectionMode) => void;
  setBrushSettings: (settings: Partial<InkBrushSettings>) => void;
  setSelectionRect: (rect: SelectionRect | null) => void;
  setSelectionPreviewUri: (uri: string | null) => void;
  clearCurrentSelection: () => void;
  clearInk: () => void;
  undoInk: () => void;
  redoInk: () => void;
  commitInkStroke: (stroke: InkStroke) => void;
  removeInkStroke: (strokeId: string) => void;
  addTextAnnotation: (point: InkPoint) => void;
  updateTextAnnotation: (id: string, text: string) => void;
  removeTextAnnotation: (id: string) => void;
  moveTextAnnotation: (id: string, x: number, y: number) => void;
  resizeTextAnnotation: (id: string, width: number, height: number) => void;
  eraseInkAtPoint: (point: InkPoint, radius: number, snapshot?: boolean, mode?: InkEraserMode) => boolean;
  deleteSelectedStrokes: () => void;
  changeSelectedStrokesColor: (color: string) => void;
  duplicateSelectedStrokes: () => void;
  resizeSelectedStrokes: (scale: number) => void;
  resizeSelectedStrokesToRect: (rect: SelectionRect) => void;
  nudgeSelectedStrokes: (dx: number, dy: number) => void;
};

const CanvasContext = createContext<(CanvasState & CanvasActions) | null>(null);

export function CanvasProvider({ children }: { children: React.ReactNode }) {
  const globalContext = useNotesGlobalContext();

  const value = {
    inkTool: globalContext.inkTool,
    fingerDrawingEnabled: Boolean(globalContext.fingerDrawingEnabled),
    penColor: globalContext.penColor,
    penWidth: globalContext.penWidth,
    brushType: globalContext.brushType,
    linePattern: globalContext.linePattern,
    eraserMode: globalContext.eraserMode ?? 'partial',
    eraserWidth: globalContext.eraserWidth ?? 6,
    selectionMode: globalContext.selectionMode ?? 'rect',
    brushSettings: globalContext.brushSettings,
    inkStrokes: globalContext.inkStrokes ?? [],
    textAnnotations: globalContext.textAnnotations ?? [],
    selectionRect: globalContext.selectionRect ?? null,
    selectionPreviewUri: globalContext.selectionPreviewUri ?? null,
    inkByDocument: globalContext.inkByDocument ?? {},
    redoInkByDocument: globalContext.redoInkByDocument ?? {},
    textAnnotationsByDocument: globalContext.textAnnotationsByDocument ?? {},
    setInkTool: globalContext.onChangeInkTool,
    setPenColor: globalContext.onChangePenColor,
    setPenWidth: globalContext.onChangePenWidth,
    setBrushType: globalContext.onChangeBrushType,
    setLinePattern: globalContext.onChangeLinePattern,
    setEraserMode: globalContext.onChangeEraserMode,
    setEraserWidth: globalContext.onChangeEraserWidth,
    setSelectionMode: globalContext.onChangeSelectionMode,
    setBrushSettings: globalContext.onChangeBrushSettings,
    setSelectionRect: globalContext.onSelectionChange,
    setSelectionPreviewUri: globalContext.onSelectionPreviewChange,
    clearCurrentSelection: globalContext.onClearSelection,
    clearInk: globalContext.onClearInk,
    undoInk: globalContext.onUndoInk,
    redoInk: globalContext.onRedoInk,
    commitInkStroke: globalContext.onCommitInkStroke,
    removeInkStroke: globalContext.onRemoveInkStroke,
    addTextAnnotation: globalContext.onAddTextAnnotation,
    updateTextAnnotation: globalContext.onUpdateTextAnnotation,
    removeTextAnnotation: globalContext.onRemoveTextAnnotation,
    moveTextAnnotation: globalContext.onMoveTextAnnotation,
    resizeTextAnnotation: globalContext.onResizeTextAnnotation,
    eraseInkAtPoint: globalContext.onEraseInkAtPoint,
    deleteSelectedStrokes: globalContext.deleteSelectedStrokes,
    changeSelectedStrokesColor: globalContext.changeSelectedStrokesColor,
    duplicateSelectedStrokes: globalContext.duplicateSelectedStrokes,
    resizeSelectedStrokes: globalContext.resizeSelectedStrokes,
    resizeSelectedStrokesToRect: globalContext.resizeSelectedStrokesToRect,
    nudgeSelectedStrokes: globalContext.nudgeSelectedStrokes,
  };

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}

export function useCanvasContext() {
  const context = useContext(CanvasContext);
  if (!context) {
    throw new Error('useCanvasContext must be used within a CanvasProvider');
  }
  return context;
}
