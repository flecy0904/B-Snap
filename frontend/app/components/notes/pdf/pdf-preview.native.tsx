import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { FlatList, Image, NativeScrollEvent, NativeSyntheticEvent, PanResponder, Text, useWindowDimensions, View, type ViewToken } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { captureRef } from 'react-native-view-shot';
import { PencilHoverOverlay } from '../canvas/pencil-hover-overlay';
import { isPointInSelectionContextMenu } from '../canvas/selection-context-menu';
import { getPencilEraserRadius, getPencilHoverPoint, getPencilHoverSize, getPencilHoverToolLabel, isStylusHoverEvent, shouldPreviewPencilHover, type PencilHoverPoint } from '../canvas/native-pencil-hover';
import { shouldActivateNativeInkGesture, type NativeGestureStateManager, type NativeInkGestureEvent, type NativeInkTouchEvent } from '../canvas/native-ink-gesture-policy';
import { PdfInkLayers } from './pdf-ink-layers.native';
import { NotebookPaperBackground, PdfIncomingCapturePopover, PdfPageReferenceCluster, PdfPageReferencePopover } from './pdf-page-popovers.native';
import { finalizeInkStroke, findHitInkStrokeId, isDrawingTool, isPointInSelectionShape, isShapeTool, resolveInkStrokeAppearance, resolveShapeStrokeAppearance, scaleInkStrokeToPageSize, scaleSelectionRectToPageSize, scaleTextAnnotationToPageSize, shouldAppendInkPoint } from '../../../ui-helpers';
import { InkBrush, InkBrushSettings, InkEraserMode, InkLinePattern, InkPoint, InkSelectionMode, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { CaptureAsset, NotebookPage, PageCaptureReference } from '../../../types';
import { renderPdfPageToImage, type PdfRenderSource, type RenderedPdfPage } from '../../../services/pdf-page-renderer';
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type ResizeAnchor = {
  index: number;
  ratio: number;
  viewportAnchorOffset: number;
};
const PDF_RENDER_PAGE_RADIUS = 3;
const PDF_RENDER_CACHE_RADIUS = 3;
const PDF_RENDER_JS_CACHE_LIMIT = 28;
const PDF_RENDER_WIDTH_BUCKET = 32;
const PDF_VISIBLE_PAGE_BUFFER = 1;
const PDF_SCROLL_ANCHOR_SNAPSHOTS = new Map<string, ResizeAnchor>();
const PDF_SCROLL_OFFSET_SNAPSHOTS = new Map<string, number>();

function shouldLockScrollForTool(tool: InkTool, fingerDrawingEnabled: boolean | undefined) {
  return Boolean(fingerDrawingEnabled && isDrawingTool(tool));
}

function getNotebookPageKey(page: NotebookPage) {
  return page.generatedPageId ? `generated:${page.generatedPageId}` : `pdf:${page.pageNumber ?? page.id}`;
}

function getPdfSourceKey(source: number | string | { uri: string }) {
  if (typeof source === 'number') return `asset:${source}`;
  if (typeof source === 'string') return source;
  return source.uri;
}

function getPdfRenderSource(source: number | string | { uri: string }): PdfRenderSource | null {
  if (typeof source === 'number') return null;
  return source;
}

function getPdfRenderTargetWidth(width: number) {
  if (!Number.isFinite(width) || width <= 0) return 0;
  return Math.max(320, Math.ceil(width / PDF_RENDER_WIDTH_BUCKET) * PDF_RENDER_WIDTH_BUCKET);
}

function isPdfPageNearCurrent(page: NotebookPage, currentPageNumber: number) {
  return page.kind === 'pdf'
    && typeof page.pageNumber === 'number'
    && Math.abs(page.pageNumber - currentPageNumber) <= PDF_RENDER_PAGE_RADIUS;
}

function getResizeCorner(rect: SelectionRect | null, point: InkPoint): ResizeCorner | null {
  if (!rect) return null;
  if (rect.mode === 'lasso') return null;
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
    pageNumber: source.pageNumber,
    generatedPageId: source.generatedPageId,
    pageWidth: point.pageWidth,
    pageHeight: point.pageHeight,
  };
}

function getSelectionRectFromPoints(points: InkPoint[]): SelectionRect | null {
  if (points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const reference = points[0];
  return {
    x: Math.max(0, minX),
    y: Math.max(0, minY),
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY),
    mode: 'lasso',
    path: points,
    pageNumber: reference.pageNumber,
    generatedPageId: reference.generatedPageId,
    pageWidth: reference.pageWidth,
    pageHeight: reference.pageHeight,
  };
}

function getSelectionRectFromDrag(origin: InkPoint, point: InkPoint): SelectionRect {
  return {
    x: Math.min(origin.x, point.x),
    y: Math.min(origin.y, point.y),
    width: Math.abs(point.x - origin.x),
    height: Math.abs(point.y - origin.y),
    mode: 'rect',
    pageNumber: origin.pageNumber ?? point.pageNumber,
    generatedPageId: origin.generatedPageId ?? point.generatedPageId,
    pageWidth: point.pageWidth,
    pageHeight: point.pageHeight,
  };
}

function isSelectionOnNotebookPage(selection: SelectionRect | null, page: NotebookPage, fallbackCurrentPage: boolean) {
  if (!selection) return false;
  const selectionGeneratedPageId = selection.generatedPageId ?? selection.path?.find((point) => point.generatedPageId)?.generatedPageId;
  if (selectionGeneratedPageId || page.generatedPageId) return selectionGeneratedPageId === page.generatedPageId;

  const selectionPageNumber = selection.pageNumber ?? selection.path?.find((point) => typeof point.pageNumber === 'number')?.pageNumber;
  if (typeof selectionPageNumber === 'number' || typeof page.pageNumber === 'number') {
    return selectionPageNumber === page.pageNumber;
  }

  return fallbackCurrentPage;
}

function translateSelectionRect(source: SelectionRect, dx: number, dy: number, pageWidth: number, pageHeight: number): SelectionRect {
  const boundedX = Math.max(0, Math.min(Math.max(0, pageWidth - source.width), source.x + dx));
  const boundedY = Math.max(0, Math.min(Math.max(0, pageHeight - source.height), source.y + dy));
  const moveDx = boundedX - source.x;
  const moveDy = boundedY - source.y;
  return {
    ...source,
    x: boundedX,
    y: boundedY,
    path: source.path?.map((point) => ({
      ...point,
      x: point.x + moveDx,
      y: point.y + moveDy,
      pageWidth,
      pageHeight,
    })),
    pageWidth,
    pageHeight,
  };
}

