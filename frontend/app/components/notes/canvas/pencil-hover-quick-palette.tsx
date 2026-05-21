import React from 'react';
import { Pressable, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { InkTool } from '../../../ui-types';

const QUICK_PALETTE_WIDTH = 184;
const QUICK_PALETTE_HEIGHT = 42;

const QUICK_TOOLS: Array<{ tool: InkTool; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'] }> = [
  { tool: 'pen', icon: 'pencil' },
  { tool: 'highlight', icon: 'marker' },
  { tool: 'erase', icon: 'eraser-variant' },
  { tool: 'select', icon: 'lasso' },
  { tool: 'text', icon: 'format-text' },
];

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function PencilHoverQuickPalette(props: {
  x: number;
  y: number;
  pageWidth: number;
  pageHeight: number;
  activeTool: InkTool;
  styles: any;
  onSelectTool: (tool: InkTool) => void;
}) {
  const left = clamp(
    props.x - QUICK_PALETTE_WIDTH / 2,
    8,
    Math.max(8, props.pageWidth - QUICK_PALETTE_WIDTH - 8),
  );
  const top = clamp(
    props.y + 34,
    8,
    Math.max(8, props.pageHeight - QUICK_PALETTE_HEIGHT - 8),
  );

  return (
    <View style={[props.styles.pencilHoverQuickPalette, { left, top }]}>
      {QUICK_TOOLS.map((item) => {
        const active = props.activeTool === item.tool;
        return (
          <Pressable
            key={item.tool}
            hitSlop={6}
            style={[
              props.styles.pencilHoverQuickPaletteButton,
              active && props.styles.pencilHoverQuickPaletteButtonActive,
            ]}
            onPress={() => props.onSelectTool(item.tool)}
          >
            <MaterialCommunityIcons name={item.icon} size={17} color={active ? '#FFFFFF' : '#334155'} />
          </Pressable>
        );
      })}
    </View>
  );
}
