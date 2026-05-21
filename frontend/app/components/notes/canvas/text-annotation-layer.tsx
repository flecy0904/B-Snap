import React from 'react';
import { PanResponder, Pressable, Text, TextInput, View, type GestureResponderEvent } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { InkTextAnnotation } from '../../../ui-types';
import { isLikelyStylusEvent, shouldUsePrimaryPointer } from './ink-input-policy';

const MIN_TEXT_BOX_WIDTH = 96;
const MIN_TEXT_BOX_HEIGHT = 56;
const TEXT_TRASH_SIZE = 46;
const TEXT_TRASH_HIT_RADIUS = 52;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

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
  const [frameEditing, setFrameEditing] = React.useState(false);
  const [draggingToTrash, setDraggingToTrash] = React.useState(false);
  const [trashCenter, setTrashCenter] = React.useState<{ x: number; y: number } | null>(null);
  const trashCenterRef = React.useRef<{ x: number; y: number } | null>(null);
  const draggingToTrashRef = React.useRef(false);
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
    if (props.active) return;
    setFrameEditing(false);
    setDraggingToTrash(false);
    draggingToTrashRef.current = false;
    setTrashCenter(null);
    trashCenterRef.current = null;
  }, [props.active]);

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
    if (props.active && !frameEditing && !wasActiveRef.current) {
      const timer = setTimeout(() => inputRef.current?.focus(), 40);
      wasActiveRef.current = props.active;
      return () => clearTimeout(timer);
    }
    wasActiveRef.current = props.active;
    return undefined;
  }, [frameEditing, props.active]);

  const activateInput = () => {
    setFrameEditing(false);
    setDraggingToTrash(false);
    draggingToTrashRef.current = false;
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

  const getTrashCenter = React.useCallback((frame = annotationRef.current) => {
    const pageWidth = frame.pageWidth ?? frame.x + frame.width + 96;
    const pageHeight = frame.pageHeight ?? frame.y + (frame.height ?? 88) + 96;
    const targetX = frame.x + frame.width + 58 <= pageWidth
      ? frame.x + frame.width + 42
      : frame.x - 42;
    return {
      x: clamp(targetX, TEXT_TRASH_SIZE / 2 + 8, Math.max(TEXT_TRASH_SIZE / 2 + 8, pageWidth - TEXT_TRASH_SIZE / 2 - 8)),
      y: clamp(frame.y + (frame.height ?? 88) / 2, TEXT_TRASH_SIZE / 2 + 8, Math.max(TEXT_TRASH_SIZE / 2 + 8, pageHeight - TEXT_TRASH_SIZE / 2 - 8)),
    };
  }, []);

  const enterFrameEditing = () => {
    props.onActivate(props.annotation.id);
    inputRef.current?.blur();
    const nextTrashCenter = getTrashCenter();
    trashCenterRef.current = nextTrashCenter;
    setTrashCenter(nextTrashCenter);
    setFrameEditing(true);
    setDraggingToTrash(false);
    draggingToTrashRef.current = false;
  };

  const shouldEditFrame = React.useCallback((event: any) => (
    shouldUsePrimaryPointer(event) && isLikelyStylusEvent(event)
  ), []);

  const moveResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: (event) => frameEditing && Boolean(props.onMove) && shouldEditFrame(event),
    onStartShouldSetPanResponder: (event) => frameEditing && Boolean(props.onMove) && shouldEditFrame(event),
    onMoveShouldSetPanResponderCapture: (event, gesture) => Boolean(props.onMove)
      && frameEditing
      && shouldEditFrame(event)
      && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onMoveShouldSetPanResponder: (event, gesture) => Boolean(props.onMove)
      && frameEditing
      && shouldEditFrame(event)
      && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onPanResponderGrant: () => {
      props.onActivate(props.annotation.id);
      inputRef.current?.blur();
      startFrameRef.current = {
        x: annotationRef.current.x,
        y: annotationRef.current.y,
        width: annotationRef.current.width,
        height: annotationRef.current.height ?? 88,
      };
      const nextTrashCenter = getTrashCenter(annotationRef.current);
      trashCenterRef.current = nextTrashCenter;
      setTrashCenter(nextTrashCenter);
    },
    onPanResponderMove: (_event, gesture) => {
      if (!props.onMove) return;
      const nextX = startFrameRef.current.x + gesture.dx;
      const nextY = startFrameRef.current.y + gesture.dy;
      props.onMove(
        props.annotation.id,
        nextX,
        nextY,
      );
      const target = trashCenterRef.current;
      if (!target) return;
      const centerX = nextX + startFrameRef.current.width / 2;
      const centerY = nextY + startFrameRef.current.height / 2;
      const nextDraggingToTrash = Math.hypot(centerX - target.x, centerY - target.y) <= TEXT_TRASH_HIT_RADIUS;
      draggingToTrashRef.current = nextDraggingToTrash;
      setDraggingToTrash(nextDraggingToTrash);
    },
    onPanResponderRelease: () => {
      if (draggingToTrashRef.current) {
        props.onRemove(props.annotation.id);
        return;
      }
      setDraggingToTrash(false);
      draggingToTrashRef.current = false;
    },
    onPanResponderTerminate: () => {
      setDraggingToTrash(false);
      draggingToTrashRef.current = false;
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [frameEditing, getTrashCenter, props.annotation.id, props.onActivate, props.onMove, props.onRemove, shouldEditFrame]);

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

  const height = props.annotation.height ?? 88;
  const showFrameControls = frameEditing || !props.annotation.text.trim();
  const effectiveActive = props.active || frameEditing;
  const trashStyle = trashCenter
    ? {
        left: trashCenter.x - props.annotation.x - TEXT_TRASH_SIZE / 2,
        top: trashCenter.y - props.annotation.y - TEXT_TRASH_SIZE / 2,
      }
    : null;

  return (
    <View
      style={[
        props.styles.textAnnotationCard,
        effectiveActive && props.styles.textAnnotationCardActive,
        frameEditing && props.styles.textAnnotationCardEditing,
        {
          left: props.annotation.x,
          top: props.annotation.y,
          width: props.annotation.width,
          height,
        },
      ]}
      {...(frameEditing ? moveResponder.panHandlers : {})}
    >
      {frameEditing && trashStyle ? (
        <View
          pointerEvents="none"
          style={[
            props.styles.textAnnotationTrashTarget,
            draggingToTrash && props.styles.textAnnotationTrashTargetActive,
            trashStyle,
          ]}
        >
          <MaterialCommunityIcons name="trash-can-outline" size={19} color={draggingToTrash ? '#FFFFFF' : '#EF4444'} />
        </View>
      ) : null}
      {showFrameControls ? (
        <View pointerEvents="none" style={props.styles.textAnnotationFrameHint}>
          <MaterialCommunityIcons name="cursor-move" size={13} color="#4B5565" />
          <Text style={props.styles.textAnnotationMoveHandleText}>{frameEditing ? '드래그해서 이동' : '텍스트 입력'}</Text>
        </View>
      ) : null}
      <TextInput
        ref={inputRef}
        value={props.annotation.text}
        editable={!frameEditing}
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
            minHeight: Math.max(32, height - (showFrameControls ? 46 : 16)),
            color: props.annotation.color ?? '#111827',
          },
        ]}
      />
      {showFrameControls ? (
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
      ) : null}
      {!frameEditing && !props.active ? (
        <Pressable
          hitSlop={6}
          delayLongPress={220}
          onPress={activateBox}
          onLongPress={enterFrameEditing}
          style={props.styles.textAnnotationActivationOverlay}
        />
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
