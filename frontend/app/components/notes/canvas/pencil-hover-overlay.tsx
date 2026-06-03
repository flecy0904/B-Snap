import React from 'react';
import { View } from 'react-native';

export function PencilHoverOverlay(props: {
  x: number;
  y: number;
  size: number;
  pageWidth: number;
  pageHeight: number;
  borderColor: string;
  isEraser: boolean;
  styles: any;
}) {
  const renderSize = props.isEraser ? props.size : Math.max(7, Math.min(12, props.size));
  const centerDotSize = props.isEraser ? 0 : 3;

  return (
    <View
      pointerEvents="none"
      style={[
        props.styles.pencilHoverPreview,
        props.isEraser && props.styles.pencilHoverPreviewEraser,
        {
          left: props.x - renderSize / 2,
          top: props.y - renderSize / 2,
          width: renderSize,
          height: renderSize,
          borderRadius: renderSize / 2,
          borderColor: props.borderColor,
        },
      ]}
    >
      {centerDotSize > 0 ? (
        <View
          style={[
            props.styles.pencilHoverCenterDot,
            {
              width: centerDotSize,
              height: centerDotSize,
              borderRadius: centerDotSize / 2,
              backgroundColor: props.borderColor,
            },
          ]}
        />
      ) : null}
    </View>
  );
}
