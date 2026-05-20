import React from 'react';
import { PanResponder, Pressable, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { InkTextAnnotation } from '../../../ui-types';

const MIN_TEXT_BOX_WIDTH = 96;
const MIN_TEXT_BOX_HEIGHT = 56;

function MovableTextAnnotationBox(props: {
  annotation: InkTextAnnotation;
  active: boolean;
  styles: any;
  onActivate: (id: string) => void;
  onChangeText: (id: string, text: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, width: number, height: number) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = React.useRef<TextInput | null>(null);
  const annotationRef = React.useRef(props.annotation);
  const startFrameRef = React.useRef({
    x: props.annotation.x,
    y: props.annotation.y,
    width: props.annotation.width,
    height: props.annotation.height ?? 88,
  });

  React.useEffect(() => {
    annotationRef.current = props.annotation;
  }, [props.annotation]);

  React.useEffect(() => {
    if (!props.annotation.text.trim()) {
      const timer = setTimeout(() => {
        props.onActivate(props.annotation.id);
        inputRef.current?.focus();
      }, 80);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [props.annotation.id]);

  const activateInput = () => {
    props.onActivate(props.annotation.id);
    inputRef.current?.focus();
  };

  const moveResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => Boolean(props.onMove),
    onStartShouldSetPanResponder: () => Boolean(props.onMove),
    onMoveShouldSetPanResponderCapture: (_event, gesture) => Boolean(props.onMove) && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onMoveShouldSetPanResponder: (_event, gesture) => Boolean(props.onMove) && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onPanResponderGrant: () => {
      props.onActivate(props.annotation.id);
      startFrameRef.current = {
        x: annotationRef.current.x,
        y: annotationRef.current.y,
        width: annotationRef.current.width,
        height: annotationRef.current.height ?? 88,
      };
    },
    onPanResponderMove: (_event, gesture) => {
      if (!props.onMove) return;
      props.onMove(
        props.annotation.id,
        startFrameRef.current.x + gesture.dx,
        startFrameRef.current.y + gesture.dy,
      );
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [props.annotation.id, props.onActivate, props.onMove]);

  const resizeResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => Boolean(props.onResize),
    onStartShouldSetPanResponder: () => Boolean(props.onResize),
    onMoveShouldSetPanResponderCapture: (_event, gesture) => Boolean(props.onResize) && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onMoveShouldSetPanResponder: (_event, gesture) => Boolean(props.onResize) && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onPanResponderGrant: () => {
      props.onActivate(props.annotation.id);
      startFrameRef.current = {
        x: annotationRef.current.x,
        y: annotationRef.current.y,
        width: annotationRef.current.width,
        height: annotationRef.current.height ?? 88,
      };
    },
    onPanResponderMove: (_event, gesture) => {
      if (!props.onResize) return;
      props.onResize(
        props.annotation.id,
        Math.max(MIN_TEXT_BOX_WIDTH, startFrameRef.current.width + gesture.dx),
        Math.max(MIN_TEXT_BOX_HEIGHT, startFrameRef.current.height + gesture.dy),
      );
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [props.annotation.id, props.onActivate, props.onResize]);

  const height = props.annotation.height ?? 88;

  return (
    <View
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={activateInput}
      onResponderTerminationRequest={() => false}
      style={[
        props.styles.textAnnotationCard,
        props.active && props.styles.textAnnotationCardActive,
        {
          left: props.annotation.x,
          top: props.annotation.y,
          width: props.annotation.width,
          height,
        },
      ]}
    >
      {props.active ? (
        <View style={props.styles.textAnnotationFrameToolbar}>
          <View style={props.styles.textAnnotationMoveHandle} {...moveResponder.panHandlers}>
            <MaterialCommunityIcons name="drag-horizontal-variant" size={17} color="#4B5565" />
          </View>
          <Pressable hitSlop={12} style={props.styles.textAnnotationDelete} onPress={() => props.onRemove(props.annotation.id)}>
            <MaterialCommunityIcons name="close" size={14} color="#EF4444" />
          </Pressable>
        </View>
      ) : null}
      <TextInput
        ref={inputRef}
        value={props.annotation.text}
        onFocus={() => props.onActivate(props.annotation.id)}
        onPressIn={activateInput}
        onChangeText={(text) => props.onChangeText(props.annotation.id, text)}
        placeholder="텍스트 입력"
        placeholderTextColor="#9AA4B5"
        multiline
        scrollEnabled
        textAlignVertical="top"
        style={[
          props.styles.textAnnotationInput,
          {
            minHeight: Math.max(32, height - (props.active ? 46 : 16)),
          },
        ]}
      />
      {props.active ? (
        <View style={props.styles.textAnnotationResizeHandle} {...resizeResponder.panHandlers}>
          <MaterialCommunityIcons name="resize-bottom-right" size={13} color="#5F79FF" />
        </View>
      ) : null}
    </View>
  );
}

export function TextAnnotationLayer(props: {
  annotations: InkTextAnnotation[];
  styles: any;
  onChangeText: (id: string, text: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, width: number, height: number) => void;
  onRemove: (id: string) => void;
  variant?: 'floating' | 'marker';
}) {
  const [activeAnnotationId, setActiveAnnotationId] = React.useState<string | null>(null);
  const variant = props.variant ?? 'floating';

  React.useEffect(() => {
    if (!activeAnnotationId) return;
    if (props.annotations.some((annotation) => annotation.id === activeAnnotationId)) return;
    setActiveAnnotationId(null);
  }, [activeAnnotationId, props.annotations]);

  return (
    <View pointerEvents="box-none" style={props.styles.textAnnotationLayer}>
      {props.annotations.map((annotation) => {
        if (variant === 'marker' && annotation.anchorRect) {
          return (
            <View key={annotation.id} pointerEvents="box-none">
              <View
                pointerEvents="none"
                style={[
                  props.styles.textAnnotationAnchorRect,
                  {
                    left: annotation.anchorRect.x,
                    top: annotation.anchorRect.y,
                    width: annotation.anchorRect.width,
                    height: annotation.anchorRect.height,
                  },
                ]}
              />
              <View
                style={[
                  props.styles.textAnnotationMarker,
                  {
                    left: annotation.anchorRect.x + annotation.anchorRect.width - 12,
                    top: Math.max(12, annotation.anchorRect.y - 12),
                  },
                ]}
              >
                <MaterialCommunityIcons name="note-text-outline" size={12} color="#FFFFFF" />
                <Text style={props.styles.textAnnotationMarkerText}>{annotation.text.trim() ? '메모' : '새 메모'}</Text>
              </View>
            </View>
          );
        }

        return (
          <MovableTextAnnotationBox
            key={annotation.id}
            annotation={annotation}
            active={activeAnnotationId === annotation.id || !annotation.text.trim()}
            styles={props.styles}
            onActivate={setActiveAnnotationId}
            onChangeText={props.onChangeText}
            onMove={props.onMove}
            onResize={props.onResize}
            onRemove={props.onRemove}
          />
        );
      })}
    </View>
  );
}
