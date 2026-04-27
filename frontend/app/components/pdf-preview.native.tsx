import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, useWindowDimensions, View } from 'react-native';
import Pdf from 'react-native-pdf';
import Svg, { Path } from 'react-native-svg';
import { TextAnnotationLayer } from './text-annotation-layer';
import { findHitInkStrokeId, getInkStrokeSvgPath, resolveInkStrokeAppearance, scaleInkStrokeToPageSize, scaleSelectionRectToPageSize, scaleTextAnnotationToPageSize } from '../ui-helpers';
import { InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../ui-types';

export function PdfPreview(props: {
  file: number | string | { uri: string };
  page: number;
  inkTool: InkTool;
  penColor: string;
  penWidth: number;
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  textAnnotationVariant?: 'floating' | 'marker';
  selectionRect: SelectionRect | null;
  onCommitInkStroke: (stroke: InkStroke) => void;
  onRemoveInkStroke: (strokeId: string) => void;
  onAddTextAnnotation: (point: InkPoint) => void;
  onUpdateTextAnnotation: (id: string, text: string) => void;
  onRemoveTextAnnotation: (id: string) => void;
  onSelectionChange: (rect: SelectionRect | null) => void;
  onPageChanged?: (page: number) => void;
  onDocumentLoaded?: (pageCount: number) => void;
  styles: any;
}) {
  const { width, height } = useWindowDimensions();
  const compactViewer = width < 900;
  const phoneViewer = width < 700;
  const viewerWidth = phoneViewer ? Math.max(320, width - 18) : compactViewer ? Math.max(320, width - 20) : Math.min(1240, Math.max(860, width - 150));
  const viewerHeight = phoneViewer ? Math.max(560, height - 190) : compactViewer ? Math.max(460, height - 235) : Math.max(700, height - 130);
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const [overlayFrame, setOverlayFrame] = useState({ x: 0, y: 0, width: 0, height: 0 });
  const [pdfScale, setPdfScale] = useState(1);
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const textTapRef = useRef<InkPoint | null>(null);
  const overlayRef = useRef<View | null>(null);
  const pageInkStrokes = useMemo(
    () => props.inkStrokes.filter((stroke) => !stroke.pageNumber || stroke.pageNumber === props.page),
    [props.inkStrokes, props.page],
  );
  const pageInkStrokesForView = useMemo(
    () => pageInkStrokes.map((stroke) => scaleInkStrokeToPageSize(stroke, viewerWidth, viewerHeight)),
    [pageInkStrokes, viewerHeight, viewerWidth],
  );
  const pageTextAnnotationsForView = useMemo(
    () => props.textAnnotations.map((annotation) => scaleTextAnnotationToPageSize(annotation, viewerWidth, viewerHeight)),
    [props.textAnnotations, viewerHeight, viewerWidth],
  );
  const canZoomPdf = props.inkTool === 'view';
  const clampedPdfScale = Math.max(1, Math.min(3, pdfScale));

  const clampPointToStage = (x: number, y: number, mode: 'draw' | 'annotate' = 'draw') => ({
    x: Math.max(0, Math.min(viewerWidth - (mode === 'annotate' ? 180 : 0), x)),
    y: Math.max(0, Math.min(viewerHeight - (mode === 'annotate' ? 110 : 0), y)),
    pageWidth: viewerWidth,
    pageHeight: viewerHeight,
  });

  const updateOverlayFrame = useCallback(() => {
    overlayRef.current?.measureInWindow((x, y, width, height) => {
      setOverlayFrame({ x, y, width, height });
    });
  }, []);

  useEffect(() => {
    const timer = setTimeout(updateOverlayFrame, 0);
    return () => clearTimeout(timer);
  }, [updateOverlayFrame, viewerWidth, viewerHeight, props.page]);

  useEffect(() => {
    setPdfScale(1);
  }, [props.file, props.page]);

  const updatePdfScale = useCallback((nextScale: number) => {
    setPdfScale(Math.max(1, Math.min(3, Number.isFinite(nextScale) ? nextScale : 1)));
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event, gestureState) => {
          if (event.nativeEvent.touches && event.nativeEvent.touches.length > 1) return false;
          return props.inkTool !== 'view';
        },
        onMoveShouldSetPanResponder: (event, gestureState) => {
          if (event.nativeEvent.touches && event.nativeEvent.touches.length > 1) return false;
          return props.inkTool === 'pen' || props.inkTool === 'highlight' || props.inkTool === 'select';
        },
        onPanResponderGrant: (event, gestureState) => {
          const absolutePoint = clampPointToStage(
            gestureState.x0 - overlayFrame.x,
            gestureState.y0 - overlayFrame.y,
            props.inkTool === 'text' ? 'annotate' : 'draw',
          );

          if (props.inkTool === 'pen' || props.inkTool === 'highlight') {
            const appearance = resolveInkStrokeAppearance(props.inkTool, props.penColor, props.penWidth);
            const stroke: InkStroke = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              color: appearance.color,
              width: appearance.width,
              style: props.inkTool === 'highlight' ? 'highlight' : 'pen',
              pageNumber: props.page,
              pageWidth: viewerWidth,
              pageHeight: viewerHeight,
              points: [absolutePoint],
            };
            currentStrokeRef.current = stroke;
            setCurrentStroke(stroke);
            return;
          }

          if (props.inkTool === 'select') {
            props.onSelectionChange(null);
            selectionOriginRef.current = absolutePoint;
            const rect = { x: absolutePoint.x, y: absolutePoint.y, width: 0, height: 0, pageWidth: absolutePoint.pageWidth, pageHeight: absolutePoint.pageHeight };
            draftSelectionRef.current = rect;
            setDraftSelection(rect);
            return;
          }

          if (props.inkTool === 'text') {
            textTapRef.current = absolutePoint;
            return;
          }

          if (props.inkTool === 'erase') {
            const hitStrokeId = findHitInkStrokeId(pageInkStrokesForView, absolutePoint);
            if (hitStrokeId) {
              props.onRemoveInkStroke(hitStrokeId);
            }
          }
        },
        onPanResponderMove: (event, gestureState) => {
          const absolutePoint = clampPointToStage(gestureState.moveX - overlayFrame.x, gestureState.moveY - overlayFrame.y, 'draw');
          if (props.inkTool === 'pen' || props.inkTool === 'highlight') {
            const stroke = currentStrokeRef.current;
            if (stroke) {
              const lastPoint = stroke.points[stroke.points.length - 1];
              if (Math.hypot(absolutePoint.x - lastPoint.x, absolutePoint.y - lastPoint.y) < 1.2) {
                return;
              }
              const nextStroke = { ...stroke, points: [...stroke.points, absolutePoint] };
              currentStrokeRef.current = nextStroke;
              setCurrentStroke(nextStroke);
            }
            return;
          }

          if (props.inkTool === 'select') {
            const origin = selectionOriginRef.current;
            if (!origin) return;
            const nextRect = {
              x: Math.min(origin.x, absolutePoint.x),
              y: Math.min(origin.y, absolutePoint.y),
              width: Math.abs(absolutePoint.x - origin.x),
              height: Math.abs(absolutePoint.y - origin.y),
              pageWidth: absolutePoint.pageWidth,
              pageHeight: absolutePoint.pageHeight,
            };
            draftSelectionRef.current = nextRect;
            setDraftSelection(nextRect);
          }
        },
        onPanResponderRelease: () => {
          const stroke = currentStrokeRef.current;
          if (stroke && stroke.points.length > 1) props.onCommitInkStroke(stroke);
          if (props.inkTool === 'select') {
            const rect = draftSelectionRef.current;
            if (rect && rect.width > 24 && rect.height > 24) props.onSelectionChange(rect);
            draftSelectionRef.current = null;
            selectionOriginRef.current = null;
            setDraftSelection(null);
          }
          if (props.inkTool === 'text' && textTapRef.current) {
            props.onAddTextAnnotation(textTapRef.current);
          }
          currentStrokeRef.current = null;
          textTapRef.current = null;
          setCurrentStroke(null);
        },
        onPanResponderTerminate: () => {
          const stroke = currentStrokeRef.current;
          if (stroke && stroke.points.length > 1) props.onCommitInkStroke(stroke);
          currentStrokeRef.current = null;
          draftSelectionRef.current = null;
          selectionOriginRef.current = null;
          textTapRef.current = null;
          setDraftSelection(null);
          setCurrentStroke(null);
        },
      }),
    [overlayFrame.x, overlayFrame.y, pageInkStrokesForView, props, viewerWidth, viewerHeight],
  );

  const pdfSource = typeof props.file === 'string' ? { uri: props.file } : props.file;
  const currentPenPath = currentStroke?.style === 'pen' ? getInkStrokeSvgPath(currentStroke, false) : '';
  const currentHighlightPath = currentStroke?.style === 'highlight' ? getInkStrokeSvgPath(currentStroke, false) : '';
  const selectionForView = scaleSelectionRectToPageSize(props.selectionRect, viewerWidth, viewerHeight);

  return (
    <View style={props.styles.pdfViewerCard}>
      <View style={[props.styles.pdfStage, { width: viewerWidth, height: viewerHeight }]}>
        <Pdf
          source={pdfSource}
          page={props.page}
          style={props.styles.pdfViewer}
          trustAllCerts={false}
          scale={clampedPdfScale}
          minScale={1}
          maxScale={3}
          enableDoubleTapZoom={canZoomPdf}
          scrollEnabled={canZoomPdf && clampedPdfScale > 1}
          enablePaging={false}
          fitPolicy={0}
          horizontal={false}
          spacing={0}
          showsVerticalScrollIndicator={false}
          onScaleChanged={updatePdfScale}
          onLoadComplete={(pageCount) => props.onDocumentLoaded?.(pageCount)}
        />
        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          {pageInkStrokesForView
            .filter((stroke) => stroke.style === 'highlight')
            .map((stroke) => {
              const path = getInkStrokeSvgPath(stroke);
              if (!path) return null;
              return <Path key={stroke.id} d={path} fill={stroke.color} opacity={0.72} />;
            })}
          {currentHighlightPath ? <Path d={currentHighlightPath} fill={currentStroke?.color} opacity={0.72} /> : null}
        </Svg>

        <TextAnnotationLayer
          annotations={pageTextAnnotationsForView}
          styles={props.styles}
          onChangeText={props.onUpdateTextAnnotation}
          onRemove={props.onRemoveTextAnnotation}
          variant={props.textAnnotationVariant}
        />

        <View
          ref={overlayRef}
          collapsable={false}
          pointerEvents={props.inkTool === 'view' ? 'none' : 'auto'}
          style={props.styles.inkOverlay}
          onLayout={updateOverlayFrame}
          {...panResponder.panHandlers}
        >
          <Svg width="100%" height="100%" pointerEvents="none">
            {pageInkStrokesForView
              .filter((stroke) => stroke.style !== 'highlight')
              .map((stroke) => {
                const path = getInkStrokeSvgPath(stroke);
                if (!path) return null;
                return <Path key={stroke.id} d={path} fill={stroke.color} />;
              })}
            {currentPenPath ? <Path d={currentPenPath} fill={currentStroke?.color} /> : null}
          </Svg>
          {!draftSelection && selectionForView ? <View pointerEvents="none" style={[props.styles.selectionOverlayRect, { left: selectionForView.x, top: selectionForView.y, width: selectionForView.width, height: selectionForView.height }]} /> : null}
          {draftSelection ? <View pointerEvents="none" style={[props.styles.selectionOverlayRect, props.styles.selectionOverlayDraft, { left: draftSelection.x, top: draftSelection.y, width: draftSelection.width, height: draftSelection.height }]} /> : null}
        </View>
      </View>
    </View>
  );
}
