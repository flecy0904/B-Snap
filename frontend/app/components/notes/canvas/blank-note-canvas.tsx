import React, { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { TextAnnotationLayer } from './text-annotation-layer';
import { InkPath } from './ink-path';
import { finalizeInkStroke, isDrawingTool, isShapeTool, resolveInkStrokeAppearance, resolveShapeStrokeAppearance, shouldAppendInkPoint } from '../../../ui-helpers';
import { InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { useCanvasContext } from './canvas-context';
import { shouldActivateNativeInkGesture, type NativeGestureStateManager, type NativeInkGestureEvent, type NativeInkTouchEvent } from './native-ink-gesture-policy';
import { getPencilHoverPoint, getPencilHoverSize, getPencilHoverToolLabel, isStylusHoverEvent, shouldPreviewPencilHover, type PencilHoverPoint } from './native-pencil-hover';

type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

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
    pageWidth: point.pageWidth,
    pageHeight: point.pageHeight,
  };
}

function getSelectionRectFromDrag(origin: InkPoint, point: InkPoint): SelectionRect {
  return {
    x: Math.min(origin.x, point.x),
    y: Math.min(origin.y, point.y),
    width: Math.abs(point.x - origin.x),
    height: Math.abs(point.y - origin.y),
    mode: 'rect',
    pageWidth: point.pageWidth,
    pageHeight: point.pageHeight,
  };
}

function getSelectionRectFromPoints(points: InkPoint[]): SelectionRect | null {
  if (points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const reference = points[0];
  return {
    x: Math.max(0, Math.min(...xs)),
    y: Math.max(0, Math.min(...ys)),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    mode: 'lasso',
    path: points,
    pageWidth: reference.pageWidth,
    pageHeight: reference.pageHeight,
  };
}

function getLassoPath(points: InkPoint[]) {
  if (!points.length) return '';
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
}

function SelectionOverlay(props: { rect: SelectionRect; styles: any; draft?: boolean }) {
  const handleOffset = -7;
  const lassoPath = props.rect.path && props.rect.path.length > 2 ? getLassoPath(props.rect.path) : '';
  if (props.rect.mode === 'lasso') {
    if (!lassoPath) return null;
    return (
      <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
        <Path
          d={`${lassoPath} Z`}
          fill="rgba(78, 141, 255, 0.06)"
          stroke="#2563EB"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="7 5"
          opacity={props.draft ? 0.88 : 0.96}
        />
      </Svg>
    );
  }

  return (
    <View pointerEvents="none" style={[props.styles.selectionOverlayRect, props.draft && props.styles.selectionOverlayDraft, { left: props.rect.x, top: props.rect.y, width: props.rect.width, height: props.rect.height }]}>
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
        <View
          key={corner}
          style={[
            props.styles.selectionResizeHandle,
            {
              left: corner === 'nw' || corner === 'sw' ? handleOffset : props.rect.width + handleOffset,
              top: corner === 'nw' || corner === 'ne' ? handleOffset : props.rect.height + handleOffset,
            },
          ]}
        />
      ))}
    </View>
  );
}

function SelectionLassoOverlay(props: { points: InkPoint[] }) {
  if (props.points.length < 2) return null;
  return (
    <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
      <Path
        d={getLassoPath(props.points)}
        fill="none"
        stroke="#2563EB"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="7 5"
        opacity={0.9}
      />
    </Svg>
  );
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
    setSelectionRect: onSelectionChange,
    setSelectionPreviewUri: onSelectionPreviewChange,
  } = canvasCtx;

  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const [draftSelectionPath, setDraftSelectionPath] = useState<InkPoint[]>([]);
  const [capturingSelection, setCapturingSelection] = useState(false);
  const [pencilHover, setPencilHover] = useState<PencilHoverPoint | null>(null);
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

  const eraseAtPoint = useCallback((point: InkPoint) => {
    const radius = Math.max(10, penWidth * 2.4);
    const changed = canvasCtx.eraseInkAtPoint(point, radius, !eraserSnapshotPushedRef.current);
    if (changed) eraserSnapshotPushedRef.current = true;
  }, [canvasCtx, penWidth]);

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
      const rect = { x: point.x, y: point.y, width: 0, height: 0, mode: selectionMode, pageWidth: point.pageWidth, pageHeight: point.pageHeight };
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
        const nextRect = getSelectionRectFromDrag(origin, point);
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
      const nextRect = getSelectionRectFromPoints(nextPath) ?? getSelectionRectFromDrag(origin, point);
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
  const hoverSize = getPencilHoverSize(inkTool, penWidth);
  const hoverVisible = pencilHover && shouldPreviewPencilHover(inkTool);
  const hoverToolLabel = getPencilHoverToolLabel(inkTool);

  return (
    <View style={[props.styles.blankNoteCanvasCard, { paddingVertical: 0, borderWidth: 0 }]}>
      <GestureDetector gesture={inkGesture}>
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
            <StaticStrokes strokes={inkStrokes} type="highlight" />
            {currentStroke?.style === 'highlight' ? <InkPath stroke={currentStroke} draft /> : null}
          </Svg>

          <TextAnnotationLayer
            annotations={textAnnotations}
            styles={props.styles}
            onChangeText={onUpdateTextAnnotation}
            onMove={onMoveTextAnnotation}
            onResize={onResizeTextAnnotation}
            onRemove={onRemoveTextAnnotation}
          />

          <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
            <StaticStrokes strokes={inkStrokes} type="ink" />
            {currentStroke?.style !== 'highlight' && currentStroke ? <InkPath stroke={currentStroke} draft /> : null}
          </Svg>

          {!capturingSelection && !draftSelection && selectionRect ? <SelectionOverlay rect={selectionRect} styles={props.styles} /> : null}
          {!capturingSelection && draftSelectionPath.length > 1 ? <SelectionLassoOverlay points={draftSelectionPath} /> : null}
          {!capturingSelection && draftSelection && draftSelection.mode !== 'lasso' ? <SelectionOverlay rect={draftSelection} styles={props.styles} draft /> : null}
          {hoverVisible ? (
            <>
              <View
                pointerEvents="none"
                style={[
                  props.styles.pencilHoverPreview,
                  inkTool === 'erase' && props.styles.pencilHoverPreviewEraser,
                  {
                    left: pencilHover.x - hoverSize / 2,
                    top: pencilHover.y - hoverSize / 2,
                    width: hoverSize,
                    height: hoverSize,
                    borderRadius: hoverSize / 2,
                    borderColor: inkTool === 'erase' ? '#EF4444' : penColor,
                  },
                ]}
              />
              {hoverToolLabel ? (
                <View
                  pointerEvents="none"
                  style={[
                    props.styles.pencilHoverLabel,
                    {
                      left: Math.min(Math.max(6, pencilHover.x + hoverSize / 2 + 8), Math.max(6, pageSize.width - 76)),
                      top: Math.min(Math.max(6, pencilHover.y - hoverSize / 2 - 2), Math.max(6, pageSize.height - 30)),
                    },
                  ]}
                >
                  <Text style={props.styles.pencilHoverLabelText}>{hoverToolLabel}</Text>
                </View>
              ) : null}
            </>
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}
