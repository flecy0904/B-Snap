import React from 'react';
import { PanResponder, Pressable, Text, TextInput, View, type GestureResponderEvent } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { InkTextAnnotation } from '../../../ui-types';
import { isLikelyStylusEvent, shouldUsePrimaryPointer } from './ink-input-policy';

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
  const wasActiveRef = React.useRef(props.active);
  const [draftFrame, setDraftFrame] = React.useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
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
    setDraftFrame(null);
  }, [props.annotation.id]);

  React.useEffect(() => {
    if (!draftFrame) return;
    const annotationHeight = props.annotation.height ?? 88;
    if (
      Math.abs(props.annotation.x - draftFrame.x) < 0.5
      && Math.abs(props.annotation.y - draftFrame.y) < 0.5
      && Math.abs(props.annotation.width - draftFrame.width) < 0.5
      && Math.abs(annotationHeight - draftFrame.height) < 0.5
    ) {
      setDraftFrame(null);
    }
  }, [draftFrame, props.annotation.height, props.annotation.width, props.annotation.x, props.annotation.y]);

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

  React.useEffect(() => {
    if (props.active && !wasActiveRef.current) {
      const timer = setTimeout(() => inputRef.current?.focus(), 40);
      wasActiveRef.current = props.active;
      return () => clearTimeout(timer);
    }
    wasActiveRef.current = props.active;
    return undefined;
  }, [props.active]);

  const activateInput = () => {
    props.onActivate(props.annotation.id);
    inputRef.current?.focus();
  };

  const activateBox = () => {
    props.onActivate(props.annotation.id);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  const stopEvent = (event?: GestureResponderEvent) => {
    event?.stopPropagation?.();
  };

  const removeBox = (event?: GestureResponderEvent) => {
    stopEvent(event);
    props.onRemove(props.annotation.id);
  };

  const shouldEditFrame = React.useCallback((event: any) => (
    shouldUsePrimaryPointer(event) && isLikelyStylusEvent(event)
  ), []);

  const moveResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: (event) => Boolean(props.onMove) && shouldEditFrame(event),
    onStartShouldSetPanResponder: (event) => Boolean(props.onMove) && shouldEditFrame(event),
    onMoveShouldSetPanResponderCapture: (event, gesture) => Boolean(props.onMove)
      && shouldEditFrame(event)
      && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onMoveShouldSetPanResponder: (event, gesture) => Boolean(props.onMove)
      && shouldEditFrame(event)
      && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
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
      setDraftFrame({
        ...startFrameRef.current,
        x: startFrameRef.current.x + gesture.dx,
        y: startFrameRef.current.y + gesture.dy,
      });
    },
    onPanResponderRelease: (_event, gesture) => {
      if (!props.onMove) return;
      props.onMove(props.annotation.id, startFrameRef.current.x + gesture.dx, startFrameRef.current.y + gesture.dy);
    },
    onPanResponderTerminate: (_event, gesture) => {
      if (!props.onMove) return;
      props.onMove(props.annotation.id, startFrameRef.current.x + gesture.dx, startFrameRef.current.y + gesture.dy);
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [props.annotation.id, props.onActivate, props.onMove, shouldEditFrame]);

  const resizeResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: (event) => Boolean(props.onResize) && shouldEditFrame(event),
    onStartShouldSetPanResponder: (event) => Boolean(props.onResize) && shouldEditFrame(event),
    onMoveShouldSetPanResponderCapture: (event, gesture) => Boolean(props.onResize)
      && shouldEditFrame(event)
      && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onMoveShouldSetPanResponder: (event, gesture) => Boolean(props.onResize)
      && shouldEditFrame(event)
      && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
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
      setDraftFrame({
        ...startFrameRef.current,
        width: Math.max(MIN_TEXT_BOX_WIDTH, startFrameRef.current.width + gesture.dx),
        height: Math.max(MIN_TEXT_BOX_HEIGHT, startFrameRef.current.height + gesture.dy),
      });
    },
    onPanResponderRelease: (_event, gesture) => {
      if (!props.onResize) return;
      props.onResize(
        props.annotation.id,
        Math.max(MIN_TEXT_BOX_WIDTH, startFrameRef.current.width + gesture.dx),
        Math.max(MIN_TEXT_BOX_HEIGHT, startFrameRef.current.height + gesture.dy),
      );
    },
    onPanResponderTerminate: (_event, gesture) => {
      if (!props.onResize) return;
      props.onResize(
        props.annotation.id,
        Math.max(MIN_TEXT_BOX_WIDTH, startFrameRef.current.width + gesture.dx),
        Math.max(MIN_TEXT_BOX_HEIGHT, startFrameRef.current.height + gesture.dy),
      );
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [props.annotation.id, props.onActivate, props.onResize, shouldEditFrame]);

  const frame = draftFrame ?? {
    x: props.annotation.x,
    y: props.annotation.y,
    width: props.annotation.width,
    height: props.annotation.height ?? 88,
  };

  return (
    <View
      style={[
        props.styles.textAnnotationCard,
        props.active && props.styles.textAnnotationCardActive,
        {
          left: frame.x,
          top: frame.y,
          width: frame.width,
          height: frame.height,
        },
      ]}
    >
      {props.active ? (
        <View style={props.styles.textAnnotationFrameToolbar}>
          <View
            style={props.styles.textAnnotationMoveHandle}
            onStartShouldSetResponder={() => true}
            onResponderGrant={(event) => {
              stopEvent(event);
              props.onActivate(props.annotation.id);
            }}
            onTouchStart={() => props.onActivate(props.annotation.id)}
            {...moveResponder.panHandlers}
          >
            <MaterialCommunityIcons name="drag-horizontal-variant" size={17} color="#4B5565" />
            <Text style={props.styles.textAnnotationMoveHandleText}>이동</Text>
          </View>
          <Pressable
            hitSlop={12}
            style={props.styles.textAnnotationDelete}
            onStartShouldSetResponder={() => true}
            onResponderRelease={removeBox}
            onPressIn={(event) => {
              stopEvent(event);
              props.onActivate(props.annotation.id);
            }}
            onPress={removeBox}
          >
            <MaterialCommunityIcons name="close" size={14} color="#EF4444" />
          </Pressable>
        </View>
      ) : null}
      <TextInput
        ref={inputRef}
        value={props.annotation.text}
        onFocus={() => props.onActivate(props.annotation.id)}
        onPressIn={activateInput}
        onTouchEnd={() => inputRef.current?.focus()}
        onChangeText={(text) => props.onChangeText(props.annotation.id, text)}
        placeholder="텍스트 입력"
        placeholderTextColor="#9AA4B5"
        multiline
        blurOnSubmit={false}
        scrollEnabled
        textAlignVertical="top"
        style={[
          props.styles.textAnnotationInput,
          {
            minHeight: Math.max(32, frame.height - (props.active ? 46 : 16)),
            color: props.annotation.color ?? '#111827',
          },
        ]}
      />
      {props.active ? (
        <View
          style={props.styles.textAnnotationResizeHandle}
          onStartShouldSetResponder={() => true}
          onResponderGrant={(event) => {
            stopEvent(event);
            props.onActivate(props.annotation.id);
          }}
          onTouchStart={() => props.onActivate(props.annotation.id)}
          {...resizeResponder.panHandlers}
        >
          <MaterialCommunityIcons name="resize-bottom-right" size={13} color="#5F79FF" />
        </View>
      ) : (
        <Pressable
          hitSlop={6}
          onPress={activateBox}
          style={props.styles.textAnnotationActivationOverlay}
        />
      )}
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
