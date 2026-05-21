import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { SelectionRect } from '../../../ui-types';

const MENU_COLORS = ['#111827', '#E11D48', '#2563EB', '#FFFFFF', '#FDE047', '#86EFAC'];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function SelectionContextMenu(props: {
  rect: SelectionRect;
  pageWidth: number;
  pageHeight: number;
  styles: any;
  onAskAi?: () => void;
  onDuplicate?: () => void;
  onDelete?: () => void;
  onChangeColor?: (color: string) => void;
  onMoveHint?: () => void;
}) {
  if (props.pageWidth <= 0 || props.pageHeight <= 0) return null;

  const menuWidth = Math.min(314, Math.max(252, props.pageWidth - 16));
  const nearTop = props.rect.y > 76 ? props.rect.y - 62 : props.rect.y + props.rect.height + 10;
  const left = clamp(
    props.rect.x + props.rect.width / 2 - menuWidth / 2,
    8,
    Math.max(8, props.pageWidth - menuWidth - 8),
  );
  const top = clamp(nearTop, 8, Math.max(8, props.pageHeight - 104));

  return (
    <View pointerEvents="box-none" style={[props.styles.selectionContextMenu, { left, top, width: menuWidth }]}>
      <View style={props.styles.selectionContextActionRow}>
        <Pressable
          disabled={!props.onAskAi}
          style={[props.styles.selectionContextButton, props.styles.selectionContextButtonPrimary]}
          onPress={props.onAskAi}
        >
          <MaterialCommunityIcons name="star-four-points" size={14} color="#FFFFFF" />
          <Text style={[props.styles.selectionContextButtonText, props.styles.selectionContextButtonTextPrimary]}>AI</Text>
        </Pressable>
        <Pressable
          disabled={!props.onDuplicate}
          style={props.styles.selectionContextButton}
          onPress={props.onDuplicate}
        >
          <MaterialCommunityIcons name="content-copy" size={14} color="#455062" />
          <Text style={props.styles.selectionContextButtonText}>복사</Text>
        </Pressable>
        <Pressable
          disabled={!props.onMoveHint}
          style={props.styles.selectionContextButton}
          onPress={props.onMoveHint}
        >
          <MaterialCommunityIcons name="cursor-move" size={14} color="#455062" />
          <Text style={props.styles.selectionContextButtonText}>이동</Text>
        </Pressable>
        <Pressable
          disabled={!props.onDelete}
          style={[props.styles.selectionContextButton, props.styles.selectionContextButtonDanger]}
          onPress={props.onDelete}
        >
          <MaterialCommunityIcons name="delete-outline" size={14} color="#DC2626" />
          <Text style={[props.styles.selectionContextButtonText, props.styles.selectionContextButtonTextDanger]}>삭제</Text>
        </Pressable>
      </View>
      <View style={props.styles.selectionContextColorRow}>
        {MENU_COLORS.map((color) => (
          <Pressable
            key={color}
            disabled={!props.onChangeColor}
            style={props.styles.selectionContextColorButton}
            onPress={() => props.onChangeColor?.(color)}
          >
            <View style={[props.styles.selectionContextColorDot, { backgroundColor: color }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
