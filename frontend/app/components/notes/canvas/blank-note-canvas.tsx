import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, memo } from 'react';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image, PanResponder, Platform, Pressable, ScrollView, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { TextAnnotationLayer } from './text-annotation-layer';
import { InkPath } from './ink-path';
import { SelectionContextMenu, isPointInSelectionContextMenu } from './selection-context-menu';
import { PencilHoverOverlay } from './pencil-hover-overlay';
import { SelectionLassoOverlay, SelectionOverlay } from './selection-overlays';
import { SelectionMovePreview, getSelectedObjectIdsForSelection, getSelectionMovePreview } from './selection-move-preview';
import { buildSelectionRectFromDrag, buildSelectionRectFromPoints, finalizeInkStroke, isDrawingTool, isShapeTool, resolveInkStrokeAppearance, resolveShapeStrokeAppearance, scaleInkStrokeToPageSize, scaleSelectionRectToPageSize, shouldAppendInkPoint } from '../../../ui-helpers';
import { InkImageAnnotation, InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import type { NotebookPageTemplate } from '../../../types';
import { useCanvasContext } from './canvas-context';
import { shouldActivateNativeInkGesture, type NativeGestureStateManager, type NativeInkGestureEvent, type NativeInkTouchEvent } from './native-ink-gesture-policy';
import { getPencilEraserRadius, getPencilHoverPoint, getPencilHoverSize, isPencilHoverFarEnough, isStylusHoverEvent, shouldPreviewPencilHover, type PencilHoverPoint } from './native-pencil-hover';
import { useNotesGlobalContext } from '../workspace/notes-global-context';
import { useDocumentContext } from '../workspace/document-context';

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type BlankNotePageCanvasProps = {
  backgroundImageUri?: string | null;
  styles: any;
  pageNumber?: number;
  currentPage?: number;
  generatedPageId?: string;
  template: NotebookPageTemplate;
  pageWidth?: number;
  pageHeight?: number;
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  imageAnnotations: InkImageAnnotation[];
  onPageFocus?: (pageNumber: number) => void;
  readOnly?: boolean;
};

const BLANK_NOTE_ASPECT_RATIO = 0.68;
const BLANK_NOTE_PAGE_GAP = 26;
const BLANK_NOTE_WEB_VERTICAL_FIT_INSET = 42;

function isStrokeOnBlankCanvasPage(stroke: InkStroke, pageNumber?: number, generatedPageId?: string) {
  if (generatedPageId) return stroke.generatedPageId === generatedPageId;
  if (stroke.generatedPageId) return false;
  return (stroke.pageNumber ?? 1) === (pageNumber ?? 1);
}

function isTextAnnotationOnBlankCanvasPage(annotation: InkTextAnnotation, pageNumber?: number, generatedPageId?: string) {
  if (generatedPageId) return annotation.generatedPageId === generatedPageId;
  if (annotation.generatedPageId) return false;
  return (annotation.pageNumber ?? 1) === (pageNumber ?? 1);
}

function isImageAnnotationOnBlankCanvasPage(annotation: InkImageAnnotation, pageNumber?: number, generatedPageId?: string) {
  if (generatedPageId) return annotation.generatedPageId === generatedPageId;
  if (annotation.generatedPageId) return false;
  return (annotation.pageNumber ?? 1) === (pageNumber ?? 1);
}

function isSelectionOnBlankCanvasPage(selection: SelectionRect | null, pageNumber?: number, generatedPageId?: string) {
  if (!selection) return false;
  if (generatedPageId) return selection.generatedPageId === generatedPageId;
  if (selection.generatedPageId) return false;
  return (selection.pageNumber ?? 1) === (pageNumber ?? 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getResizeCorner(rect: SelectionRect | null, point: InkPoint): ResizeCorner | null {
  if (!rect) return null;
  const threshold = 24;
  const corners: Array<{ corner: ResizeCorner; x: number; y: number }> = [
    { corner: 'nw', x: rect.x, y: rect.y },
    { corner: 'ne', x: rect.x + rect.width, y: rect.y },
    { corner: 'sw', x: rect.x, y: rect.y + rect.height },
    { corner: 'se', x: rect.x + rect.width, y: rect.y + rect.height },
  ];
  return corners.find((corner) => Math.hypot(point.x - corner.x, point.y - corner.y) <= threshold)?.corner ?? null;
}

function resizeRectFromCorner(source: SelectionRect, corner: ResizeCorner, point: InkPoint): SelectionRect {
  const minSize = 24;
  const right = source.x + source.width;
  const bottom = source.y + source.height;
  const nextLeft = corner === 'nw' || corner === 'sw' ? Math.min(point.x, right - minSize) : source.x;
  const nextRight = corner === 'ne' || corner === 'se' ? Math.max(point.x, source.x + minSize) : right;
  const nextTop = corner === 'nw' || corner === 'ne' ? Math.min(point.y, bottom - minSize) : source.y;
  const nextBottom = corner === 'sw' || corner === 'se' ? Math.max(point.y, source.y + minSize) : bottom;
  return {
    x: Math.max(0, nextLeft),
    y: Math.max(0, nextTop),
    width: Math.max(minSize, nextRight - nextLeft),
    height: Math.max(minSize, nextBottom - nextTop),
    pageNumber: source.pageNumber,
    generatedPageId: source.generatedPageId,
    pageWidth: point.pageWidth,
    pageHeight: point.pageHeight,
  };
}

function translateSelectionRect(source: SelectionRect, dx: number, dy: number, pageWidth: number, pageHeight: number): SelectionRect {
  const boundedX = clamp(source.x + dx, 0, Math.max(0, pageWidth - source.width));
  const boundedY = clamp(source.y + dy, 0, Math.max(0, pageHeight - source.height));
  const moveDx = boundedX - source.x;
  const moveDy = boundedY - source.y;
  return {
    ...source,
    x: boundedX,
    y: boundedY,
    path: source.path?.map((point) => ({
      ...point,
      x: point.x + moveDx,
      y: point.y + moveDy,
      pageWidth,
      pageHeight,
    })),
    pageWidth,
    pageHeight,
  };
}

const StaticStrokes = memo(({ strokes, type }: { strokes: InkStroke[]; type: 'highlight' | 'ink' }) => {
  const filteredStrokes = useMemo(
    () => strokes.filter((stroke) => (type === 'highlight' ? stroke.style === 'highlight' : stroke.style !== 'highlight')),
    [strokes, type],
  );

  return (
    <>
      {filteredStrokes.map((stroke) => {
        return <InkPath key={stroke.id} stroke={stroke} />;
      })}
    </>
  );
});

function BlankNoteTemplateLayer(props: {
  template: NotebookPageTemplate;
  pageWidth: number;
  pageHeight: number;
  styles: any;
}) {
  if (props.template === 'plain' || props.pageWidth <= 0 || props.pageHeight <= 0) return null;

  const spacing = props.template === 'grid' ? 32 : 34;
  const horizontalCount = Math.floor(props.pageHeight / spacing);
  const verticalCount = Math.floor(props.pageWidth / spacing);

  return (
    <View pointerEvents="none" style={props.styles.blankNoteRuleLayer}>
      {Array.from({ length: horizontalCount }).map((_, index) => (
        <View
          key={`h-${index}`}
          style={[
            props.styles.blankNoteRuleLine,
            {
              top: 28 + index * spacing,
              backgroundColor: props.template === 'grid' ? '#E7EDF7' : '#DFE8F4',
              opacity: props.template === 'grid' ? 0.82 : 0.95,
            },
          ]}
        />
      ))}
      {props.template === 'grid'
        ? Array.from({ length: verticalCount }).map((_, index) => (
          <View
            key={`v-${index}`}
            style={[
              props.styles.blankNoteGridLineVertical,
              {
                left: 28 + index * spacing,
              },
            ]}
          />
        ))
        : null}
    </View>
  );
}

function BlankNotePageCanvas(props: BlankNotePageCanvasProps) {
  const canvasCtx = useCanvasContext();
  const workspaceContext = useNotesGlobalContext();
  const {
    inkTool,
    fingerDrawingEnabled,
    penColor,
    penWidth,
    brushType,
    linePattern,
    selectionMode,
    brushSettings,
    selectionRect,
    commitInkStroke: onCommitInkStroke,
    addTextAnnotation: onAddTextAnnotation,
    updateTextAnnotation: onUpdateTextAnnotation,
    removeTextAnnotation: onRemoveTextAnnotation,
    moveTextAnnotation: onMoveTextAnnotation,
    resizeTextAnnotation: onResizeTextAnnotation,
    changeTextAnnotationFontSize: onChangeTextAnnotationFontSize,
    setSelectionRect: onSelectionChange,
    setSelectionPreviewUri: onSelectionPreviewChange,
  } = canvasCtx;
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const pageRenderWidth = pageSize.width || props.pageWidth || 1000;
  const pageRenderHeight = pageSize.height || props.pageHeight || 1000;
  const rawPageInkStrokes = useMemo(
    () => props.inkStrokes.filter((stroke) => isStrokeOnBlankCanvasPage(stroke, props.pageNumber, props.generatedPageId)),
    [props.generatedPageId, props.inkStrokes, props.pageNumber],
  );
  const pageInkStrokes = useMemo(
    () => rawPageInkStrokes.map((stroke) => scaleInkStrokeToPageSize(stroke, pageRenderWidth, pageRenderHeight)),
    [pageRenderHeight, pageRenderWidth, rawPageInkStrokes],
  );
  const pageTextAnnotations = useMemo(
    () => props.textAnnotations.filter((annotation) => isTextAnnotationOnBlankCanvasPage(annotation, props.pageNumber, props.generatedPageId)),
    [props.generatedPageId, props.pageNumber, props.textAnnotations],
  );
  const pageImageAnnotations = useMemo(
    () => props.imageAnnotations.filter((annotation) => isImageAnnotationOnBlankCanvasPage(annotation, props.pageNumber, props.generatedPageId)),
    [props.generatedPageId, props.imageAnnotations, props.pageNumber],
  );
  const effectiveInkTool: InkTool = props.readOnly ? 'view' : inkTool;
  const rawPageSelectionRect = !props.readOnly && isSelectionOnBlankCanvasPage(selectionRect, props.pageNumber, props.generatedPageId) ? selectionRect : null;
  const pageSelectionRect = useMemo(
    () => scaleSelectionRectToPageSize(rawPageSelectionRect, pageRenderWidth, pageRenderHeight),
    [pageRenderHeight, pageRenderWidth, rawPageSelectionRect],
  );
  const allowUnknownPointerAsStylus = Platform.OS === 'ios';
  const allowMousePointerAsInput = Platform.OS === 'web';

  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const [draftSelectionPath, setDraftSelectionPath] = useState<InkPoint[]>([]);
  const [capturingSelection, setCapturingSelection] = useState(false);
  const [pencilHover, setPencilHover] = useState<PencilHoverPoint | null>(null);
  const selectionMovePreview = useMemo(
    () => getSelectionMovePreview(pageSelectionRect, draftSelection, pageInkStrokes, pageTextAnnotations, pageImageAnnotations),
    [draftSelection, pageImageAnnotations, pageInkStrokes, pageSelectionRect, pageTextAnnotations],
  );
  const selectedObjectCount = useMemo(() => {
    const { strokeIds, textAnnotationIds, imageAnnotationIds } = getSelectedObjectIdsForSelection(pageSelectionRect, pageInkStrokes, pageTextAnnotations, pageImageAnnotations);
    return strokeIds.size + textAnnotationIds.size + imageAnnotationIds.size;
  }, [pageImageAnnotations, pageInkStrokes, pageSelectionRect, pageTextAnnotations]);
  const visibleInkStrokes = useMemo(
    () => selectionMovePreview
      ? pageInkStrokes.filter((stroke) => !selectionMovePreview.strokeIds.has(stroke.id))
      : pageInkStrokes,
    [pageInkStrokes, selectionMovePreview],
  );
  const visibleTextAnnotations = useMemo(
    () => selectionMovePreview
      ? pageTextAnnotations.filter((annotation) => !selectionMovePreview.textAnnotationIds.has(annotation.id))
      : pageTextAnnotations,
    [pageTextAnnotations, selectionMovePreview],
  );
  const visibleImageAnnotations = useMemo(
    () => selectionMovePreview
      ? pageImageAnnotations.filter((annotation) => !selectionMovePreview.imageAnnotationIds.has(annotation.id))
      : pageImageAnnotations,
    [pageImageAnnotations, selectionMovePreview],
  );
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const currentStrokeRenderFrameRef = useRef<number | null>(null);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveStartRectRef = useRef<SelectionRect | null>(null);
  const selectionResizeCornerRef = useRef<ResizeCorner | null>(null);
  const selectionResizeStartRectRef = useRef<SelectionRect | null>(null);
  const selectionResizeStartPointRef = useRef<InkPoint | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const draftSelectionPathRef = useRef<InkPoint[]>([]);
  const draftSelectionRenderFrameRef = useRef<number | null>(null);
  const draftSelectionPathRenderFrameRef = useRef<number | null>(null);
  const selectionPreviewTokenRef = useRef(0);
  const textTapRef = useRef<InkPoint | null>(null);
  const captureTargetRef = useRef<View | null>(null);
  const eraserSnapshotPushedRef = useRef(false);

  const flushCurrentStrokeRender = useCallback((stroke: InkStroke | null) => {
    if (currentStrokeRenderFrameRef.current !== null) {
      cancelAnimationFrame(currentStrokeRenderFrameRef.current);
      currentStrokeRenderFrameRef.current = null;
    }
    currentStrokeRef.current = stroke;
    setCurrentStroke(stroke);
  }, []);

  const scheduleCurrentStrokeRender = useCallback((stroke: InkStroke | null) => {
    currentStrokeRef.current = stroke;
    if (currentStrokeRenderFrameRef.current !== null) return;
    currentStrokeRenderFrameRef.current = requestAnimationFrame(() => {
      currentStrokeRenderFrameRef.current = null;
      setCurrentStroke(currentStrokeRef.current);
    });
  }, []);

  const flushDraftSelectionRender = useCallback((rect: SelectionRect | null) => {
    if (draftSelectionRenderFrameRef.current !== null) {
      cancelAnimationFrame(draftSelectionRenderFrameRef.current);
      draftSelectionRenderFrameRef.current = null;
    }
    draftSelectionRef.current = rect;
    setDraftSelection(rect);
  }, []);

  const scheduleDraftSelectionRender = useCallback((rect: SelectionRect | null) => {
    draftSelectionRef.current = rect;
    if (draftSelectionRenderFrameRef.current !== null) return;
    draftSelectionRenderFrameRef.current = requestAnimationFrame(() => {
      draftSelectionRenderFrameRef.current = null;
      setDraftSelection(draftSelectionRef.current);
    });
  }, []);

  const flushDraftSelectionPathRender = useCallback((path: InkPoint[]) => {
    if (draftSelectionPathRenderFrameRef.current !== null) {
      cancelAnimationFrame(draftSelectionPathRenderFrameRef.current);
      draftSelectionPathRenderFrameRef.current = null;
    }
    draftSelectionPathRef.current = path;
    setDraftSelectionPath(path);
  }, []);

  const scheduleDraftSelectionPathRender = useCallback((path: InkPoint[]) => {
    draftSelectionPathRef.current = path;
    if (draftSelectionPathRenderFrameRef.current !== null) return;
    draftSelectionPathRenderFrameRef.current = requestAnimationFrame(() => {
      draftSelectionPathRenderFrameRef.current = null;
      setDraftSelectionPath(draftSelectionPathRef.current);
    });
  }, []);

  useEffect(() => () => {
    if (currentStrokeRenderFrameRef.current !== null) cancelAnimationFrame(currentStrokeRenderFrameRef.current);
    if (draftSelectionRenderFrameRef.current !== null) cancelAnimationFrame(draftSelectionRenderFrameRef.current);
    if (draftSelectionPathRenderFrameRef.current !== null) cancelAnimationFrame(draftSelectionPathRenderFrameRef.current);
  }, []);

  const scaleDisplayedRectToSelectionSpace = useCallback((rect: SelectionRect) => (
    rawPageSelectionRect?.pageWidth && rawPageSelectionRect.pageHeight
      ? scaleSelectionRectToPageSize(rect, rawPageSelectionRect.pageWidth, rawPageSelectionRect.pageHeight) ?? rect
      : rect
  ), [rawPageSelectionRect]);

  const scaleDisplayedDeltaToSelectionSpace = useCallback((dx: number, dy: number) => ({
    dx: rawPageSelectionRect?.pageWidth && pageRenderWidth
      ? dx * (rawPageSelectionRect.pageWidth / pageRenderWidth)
      : dx,
    dy: rawPageSelectionRect?.pageHeight && pageRenderHeight
      ? dy * (rawPageSelectionRect.pageHeight / pageRenderHeight)
      : dy,
  }), [pageRenderHeight, pageRenderWidth, rawPageSelectionRect]);

  useEffect(() => {
    if (!shouldPreviewPencilHover(effectiveInkTool)) setPencilHover(null);
  }, [effectiveInkTool]);

  const clampPointToPage = (x: number, y: number): InkPoint => ({
    x: Math.max(0, Math.min(pageSize.width || 1000, x)),
    y: Math.max(0, Math.min(pageSize.height || 1000, y)),
    t: Date.now(),
    pageNumber: props.generatedPageId ? undefined : props.pageNumber ?? 1,
    generatedPageId: props.generatedPageId,
    pageWidth: pageSize.width || 1000,
    pageHeight: pageSize.height || 1000,
  });

  const waitForNextPaint = () => new Promise((resolve) => setTimeout(resolve, 60));

  const buildSelectionPreview = useCallback(async (rect: SelectionRect) => {
    if (!captureTargetRef.current || pageSize.width <= 0 || pageSize.height <= 0) return null;

    setCapturingSelection(true);
    await waitForNextPaint();

    try {
      const fullImageUri = await captureRef(captureTargetRef, {
        format: 'png',
        result: 'tmpfile',
        quality: 1,
        width: pageSize.width,
        height: pageSize.height,
      });

      const crop = {
        originX: Math.max(0, Math.floor(rect.x)),
        originY: Math.max(0, Math.floor(rect.y)),
        width: Math.max(1, Math.min(Math.floor(rect.width), Math.floor(pageSize.width - rect.x))),
        height: Math.max(1, Math.min(Math.floor(rect.height), Math.floor(pageSize.height - rect.y))),
      };

      const cropped = await manipulateAsync(fullImageUri, [{ crop }], { compress: 1, format: SaveFormat.PNG });
      return cropped.uri;
    } catch {
      return null;
    } finally {
      setCapturingSelection(false);
    }
  }, [pageSize.height, pageSize.width]);

  const askAiAboutCurrentSelection = useCallback(async () => {
    if (!pageSelectionRect) {
      workspaceContext.onAskAiAboutSelection();
      return;
    }

    const token = selectionPreviewTokenRef.current + 1;
    selectionPreviewTokenRef.current = token;
    onSelectionPreviewChange?.(null);
    const uri = await buildSelectionPreview(pageSelectionRect);
    if (selectionPreviewTokenRef.current !== token) return;
    if (uri) onSelectionPreviewChange?.(uri);
    workspaceContext.onAskAiAboutSelection(uri ?? null);
  }, [buildSelectionPreview, onSelectionPreviewChange, pageSelectionRect, workspaceContext]);

  const eraseAtPoint = useCallback((point: InkPoint) => {
    const radius = getPencilEraserRadius(canvasCtx.eraserWidth, canvasCtx.eraserMode);
    const changed = canvasCtx.eraseInkAtPoint(point, radius, !eraserSnapshotPushedRef.current, canvasCtx.eraserMode);
    if (changed) eraserSnapshotPushedRef.current = true;
  }, [canvasCtx]);

  const reportPageFocus = useCallback(() => {
    if (props.generatedPageId || !props.pageNumber || props.currentPage === props.pageNumber) return;
    props.onPageFocus?.(props.pageNumber);
  }, [props.currentPage, props.generatedPageId, props.onPageFocus, props.pageNumber]);

  const handleInkGestureStart = useCallback((x: number, y: number) => {
    setPencilHover(null);
    reportPageFocus();
    const point = clampPointToPage(x, y);
    if (isDrawingTool(effectiveInkTool)) {
      const appearance = isShapeTool(effectiveInkTool)
        ? resolveShapeStrokeAppearance(penColor, penWidth)
        : resolveInkStrokeAppearance(effectiveInkTool, penColor, penWidth, brushType);
      const stroke: InkStroke = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        color: appearance.color,
        width: appearance.width,
        style: isShapeTool(effectiveInkTool) ? 'shape' : effectiveInkTool === 'highlight' ? 'highlight' : 'pen',
        brush: isShapeTool(effectiveInkTool) ? undefined : brushType,
        brushSettings: isShapeTool(effectiveInkTool) ? undefined : brushSettings,
        linePattern,
        shape: isShapeTool(effectiveInkTool) ? effectiveInkTool : undefined,
        pageNumber: props.generatedPageId ? undefined : props.pageNumber ?? 1,
        generatedPageId: props.generatedPageId,
        pageWidth: pageSize.width || 1000,
        pageHeight: pageSize.height || 1000,
        points: [point],
      };
      flushCurrentStrokeRender(stroke);
      return;
    }

    if (effectiveInkTool === 'select') {
      const currentSelection = pageSelectionRect;
      if (currentSelection && isPointInSelectionContextMenu(point, currentSelection, pageSize.width, pageSize.height)) return;
      const resizeCorner = getResizeCorner(currentSelection, point);
      if (currentSelection && resizeCorner) {
        selectionResizeCornerRef.current = resizeCorner;
        selectionResizeStartRectRef.current = currentSelection;
        flushDraftSelectionPathRender([]);
        flushDraftSelectionRender(currentSelection);
        return;
      }
      if (
        currentSelection &&
        point.x >= currentSelection.x &&
        point.x <= currentSelection.x + currentSelection.width &&
        point.y >= currentSelection.y &&
        point.y <= currentSelection.y + currentSelection.height
      ) {
        selectionMoveOriginRef.current = point;
        selectionMoveStartRectRef.current = currentSelection;
        flushDraftSelectionPathRender([]);
        flushDraftSelectionRender(currentSelection);
        return;
      }
      selectionPreviewTokenRef.current += 1;
      onSelectionChange?.(null);
      onSelectionPreviewChange?.(null);
      selectionOriginRef.current = point;
      const initialPath = selectionMode === 'lasso' ? [point] : [];
      flushDraftSelectionPathRender(initialPath);
      const rect = {
        x: point.x,
        y: point.y,
        width: 0,
        height: 0,
        mode: selectionMode,
        pageNumber: point.pageNumber,
        generatedPageId: point.generatedPageId,
        pageWidth: point.pageWidth,
        pageHeight: point.pageHeight,
      };
      flushDraftSelectionRender(rect);
      return;
    }

    if (effectiveInkTool === 'text') {
      textTapRef.current = point;
      return;
    }
    if (effectiveInkTool === 'erase') {
      eraseAtPoint(point);
    }
  }, [
    brushSettings,
    brushType,
    effectiveInkTool,
    linePattern,
    onSelectionChange,
    onSelectionPreviewChange,
    pageSize,
    penColor,
    penWidth,
    selectionMode,
    pageSelectionRect,
    eraseAtPoint,
    flushCurrentStrokeRender,
    flushDraftSelectionPathRender,
    flushDraftSelectionRender,
    reportPageFocus,
  ]);

  const handleInkGestureMove = useCallback((x: number, y: number) => {
    if (!isDrawingTool(effectiveInkTool) && effectiveInkTool !== 'select' && effectiveInkTool !== 'erase') return;
    const point = clampPointToPage(x, y);

    if (effectiveInkTool === 'erase') {
      eraseAtPoint(point);
      return;
    }

    if (isDrawingTool(effectiveInkTool)) {
      const stroke = currentStrokeRef.current;
      if (!stroke) return;
      if (stroke.style === 'shape') {
        const nextStroke = { ...stroke, points: [stroke.points[0], point] };
        scheduleCurrentStrokeRender(nextStroke);
        return;
      }
      if (!shouldAppendInkPoint(stroke, point)) return;

      const nextStroke = { ...stroke, points: [...stroke.points, point] };
      scheduleCurrentStrokeRender(nextStroke);
      return;
    }

    if (effectiveInkTool === 'select') {
      const resizeCorner = selectionResizeCornerRef.current;
      const resizeStartRect = selectionResizeStartRectRef.current;
      if (resizeCorner && resizeStartRect) {
        const nextRect = resizeRectFromCorner(resizeStartRect, resizeCorner, point);
        scheduleDraftSelectionRender(nextRect);
        return;
      }
      const moveOrigin = selectionMoveOriginRef.current;
      const moveStartRect = selectionMoveStartRectRef.current;
      if (moveOrigin && moveStartRect) {
        const dx = point.x - moveOrigin.x;
        const dy = point.y - moveOrigin.y;
        const nextRect = {
          ...moveStartRect,
          x: moveStartRect.x + dx,
          y: moveStartRect.y + dy,
          path: moveStartRect.path?.map((pathPoint) => ({
            ...pathPoint,
            x: pathPoint.x + dx,
            y: pathPoint.y + dy,
            pageWidth: point.pageWidth,
            pageHeight: point.pageHeight,
          })),
          pageWidth: point.pageWidth,
          pageHeight: point.pageHeight,
        };
        scheduleDraftSelectionRender(nextRect);
        return;
      }
      const origin = selectionOriginRef.current;
      if (!origin) return;
      if (selectionMode === 'rect') {
        const nextRect = buildSelectionRectFromDrag(origin, point);
        scheduleDraftSelectionRender(nextRect);
        return;
      }
      const currentPath = draftSelectionPathRef.current;
      const lastPoint = currentPath[currentPath.length - 1];
      const nextPath = !lastPoint || Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) > 5
        ? [...currentPath, point]
        : currentPath;
      scheduleDraftSelectionPathRender(nextPath);
      const nextRect = buildSelectionRectFromPoints(nextPath) ?? buildSelectionRectFromDrag(origin, point);
      scheduleDraftSelectionRender(nextRect);
    }
  }, [effectiveInkTool, eraseAtPoint, pageSize, scheduleCurrentStrokeRender, scheduleDraftSelectionPathRender, scheduleDraftSelectionRender, selectionMode]);

  const handleInkGestureEnd = useCallback(() => {
    const stroke = currentStrokeRef.current;
    if (stroke && stroke.points.length > 1) onCommitInkStroke(finalizeInkStroke(stroke));
    if (effectiveInkTool === 'select') {
      const rect = draftSelectionRef.current;
      const resized = Boolean(selectionResizeCornerRef.current && selectionResizeStartRectRef.current);
      const moveOrigin = selectionMoveOriginRef.current;
      const moveStartRect = selectionMoveStartRectRef.current;
      draftSelectionRef.current = null;
      selectionOriginRef.current = null;
      selectionMoveOriginRef.current = null;
      selectionMoveStartRectRef.current = null;
      selectionResizeCornerRef.current = null;
      selectionResizeStartRectRef.current = null;
      selectionResizeStartPointRef.current = null;
      flushDraftSelectionRender(null);
      flushDraftSelectionPathRender([]);
      if (resized && rect && rect.width > 24 && rect.height > 24) {
        canvasCtx.resizeSelectedStrokesToRect(scaleDisplayedRectToSelectionSpace(rect));
        onSelectionPreviewChange?.(null);
        selectionPreviewTokenRef.current += 1;
      } else if (rect && moveOrigin && moveStartRect) {
        const dx = rect.x - moveStartRect.x;
        const dy = rect.y - moveStartRect.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          const rawDelta = scaleDisplayedDeltaToSelectionSpace(dx, dy);
          canvasCtx.nudgeSelectedStrokes(rawDelta.dx, rawDelta.dy);
          onSelectionPreviewChange?.(null);
          selectionPreviewTokenRef.current += 1;
        }
      } else if (rect && rect.width > 24 && rect.height > 24) {
        onSelectionChange?.(rect);
        onSelectionPreviewChange?.(null);
        const token = selectionPreviewTokenRef.current + 1;
        selectionPreviewTokenRef.current = token;
        void buildSelectionPreview(rect).then((uri) => {
          if (selectionPreviewTokenRef.current !== token) return;
          onSelectionPreviewChange?.(uri);
        });
      }
    }
    if (effectiveInkTool === 'text' && textTapRef.current) onAddTextAnnotation(textTapRef.current);
    currentStrokeRef.current = null;
    eraserSnapshotPushedRef.current = false;
    textTapRef.current = null;
    flushCurrentStrokeRender(null);
    setPencilHover(null);
  }, [buildSelectionPreview, canvasCtx, effectiveInkTool, flushCurrentStrokeRender, flushDraftSelectionPathRender, flushDraftSelectionRender, onAddTextAnnotation, onCommitInkStroke, onSelectionChange, onSelectionPreviewChange, scaleDisplayedDeltaToSelectionSpace, scaleDisplayedRectToSelectionSpace]);

  const handleInkGestureCancel = useCallback(() => {
    const stroke = currentStrokeRef.current;
    if (stroke && stroke.points.length > 1) onCommitInkStroke(finalizeInkStroke(stroke));
    currentStrokeRef.current = null;
    eraserSnapshotPushedRef.current = false;
    draftSelectionRef.current = null;
    draftSelectionPathRef.current = [];
    selectionOriginRef.current = null;
    selectionMoveOriginRef.current = null;
    selectionMoveStartRectRef.current = null;
    selectionResizeCornerRef.current = null;
    selectionResizeStartRectRef.current = null;
    selectionResizeStartPointRef.current = null;
    textTapRef.current = null;
    flushDraftSelectionRender(null);
    flushDraftSelectionPathRender([]);
    flushCurrentStrokeRender(null);
    setPencilHover(null);
  }, [flushCurrentStrokeRender, flushDraftSelectionPathRender, flushDraftSelectionRender, onCommitInkStroke]);

  const inkGesture = useMemo(
    () => Gesture.Pan()
      .enabled(effectiveInkTool !== 'view')
      .manualActivation(true)
      .minDistance(0)
      .shouldCancelWhenOutside(false)
      .cancelsTouchesInView(false)
      .onTouchesDown((event: NativeInkTouchEvent, state: NativeGestureStateManager) => {
        'worklet';
        if (shouldActivateNativeInkGesture(effectiveInkTool, event, fingerDrawingEnabled, allowUnknownPointerAsStylus, allowMousePointerAsInput)) {
          state.activate();
        } else {
          state.fail();
        }
      })
      .onStart((event: NativeInkGestureEvent) => {
        'worklet';
        runOnJS(handleInkGestureStart)(event.x, event.y);
      })
      .onUpdate((event: NativeInkGestureEvent) => {
        'worklet';
        runOnJS(handleInkGestureMove)(event.x, event.y);
      })
      .onEnd(() => {
        'worklet';
        runOnJS(handleInkGestureEnd)();
      })
      .onFinalize((_, success) => {
        'worklet';
        if (!success) runOnJS(handleInkGestureCancel)();
      }),
    [allowMousePointerAsInput, allowUnknownPointerAsStylus, effectiveInkTool, fingerDrawingEnabled, handleInkGestureCancel, handleInkGestureEnd, handleInkGestureMove, handleInkGestureStart],
  );
  const selectionMovePanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => effectiveInkTool === 'select' && Boolean(pageSelectionRect),
    onMoveShouldSetPanResponder: (_event, gesture) => (
      effectiveInkTool === 'select'
      && Boolean(pageSelectionRect)
      && (Math.abs(gesture.dx) > 1 || Math.abs(gesture.dy) > 1)
    ),
    onPanResponderGrant: (event) => {
      if (!pageSelectionRect) return;
      const startPoint = clampPointToPage(
        pageSelectionRect.x + (event.nativeEvent.locationX ?? pageSelectionRect.width / 2),
        pageSelectionRect.y + (event.nativeEvent.locationY ?? pageSelectionRect.height / 2),
      );
      const resizeCorner = getResizeCorner(pageSelectionRect, startPoint);
      if (resizeCorner) {
        selectionResizeCornerRef.current = resizeCorner;
        selectionResizeStartRectRef.current = pageSelectionRect;
        selectionResizeStartPointRef.current = startPoint;
      } else {
        selectionMoveStartRectRef.current = pageSelectionRect;
        selectionMoveOriginRef.current = startPoint;
      }
      flushDraftSelectionPathRender([]);
      flushDraftSelectionRender(pageSelectionRect);
    },
    onPanResponderMove: (_event, gesture) => {
      const resizeCorner = selectionResizeCornerRef.current;
      const resizeStartRect = selectionResizeStartRectRef.current;
      const resizeStartPoint = selectionResizeStartPointRef.current;
      if (resizeCorner && resizeStartRect && resizeStartPoint) {
        const nextPoint = clampPointToPage(resizeStartPoint.x + gesture.dx, resizeStartPoint.y + gesture.dy);
        const nextRect = resizeRectFromCorner(resizeStartRect, resizeCorner, nextPoint);
        scheduleDraftSelectionRender(nextRect);
        return;
      }
      const startRect = selectionMoveStartRectRef.current;
      if (!startRect) return;
      const nextRect = translateSelectionRect(startRect, gesture.dx, gesture.dy, pageSize.width || 1000, pageSize.height || 1000);
      scheduleDraftSelectionRender(nextRect);
    },
    onPanResponderRelease: (_event, gesture) => {
      const resizeCorner = selectionResizeCornerRef.current;
      const resizeStartRect = selectionResizeStartRectRef.current;
      const resizeStartPoint = selectionResizeStartPointRef.current;
      const startRect = selectionMoveStartRectRef.current;
      selectionMoveStartRectRef.current = null;
      selectionMoveOriginRef.current = null;
      selectionResizeCornerRef.current = null;
      selectionResizeStartRectRef.current = null;
      selectionResizeStartPointRef.current = null;
      flushDraftSelectionRender(null);
      flushDraftSelectionPathRender([]);
      if (resizeCorner && resizeStartRect && resizeStartPoint) {
        const nextPoint = clampPointToPage(resizeStartPoint.x + gesture.dx, resizeStartPoint.y + gesture.dy);
        const nextRect = resizeRectFromCorner(resizeStartRect, resizeCorner, nextPoint);
        if (nextRect.width > 24 && nextRect.height > 24) {
          canvasCtx.resizeSelectedStrokesToRect(scaleDisplayedRectToSelectionSpace(nextRect));
          onSelectionPreviewChange?.(null);
          selectionPreviewTokenRef.current += 1;
        }
        return;
      }
      if (!startRect) return;
      const nextRect = translateSelectionRect(startRect, gesture.dx, gesture.dy, pageSize.width || 1000, pageSize.height || 1000);
      const dx = nextRect.x - startRect.x;
      const dy = nextRect.y - startRect.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        const rawDelta = scaleDisplayedDeltaToSelectionSpace(dx, dy);
        canvasCtx.nudgeSelectedStrokes(rawDelta.dx, rawDelta.dy);
        onSelectionPreviewChange?.(null);
        selectionPreviewTokenRef.current += 1;
      }
    },
    onPanResponderTerminate: () => {
      selectionMoveStartRectRef.current = null;
      selectionMoveOriginRef.current = null;
      selectionResizeCornerRef.current = null;
      selectionResizeStartRectRef.current = null;
      selectionResizeStartPointRef.current = null;
      flushDraftSelectionRender(null);
      flushDraftSelectionPathRender([]);
    },
    onPanResponderTerminationRequest: () => false,
  }), [canvasCtx, effectiveInkTool, flushDraftSelectionPathRender, flushDraftSelectionRender, onSelectionPreviewChange, pageSelectionRect, pageSize.height, pageSize.width, scaleDisplayedDeltaToSelectionSpace, scaleDisplayedRectToSelectionSpace, scheduleDraftSelectionRender]);
  const handlePencilHoverMove = useCallback((event: unknown) => {
    if (currentStrokeRef.current || !shouldPreviewPencilHover(effectiveInkTool) || !isStylusHoverEvent(event) || !isPencilHoverFarEnough(event)) {
      setPencilHover(null);
      return;
    }
    const point = getPencilHoverPoint(event);
    if (!point) return;
    if (point.x < 0 || point.y < 0 || point.x > pageSize.width || point.y > pageSize.height) return;
    setPencilHover(point);
  }, [effectiveInkTool, pageSize.height, pageSize.width]);
  const hoverHandlers = useMemo(() => ({
    onPointerEnter: handlePencilHoverMove,
    onPointerMove: handlePencilHoverMove,
    onPointerLeave: () => setPencilHover(null),
    onPointerCancel: () => setPencilHover(null),
  } as any), [handlePencilHoverMove]);
  const hoverSize = getPencilHoverSize(effectiveInkTool, effectiveInkTool === 'erase' ? canvasCtx.eraserWidth : penWidth, canvasCtx.eraserMode);
  const hoverVisible = pencilHover && shouldPreviewPencilHover(effectiveInkTool);

  return (
    <View
      {...hoverHandlers}
      ref={captureTargetRef}
      collapsable={false}
      style={[
        props.styles.blankNotePage,
        {
          width: props.pageWidth ?? '100%',
          height: props.pageHeight ?? '100%',
        },
      ]}
      onTouchStart={() => {
        setPencilHover(null);
        workspaceContext.onFocusWorkspaceTarget?.('document');
      }}
      onLayout={(e) => setPageSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      {props.backgroundImageUri ? (
        <Image
          source={{ uri: props.backgroundImageUri }}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}
          resizeMode="contain"
        />
      ) : null}
      <BlankNoteTemplateLayer template={props.template} pageWidth={pageSize.width} pageHeight={pageSize.height} styles={props.styles} />

        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          <StaticStrokes strokes={visibleInkStrokes} type="highlight" />
          {currentStroke?.style === 'highlight' ? <InkPath stroke={currentStroke} draft /> : null}
        </Svg>

      {visibleImageAnnotations.map((annotation) => (
        <Pressable
          key={annotation.id}
          pointerEvents={props.readOnly ? 'none' : 'auto'}
          onPress={() => {
            onSelectionChange?.({
              x: annotation.x,
              y: annotation.y,
              width: annotation.width,
              height: annotation.height,
              pageNumber: annotation.generatedPageId ? undefined : annotation.pageNumber,
              generatedPageId: annotation.generatedPageId,
              pageWidth: annotation.pageWidth ?? pageSize.width,
              pageHeight: annotation.pageHeight ?? pageSize.height,
            });
            canvasCtx.setInkTool('select');
          }}
          style={[
            props.styles.imageAnnotationCard,
            !props.readOnly && { zIndex: 42, elevation: 42 },
            {
              left: annotation.x,
              top: annotation.y,
              width: annotation.width,
              height: annotation.height,
            },
          ]}
        >
          <Image source={{ uri: annotation.uri }} style={props.styles.imageAnnotationImage} resizeMode="contain" fadeDuration={0} />
        </Pressable>
      ))}

      <TextAnnotationLayer
        annotations={visibleTextAnnotations}
        styles={props.styles}
        onChangeText={onUpdateTextAnnotation}
        onMove={onMoveTextAnnotation}
        onResize={onResizeTextAnnotation}
        onChangeFontSize={onChangeTextAnnotationFontSize}
        onRemove={onRemoveTextAnnotation}
      />

        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          <StaticStrokes strokes={visibleInkStrokes} type="ink" />
          {currentStroke?.style !== 'highlight' && currentStroke ? <InkPath stroke={currentStroke} draft /> : null}
        </Svg>
        {selectionMovePreview ? <SelectionMovePreview preview={selectionMovePreview} styles={props.styles} /> : null}

        {!capturingSelection && !draftSelection && pageSelectionRect ? <SelectionOverlay rect={pageSelectionRect} styles={props.styles} /> : null}
        {!capturingSelection && draftSelectionPath.length > 1 ? <SelectionLassoOverlay points={draftSelectionPath} /> : null}
        {!capturingSelection && draftSelection && draftSelection.mode !== 'lasso' ? <SelectionOverlay rect={draftSelection} styles={props.styles} draft /> : null}
        <GestureDetector gesture={inkGesture}>
          <View {...hoverHandlers} pointerEvents={effectiveInkTool === 'view' ? 'none' : 'auto'} style={props.styles.inkOverlay} />
        </GestureDetector>
        {!capturingSelection && pageSelectionRect ? (
          <View
            {...selectionMovePanResponder.panHandlers}
            pointerEvents={effectiveInkTool === 'select' ? 'auto' : 'none'}
            style={{
              position: 'absolute',
              left: pageSelectionRect.x,
              top: pageSelectionRect.y,
              width: pageSelectionRect.width,
              height: pageSelectionRect.height,
              zIndex: 70,
              elevation: 70,
              backgroundColor: 'transparent',
            }}
          />
        ) : null}
        {!capturingSelection && !draftSelection && pageSelectionRect ? (
          <SelectionContextMenu
            rect={pageSelectionRect}
            pageWidth={pageSize.width}
            pageHeight={pageSize.height}
            styles={props.styles}
            editable={selectedObjectCount > 0}
            onAskAi={askAiAboutCurrentSelection}
            onDuplicate={canvasCtx.duplicateSelectedStrokes}
            onDelete={canvasCtx.deleteSelectedStrokes}
            onChangeColor={canvasCtx.changeSelectedStrokesColor}
          />
        ) : null}
        {hoverVisible ? (
          <PencilHoverOverlay
            x={pencilHover.x}
            y={pencilHover.y}
            size={hoverSize}
            pageWidth={pageSize.width}
            pageHeight={pageSize.height}
            borderColor={effectiveInkTool === 'erase' ? '#EF4444' : penColor}
            isEraser={effectiveInkTool === 'erase'}
            styles={props.styles}
          />
        ) : null}
    </View>
  );
}

