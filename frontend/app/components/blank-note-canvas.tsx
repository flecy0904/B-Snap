import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { InkPoint, InkStroke, InkTool } from '../ui-types';

export function BlankNoteCanvas(props: {
  inkTool: InkTool;
  inkStrokes: InkStroke[];
  onCommitInkStroke: (stroke: InkStroke) => void;
  styles: any;
}) {
  const { width, height } = useWindowDimensions();
  const pageWidth = Math.min(980, Math.max(340, width >= 900 ? width - 320 : width - 44));
  const pageHeight = Math.min(Math.max(620, height - 180), pageWidth * 1.35);
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const currentStrokeRef = useRef<InkStroke | null>(null);

  const clampPointToPage = (x: number, y: number): InkPoint => ({
    x: Math.max(0, Math.min(pageWidth, x)),
    y: Math.max(0, Math.min(pageHeight, y)),
  });

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => props.inkTool === 'pen',
        onMoveShouldSetPanResponder: () => props.inkTool === 'pen',
        onPanResponderGrant: (event) => {
          if (props.inkTool !== 'pen') return;
          const point = clampPointToPage(event.nativeEvent.locationX, event.nativeEvent.locationY);
          const stroke = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            color: '#2E3A59',
            width: 3,
            points: [point],
          };
          currentStrokeRef.current = stroke;
          setCurrentStroke(stroke);
        },
        onPanResponderMove: (event) => {
          if (props.inkTool !== 'pen') return;
          const stroke = currentStrokeRef.current;
          if (!stroke) return;
          const point = clampPointToPage(event.nativeEvent.locationX, event.nativeEvent.locationY);
          const nextStroke = { ...stroke, points: [...stroke.points, point] };
          currentStrokeRef.current = nextStroke;
          setCurrentStroke(nextStroke);
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
    [props, pageWidth, pageHeight],
  );

  return (
    <View style={props.styles.blankNoteCanvasCard}>
      <View style={[props.styles.blankNotePage, { width: pageWidth, height: pageHeight }]} {...(props.inkTool === 'pen' ? panResponder.panHandlers : {})}>
        <View pointerEvents="none" style={props.styles.blankNoteRuleLayer}>
          {Array.from({ length: Math.floor(pageHeight / 34) }).map((_, index) => (
            <View key={index} style={[props.styles.blankNoteRuleLine, { top: 54 + index * 34 }]} />
          ))}
        </View>
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
      </View>
    </View>
  );
}
