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
  if (!props.isEraser) {
    const dotSize = 5;
    return (
      <View
        pointerEvents="none"
        style={[
          props.styles.pencilHoverCenterDot,
          {
            position: 'absolute',
            left: props.x - dotSize / 2,
            top: props.y - dotSize / 2,
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: props.borderColor,
            zIndex: 31,
            elevation: 31,
          },
        ]}
      />
    );
  }

  const renderSize = props.size;

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
    />
  );
}
