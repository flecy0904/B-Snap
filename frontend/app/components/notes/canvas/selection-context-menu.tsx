import React, { useState } from 'react';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SelectionRect } from '../../../ui-types';

const MENU_COLORS = ['#111827', '#E11D48', '#F97316', '#FDE047', '#22C55E', '#2563EB', '#7C3AED'];
const MENU_MIN_WIDTH = 188;
const MENU_MAX_WIDTH = 234;
const MENU_MAX_HEIGHT = 86;
const MENU_HIT_SLOP = 10;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function stopMenuTouch(event: GestureResponderEvent) {
  event.stopPropagation();
}

export function getSelectionContextMenuFrame(rect: SelectionRect, pageWidth: number, pageHeight: number) {
  const width = Math.min(MENU_MAX_WIDTH, Math.max(MENU_MIN_WIDTH, pageWidth - 16));
  const nearTop = rect.y > MENU_MAX_HEIGHT + 14 ? rect.y - MENU_MAX_HEIGHT - 10 : rect.y + rect.height + 10;
  const left = clamp(rect.x + rect.width / 2 - width / 2, 8, Math.max(8, pageWidth - width - 8));
  const top = clamp(nearTop, 8, Math.max(8, pageHeight - MENU_MAX_HEIGHT - 8));
  return { left, top, width, height: MENU_MAX_HEIGHT };
}

export function isPointInSelectionContextMenu(
  point: { x: number; y: number },
  rect: SelectionRect,
  pageWidth: number,
  pageHeight: number,
) {
  const frame = getSelectionContextMenuFrame(rect, pageWidth, pageHeight);
  return (
    point.x >= frame.left - MENU_HIT_SLOP &&
    point.x <= frame.left + frame.width + MENU_HIT_SLOP &&
    point.y >= frame.top - MENU_HIT_SLOP &&
    point.y <= frame.top + frame.height + MENU_HIT_SLOP
  );
}

export function SelectionContextMenu(props: {
  rect: SelectionRect;
  pageWidth: number;
  pageHeight: number;
  styles: any;
  editable?: boolean;
  onAskAi?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onChangeColor?: (color: string) => void;
}) {
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  if (props.pageWidth <= 0 || props.pageHeight <= 0) return null;

  const menuFrame = getSelectionContextMenuFrame(props.rect, props.pageWidth, props.pageHeight);
  const editable = props.editable ?? true;

  return (
    <View
      pointerEvents="auto"
      style={[props.styles.selectionContextMenu, { left: menuFrame.left, top: menuFrame.top, width: menuFrame.width }]}
    >
      <View style={props.styles.selectionContextActionRow}>
        <Pressable
          disabled={!props.onAskAi}
          accessibilityLabel="AI에게 질문"
          style={[props.styles.selectionContextIconButton, props.styles.selectionContextIconButtonPrimary]}
          onPressIn={stopMenuTouch}
          onPressOut={stopMenuTouch}
          onPress={(event) => {
            stopMenuTouch(event);
            props.onAskAi?.();
          }}
        >
          <MaterialCommunityIcons name="star-four-points" size={18} color="#FFFFFF" />
        </Pressable>
        {editable ? (
          <>
            <Pressable
              disabled={!props.onDuplicate}
              accessibilityLabel="선택 영역 복사"
              style={props.styles.selectionContextIconButton}
              onPressIn={stopMenuTouch}
              onPressOut={stopMenuTouch}
              onPress={(event) => {
                stopMenuTouch(event);
                props.onDuplicate?.();
              }}
            >
              <MaterialCommunityIcons name="content-copy" size={18} color="#334155" />
            </Pressable>
            <Pressable
              disabled={!props.onChangeColor}
              accessibilityLabel="색상 변경"
              style={[
                props.styles.selectionContextIconButton,
                colorPickerOpen && props.styles.selectionContextIconButtonActive,
              ]}
              onPressIn={stopMenuTouch}
              onPressOut={stopMenuTouch}
              onPress={(event) => {
                stopMenuTouch(event);
                setColorPickerOpen((current) => !current);
              }}
            >
              <MaterialCommunityIcons name="palette-outline" size={19} color="#334155" />
            </Pressable>
            <Pressable
              disabled={!props.onDelete}
              accessibilityLabel="선택 영역 삭제"
              style={[props.styles.selectionContextIconButton, props.styles.selectionContextIconButtonDanger]}
              onPressIn={stopMenuTouch}
              onPressOut={stopMenuTouch}
              onPress={(event) => {
                stopMenuTouch(event);
                props.onDelete?.();
              }}
            >
              <MaterialCommunityIcons name="delete-outline" size={19} color="#DC2626" />
            </Pressable>
          </>
        ) : null}
      </View>
      {editable && colorPickerOpen ? (
        <View style={props.styles.selectionContextColorRow}>
          {MENU_COLORS.map((color) => (
            <Pressable
              key={color}
              disabled={!props.onChangeColor}
              accessibilityLabel={`색상 ${color}`}
              style={props.styles.selectionContextColorButton}
              onPressIn={stopMenuTouch}
              onPressOut={stopMenuTouch}
              onPress={(event) => {
                stopMenuTouch(event);
                setColorPickerOpen(false);
                props.onChangeColor?.(color);
              }}
            >
              <View style={[props.styles.selectionContextColorDot, { backgroundColor: color }]} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