export function BlankNoteCanvas(props: {
  backgroundImageUri?: string | null;
  styles: any;
  pageCount?: number;
  currentPage?: number;
  generatedPageId?: string;
  template?: NotebookPageTemplate;
  onPageChange?: (pageNumber: number) => void;
  readOnly?: boolean;
}) {
  const canvasCtx = useCanvasContext();
  const documentContext = useDocumentContext();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const documentId = documentContext.studyDocument?.id ?? null;
  const singleGeneratedPage = Boolean(props.generatedPageId);
  const pageCount = singleGeneratedPage
    ? 1
    : Math.max(1, props.pageCount ?? documentContext.studyDocument?.pageCount ?? 1);
  const previousDocumentIdRef = useRef(documentId);
  const previousPageCountRef = useRef(pageCount);
  const initialScrollDoneRef = useRef(false);
  const reportedPageRef = useRef(props.currentPage ?? documentContext.currentPdfPage ?? 1);
  const suppressScrollPageReportUntilRef = useRef(0);
  const pendingRestorePageRef = useRef<number | null>(null);
  const pendingRestoreUntilRef = useRef(0);
  const restoreRetryTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const userScrollActiveRef = useRef(false);
  const dragScrollActiveRef = useRef(false);
  const momentumScrollActiveRef = useRef(false);
  const userScrollEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRestoreLayoutKeyRef = useRef<string | null>(null);
  const restorePage = singleGeneratedPage
    ? 1
    : Math.max(1, Math.min(pageCount, props.currentPage ?? documentContext.currentPdfPage ?? 1));
  const allInkStrokes = documentId ? canvasCtx.inkByDocument[documentId] ?? [] : canvasCtx.inkStrokes;
  const allTextAnnotations = documentId ? canvasCtx.textAnnotationsByDocument[documentId] ?? [] : canvasCtx.textAnnotations;
  const allImageAnnotations = documentId ? canvasCtx.imageAnnotationsByDocument[documentId] ?? [] : canvasCtx.imageAnnotations;
  const horizontalInset = Platform.OS === 'web' ? 0 : windowWidth >= 900 ? 24 : 16;
  const availableWidth = Math.max(320, (containerSize.width || windowWidth || 780) - horizontalInset);
  const availableHeight = Math.max(360, containerSize.height || windowHeight || 640);
  const webHeightFitWidth = Math.max(
    360,
    Math.floor((availableHeight - BLANK_NOTE_WEB_VERTICAL_FIT_INSET) / BLANK_NOTE_ASPECT_RATIO),
  );
  const maxBlankPageWidth = Platform.OS === 'web' ? availableWidth : 1320;
  const pageWidth = Math.round(Math.max(
    360,
    Math.min(availableWidth, maxBlankPageWidth, Platform.OS === 'web' ? webHeightFitWidth : maxBlankPageWidth),
  ));
  const pageHeight = Math.round(Math.max(300, pageWidth * BLANK_NOTE_ASPECT_RATIO));
  const template = props.template ?? documentContext.studyDocument?.blankTemplate ?? 'plain';
  const selectionScrollLocked = !props.readOnly && canvasCtx.inkTool === 'select' && Boolean(canvasCtx.selectionRect);
  const scrollEnabled = props.readOnly || canvasCtx.inkTool === 'view' || !selectionScrollLocked;
  const pageNumbers = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );

  const getPageScrollY = useCallback((pageNumber: number) => (
    Math.max(0, (Math.max(1, Math.min(pageCount, pageNumber)) - 1) * (pageHeight + BLANK_NOTE_PAGE_GAP))
  ), [pageCount, pageHeight]);
  const initialScrollY = singleGeneratedPage ? 0 : getPageScrollY(restorePage);
  const initialContentOffset = useMemo(() => ({ x: 0, y: initialScrollY }), [initialScrollY]);

  const clearRestoreRetryTimers = useCallback(() => {
    restoreRetryTimersRef.current.forEach((timer) => clearTimeout(timer));
    restoreRetryTimersRef.current = [];
  }, []);

  const scrollToBlankPage = useCallback((pageNumber: number, animated: boolean) => {
    if (singleGeneratedPage || !scrollRef.current || !pageHeight) return;
    const targetPage = Math.max(1, Math.min(pageCount, pageNumber));
    clearRestoreRetryTimers();
    reportedPageRef.current = targetPage;
    pendingRestorePageRef.current = targetPage;
    pendingRestoreUntilRef.current = Date.now() + 2800;
    suppressScrollPageReportUntilRef.current = Date.now() + 1400;
    userScrollActiveRef.current = false;
    dragScrollActiveRef.current = false;
    momentumScrollActiveRef.current = false;
    lastRestoreLayoutKeyRef.current = `${documentId ?? 'none'}:${targetPage}:${pageCount}:${pageHeight}`;
    const y = getPageScrollY(targetPage);
    scrollRef.current.scrollTo({ y, animated });

    [80, 220, 520, 900, 1400, 2200].forEach((delay) => {
      const timer = setTimeout(() => {
        if (pendingRestorePageRef.current !== targetPage || !scrollRef.current) {
          return;
        }
        scrollRef.current.scrollTo({ y: getPageScrollY(targetPage), animated: false });
      }, delay);
      restoreRetryTimersRef.current.push(timer);
    });
  }, [clearRestoreRetryTimers, documentId, getPageScrollY, pageCount, pageHeight, singleGeneratedPage]);

  useEffect(() => () => {
    clearRestoreRetryTimers();
    if (userScrollEndTimerRef.current) clearTimeout(userScrollEndTimerRef.current);
  }, [clearRestoreRetryTimers]);

  useLayoutEffect(() => {
    if (singleGeneratedPage || !scrollRef.current || !pageHeight) {
      previousDocumentIdRef.current = documentId;
      previousPageCountRef.current = pageCount;
      return;
    }
    const previousDocumentId = previousDocumentIdRef.current;
    const documentChanged = previousDocumentId !== documentId;
    previousDocumentIdRef.current = documentId;

    if (!initialScrollDoneRef.current || documentChanged) {
      initialScrollDoneRef.current = true;
      previousPageCountRef.current = pageCount;
      scrollToBlankPage(restorePage, false);
      return;
    }
    const previousPageCount = previousPageCountRef.current;
    previousPageCountRef.current = pageCount;
    if (pageCount > previousPageCount) {
      props.onPageChange?.(pageCount);
      scrollToBlankPage(pageCount, true);
      return;
    }
    const restoreLayoutKey = `${documentId ?? 'none'}:${restorePage}:${pageCount}:${pageHeight}`;
    if (!userScrollActiveRef.current && restorePage > 1 && restoreLayoutKey !== lastRestoreLayoutKeyRef.current) {
      scrollToBlankPage(restorePage, false);
    }
  }, [documentId, pageCount, pageHeight, props.onPageChange, restorePage, scrollToBlankPage, singleGeneratedPage]);

  const reportVisiblePageFromOffset = useCallback((offsetY: number) => {
    if (!props.onPageChange || !pageHeight) return;
    const stride = pageHeight + BLANK_NOTE_PAGE_GAP;
    const nextPage = Math.max(1, Math.min(pageCount, Math.floor((offsetY + pageHeight / 2) / stride) + 1));
    if (reportedPageRef.current === nextPage) return;
    reportedPageRef.current = nextPage;
    props.onPageChange(nextPage);
  }, [pageCount, pageHeight, props.onPageChange]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (singleGeneratedPage || !props.onPageChange || !pageHeight) return;
    const offsetY = event.nativeEvent.contentOffset.y;
    const stride = pageHeight + BLANK_NOTE_PAGE_GAP;
    const nextPage = Math.max(1, Math.min(pageCount, Math.floor((offsetY + pageHeight / 2) / stride) + 1));
    const pendingRestorePage = pendingRestorePageRef.current;
    if (pendingRestorePage && Date.now() < pendingRestoreUntilRef.current) {
      if (nextPage !== pendingRestorePage && !userScrollActiveRef.current) {
        scrollRef.current?.scrollTo({ y: getPageScrollY(pendingRestorePage), animated: false });
      }
      return;
    }
    if (pendingRestorePage && Date.now() >= pendingRestoreUntilRef.current) {
      pendingRestorePageRef.current = null;
    }
    if (!userScrollActiveRef.current || Date.now() < suppressScrollPageReportUntilRef.current) return;
    reportVisiblePageFromOffset(offsetY);
  }, [getPageScrollY, pageCount, pageHeight, props.onPageChange, reportVisiblePageFromOffset, singleGeneratedPage]);

  const handleContentSizeChange = useCallback(() => {
    const pendingRestorePage = pendingRestorePageRef.current;
    if (!pendingRestorePage || Date.now() >= pendingRestoreUntilRef.current) return;
    scrollToBlankPage(pendingRestorePage, false);
  }, [scrollToBlankPage]);

  const handleScrollBeginDrag = useCallback(() => {
    userScrollActiveRef.current = true;
    dragScrollActiveRef.current = true;
    momentumScrollActiveRef.current = false;
    pendingRestorePageRef.current = null;
    suppressScrollPageReportUntilRef.current = 0;
    if (userScrollEndTimerRef.current) {
      clearTimeout(userScrollEndTimerRef.current);
      userScrollEndTimerRef.current = null;
    }
  }, []);

  const handleScrollEndDrag = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (dragScrollActiveRef.current) {
      reportVisiblePageFromOffset(event.nativeEvent.contentOffset.y);
    }
    if (userScrollEndTimerRef.current) clearTimeout(userScrollEndTimerRef.current);
    userScrollEndTimerRef.current = setTimeout(() => {
      if (momentumScrollActiveRef.current) return;
      dragScrollActiveRef.current = false;
      userScrollActiveRef.current = false;
    }, 700);
  }, [reportVisiblePageFromOffset]);

  const handleMomentumScrollBegin = useCallback(() => {
    if (!dragScrollActiveRef.current) return;
    userScrollActiveRef.current = true;
    momentumScrollActiveRef.current = true;
    if (userScrollEndTimerRef.current) {
      clearTimeout(userScrollEndTimerRef.current);
      userScrollEndTimerRef.current = null;
    }
  }, []);

  const handleMomentumScrollEnd = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (momentumScrollActiveRef.current) {
      reportVisiblePageFromOffset(event.nativeEvent.contentOffset.y);
    }
    momentumScrollActiveRef.current = false;
    dragScrollActiveRef.current = false;
    userScrollActiveRef.current = false;
  }, [reportVisiblePageFromOffset]);

  return (
    <View
      style={[props.styles.blankNoteCanvasCard, { paddingVertical: 0, borderWidth: 0 }]}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setContainerSize((current) => (
          Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1
            ? current
            : { width, height }
        ));
      }}
    >
      <ScrollView
        key={singleGeneratedPage ? `generated:${props.generatedPageId ?? 'single'}` : `blank:${documentId ?? 'none'}:${pageCount}`}
        ref={scrollRef}
        style={props.styles.blankNoteScroller}
        contentContainerStyle={props.styles.blankNotePagesContent}
        contentOffset={initialContentOffset}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        scrollEnabled={scrollEnabled}
        onScroll={handleScroll}
        onContentSizeChange={handleContentSizeChange}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        scrollEventThrottle={96}
      >
        {pageNumbers.map((pageNumber) => (
          <View key={pageNumber} style={[props.styles.blankNotePageSlot, { marginBottom: BLANK_NOTE_PAGE_GAP }]}>
            <BlankNotePageCanvas
              backgroundImageUri={pageNumber === 1 ? props.backgroundImageUri : null}
              styles={props.styles}
              pageNumber={singleGeneratedPage ? undefined : pageNumber}
              currentPage={props.currentPage ?? documentContext.currentPdfPage}
              generatedPageId={props.generatedPageId}
              template={template}
              pageWidth={pageWidth}
              pageHeight={pageHeight}
              inkStrokes={allInkStrokes}
              textAnnotations={allTextAnnotations}
              imageAnnotations={allImageAnnotations}
              onPageFocus={props.onPageChange}
              readOnly={props.readOnly}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
