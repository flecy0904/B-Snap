import React from 'react';
import { InputAccessoryView, Keyboard, PanResponder, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { InkTextAnnotation } from '../../../ui-types';
import { isLikelyStylusEvent, shouldUsePrimaryPointer } from './ink-input-policy';

const MIN_TEXT_BOX_WIDTH = 96;
const MIN_TEXT_BOX_HEIGHT = 56;
const DEFAULT_TEXT_FONT_SIZE = 17;
const MIN_TEXT_FONT_SIZE = 12;
const MAX_TEXT_FONT_SIZE = 40;
const TEXT_TOOLBAR_WIDTH = 220;

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
  onChangeFontSize?: (id: string, fontSize: number) => void;
  onRemove: (id: string) => void;
}) {
  const inputRef = React.useRef<TextInput | null>(null);
  const annotationRef = React.useRef(props.annotation);
  const wasActiveRef = React.useRef(props.active);
  const draggingRef = React.useRef(false);
  const [dragging, setDragging] = React.useState(false);
  const [draftFrame, setDraftFrame] = React.useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const [draftText, setDraftText] = React.useState(props.annotation.text);
  const draftFrameRef = React.useRef<typeof draftFrame>(null);
  const startFrameRef = React.useRef({
    x: props.annotation.x,
    y: props.annotation.y,
    width: props.annotation.width,
    height: props.annotation.height ?? 88,
  });
  const effectiveFrame = draftFrame ?? {
    x: props.annotation.x,
    y: props.annotation.y,
    width: props.annotation.width,
    height: props.annotation.height ?? 88,
  };
  const height = effectiveFrame.height;
  const effectiveActive = props.active;
  const fontSize = clamp(Math.round(props.annotation.fontSize ?? DEFAULT_TEXT_FONT_SIZE), MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE);
  const inputAccessoryViewID = React.useMemo(
    () => `text-annotation-accessory-${props.annotation.id}`,
    [props.annotation.id],
  );

  const updateDraftFrame = React.useCallback((frame: typeof draftFrame) => {
    draftFrameRef.current = frame;
    setDraftFrame(frame);
  }, []);

  React.useEffect(() => {
    annotationRef.current = props.annotation;
  }, [props.annotation]);

  const commitText = React.useCallback(() => {
    if (draftText !== annotationRef.current.text) {
      props.onChangeText(props.annotation.id, draftText);
    }
  }, [draftText, props]);

  React.useEffect(() => {
    if (props.active) return;
    setDraftText(props.annotation.text);
  }, [props.active, props.annotation.text]);

  React.useEffect(() => {
    if (props.active) return;
    commitText();
    setDragging(false);
    updateDraftFrame(null);
    draggingRef.current = false;
  }, [commitText, props.active, updateDraftFrame]);

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
    if (props.active && !wasActiveRef.current && !draggingRef.current) {
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

  const changeFontSize = (delta: number) => {
    props.onActivate(props.annotation.id);
    commitText();
    props.onChangeFontSize?.(
      props.annotation.id,
      clamp(fontSize + delta, MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE),
    );
  };

  const shouldEditFrame = React.useCallback((event: any) => (
    shouldUsePrimaryPointer(event) && isLikelyStylusEvent(event)
  ), []);

  const clampFramePosition = React.useCallback((x: number, y: number, width: number, boxHeight: number) => {
    const frame = annotationRef.current;
    const pageWidth = frame.pageWidth ?? frame.x + width + 96;
    const pageHeight = frame.pageHeight ?? frame.y + boxHeight + 96;
    return {
      x: clamp(x, 0, Math.max(0, pageWidth - width)),
      y: clamp(y, 0, Math.max(0, pageHeight - boxHeight)),
    };
  }, []);

  const moveResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => false,
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponderCapture: (event, gesture) => Boolean(props.onMove)
      && effectiveActive
      && shouldEditFrame(event)
      && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onMoveShouldSetPanResponder: (event, gesture) => Boolean(props.onMove)
      && effectiveActive
      && shouldEditFrame(event)
      && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onPanResponderGrant: () => {
      props.onActivate(props.annotation.id);
      inputRef.current?.blur();
      Keyboard.dismiss();
      draggingRef.current = true;
      setDragging(true);
      startFrameRef.current = {
        x: annotationRef.current.x,
        y: annotationRef.current.y,
        width: annotationRef.current.width,
        height: annotationRef.current.height ?? 88,
      };
      updateDraftFrame(startFrameRef.current);
    },
    onPanResponderMove: (_event, gesture) => {
      if (!props.onMove) return;
      const next = clampFramePosition(
        startFrameRef.current.x + gesture.dx,
        startFrameRef.current.y + gesture.dy,
        startFrameRef.current.width,
        startFrameRef.current.height,
      );
      updateDraftFrame({ ...startFrameRef.current, x: next.x, y: next.y });
    },
    onPanResponderRelease: () => {
      const frame = draftFrameRef.current;
      if (frame && props.onMove) props.onMove(props.annotation.id, frame.x, frame.y);
      draggingRef.current = false;
      setDragging(false);
      updateDraftFrame(null);
    },
    onPanResponderTerminate: () => {
      draggingRef.current = false;
      setDragging(false);
      updateDraftFrame(null);
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [clampFramePosition, effectiveActive, props.annotation.id, props.onActivate, props.onMove, shouldEditFrame, updateDraftFrame]);

  const resizeResponder = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: (event) => effectiveActive && Boolean(props.onResize) && shouldEditFrame(event),
    onStartShouldSetPanResponder: (event) => effectiveActive && Boolean(props.onResize) && shouldEditFrame(event),
    onMoveShouldSetPanResponderCapture: (event, gesture) => Boolean(props.onResize)
      && effectiveActive
      && shouldEditFrame(event)
      && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onMoveShouldSetPanResponder: (event, gesture) => Boolean(props.onResize)
      && effectiveActive
      && shouldEditFrame(event)
      && (Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2),
    onPanResponderGrant: () => {
      props.onActivate(props.annotation.id);
      inputRef.current?.blur();
      Keyboard.dismiss();
      setDragging(true);
      startFrameRef.current = {
        x: annotationRef.current.x,
        y: annotationRef.current.y,
        width: annotationRef.current.width,
        height: annotationRef.current.height ?? 88,
      };
      updateDraftFrame(startFrameRef.current);
    },
    onPanResponderMove: (_event, gesture) => {
      if (!props.onResize) return;
      const frame = annotationRef.current;
      const pageWidth = frame.pageWidth ?? startFrameRef.current.x + startFrameRef.current.width + 96;
      const pageHeight = frame.pageHeight ?? startFrameRef.current.y + startFrameRef.current.height + 96;
      updateDraftFrame({
        ...startFrameRef.current,
        width: clamp(startFrameRef.current.width + gesture.dx, MIN_TEXT_BOX_WIDTH, Math.max(MIN_TEXT_BOX_WIDTH, pageWidth - startFrameRef.current.x)),
        height: clamp(startFrameRef.current.height + gesture.dy, MIN_TEXT_BOX_HEIGHT, Math.max(MIN_TEXT_BOX_HEIGHT, pageHeight - startFrameRef.current.y)),
      });
    },
    onPanResponderRelease: () => {
      const frame = draftFrameRef.current;
      if (frame && props.onResize) props.onResize(props.annotation.id, frame.width, frame.height);
      setDragging(false);
      updateDraftFrame(null);
    },
    onPanResponderTerminate: () => {
      setDragging(false);
      updateDraftFrame(null);
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [effectiveActive, props.annotation.id, props.onActivate, props.onResize, shouldEditFrame, updateDraftFrame]);

  const pageWidth = props.annotation.pageWidth ?? effectiveFrame.x + effectiveFrame.width + TEXT_TOOLBAR_WIDTH + 24;
  const toolbarLeft = clamp(
    (effectiveFrame.width - TEXT_TOOLBAR_WIDTH) / 2,
    -effectiveFrame.x + 8,
    Math.max(-effectiveFrame.x + 8, pageWidth - effectiveFrame.x - TEXT_TOOLBAR_WIDTH - 8),
  );
  const toolbarTop = effectiveFrame.y > 64 ? -54 : height + 10;

  return (
    <View
      style={[
        props.styles.textAnnotationCard,
        effectiveActive && props.styles.textAnnotationCardActive,
        dragging && props.styles.textAnnotationCardEditing,
        {
          left: effectiveFrame.x,
          top: effectiveFrame.y,
          width: effectiveFrame.width,
          height,
        },
      ]}
      {...(effectiveActive ? moveResponder.panHandlers : {})}
    >
      {effectiveActive ? (
        <View
          style={[
            props.styles.textAnnotationToolbar,
            { left: toolbarLeft, top: toolbarTop },
          ]}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => false}
        >
          <Pressable
            hitSlop={6}
            style={props.styles.textAnnotationToolbarButton}
            onPress={() => {
              commitText();
              inputRef.current?.blur();
              Keyboard.dismiss();
            }}
          >
            <MaterialCommunityIcons name="keyboard-close-outline" size={18} color="#FFFFFF" />
          </Pressable>
          <View style={props.styles.textAnnotationToolbarDivider} />
          <Pressable
            hitSlop={6}
            style={props.styles.textAnnotationToolbarButton}
            onPress={() => changeFontSize(-1)}
          >
            <MaterialCommunityIcons name="minus" size={18} color="#FFFFFF" />
          </Pressable>
          <View style={props.styles.textAnnotationToolbarPill}>
            <Text style={props.styles.textAnnotationToolbarPillText}>{fontSize}</Text>
          </View>
          <Pressable
            hitSlop={6}
            style={props.styles.textAnnotationToolbarButton}
            onPress={() => changeFontSize(1)}
          >
            <MaterialCommunityIcons name="plus" size={18} color="#FFFFFF" />
          </Pressable>
          <View style={props.styles.textAnnotationToolbarDivider} />
          <Pressable
            hitSlop={6}
            style={props.styles.textAnnotationToolbarButton}
            onPress={() => props.onRemove(props.annotation.id)}
          >
            <MaterialCommunityIcons name="trash-can-outline" size={18} color="#FF766E" />
          </Pressable>
        </View>
      ) : null}
      <TextInput
        ref={inputRef}
        value={draftText}
        editable
        onFocus={() => props.onActivate(props.annotation.id)}
        onPressIn={activateInput}
        onTouchEnd={() => inputRef.current?.focus()}
        onBlur={commitText}
        onEndEditing={commitText}
        onChangeText={setDraftText}
        placeholder="텍스트 입력"
        placeholderTextColor="#9AA4B5"
        multiline
        inputAccessoryViewID={Platform.OS === 'ios' ? inputAccessoryViewID : undefined}
        blurOnSubmit={false}
        returnKeyType="default"
        scrollEnabled
        textAlignVertical="top"
        style={[
          props.styles.textAnnotationInput,
          {
            minHeight: Math.max(32, height - 16),
            fontSize,
            lineHeight: Math.round(fontSize * 1.35),
            color: props.annotation.color ?? '#111827',
          },
        ]}
      />
      {Platform.OS === 'ios' ? (
        <InputAccessoryView nativeID={inputAccessoryViewID}>
          <View style={props.styles.textAnnotationKeyboardAccessory}>
            <Pressable
              hitSlop={8}
              style={props.styles.textAnnotationKeyboardAccessoryButton}
              onPress={() => changeFontSize(-1)}
            >
              <MaterialCommunityIcons name="minus" size={18} color="#4F63D7" />
            </Pressable>
            <View style={props.styles.textAnnotationKeyboardAccessoryPill}>
              <Text style={props.styles.textAnnotationKeyboardAccessoryPillText}>{fontSize}</Text>
            </View>
            <Pressable
              hitSlop={8}
              style={props.styles.textAnnotationKeyboardAccessoryButton}
              onPress={() => changeFontSize(1)}
            >
              <MaterialCommunityIcons name="plus" size={18} color="#4F63D7" />
            </Pressable>
            <View style={props.styles.textAnnotationKeyboardAccessorySpacer} />
            <Pressable
              hitSlop={8}
              style={props.styles.textAnnotationKeyboardAccessoryDone}
              onPress={() => {
                commitText();
                inputRef.current?.blur();
                Keyboard.dismiss();
              }}
            >
              <MaterialCommunityIcons name="keyboard-close-outline" size={18} color="#FFFFFF" />
              <Text style={props.styles.textAnnotationKeyboardAccessoryDoneText}>완료</Text>
            </Pressable>
          </View>
        </InputAccessoryView>
      ) : null}
      {effectiveActive ? (
        <View
          style={props.styles.textAnnotationResizeHandle}
          onStartShouldSetResponder={() => true}
          onResponderGrant={() => props.onActivate(props.annotation.id)}
          onTouchStart={() => props.onActivate(props.annotation.id)}
          {...resizeResponder.panHandlers}
        >
          <MaterialCommunityIcons name="resize-bottom-right" size={13} color="#5F79FF" />
        </View>
      ) : null}
      {!props.active ? (
        <Pressable
          hitSlop={6}
          onPress={activateBox}
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
  onChangeFontSize?: (id: string, fontSize: number) => void;
  onRemove: (id: string) => void;
  variant?: 'floating' | 'marker';
  hiddenAnnotationIds?: Set<string>;
}) {
  const [activeAnnotationId, setActiveAnnotationId] = React.useState<string | null>(null);
  const variant = props.variant ?? 'floating';

  React.useEffect(() => {
    if (!activeAnnotationId) return;
    if (props.annotations.some((annotation) => annotation.id === activeAnnotationId)) return;
    setActiveAnnotationId(null);
  }, [activeAnnotationId, props.annotations]);

  const clearActiveAnnotation = React.useCallback(() => {
    setActiveAnnotationId(null);
    Keyboard.dismiss();
  }, []);

  return (
    <View pointerEvents="box-none" style={props.styles.textAnnotationLayer}>
      {activeAnnotationId ? (
        <Pressable
          style={props.styles.textAnnotationDismissOverlay}
          onPress={clearActiveAnnotation}
        />
      ) : null}
      {props.annotations.map((annotation) => {
        if (props.hiddenAnnotationIds?.has(annotation.id)) return null;
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
            active={activeAnnotationId === annotation.id}
            styles={props.styles}
            onActivate={setActiveAnnotationId}
            onChangeText={props.onChangeText}
            onMove={props.onMove}
            onResize={props.onResize}
            onChangeFontSize={props.onChangeFontSize}
            onRemove={props.onRemove}
          />
        );
      })}
    </View>
  );
}
