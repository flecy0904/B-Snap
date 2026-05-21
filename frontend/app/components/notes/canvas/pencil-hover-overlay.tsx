import React from 'react';
import { Text, View } from 'react-native';
import type { InkTool } from '../../../ui-types';
import { PencilHoverQuickPalette } from './pencil-hover-quick-palette';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function PencilHoverOverlay(props: {
  x: number;
  y: number;
  size: number;
  pageWidth: number;
  pageHeight: number;
  borderColor: string;
  label: string;
  isEraser: boolean;
  activeTool: InkTool;
  styles: any;
  onSelectTool?: (tool: InkTool) => void;
}) {
  return (
    <>
      <View
        pointerEvents="none"
        style={[
          props.styles.pencilHoverPreview,
          props.isEraser && props.styles.pencilHoverPreviewEraser,
          {
            left: props.x - props.size / 2,
            top: props.y - props.size / 2,
            width: props.size,
            height: props.size,
            borderRadius: props.size / 2,
            borderColor: props.borderColor,
          },
        ]}
      />
      {props.label ? (
        <View
          pointerEvents="none"
          style={[
            props.styles.pencilHoverLabel,
            {
              left: clamp(props.x + props.size / 2 + 8, 6, Math.max(6, props.pageWidth - 76)),
              top: clamp(props.y - props.size / 2 - 2, 6, Math.max(6, props.pageHeight - 30)),
            },
          ]}
        >
          <Text style={props.styles.pencilHoverLabelText}>{props.label}</Text>
        </View>
      ) : null}
      {props.onSelectTool ? (
        <PencilHoverQuickPalette
          x={props.x}
          y={props.y}
          pageWidth={props.pageWidth}
          pageHeight={props.pageHeight}
          activeTool={props.activeTool}
          styles={props.styles}
          onSelectTool={props.onSelectTool}
        />
      ) : null}
    </>
  );
}
