import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, PanResponder, PixelRatio, Platform, Pressable, requireNativeComponent, StyleSheet, Text, View, type GestureResponderEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { TextAnnotationLayer } from '../canvas/text-annotation-layer';
import { getCaptureOriginalImageSource, getPageCaptureReferenceImageSource } from '../shared/capture-assets';
import { cleanAiDisplayText, scaleSelectionRectToPageSize, scaleTextAnnotationToPageSize } from '../../../ui-helpers';
import type { InkBrush, InkBrushSettings, InkLinePattern, InkPoint, InkSelectionMode, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import type { CaptureAsset, NotebookPage, PageCaptureReference } from '../../../types';
import { renderPdfSelectionPreview, resolveLocalPdfUri, type PdfRenderSource } from '../../../services/pdf-page-renderer';

type NativeDocumentLoadedEvent = NativeSyntheticEvent<{ pageCount: number }>;
type NativePageChangedEvent = NativeSyntheticEvent<{ pageNumber: number }>;
type NativeCommitInkStrokeEvent = NativeSyntheticEvent<InkStroke>;
type NativeRemoveInkStrokeEvent = NativeSyntheticEvent<{ strokeId: string }>;
type NativeViewportChangedEvent = NativeSyntheticEvent<PdfViewportOverlayState>;
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

export type PdfViewportOverlayPage = {
  id: string;
  kind: NotebookPage['kind'];
  label: string;
  pageNumber?: number;
  generatedPageId?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
};

export type PdfViewportOverlayState = {
  scale: number;
  scrollY: number;
  translateX: number;
  viewportWidth: number;
  viewportHeight: number;
  contentHeight: number;
  pages: PdfViewportOverlayPage[];
};

type BsnPdfViewportNativeProps = {
  fileUri: string;
  page: number;
  notebookPages?: NotebookPage[];
  inkTool: InkTool;
  fingerDrawingEnabled?: boolean;
  penColor: string;
  penWidth: number;
  brushType: InkBrush;
  linePattern: InkLinePattern;
  brushSettings?: InkBrushSettings;
  inkStrokes: InkStroke[];
  style?: StyleProp<ViewStyle>;
  onDocumentLoaded?: (event: NativeDocumentLoadedEvent) => void;
  onPageChanged?: (event: NativePageChangedEvent) => void;
  onCommitInkStroke?: (event: NativeCommitInkStrokeEvent) => void;
  onRemoveInkStroke?: (event: NativeRemoveInkStrokeEvent) => void;
  onViewportChanged?: (event: NativeViewportChangedEvent) => void;
};

const NativeBsnPdfViewportView = Platform.OS === 'android' || Platform.OS === 'ios'
  ? requireNativeComponent<BsnPdfViewportNativeProps>('BsnPdfViewportView')
  : null;

function getPdfRenderSource(source: number | string | { uri: string }): PdfRenderSource | null {
  if (typeof source === 'number') return null;
  return source;
}

function getCaptureAssetSummary(asset: CaptureAsset | null | undefined) {
  if (!asset) return '';
  return cleanAiDisplayText(asset.analysisSummary || asset.summary);
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

function NotebookPaperBackground({ page }: { page: PdfViewportOverlayPage }) {
  if (page.kind !== 'summary') {
    return (
      <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF' }} />
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: '#F2F5FA' }} />
      </View>
    );
  }

  const lines = Array.from({ length: 24 }, (_, index) => index);
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { backgroundColor: '#FFFDF8' }]}>
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
        AI page
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

function getSelectionRectFromPoints(points: InkPoint[]): SelectionRect | null {
  if (points.length < 2) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const reference = points[0];
  return {
    x: Math.max(0, Math.min(...xs)),
    y: Math.max(0, Math.min(...ys)),
    width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    mode: 'lasso',
    path: points,
    pageWidth: reference.pageWidth,
    pageHeight: reference.pageHeight,
  };
}

