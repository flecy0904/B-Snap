import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, useWindowDimensions, View } from 'react-native';
import Pdf from 'react-native-pdf';
import Svg, { Path } from 'react-native-svg';
import { InkPoint, InkStroke, InkTool, SelectionRect } from '../ui-types';

export function PdfPreview(props: {
  file: number | { uri: string };
  page: number;
  inkTool: InkTool;
  inkStrokes: InkStroke[];
  selectionRect: SelectionRect | null;
  onCommitInkStroke: (stroke: InkStroke) => void;
  onSelectionChange: (rect: SelectionRect | null) => void;
  onPageChanged?: (page: number) => void;
  styles: any;
}) {
  const { width, height } = useWindowDimensions();
  const viewerWidth = Math.min(1240, Math.max(860, width - 150));
  const viewerHeight = Math.max(700, height - 130);
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);

  const clampPointToStage = (x: number, y: number) => ({
    x: Math.max(0, Math.min(viewerWidth, x)),
    y: Math.max(0, Math.min(viewerHeight, y)),
  });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => props.inkTool === 'pen',
        onMoveShouldSetPanResponder: () => props.inkTool === 'pen',
        onPanResponderGrant: (event) => {
          const point = clampPointToStage(event.nativeEvent.locationX, event.nativeEvent.locationY);
          if (props.inkTool === 'pen') {
            const stroke = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              color: '#2E3A59',
              width: 3,
              points: [point],
            };
            currentStrokeRef.current = stroke;
            setCurrentStroke(stroke);
          }
        },
        onPanResponderMove: (event) => {
          const point = clampPointToStage(event.nativeEvent.locationX, event.nativeEvent.locationY);
          if (props.inkTool === 'pen') {
            const stroke = currentStrokeRef.current;
            if (stroke) {
              const nextStroke = { ...stroke, points: [...stroke.points, point] };
              currentStrokeRef.current = nextStroke;
              setCurrentStroke(nextStroke);
            }
          }
        },
        onPanResponderRelease: () => {
          const stroke = currentStrokeRef.current;
          if (stroke && stroke.points.length > 1) props.onCommitInkStroke(stroke);
          currentStrokeRef.current = null;
          setCurrentStroke(null);
        },
        onPanResponderTerminate: () => {
          const stroke = currentStrokeRef.current;
          if (stroke && stroke.points.length > 1) props.onCommitInkStroke(stroke);
          currentStrokeRef.current = null;
          setCurrentStroke(null);
        },
      }),
    [props, viewerWidth, viewerHeight],
  );

  const handleSelectionStart = (x: number, y: number) => {
    if (props.inkTool !== 'select') return;
    const point = clampPointToStage(x, y);
    props.onSelectionChange(null);
    selectionOriginRef.current = point;
    const rect = { x: point.x, y: point.y, width: 0, height: 0 };
    draftSelectionRef.current = rect;
    setDraftSelection(rect);
  };

  const handleSelectionMove = (x: number, y: number) => {
    if (props.inkTool !== 'select') return;
    const origin = selectionOriginRef.current;
    if (!origin) return;
    const point = clampPointToStage(x, y);
    const nextRect = {
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      width: Math.abs(point.x - origin.x),
      height: Math.abs(point.y - origin.y),
    };
    draftSelectionRef.current = nextRect;
    setDraftSelection(nextRect);
  };

  const finishSelection = () => {
    if (props.inkTool !== 'select') return;
    const rect = draftSelectionRef.current;
    if (rect && rect.width > 24 && rect.height > 24) props.onSelectionChange(rect);
    draftSelectionRef.current = null;
    selectionOriginRef.current = null;
    setDraftSelection(null);
  };

  return (
    <View style={props.styles.pdfViewerCard}>
      <View style={[props.styles.pdfStage, { width: viewerWidth, height: viewerHeight }]}>
        <Pdf
          source={props.file}
          page={props.page}
          style={props.styles.pdfViewer}
          trustAllCerts={false}
          scrollEnabled={true}
          enablePaging={false}
          fitPolicy={0}
          horizontal={false}
          spacing={12}
          showsVerticalScrollIndicator={true}
          onPageChanged={(page) => props.onPageChanged?.(page)}
        />
        <View
          pointerEvents={props.inkTool === 'view' ? 'none' : 'auto'}
          style={props.styles.inkOverlay}
          onStartShouldSetResponder={() => props.inkTool === 'select'}
          onMoveShouldSetResponder={() => props.inkTool === 'select'}
          onResponderGrant={(event) => handleSelectionStart(event.nativeEvent.locationX, event.nativeEvent.locationY)}
          onResponderMove={(event) => handleSelectionMove(event.nativeEvent.locationX, event.nativeEvent.locationY)}
          onResponderRelease={finishSelection}
          onResponderTerminate={finishSelection}
          {...(props.inkTool === 'pen' ? panResponder.panHandlers : {})}
        >
          <Svg width="100%" height="100%" pointerEvents="none">
            {props.inkStrokes.map((stroke) => (
              <Path
                key={stroke.id}
                d={stroke.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')}
                stroke={stroke.color}
                strokeWidth={stroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ))}
            {currentStroke ? (
              <Path
                d={currentStroke.points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')}
                stroke={currentStroke.color}
                strokeWidth={currentStroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
            ) : null}
          </Svg>
          {!draftSelection && props.selectionRect ? <View pointerEvents="none" style={[props.styles.selectionOverlayRect, props.selectionRect]} /> : null}
          {draftSelection ? <View pointerEvents="none" style={[props.styles.selectionOverlayRect, props.styles.selectionOverlayDraft, draftSelection]} /> : null}
        </View>
      </View>
    </View>
  );
}
