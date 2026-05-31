import React from 'react';
import { Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg from 'react-native-svg';
import { doesRectIntersectPolygon, findInkStrokesInLasso, findInkStrokesInRect } from '../../../ui-helpers';
import type { InkImageAnnotation, InkStroke, InkTextAnnotation, SelectionRect } from '../../../ui-types';
import { InkPath } from './ink-path';

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

function getImageAnnotationRect(annotation: InkImageAnnotation): SelectionRect {
  return {
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
    pageWidth: annotation.pageWidth,
    pageHeight: annotation.pageHeight,
  };
}

export function getSelectedObjectIdsForSelection(
  selection: SelectionRect | null,
  strokes: InkStroke[],
  textAnnotations: InkTextAnnotation[],
  imageAnnotations: InkImageAnnotation[] = [],
) {
  if (!selection) return { strokeIds: new Set<string>(), textAnnotationIds: new Set<string>(), imageAnnotationIds: new Set<string>() };
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
  const imageAnnotationIds = new Set(
    imageAnnotations
      .filter((annotation) => {
        const rect = getImageAnnotationRect(annotation);
        return selection.path && selection.path.length > 2
          ? doesRectIntersectPolygon(rect, selection.path)
          : rectsOverlap(rect, selection);
      })
      .map((annotation) => annotation.id),
  );

  return { strokeIds, textAnnotationIds, imageAnnotationIds };
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
  imageAnnotations: InkImageAnnotation[] = [],
) {
  if (!selection || !draftSelection) return null;
  const dx = draftSelection.x - selection.x;
  const dy = draftSelection.y - selection.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
  const { strokeIds, textAnnotationIds, imageAnnotationIds } = getSelectedObjectIdsForSelection(selection, strokes, textAnnotations, imageAnnotations);
  if (!strokeIds.size && !textAnnotationIds.size && !imageAnnotationIds.size) return null;

  return {
    strokeIds,
    textAnnotationIds,
    imageAnnotationIds,
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
  renderInkPreview?: boolean;
}) {
  return (
    <View pointerEvents="none" style={props.styles.selectionMovePreviewLayer}>
      {props.renderInkPreview !== false ? (
        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          {props.preview.movedStrokes.map((stroke) => <InkPath key={`moving-${stroke.id}`} stroke={stroke} draft />)}
        </Svg>
      ) : null}
      {props.preview.movedTextAnnotations.map((annotation) => (
        props.textAnnotationVariant === 'marker' && annotation.anchorRect ? (
          <View key={`moving-text-${annotation.id}`} pointerEvents="none">
            <View
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
        ) : (
          <View
            key={`moving-text-${annotation.id}`}
            pointerEvents="none"
            style={[
              props.styles.textAnnotationCard,
              props.styles.textAnnotationCardEditing,
              {
                left: annotation.x,
                top: annotation.y,
                width: annotation.width,
                height: annotation.height ?? 88,
              },
            ]}
          >
            <Text
              numberOfLines={4}
              style={[
                props.styles.textAnnotationInput,
                {
                  minHeight: Math.max(32, (annotation.height ?? 88) - 16),
                  fontSize: annotation.fontSize ?? 17,
                  lineHeight: Math.round((annotation.fontSize ?? 17) * 1.35),
                  color: annotation.color ?? '#111827',
                },
              ]}
            >
              {annotation.text || '텍스트 입력'}
            </Text>
          </View>
        )
      ))}
    </View>
  );
}
