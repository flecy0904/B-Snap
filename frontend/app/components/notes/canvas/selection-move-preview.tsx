import React from 'react';
import { View } from 'react-native';
import Svg from 'react-native-svg';
import { doesRectIntersectPolygon, findInkStrokesInLasso, findInkStrokesInRect } from '../../../ui-helpers';
import type { InkStroke, InkTextAnnotation, SelectionRect } from '../../../ui-types';
import { InkPath } from './ink-path';
import { TextAnnotationLayer } from './text-annotation-layer';

function rectsOverlap(left: SelectionRect, right: SelectionRect) {
  return left.x <= right.x + right.width
    && left.x + left.width >= right.x
    && left.y <= right.y + right.height
    && left.y + left.height >= right.y;
}

function getTextAnnotationRect(annotation: InkTextAnnotation): SelectionRect {
  return annotation.anchorRect ?? {
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height ?? 96,
    pageWidth: annotation.pageWidth,
    pageHeight: annotation.pageHeight,
  };
}

export function getSelectedObjectIdsForSelection(
  selection: SelectionRect | null,
  strokes: InkStroke[],
  textAnnotations: InkTextAnnotation[],
) {
  if (!selection) return { strokeIds: new Set<string>(), textAnnotationIds: new Set<string>() };
  const strokeIds = new Set(
    selection.path && selection.path.length > 2
      ? findInkStrokesInLasso(strokes, selection.path)
      : findInkStrokesInRect(strokes, selection),
  );
  const textAnnotationIds = new Set(
    textAnnotations
      .filter((annotation) => {
        const rect = getTextAnnotationRect(annotation);
        return selection.path && selection.path.length > 2
          ? doesRectIntersectPolygon(rect, selection.path)
          : rectsOverlap(rect, selection);
      })
      .map((annotation) => annotation.id),
  );

  return { strokeIds, textAnnotationIds };
}

function translateStroke(stroke: InkStroke, dx: number, dy: number): InkStroke {
  return {
    ...stroke,
    points: stroke.points.map((point) => ({
      ...point,
      x: point.x + dx,
      y: point.y + dy,
    })),
  };
}

function translateTextAnnotation(annotation: InkTextAnnotation, dx: number, dy: number): InkTextAnnotation {
  return {
    ...annotation,
    x: annotation.x + dx,
    y: annotation.y + dy,
    anchorRect: annotation.anchorRect
      ? {
          ...annotation.anchorRect,
          x: annotation.anchorRect.x + dx,
          y: annotation.anchorRect.y + dy,
        }
      : annotation.anchorRect,
  };
}

export function getSelectionMovePreview(
  selection: SelectionRect | null,
  draftSelection: SelectionRect | null,
  strokes: InkStroke[],
  textAnnotations: InkTextAnnotation[],
) {
  if (!selection || !draftSelection) return null;
  const dx = draftSelection.x - selection.x;
  const dy = draftSelection.y - selection.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  const { strokeIds, textAnnotationIds } = getSelectedObjectIdsForSelection(selection, strokes, textAnnotations);
  if (!strokeIds.size && !textAnnotationIds.size) return null;

  return {
    strokeIds,
    textAnnotationIds,
    movedStrokes: strokes
      .filter((stroke) => strokeIds.has(stroke.id))
      .map((stroke) => translateStroke(stroke, dx, dy)),
    movedTextAnnotations: textAnnotations
      .filter((annotation) => textAnnotationIds.has(annotation.id))
      .map((annotation) => translateTextAnnotation(annotation, dx, dy)),
  };
}

export function SelectionMovePreview(props: {
  preview: NonNullable<ReturnType<typeof getSelectionMovePreview>>;
  styles: any;
  textAnnotationVariant?: 'floating' | 'marker';
}) {
  return (
    <View pointerEvents="none" style={props.styles.selectionMovePreviewLayer}>
      <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
        {props.preview.movedStrokes.map((stroke) => <InkPath key={`moving-${stroke.id}`} stroke={stroke} draft />)}
      </Svg>
      {props.preview.movedTextAnnotations.length ? (
        <TextAnnotationLayer
          annotations={props.preview.movedTextAnnotations}
          styles={props.styles}
          onChangeText={() => undefined}
          onRemove={() => undefined}
          variant={props.textAnnotationVariant}
        />
      ) : null}
    </View>
  );
}
