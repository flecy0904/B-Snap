import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { FlatList, Image, NativeScrollEvent, NativeSyntheticEvent, Platform, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import { InkPath } from '../canvas/ink-path';
import { TextAnnotationLayer } from '../canvas/text-annotation-layer';
import { getPencilHoverPoint, getPencilHoverSize, getPencilHoverToolLabel, isStylusHoverEvent, shouldPreviewPencilHover, type PencilHoverPoint } from '../canvas/native-pencil-hover';
import { shouldActivateNativeInkGesture, type NativeGestureStateManager, type NativeInkGestureEvent, type NativeInkTouchEvent } from '../canvas/native-ink-gesture-policy';
import { getCaptureOriginalImageSource, getPageCaptureReferenceImageSource } from '../shared/capture-assets';
import { AndroidNativePdfViewport } from './android-native-pdf-viewport';
import { cleanAiDisplayText, finalizeInkStroke, findHitInkStrokeId, isDrawingTool, isShapeTool, resolveInkStrokeAppearance, resolveShapeStrokeAppearance, scaleInkStrokeToPageSize, scaleSelectionRectToPageSize, scaleTextAnnotationToPageSize, shouldAppendInkPoint } from '../../../ui-helpers';
import { InkBrush, InkBrushSettings, InkLinePattern, InkPoint, InkSelectionMode, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { CaptureAsset, NotebookPage, PageCaptureReference } from '../../../types';
import { renderPdfPageToImage, type PdfRenderSource, type RenderedPdfPage } from '../../../services/pdf-page-renderer';
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
const PDF_RENDER_PAGE_RADIUS = 3;
const PDF_RENDER_CACHE_RADIUS = 3;
const PDF_RENDER_JS_CACHE_LIMIT = 11;

function shouldLockScrollForTool(tool: InkTool, fingerDrawingEnabled: boolean | undefined) {
  return tool === 'text'
    || Boolean(fingerDrawingEnabled && isDrawingTool(tool));
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

function isPdfPageNearCurrent(page: NotebookPage, currentPageNumber: number) {
  return page.kind === 'pdf'
    && typeof page.pageNumber === 'number'
    && Math.abs(page.pageNumber - currentPageNumber) <= PDF_RENDER_PAGE_RADIUS;
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

function AdaptiveReferenceImage(props: {
  source: any;
  frameStyle: any;
  imageStyle: any;
  minHeight?: number;
  maxHeight?: number;
}) {
  const [frameWidth, setFrameWidth] = useState(0);
  const [aspectRatio, setAspectRatio] = useState<number | null>(null);
  const minHeight = props.minHeight ?? 220;
  const maxHeight = props.maxHeight ?? 430;
  const dynamicHeight = frameWidth > 0 && aspectRatio
    ? Math.round(Math.max(minHeight, Math.min(maxHeight, frameWidth / aspectRatio)))
    : undefined;

  return (
    <View
      style={[props.frameStyle, dynamicHeight ? { height: dynamicHeight } : null]}
      onLayout={(event) => setFrameWidth(Math.round(event.nativeEvent.layout.width))}
    >
      <Image
        source={props.source}
        style={props.imageStyle}
        resizeMode="contain"
        fadeDuration={0}
        onLoad={(event) => {
          const source = (event.nativeEvent as any)?.source ?? {};
          const width = Number(source.width);
          const height = Number(source.height);
          if (width > 0 && height > 0) setAspectRatio(width / height);
        }}
      />
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
    pageWidth: point.pageWidth,
    pageHeight: point.pageHeight,
  };
}

function getLassoPath(points: InkPoint[]) {
  if (!points.length) return '';
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
}

function SelectionOverlay(props: { rect: SelectionRect; styles: any; draft?: boolean }) {
  const handleOffset = -7;
  const lassoPath = props.rect.path && props.rect.path.length > 2 ? getLassoPath(props.rect.path) : '';
  if (props.rect.mode === 'lasso') {
    if (!lassoPath) return null;
    return (
      <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
        <Path
          d={`${lassoPath} Z`}
          fill="rgba(78, 141, 255, 0.06)"
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

function SelectionLassoOverlay(props: { points: InkPoint[] }) {
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

export function PdfPreview(props: {
  file: number | string | { uri: string };
  page: number;
  inkTool: InkTool;
  fingerDrawingEnabled?: boolean;
  penColor: string;
  penWidth: number;
  brushType: InkBrush;
  linePattern: InkLinePattern;
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
  onEraseInkAtPoint?: (point: InkPoint, radius: number, snapshot?: boolean) => boolean;
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
  if (Platform.OS === 'android') {
    return (
      <View style={props.styles.pdfViewerCard}>
        <AndroidNativePdfViewport
          file={props.file}
          page={props.page}
          inkTool={props.inkTool}
          fingerDrawingEnabled={props.fingerDrawingEnabled}
          penColor={props.penColor}
          penWidth={props.penWidth}
          brushType={props.brushType}
          linePattern={props.linePattern}
          selectionMode={props.selectionMode}
          brushSettings={props.brushSettings}
          inkStrokes={props.inkStrokes}
          textAnnotations={props.textAnnotations}
          textAnnotationVariant={props.textAnnotationVariant}
          selectionRect={props.selectionRect}
          notebookPages={props.notebookPages}
          activeGeneratedPageId={props.activeGeneratedPageId}
          pageCaptureReferences={props.pageCaptureReferences}
          incomingAssetSuggestion={props.incomingAssetSuggestion}
          onCommitInkStroke={props.onCommitInkStroke}
          onRemoveInkStroke={props.onRemoveInkStroke}
          onAddTextAnnotation={props.onAddTextAnnotation}
          onUpdateTextAnnotation={props.onUpdateTextAnnotation}
          onRemoveTextAnnotation={props.onRemoveTextAnnotation}
          onMoveTextAnnotation={props.onMoveTextAnnotation}
          onResizeTextAnnotation={props.onResizeTextAnnotation}
          onSelectionChange={props.onSelectionChange}
          onMoveSelection={props.onMoveSelection}
          onResizeSelection={props.onResizeSelection}
          onSelectionPreviewChange={props.onSelectionPreviewChange}
          onAcceptIncomingAsset={props.onAcceptIncomingAsset}
          onArchiveIncomingAsset={props.onArchiveIncomingAsset}
          onDismissIncomingAsset={props.onDismissIncomingAsset}
          onOpenPageCaptureReference={props.onOpenPageCaptureReference}
          onAskAiAboutPageCaptureReference={props.onAskAiAboutPageCaptureReference}
          onPageChanged={props.onPageChanged}
          onDocumentLoaded={props.onDocumentLoaded}
          styles={props.styles}
          style={{ alignSelf: 'stretch', flex: 1, width: '100%' }}
        />
      </View>
    );
  }

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
  const viewerWidth = baseViewerWidth;
  const [pdfPageSize, setPdfPageSize] = useState<{ width: number; height: number } | null>(null);
  const pageAspectRatio = pdfPageSize ? Math.max(0.45, Math.min(3.2, pdfPageSize.width / pdfPageSize.height)) : 16 / 9;
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
  const selectionPreviewTokenRef = useRef(0);
  const eraserSnapshotPushedRef = useRef(false);
  const erasedStrokeIdsRef = useRef<Set<string>>(new Set());
  const textTapRef = useRef<InkPoint | null>(null);
  const pageCaptureRefs = useRef<Record<string, View | null>>({});
  const listRef = useRef<FlatList<NotebookPage> | null>(null);
  const pageIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pageIndicatorVisibleRef = useRef(false);
  const inkGestureActiveRef = useRef(false);
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
    `${pdfSourceKey}:${pageNumber}:${Math.round(baseViewerWidth)}`
  ), [baseViewerWidth, pdfSourceKey]);
  const inkInputLocksScroll = shouldLockScrollForTool(props.inkTool, props.fingerDrawingEnabled);
  const scrollEnabled = !inkInputLocksScroll && !inkGestureActive;
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
    if (!pdfPagesToRender.length || baseViewerWidth <= 0) return;
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
      void renderPdfPageToImage({ file: renderSource, pageNumber, targetWidth: baseViewerWidth })
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
  }, [baseViewerWidth, getPdfRenderCacheKey, pdfPagesToRender, props.file, props.onDocumentLoaded, rememberRenderedPdfPage, renderedPdfPages]);

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
    if (page.generatedPageId) props.onOpenGeneratedPage?.(page.generatedPageId);
    if (page.pageNumber) props.onPageChanged?.(page.pageNumber);
  };

  const updateVisiblePagesFromScroll = useCallback((offsetY: number, viewportHeight: number) => {
    if (!pageItems.length || viewportHeight <= 0) return;

    const itemLength = viewerHeight + pageGap;
    const visibleTop = Math.max(0, offsetY);
    const visibleBottom = Math.max(visibleTop, offsetY + viewportHeight);
    const firstIndex = Math.max(0, Math.floor(visibleTop / itemLength));
    const lastIndex = Math.min(pageItems.length - 1, Math.floor(Math.max(visibleTop, visibleBottom - 1) / itemLength));
    const visibleItems = pageItems.slice(firstIndex, lastIndex + 1);
    const keys = visibleItems.map((page) => getNotebookPageKey(page));
    const joinedKeys = keys.join('|');

    if (joinedKeys && joinedKeys !== visiblePageKeysRef.current) {
      visiblePageKeysRef.current = joinedKeys;
      setVisiblePageKeys(new Set(keys));
    }

    const state = scrollStateRef.current;
    if (!state.scrollEnabled) return;

    const viewportCenter = visibleTop + viewportHeight / 2;
    const centerIndex = Math.max(0, Math.min(pageItems.length - 1, Math.floor(viewportCenter / itemLength)));
    const nextPage = pageItems[centerIndex] ?? visibleItems[0];
    if (nextPage?.generatedPageId && nextPage.generatedPageId !== state.activeGeneratedPageId) {
      suppressNextAutoScrollRef.current = true;
      state.onOpenGeneratedPage?.(nextPage.generatedPageId);
    }
    if (nextPage?.pageNumber && nextPage.pageNumber !== state.page) {
      suppressNextAutoScrollRef.current = true;
      state.onPageChanged?.(nextPage.pageNumber);
    }
  }, [pageGap, pageItems, viewerHeight]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    updateVisiblePagesFromScroll(event.nativeEvent.contentOffset.y, event.nativeEvent.layoutMeasurement.height);
    if (!pageIndicatorVisibleRef.current) {
      pageIndicatorVisibleRef.current = true;
      setPageIndicatorVisible(true);
    }
    if (pageIndicatorTimeoutRef.current) clearTimeout(pageIndicatorTimeoutRef.current);
    pageIndicatorTimeoutRef.current = setTimeout(() => {
      pageIndicatorVisibleRef.current = false;
      setPageIndicatorVisible(false);
    }, 900);
  }, [updateVisiblePagesFromScroll]);

  useEffect(() => () => {
    if (pageIndicatorTimeoutRef.current) clearTimeout(pageIndicatorTimeoutRef.current);
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
  }, [props.activeGeneratedPageId, props.page, pageItems]);

  const renderInkLayers = (page: NotebookPage, pageStrokes: InkStroke[], pageTextAnnotations: InkTextAnnotation[], currentPage: boolean) => {
    const selectionForView = currentPage ? scaleSelectionRectToPageSize(props.selectionRect, viewerWidth, viewerHeight) : null;
    const pageKey = getNotebookPageKey(page);
    const draftForView = draftSelectionPageKey === pageKey ? draftSelection : null;
    const draftLassoForView = draftSelectionPageKey === pageKey ? draftSelectionPath : [];
    const draftRectForView = draftForView?.mode === 'lasso' ? null : draftForView;
    const hasHighlight = pageStrokes.some((stroke) => stroke.style === 'highlight') || ((page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) && currentStroke?.style === 'highlight');
    const hasInk = pageStrokes.some((stroke) => stroke.style !== 'highlight') || ((page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) && currentStroke?.style !== 'highlight' && currentStroke);
    const hasTextAnnotations = pageTextAnnotations.length > 0;
    if (!hasHighlight && !hasInk && !hasTextAnnotations && !selectionForView && !draftForView && draftLassoForView.length < 2) return null;

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
            onMove={props.onMoveTextAnnotation}
            onResize={props.onResizeTextAnnotation}
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
        {!capturingSelection && draftLassoForView.length > 1 ? <SelectionLassoOverlay points={draftLassoForView} /> : null}
        {!capturingSelection && draftRectForView ? <SelectionOverlay rect={draftRectForView} styles={props.styles} draft /> : null}
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
    const renderedPdfPage = page.pageNumber
      ? renderedPdfPages[getPdfRenderCacheKey(page.pageNumber)] ?? cachedRenderedPdfPages[getPdfRenderCacheKey(page.pageNumber)]
      : null;
    const pageReferences = shouldRenderInteractiveLayers ? getPageCaptureReferences(page) : [];
    const activePageReference = pageReferences.find((reference) => reference.id === openReferenceId) ?? null;
    const activeReferenceIndex = activePageReference ? pageReferences.findIndex((reference) => reference.id === activePageReference.id) : -1;
    const activeReferenceImage = activePageReference ? getPageCaptureReferenceImageSource(activePageReference) : null;
    const imageReferenceCount = pageReferences.filter((reference) => reference.type === 'image').length;
    const referenceButtonLabel = imageReferenceCount > 0 ? `사진 ${imageReferenceCount}` : `자료 ${pageReferences.length}`;
    const incomingAsset = currentPage ? props.incomingAssetSuggestion : null;
    const incomingAssetImage = incomingAsset ? getCaptureOriginalImageSource(incomingAsset) : null;
    const incomingAssetSummary = getCaptureAssetSummary(incomingAsset);
    const eraseAtPoint = (point: InkPoint) => {
      const radius = Math.max(10, props.penWidth * 2.4);
      if (props.onEraseInkAtPoint) {
        const changed = props.onEraseInkAtPoint(point, radius, !eraserSnapshotPushedRef.current);
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
      setActiveInkGesture(true);
      beginInteraction(page);
      const point = clampPointToPage(page, x, y, props.inkTool === 'text' ? 'annotate' : 'draw');

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
        const currentSelection = isCurrentNotebookPage(page) ? scaleSelectionRectToPageSize(props.selectionRect, viewerWidth, viewerHeight) : null;
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
          point.x >= currentSelection.x &&
          point.x <= currentSelection.x + currentSelection.width &&
          point.y >= currentSelection.y &&
          point.y <= currentSelection.y + currentSelection.height
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
        const rect = { x: point.x, y: point.y, width: 0, height: 0, mode: selectionMode, pageWidth: point.pageWidth, pageHeight: point.pageHeight };
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
    const hoverSize = getPencilHoverSize(props.inkTool, props.penWidth);
    const hoverVisible = pencilHover?.pageKey === pageKey && shouldPreviewPencilHover(props.inkTool);
    const hoverToolLabel = getPencilHoverToolLabel(props.inkTool);

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
              <AdaptiveReferenceImage
                source={activeReferenceImage}
                frameStyle={props.styles.pdfPageReferencePopoverImageFrame}
                imageStyle={props.styles.pdfPageReferencePopoverImage}
                minHeight={280}
                maxHeight={560}
              />
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
              <Text style={props.styles.pdfPageReferencePopoverAnswerText} numberOfLines={7}>
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
              <AdaptiveReferenceImage
                source={incomingAssetImage}
                frameStyle={props.styles.pdfIncomingCaptureImageFrame}
                imageStyle={props.styles.pdfIncomingCaptureImage}
                minHeight={320}
                maxHeight={600}
              />
            ) : null}
            <View style={props.styles.pdfIncomingCaptureAnswer}>
              <View style={props.styles.pdfIncomingCaptureAnswerHeader}>
                <MaterialCommunityIcons name="star-four-points" size={13} color="#5F79FF" />
                <Text style={props.styles.pdfIncomingCaptureAnswerTitle}>AI 설명</Text>
              </View>
              <Text style={props.styles.pdfIncomingCaptureAnswerText} numberOfLines={6}>{incomingAssetSummary}</Text>
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

        <GestureDetector gesture={inkGesture}>
          <View {...hoverHandlers} pointerEvents={props.inkTool === 'view' ? 'none' : 'auto'} style={props.styles.inkOverlay} />
        </GestureDetector>
        {hoverVisible ? (
          <>
            <View
              pointerEvents="none"
              style={[
                props.styles.pencilHoverPreview,
                props.inkTool === 'erase' && props.styles.pencilHoverPreviewEraser,
                {
                  left: pencilHover.x - hoverSize / 2,
                  top: pencilHover.y - hoverSize / 2,
                  width: hoverSize,
                  height: hoverSize,
                  borderRadius: hoverSize / 2,
                  borderColor: props.inkTool === 'erase' ? '#EF4444' : props.penColor,
                },
              ]}
            />
            {hoverToolLabel ? (
              <View
                pointerEvents="none"
                style={[
                  props.styles.pencilHoverLabel,
                  {
                    left: Math.min(Math.max(6, pencilHover.x + hoverSize / 2 + 8), Math.max(6, viewerWidth - 76)),
                    top: Math.min(Math.max(6, pencilHover.y - hoverSize / 2 - 2), Math.max(6, viewerHeight - 30)),
                  },
                ]}
              >
                <Text style={props.styles.pencilHoverLabelText}>{hoverToolLabel}</Text>
              </View>
            ) : null}
          </>
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
        onScroll={handleScroll}
        onScrollEndDrag={handleScroll}
        onMomentumScrollEnd={handleScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        updateCellsBatchingPeriod={32}
        windowSize={5}
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
      {pageIndicatorVisible ? (
        <View pointerEvents="none" style={props.styles.pdfFloatingPageIndicator}>
          <Text style={props.styles.pdfFloatingPageText}>{floatingPageIndicatorLabel}</Text>
        </View>
      ) : null}
    </View>
  );
}
