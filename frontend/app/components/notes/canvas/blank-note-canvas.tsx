import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image, PanResponder, View } from 'react-native';
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
import { buildSelectionRectFromDrag, buildSelectionRectFromPoints, finalizeInkStroke, isDrawingTool, isShapeTool, resolveInkStrokeAppearance, resolveShapeStrokeAppearance, shouldAppendInkPoint } from '../../../ui-helpers';
import { InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { useCanvasContext } from './canvas-context';
import { shouldActivateNativeInkGesture, type NativeGestureStateManager, type NativeInkGestureEvent, type NativeInkTouchEvent } from './native-ink-gesture-policy';
import { getPencilEraserRadius, getPencilHoverPoint, getPencilHoverSize, getPencilHoverToolLabel, isStylusHoverEvent, shouldPreviewPencilHover, type PencilHoverPoint } from './native-pencil-hover';
import { useDesktopNotesWorkspaceContext } from '../workspace/notes-workspace-context';

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

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

export function BlankNoteCanvas(props: {
  backgroundImageUri?: string | null;
  styles: any;
}) {
  const canvasCtx = useCanvasContext();
  const workspaceContext = useDesktopNotesWorkspaceContext();
  const {
    inkTool,
    fingerDrawingEnabled,
    penColor,
    penWidth,
    brushType,
    linePattern,
    selectionMode,
    brushSettings,
    inkStrokes,
    textAnnotations,
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
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const [draftSelectionPath, setDraftSelectionPath] = useState<InkPoint[]>([]);
  const [capturingSelection, setCapturingSelection] = useState(false);
  const [pencilHover, setPencilHover] = useState<PencilHoverPoint | null>(null);
  const selectionMovePreview = useMemo(
    () => getSelectionMovePreview(selectionRect, draftSelection, inkStrokes, textAnnotations),
    [draftSelection, inkStrokes, selectionRect, textAnnotations],
  );
  const selectedObjectCount = useMemo(() => {
    const { strokeIds, textAnnotationIds } = getSelectedObjectIdsForSelection(selectionRect, inkStrokes, textAnnotations);
    return strokeIds.size + textAnnotationIds.size;
  }, [inkStrokes, selectionRect, textAnnotations]);
  const visibleInkStrokes = useMemo(
    () => selectionMovePreview
      ? inkStrokes.filter((stroke) => !selectionMovePreview.strokeIds.has(stroke.id))
      : inkStrokes,
    [inkStrokes, selectionMovePreview],
  );
  const visibleTextAnnotations = useMemo(
    () => selectionMovePreview
      ? textAnnotations.filter((annotation) => !selectionMovePreview.textAnnotationIds.has(annotation.id))
      : textAnnotations,
    [selectionMovePreview, textAnnotations],
  );
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveStartRectRef = useRef<SelectionRect | null>(null);
  const selectionResizeCornerRef = useRef<ResizeCorner | null>(null);
  const selectionResizeStartRectRef = useRef<SelectionRect | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const draftSelectionPathRef = useRef<InkPoint[]>([]);
  const selectionPreviewTokenRef = useRef(0);
  const textTapRef = useRef<InkPoint | null>(null);
  const captureTargetRef = useRef<View | null>(null);
  const eraserSnapshotPushedRef = useRef(false);

  useEffect(() => {
    if (!shouldPreviewPencilHover(inkTool)) setPencilHover(null);
  }, [inkTool]);

  const clampPointToPage = (x: number, y: number): InkPoint => ({
    x: Math.max(0, Math.min(pageSize.width || 1000, x)),
    y: Math.max(0, Math.min(pageSize.height || 1000, y)),
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
    if (!selectionRect) {
      workspaceContext.onAskAiAboutSelection();
      return;
    }

    const token = selectionPreviewTokenRef.current + 1;
    selectionPreviewTokenRef.current = token;
    onSelectionPreviewChange?.(null);
    const uri = await buildSelectionPreview(selectionRect);
    if (selectionPreviewTokenRef.current !== token) return;
    if (uri) onSelectionPreviewChange?.(uri);
    workspaceContext.onAskAiAboutSelection(uri ?? null);
  }, [buildSelectionPreview, onSelectionPreviewChange, selectionRect, workspaceContext]);

  const eraseAtPoint = useCallback((point: InkPoint) => {
    const radius = getPencilEraserRadius(canvasCtx.eraserWidth, canvasCtx.eraserMode);
    const changed = canvasCtx.eraseInkAtPoint(point, radius, !eraserSnapshotPushedRef.current, canvasCtx.eraserMode);
    if (changed) eraserSnapshotPushedRef.current = true;
  }, [canvasCtx]);

  const handleInkGestureStart = useCallback((x: number, y: number) => {
    const point = clampPointToPage(x, y);
    if (isDrawingTool(inkTool)) {
      const appearance = isShapeTool(inkTool)
        ? resolveShapeStrokeAppearance(penColor, penWidth)
        : resolveInkStrokeAppearance(inkTool, penColor, penWidth, brushType);
      const stroke: InkStroke = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        color: appearance.color,
        width: appearance.width,
        style: isShapeTool(inkTool) ? 'shape' : inkTool === 'highlight' ? 'highlight' : 'pen',
        brush: isShapeTool(inkTool) ? undefined : brushType,
        brushSettings: isShapeTool(inkTool) ? undefined : brushSettings,
        linePattern,
        shape: isShapeTool(inkTool) ? inkTool : undefined,
        pageWidth: pageSize.width || 1000,
        pageHeight: pageSize.height || 1000,
        points: [point],
      };
      currentStrokeRef.current = stroke;
      setCurrentStroke(stroke);
      return;
    }

    if (inkTool === 'select') {
      const currentSelection = selectionRect;
      if (currentSelection && isPointInSelectionContextMenu(point, currentSelection, pageSize.width, pageSize.height)) return;
      const resizeCorner = getResizeCorner(currentSelection, point);
      if (currentSelection && resizeCorner) {
        selectionResizeCornerRef.current = resizeCorner;
        selectionResizeStartRectRef.current = currentSelection;
        draftSelectionRef.current = currentSelection;
        draftSelectionPathRef.current = [];
        setDraftSelectionPath([]);
        setDraftSelection(currentSelection);
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
        draftSelectionRef.current = currentSelection;
        draftSelectionPathRef.current = [];
        setDraftSelectionPath([]);
        setDraftSelection(currentSelection);
        return;
      }
      selectionPreviewTokenRef.current += 1;
      onSelectionChange?.(null);
      onSelectionPreviewChange?.(null);
      selectionOriginRef.current = point;
      const initialPath = selectionMode === 'lasso' ? [point] : [];
      draftSelectionPathRef.current = initialPath;
      setDraftSelectionPath(initialPath);
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
      draftSelectionRef.current = rect;
      setDraftSelection(rect);
      return;
    }

    if (inkTool === 'text') {
      textTapRef.current = point;
      return;
    }
    if (inkTool === 'erase') {
      eraseAtPoint(point);
    }
  }, [
    brushSettings,
    brushType,
    inkTool,
    linePattern,
    onSelectionChange,
    onSelectionPreviewChange,
    pageSize,
    penColor,
    penWidth,
    selectionMode,
    selectionRect,
    eraseAtPoint,
  ]);

  const handleInkGestureMove = useCallback((x: number, y: number) => {
    if (!isDrawingTool(inkTool) && inkTool !== 'select' && inkTool !== 'erase') return;
    const point = clampPointToPage(x, y);

    if (inkTool === 'erase') {
      eraseAtPoint(point);
      return;
    }

    if (isDrawingTool(inkTool)) {
      const stroke = currentStrokeRef.current;
      if (!stroke) return;
      if (stroke.style === 'shape') {
        const nextStroke = { ...stroke, points: [stroke.points[0], point] };
        currentStrokeRef.current = nextStroke;
        setCurrentStroke(nextStroke);
        return;
      }
      if (!shouldAppendInkPoint(stroke, point)) return;

      const nextStroke = { ...stroke, points: [...stroke.points, point] };
      currentStrokeRef.current = nextStroke;
      setCurrentStroke(nextStroke);
      return;
    }

    if (inkTool === 'select') {
      const resizeCorner = selectionResizeCornerRef.current;
      const resizeStartRect = selectionResizeStartRectRef.current;
      if (resizeCorner && resizeStartRect) {
        const nextRect = resizeRectFromCorner(resizeStartRect, resizeCorner, point);
        draftSelectionRef.current = nextRect;
        setDraftSelection(nextRect);
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
        draftSelectionRef.current = nextRect;
        setDraftSelection(nextRect);
        return;
      }
      const origin = selectionOriginRef.current;
      if (!origin) return;
      if (selectionMode === 'rect') {
        const nextRect = buildSelectionRectFromDrag(origin, point);
        draftSelectionRef.current = nextRect;
        setDraftSelection(nextRect);
        return;
      }
      const currentPath = draftSelectionPathRef.current;
      const lastPoint = currentPath[currentPath.length - 1];
      const nextPath = !lastPoint || Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) > 5
        ? [...currentPath, point]
        : currentPath;
      draftSelectionPathRef.current = nextPath;
      setDraftSelectionPath(nextPath);
      const nextRect = buildSelectionRectFromPoints(nextPath) ?? buildSelectionRectFromDrag(origin, point);
      draftSelectionRef.current = nextRect;
      setDraftSelection(nextRect);
    }
  }, [eraseAtPoint, inkTool, pageSize, selectionMode]);

  const handleInkGestureEnd = useCallback(() => {
    const stroke = currentStrokeRef.current;
    if (stroke && stroke.points.length > 1) onCommitInkStroke(finalizeInkStroke(stroke));
    if (inkTool === 'select') {
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
      draftSelectionPathRef.current = [];
      setDraftSelection(null);
      setDraftSelectionPath([]);
      if (resized && rect && rect.width > 24 && rect.height > 24) {
        canvasCtx.resizeSelectedStrokesToRect(rect);
        onSelectionPreviewChange?.(null);
        selectionPreviewTokenRef.current += 1;
      } else if (rect && moveOrigin && moveStartRect) {
        const dx = rect.x - moveStartRect.x;
        const dy = rect.y - moveStartRect.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) canvasCtx.nudgeSelectedStrokes(dx, dy);
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
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
    if (inkTool === 'text' && textTapRef.current) onAddTextAnnotation(textTapRef.current);
    currentStrokeRef.current = null;
    eraserSnapshotPushedRef.current = false;
    textTapRef.current = null;
    setCurrentStroke(null);
  }, [buildSelectionPreview, canvasCtx, inkTool, onAddTextAnnotation, onCommitInkStroke, onSelectionChange, onSelectionPreviewChange]);

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
    textTapRef.current = null;
    setDraftSelection(null);
    setDraftSelectionPath([]);
    setCurrentStroke(null);
  }, [onCommitInkStroke]);

  const inkGesture = useMemo(
    () => Gesture.Pan()
      .enabled(inkTool !== 'view')
      .manualActivation(true)
      .minDistance(0)
      .shouldCancelWhenOutside(false)
      .cancelsTouchesInView(false)
      .onTouchesDown((event: NativeInkTouchEvent, state: NativeGestureStateManager) => {
        'worklet';
        if (shouldActivateNativeInkGesture(inkTool, event, fingerDrawingEnabled)) {
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
    [fingerDrawingEnabled, handleInkGestureCancel, handleInkGestureEnd, handleInkGestureMove, handleInkGestureStart, inkTool],
  );
  const selectionMovePanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => inkTool === 'select' && Boolean(selectionRect),
    onMoveShouldSetPanResponder: (_event, gesture) => (
      inkTool === 'select'
      && Boolean(selectionRect)
      && (Math.abs(gesture.dx) > 1 || Math.abs(gesture.dy) > 1)
    ),
    onPanResponderGrant: () => {
      if (!selectionRect) return;
      selectionMoveStartRectRef.current = selectionRect;
      draftSelectionRef.current = selectionRect;
      draftSelectionPathRef.current = [];
      setDraftSelectionPath([]);
      setDraftSelection(selectionRect);
    },
    onPanResponderMove: (_event, gesture) => {
      const startRect = selectionMoveStartRectRef.current;
      if (!startRect) return;
      const nextRect = translateSelectionRect(startRect, gesture.dx, gesture.dy, pageSize.width || 1000, pageSize.height || 1000);
      draftSelectionRef.current = nextRect;
      setDraftSelection(nextRect);
    },
    onPanResponderRelease: (_event, gesture) => {
      const startRect = selectionMoveStartRectRef.current;
      selectionMoveStartRectRef.current = null;
      draftSelectionRef.current = null;
      draftSelectionPathRef.current = [];
      setDraftSelection(null);
      setDraftSelectionPath([]);
      if (!startRect) return;
      const nextRect = translateSelectionRect(startRect, gesture.dx, gesture.dy, pageSize.width || 1000, pageSize.height || 1000);
      const dx = nextRect.x - startRect.x;
      const dy = nextRect.y - startRect.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        canvasCtx.nudgeSelectedStrokes(dx, dy);
        onSelectionPreviewChange?.(null);
        selectionPreviewTokenRef.current += 1;
      }
    },
    onPanResponderTerminate: () => {
      selectionMoveStartRectRef.current = null;
      draftSelectionRef.current = null;
      draftSelectionPathRef.current = [];
      setDraftSelection(null);
      setDraftSelectionPath([]);
    },
    onPanResponderTerminationRequest: () => false,
  }), [canvasCtx, inkTool, onSelectionPreviewChange, pageSize.height, pageSize.width, selectionRect]);
  const handlePencilHoverMove = useCallback((event: unknown) => {
    if (!shouldPreviewPencilHover(inkTool) || !isStylusHoverEvent(event)) return;
    const point = getPencilHoverPoint(event);
    if (!point) return;
    if (point.x < 0 || point.y < 0 || point.x > pageSize.width || point.y > pageSize.height) return;
    setPencilHover(point);
  }, [inkTool, pageSize.height, pageSize.width]);
  const hoverHandlers = useMemo(() => ({
    onPointerEnter: handlePencilHoverMove,
    onPointerMove: handlePencilHoverMove,
    onPointerLeave: () => setPencilHover(null),
    onPointerCancel: () => setPencilHover(null),
  } as any), [handlePencilHoverMove]);
  const hoverSize = getPencilHoverSize(inkTool, inkTool === 'erase' ? canvasCtx.eraserWidth : penWidth, canvasCtx.eraserMode);
  const hoverVisible = pencilHover && shouldPreviewPencilHover(inkTool);
  const hoverToolLabel = getPencilHoverToolLabel(inkTool, canvasCtx.eraserMode);

  return (
    <View style={[props.styles.blankNoteCanvasCard, { paddingVertical: 0, borderWidth: 0 }]}>
      <View
        {...hoverHandlers}
        ref={captureTargetRef}
        collapsable={false}
        style={[props.styles.blankNotePage, { flex: 1, width: '100%', height: '100%', borderRadius: 20, borderWidth: 0, elevation: 0 }]}
        onLayout={(e) => setPageSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      >
        {props.backgroundImageUri ? (
          <Image
            source={{ uri: props.backgroundImageUri }}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%' }}
            resizeMode="contain"
          />
        ) : null}
        <View pointerEvents="none" style={props.styles.blankNoteRuleLayer} />

        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          <StaticStrokes strokes={visibleInkStrokes} type="highlight" />
          {currentStroke?.style === 'highlight' ? <InkPath stroke={currentStroke} draft /> : null}
        </Svg>

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

        {!capturingSelection && !draftSelection && selectionRect ? <SelectionOverlay rect={selectionRect} styles={props.styles} /> : null}
        {!capturingSelection && draftSelectionPath.length > 1 ? <SelectionLassoOverlay points={draftSelectionPath} /> : null}
        {!capturingSelection && draftSelection && draftSelection.mode !== 'lasso' ? <SelectionOverlay rect={draftSelection} styles={props.styles} draft /> : null}
        <GestureDetector gesture={inkGesture}>
          <View {...hoverHandlers} pointerEvents={inkTool === 'view' ? 'none' : 'auto'} style={props.styles.inkOverlay} />
        </GestureDetector>
        {!capturingSelection && selectionRect ? (
          <View
            {...selectionMovePanResponder.panHandlers}
            pointerEvents={inkTool === 'select' ? 'auto' : 'none'}
            style={{
              position: 'absolute',
              left: selectionRect.x,
              top: selectionRect.y,
              width: selectionRect.width,
              height: selectionRect.height,
              zIndex: 70,
              elevation: 70,
              backgroundColor: 'transparent',
            }}
          />
        ) : null}
        {!capturingSelection && !draftSelection && selectionRect ? (
          <SelectionContextMenu
            rect={selectionRect}
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
            borderColor={inkTool === 'erase' ? '#EF4444' : penColor}
            label={hoverToolLabel}
            isEraser={inkTool === 'erase'}
            activeTool={inkTool}
            styles={props.styles}
            onSelectTool={canvasCtx.setInkTool}
          />
        ) : null}
      </View>
    </View>
  );
}
