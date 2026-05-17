import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { FlatList, GestureResponderEvent, Image, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Pdf from 'react-native-pdf';
import Svg from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { InkPath } from '../canvas/ink-path';
import { TextAnnotationLayer } from '../canvas/text-annotation-layer';
import { hasMultipleTouches, isLikelyStylusEvent } from '../canvas/ink-input-policy';
import { cleanAiDisplayText, findHitInkStrokeId, isDrawingTool, isShapeTool, resolveInkStrokeAppearance, resolveShapeStrokeAppearance, scaleInkStrokeToPageSize, scaleSelectionRectToPageSize, scaleTextAnnotationToPageSize, shouldAppendInkPoint } from '../../../ui-helpers';
import { InkBrush, InkBrushSettings, InkLinePattern, InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { CaptureAsset, NotebookPage, PageCaptureReference } from '../../../types';
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type ResponderStartPoint = { x: number; y: number } | null;

function shouldCaptureDrawingMove(event: GestureResponderEvent, startPoint: ResponderStartPoint) {
  if (isLikelyStylusEvent(event)) return true;
  if (!startPoint) return false;
  const dx = event.nativeEvent.locationX - startPoint.x;
  const dy = event.nativeEvent.locationY - startPoint.y;
  if (Math.hypot(dx, dy) < 8) return false;
  return Math.abs(dx) > Math.abs(dy) * 1.18;
}

function isInkCaptureTool(tool: InkTool) {
  return isDrawingTool(tool) || tool === 'select' || tool === 'erase';
}

function getNotebookPageKey(page: NotebookPage) {
  return page.generatedPageId ? `generated:${page.generatedPageId}` : `pdf:${page.pageNumber ?? page.id}`;
}

function getReferencePreviewImage(reference: PageCaptureReference) {
  if (reference.thumbnailUrl) return { uri: reference.thumbnailUrl };
  if (reference.type === 'image' && reference.fileUrl) return { uri: reference.fileUrl };
  return reference.previewImage ?? null;
}

function getCaptureAssetPreviewImage(asset: CaptureAsset | null | undefined) {
  if (!asset) return null;
  if (asset.thumbnailUrl) return { uri: asset.thumbnailUrl };
  if (asset.type === 'image' && asset.fileUrl) return { uri: asset.fileUrl };
  return asset.previewImage ?? null;
}

function getCaptureAssetSummary(asset: CaptureAsset | null | undefined) {
  if (!asset) return '';
  return cleanAiDisplayText(asset.analysisSummary || asset.summary);
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

function isPdfUri(uri: string | undefined) {
  return !!uri && /\.pdf(?:$|[?#])/i.test(uri);
}

function getResizeCorner(rect: SelectionRect | null, point: InkPoint): ResizeCorner | null {
  if (!rect) return null;
  const threshold = 24;
  const corners: Array<{ corner: ResizeCorner; x: number; y: number }> = [
    { corner: 'nw', x: rect.x, y: rect.y },
    { corner: 'ne', x: rect.x + rect.width, y: rect.y },
    { corner: 'sw', x: rect.x, y: rect.y + rect.height },
    { corner: 'se', x: rect.x + rect.width, y: rect.y + rect.height },
  ];
  return corners.find((corner) => Math.hypot(point.x - corner.x, point.y - corner.y) <= threshold)?.corner ?? null;
}

function resizeRectFromCorner(source: SelectionRect, corner: ResizeCorner, point: InkPoint): SelectionRect {
  const minSize = 24;
  const right = source.x + source.width;
  const bottom = source.y + source.height;
  const nextLeft = corner === 'nw' || corner === 'sw' ? Math.min(point.x, right - minSize) : source.x;
  const nextRight = corner === 'ne' || corner === 'se' ? Math.max(point.x, source.x + minSize) : right;
  const nextTop = corner === 'nw' || corner === 'ne' ? Math.min(point.y, bottom - minSize) : source.y;
  const nextBottom = corner === 'sw' || corner === 'se' ? Math.max(point.y, source.y + minSize) : bottom;
  return {
    x: Math.max(0, nextLeft),
    y: Math.max(0, nextTop),
    width: Math.max(minSize, nextRight - nextLeft),
    height: Math.max(minSize, nextBottom - nextTop),
    pageWidth: point.pageWidth,
    pageHeight: point.pageHeight,
  };
}

function SelectionOverlay(props: { rect: SelectionRect; styles: any; draft?: boolean }) {
  const handleOffset = -7;
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

export function PdfPreview(props: {
  file: number | string | { uri: string };
  page: number;
  inkTool: InkTool;
  fingerDrawingEnabled?: boolean;
  penColor: string;
  penWidth: number;
  brushType: InkBrush;
  linePattern: InkLinePattern;
  brushSettings?: InkBrushSettings;
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
  onMoveSelection?: (dx: number, dy: number) => void;
  onResizeSelection?: (rect: SelectionRect) => void;
  onSelectionPreviewChange?: (uri: string | null) => void;
  onPageChanged?: (page: number) => void;
  onOpenGeneratedPage?: (pageId: string) => void;
  onDocumentLoaded?: (pageCount: number) => void;
  notebookPages?: NotebookPage[];
  activeGeneratedPageId?: string | null;
  pageImageUrls?: Record<number, string>;
  pageCaptureReferences?: PageCaptureReference[];
  incomingAssetSuggestion?: CaptureAsset | null;
  onAcceptIncomingAsset?: () => void;
  onArchiveIncomingAsset?: () => void;
  onDismissIncomingAsset?: () => void;
  onOpenPageCaptureReference?: (referenceId: string) => void;
  onAskAiAboutPageCaptureReference?: (referenceId: string) => void;
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
      : Math.min(1900, Math.max(420, availableWidth - 12));
  const [pdfPageSize, setPdfPageSize] = useState<{ width: number; height: number } | null>(null);
  const pageAspectRatio = pdfPageSize ? Math.max(0.45, Math.min(3.2, pdfPageSize.width / pdfPageSize.height)) : 16 / 9;
  const viewerHeight = Math.round(viewerWidth / pageAspectRatio);
  const pageGap = 14;
  const [documentPageCount, setDocumentPageCount] = useState(Math.max(1, props.page));
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const [capturingSelection, setCapturingSelection] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openReferenceId, setOpenReferenceId] = useState<string | null>(null);
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const suppressNextAutoScrollRef = useRef(false);
  const visiblePageKeysRef = useRef('');
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveStartRectRef = useRef<SelectionRect | null>(null);
  const selectionResizeCornerRef = useRef<ResizeCorner | null>(null);
  const selectionResizeStartRectRef = useRef<SelectionRect | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const textTapRef = useRef<InkPoint | null>(null);
  const responderStartPointRef = useRef<ResponderStartPoint>(null);
  const pageCaptureRefs = useRef<Record<string, View | null>>({});
  const listRef = useRef<FlatList<NotebookPage> | null>(null);
  const scrollStateRef = useRef({
    activeGeneratedPageId: props.activeGeneratedPageId,
    onOpenGeneratedPage: props.onOpenGeneratedPage,
    onPageChanged: props.onPageChanged,
    page: props.page,
    scrollEnabled: false,
  });

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
  const pageImageUrls = useMemo(() => {
    const entries = Object.entries(props.pageImageUrls ?? {}).filter(([, uri]) => !isPdfUri(uri));
    return Object.fromEntries(entries) as Record<number, string>;
  }, [props.pageImageUrls]);
  const strokeBuckets = useMemo(() => {
    const pdf = new Map<number, InkStroke[]>();
    const generated = new Map<string, InkStroke[]>();
    const legacyPdfStrokes: InkStroke[] = [];

    props.inkStrokes.forEach((stroke) => {
      if (stroke.generatedPageId) {
        const current = generated.get(stroke.generatedPageId) ?? [];
        current.push(stroke);
        generated.set(stroke.generatedPageId, current);
        return;
      }
      if (typeof stroke.pageNumber === 'number') {
        const current = pdf.get(stroke.pageNumber) ?? [];
        current.push(stroke);
        pdf.set(stroke.pageNumber, current);
        return;
      }
      legacyPdfStrokes.push(stroke);
    });

    return { pdf, generated, legacyPdfStrokes };
  }, [props.inkStrokes]);
  const textAnnotationBuckets = useMemo(() => {
    const pdf = new Map<number, InkTextAnnotation[]>();
    const generated = new Map<string, InkTextAnnotation[]>();

    props.textAnnotations.forEach((annotation) => {
      if (annotation.generatedPageId) {
        const current = generated.get(annotation.generatedPageId) ?? [];
        current.push(annotation);
        generated.set(annotation.generatedPageId, current);
        return;
      }
      if (typeof annotation.pageNumber === 'number') {
        const current = pdf.get(annotation.pageNumber) ?? [];
        current.push(annotation);
        pdf.set(annotation.pageNumber, current);
      }
    });

    return { pdf, generated };
  }, [props.textAnnotations]);
  const referenceBuckets = useMemo(() => {
    const pdf = new Map<number, PageCaptureReference[]>();
    const generated = new Map<string, PageCaptureReference[]>();

    (props.pageCaptureReferences ?? []).forEach((reference) => {
      if (reference.page.kind === 'generated') {
        const current = generated.get(reference.page.pageId) ?? [];
        current.push(reference);
        generated.set(reference.page.pageId, current);
        return;
      }
      const current = pdf.get(reference.page.pageNumber) ?? [];
      current.push(reference);
      pdf.set(reference.page.pageNumber, current);
    });

    return { pdf, generated };
  }, [props.pageCaptureReferences]);
  const firstCachedPageImageUri = useMemo(() => {
    const firstPdfPage = pageItems.find((item) => item.pageNumber);
    return firstPdfPage?.pageNumber ? pageImageUrls[firstPdfPage.pageNumber] : undefined;
  }, [pageImageUrls, pageItems]);
  const pdfSource = useMemo(() => {
    const source = typeof props.file === 'string' ? { uri: props.file } : props.file;
    if (typeof source === 'object' && source && 'uri' in source && typeof source.uri === 'string' && source.uri.startsWith('/')) {
      return { ...source, uri: `file://${source.uri}` };
    }
    return source;
  }, [props.file]);
  const inkInputLocksScroll = Boolean(props.fingerDrawingEnabled && isInkCaptureTool(props.inkTool));
  const scrollEnabled = !inkInputLocksScroll;
  const [visiblePageKeys, setVisiblePageKeys] = useState<Set<string>>(() => new Set([getNotebookPageKey(pageItems[0])]));

  useEffect(() => {
    scrollStateRef.current = {
      activeGeneratedPageId: props.activeGeneratedPageId,
      onOpenGeneratedPage: props.onOpenGeneratedPage,
      onPageChanged: props.onPageChanged,
      page: props.page,
      scrollEnabled,
    };
  }, [props.activeGeneratedPageId, props.onOpenGeneratedPage, props.onPageChanged, props.page, scrollEnabled]);

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

  const getRawPageStrokes = useCallback((page: NotebookPage) => {
    if (page.generatedPageId) return strokeBuckets.generated.get(page.generatedPageId) ?? [];
    const pdfStrokes = page.pageNumber ? strokeBuckets.pdf.get(page.pageNumber) ?? [] : [];
    return strokeBuckets.legacyPdfStrokes.length ? [...strokeBuckets.legacyPdfStrokes, ...pdfStrokes] : pdfStrokes;
  }, [strokeBuckets]);

  const getPageStrokesForView = useCallback((page: NotebookPage) => (
    getRawPageStrokes(page).map((stroke) => scaleInkStrokeToPageSize(stroke, viewerWidth, viewerHeight))
  ), [getRawPageStrokes, viewerHeight, viewerWidth]);

  const getPageTextAnnotationsForView = useCallback((page: NotebookPage) => {
    const annotations = page.generatedPageId
      ? textAnnotationBuckets.generated.get(page.generatedPageId) ?? []
      : page.pageNumber
        ? textAnnotationBuckets.pdf.get(page.pageNumber) ?? []
        : [];
    return annotations.map((annotation) => scaleTextAnnotationToPageSize(annotation, viewerWidth, viewerHeight));
  }, [textAnnotationBuckets, viewerHeight, viewerWidth]);

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

  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: 55, minimumViewTime: 80 }), []);
  const handleViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: Array<{ item: NotebookPage; isViewable?: boolean }> }) => {
    const state = scrollStateRef.current;
    const visibleItems = viewableItems.filter((entry) => entry.isViewable);
    const keys = (visibleItems.length ? visibleItems : viewableItems).map((entry) => getNotebookPageKey(entry.item));
    const joinedKeys = keys.join('|');
    if (joinedKeys !== visiblePageKeysRef.current) {
      visiblePageKeysRef.current = joinedKeys;
      setVisiblePageKeys(new Set(keys));
    }
    if (!state.scrollEnabled) return;
    const nextPage = visibleItems[0]?.item ?? viewableItems[0]?.item;
    if (nextPage?.generatedPageId && nextPage.generatedPageId !== state.activeGeneratedPageId) {
      suppressNextAutoScrollRef.current = true;
      state.onOpenGeneratedPage?.(nextPage.generatedPageId);
    }
    if (nextPage?.pageNumber && nextPage.pageNumber !== state.page) {
      suppressNextAutoScrollRef.current = true;
      state.onPageChanged?.(nextPage.pageNumber);
    }
  }).current;

  const isCurrentNotebookPage = (page: NotebookPage) => (
    page.generatedPageId ? page.generatedPageId === props.activeGeneratedPageId : page.pageNumber === props.page
  );

  const getPageCaptureReferences = (page: NotebookPage) => (
    page.generatedPageId
      ? referenceBuckets.generated.get(page.generatedPageId) ?? []
      : page.pageNumber
        ? referenceBuckets.pdf.get(page.pageNumber) ?? []
        : []
  );

  useEffect(() => {
    if (!openReferenceId) return;
    if (!(props.pageCaptureReferences ?? []).some((reference) => reference.id === openReferenceId)) {
      setOpenReferenceId(null);
    }
  }, [openReferenceId, props.pageCaptureReferences]);

  useEffect(() => {
    const currentIndex = pageItems.findIndex(isCurrentNotebookPage);
    if (currentIndex < 0) return;
    if (suppressNextAutoScrollRef.current) {
      suppressNextAutoScrollRef.current = false;
      return;
    }
    listRef.current?.scrollToIndex({ index: currentIndex, animated: false });
  }, [props.activeGeneratedPageId, props.page, pageItems, viewerHeight]);

  const renderInkLayers = (page: NotebookPage, pageStrokes: InkStroke[], pageTextAnnotations: InkTextAnnotation[], currentPage: boolean) => {
    const selectionForView = currentPage ? scaleSelectionRectToPageSize(props.selectionRect, viewerWidth, viewerHeight) : null;
    const draftForView = (page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) ? draftSelection : null;
    const hasHighlight = pageStrokes.some((stroke) => stroke.style === 'highlight') || ((page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) && currentStroke?.style === 'highlight');
    const hasInk = pageStrokes.some((stroke) => stroke.style !== 'highlight') || ((page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) && currentStroke?.style !== 'highlight' && currentStroke);
    const hasTextAnnotations = pageTextAnnotations.length > 0;
    if (!hasHighlight && !hasInk && !hasTextAnnotations && !selectionForView && !draftForView) return null;

    return (
      <>
        {hasHighlight ? (
          <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
            {pageStrokes.filter((stroke) => stroke.style === 'highlight').map((stroke) => <InkPath key={stroke.id} stroke={stroke} />)}
            {(page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) && currentStroke?.style === 'highlight' ? <InkPath stroke={currentStroke} draft /> : null}
          </Svg>
        ) : null}

        {hasTextAnnotations ? (
          <TextAnnotationLayer
            annotations={pageTextAnnotations}
            styles={props.styles}
            onChangeText={props.onUpdateTextAnnotation}
            onRemove={props.onRemoveTextAnnotation}
            variant={props.textAnnotationVariant}
          />
        ) : null}

        {hasInk ? (
          <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
            {pageStrokes.filter((stroke) => stroke.style !== 'highlight').map((stroke) => <InkPath key={stroke.id} stroke={stroke} />)}
            {(page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) && currentStroke?.style !== 'highlight' && currentStroke ? <InkPath stroke={currentStroke} draft /> : null}
          </Svg>
        ) : null}

        {!capturingSelection && !draftForView && selectionForView ? <SelectionOverlay rect={selectionForView} styles={props.styles} /> : null}
        {!capturingSelection && draftForView ? <SelectionOverlay rect={draftForView} styles={props.styles} draft /> : null}
      </>
    );
  };

  const renderPage = (page: NotebookPage) => {
    const currentPage = isCurrentNotebookPage(page);
    const pageKey = getNotebookPageKey(page);
    const visiblePage = visiblePageKeys.has(pageKey);
    const nearCurrentPage = page.kind === 'pdf' && page.pageNumber
      ? Math.abs(page.pageNumber - props.page) <= 1
      : page.generatedPageId === props.activeGeneratedPageId;
    const shouldRenderInteractiveLayers = currentPage || visiblePage || nearCurrentPage;
    const pageStrokesForView = shouldRenderInteractiveLayers ? getPageStrokesForView(page) : [];
    const pageTextAnnotationsForView = shouldRenderInteractiveLayers ? getPageTextAnnotationsForView(page) : [];
    const shouldRenderPdfPage = page.kind === 'pdf' && page.pageNumber ? nearCurrentPage || visiblePage : false;
    const pageImageUri = page.pageNumber ? pageImageUrls[page.pageNumber] : undefined;
    const pageReferences = shouldRenderInteractiveLayers ? getPageCaptureReferences(page) : [];
    const activePageReference = pageReferences.find((reference) => reference.id === openReferenceId) ?? null;
    const activeReferenceIndex = activePageReference ? pageReferences.findIndex((reference) => reference.id === activePageReference.id) : -1;
    const activeReferenceImage = activePageReference ? getReferencePreviewImage(activePageReference) : null;
    const imageReferenceCount = pageReferences.filter((reference) => reference.type === 'image').length;
    const referenceButtonLabel = imageReferenceCount > 0 ? `사진 ${imageReferenceCount}` : `자료 ${pageReferences.length}`;
    const incomingAsset = currentPage ? props.incomingAssetSuggestion : null;
    const incomingAssetImage = getCaptureAssetPreviewImage(incomingAsset);
    const incomingAssetSummary = getCaptureAssetSummary(incomingAsset);

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
          <Image source={{ uri: pageImageUri }} style={props.styles.pdfViewer} resizeMode="contain" fadeDuration={0} resizeMethod="resize" />
        ) : shouldRenderPdfPage && page.pageNumber ? (
          <View pointerEvents="none" style={props.styles.pdfViewer}>
            <Pdf
              source={pdfSource}
              page={page.pageNumber}
              style={{ flex: 1, width: '100%', height: '100%' }}
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
          </View>
        ) : page.kind === 'pdf' ? (
          <View style={[props.styles.pdfViewer, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: '#A3ACBA', fontWeight: '800' }}>{page.label}</Text>
          </View>
        ) : (
          <NotebookPaperBackground page={page} />
        )}

        {shouldRenderInteractiveLayers ? renderInkLayers(page, pageStrokesForView, pageTextAnnotationsForView, currentPage) : null}

        {pageReferences.length ? (
          <View pointerEvents="box-none" style={props.styles.pdfPageReferenceCluster}>
            <Pressable
              style={[props.styles.pdfPageReferenceSticker, activePageReference && props.styles.pdfPageReferenceStickerActive]}
              onPress={() => setOpenReferenceId((current) => (current === pageReferences[0].id ? null : pageReferences[0].id))}
            >
              <MaterialCommunityIcons name="image-multiple-outline" size={14} color="#4F68D2" />
              <Text style={props.styles.pdfPageReferenceStickerText}>{referenceButtonLabel}</Text>
            </Pressable>
          </View>
        ) : null}

        {activePageReference ? (
          <View style={props.styles.pdfPageReferencePopover}>
            <View style={props.styles.pdfPageReferencePopoverHeader}>
              <View style={props.styles.pdfPageReferencePopoverTitleBox}>
                <Text style={props.styles.pdfPageReferencePopoverLabel}>{activePageReference.pageLabel}</Text>
                <Text style={props.styles.pdfPageReferencePopoverTitle} numberOfLines={1}>{activePageReference.title}</Text>
              </View>
              <Pressable style={props.styles.pdfPageReferencePopoverClose} onPress={() => setOpenReferenceId(null)}>
                <MaterialCommunityIcons name="close" size={16} color="#6B7280" />
              </Pressable>
            </View>
            {activeReferenceImage ? (
              <View style={props.styles.pdfPageReferencePopoverImageFrame}>
                <Image source={activeReferenceImage} style={props.styles.pdfPageReferencePopoverImage} resizeMode="contain" fadeDuration={0} />
              </View>
            ) : (
              <View style={props.styles.pdfPageReferencePopoverFallback}>
                <MaterialCommunityIcons name={activePageReference.type === 'pdf' ? 'file-pdf-box' : 'image-outline'} size={24} color="#6D7BD9" />
                <Text style={props.styles.pdfPageReferencePopoverFallbackText}>미리보기 없음</Text>
              </View>
            )}
            <View style={props.styles.pdfPageReferencePopoverAnswer}>
              <View style={props.styles.pdfPageReferencePopoverAnswerHeader}>
                <MaterialCommunityIcons name="star-four-points" size={14} color="#5F79FF" />
                <Text style={props.styles.pdfPageReferencePopoverAnswerTitle}>AI 설명</Text>
              </View>
              <Text style={props.styles.pdfPageReferencePopoverAnswerText} numberOfLines={5}>
                {cleanAiDisplayText(activePageReference.aiSummary || activePageReference.summary)}
              </Text>
            </View>
            <View style={props.styles.pdfPageReferencePopoverActions}>
              {pageReferences.length > 1 ? (
                <Pressable
                  style={props.styles.pdfPageReferencePopoverIconAction}
                  onPress={() => {
                    const nextIndex = activeReferenceIndex <= 0 ? pageReferences.length - 1 : activeReferenceIndex - 1;
                    setOpenReferenceId(pageReferences[nextIndex].id);
                  }}
                >
                  <MaterialCommunityIcons name="chevron-left" size={17} color="#4F68D2" />
                </Pressable>
              ) : null}
              <Pressable
                style={props.styles.pdfPageReferencePopoverPrimaryAction}
                onPress={() => props.onAskAiAboutPageCaptureReference?.(activePageReference.id)}
              >
                <Text style={props.styles.pdfPageReferencePopoverPrimaryText}>AI로 더 보기</Text>
              </Pressable>
              {pageReferences.length > 1 ? (
                <Pressable
                  style={props.styles.pdfPageReferencePopoverIconAction}
                  onPress={() => {
                    const nextIndex = activeReferenceIndex >= pageReferences.length - 1 ? 0 : activeReferenceIndex + 1;
                    setOpenReferenceId(pageReferences[nextIndex].id);
                  }}
                >
                  <MaterialCommunityIcons name="chevron-right" size={17} color="#4F68D2" />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        {incomingAsset ? (
          <View style={props.styles.pdfIncomingCapturePopover}>
            <View style={props.styles.pdfIncomingCaptureHeader}>
              <View style={props.styles.pdfIncomingCaptureIcon}>
                <MaterialCommunityIcons name={incomingAsset.type === 'image' ? 'camera-outline' : 'file-pdf-box'} size={17} color="#4F68D2" />
              </View>
              <View style={props.styles.pdfIncomingCaptureTitleBox}>
                <Text style={props.styles.pdfIncomingCaptureLabel}>새 {incomingAsset.type === 'image' ? '사진' : '자료'} 도착</Text>
                <Text style={props.styles.pdfIncomingCaptureTitle} numberOfLines={1}>{incomingAsset.title}</Text>
              </View>
              <Pressable style={props.styles.pdfIncomingCaptureClose} onPress={props.onDismissIncomingAsset}>
                <MaterialCommunityIcons name="close" size={15} color="#6B7280" />
              </Pressable>
            </View>
            {incomingAssetImage ? (
              <View style={props.styles.pdfIncomingCaptureImageFrame}>
                <Image source={incomingAssetImage} style={props.styles.pdfIncomingCaptureImage} resizeMode="cover" fadeDuration={0} />
              </View>
            ) : null}
            <View style={props.styles.pdfIncomingCaptureAnswer}>
              <View style={props.styles.pdfIncomingCaptureAnswerHeader}>
                <MaterialCommunityIcons name="star-four-points" size={13} color="#5F79FF" />
                <Text style={props.styles.pdfIncomingCaptureAnswerTitle}>AI 설명</Text>
              </View>
              <Text style={props.styles.pdfIncomingCaptureAnswerText} numberOfLines={4}>{incomingAssetSummary}</Text>
            </View>
            <View style={props.styles.pdfIncomingCaptureActions}>
              <Pressable style={props.styles.pdfIncomingCapturePrimaryAction} onPress={props.onAcceptIncomingAsset}>
                <Text style={props.styles.pdfIncomingCapturePrimaryText}>현재 페이지 연결</Text>
              </Pressable>
              <Pressable style={props.styles.pdfIncomingCaptureSecondaryAction} onPress={props.onArchiveIncomingAsset}>
                <Text style={props.styles.pdfIncomingCaptureSecondaryText}>나중에</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View
          pointerEvents={props.inkTool === 'view' ? 'none' : 'auto'}
          style={props.styles.inkOverlay}
          onStartShouldSetResponder={(event) => {
            responderStartPointRef.current = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
            if (hasMultipleTouches(event)) return false;
            if (isInkCaptureTool(props.inkTool) && (props.fingerDrawingEnabled || isLikelyStylusEvent(event))) return true;
            return props.inkTool === 'text';
          }}
          onMoveShouldSetResponder={(event) => {
            if (hasMultipleTouches(event)) return false;
            if (isInkCaptureTool(props.inkTool)) {
              return props.fingerDrawingEnabled || shouldCaptureDrawingMove(event, responderStartPointRef.current);
            }
            return false;
          }}
          onResponderGrant={(event) => {
            beginInteraction(page);
            const point = clampPointToPage(page, event.nativeEvent.locationX, event.nativeEvent.locationY, props.inkTool === 'text' ? 'annotate' : 'draw');

            if (isDrawingTool(props.inkTool)) {
              const appearance = isShapeTool(props.inkTool)
                ? resolveShapeStrokeAppearance(props.penColor, props.penWidth)
                : resolveInkStrokeAppearance(props.inkTool, props.penColor, props.penWidth, props.brushType);
              const stroke: InkStroke = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                color: appearance.color,
                width: appearance.width,
                style: isShapeTool(props.inkTool) ? 'shape' : props.inkTool === 'highlight' ? 'highlight' : 'pen',
                brush: isShapeTool(props.inkTool) ? undefined : props.brushType,
                brushSettings: isShapeTool(props.inkTool) ? undefined : props.brushSettings,
                linePattern: props.linePattern,
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
              const currentSelection = isCurrentNotebookPage(page) ? scaleSelectionRectToPageSize(props.selectionRect, viewerWidth, viewerHeight) : null;
              const resizeCorner = getResizeCorner(currentSelection, point);
              if (currentSelection && resizeCorner) {
                selectionResizeCornerRef.current = resizeCorner;
                selectionResizeStartRectRef.current = currentSelection;
                draftSelectionRef.current = currentSelection;
                setDraftSelection(currentSelection);
                return;
              }
              if (
                currentSelection &&
                point.x >= currentSelection.x &&
                point.x <= currentSelection.x + currentSelection.width &&
                point.y >= currentSelection.y &&
                point.y <= currentSelection.y + currentSelection.height
              ) {
                selectionMoveOriginRef.current = point;
                selectionMoveStartRectRef.current = currentSelection;
                draftSelectionRef.current = currentSelection;
                setDraftSelection(currentSelection);
                return;
              }
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
              const hitSourceStrokes = pageStrokesForView.length ? pageStrokesForView : getPageStrokesForView(page);
              const hitStrokeId = findHitInkStrokeId(hitSourceStrokes, point);
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
              if (!shouldAppendInkPoint(stroke, point)) return;
              const nextStroke = { ...stroke, points: [...stroke.points, point] };
              currentStrokeRef.current = nextStroke;
              setCurrentStroke(nextStroke);
              return;
            }

            if (props.inkTool === 'select') {
              const resizeCorner = selectionResizeCornerRef.current;
              const resizeStartRect = selectionResizeStartRectRef.current;
              if (resizeCorner && resizeStartRect) {
                const rect = resizeRectFromCorner(resizeStartRect, resizeCorner, point);
                draftSelectionRef.current = rect;
                setDraftSelection(rect);
                return;
              }
              const moveOrigin = selectionMoveOriginRef.current;
              const moveStartRect = selectionMoveStartRectRef.current;
              if (moveOrigin && moveStartRect) {
                const rect = {
                  ...moveStartRect,
                  x: moveStartRect.x + point.x - moveOrigin.x,
                  y: moveStartRect.y + point.y - moveOrigin.y,
                  pageWidth: point.pageWidth,
                  pageHeight: point.pageHeight,
                };
                draftSelectionRef.current = rect;
                setDraftSelection(rect);
                return;
              }
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
              const moveOrigin = selectionMoveOriginRef.current;
              const moveStartRect = selectionMoveStartRectRef.current;
              const resizeCorner = selectionResizeCornerRef.current;
              const resizeStartRect = selectionResizeStartRectRef.current;
              draftSelectionRef.current = null;
              selectionOriginRef.current = null;
              selectionMoveOriginRef.current = null;
              selectionMoveStartRectRef.current = null;
              selectionResizeCornerRef.current = null;
              selectionResizeStartRectRef.current = null;
              setDraftSelection(null);
              if (rect && resizeCorner && resizeStartRect) {
                props.onResizeSelection?.(rect);
              } else if (rect && moveOrigin && moveStartRect) {
                const dx = rect.x - moveStartRect.x;
                const dy = rect.y - moveStartRect.y;
                if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) props.onMoveSelection?.(dx, dy);
              } else if (rect && rect.width > 24 && rect.height > 24) {
                void buildSelectionPreview(page, rect).then((uri) => {
                  props.onSelectionChange(rect);
                  props.onSelectionPreviewChange?.(uri);
                });
              }
            }

            if (props.inkTool === 'text' && textTapRef.current) props.onAddTextAnnotation(textTapRef.current);
            currentStrokeRef.current = null;
            textTapRef.current = null;
            responderStartPointRef.current = null;
            setCurrentStroke(null);
          }}
          onResponderTerminate={() => {
            const stroke = currentStrokeRef.current;
            if (stroke && stroke.points.length > 1) props.onCommitInkStroke(stroke);
            currentStrokeRef.current = null;
            draftSelectionRef.current = null;
            selectionOriginRef.current = null;
            selectionMoveOriginRef.current = null;
            selectionMoveStartRectRef.current = null;
            selectionResizeCornerRef.current = null;
            selectionResizeStartRectRef.current = null;
            textTapRef.current = null;
            responderStartPointRef.current = null;
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
        ref={listRef}
        data={pageItems}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => renderPage(item)}
        style={{ width: '100%' }}
        contentContainerStyle={{ alignItems: 'center', paddingTop: 4, paddingBottom: 24 }}
        scrollEnabled={scrollEnabled}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={handleViewableItemsChanged}
        showsVerticalScrollIndicator
        initialNumToRender={3}
        maxToRenderPerBatch={2}
        updateCellsBatchingPeriod={32}
        windowSize={3}
        removeClippedSubviews
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            listRef.current?.scrollToIndex({ index: info.index, animated: false });
          }, 80);
        }}
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
