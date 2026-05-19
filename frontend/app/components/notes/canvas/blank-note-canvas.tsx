import React, { useCallback, useMemo, useRef, useState, memo } from 'react';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Image, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { TextAnnotationLayer } from './text-annotation-layer';
import { InkPath } from './ink-path';
import { finalizeInkStroke, findHitInkStrokeId, isDrawingTool, isShapeTool, resolveInkStrokeAppearance, resolveShapeStrokeAppearance, shouldAppendInkPoint } from '../../../ui-helpers';
import { InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { useCanvasContext } from './canvas-context';
import { shouldActivateNativeInkGesture, type NativeGestureStateManager, type NativeInkGestureEvent, type NativeInkTouchEvent } from './native-ink-gesture-policy';

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

function SelectionOverlay(props: { rect: SelectionRect; styles: any; draft?: boolean }) {
  const handleOffset = -7;
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
    brushSettings,
    inkStrokes,
    textAnnotations,
    selectionRect,
    commitInkStroke: onCommitInkStroke,
    removeInkStroke: onRemoveInkStroke,
    addTextAnnotation: onAddTextAnnotation,
    updateTextAnnotation: onUpdateTextAnnotation,
    removeTextAnnotation: onRemoveTextAnnotation,
    setSelectionRect: onSelectionChange,
    setSelectionPreviewUri: onSelectionPreviewChange,
  } = canvasCtx;

  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const [capturingSelection, setCapturingSelection] = useState(false);
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveStartRectRef = useRef<SelectionRect | null>(null);
  const selectionResizeCornerRef = useRef<ResizeCorner | null>(null);
  const selectionResizeStartRectRef = useRef<SelectionRect | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const textTapRef = useRef<InkPoint | null>(null);
  const captureTargetRef = useRef<View | null>(null);

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
        setDraftSelection(currentSelection);
        return;
      }
      onSelectionChange?.(null);
      onSelectionPreviewChange?.(null);
      selectionOriginRef.current = point;
      const rect = { x: point.x, y: point.y, width: 0, height: 0, pageWidth: point.pageWidth, pageHeight: point.pageHeight };
      draftSelectionRef.current = rect;
      setDraftSelection(rect);
      return;
    }

    if (inkTool === 'text') {
      textTapRef.current = point;
      return;
    }
    if (inkTool === 'erase') {
      const hitStrokeId = findHitInkStrokeId(inkStrokes, point);
      if (hitStrokeId) onRemoveInkStroke(hitStrokeId);
    }
  }, [
    brushSettings,
    brushType,
    inkStrokes,
    inkTool,
    linePattern,
    onRemoveInkStroke,
    onSelectionChange,
    onSelectionPreviewChange,
    pageSize,
    penColor,
    penWidth,
    selectionRect,
  ]);

  const handleInkGestureMove = useCallback((x: number, y: number) => {
    if (!isDrawingTool(inkTool) && inkTool !== 'select') return;
    const point = clampPointToPage(x, y);

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
        const nextRect = {
          ...moveStartRect,
          x: moveStartRect.x + point.x - moveOrigin.x,
          y: moveStartRect.y + point.y - moveOrigin.y,
          pageWidth: point.pageWidth,
          pageHeight: point.pageHeight,
        };
        draftSelectionRef.current = nextRect;
        setDraftSelection(nextRect);
        return;
      }
      const origin = selectionOriginRef.current;
      if (!origin) return;
      const nextRect = {
        x: Math.min(origin.x, point.x),
        y: Math.min(origin.y, point.y),
        width: Math.abs(point.x - origin.x),
        height: Math.abs(point.y - origin.y),
        pageWidth: point.pageWidth,
        pageHeight: point.pageHeight,
      };
      draftSelectionRef.current = nextRect;
      setDraftSelection(nextRect);
    }
  }, [inkTool, pageSize]);

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
      setDraftSelection(null);
      if (resized && rect && rect.width > 24 && rect.height > 24) {
        canvasCtx.resizeSelectedStrokesToRect(rect);
      } else if (rect && moveOrigin && moveStartRect) {
        const dx = rect.x - moveStartRect.x;
        const dy = rect.y - moveStartRect.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) canvasCtx.nudgeSelectedStrokes(dx, dy);
      } else if (rect && rect.width > 24 && rect.height > 24) {
        void buildSelectionPreview(rect).then((uri) => {
          onSelectionChange?.(rect);
          onSelectionPreviewChange?.(uri);
        });
      }
    }
    if (inkTool === 'text' && textTapRef.current) onAddTextAnnotation(textTapRef.current);
    currentStrokeRef.current = null;
    textTapRef.current = null;
    setCurrentStroke(null);
  }, [buildSelectionPreview, canvasCtx, inkTool, onAddTextAnnotation, onCommitInkStroke, onSelectionChange, onSelectionPreviewChange]);

  const handleInkGestureCancel = useCallback(() => {
    const stroke = currentStrokeRef.current;
    if (stroke && stroke.points.length > 1) onCommitInkStroke(finalizeInkStroke(stroke));
    currentStrokeRef.current = null;
    draftSelectionRef.current = null;
    selectionOriginRef.current = null;
    selectionMoveOriginRef.current = null;
    selectionMoveStartRectRef.current = null;
    selectionResizeCornerRef.current = null;
    selectionResizeStartRectRef.current = null;
    textTapRef.current = null;
    setDraftSelection(null);
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

  return (
    <View style={[props.styles.blankNoteCanvasCard, { paddingVertical: 0, borderWidth: 0 }]}>
      <GestureDetector gesture={inkGesture}>
        <View
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
            onRemove={onRemoveTextAnnotation}
          />

          <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
            <StaticStrokes strokes={inkStrokes} type="ink" />
            {currentStroke?.style !== 'highlight' && currentStroke ? <InkPath stroke={currentStroke} draft /> : null}
          </Svg>

          {!capturingSelection && !draftSelection && selectionRect ? <SelectionOverlay rect={selectionRect} styles={props.styles} /> : null}
          {!capturingSelection && draftSelection ? <SelectionOverlay rect={draftSelection} styles={props.styles} draft /> : null}
        </View>
      </GestureDetector>
    </View>
  );
}
