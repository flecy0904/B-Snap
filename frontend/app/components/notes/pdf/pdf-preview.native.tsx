import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { FlatList, GestureResponderEvent, Image, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { TextAnnotationLayer } from '../canvas/text-annotation-layer';
import { findHitInkStrokeId, getInkCenterlinePath, getInkStrokeSvgPath, isDrawingTool, isShapeTool, resolveInkStrokeAppearance, resolveShapeStrokeAppearance, scaleInkStrokeToPageSize, scaleSelectionRectToPageSize, scaleTextAnnotationToPageSize } from '../../../ui-helpers';
import { InkBrush, InkBrushSettings, InkLinePattern, InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { CaptureAsset, NotebookPage, PageCaptureReference } from '../../../types';
import { renderPdfPageToImage, type RenderedPdfPage } from '../../../services/pdf-page-renderer';
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type ResponderStartPoint = { x: number; y: number } | null;
const PDF_RENDER_PAGE_RADIUS = 1;
const PDF_RENDER_CACHE_RADIUS = 2;
const PDF_VIEWABILITY_THRESHOLD = 65;

function hasMultipleTouches(event: GestureResponderEvent) {
  return Boolean(event.nativeEvent.touches && event.nativeEvent.touches.length > 1);
}

function isLikelyStylusEvent(event: GestureResponderEvent) {
  const nativeEvent = event.nativeEvent as any;
  const touch = nativeEvent.changedTouches?.[0] ?? nativeEvent.touches?.[0] ?? null;
  const pointerType = nativeEvent.pointerType ?? nativeEvent.touchType ?? touch?.pointerType ?? touch?.touchType ?? touch?.type;
  return pointerType === 'pen' || pointerType === 'stylus' || pointerType === 'pencil';
}

function shouldCaptureDrawingMove(event: GestureResponderEvent, startPoint: ResponderStartPoint) {
  if (isLikelyStylusEvent(event)) return true;
  if (!startPoint) return false;
  const dx = event.nativeEvent.locationX - startPoint.x;
  const dy = event.nativeEvent.locationY - startPoint.y;
  if (Math.hypot(dx, dy) < 8) return false;
  return Math.abs(dx) > Math.abs(dy) * 1.18;
}

function getNotebookPageKey(page: NotebookPage) {
  return page.generatedPageId ? `generated:${page.generatedPageId}` : `pdf:${page.pageNumber ?? page.id}`;
}

function getPdfSourceKey(source: number | string | { uri: string }) {
  if (typeof source === 'number') return `asset:${source}`;
  if (typeof source === 'string') return source;
  return source.uri;
}

function isPdfPageNearCurrent(page: NotebookPage, currentPageNumber: number) {
  return page.kind === 'pdf'
    && typeof page.pageNumber === 'number'
    && Math.abs(page.pageNumber - currentPageNumber) <= PDF_RENDER_PAGE_RADIUS;
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
  return asset.analysisSummary || asset.summary;
}

function InkPath({ stroke, draft = false }: { stroke: InkStroke; draft?: boolean }) {
  if (stroke.linePattern && stroke.linePattern !== 'solid' && stroke.style !== 'highlight' && stroke.style !== 'shape') {
    const centerlinePath = getInkCenterlinePath(stroke.points);
    if (!centerlinePath) return null;
    const dashArray = stroke.linePattern === 'dotted' ? `${Math.max(1, stroke.width * 0.45)} ${Math.max(6, stroke.width * 2)}` : `${Math.max(8, stroke.width * 3)} ${Math.max(5, stroke.width * 1.8)}`;
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
  const [renderedPdfPages, setRenderedPdfPages] = useState<Record<string, RenderedPdfPage>>({});
  const [openReferenceId, setOpenReferenceId] = useState<string | null>(null);
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const reportedDocumentPageCountRef = useRef(documentPageCount);
  const pdfRenderGenerationRef = useRef(0);
  const pdfRenderRequestsRef = useRef<Set<string>>(new Set());
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
  const pdfSourceKey = useMemo(() => getPdfSourceKey(props.file), [props.file]);
  const getPdfRenderCacheKey = useCallback((pageNumber: number) => (
    `${pdfSourceKey}:${pageNumber}:${Math.round(viewerWidth)}`
  ), [pdfSourceKey, viewerWidth]);
  const interactionLocksScroll = props.inkTool !== 'view';
  const scrollEnabled = !interactionLocksScroll;
  const [visiblePageKeys, setVisiblePageKeys] = useState<Set<string>>(() => new Set([getNotebookPageKey(pageItems[0])]));
  const flatListExtraData = useMemo(() => ({
    activeGeneratedPageId: props.activeGeneratedPageId,
    page: props.page,
    pdfSourceKey,
    viewerHeight,
    viewerWidth,
    visiblePageKeys,
  }), [props.activeGeneratedPageId, props.page, pdfSourceKey, viewerHeight, viewerWidth, visiblePageKeys]);

  useEffect(() => {
    setLoadError(null);
    setPdfPageSize(null);
    setDocumentPageCount(Math.max(1, props.page));
    reportedDocumentPageCountRef.current = 0;
    pdfRenderGenerationRef.current += 1;
    pdfRenderRequestsRef.current.clear();
    setRenderedPdfPages({});
    setVisiblePageKeys(new Set([getNotebookPageKey(pageItems[0])]));
    visiblePageKeysRef.current = '';
    suppressNextAutoScrollRef.current = false;
  }, [pdfSourceKey]);

  const pdfPagesToRender = useMemo(() => {
    const pageNumbers: number[] = [];
    pageItems.forEach((page) => {
      if (page.kind !== 'pdf' || !page.pageNumber) return;
      const pageKey = getNotebookPageKey(page);
      if (!visiblePageKeys.has(pageKey) && !isPdfPageNearCurrent(page, props.page)) return;
      if (!pageNumbers.includes(page.pageNumber)) pageNumbers.push(page.pageNumber);
    });
    return pageNumbers;
  }, [pageItems, props.page, visiblePageKeys]);

  useEffect(() => {
    if (!pdfPagesToRender.length || viewerWidth <= 0) return;
    const generation = pdfRenderGenerationRef.current;

    pdfPagesToRender.forEach((pageNumber) => {
      const cacheKey = getPdfRenderCacheKey(pageNumber);
      if (renderedPdfPages[cacheKey] || pdfRenderRequestsRef.current.has(cacheKey)) return;

      pdfRenderRequestsRef.current.add(cacheKey);
      void renderPdfPageToImage({ file: props.file, pageNumber, targetWidth: viewerWidth })
        .then((renderedPage) => {
          if (pdfRenderGenerationRef.current !== generation) return;
          setLoadError(null);
          setPdfPageSize((current) => (
            current?.width === renderedPage.width && current?.height === renderedPage.height
              ? current
              : { width: renderedPage.width, height: renderedPage.height }
          ));
          setDocumentPageCount((current) => (current === renderedPage.pageCount ? current : renderedPage.pageCount));
          if (reportedDocumentPageCountRef.current !== renderedPage.pageCount) {
            reportedDocumentPageCountRef.current = renderedPage.pageCount;
            props.onDocumentLoaded?.(renderedPage.pageCount);
          }
          setRenderedPdfPages((current) => (
            current[cacheKey] ? current : { ...current, [cacheKey]: renderedPage }
          ));
        })
        .catch((error) => {
          if (pdfRenderGenerationRef.current !== generation) return;
          setLoadError(error instanceof Error ? error.message : 'PDF 페이지를 렌더링하지 못했습니다.');
        })
        .finally(() => {
          pdfRenderRequestsRef.current.delete(cacheKey);
        });
    });
  }, [getPdfRenderCacheKey, pdfPagesToRender, props.file, props.onDocumentLoaded, renderedPdfPages, viewerWidth]);

  useEffect(() => {
    const keysToKeep = new Set<string>();
    pageItems.forEach((page) => {
      if (page.kind !== 'pdf' || !page.pageNumber) return;
      const pageKey = getNotebookPageKey(page);
      if (visiblePageKeys.has(pageKey) || Math.abs(page.pageNumber - props.page) <= PDF_RENDER_CACHE_RADIUS) {
        keysToKeep.add(getPdfRenderCacheKey(page.pageNumber));
      }
    });
    setRenderedPdfPages((current) => {
      const next: Record<string, RenderedPdfPage> = {};
      Object.entries(current).forEach(([key, value]) => {
        if (keysToKeep.has(key)) next[key] = value;
      });
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [getPdfRenderCacheKey, pageItems, props.page, visiblePageKeys]);

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
    const currentPage = pageItems.find(isCurrentNotebookPage);
    if (!currentPage) return;
    const currentKey = getNotebookPageKey(currentPage);
    setVisiblePageKeys((current) => {
      if (current.has(currentKey)) return current;
      const next = new Set(current);
      next.add(currentKey);
      return next;
    });
  }, [props.activeGeneratedPageId, props.page, pageItems]);

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

  const viewabilityConfig = useMemo(() => ({ itemVisiblePercentThreshold: PDF_VIEWABILITY_THRESHOLD, minimumViewTime: 120 }), []);
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

  const shouldRenderPdfContent = useCallback((page: NotebookPage, visiblePage: boolean) => (
    page.kind === 'pdf' && Boolean(page.pageNumber) && (visiblePage || isPdfPageNearCurrent(page, props.page))
  ), [props.page]);

  const shouldRenderPageLayers = useCallback((page: NotebookPage, currentPage: boolean, visiblePage: boolean) => (
    currentPage
    || visiblePage
    || isPdfPageNearCurrent(page, props.page)
    || page.generatedPageId === props.activeGeneratedPageId
  ), [props.activeGeneratedPageId, props.page]);

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
    const shouldRenderInteractiveLayers = shouldRenderPageLayers(page, currentPage, visiblePage);
    const pageStrokesForView = shouldRenderInteractiveLayers ? getPageStrokesForView(page) : [];
    const pageTextAnnotationsForView = shouldRenderInteractiveLayers ? getPageTextAnnotationsForView(page) : [];
    const shouldRenderPdfPage = shouldRenderPdfContent(page, visiblePage);
    const renderedPdfPage = page.pageNumber ? renderedPdfPages[getPdfRenderCacheKey(page.pageNumber)] : null;
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
        {shouldRenderPdfPage && page.pageNumber ? (
          <View pointerEvents="none" style={props.styles.pdfViewer}>
            {renderedPdfPage ? (
              <Image
                source={{ uri: renderedPdfPage.uri }}
                style={{ flex: 1, width: '100%', height: '100%' }}
                resizeMode="contain"
                fadeDuration={0}
              />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' }}>
                <Text style={{ color: '#A3ACBA', fontWeight: '800' }}>{page.label}</Text>
              </View>
            )}
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
                {activePageReference.aiSummary || activePageReference.summary}
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
            if (interactionLocksScroll && (isDrawingTool(props.inkTool) || props.inkTool === 'select' || props.inkTool === 'erase')) return true;
            if (isLikelyStylusEvent(event) && (isDrawingTool(props.inkTool) || props.inkTool === 'select')) return true;
            return props.inkTool === 'text';
          }}
          onMoveShouldSetResponder={(event) => {
            if (hasMultipleTouches(event)) return false;
            if (interactionLocksScroll && (isDrawingTool(props.inkTool) || props.inkTool === 'select' || props.inkTool === 'erase')) return true;
            if (props.inkTool === 'select') return shouldCaptureDrawingMove(event, responderStartPointRef.current);
            if (isDrawingTool(props.inkTool)) return shouldCaptureDrawingMove(event, responderStartPointRef.current);
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
              const lastPoint = stroke.points[stroke.points.length - 1];
              if (Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 1.2) return;
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
        extraData={flatListExtraData}
        style={{ width: '100%' }}
        contentContainerStyle={{ alignItems: 'center', paddingTop: 4, paddingBottom: 24 }}
        scrollEnabled={scrollEnabled}
        viewabilityConfig={viewabilityConfig}
        onViewableItemsChanged={handleViewableItemsChanged}
        showsVerticalScrollIndicator
        initialNumToRender={2}
        maxToRenderPerBatch={1}
        updateCellsBatchingPeriod={48}
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
