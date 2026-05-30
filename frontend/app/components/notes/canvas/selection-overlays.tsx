import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import type { InkPoint, SelectionRect } from '../../../ui-types';

export function getLassoPath(points: InkPoint[]) {
  if (!points.length) return '';
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
}

export function SelectionOverlay(props: { rect: SelectionRect; styles: any; draft?: boolean }) {
  const handleOffset = -7;
  const lassoPath = props.rect.path && props.rect.path.length > 2 ? getLassoPath(props.rect.path) : '';
  if (props.rect.mode === 'lasso') {
    if (!lassoPath) return null;
    return (
      <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
        <Path
          d={`${lassoPath} Z`}
          fill="rgba(78, 141, 255, 0.06)"
          stroke="none"
        />
        <Path
          d={lassoPath}
          fill="none"
          stroke="#2563EB"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="7 5"
          opacity={props.draft ? 0.88 : 0.96}
        />
      </Svg>
    );
  }

  return (
    <View pointerEvents="none" style={[props.styles.selectionOverlayRect, props.draft && props.styles.selectionOverlayDraft, { left: props.rect.x, top: props.rect.y, width: props.rect.width, height: props.rect.height }]}>
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
        <View
          key={corner}
          style={[
            props.styles.selectionResizeHandle,
            {
              left: corner === 'nw' || corner === 'sw' ? handleOffset : props.rect.width + handleOffset,
              top: corner === 'nw' || corner === 'ne' ? handleOffset : props.rect.height + handleOffset,
            },
          ]}
        />
      ))}
    </View>
  );
}

export function SelectionLassoOverlay(props: { points: InkPoint[] }) {
  if (props.points.length < 2) return null;
  return (
    <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
      <Path
        d={getLassoPath(props.points)}
        fill="none"
        stroke="#2563EB"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray="7 5"
        opacity={0.9}
      />
    </Svg>
  );
}