export function AndroidNativePdfViewport(props: {
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
  textAnnotations?: InkTextAnnotation[];
  textAnnotationVariant?: 'floating' | 'marker';
  selectionRect?: SelectionRect | null;
  notebookPages?: NotebookPage[];
  activeGeneratedPageId?: string | null;
  pageCaptureReferences?: PageCaptureReference[];
  incomingAssetSuggestion?: CaptureAsset | null;
  onCommitInkStroke: (stroke: InkStroke) => void;
  onRemoveInkStroke: (strokeId: string) => void;
  onAddTextAnnotation?: (point: InkPoint) => void;
  onUpdateTextAnnotation?: (id: string, text: string) => void;
  onRemoveTextAnnotation?: (id: string) => void;
  onMoveTextAnnotation?: (id: string, x: number, y: number) => void;
  onResizeTextAnnotation?: (id: string, width: number, height: number) => void;
  onSelectionChange?: (rect: SelectionRect | null) => void;
  onMoveSelection?: (dx: number, dy: number) => void;
  onResizeSelection?: (rect: SelectionRect) => void;
  onSelectionPreviewChange?: (uri: string | null) => void;
  onAcceptIncomingAsset?: () => void;
  onArchiveIncomingAsset?: () => void;
  onDismissIncomingAsset?: () => void;
  onOpenPageCaptureReference?: (referenceId: string) => void;
  onAskAiAboutPageCaptureReference?: (referenceId: string) => void;
  onPageChanged?: (page: number) => void;
  onDocumentLoaded?: (pageCount: number) => void;
  onViewportChanged?: (viewport: PdfViewportOverlayState) => void;
  styles: any;
  style?: StyleProp<ViewStyle>;
}) {
  const [localFileUri, setLocalFileUri] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [viewport, setViewport] = useState<PdfViewportOverlayState | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const [draftSelectionPageId, setDraftSelectionPageId] = useState<string | null>(null);
  const [draftSelectionPath, setDraftSelectionPath] = useState<InkPoint[]>([]);
  const [capturingSelection, setCapturingSelection] = useState(false);
  const [openReferenceId, setOpenReferenceId] = useState<string | null>(null);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const selectionPageRef = useRef<PdfViewportOverlayPage | null>(null);
  const selectionMoveOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveStartRectRef = useRef<SelectionRect | null>(null);
  const selectionResizeCornerRef = useRef<ResizeCorner | null>(null);
  const selectionResizeStartRectRef = useRef<SelectionRect | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const draftSelectionPageIdRef = useRef<string | null>(null);
  const draftSelectionPathRef = useRef<InkPoint[]>([]);
  const textTapRef = useRef<InkPoint | null>(null);
  const viewportRef = useRef<PdfViewportOverlayState | null>(null);
  const pdfSource = useMemo(() => getPdfRenderSource(props.file), [props.file]);
  const overlayEnabled = props.inkTool === 'select'
    || props.inkTool === 'text'
    || Boolean(props.textAnnotations?.length)
    || Boolean(props.pageCaptureReferences?.length)
    || Boolean(props.incomingAssetSuggestion)
    || Boolean(props.notebookPages?.some((page) => page.kind !== 'pdf'));
  const currentPages = viewport?.pages ?? [];

  const textAnnotationBuckets = useMemo(() => {
    const pdf = new Map<number, InkTextAnnotation[]>();
    const generated = new Map<string, InkTextAnnotation[]>();
    (props.textAnnotations ?? []).forEach((annotation) => {
      if (annotation.generatedPageId) {
        const current = generated.get(annotation.generatedPageId) ?? [];
        current.push(annotation);
        generated.set(annotation.generatedPageId, current);
        return;
      }
      const current = pdf.get(annotation.pageNumber) ?? [];
      current.push(annotation);
      pdf.set(annotation.pageNumber, current);
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

  useEffect(() => {
    if (!openReferenceId) return;
    if (!(props.pageCaptureReferences ?? []).some((reference) => reference.id === openReferenceId)) {
      setOpenReferenceId(null);
    }
  }, [openReferenceId, props.pageCaptureReferences]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setLocalFileUri(null);

    if (!pdfSource) {
      const assetSource = typeof props.file === 'number' ? Image.resolveAssetSource(props.file) : null;
      if (assetSource?.uri) {
        setLocalFileUri(assetSource.uri);
      } else {
        setLoadError('PDF source URI is unavailable.');
      }
      return () => {
        cancelled = true;
      };
    }

    void resolveLocalPdfUri(pdfSource)
      .then((uri) => {
        if (!cancelled) setLocalFileUri(uri);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'PDF source URI is unavailable.');
      });

    return () => {
      cancelled = true;
    };
  }, [pdfSource, props.file]);

  const isCurrentPage = useCallback((page: PdfViewportOverlayPage) => (
    page.generatedPageId
      ? page.generatedPageId === props.activeGeneratedPageId
      : page.pageNumber === props.page
  ), [props.activeGeneratedPageId, props.page]);

  const getPageTextAnnotationsForView = useCallback((page: PdfViewportOverlayPage) => {
    const annotations = page.generatedPageId
      ? textAnnotationBuckets.generated.get(page.generatedPageId) ?? []
      : page.pageNumber
        ? textAnnotationBuckets.pdf.get(page.pageNumber) ?? []
        : [];
    return annotations.map((annotation) => scaleTextAnnotationToPageSize(annotation, page.width, page.height));
  }, [textAnnotationBuckets]);

  const getPageCaptureReferences = useCallback((page: PdfViewportOverlayPage) => (
    page.generatedPageId
      ? referenceBuckets.generated.get(page.generatedPageId) ?? []
      : page.pageNumber
        ? referenceBuckets.pdf.get(page.pageNumber) ?? []
        : []
  ), [referenceBuckets]);

  const getPointFromEvent = useCallback((event: GestureResponderEvent): { page: PdfViewportOverlayPage; point: InkPoint } | null => {
    const x = event.nativeEvent.locationX;
    const y = event.nativeEvent.locationY;
    const page = currentPages.find((candidate) => (
      x >= candidate.left &&
      x <= candidate.left + candidate.width &&
      y >= candidate.top &&
      y <= candidate.top + candidate.height
    ));
    if (!page) return null;
    const point: InkPoint = {
      x: ((x - page.left) / Math.max(1, page.width) * page.pageWidth),
      y: ((y - page.top) / Math.max(1, page.height) * page.pageHeight),
      pageNumber: page.pageNumber,
      generatedPageId: page.generatedPageId,
      pageWidth: page.pageWidth,
      pageHeight: page.pageHeight,
    };
    return { page, point };
  }, [currentPages]);

  const buildSelectionPreview = useCallback(async (page: PdfViewportOverlayPage, rect: SelectionRect) => {
    const targetPage = (viewportRef.current ?? viewport)?.pages.find((candidate) => candidate.id === page.id)
      ?? page;
    setCapturingSelection(true);
    try {
      if (targetPage.kind === 'pdf' && targetPage.pageNumber && localFileUri) {
        const visibleSelectionWidth = rect.width / Math.max(1, rect.pageWidth ?? targetPage.pageWidth) * targetPage.width;
        const renderedPage = await renderPdfSelectionPreview({
          file: localFileUri,
          pageNumber: targetPage.pageNumber,
          rect,
          targetWidth: Math.max(320, Math.min(1800, Math.round(visibleSelectionWidth * PixelRatio.get()))),
          inkStrokes: props.inkStrokes,
          textAnnotations: props.textAnnotations ?? [],
        });
        return renderedPage.uri;
      }
      return null;
    } catch {
      return null;
    } finally {
      setCapturingSelection(false);
    }
  }, [localFileUri, props.inkStrokes, props.textAnnotations, viewport]);

  const handleOverlayStart = useCallback((event: GestureResponderEvent) => {
    const hit = getPointFromEvent(event);
    if (!hit) return;
    const { page, point } = hit;
    if (props.inkTool === 'text') {
      textTapRef.current = point;
      return;
    }
    if (props.inkTool !== 'select') return;
    const currentSelection = isCurrentPage(page) ? scaleSelectionRectToPageSize(props.selectionRect ?? null, page.pageWidth, page.pageHeight) : null;
    const resizeCorner = getResizeCorner(currentSelection, point);
    if (currentSelection && resizeCorner) {
      selectionResizeCornerRef.current = resizeCorner;
      selectionResizeStartRectRef.current = currentSelection;
      selectionPageRef.current = page;
      draftSelectionPageIdRef.current = page.id;
      draftSelectionPathRef.current = [];
      setDraftSelectionPageId(page.id);
      setDraftSelectionPath([]);
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
      selectionPageRef.current = page;
      draftSelectionPageIdRef.current = page.id;
      draftSelectionPathRef.current = [];
      setDraftSelectionPageId(page.id);
      setDraftSelectionPath([]);
      draftSelectionRef.current = currentSelection;
      setDraftSelection(currentSelection);
      return;
    }
    props.onSelectionChange?.(null);
    props.onSelectionPreviewChange?.(null);
    selectionOriginRef.current = point;
    selectionPageRef.current = page;
    draftSelectionPageIdRef.current = page.id;
    setDraftSelectionPageId(page.id);
    const selectionMode = props.selectionMode ?? 'rect';
    const initialPath = selectionMode === 'lasso' ? [point] : [];
    draftSelectionPathRef.current = initialPath;
    setDraftSelectionPath(initialPath);
    const rect = { x: point.x, y: point.y, width: 0, height: 0, mode: selectionMode, pageWidth: point.pageWidth, pageHeight: point.pageHeight };
    draftSelectionRef.current = rect;
    setDraftSelection(rect);
  }, [getPointFromEvent, isCurrentPage, props]);

  const handleOverlayMove = useCallback((event: GestureResponderEvent) => {
    if (props.inkTool !== 'select') return;
    const hit = getPointFromEvent(event);
    if (!hit) return;
    const point = hit.point;
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
    const page = selectionPageRef.current ?? hit.page;
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
    const rect = getSelectionRectFromPoints(nextPath) ?? getSelectionRectFromDrag(origin, { ...point, pageWidth: page.pageWidth, pageHeight: page.pageHeight });
    draftSelectionRef.current = rect;
    setDraftSelection(rect);
  }, [getPointFromEvent, props.inkTool, props.selectionMode]);

  const resetOverlayGesture = useCallback(() => {
    selectionOriginRef.current = null;
    selectionPageRef.current = null;
    selectionMoveOriginRef.current = null;
    selectionMoveStartRectRef.current = null;
    selectionResizeCornerRef.current = null;
    selectionResizeStartRectRef.current = null;
    textTapRef.current = null;
    draftSelectionRef.current = null;
    draftSelectionPageIdRef.current = null;
    draftSelectionPathRef.current = [];
    setDraftSelection(null);
    setDraftSelectionPageId(null);
    setDraftSelectionPath([]);
  }, []);

  const handleOverlayEnd = useCallback(() => {
    if (props.inkTool === 'text' && textTapRef.current) {
      props.onAddTextAnnotation?.(textTapRef.current);
    }

    if (props.inkTool === 'select') {
      const rect = draftSelectionRef.current;
      const moveOrigin = selectionMoveOriginRef.current;
      const moveStartRect = selectionMoveStartRectRef.current;
      const resizeCorner = selectionResizeCornerRef.current;
      const resizeStartRect = selectionResizeStartRectRef.current;
      const page = rect ? selectionPageRef.current ?? currentPages.find(isCurrentPage) : null;
      resetOverlayGesture();
      if (rect && resizeCorner && resizeStartRect) {
        props.onResizeSelection?.(rect);
      } else if (rect && moveOrigin && moveStartRect) {
        const dx = rect.x - moveStartRect.x;
        const dy = rect.y - moveStartRect.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) props.onMoveSelection?.(dx, dy);
      } else if (rect && page && rect.width > 24 && rect.height > 24) {
        void buildSelectionPreview(page, rect).then((uri) => {
          props.onSelectionChange?.(rect);
          props.onSelectionPreviewChange?.(uri);
        });
      }
      return;
    }

    resetOverlayGesture();
  }, [buildSelectionPreview, currentPages, isCurrentPage, props, resetOverlayGesture]);

  const overlayPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (event) => Boolean((props.inkTool === 'select' || props.inkTool === 'text') && getPointFromEvent(event)),
    onMoveShouldSetPanResponder: () => props.inkTool === 'select',
    onPanResponderGrant: handleOverlayStart,
    onPanResponderMove: handleOverlayMove,
    onPanResponderRelease: handleOverlayEnd,
    onPanResponderTerminate: resetOverlayGesture,
  }), [getPointFromEvent, handleOverlayEnd, handleOverlayMove, handleOverlayStart, props.inkTool, resetOverlayGesture]);

  if ((Platform.OS !== 'android' && Platform.OS !== 'ios') || !NativeBsnPdfViewportView) return null;

  if (!localFileUri) {
    return (
      <View style={[styles.fallback, props.style]}>
        <Text style={styles.fallbackText}>{loadError ?? 'PDF loading...'}</Text>
      </View>
    );
  }

  const renderPageOverlay = (page: PdfViewportOverlayPage) => {
    const pageTextAnnotations = getPageTextAnnotationsForView(page);
    const pageReferences = getPageCaptureReferences(page);
    const activePageReference = pageReferences.find((reference) => reference.id === openReferenceId) ?? null;
    const activeReferenceIndex = activePageReference ? pageReferences.findIndex((reference) => reference.id === activePageReference.id) : -1;
    const activeReferenceImage = activePageReference ? getPageCaptureReferenceImageSource(activePageReference) : null;
    const imageReferenceCount = pageReferences.filter((reference) => reference.type === 'image').length;
    const referenceButtonLabel = imageReferenceCount > 0 ? `Photo ${imageReferenceCount}` : `Ref ${pageReferences.length}`;
    const currentPage = isCurrentPage(page);
    const incomingAsset = currentPage ? props.incomingAssetSuggestion : null;
    const incomingAssetImage = incomingAsset ? getCaptureOriginalImageSource(incomingAsset) : null;
    const incomingAssetSummary = getCaptureAssetSummary(incomingAsset);
    const selectionForView = currentPage ? scaleSelectionRectToPageSize(props.selectionRect ?? null, page.width, page.height) : null;
    const draftForView = draftSelectionPageId === page.id && draftSelection ? scaleSelectionRectToPageSize(draftSelection, page.width, page.height) : null;
    const draftLassoForView = draftSelectionPageId === page.id
      ? draftSelectionPath.map((point) => ({
          ...point,
          x: point.x / Math.max(1, point.pageWidth ?? page.pageWidth) * page.width,
          y: point.y / Math.max(1, point.pageHeight ?? page.pageHeight) * page.height,
          pageWidth: page.width,
          pageHeight: page.height,
        }))
      : [];
    const draftRectForView = draftForView?.mode === 'lasso' ? null : draftForView;
    const moveTextAnnotation = (id: string, x: number, y: number) => {
      props.onMoveTextAnnotation?.(
        id,
        x / Math.max(1, page.width) * page.pageWidth,
        y / Math.max(1, page.height) * page.pageHeight,
      );
    };
    const resizeTextAnnotation = (id: string, width: number, height: number) => {
      props.onResizeTextAnnotation?.(
        id,
        width / Math.max(1, page.width) * page.pageWidth,
        height / Math.max(1, page.height) * page.pageHeight,
      );
    };

    return (
      <View
        key={page.id}
        pointerEvents="box-none"
        style={[styles.pageOverlay, { left: page.left, top: page.top, width: page.width, height: page.height }]}
      >
        {page.kind !== 'pdf' ? <NotebookPaperBackground page={page} /> : null}

        {pageTextAnnotations.length ? (
          <TextAnnotationLayer
            annotations={pageTextAnnotations}
            styles={props.styles}
            onChangeText={(id, text) => props.onUpdateTextAnnotation?.(id, text)}
            onMove={moveTextAnnotation}
            onResize={resizeTextAnnotation}
            onRemove={(id) => props.onRemoveTextAnnotation?.(id)}
            variant={props.textAnnotationVariant}
          />
        ) : null}

        {!capturingSelection && !draftForView && selectionForView ? <SelectionOverlay rect={selectionForView} styles={props.styles} /> : null}
        {!capturingSelection && draftLassoForView.length > 1 ? <SelectionLassoOverlay points={draftLassoForView} /> : null}
        {!capturingSelection && draftRectForView ? <SelectionOverlay rect={draftRectForView} styles={props.styles} draft /> : null}

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
                <Text style={props.styles.pdfPageReferencePopoverFallbackText}>No preview</Text>
              </View>
            )}
            <View style={props.styles.pdfPageReferencePopoverAnswer}>
              <View style={props.styles.pdfPageReferencePopoverAnswerHeader}>
                <MaterialCommunityIcons name="star-four-points" size={14} color="#5F79FF" />
                <Text style={props.styles.pdfPageReferencePopoverAnswerTitle}>AI summary</Text>
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
                <Text style={props.styles.pdfPageReferencePopoverPrimaryText}>Ask AI</Text>
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
                <Text style={props.styles.pdfIncomingCaptureLabel}>New {incomingAsset.type === 'image' ? 'photo' : 'asset'}</Text>
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
                <Text style={props.styles.pdfIncomingCaptureAnswerTitle}>AI summary</Text>
              </View>
              <Text style={props.styles.pdfIncomingCaptureAnswerText} numberOfLines={4}>{incomingAssetSummary}</Text>
            </View>
            <View style={props.styles.pdfIncomingCaptureActions}>
              <Pressable style={props.styles.pdfIncomingCapturePrimaryAction} onPress={props.onAcceptIncomingAsset}>
                <Text style={props.styles.pdfIncomingCapturePrimaryText}>Attach here</Text>
              </Pressable>
              <Pressable style={props.styles.pdfIncomingCaptureSecondaryAction} onPress={props.onArchiveIncomingAsset}>
                <Text style={props.styles.pdfIncomingCaptureSecondaryText}>Later</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View
      collapsable={false}
      style={[styles.viewportWrap, props.style]}
    >
      <NativeBsnPdfViewportView
        fileUri={localFileUri}
        page={props.page}
        notebookPages={props.notebookPages}
        inkTool={props.inkTool}
        fingerDrawingEnabled={props.fingerDrawingEnabled}
        penColor={props.penColor}
        penWidth={props.penWidth}
        brushType={props.brushType}
        linePattern={props.linePattern}
        brushSettings={props.brushSettings}
        inkStrokes={props.inkStrokes}
        style={styles.nativeView}
        onDocumentLoaded={(event) => props.onDocumentLoaded?.(event.nativeEvent.pageCount)}
        onPageChanged={(event) => props.onPageChanged?.(event.nativeEvent.pageNumber)}
        onCommitInkStroke={(event) => props.onCommitInkStroke(event.nativeEvent)}
        onRemoveInkStroke={(event) => props.onRemoveInkStroke(event.nativeEvent.strokeId)}
        onViewportChanged={overlayEnabled ? (event) => {
          viewportRef.current = event.nativeEvent;
          setViewport(event.nativeEvent);
          props.onViewportChanged?.(event.nativeEvent);
        } : undefined}
      />
      {overlayEnabled ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View
            pointerEvents={props.inkTool === 'select' || props.inkTool === 'text' ? 'auto' : 'none'}
            style={StyleSheet.absoluteFill}
            {...overlayPanResponder.panHandlers}
          />
          {currentPages.map(renderPageOverlay)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  fallbackText: {
    color: '#94A3B8',
    fontWeight: '800',
  },
  nativeView: {
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    flex: 1,
    width: '100%',
  },
  pageOverlay: {
    position: 'absolute',
  },
  viewportWrap: {
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
});
