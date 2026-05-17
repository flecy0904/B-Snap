import React from 'react';
import { Path } from 'react-native-svg';
import { getInkCenterlinePath, getInkStrokeSvgPath } from '../../../ui-helpers';
import type { InkStroke } from '../../../ui-types';

export function InkPath({ stroke, draft = false }: { stroke: InkStroke; draft?: boolean }) {
  if (stroke.linePattern && stroke.linePattern !== 'solid' && stroke.style !== 'highlight' && stroke.style !== 'shape') {
    const centerlinePath = getInkCenterlinePath(stroke.points);
    if (!centerlinePath) return null;
    const dashArray = stroke.linePattern === 'dotted'
      ? `${Math.max(1, stroke.width * 0.45)} ${Math.max(6, stroke.width * 2)}`
      : `${Math.max(8, stroke.width * 3)} ${Math.max(5, stroke.width * 1.8)}`;
    return (
      <Path
        key={stroke.id}
        d={centerlinePath}
        fill="none"
        stroke={stroke.color}
        strokeWidth={stroke.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashArray}
      />
    );
  }

  const path = getInkStrokeSvgPath(stroke, !draft);
  if (!path) return null;

  if (stroke.style === 'shape') {
    const dashArray = stroke.linePattern && stroke.linePattern !== 'solid'
      ? stroke.linePattern === 'dotted'
        ? `${Math.max(1, stroke.width * 0.45)} ${Math.max(6, stroke.width * 2)}`
        : `${Math.max(8, stroke.width * 3)} ${Math.max(5, stroke.width * 1.8)}`
      : undefined;
    return (
      <Path
        key={stroke.id}
        d={path}
        fill="none"
        stroke={stroke.color}
        strokeWidth={stroke.width}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={dashArray}
      />
    );
  }

  if (stroke.style === 'highlight') {
    return <Path key={stroke.id} d={path} fill={stroke.color} opacity={0.72} />;
  }

  return <Path key={stroke.id} d={path} fill={stroke.color} />;
}
