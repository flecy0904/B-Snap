import React from 'react';
import Svg from 'react-native-svg';
import { InkPath } from '../canvas/ink-path';
import { TextAnnotationLayer } from '../canvas/text-annotation-layer';
import { SelectionContextMenu } from '../canvas/selection-context-menu';
import { SelectionLassoOverlay, SelectionOverlay } from '../canvas/selection-overlays';
import { doesRectIntersectPolygon, findInkStrokesInLasso, findInkStrokesInRect } from '../../../ui-helpers';
import type { InkStroke, InkTextAnnotation, SelectionRect } from '../../../ui-types';
import type { NotebookPage } from '../../../types';

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

function getSelectedObjectCountForView(strokes: InkStroke[], textAnnotations: InkTextAnnotation[], selection: SelectionRect) {
  const selectedStrokeIds = selection.path && selection.path.length > 2
    ? findInkStrokesInLasso(strokes, selection.path)
    : findInkStrokesInRect(strokes, selection);
  const selectedTextCount = textAnnotations.filter((annotation) => {
    const rect = getTextAnnotationRect(annotation);
    return selection.path && selection.path.length > 2
      ? doesRectIntersectPolygon(rect, selection.path)
      : (
          rect.x <= selection.x + selection.width
          && rect.x + rect.width >= selection.x
          && rect.y <= selection.y + selection.height
          && rect.y + rect.height >= selection.y
        );
  }).length;
  return selectedStrokeIds.length + selectedTextCount;
}

function isCurrentStrokeOnPage(page: NotebookPage, stroke: InkStroke | null) {
  if (!stroke) return false;
  return page.generatedPageId
    ? stroke.generatedPageId === page.generatedPageId
    : stroke.pageNumber === page.pageNumber;
}

export const PdfInkLayers = React.memo(function PdfInkLayers(props: {
  page: NotebookPage;
  currentPage: boolean;
  pageStrokes: InkStroke[];
  pageTextAnnotations: InkTextAnnotation[];
  currentStroke: InkStroke | null;
  selectionForView: SelectionRect | null;
  draftForView: SelectionRect | null;
  draftLassoForView: InkStroke['points'];
  draftRectForView: SelectionRect | null;
  capturingSelection: boolean;
  viewerWidth: number;
  viewerHeight: number;
  styles: any;
  textAnnotationVariant?: 'floating' | 'marker';
  onUpdateTextAnnotation: (id: string, text: string) => void;
  onMoveTextAnnotation: (id: string, x: number, y: number) => void;
  onResizeTextAnnotation: (id: string, width: number, height: number) => void;
  onRemoveTextAnnotation: (id: string) => void;
  onAskAiAboutSelection?: () => void;
  onDuplicateSelection?: () => void;
  onDeleteSelection?: () => void;
  onChangeSelectedStrokesColor?: (color: string) => void;
}) {
  const { highlightStrokes, inkStrokes } = React.useMemo(() => ({
    highlightStrokes: props.pageStrokes.filter((stroke) => stroke.style === 'highlight'),
    inkStrokes: props.pageStrokes.filter((stroke) => stroke.style !== 'highlight'),
  }), [props.pageStrokes]);
  const currentStrokeOnPage = React.useMemo(
    () => isCurrentStrokeOnPage(props.page, props.currentStroke),
    [props.currentStroke, props.page],
  );
  const selectedObjectCount = React.useMemo(
    () => (props.selectionForView ? getSelectedObjectCountForView(props.pageStrokes, props.pageTextAnnotations, props.selectionForView) : 0),
    [props.pageStrokes, props.pageTextAnnotations, props.selectionForView],
  );
  const hasHighlight = highlightStrokes.length > 0 || (currentStrokeOnPage && props.currentStroke?.style === 'highlight');
  const hasInk = inkStrokes.length > 0 || (currentStrokeOnPage && props.currentStroke?.style !== 'highlight' && props.currentStroke);
  const hasTextAnnotations = props.pageTextAnnotations.length > 0;

  if (!hasHighlight && !hasInk && !hasTextAnnotations && !props.selectionForView && !props.draftForView && props.draftLassoForView.length < 2) {
    return null;
  }

  return (
    <>
      {hasHighlight ? (
        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          {highlightStrokes.map((stroke) => <InkPath key={stroke.id} stroke={stroke} />)}
          {currentStrokeOnPage && props.currentStroke?.style === 'highlight' ? <InkPath stroke={props.currentStroke} draft /> : null}
        </Svg>
      ) : null}

      {hasTextAnnotations ? (
        <TextAnnotationLayer
          annotations={props.pageTextAnnotations}
          styles={props.styles}
          onChangeText={props.onUpdateTextAnnotation}
          onMove={props.onMoveTextAnnotation}
          onResize={props.onResizeTextAnnotation}
          onRemove={props.onRemoveTextAnnotation}
          variant={props.textAnnotationVariant}
        />
      ) : null}

      {hasInk ? (
        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          {inkStrokes.map((stroke) => <InkPath key={stroke.id} stroke={stroke} />)}
          {currentStrokeOnPage && props.currentStroke?.style !== 'highlight' && props.currentStroke ? <InkPath stroke={props.currentStroke} draft /> : null}
        </Svg>
      ) : null}

      {!props.capturingSelection && !props.draftForView && props.selectionForView ? <SelectionOverlay rect={props.selectionForView} styles={props.styles} /> : null}
      {!props.capturingSelection && !props.draftForView && props.currentPage && props.selectionForView && selectedObjectCount > 0 ? (
        <SelectionContextMenu
          rect={props.selectionForView}
          pageWidth={props.viewerWidth}
          pageHeight={props.viewerHeight}
          styles={props.styles}
          onAskAi={props.onAskAiAboutSelection}
          onDuplicate={props.onDuplicateSelection}
          onDelete={props.onDeleteSelection}
          onChangeColor={props.onChangeSelectedStrokesColor}
        />
      ) : null}
      {!props.capturingSelection && props.draftLassoForView.length > 1 ? <SelectionLassoOverlay points={props.draftLassoForView} /> : null}
      {!props.capturingSelection && props.draftRectForView ? <SelectionOverlay rect={props.draftRectForView} styles={props.styles} draft /> : null}
    </>
  );
});
