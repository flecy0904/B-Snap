import React, { useMemo, useRef, useState, memo } from 'react';
import { GestureResponderEvent, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { TextAnnotationLayer } from './text-annotation-layer';
import { findHitInkStrokeId, getInkStrokeSvgPath, resolveInkStrokeAppearance } from '../ui-helpers';
import { InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../ui-types';

type ResponderNativeEvent = GestureResponderEvent['nativeEvent'] & {
  buttons?: number;
  touches?: unknown[];
};

function shouldUsePrimaryPointer(event: GestureResponderEvent) {
  const nativeEvent = event.nativeEvent as ResponderNativeEvent;
  if (nativeEvent.touches && nativeEvent.touches.length > 1) return false;
  if (nativeEvent.buttons !== undefined && nativeEvent.buttons !== 1) return false;
  return true;
}

const StaticStrokes = memo(({ strokes, type }: { strokes: InkStroke[]; type: 'highlight' | 'pen' }) => {
  const filteredStrokes = useMemo(
    () => strokes.filter((stroke) => (type === 'highlight' ? stroke.style === 'highlight' : stroke.style !== 'highlight')),
    [strokes, type],
  );

  return (
    <>
      {filteredStrokes.map((stroke) => {
        const path = getInkStrokeSvgPath(stroke);
        if (!path) return null;
        
        if (type === 'highlight') {
          return (
            <Path
              key={stroke.id}
              d={path}
              fill={stroke.color}
              opacity={0.72}
            />
          );
        }

        return <Path key={stroke.id} d={path} fill={stroke.color} />;
      })}
    </>
  );
});

export function BlankNoteCanvas(props: {
  inkTool: InkTool;
  penColor: string;
  penWidth: number;
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  selectionRect?: SelectionRect | null;
  onCommitInkStroke: (stroke: InkStroke) => void;
  onRemoveInkStroke: (strokeId: string) => void;
  onAddTextAnnotation: (point: InkPoint) => void;
  onUpdateTextAnnotation: (id: string, text: string) => void;
  onRemoveTextAnnotation: (id: string) => void;
  onSelectionChange?: (rect: SelectionRect | null) => void;
  styles: any;
}) {
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const textTapRef = useRef<InkPoint | null>(null);

  const clampPointToPage = (x: number, y: number): InkPoint => ({
    x: Math.max(0, Math.min(pageSize.width || 1000, x)),
    y: Math.max(0, Math.min(pageSize.height || 1000, y)),
    pageWidth: pageSize.width || 1000,
    pageHeight: pageSize.height || 1000,
  });

  const panResponder = useMemo(
    () => ({
      onStartShouldSetResponder: (event: GestureResponderEvent) => {
        if (!shouldUsePrimaryPointer(event)) return false;
        return props.inkTool === 'pen' || props.inkTool === 'highlight' || props.inkTool === 'text' || props.inkTool === 'erase' || props.inkTool === 'select';
      },
      onMoveShouldSetResponder: (event: GestureResponderEvent) => {
        if (!shouldUsePrimaryPointer(event)) return false;
        return props.inkTool === 'pen' || props.inkTool === 'highlight' || props.inkTool === 'select';
      },
      onResponderGrant: (event: GestureResponderEvent) => {
        const point = clampPointToPage(event.nativeEvent.locationX, event.nativeEvent.locationY);
        if (props.inkTool === 'pen' || props.inkTool === 'highlight') {
          const appearance = resolveInkStrokeAppearance(props.inkTool, props.penColor, props.penWidth);
          const stroke: InkStroke = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            color: appearance.color,
            width: appearance.width,
            style: props.inkTool === 'highlight' ? 'highlight' : 'pen',
            pageWidth: pageSize.width || 1000,
            pageHeight: pageSize.height || 1000,
            points: [point],
          };
          currentStrokeRef.current = stroke;
          setCurrentStroke(stroke);
          return;
        }

        if (props.inkTool === 'select') {
          props.onSelectionChange?.(null);
          selectionOriginRef.current = point;
          const rect = { x: point.x, y: point.y, width: 0, height: 0, pageWidth: point.pageWidth, pageHeight: point.pageHeight };
          draftSelectionRef.current = rect;
          setDraftSelection(rect);
          return;
        }

        if (props.inkTool === 'text') {
          textTapRef.current = point;
        }
        if (props.inkTool === 'erase') {
          const hitStrokeId = findHitInkStrokeId(props.inkStrokes, point);
          if (hitStrokeId) {
            props.onRemoveInkStroke(hitStrokeId);
          }
        }
      },
      onResponderMove: (event: GestureResponderEvent) => {
        if (props.inkTool !== 'pen' && props.inkTool !== 'highlight' && props.inkTool !== 'select') return;
        const point = clampPointToPage(event.nativeEvent.locationX, event.nativeEvent.locationY);
        
        if (props.inkTool === 'pen' || props.inkTool === 'highlight') {
          const stroke = currentStrokeRef.current;
          if (!stroke) return;
          const lastPoint = stroke.points[stroke.points.length - 1];
          const dist = Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y);
          if (dist < 1.2) return;

          const nextStroke = { ...stroke, points: [...stroke.points, point] };
          currentStrokeRef.current = nextStroke;
          setCurrentStroke(nextStroke);
          return;
        }

        if (props.inkTool === 'select') {
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
      },
      onResponderRelease: () => {
        const stroke = currentStrokeRef.current;
        if (stroke && stroke.points.length > 1) props.onCommitInkStroke(stroke);
        if (props.inkTool === 'select') {
          const rect = draftSelectionRef.current;
          if (rect && rect.width > 24 && rect.height > 24) props.onSelectionChange?.(rect);
          draftSelectionRef.current = null;
          selectionOriginRef.current = null;
          setDraftSelection(null);
        }
        if (props.inkTool === 'text' && textTapRef.current) props.onAddTextAnnotation(textTapRef.current);
        currentStrokeRef.current = null;
        textTapRef.current = null;
        setCurrentStroke(null);
      },
      onResponderTerminate: () => {
        const stroke = currentStrokeRef.current;
        if (stroke && stroke.points.length > 1) props.onCommitInkStroke(stroke);
        currentStrokeRef.current = null;
        draftSelectionRef.current = null;
        selectionOriginRef.current = null;
        textTapRef.current = null;
        setDraftSelection(null);
        setCurrentStroke(null);
      },
    }),
    [props, pageSize],
  );

  const currentPenPath = currentStroke?.style === 'pen' ? getInkStrokeSvgPath(currentStroke, false) : '';
  const currentHighlightPath = currentStroke?.style === 'highlight' ? getInkStrokeSvgPath(currentStroke, false) : '';

  return (
    <View style={[props.styles.blankNoteCanvasCard, { paddingVertical: 0, borderWidth: 0 }]}>
      <View 
        style={[props.styles.blankNotePage, { flex: 1, width: '100%', height: '100%', borderRadius: 20, borderWidth: 0, elevation: 0 }]} 
        onLayout={(e) => setPageSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        {...panResponder}
      >
        <View pointerEvents="none" style={props.styles.blankNoteRuleLayer} />

        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          <StaticStrokes strokes={props.inkStrokes} type="highlight" />
          {currentHighlightPath ? (
            <Path
              d={currentHighlightPath}
              fill={currentStroke?.color}
              opacity={0.72}
            />
          ) : null}
        </Svg>

        <TextAnnotationLayer
          annotations={props.textAnnotations}
          styles={props.styles}
          onChangeText={props.onUpdateTextAnnotation}
          onRemove={props.onRemoveTextAnnotation}
        />

        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          <StaticStrokes strokes={props.inkStrokes} type="pen" />
          {currentPenPath ? <Path d={currentPenPath} fill={currentStroke?.color} /> : null}
        </Svg>
        
        {!draftSelection && props.selectionRect ? <View pointerEvents="none" style={[props.styles.selectionOverlayRect, { left: props.selectionRect.x, top: props.selectionRect.y, width: props.selectionRect.width, height: props.selectionRect.height }]} /> : null}
        {draftSelection ? <View pointerEvents="none" style={[props.styles.selectionOverlayRect, props.styles.selectionOverlayDraft, { left: draftSelection.x, top: draftSelection.y, width: draftSelection.width, height: draftSelection.height }]} /> : null}
      </View>
    </View>
  );
}