function PdfSelectionMoveHandle(props: {
  selection: SelectionRect;
  inkTool: InkTool;
  pageWidth: number;
  pageHeight: number;
  scrollEnabled: boolean;
  setNativeScrollEnabled: (enabled: boolean) => void;
  onBegin: (selection: SelectionRect) => void;
  onMove: (selection: SelectionRect) => void;
  onCommit: (dx: number, dy: number) => void;
  onCancel: () => void;
}) {
  const propsRef = useRef(props);
  const startRectRef = useRef<SelectionRect | null>(null);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  const lockScroll = () => {
    if (propsRef.current.inkTool !== 'select') return;
    propsRef.current.setNativeScrollEnabled(false);
  };

  const restoreScroll = () => {
    const current = propsRef.current;
    current.setNativeScrollEnabled(current.scrollEnabled);
  };

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => propsRef.current.inkTool === 'select',
    onStartShouldSetPanResponder: () => propsRef.current.inkTool === 'select',
    onMoveShouldSetPanResponderCapture: (_event, gesture) => (
      propsRef.current.inkTool === 'select'
      && (Math.abs(gesture.dx) > 1 || Math.abs(gesture.dy) > 1)
    ),
    onMoveShouldSetPanResponder: (_event, gesture) => (
      propsRef.current.inkTool === 'select'
      && (Math.abs(gesture.dx) > 1 || Math.abs(gesture.dy) > 1)
    ),
    onPanResponderGrant: () => {
      const current = propsRef.current;
      current.setNativeScrollEnabled(false);
      startRectRef.current = current.selection;
      current.onBegin(current.selection);
    },
    onPanResponderMove: (_event, gesture) => {
      const startRect = startRectRef.current;
      if (!startRect) return;
      const current = propsRef.current;
      current.onMove(translateSelectionRect(startRect, gesture.dx, gesture.dy, current.pageWidth, current.pageHeight));
    },
    onPanResponderRelease: (_event, gesture) => {
      const startRect = startRectRef.current;
      const current = propsRef.current;
      startRectRef.current = null;
      restoreScroll();
      current.onCancel();
      if (!startRect) return;
      const nextRect = translateSelectionRect(startRect, gesture.dx, gesture.dy, current.pageWidth, current.pageHeight);
      const dx = nextRect.x - startRect.x;
      const dy = nextRect.y - startRect.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) current.onCommit(dx, dy);
    },
    onPanResponderTerminate: () => {
      const current = propsRef.current;
      startRectRef.current = null;
      restoreScroll();
      current.onCancel();
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), []);

  return (
    <View
      {...responder.panHandlers}
      onTouchStart={lockScroll}
      onTouchMove={lockScroll}
      onTouchEnd={restoreScroll}
      onTouchCancel={restoreScroll}
      pointerEvents={props.inkTool === 'select' ? 'auto' : 'none'}
      style={{
        position: 'absolute',
        left: props.selection.x,
        top: props.selection.y,
        width: props.selection.width,
        height: props.selection.height,
        zIndex: 70,
        elevation: 70,
        backgroundColor: 'transparent',
      }}
    />
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
  eraserMode?: InkEraserMode;
  eraserWidth?: number;
  selectionMode?: InkSelectionMode;
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
  onMoveTextAnnotation: (id: string, x: number, y: number) => void;
  onResizeTextAnnotation: (id: string, width: number, height: number) => void;
  onEraseInkAtPoint?: (point: InkPoint, radius: number, snapshot?: boolean, mode?: InkEraserMode) => boolean;
  onSelectionChange: (rect: SelectionRect | null) => void;
  onMoveSelection?: (dx: number, dy: number) => void;
  onResizeSelection?: (rect: SelectionRect) => void;
  onAskAiAboutSelection?: (selectionPreviewUri?: string | null) => void;
  onDuplicateSelection?: () => void;
  onDeleteSelection?: () => void;
  onChangeSelectedStrokesColor?: (color: string) => void;
  onChangeInkTool?: (tool: InkTool) => void;
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
  const baseViewerWidth = phoneViewer
    ? Math.max(320, availableWidth - 12)
    : compactViewer
      ? Math.max(360, availableWidth - 24)
      : Math.min(1900, Math.max(420, availableWidth - 12));
  const [pdfPageSize, setPdfPageSize] = useState<{ width: number; height: number } | null>(null);
  const pageAspectRatio = pdfPageSize ? Math.max(0.45, Math.min(3.2, pdfPageSize.width / pdfPageSize.height)) : 16 / 9;
  const viewerWidth = baseViewerWidth;
  const renderTargetWidth = getPdfRenderTargetWidth(viewerWidth);
  const viewerHeight = Math.round(viewerWidth / pageAspectRatio);
  const pageGap = 10;
  const [documentPageCount, setDocumentPageCount] = useState(Math.max(1, props.page));
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const [draftSelectionPageKey, setDraftSelectionPageKey] = useState<string | null>(null);
  const [draftSelectionPath, setDraftSelectionPath] = useState<InkPoint[]>([]);
  const [capturingSelection, setCapturingSelection] = useState(false);
  const [pageIndicatorVisible, setPageIndicatorVisible] = useState(false);
  const [inkGestureActive, setInkGestureActive] = useState(false);
  const [pencilHover, setPencilHover] = useState<(PencilHoverPoint & { pageKey: string }) | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renderedPdfPages, setRenderedPdfPages] = useState<Record<string, RenderedPdfPage>>({});
  const [cachedRenderedPdfPages, setCachedRenderedPdfPages] = useState<Record<string, RenderedPdfPage>>({});
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
  const draftSelectionPageKeyRef = useRef<string | null>(null);
  const draftSelectionPathRef = useRef<InkPoint[]>([]);
  const activeInkGesturePageKeyRef = useRef<string | null>(null);
  const selectionPreviewTokenRef = useRef(0);
  const eraserSnapshotPushedRef = useRef(false);
  const erasedStrokeIdsRef = useRef<Set<string>>(new Set());
  const textTapRef = useRef<InkPoint | null>(null);
  const pageCaptureRefs = useRef<Record<string, View | null>>({});
  const listRef = useRef<FlatList<NotebookPage> | null>(null);
  const pageIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutResizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageIndicatorVisibleRef = useRef(false);
  const inkGestureActiveRef = useRef(false);
  const scrollMetricsRef = useRef({ offsetY: 0, viewportHeight: 0 });
  const resizePageSyncSuppressedUntilRef = useRef(0);
  const actualVisiblePageKeysRef = useRef('');
  const scrollDrivenPageKeyRef = useRef<string | null>(null);
  const lastAutoScrollTargetKeyRef = useRef<string | null>(null);
  const lastAutoScrollPropKeyRef = useRef<string | null>(null);
  const pendingResizeAnchorRef = useRef<ResizeAnchor | null>(null);
  const lastStableResizeAnchorRef = useRef<ResizeAnchor | null>(null);
  const scrollStateRef = useRef({
    activeGeneratedPageId: props.activeGeneratedPageId,
    onOpenGeneratedPage: props.onOpenGeneratedPage,
    onPageChanged: props.onPageChanged,
    page: props.page,
    scrollEnabled: false,
  });
  const viewabilityConfigRef = useRef({ itemVisiblePercentThreshold: 8, minimumViewTime: 80 });
  const latestViewableItemsChangedRef = useRef((_: { viewableItems: ViewToken<NotebookPage>[] }) => {});
  const stableViewableItemsChangedRef = useRef((info: { viewableItems: ViewToken<NotebookPage>[] }) => {
    latestViewableItemsChangedRef.current(info);
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
  const initialScrollIndexRef = useRef(Math.max(0, Math.min(pageItems.length - 1, PDF_SCROLL_ANCHOR_SNAPSHOTS.get(pdfSourceKey)?.index ?? 0)));
  const initialScrollOffsetRef = useRef(PDF_SCROLL_OFFSET_SNAPSHOTS.get(pdfSourceKey) ?? 0);
  const getPdfRenderCacheKey = useCallback((pageNumber: number) => (
    `${pdfSourceKey}:${pageNumber}:${renderTargetWidth}`
  ), [pdfSourceKey, renderTargetWidth]);
  const getNearestRenderedPdfPage = useCallback((pageNumber: number) => {
    const exactKey = getPdfRenderCacheKey(pageNumber);
    const exactPage = renderedPdfPages[exactKey] ?? cachedRenderedPdfPages[exactKey];
    if (exactPage) return exactPage;

    const prefix = `${pdfSourceKey}:${pageNumber}:`;
    let nearestPage: RenderedPdfPage | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const candidates = { ...cachedRenderedPdfPages, ...renderedPdfPages };

    Object.entries(candidates).forEach(([cacheKey, renderedPage]) => {
      if (!cacheKey.startsWith(prefix)) return;
      const cacheWidth = Number(cacheKey.slice(prefix.length));
      if (!Number.isFinite(cacheWidth)) return;
      const distance = Math.abs(cacheWidth - renderTargetWidth);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPage = renderedPage;
      }
    });

    return nearestPage;
  }, [cachedRenderedPdfPages, getPdfRenderCacheKey, pdfSourceKey, renderedPdfPages, renderTargetWidth]);
  const inkInputLocksScroll = shouldLockScrollForTool(props.inkTool, props.fingerDrawingEnabled);
  const selectionInteractionLocksScroll = props.inkTool === 'select' && Boolean(props.selectionRect);
  const scrollEnabled = !inkInputLocksScroll && !inkGestureActive && !selectionInteractionLocksScroll;
  const [visiblePageKeys, setVisiblePageKeys] = useState<Set<string>>(() => new Set([getNotebookPageKey(pageItems[0])]));
  const visiblePdfPageNumbers = useMemo(() => {
    const pageNumbers: number[] = [];
    pageItems.forEach((page) => {
      if (page.kind !== 'pdf' || !page.pageNumber) return;
      if (!visiblePageKeys.has(getNotebookPageKey(page))) return;
      if (!pageNumbers.includes(page.pageNumber)) pageNumbers.push(page.pageNumber);
    });
    return pageNumbers;
  }, [pageItems, visiblePageKeys]);
  const flatListExtraData = useMemo(() => ({
    activeGeneratedPageId: props.activeGeneratedPageId,
    cachedRenderedPdfPages,
    page: props.page,
    selectionMode: props.selectionMode,
    selectionRect: props.selectionRect,
    pdfSourceKey,
    renderedPdfPages,
    currentStroke,
    draftSelection,
    draftSelectionPath,
    draftSelectionPageKey,
    capturingSelection,
    viewerHeight,
    viewerWidth,
    visiblePageKeys,
  }), [cachedRenderedPdfPages, capturingSelection, currentStroke, draftSelection, draftSelectionPageKey, draftSelectionPath, props.activeGeneratedPageId, props.page, props.selectionMode, props.selectionRect, pdfSourceKey, renderedPdfPages, viewerHeight, viewerWidth, visiblePageKeys]);

  const rememberRenderedPdfPage = useCallback((cacheKey: string, renderedPage: RenderedPdfPage) => {
    setCachedRenderedPdfPages((current) => {
      const existing = current[cacheKey];
      const next = { ...current };
      delete next[cacheKey];
      next[cacheKey] = renderedPage;

      const entries = Object.entries(next);
      while (entries.length > PDF_RENDER_JS_CACHE_LIMIT) {
        const [oldestKey] = entries.shift()!;
        delete next[oldestKey];
      }

      if (
        existing?.uri === renderedPage.uri
        && existing.width === renderedPage.width
        && existing.height === renderedPage.height
        && existing.pageNumber === renderedPage.pageNumber
        && existing.pageCount === renderedPage.pageCount
        && Object.keys(current).length === Object.keys(next).length
      ) {
        return current;
      }
      return next;
    });
  }, []);

  useEffect(() => {
    setLoadError(null);
    setPdfPageSize(null);
    setDocumentPageCount(Math.max(1, props.page));
    reportedDocumentPageCountRef.current = 0;
    pdfRenderGenerationRef.current += 1;
    pdfRenderRequestsRef.current.clear();
    setRenderedPdfPages({});
    setCachedRenderedPdfPages({});
    setVisiblePageKeys(new Set([getNotebookPageKey(pageItems[0])]));
    visiblePageKeysRef.current = '';
    suppressNextAutoScrollRef.current = false;
  }, [pdfSourceKey]);

  const pdfPagesToRender = useMemo(() => {
    const pageNumbers: number[] = [];
    pageItems.forEach((page) => {
      if (page.kind !== 'pdf' || !page.pageNumber) return;
      const pageKey = getNotebookPageKey(page);
      const nearVisiblePage = visiblePdfPageNumbers.some((visiblePageNumber) => (
        Math.abs(page.pageNumber! - visiblePageNumber) <= PDF_RENDER_PAGE_RADIUS
      ));
      if (!visiblePageKeys.has(pageKey) && !nearVisiblePage && !isPdfPageNearCurrent(page, props.page)) return;
      if (!pageNumbers.includes(page.pageNumber)) pageNumbers.push(page.pageNumber);
    });
    return pageNumbers;
  }, [pageItems, props.page, visiblePageKeys, visiblePdfPageNumbers]);

  useEffect(() => {
    if (!pdfPagesToRender.length || renderTargetWidth <= 0) return;
    const generation = pdfRenderGenerationRef.current;
    const renderSource = getPdfRenderSource(props.file);
    if (!renderSource) {
      setLoadError('PDF source URI is unavailable.');
      return;
    }

    pdfPagesToRender.forEach((pageNumber) => {
      const cacheKey = getPdfRenderCacheKey(pageNumber);
      if (renderedPdfPages[cacheKey] || pdfRenderRequestsRef.current.has(cacheKey)) return;

      pdfRenderRequestsRef.current.add(cacheKey);
      void renderPdfPageToImage({ file: renderSource, pageNumber, targetWidth: renderTargetWidth })
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
          rememberRenderedPdfPage(cacheKey, renderedPage);
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
  }, [getPdfRenderCacheKey, pdfPagesToRender, props.file, props.onDocumentLoaded, rememberRenderedPdfPage, renderedPdfPages, renderTargetWidth]);

  useEffect(() => {
    const keysToKeep = new Set<string>();
    pageItems.forEach((page) => {
      if (page.kind !== 'pdf' || !page.pageNumber) return;
      const pageKey = getNotebookPageKey(page);
      const nearVisiblePage = visiblePdfPageNumbers.some((visiblePageNumber) => (
        Math.abs(page.pageNumber! - visiblePageNumber) <= PDF_RENDER_CACHE_RADIUS
      ));
      if (visiblePageKeys.has(pageKey) || nearVisiblePage || Math.abs(page.pageNumber - props.page) <= PDF_RENDER_CACHE_RADIUS) {
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
  }, [getPdfRenderCacheKey, pageItems, props.page, visiblePageKeys, visiblePdfPageNumbers]);

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

  useEffect(() => {
    if (!shouldPreviewPencilHover(props.inkTool)) setPencilHover(null);
  }, [props.inkTool]);

  const clampPointToPage = (page: NotebookPage, x: number, y: number, mode: 'draw' | 'annotate' = 'draw'): InkPoint => ({
    x: Math.max(0, Math.min(viewerWidth - (mode === 'annotate' ? 180 : 0), x)),
    y: Math.max(0, Math.min(viewerHeight - (mode === 'annotate' ? 110 : 0), y)),
    pageNumber: page.pageNumber,
    generatedPageId: page.generatedPageId,
    pageWidth: viewerWidth,
    pageHeight: viewerHeight,
  });

  const isPointInsidePage = (x: number, y: number) => (
    x >= 0 && x <= viewerWidth && y >= 0 && y <= viewerHeight
  );

  const setActiveInkGesture = useCallback((active: boolean) => {
    if (inkGestureActiveRef.current === active) return;
    inkGestureActiveRef.current = active;
    setInkGestureActive(active);
  }, []);

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
    const pageKey = getNotebookPageKey(page);
    scrollDrivenPageKeyRef.current = pageKey;
    suppressNextAutoScrollRef.current = true;
    if (page.generatedPageId) props.onOpenGeneratedPage?.(page.generatedPageId);
    if (page.pageNumber) props.onPageChanged?.(page.pageNumber);
  };

  const syncNotebookPageToParent = useCallback((page: NotebookPage | null | undefined) => {
    if (!page) return;
    const state = scrollStateRef.current;
    const pageKey = getNotebookPageKey(page);
    if (page.generatedPageId && page.generatedPageId !== state.activeGeneratedPageId) {
      scrollDrivenPageKeyRef.current = pageKey;
      suppressNextAutoScrollRef.current = true;
      state.onOpenGeneratedPage?.(page.generatedPageId);
      return;
    }
    if (page.pageNumber && page.pageNumber !== state.page) {
      scrollDrivenPageKeyRef.current = pageKey;
      suppressNextAutoScrollRef.current = true;
      state.onPageChanged?.(page.pageNumber);
    }
  }, []);

  const buildResizeAnchor = useCallback((offsetY: number, viewportHeight: number): ResizeAnchor | null => {
    const itemLength = viewerHeight + pageGap;
    if (!pageItems.length || itemLength <= 0 || viewportHeight <= 0) return null;

    const viewportAnchorOffset = Math.min(viewportHeight * 0.25, viewerHeight * 0.5);
    const anchorY = Math.max(0, offsetY + viewportAnchorOffset);
    const index = Math.max(0, Math.min(pageItems.length - 1, Math.floor(anchorY / itemLength)));
    const pageTop = index * itemLength;
    const ratio = Math.max(0, Math.min(1, (anchorY - pageTop) / itemLength));
    return { index, ratio, viewportAnchorOffset };
  }, [pageGap, pageItems.length, viewerHeight]);

  const rememberStableResizeAnchor = useCallback((anchor: ResizeAnchor | null) => {
    if (!anchor || !pageItems.length) return;
    const nextAnchor = {
      ...anchor,
      index: Math.max(0, Math.min(pageItems.length - 1, anchor.index)),
    };
    lastStableResizeAnchorRef.current = nextAnchor;
    PDF_SCROLL_ANCHOR_SNAPSHOTS.set(pdfSourceKey, nextAnchor);
  }, [pageItems.length, pdfSourceKey]);

  const captureResizeAnchor = useCallback(() => {
    const { offsetY } = scrollMetricsRef.current;
    const viewportHeight = scrollMetricsRef.current.viewportHeight || containerSize.height;
    const measuredAnchor = buildResizeAnchor(offsetY, viewportHeight);
    const stableAnchor = lastStableResizeAnchorRef.current ?? PDF_SCROLL_ANCHOR_SNAPSHOTS.get(pdfSourceKey);
    const anchor = stableAnchor ?? measuredAnchor;
    if (!anchor) return;

    syncNotebookPageToParent(pageItems[anchor.index]);
    pendingResizeAnchorRef.current = anchor;
  }, [buildResizeAnchor, containerSize.height, pageItems, pdfSourceKey, syncNotebookPageToParent]);

  const updateVisiblePagesFromScroll = useCallback((offsetY: number, viewportHeight: number) => {
    if (!pageItems.length || viewportHeight <= 0) return;
    const resizing = Date.now() < resizePageSyncSuppressedUntilRef.current;
    if (resizing && offsetY <= 1 && (lastStableResizeAnchorRef.current?.index ?? 0) > 0) {
      return;
    }
    scrollMetricsRef.current = { offsetY, viewportHeight };

    const itemLength = viewerHeight + pageGap;
    const visibleTop = Math.max(0, offsetY);
    const visibleBottom = Math.max(visibleTop, offsetY + viewportHeight);
    const firstIndex = Math.max(0, Math.floor(visibleTop / itemLength));
    const lastIndex = Math.min(pageItems.length - 1, Math.floor(Math.max(visibleTop, visibleBottom - 1) / itemLength));
    const renderFirstIndex = Math.max(0, firstIndex - PDF_VISIBLE_PAGE_BUFFER);
    const renderLastIndex = Math.min(pageItems.length - 1, lastIndex + PDF_VISIBLE_PAGE_BUFFER);
    const visibleItems = pageItems.slice(firstIndex, lastIndex + 1);
    const renderItems = pageItems.slice(renderFirstIndex, renderLastIndex + 1);
    const currentPage = pageItems.find(isCurrentNotebookPage);
    const renderKeySet = new Set(renderItems.map((page) => getNotebookPageKey(page)));
    if (currentPage) renderKeySet.add(getNotebookPageKey(currentPage));
    const keys = visibleItems.map((page) => getNotebookPageKey(page));
    const renderKeys = Array.from(renderKeySet);
    const joinedKeys = renderKeys.join('|');
    actualVisiblePageKeysRef.current = keys.join('|');

    if (joinedKeys && joinedKeys !== visiblePageKeysRef.current) {
      visiblePageKeysRef.current = joinedKeys;
      setVisiblePageKeys(new Set(renderKeys));
    }

    const pageAnchorY = visibleTop + Math.min(viewportHeight * 0.25, viewerHeight * 0.5);
    const anchorIndex = Math.max(0, Math.min(pageItems.length - 1, Math.floor(pageAnchorY / itemLength)));
    const nextPage = pageItems[anchorIndex] ?? visibleItems[0];
    const stableAnchor = buildResizeAnchor(offsetY, viewportHeight);
    if (stableAnchor && !resizing) rememberStableResizeAnchor(stableAnchor);
    if (resizing) return;
    syncNotebookPageToParent(nextPage);
  }, [buildResizeAnchor, pageGap, pageItems, rememberStableResizeAnchor, syncNotebookPageToParent, viewerHeight]);

  const handleViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: ViewToken<NotebookPage>[] }) => {
    if (Date.now() < resizePageSyncSuppressedUntilRef.current) return;
    const nextVisiblePage = viewableItems
      .filter((item) => item.isViewable && item.item)
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))[0]?.item;
    if (!nextVisiblePage) return;
    const itemLength = viewerHeight + pageGap;
    const viewportHeight = scrollMetricsRef.current.viewportHeight || containerSize.height;
    if (itemLength > 0 && viewportHeight > 0) {
      const index = Math.max(0, pageItems.findIndex((page) => getNotebookPageKey(page) === getNotebookPageKey(nextVisiblePage)));
      const offsetY = Math.max(0, index * itemLength);
      const stableAnchor = buildResizeAnchor(offsetY, viewportHeight);
      if (stableAnchor) rememberStableResizeAnchor(stableAnchor);
    }
    syncNotebookPageToParent(nextVisiblePage);
  }, [buildResizeAnchor, containerSize.height, pageGap, pageItems, rememberStableResizeAnchor, syncNotebookPageToParent, viewerHeight]);

  useEffect(() => {
    latestViewableItemsChangedRef.current = handleViewableItemsChanged;
  }, [handleViewableItemsChanged]);

  useEffect(() => {
    const anchor = pendingResizeAnchorRef.current;
    const viewportHeight = containerSize.height || scrollMetricsRef.current.viewportHeight;
    if (!anchor || !pageItems.length || viewportHeight <= 0) return;

    pendingResizeAnchorRef.current = null;
    const index = Math.max(0, Math.min(pageItems.length - 1, anchor.index));
    const itemLength = viewerHeight + pageGap;
    const viewportAnchorOffset = Math.min(viewportHeight * 0.25, viewerHeight * 0.5);
    const nextOffset = Math.max(0, index * itemLength + anchor.ratio * itemLength - viewportAnchorOffset);

    resizePageSyncSuppressedUntilRef.current = Date.now() + 220;
    PDF_SCROLL_OFFSET_SNAPSHOTS.set(pdfSourceKey, nextOffset);
    scrollMetricsRef.current = { offsetY: nextOffset, viewportHeight };
    syncNotebookPageToParent(pageItems[index]);

    requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: nextOffset, animated: false });
    });
  }, [containerSize.height, containerSize.width, pageGap, pageItems, pdfSourceKey, syncNotebookPageToParent, viewerHeight]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetY = event.nativeEvent.contentOffset.y;
    const viewportHeight = event.nativeEvent.layoutMeasurement.height;
    PDF_SCROLL_OFFSET_SNAPSHOTS.set(pdfSourceKey, offsetY);
    updateVisiblePagesFromScroll(offsetY, viewportHeight);
    if (!pageIndicatorVisibleRef.current) {
      pageIndicatorVisibleRef.current = true;
      setPageIndicatorVisible(true);
    }
    if (pageIndicatorTimeoutRef.current) clearTimeout(pageIndicatorTimeoutRef.current);
    pageIndicatorTimeoutRef.current = setTimeout(() => {
      pageIndicatorVisibleRef.current = false;
      setPageIndicatorVisible(false);
    }, 900);
  }, [pdfSourceKey, updateVisiblePagesFromScroll]);

  const handleScrollSettled = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    handleScroll(event);
  }, [handleScroll]);

  useEffect(() => () => {
    if (pageIndicatorTimeoutRef.current) clearTimeout(pageIndicatorTimeoutRef.current);
    if (layoutResizeTimeoutRef.current) clearTimeout(layoutResizeTimeoutRef.current);
    pageIndicatorVisibleRef.current = false;
  }, []);

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

  const shouldRenderPdfContent = useCallback((page: NotebookPage) => (
    page.kind === 'pdf' && Boolean(page.pageNumber)
  ), []);

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
    const currentPage = pageItems[currentIndex];
    const currentKey = getNotebookPageKey(currentPage);
    const propPageChanged = lastAutoScrollPropKeyRef.current !== currentKey;
    const actualVisibleKeys = actualVisiblePageKeysRef.current
      ? actualVisiblePageKeysRef.current.split('|')
      : [];
    const pageChangedFromScroll = scrollDrivenPageKeyRef.current === currentKey;

    if (!propPageChanged) {
      if (suppressNextAutoScrollRef.current) suppressNextAutoScrollRef.current = false;
      return;
    }
    if (pageChangedFromScroll || actualVisibleKeys.includes(currentKey)) {
      if (pageChangedFromScroll) scrollDrivenPageKeyRef.current = null;
      lastAutoScrollTargetKeyRef.current = currentKey;
      lastAutoScrollPropKeyRef.current = currentKey;
      if (suppressNextAutoScrollRef.current) suppressNextAutoScrollRef.current = false;
      return;
    }
    if (lastAutoScrollTargetKeyRef.current === currentKey) {
      lastAutoScrollPropKeyRef.current = currentKey;
      return;
    }
    if (suppressNextAutoScrollRef.current) {
      suppressNextAutoScrollRef.current = false;
      lastAutoScrollTargetKeyRef.current = currentKey;
      lastAutoScrollPropKeyRef.current = currentKey;
      return;
    }
    const stableAnchor = lastStableResizeAnchorRef.current ?? PDF_SCROLL_ANCHOR_SNAPSHOTS.get(pdfSourceKey);
    if (
      currentIndex === 0
      && stableAnchor
      && stableAnchor.index > 0
    ) {
      syncNotebookPageToParent(pageItems[stableAnchor.index]);
      lastAutoScrollTargetKeyRef.current = getNotebookPageKey(pageItems[stableAnchor.index]);
      lastAutoScrollPropKeyRef.current = getNotebookPageKey(pageItems[stableAnchor.index]);
      return;
    }
    lastAutoScrollTargetKeyRef.current = currentKey;
    lastAutoScrollPropKeyRef.current = currentKey;
    listRef.current?.scrollToIndex({ index: currentIndex, animated: false });
  }, [pdfSourceKey, props.activeGeneratedPageId, props.page, pageItems, syncNotebookPageToParent]);

  const renderPage = (page: NotebookPage) => {
    const currentPage = isCurrentNotebookPage(page);
    const pageKey = getNotebookPageKey(page);
    const visiblePage = visiblePageKeys.has(pageKey);
    const shouldRenderInteractiveLayers = shouldRenderPageLayers(page, currentPage, visiblePage);
    const pageStrokesForView = shouldRenderInteractiveLayers ? getPageStrokesForView(page) : [];
    const pageTextAnnotationsForView = shouldRenderInteractiveLayers ? getPageTextAnnotationsForView(page) : [];
    const shouldRenderPdfPage = shouldRenderPdfContent(page);
    const renderedPdfPage = page.pageNumber ? getNearestRenderedPdfPage(page.pageNumber) : null;
    const pageReferences = shouldRenderInteractiveLayers ? getPageCaptureReferences(page) : [];
    const activePageReference = pageReferences.find((reference) => reference.id === openReferenceId) ?? null;
    const activeReferenceIndex = activePageReference ? pageReferences.findIndex((reference) => reference.id === activePageReference.id) : -1;
    const incomingAsset = currentPage ? props.incomingAssetSuggestion : null;
    const selectionForPage = isSelectionOnNotebookPage(props.selectionRect, page, currentPage)
      ? scaleSelectionRectToPageSize(props.selectionRect, viewerWidth, viewerHeight)
      : null;
    const askAiAboutSelectionForPage = async () => {
      if (!selectionForPage) {
        props.onAskAiAboutSelection?.();
        return;
      }

      const token = selectionPreviewTokenRef.current + 1;
      selectionPreviewTokenRef.current = token;
      props.onSelectionPreviewChange?.(null);
      const uri = await buildSelectionPreview(page, selectionForPage);
      if (selectionPreviewTokenRef.current !== token) return;
      if (uri) props.onSelectionPreviewChange?.(uri);
      props.onAskAiAboutSelection?.(uri ?? null);
    };
    const eraseAtPoint = (point: InkPoint) => {
      const radius = getPencilEraserRadius(props.eraserWidth ?? props.penWidth, props.eraserMode ?? 'partial');
      if (props.onEraseInkAtPoint) {
        const changed = props.onEraseInkAtPoint(point, radius, !eraserSnapshotPushedRef.current, props.eraserMode ?? 'partial');
        if (changed) eraserSnapshotPushedRef.current = true;
        return;
      }
      const hitSourceStrokes = (pageStrokesForView.length ? pageStrokesForView : getPageStrokesForView(page)).filter((stroke) => !erasedStrokeIdsRef.current.has(stroke.id));
      const hitStrokeId = findHitInkStrokeId(hitSourceStrokes, point, radius);
      if (hitStrokeId) {
        erasedStrokeIdsRef.current.add(hitStrokeId);
        props.onRemoveInkStroke(hitStrokeId);
      }
    };

    const handleInkGestureStart = (x: number, y: number) => {
      if (!isPointInsidePage(x, y)) return;
      const point = clampPointToPage(page, x, y, props.inkTool === 'text' ? 'annotate' : 'draw');
      if (props.inkTool === 'select') {
        const selectionOnPage = isSelectionOnNotebookPage(props.selectionRect, page, isCurrentNotebookPage(page));
        const currentSelection = selectionOnPage ? scaleSelectionRectToPageSize(props.selectionRect, viewerWidth, viewerHeight) : null;
        if (currentSelection && isPointInSelectionContextMenu(point, currentSelection, viewerWidth, viewerHeight)) return;
      }

      activeInkGesturePageKeyRef.current = pageKey;
      setActiveInkGesture(true);
      beginInteraction(page);

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
        const pageKey = getNotebookPageKey(page);
        const selectionOnPage = isSelectionOnNotebookPage(props.selectionRect, page, isCurrentNotebookPage(page));
        const currentSelection = selectionOnPage ? scaleSelectionRectToPageSize(props.selectionRect, viewerWidth, viewerHeight) : null;
        const resizeCorner = getResizeCorner(currentSelection, point);
        if (currentSelection && resizeCorner) {
          draftSelectionPageKeyRef.current = pageKey;
          setDraftSelectionPageKey(pageKey);
          selectionResizeCornerRef.current = resizeCorner;
          selectionResizeStartRectRef.current = currentSelection;
          draftSelectionRef.current = currentSelection;
          draftSelectionPathRef.current = [];
          setDraftSelectionPath([]);
          setDraftSelection(currentSelection);
          return;
        }
        if (
          currentSelection &&
          isPointInSelectionShape(point, currentSelection)
        ) {
          draftSelectionPageKeyRef.current = pageKey;
          setDraftSelectionPageKey(pageKey);
          selectionMoveOriginRef.current = point;
          selectionMoveStartRectRef.current = currentSelection;
          draftSelectionRef.current = currentSelection;
          draftSelectionPathRef.current = [];
          setDraftSelectionPath([]);
          setDraftSelection(currentSelection);
          return;
        }
        selectionPreviewTokenRef.current += 1;
        props.onSelectionChange(null);
        props.onSelectionPreviewChange?.(null);
        draftSelectionPageKeyRef.current = pageKey;
        setDraftSelectionPageKey(pageKey);
        selectionOriginRef.current = point;
        const selectionMode = props.selectionMode ?? 'rect';
        const initialPath = selectionMode === 'lasso' ? [point] : [];
        draftSelectionPathRef.current = initialPath;
        setDraftSelectionPath(initialPath);
        const rect = {
          x: point.x,
          y: point.y,
          width: 0,
          height: 0,
          mode: selectionMode,
          pageNumber: point.pageNumber,
          generatedPageId: point.generatedPageId,
          pageWidth: point.pageWidth,
          pageHeight: point.pageHeight,
        };
        draftSelectionRef.current = rect;
        setDraftSelection(rect);
        return;
      }

      if (props.inkTool === 'text') {
        textTapRef.current = point;
        return;
      }

      if (props.inkTool === 'erase') {
        eraserSnapshotPushedRef.current = false;
        erasedStrokeIdsRef.current.clear();
        eraseAtPoint(point);
      }
    };

    const handleInkGestureMove = (x: number, y: number) => {
      if (activeInkGesturePageKeyRef.current !== pageKey) return;
      if (!isPointInsidePage(x, y)) return;
      const point = clampPointToPage(page, x, y);

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

      if (props.inkTool === 'erase') {
        eraseAtPoint(point);
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
          const dx = point.x - moveOrigin.x;
          const dy = point.y - moveOrigin.y;
          const rect = {
            ...moveStartRect,
            x: moveStartRect.x + dx,
            y: moveStartRect.y + dy,
            path: moveStartRect.path?.map((pathPoint) => ({
              ...pathPoint,
              x: pathPoint.x + dx,
              y: pathPoint.y + dy,
              pageWidth: point.pageWidth,
              pageHeight: point.pageHeight,
            })),
            pageWidth: point.pageWidth,
            pageHeight: point.pageHeight,
          };
          draftSelectionRef.current = rect;
          setDraftSelection(rect);
          return;
        }
        const origin = selectionOriginRef.current;
        if (!origin) return;
        if ((props.selectionMode ?? 'rect') === 'rect') {
          const rect = getSelectionRectFromDrag(origin, point);
          draftSelectionRef.current = rect;
          setDraftSelection(rect);
          return;
        }
        const currentPath = draftSelectionPathRef.current;
        const lastPoint = currentPath[currentPath.length - 1];
        const nextPath = !lastPoint || Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) > 5
          ? [...currentPath, point]
          : currentPath;
        draftSelectionPathRef.current = nextPath;
        setDraftSelectionPath(nextPath);
        const rect = getSelectionRectFromPoints(nextPath) ?? getSelectionRectFromDrag(origin, point);
        draftSelectionRef.current = rect;
        setDraftSelection(rect);
      }
    };

    const handleInkGestureEnd = () => {
      const stroke = currentStrokeRef.current;
      if (stroke && stroke.points.length > 1) props.onCommitInkStroke(finalizeInkStroke(stroke));

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
        draftSelectionPageKeyRef.current = null;
        draftSelectionPathRef.current = [];
        setDraftSelection(null);
        setDraftSelectionPageKey(null);
        setDraftSelectionPath([]);
        if (rect && resizeCorner && resizeStartRect) {
          props.onResizeSelection?.(rect);
          props.onSelectionPreviewChange?.(null);
          selectionPreviewTokenRef.current += 1;
        } else if (rect && moveOrigin && moveStartRect) {
          const dx = rect.x - moveStartRect.x;
          const dy = rect.y - moveStartRect.y;
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) props.onMoveSelection?.(dx, dy);
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            props.onSelectionPreviewChange?.(null);
            selectionPreviewTokenRef.current += 1;
          }
        } else if (rect && rect.width > 24 && rect.height > 24) {
          props.onSelectionChange(rect);
          props.onSelectionPreviewChange?.(null);
          const token = selectionPreviewTokenRef.current + 1;
          selectionPreviewTokenRef.current = token;
          void buildSelectionPreview(page, rect).then((uri) => {
            if (selectionPreviewTokenRef.current !== token) return;
            props.onSelectionPreviewChange?.(uri);
          });
        }
      }

      if (props.inkTool === 'text' && textTapRef.current) props.onAddTextAnnotation(textTapRef.current);
      eraserSnapshotPushedRef.current = false;
      erasedStrokeIdsRef.current.clear();
      currentStrokeRef.current = null;
      textTapRef.current = null;
      activeInkGesturePageKeyRef.current = null;
      setCurrentStroke(null);
      setActiveInkGesture(false);
    };

    const handleInkGestureCancel = () => {
      const stroke = currentStrokeRef.current;
      if (stroke && stroke.points.length > 1) props.onCommitInkStroke(finalizeInkStroke(stroke));
      currentStrokeRef.current = null;
      draftSelectionRef.current = null;
      draftSelectionPageKeyRef.current = null;
      draftSelectionPathRef.current = [];
      selectionOriginRef.current = null;
      selectionMoveOriginRef.current = null;
      selectionMoveStartRectRef.current = null;
      selectionResizeCornerRef.current = null;
      selectionResizeStartRectRef.current = null;
      textTapRef.current = null;
      activeInkGesturePageKeyRef.current = null;
      eraserSnapshotPushedRef.current = false;
      erasedStrokeIdsRef.current.clear();
      setDraftSelection(null);
      setDraftSelectionPageKey(null);
      setDraftSelectionPath([]);
      setCurrentStroke(null);
      setActiveInkGesture(false);
    };

    const gestureInkTool = props.inkTool;
    const gestureFingerDrawingEnabled = props.fingerDrawingEnabled;
    const inkGesture = Gesture.Pan()
      .enabled(gestureInkTool !== 'view')
      .manualActivation(true)
      .minDistance(0)
      .shouldCancelWhenOutside(false)
      .cancelsTouchesInView(false)
      .onTouchesDown((event: NativeInkTouchEvent, state: NativeGestureStateManager) => {
        'worklet';
        if (shouldActivateNativeInkGesture(gestureInkTool, event, gestureFingerDrawingEnabled)) {
          state.activate();
        } else {
          state.fail();
        }
      })
      .onStart((event: NativeInkGestureEvent) => {
        'worklet';
        runOnJS(handleInkGestureStart)(event.x, event.y);
      })
      .onUpdate((event: NativeInkGestureEvent) => {
        'worklet';
        runOnJS(handleInkGestureMove)(event.x, event.y);
      })
      .onEnd(() => {
        'worklet';
        runOnJS(handleInkGestureEnd)();
      })
      .onFinalize((_, success) => {
        'worklet';
        if (!success) runOnJS(handleInkGestureCancel)();
      });
    const handlePencilHoverMove = (event: unknown) => {
      if (!shouldPreviewPencilHover(props.inkTool) || !isStylusHoverEvent(event)) return;
      const point = getPencilHoverPoint(event);
      if (!point || !isPointInsidePage(point.x, point.y)) return;
      setPencilHover({ pageKey, ...point });
    };
    const hoverHandlers = {
      onPointerEnter: handlePencilHoverMove,
      onPointerMove: handlePencilHoverMove,
      onPointerLeave: () => setPencilHover((current) => (current?.pageKey === pageKey ? null : current)),
      onPointerCancel: () => setPencilHover((current) => (current?.pageKey === pageKey ? null : current)),
    } as any;
    const hoverSize = getPencilHoverSize(props.inkTool, props.inkTool === 'erase' ? props.eraserWidth ?? props.penWidth : props.penWidth, props.eraserMode ?? 'partial');
    const hoverVisible = pencilHover?.pageKey === pageKey && shouldPreviewPencilHover(props.inkTool);
    const hoverToolLabel = getPencilHoverToolLabel(props.inkTool, props.eraserMode ?? 'partial');

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

        <GestureDetector gesture={inkGesture}>
          <View {...hoverHandlers} pointerEvents={props.inkTool === 'view' ? 'none' : 'auto'} style={props.styles.inkOverlay} />
        </GestureDetector>

        {shouldRenderInteractiveLayers ? (
          <PdfInkLayers
            page={page}
            currentPage={currentPage}
            pageStrokes={pageStrokesForView}
            pageTextAnnotations={pageTextAnnotationsForView}
            currentStroke={currentStroke}
            selectionForView={selectionForPage}
            draftForView={draftSelectionPageKey === pageKey ? draftSelection : null}
            draftLassoForView={draftSelectionPageKey === pageKey ? draftSelectionPath : []}
            draftRectForView={draftSelectionPageKey === pageKey && draftSelection?.mode !== 'lasso' ? draftSelection : null}
            capturingSelection={capturingSelection}
            viewerWidth={viewerWidth}
            viewerHeight={viewerHeight}
            styles={props.styles}
            textAnnotationVariant={props.textAnnotationVariant}
            onUpdateTextAnnotation={props.onUpdateTextAnnotation}
            onMoveTextAnnotation={props.onMoveTextAnnotation}
            onResizeTextAnnotation={props.onResizeTextAnnotation}
            onRemoveTextAnnotation={props.onRemoveTextAnnotation}
            onAskAiAboutSelection={askAiAboutSelectionForPage}
            onDuplicateSelection={props.onDuplicateSelection}
            onDeleteSelection={props.onDeleteSelection}
            onChangeSelectedStrokesColor={props.onChangeSelectedStrokesColor}
          />
        ) : null}
        {!capturingSelection && selectionForPage ? (
          <PdfSelectionMoveHandle
            selection={selectionForPage}
            inkTool={props.inkTool}
            pageWidth={viewerWidth}
            pageHeight={viewerHeight}
            scrollEnabled={scrollEnabled}
            setNativeScrollEnabled={(enabled) => {
              (listRef.current as any)?.setNativeProps?.({ scrollEnabled: enabled });
              (listRef.current as any)?.getNativeScrollRef?.()?.setNativeProps?.({ scrollEnabled: enabled });
              scrollStateRef.current.scrollEnabled = enabled;
            }}
            onBegin={(selection) => {
              draftSelectionPageKeyRef.current = pageKey;
              setDraftSelectionPageKey(pageKey);
              selectionMoveStartRectRef.current = selection;
              draftSelectionRef.current = selection;
              draftSelectionPathRef.current = [];
              setDraftSelectionPath([]);
              setDraftSelection(selection);
            }}
            onMove={(selection) => {
              draftSelectionRef.current = selection;
              setDraftSelection(selection);
            }}
            onCommit={(dx, dy) => {
              props.onMoveSelection?.(dx, dy);
              props.onSelectionPreviewChange?.(null);
              selectionPreviewTokenRef.current += 1;
            }}
            onCancel={() => {
              selectionMoveStartRectRef.current = null;
              draftSelectionRef.current = null;
              draftSelectionPageKeyRef.current = null;
              draftSelectionPathRef.current = [];
              setDraftSelection(null);
              setDraftSelectionPageKey(null);
              setDraftSelectionPath([]);
            }}
          />
        ) : null}

        <PdfPageReferenceCluster
          references={pageReferences}
          activeReference={activePageReference}
          styles={props.styles}
          onToggleFirstReference={() => setOpenReferenceId((current) => (current === pageReferences[0]?.id ? null : pageReferences[0]?.id ?? null))}
        />
        <PdfPageReferencePopover
          reference={activePageReference}
          references={pageReferences}
          activeReferenceIndex={activeReferenceIndex}
          styles={props.styles}
          onClose={() => setOpenReferenceId(null)}
          onSelectReference={setOpenReferenceId}
          onAskAiAboutPageCaptureReference={props.onAskAiAboutPageCaptureReference}
        />
        <PdfIncomingCapturePopover
          incomingAsset={incomingAsset ?? null}
          styles={props.styles}
          onAcceptIncomingAsset={props.onAcceptIncomingAsset}
          onArchiveIncomingAsset={props.onArchiveIncomingAsset}
          onDismissIncomingAsset={props.onDismissIncomingAsset}
        />

        {hoverVisible ? (
          <PencilHoverOverlay
            x={pencilHover.x}
            y={pencilHover.y}
            size={hoverSize}
            pageWidth={viewerWidth}
            pageHeight={viewerHeight}
            borderColor={props.inkTool === 'erase' ? '#EF4444' : props.penColor}
            label={hoverToolLabel}
            isEraser={props.inkTool === 'erase'}
            activeTool={props.inkTool}
            styles={props.styles}
            onSelectTool={props.onChangeInkTool}
          />
        ) : null}
      </View>
    );
  };

  const floatingNotebookPage = pageItems.find(isCurrentNotebookPage);
  const floatingPageBaseLabel = floatingNotebookPage?.kind === 'pdf'
    ? `${floatingNotebookPage.pageNumber ?? props.page}`
    : (floatingNotebookPage?.label || `${floatingNotebookPage?.insertAfterPage ?? props.page}-1`).replace(/\s*(메모|AI 정리|페이지)$/g, '').trim();
  const floatingPageIndicatorLabel = `${floatingPageBaseLabel || props.page} / ${documentPageCount}`;

  return (
    <View
      style={props.styles.pdfViewerCard}
      onLayout={(event) => {
        const nextWidth = Math.floor(event.nativeEvent.layout.width);
        const nextHeight = Math.floor(event.nativeEvent.layout.height);
        if (!containerSize.width || !containerSize.height) {
          setContainerSize({ width: nextWidth, height: nextHeight });
          return;
        }

        const widthChanged = nextWidth !== containerSize.width;
        const heightChanged = nextHeight !== containerSize.height;
        if (!widthChanged && !heightChanged) return;

        captureResizeAnchor();
        if (layoutResizeTimeoutRef.current) clearTimeout(layoutResizeTimeoutRef.current);
        layoutResizeTimeoutRef.current = null;
        setContainerSize({ width: nextWidth, height: nextHeight });
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
        bounces={false}
        alwaysBounceVertical={false}
        directionalLockEnabled
        overScrollMode="never"
        onScroll={handleScroll}
        onScrollEndDrag={handleScrollSettled}
        onMomentumScrollEnd={handleScrollSettled}
        onViewableItemsChanged={stableViewableItemsChangedRef.current}
        viewabilityConfig={viewabilityConfigRef.current}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator
        contentOffset={initialScrollOffsetRef.current > 0 ? { x: 0, y: initialScrollOffsetRef.current } : undefined}
        initialScrollIndex={initialScrollOffsetRef.current > 0 ? undefined : initialScrollIndexRef.current > 0 ? initialScrollIndexRef.current : undefined}
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        updateCellsBatchingPeriod={16}
        windowSize={7}
        removeClippedSubviews={false}
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
      {pageIndicatorVisible ? (
        <View pointerEvents="none" style={props.styles.pdfFloatingPageIndicator}>
          <Text style={props.styles.pdfFloatingPageText}>{floatingPageIndicatorLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}
