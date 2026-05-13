import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { FlatList, Image, NativeScrollEvent, NativeSyntheticEvent, Text, useWindowDimensions, View } from 'react-native';
import Pdf from 'react-native-pdf';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { TextAnnotationLayer } from '../canvas/text-annotation-layer';
import { findHitInkStrokeId, getInkStrokeSvgPath, isDrawingTool, isShapeTool, resolveInkStrokeAppearance, resolveShapeStrokeAppearance, scaleInkStrokeToPageSize, scaleSelectionRectToPageSize, scaleTextAnnotationToPageSize } from '../../../ui-helpers';
import { InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { NotebookPage } from '../../../types';

function InkPath({ stroke, draft = false }: { stroke: InkStroke; draft?: boolean }) {
  const path = getInkStrokeSvgPath(stroke, !draft);
  if (!path) return null;

  if (stroke.style === 'shape') {
    return (
      <Path
        key={stroke.id}
        d={path}
        fill="none"
        stroke={stroke.color}
        strokeWidth={stroke.width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  if (stroke.style === 'highlight') {
    return <Path key={stroke.id} d={path} fill={stroke.color} opacity={0.72} />;
  }

  return <Path key={stroke.id} d={path} fill={stroke.color} />;
}

function NotebookPaperBackground({ page }: { page: NotebookPage }) {
  const isSummary = page.kind === 'summary';

  if (!isSummary) {
    return (
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF' }}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: '#F2F5FA' }} />
      </View>
    );
  }

  const lines = Array.from({ length: 24 }, (_, index) => index);

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#FFFDF8' }}>
      <View style={{ position: 'absolute', top: 0, left: 0, bottom: 0, width: 42, backgroundColor: '#FFF4E0', borderRightWidth: 1, borderRightColor: '#F0E5D2' }} />
      {lines.map((line) => (
        <View
          key={line}
          style={{
            position: 'absolute',
            left: 58,
            right: 40,
            top: 82 + line * 34,
            height: 1,
            backgroundColor: '#F0E5D2',
          }}
        />
      ))}
      <Text style={{ position: 'absolute', top: 30, left: 58, fontSize: 13, fontWeight: '900', color: '#B7791F' }}>
        AI 정리 페이지
      </Text>
    </View>
  );
}

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
  onSelectionPreviewChange?: (uri: string | null) => void;
  onPageChanged?: (page: number) => void;
  onOpenGeneratedPage?: (pageId: string) => void;
  onDocumentLoaded?: (pageCount: number) => void;
  notebookPages?: NotebookPage[];
  activeGeneratedPageId?: string | null;
  pageImageUrls?: Record<number, string>;
  styles: any;
}) {
  const { width, height } = useWindowDimensions();
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const availableWidth = Math.max(320, containerSize.width || width);
  const compactViewer = width < 900;
  const phoneViewer = width < 700;
  const viewerWidth = phoneViewer
    ? Math.max(320, availableWidth - 12)
    : compactViewer
      ? Math.max(360, availableWidth - 24)
      : Math.min(1500, Math.max(420, availableWidth - 32));
  const [pdfPageSize, setPdfPageSize] = useState<{ width: number; height: number } | null>(null);
  const pageAspectRatio = pdfPageSize ? Math.max(0.45, Math.min(3.2, pdfPageSize.width / pdfPageSize.height)) : 16 / 9;
  const viewerHeight = Math.round(viewerWidth / pageAspectRatio);
  const pageGap = 14;
  const [documentPageCount, setDocumentPageCount] = useState(Math.max(1, props.page));
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const [capturingSelection, setCapturingSelection] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const textTapRef = useRef<InkPoint | null>(null);
  const pageCaptureRefs = useRef<Record<string, View | null>>({});

  const pageItems = useMemo<NotebookPage[]>(
    () => props.notebookPages?.length
      ? props.notebookPages
      : Array.from({ length: Math.max(1, documentPageCount) }, (_, index) => ({
          id: `pdf:${index + 1}`,
          documentId: 0,
          kind: 'pdf' as const,
          label: `${index + 1} 페이지`,
          pageNumber: index + 1,
        })),
    [documentPageCount, props.notebookPages],
  );
  const firstCachedPageImageUri = useMemo(() => {
    const firstPdfPage = pageItems.find((item) => item.pageNumber);
    return firstPdfPage?.pageNumber ? props.pageImageUrls?.[firstPdfPage.pageNumber] : undefined;
  }, [pageItems, props.pageImageUrls]);
  const pdfSource = useMemo(() => {
    const source = typeof props.file === 'string' ? { uri: props.file } : props.file;
    if (typeof source === 'object' && source && 'uri' in source && typeof source.uri === 'string' && source.uri.startsWith('/')) {
      return { ...source, uri: `file://${source.uri}` };
    }
    return source;
  }, [props.file]);
  const scrollEnabled = props.inkTool === 'view';

  useEffect(() => {
    if (!firstCachedPageImageUri) return;
    Image.getSize(
      firstCachedPageImageUri,
      (imageWidth, imageHeight) => {
        if (imageWidth > 0 && imageHeight > 0) setPdfPageSize({ width: imageWidth, height: imageHeight });
      },
      () => undefined,
    );
  }, [firstCachedPageImageUri]);

  const clampPointToPage = (page: NotebookPage, x: number, y: number, mode: 'draw' | 'annotate' = 'draw'): InkPoint => ({
    x: Math.max(0, Math.min(viewerWidth - (mode === 'annotate' ? 180 : 0), x)),
    y: Math.max(0, Math.min(viewerHeight - (mode === 'annotate' ? 110 : 0), y)),
    pageNumber: page.pageNumber,
    generatedPageId: page.generatedPageId,
    pageWidth: viewerWidth,
    pageHeight: viewerHeight,
  });

  const getPageStrokesForView = (page: NotebookPage) => (
    props.inkStrokes
      .filter((stroke) => page.generatedPageId ? stroke.generatedPageId === page.generatedPageId : (!stroke.generatedPageId && (!stroke.pageNumber || stroke.pageNumber === page.pageNumber)))
      .map((stroke) => scaleInkStrokeToPageSize(stroke, viewerWidth, viewerHeight))
  );

  const getPageTextAnnotationsForView = (page: NotebookPage) => (
    props.textAnnotations
      .filter((annotation) => page.generatedPageId ? annotation.generatedPageId === page.generatedPageId : (!annotation.generatedPageId && annotation.pageNumber === page.pageNumber))
      .map((annotation) => scaleTextAnnotationToPageSize(annotation, viewerWidth, viewerHeight))
  );

  const waitForNextPaint = () => new Promise((resolve) => setTimeout(resolve, 60));

  const buildSelectionPreview = useCallback(async (page: NotebookPage, rect: SelectionRect) => {
    const captureTarget = pageCaptureRefs.current[page.id];
    if (!captureTarget) return null;
    setCapturingSelection(true);
    await waitForNextPaint();

    try {
      const fullImageUri = await captureRef(captureTarget, {
        format: 'png',
        result: 'tmpfile',
        quality: 1,
        width: Math.round(viewerWidth),
        height: Math.round(viewerHeight),
        handleGLSurfaceViewOnAndroid: true,
      });
      const crop = {
        originX: Math.max(0, Math.floor(rect.x)),
        originY: Math.max(0, Math.floor(rect.y)),
        width: Math.max(1, Math.min(Math.floor(rect.width), Math.floor(viewerWidth - rect.x))),
        height: Math.max(1, Math.min(Math.floor(rect.height), Math.floor(viewerHeight - rect.y))),
      };
      const cropped = await manipulateAsync(fullImageUri, [{ crop }], { compress: 1, format: SaveFormat.PNG });
      return cropped.uri;
    } catch {
      return null;
    } finally {
      setCapturingSelection(false);
    }
  }, [viewerHeight, viewerWidth]);

  const beginInteraction = (page: NotebookPage) => {
    if (page.generatedPageId) props.onOpenGeneratedPage?.(page.generatedPageId);
    if (page.pageNumber) props.onPageChanged?.(page.pageNumber);
  };

  const handlePageScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!scrollEnabled) return;
    const pageStride = viewerHeight + pageGap;
    const nextIndex = Math.max(0, Math.min(pageItems.length - 1, Math.round(event.nativeEvent.contentOffset.y / pageStride)));
    const nextPage = pageItems[nextIndex];
    if (nextPage?.generatedPageId) props.onOpenGeneratedPage?.(nextPage.generatedPageId);
    if (nextPage?.pageNumber && nextPage.pageNumber !== props.page) props.onPageChanged?.(nextPage.pageNumber);
  };

  const isCurrentNotebookPage = (page: NotebookPage) => (
    page.generatedPageId ? page.generatedPageId === props.activeGeneratedPageId : page.pageNumber === props.page
  );

  const renderInkLayers = (page: NotebookPage) => {
    const pageStrokes = getPageStrokesForView(page);
    const pageTextAnnotations = getPageTextAnnotationsForView(page);
    const selectionForView = isCurrentNotebookPage(page) ? scaleSelectionRectToPageSize(props.selectionRect, viewerWidth, viewerHeight) : null;
    const draftForView = (page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) ? draftSelection : null;

    return (
      <>
        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          {pageStrokes.filter((stroke) => stroke.style === 'highlight').map((stroke) => <InkPath key={stroke.id} stroke={stroke} />)}
          {(page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) && currentStroke?.style === 'highlight' ? <InkPath stroke={currentStroke} draft /> : null}
        </Svg>

        <TextAnnotationLayer
          annotations={pageTextAnnotations}
          styles={props.styles}
          onChangeText={props.onUpdateTextAnnotation}
          onRemove={props.onRemoveTextAnnotation}
          variant={props.textAnnotationVariant}
        />

        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          {pageStrokes.filter((stroke) => stroke.style !== 'highlight').map((stroke) => <InkPath key={stroke.id} stroke={stroke} />)}
          {(page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) && currentStroke?.style !== 'highlight' && currentStroke ? <InkPath stroke={currentStroke} draft /> : null}
        </Svg>

        {!capturingSelection && !draftForView && selectionForView ? (
          <View pointerEvents="none" style={[props.styles.selectionOverlayRect, { left: selectionForView.x, top: selectionForView.y, width: selectionForView.width, height: selectionForView.height }]} />
        ) : null}
        {!capturingSelection && draftForView ? (
          <View pointerEvents="none" style={[props.styles.selectionOverlayRect, props.styles.selectionOverlayDraft, { left: draftForView.x, top: draftForView.y, width: draftForView.width, height: draftForView.height }]} />
        ) : null}
      </>
    );
  };

  const renderPage = (page: NotebookPage) => {
    const pageStrokesForView = getPageStrokesForView(page);
    const shouldRenderPdfPage = page.kind === 'pdf' && page.pageNumber ? Math.abs(page.pageNumber - props.page) <= 1 : false;
    const pageImageUri = page.pageNumber ? props.pageImageUrls?.[page.pageNumber] : undefined;

    return (
      <View
        key={page.id}
        ref={(node) => {
          pageCaptureRefs.current[page.id] = node;
        }}
        collapsable={false}
        style={[props.styles.pdfStage, { width: viewerWidth, height: viewerHeight, marginBottom: pageGap, backgroundColor: '#FFFFFF' }]}
      >
        {pageImageUri ? (
          <Image source={{ uri: pageImageUri }} style={props.styles.pdfViewer} resizeMode="contain" />
        ) : shouldRenderPdfPage && page.pageNumber ? (
          <Pdf
            source={pdfSource}
            page={page.pageNumber}
            style={props.styles.pdfViewer}
            trustAllCerts={false}
            scale={1}
            minScale={1}
            maxScale={1}
            enableDoubleTapZoom={false}
            scrollEnabled={false}
            enablePaging={false}
            singlePage
            fitPolicy={0}
            horizontal={false}
            spacing={0}
            showsVerticalScrollIndicator={false}
            onLoadComplete={(pageCount, _path, size) => {
              setLoadError(null);
              if (size?.width && size?.height) setPdfPageSize(size);
              setDocumentPageCount(pageCount);
              props.onDocumentLoaded?.(pageCount);
            }}
            onError={(error) => {
              setLoadError(error instanceof Error ? error.message : 'PDF를 불러오지 못했습니다.');
            }}
          />
        ) : page.kind === 'pdf' ? (
          <View style={[props.styles.pdfViewer, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: '#A3ACBA', fontWeight: '800' }}>{page.label}</Text>
          </View>
        ) : (
          <NotebookPaperBackground page={page} />
        )}

        {renderInkLayers(page)}

        <View
          pointerEvents={props.inkTool === 'view' ? 'none' : 'auto'}
          style={props.styles.inkOverlay}
          onStartShouldSetResponder={(event) => {
            if (event.nativeEvent.touches && event.nativeEvent.touches.length > 1) return false;
            return props.inkTool !== 'view';
          }}
          onMoveShouldSetResponder={(event) => {
            if (event.nativeEvent.touches && event.nativeEvent.touches.length > 1) return false;
            return isDrawingTool(props.inkTool) || props.inkTool === 'select';
          }}
          onResponderGrant={(event) => {
            beginInteraction(page);
            const point = clampPointToPage(page, event.nativeEvent.locationX, event.nativeEvent.locationY, props.inkTool === 'text' ? 'annotate' : 'draw');

            if (isDrawingTool(props.inkTool)) {
              const appearance = isShapeTool(props.inkTool)
                ? resolveShapeStrokeAppearance(props.penColor, props.penWidth)
                : resolveInkStrokeAppearance(props.inkTool, props.penColor, props.penWidth);
              const stroke: InkStroke = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                color: appearance.color,
                width: appearance.width,
                style: isShapeTool(props.inkTool) ? 'shape' : props.inkTool === 'highlight' ? 'highlight' : 'pen',
                shape: isShapeTool(props.inkTool) ? props.inkTool : undefined,
                pageNumber: page.pageNumber,
                generatedPageId: page.generatedPageId,
                pageWidth: viewerWidth,
                pageHeight: viewerHeight,
                points: [point],
              };
              currentStrokeRef.current = stroke;
              setCurrentStroke(stroke);
              return;
            }

            if (props.inkTool === 'select') {
              props.onSelectionChange(null);
              props.onSelectionPreviewChange?.(null);
              selectionOriginRef.current = point;
              const rect = { x: point.x, y: point.y, width: 0, height: 0, pageWidth: point.pageWidth, pageHeight: point.pageHeight };
              draftSelectionRef.current = rect;
              setDraftSelection(rect);
              return;
            }

            if (props.inkTool === 'text') {
              textTapRef.current = point;
              return;
            }

            if (props.inkTool === 'erase') {
              const hitStrokeId = findHitInkStrokeId(pageStrokesForView, point);
              if (hitStrokeId) props.onRemoveInkStroke(hitStrokeId);
            }
          }}
          onResponderMove={(event) => {
            const point = clampPointToPage(page, event.nativeEvent.locationX, event.nativeEvent.locationY);

            if (isDrawingTool(props.inkTool)) {
              const stroke = currentStrokeRef.current;
              if (!stroke) return;
              if (stroke.style === 'shape') {
                const nextStroke = { ...stroke, points: [stroke.points[0], point] };
                currentStrokeRef.current = nextStroke;
                setCurrentStroke(nextStroke);
                return;
              }
              const lastPoint = stroke.points[stroke.points.length - 1];
              if (Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 1.2) return;
              const nextStroke = { ...stroke, points: [...stroke.points, point] };
              currentStrokeRef.current = nextStroke;
              setCurrentStroke(nextStroke);
              return;
            }

            if (props.inkTool === 'select') {
              const origin = selectionOriginRef.current;
              if (!origin) return;
              const rect = {
                x: Math.min(origin.x, point.x),
                y: Math.min(origin.y, point.y),
                width: Math.abs(point.x - origin.x),
                height: Math.abs(point.y - origin.y),
                pageWidth: point.pageWidth,
                pageHeight: point.pageHeight,
              };
              draftSelectionRef.current = rect;
              setDraftSelection(rect);
            }
          }}
          onResponderRelease={() => {
            const stroke = currentStrokeRef.current;
            if (stroke && stroke.points.length > 1) props.onCommitInkStroke(stroke);

            if (props.inkTool === 'select') {
              const rect = draftSelectionRef.current;
              draftSelectionRef.current = null;
              selectionOriginRef.current = null;
              setDraftSelection(null);
              if (rect && rect.width > 24 && rect.height > 24) {
                void buildSelectionPreview(page, rect).then((uri) => {
                  props.onSelectionChange(rect);
                  props.onSelectionPreviewChange?.(uri);
                });
              }
            }

            if (props.inkTool === 'text' && textTapRef.current) props.onAddTextAnnotation(textTapRef.current);
            currentStrokeRef.current = null;
            textTapRef.current = null;
            setCurrentStroke(null);
          }}
          onResponderTerminate={() => {
            const stroke = currentStrokeRef.current;
            if (stroke && stroke.points.length > 1) props.onCommitInkStroke(stroke);
            currentStrokeRef.current = null;
            draftSelectionRef.current = null;
            selectionOriginRef.current = null;
            textTapRef.current = null;
            setDraftSelection(null);
            setCurrentStroke(null);
          }}
        />
      </View>
    );
  };

  return (
    <View
      style={props.styles.pdfViewerCard}
      onLayout={(event) => {
        const nextWidth = Math.floor(event.nativeEvent.layout.width);
        const nextHeight = Math.floor(event.nativeEvent.layout.height);
        if (nextWidth !== containerSize.width || nextHeight !== containerSize.height) {
          setContainerSize({ width: nextWidth, height: nextHeight });
        }
      }}
    >
      <FlatList
        data={pageItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => renderPage(item)}
        style={{ width: '100%' }}
        contentContainerStyle={{ alignItems: 'center', paddingTop: 4, paddingBottom: 24 }}
        scrollEnabled={scrollEnabled}
        scrollEventThrottle={96}
        onScroll={handlePageScroll}
        showsVerticalScrollIndicator
        initialNumToRender={3}
        maxToRenderPerBatch={4}
        windowSize={5}
        removeClippedSubviews
        getItemLayout={(_, index) => ({
          length: viewerHeight + pageGap,
          offset: (viewerHeight + pageGap) * index,
          index,
        })}
        ListFooterComponent={loadError ? (
          <View pointerEvents="none" style={{ paddingHorizontal: 24, paddingVertical: 12, alignItems: 'center' }}>
            <Text style={{ color: '#6B7280', textAlign: 'center', fontWeight: '700' }}>{loadError}</Text>
          </View>
        ) : null}
      />
    </View>
  );
}
