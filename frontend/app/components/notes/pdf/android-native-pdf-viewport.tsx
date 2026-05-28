import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, PanResponder, PixelRatio, Platform, Pressable, requireNativeComponent, StyleSheet, Text, View, type GestureResponderEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { InkPath } from '../canvas/ink-path';
import { SelectionContextMenu } from '../canvas/selection-context-menu';
import { getSelectedObjectIdsForSelection, getSelectionMovePreview, SelectionMovePreview } from '../canvas/selection-move-preview';
import { TextAnnotationLayer } from '../canvas/text-annotation-layer';
import { getCaptureOriginalImageSource, getPageCaptureReferenceImageSource, getPageCaptureReferenceImageUri } from '../shared/capture-assets';
import { buildSelectionRectFromDrag, buildSelectionRectFromPoints, cleanAiDisplayText, findHitInkStrokeId, scaleImageAnnotationToPageSize, scaleInkStrokeToPageSize, scaleSelectionRectToPageSize, scaleTextAnnotationToPageSize } from '../../../ui-helpers';
import type { InkBrush, InkBrushSettings, InkEraserMode, InkImageAnnotation, InkLinePattern, InkPoint, InkSelectionMode, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import type { CaptureAsset, NotebookPage, PageCaptureReference } from '../../../types';
import { renderPdfSelectionPreview, resolveLocalPdfUri, type PdfRenderSource } from '../../../services/pdf-page-renderer';

type NativeDocumentLoadedEvent = NativeSyntheticEvent<{ pageCount: number }>;
type NativePageChangedEvent = NativeSyntheticEvent<{ pageNumber: number; source?: string }>;
type NativeCommitInkStrokeEvent = NativeSyntheticEvent<InkStroke>;
type NativeRemoveInkStrokeEvent = NativeSyntheticEvent<{ strokeId: string }>;
type NativeReplaceInkStrokesEvent = NativeSyntheticEvent<{ removedStrokeIds?: string[]; addedStrokes?: InkStroke[] }>;
type NativeViewportChangedEvent = NativeSyntheticEvent<PdfViewportOverlayState>;
type NativeSelectionGestureEvent = NativeSyntheticEvent<{
  phase: 'begin' | 'move' | 'end' | 'cancel';
  action?: 'new' | 'move' | 'resize';
  resizeCorner?: ResizeCorner | null;
  pageId: string;
  kind: NotebookPage['kind'];
  label: string;
  pageNumber?: number | null;
  generatedPageId?: string | null;
  x: number;
  y: number;
  pageWidth: number;
  pageHeight: number;
}>;
type NativeSelectionActionEvent = NativeSyntheticEvent<{
  action: 'askAi' | 'duplicate' | 'delete' | 'color';
  color?: string | null;
  pageId?: string;
}>;
type NativeTextAnnotationAddEvent = NativeSyntheticEvent<InkPoint>;
type NativeTextAnnotationChangeEvent = NativeSyntheticEvent<{
  id: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  fontSize?: number;
}>;
type NativeTextAnnotationRemoveEvent = NativeSyntheticEvent<{ id: string }>;
type NativePageCaptureReferenceActionEvent = NativeSyntheticEvent<{
  action: 'toggle' | 'close' | 'askAi';
  referenceId: string;
}>;
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';

const PDF_RENDER_DEBUG_LOGGING = process.env.EXPO_PUBLIC_PDF_RENDER_DEBUG === '1';
const IOS_CUSTOM_PDF_CORE = process.env.EXPO_PUBLIC_IOS_CUSTOM_PDF_CORE !== '0';

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
  pinching?: boolean;
  panning?: boolean;
  restoring?: boolean;
  pages: PdfViewportOverlayPage[];
};

type BsnPdfViewportNativeProps = {
  fileUri: string;
  page: number;
  requestedPageSerial?: number;
  notebookPages?: NotebookPage[];
  inkTool: InkTool;
  fingerDrawingEnabled?: boolean;
  penColor: string;
  penWidth: number;
  brushType: InkBrush;
  linePattern: InkLinePattern;
  eraserMode?: InkEraserMode;
  eraserWidth?: number;
  brushSettings?: InkBrushSettings;
  inkStrokes: InkStroke[];
  textAnnotations?: InkTextAnnotation[];
  imageAnnotations?: InkImageAnnotation[];
  pageCaptureReferences?: Array<PageCaptureReference & { nativeImageUri?: string }>;
  openPageCaptureReferenceId?: string | null;
  hiddenTextAnnotationIds?: string[];
  selectionPreviewStrokeIds?: string[];
  selectionPreviewPageNumber?: number;
  selectionPreviewGeneratedPageId?: string | null;
  selectionPreviewOffsetX?: number;
  selectionPreviewOffsetY?: number;
  selectionOverlayPageNumber?: number;
  selectionOverlayGeneratedPageId?: string | null;
  selectionOverlayX?: number;
  selectionOverlayY?: number;
  selectionOverlayWidth?: number;
  selectionOverlayHeight?: number;
  selectionOverlayPageWidth?: number;
  selectionOverlayPageHeight?: number;
  selectionOverlayDraft?: boolean;
  selectionGestureEnabled?: boolean;
  selectionMode?: InkSelectionMode;
  selectionOverlayMode?: InkSelectionMode;
  selectionOverlayPath?: InkPoint[];
  selectionMenuEnabled?: boolean;
  selectionMenuEditable?: boolean;
  textGestureEnabled?: boolean;
  customViewportCoreEnabled?: boolean;
  perfLoggingEnabled?: boolean;
  renderDebugLoggingEnabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onDocumentLoaded?: (event: NativeDocumentLoadedEvent) => void;
  onPageChanged?: (event: NativePageChangedEvent) => void;
  onCommitInkStroke?: (event: NativeCommitInkStrokeEvent) => void;
  onRemoveInkStroke?: (event: NativeRemoveInkStrokeEvent) => void;
  onReplaceInkStrokes?: (event: NativeReplaceInkStrokesEvent) => void;
  onViewportChanged?: (event: NativeViewportChangedEvent) => void;
  onSelectionGesture?: (event: NativeSelectionGestureEvent) => void;
  onSelectionAction?: (event: NativeSelectionActionEvent) => void;
  onTextAnnotationAdd?: (event: NativeTextAnnotationAddEvent) => void;
  onTextAnnotationChange?: (event: NativeTextAnnotationChangeEvent) => void;
  onTextAnnotationRemove?: (event: NativeTextAnnotationRemoveEvent) => void;
  onPageCaptureReferenceAction?: (event: NativePageCaptureReferenceActionEvent) => void;
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

function shouldAppendLassoPoint(points: InkPoint[], point: InkPoint) {
  const lastPoint = points[points.length - 1];
  if (!lastPoint) return true;
  const pageScale = Math.min(point.pageWidth ?? lastPoint.pageWidth ?? 600, point.pageHeight ?? lastPoint.pageHeight ?? 800);
  const threshold = Math.max(1.5, pageScale * 0.0035);
  return Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) >= threshold;
}

function SelectionOverlay(props: { rect: SelectionRect; styles: any; draft?: boolean }) {
  const handleOffset = -7;
  const lassoPath = props.rect.path && props.rect.path.length > 2 ? getLassoPath(props.rect.path) : '';
  if (props.rect.mode === 'lasso') {
    if (!lassoPath) return null;
    return (
      <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
        <Path
          d={props.draft ? lassoPath : `${lassoPath} Z`}
          fill={props.draft ? 'none' : 'rgba(78, 141, 255, 0.06)'}
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
    pageNumber: source.pageNumber ?? point.pageNumber,
    generatedPageId: source.generatedPageId ?? point.generatedPageId,
    pageWidth: point.pageWidth,
    pageHeight: point.pageHeight,
  };
}

export function AndroidNativePdfViewport(props: {
  surfaceOnly?: boolean;
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
  textAnnotations?: InkTextAnnotation[];
  imageAnnotations?: InkImageAnnotation[];
  textAnnotationVariant?: 'floating' | 'marker';
  selectionRect?: SelectionRect | null;
  notebookPages?: NotebookPage[];
  activeGeneratedPageId?: string | null;
  pageCaptureReferences?: PageCaptureReference[];
  incomingAssetSuggestion?: CaptureAsset | null;
  onCommitInkStroke: (stroke: InkStroke) => void;
  onRemoveInkStroke: (strokeId: string) => void;
  onReplaceInkStrokes?: (removedStrokeIds: string[], addedStrokes: InkStroke[]) => void;
  onEraseInkAtPoint?: (point: InkPoint, radius: number, snapshot?: boolean) => boolean;
  onAddTextAnnotation?: (point: InkPoint) => void;
  onUpdateTextAnnotation?: (id: string, text: string) => void;
  onRemoveTextAnnotation?: (id: string) => void;
  onMoveTextAnnotation?: (id: string, x: number, y: number) => void;
  onResizeTextAnnotation?: (id: string, width: number, height: number) => void;
  onChangeTextAnnotationFontSize?: (id: string, fontSize: number) => void;
  onSelectionChange?: (rect: SelectionRect | null) => void;
  onMoveSelection?: (dx: number, dy: number) => void;
  onResizeSelection?: (rect: SelectionRect) => void;
  onSelectionPreviewChange?: (uri: string | null) => void;
  onAskAiAboutSelection?: (selectionPreviewUri?: string | null) => void;
  onDuplicateSelection?: () => void;
  onDeleteSelection?: () => void;
  onChangeSelectedStrokesColor?: (color: string) => void;
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
  const nativeSurfaceOnly = Platform.OS === 'ios' && Boolean(props.surfaceOnly);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const selectionPageRef = useRef<PdfViewportOverlayPage | null>(null);
  const selectionMoveOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveStartRectRef = useRef<SelectionRect | null>(null);
  const selectionResizeCornerRef = useRef<ResizeCorner | null>(null);
  const selectionResizeStartRectRef = useRef<SelectionRect | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const draftSelectionPageIdRef = useRef<string | null>(null);
  const draftSelectionPathRef = useRef<InkPoint[]>([]);
  const draftSelectionFrameRef = useRef<number | null>(null);
  const pendingDraftSelectionRef = useRef<SelectionRect | null | undefined>(undefined);
  const pendingDraftSelectionPageIdRef = useRef<string | null | undefined>(undefined);
  const pendingDraftSelectionPathRef = useRef<InkPoint[] | undefined>(undefined);
  const textTapRef = useRef<InkPoint | null>(null);
  const eraserSnapshotPushedRef = useRef(false);
  const erasedStrokeIdsRef = useRef<Set<string>>(new Set());
  const viewportRef = useRef<PdfViewportOverlayState | null>(null);
  const viewportPageRef = useRef<number | null>(null);
  const requestedPageRef = useRef(props.page);
  const requestedPageSerialRef = useRef(0);
  const lastNativePageEventRef = useRef<{ page: number; at: number } | null>(null);
  const recentToolChangeUntilRef = useRef(0);
  const toolSignatureRef = useRef('');
  const [nativeRequestedPage, setNativeRequestedPage] = useState(props.page);
  const [nativeRequestedPageSerial, setNativeRequestedPageSerial] = useState(0);
  const pdfSource = useMemo(() => getPdfRenderSource(props.file), [props.file]);
  const pdfSourceUri = typeof pdfSource === 'string' ? pdfSource : pdfSource?.uri ?? null;
  const toolSignature = `${props.inkTool}:${props.fingerDrawingEnabled ? '1' : '0'}:${props.penColor}:${props.penWidth}:${props.brushType}:${props.linePattern}`;
  if (Platform.OS === 'ios' && toolSignatureRef.current !== toolSignature) {
    toolSignatureRef.current = toolSignature;
    recentToolChangeUntilRef.current = Date.now() + 1600;
  }
  const overlayEnabled = nativeSurfaceOnly
    || props.inkTool === 'select'
    || props.inkTool === 'text'
    || Boolean(props.textAnnotations?.length)
    || Boolean(props.pageCaptureReferences?.length)
    || Boolean(props.incomingAssetSuggestion)
    || Boolean(props.notebookPages?.some((page) => page.kind !== 'pdf'));
  const useNativeSelectionSurface = Platform.OS === 'ios' && !nativeSurfaceOnly;
  const nativeSelectionGestureEnabled = useNativeSelectionSurface && props.inkTool === 'select';
  const nativeTextGestureEnabled = useNativeSelectionSurface && props.inkTool === 'text';
  const useNativePageReferenceSurface = Platform.OS === 'ios' && !nativeSurfaceOnly;
  const currentPages = viewport?.pages ?? [];
  const nativePageCaptureReferences = useMemo(() => (
    useNativePageReferenceSurface
      ? (props.pageCaptureReferences ?? []).map((reference) => ({
          ...reference,
          nativeImageUri: getPageCaptureReferenceImageUri(reference),
        }))
      : []
  ), [props.pageCaptureReferences, useNativePageReferenceSurface]);

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
    viewportPageRef.current = null;
    requestedPageRef.current = props.page;
    requestedPageSerialRef.current += 1;
    setNativeRequestedPage(props.page);
    setNativeRequestedPageSerial(requestedPageSerialRef.current);

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
  }, [pdfSourceUri, typeof props.file === 'number' ? props.file : null]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    recentToolChangeUntilRef.current = Date.now() + 1600;
  }, [
    props.inkTool,
    props.fingerDrawingEnabled,
    props.penColor,
    props.penWidth,
    props.brushType,
    props.linePattern,
  ]);

  useEffect(() => {
    if (props.page === requestedPageRef.current) return;
    const nativePageEvent = lastNativePageEventRef.current;
    if (
      Platform.OS === 'ios'
      && nativePageEvent
      && nativePageEvent.page === props.page
      && Date.now() - nativePageEvent.at < 700
    ) {
      requestedPageRef.current = props.page;
      viewportPageRef.current = props.page;
      setNativeRequestedPage(props.page);
      return;
    }
    if (
      Platform.OS === 'ios'
      && Date.now() < recentToolChangeUntilRef.current
      && viewportPageRef.current != null
      && props.page !== viewportPageRef.current
    ) {
      props.onPageChanged?.(viewportPageRef.current);
      setNativeRequestedPage(viewportPageRef.current);
      requestedPageRef.current = viewportPageRef.current;
      lastNativePageEventRef.current = { page: viewportPageRef.current, at: Date.now() };
      return;
    }
    requestedPageRef.current = props.page;
    viewportPageRef.current = props.page;
    requestedPageSerialRef.current += 1;
    setNativeRequestedPage(props.page);
    setNativeRequestedPageSerial(requestedPageSerialRef.current);
  }, [props.onPageChanged, props.page]);

  const isCurrentPage = useCallback((page: PdfViewportOverlayPage) => (
    page.generatedPageId
      ? page.generatedPageId === props.activeGeneratedPageId
      : page.pageNumber === (viewportPageRef.current ?? requestedPageRef.current ?? props.page)
  ), [props.activeGeneratedPageId, props.page]);

  const handleNativePageChanged = useCallback((event: NativePageChangedEvent) => {
    const nextPage = event.nativeEvent.pageNumber;
    const stablePage = viewportPageRef.current ?? requestedPageRef.current;
    if (
      Platform.OS === 'ios'
      && Date.now() < recentToolChangeUntilRef.current
      && stablePage != null
      && nextPage !== stablePage
    ) {
      return;
    }
    viewportPageRef.current = nextPage;
    requestedPageRef.current = nextPage;
    lastNativePageEventRef.current = { page: nextPage, at: Date.now() };
    setNativeRequestedPage(nextPage);
    props.onPageChanged?.(nextPage);
  }, [props.onPageChanged]);

  const syncPageFromViewport = useCallback((nextViewport: PdfViewportOverlayState) => {
    if (!nextViewport.pages.length || nextViewport.viewportHeight <= 0) return;
    if (Platform.OS === 'ios' && (nextViewport.pinching || nextViewport.restoring)) return;
    const viewportCenterY = nextViewport.viewportHeight / 2;
    let bestPageNumber: number | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    nextViewport.pages.forEach((page) => {
      if (!page.pageNumber) return;
      const pageTop = page.top;
      const pageBottom = page.top + page.height;
      const distance = viewportCenterY >= pageTop && viewportCenterY <= pageBottom
        ? 0
        : Math.min(Math.abs(viewportCenterY - pageTop), Math.abs(viewportCenterY - pageBottom));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPageNumber = page.pageNumber;
      }
    });
    const nextPage = bestPageNumber;
    if (!nextPage) return;

    const stablePage = viewportPageRef.current ?? requestedPageRef.current;
    if (
      Platform.OS === 'ios'
      && Date.now() < recentToolChangeUntilRef.current
      && stablePage != null
      && nextPage !== stablePage
    ) {
      return;
    }
    if (
      Platform.OS === 'ios'
      && nextViewport.scrollY <= 2
      && stablePage != null
      && stablePage > 1
      && nextPage === 1
    ) {
      return;
    }
    if (nextPage === viewportPageRef.current && nextPage === requestedPageRef.current) return;

    viewportPageRef.current = nextPage;
    requestedPageRef.current = nextPage;
    lastNativePageEventRef.current = { page: nextPage, at: Date.now() };
    setNativeRequestedPage(nextPage);
    props.onPageChanged?.(nextPage);
  }, [props.onPageChanged]);

  const handleNativeViewportChanged = useCallback((event: NativeViewportChangedEvent) => {
    const nextViewport = event.nativeEvent;
    viewportRef.current = nextViewport;
    syncPageFromViewport(nextViewport);
    if (overlayEnabled && !(Platform.OS === 'ios' && nextViewport.pinching)) {
      setViewport(nextViewport);
    }
    props.onViewportChanged?.(nextViewport);
  }, [overlayEnabled, props.onViewportChanged, syncPageFromViewport]);

  const handleNativePageCaptureReferenceAction = useCallback((event: NativePageCaptureReferenceActionEvent) => {
    const { action, referenceId } = event.nativeEvent;
    if (!referenceId) return;
    if (action === 'askAi') {
      props.onAskAiAboutPageCaptureReference?.(referenceId);
      return;
    }
    setOpenReferenceId((current) => (action === 'toggle' && current !== referenceId ? referenceId : null));
  }, [props.onAskAiAboutPageCaptureReference]);

  useEffect(() => {
    if (!overlayEnabled) {
      setViewport(null);
      return;
    }
    if (viewportRef.current) setViewport(viewportRef.current);
  }, [overlayEnabled]);

  const getPageTextAnnotationsForView = useCallback((page: PdfViewportOverlayPage) => {
    const annotations = page.generatedPageId
      ? textAnnotationBuckets.generated.get(page.generatedPageId) ?? []
      : page.pageNumber
        ? textAnnotationBuckets.pdf.get(page.pageNumber) ?? []
        : [];
    return annotations.map((annotation) => scaleTextAnnotationToPageSize(annotation, page.width, page.height));
  }, [textAnnotationBuckets]);

  const getPageImageAnnotationsForView = useCallback((page: PdfViewportOverlayPage) => (
    (props.imageAnnotations ?? [])
      .filter((annotation) => (
        page.generatedPageId
          ? annotation.generatedPageId === page.generatedPageId
          : !annotation.generatedPageId && annotation.pageNumber === page.pageNumber
      ))
      .map((annotation) => scaleImageAnnotationToPageSize(annotation, page.width, page.height))
  ), [props.imageAnnotations]);

  const getPageInkStrokesForView = useCallback((page: PdfViewportOverlayPage) => (
    (props.inkStrokes ?? [])
      .filter((stroke) => (
        page.generatedPageId
          ? stroke.generatedPageId === page.generatedPageId
          : !stroke.generatedPageId && (!stroke.pageNumber || stroke.pageNumber === page.pageNumber)
      ))
      .map((stroke) => scaleInkStrokeToPageSize(stroke, page.width, page.height))
  ), [props.inkStrokes]);

  const getPageCaptureReferences = useCallback((page: PdfViewportOverlayPage) => (
    page.generatedPageId
      ? referenceBuckets.generated.get(page.generatedPageId) ?? []
      : page.pageNumber
        ? referenceBuckets.pdf.get(page.pageNumber) ?? []
        : []
  ), [referenceBuckets]);

  const findPageForSelection = useCallback((selection: SelectionRect | null | undefined) => {
    if (!selection) return null;
    if (selection.generatedPageId) {
      return currentPages.find((candidate) => candidate.generatedPageId === selection.generatedPageId) ?? null;
    }
    if (selection.pageNumber) {
      return currentPages.find((candidate) => candidate.pageNumber === selection.pageNumber) ?? null;
    }
    return currentPages.find(isCurrentPage) ?? null;
  }, [currentPages, isCurrentPage]);

  const nativeSelectionPreview = (() => {
    if (nativeSurfaceOnly || Platform.OS !== 'ios' || !props.selectionRect || !draftSelection || !draftSelectionPageId) return null;
    const page = currentPages.find((candidate) => candidate.id === draftSelectionPageId);
    if (!page) return null;
    const selectionForView = scaleSelectionRectToPageSize(props.selectionRect, page.width, page.height);
    const draftForView = scaleSelectionRectToPageSize(draftSelection, page.width, page.height);
    if (!selectionForView || !draftForView) return null;
    const pageInkStrokes = getPageInkStrokesForView(page);
    const pageTextAnnotations = getPageTextAnnotationsForView(page);
    const pageImageAnnotations = getPageImageAnnotationsForView(page);
    const preview = getSelectionMovePreview(selectionForView, draftForView, pageInkStrokes, pageTextAnnotations, pageImageAnnotations);
    if (!preview || (preview.strokeIds.size === 0 && preview.textAnnotationIds.size === 0 && preview.imageAnnotationIds.size === 0)) return null;
    return {
      strokeIds: Array.from(preview.strokeIds),
      textAnnotationIds: Array.from(preview.textAnnotationIds),
      pageNumber: page.pageNumber,
      generatedPageId: page.generatedPageId ?? null,
      offsetX: (draftForView.x - selectionForView.x) / Math.max(1, page.width) * page.pageWidth,
      offsetY: (draftForView.y - selectionForView.y) / Math.max(1, page.height) * page.pageHeight,
    };
  })();
  const nativeSelectionOverlay = (() => {
    if (nativeSurfaceOnly || Platform.OS !== 'ios') return null;
    const draftPage = draftSelectionPageId ? currentPages.find((candidate) => candidate.id === draftSelectionPageId) : null;
    const selectionPage = findPageForSelection(props.selectionRect);
    const stablePage = currentPages.find(isCurrentPage) ?? null;
    const page = draftPage ?? selectionPage ?? stablePage;
    const rect = draftSelection && draftPage ? draftSelection : props.selectionRect;
    if (!page || !rect) return null;
    return {
      pageNumber: page.pageNumber ?? 0,
      generatedPageId: page.generatedPageId ?? null,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      pageWidth: rect.pageWidth ?? page.pageWidth,
      pageHeight: rect.pageHeight ?? page.pageHeight,
      draft: Boolean(draftSelection && draftPage),
      mode: rect.mode ?? 'rect',
      path: rect.path ?? [],
    };
  })();

  const nativeSelectionMenu = (() => {
    if (nativeSurfaceOnly || Platform.OS !== 'ios' || !props.selectionRect || draftSelection) return null;
    const page = findPageForSelection(props.selectionRect);
    if (!page) return null;
    const selectionForView = scaleSelectionRectToPageSize(props.selectionRect, page.width, page.height);
    if (!selectionForView) return null;
    const pageInkStrokes = getPageInkStrokesForView(page);
    const pageTextAnnotations = getPageTextAnnotationsForView(page);
    const pageImageAnnotations = getPageImageAnnotationsForView(page);
    const { strokeIds, textAnnotationIds, imageAnnotationIds } = getSelectedObjectIdsForSelection(selectionForView, pageInkStrokes, pageTextAnnotations, pageImageAnnotations);
    return {
      enabled: true,
      editable: strokeIds.size + textAnnotationIds.size + imageAnnotationIds.size > 0,
      page,
    };
  })();

  const getPointFromOverlayXY = useCallback((x: number, y: number): { page: PdfViewportOverlayPage; point: InkPoint } | null => {
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

  const getPointFromEvent = useCallback((event: GestureResponderEvent): { page: PdfViewportOverlayPage; point: InkPoint } | null => {
    const x = event.nativeEvent.locationX;
    const y = event.nativeEvent.locationY;
    return getPointFromOverlayXY(x, y);
  }, [getPointFromOverlayXY]);

  const updateDraftSelectionState = useCallback((
    rect?: SelectionRect | null,
    pageId?: string | null,
    path?: InkPoint[],
  ) => {
    if (rect !== undefined) pendingDraftSelectionRef.current = rect;
    if (pageId !== undefined) pendingDraftSelectionPageIdRef.current = pageId;
    if (path !== undefined) pendingDraftSelectionPathRef.current = path;
    if (draftSelectionFrameRef.current != null) return;
    draftSelectionFrameRef.current = requestAnimationFrame(() => {
      draftSelectionFrameRef.current = null;
      if (pendingDraftSelectionRef.current !== undefined) {
        setDraftSelection(pendingDraftSelectionRef.current);
        pendingDraftSelectionRef.current = undefined;
      }
      if (pendingDraftSelectionPageIdRef.current !== undefined) {
        setDraftSelectionPageId(pendingDraftSelectionPageIdRef.current);
        pendingDraftSelectionPageIdRef.current = undefined;
      }
      if (pendingDraftSelectionPathRef.current !== undefined) {
        setDraftSelectionPath(pendingDraftSelectionPathRef.current);
        pendingDraftSelectionPathRef.current = undefined;
      }
    });
  }, []);

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
          imageAnnotations: props.imageAnnotations ?? [],
        });
        return renderedPage.uri;
      }
      return null;
    } catch {
      return null;
    } finally {
      setCapturingSelection(false);
    }
  }, [localFileUri, props.imageAnnotations, props.inkStrokes, props.textAnnotations, viewport]);

  const eraseOverlayAtPoint = useCallback((page: PdfViewportOverlayPage, point: InkPoint) => {
    const radius = props.eraserMode === 'partial'
      ? Math.max(10, (props.eraserWidth ?? props.penWidth * 3) * 1.35)
      : Math.max(14, props.eraserWidth ?? props.penWidth * 3.2);
    if (props.onEraseInkAtPoint) {
      const changed = props.onEraseInkAtPoint(point, radius, !eraserSnapshotPushedRef.current);
      if (changed) eraserSnapshotPushedRef.current = true;
      return;
    }
    const viewPoint = {
      ...point,
      x: point.x / Math.max(1, point.pageWidth ?? page.pageWidth) * page.width,
      y: point.y / Math.max(1, point.pageHeight ?? page.pageHeight) * page.height,
      pageWidth: page.width,
      pageHeight: page.height,
    };
    const hitStrokeId = findHitInkStrokeId(
      getPageInkStrokesForView(page).filter((stroke) => !erasedStrokeIdsRef.current.has(stroke.id)),
      viewPoint,
      radius,
    );
    if (hitStrokeId) {
      erasedStrokeIdsRef.current.add(hitStrokeId);
      props.onRemoveInkStroke(hitStrokeId);
    }
  }, [getPageInkStrokesForView, props]);

  const handleOverlayStart = useCallback((event: GestureResponderEvent) => {
    const hit = getPointFromEvent(event);
    if (!hit) {
      if (props.inkTool === 'select' && props.selectionRect) {
        props.onSelectionChange?.(null);
        props.onSelectionPreviewChange?.(null);
      }
      return;
    }
    const { page, point } = hit;
    if (props.inkTool === 'erase') {
      eraserSnapshotPushedRef.current = false;
      erasedStrokeIdsRef.current.clear();
      eraseOverlayAtPoint(page, point);
      return;
    }
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
  }, [eraseOverlayAtPoint, getPointFromEvent, isCurrentPage, props]);

  const handleOverlayMove = useCallback((event: GestureResponderEvent) => {
    if (props.inkTool === 'erase') {
      const hit = getPointFromEvent(event);
      if (hit) eraseOverlayAtPoint(hit.page, hit.point);
      return;
    }
    if (props.inkTool !== 'select') return;
    const hit = getPointFromEvent(event);
    if (!hit) return;
    const point = hit.point;
    const resizeCorner = selectionResizeCornerRef.current;
    const resizeStartRect = selectionResizeStartRectRef.current;
    if (resizeCorner && resizeStartRect) {
      const rect = resizeRectFromCorner(resizeStartRect, resizeCorner, point);
      draftSelectionRef.current = rect;
      updateDraftSelectionState(rect);
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
      updateDraftSelectionState(rect);
      return;
    }
    const origin = selectionOriginRef.current;
    if (!origin) return;
    const page = selectionPageRef.current ?? hit.page;
    if ((props.selectionMode ?? 'rect') === 'rect') {
      const rect = buildSelectionRectFromDrag(origin, point);
      draftSelectionRef.current = rect;
      updateDraftSelectionState(rect);
      return;
    }
    const currentPath = draftSelectionPathRef.current;
    const nextPath = shouldAppendLassoPoint(currentPath, point) ? [...currentPath, point] : currentPath;
    draftSelectionPathRef.current = nextPath;
    const rect = buildSelectionRectFromPoints(nextPath) ?? buildSelectionRectFromDrag(origin, { ...point, pageWidth: page.pageWidth, pageHeight: page.pageHeight });
    draftSelectionRef.current = rect;
    updateDraftSelectionState(rect, undefined, nextPath);
  }, [eraseOverlayAtPoint, getPointFromEvent, props.inkTool, props.selectionMode, updateDraftSelectionState]);

  const resetOverlayGesture = useCallback(() => {
    if (draftSelectionFrameRef.current != null) {
      cancelAnimationFrame(draftSelectionFrameRef.current);
      draftSelectionFrameRef.current = null;
    }
    pendingDraftSelectionRef.current = undefined;
    pendingDraftSelectionPageIdRef.current = undefined;
    pendingDraftSelectionPathRef.current = undefined;
    selectionOriginRef.current = null;
    selectionPageRef.current = null;
    selectionMoveOriginRef.current = null;
    selectionMoveStartRectRef.current = null;
    selectionResizeCornerRef.current = null;
    selectionResizeStartRectRef.current = null;
    textTapRef.current = null;
    eraserSnapshotPushedRef.current = false;
    erasedStrokeIdsRef.current.clear();
    draftSelectionRef.current = null;
    draftSelectionPageIdRef.current = null;
    draftSelectionPathRef.current = [];
    setDraftSelection(null);
    setDraftSelectionPageId(null);
    setDraftSelectionPath([]);
  }, []);

  const completeSelectionGesture = useCallback(() => {
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
  }, [buildSelectionPreview, currentPages, isCurrentPage, props, resetOverlayGesture]);

  const handleNativeSelectionGesture = useCallback((event: NativeSelectionGestureEvent) => {
    if (!nativeSelectionGestureEnabled) return;
    const payload = event.nativeEvent;
    const page = currentPages.find((candidate) => candidate.id === payload.pageId)
      ?? {
        id: payload.pageId,
        kind: payload.kind,
        label: payload.label,
        pageNumber: payload.pageNumber ?? undefined,
        generatedPageId: payload.generatedPageId ?? undefined,
        left: 0,
        top: 0,
        width: payload.pageWidth,
        height: payload.pageHeight,
        pageWidth: payload.pageWidth,
        pageHeight: payload.pageHeight,
      };
    const point: InkPoint = {
      x: payload.x,
      y: payload.y,
      pageNumber: payload.pageNumber ?? undefined,
      generatedPageId: payload.generatedPageId ?? undefined,
      pageWidth: payload.pageWidth,
      pageHeight: payload.pageHeight,
    };

    if (payload.phase === 'cancel') {
      resetOverlayGesture();
      return;
    }

    if (payload.phase === 'end') {
      if ((props.selectionMode ?? 'rect') === 'lasso' && selectionOriginRef.current) {
        const currentPath = draftSelectionPathRef.current;
        const nextPath = shouldAppendLassoPoint(currentPath, point) ? [...currentPath, point] : currentPath;
        if (nextPath !== currentPath) {
          draftSelectionPathRef.current = nextPath;
          draftSelectionRef.current = buildSelectionRectFromPoints(nextPath) ?? draftSelectionRef.current;
        }
      }
      completeSelectionGesture();
      return;
    }

    if (payload.phase === 'begin') {
      const currentSelection = isCurrentPage(page) ? scaleSelectionRectToPageSize(props.selectionRect ?? null, page.pageWidth, page.pageHeight) : null;
      if (payload.action === 'resize' && currentSelection && payload.resizeCorner) {
        selectionResizeCornerRef.current = payload.resizeCorner;
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
      if (payload.action === 'move' && currentSelection) {
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
      draftSelectionPathRef.current = [];
      setDraftSelectionPath([]);
      const selectionMode = props.selectionMode ?? 'rect';
      const initialPath = selectionMode === 'lasso' ? [point] : [];
      draftSelectionPathRef.current = initialPath;
      setDraftSelectionPath(initialPath);
      const rect = { x: point.x, y: point.y, width: 0, height: 0, mode: selectionMode, path: initialPath, pageWidth: point.pageWidth, pageHeight: point.pageHeight };
      draftSelectionRef.current = rect;
      setDraftSelection(rect);
      return;
    }

    const resizeCorner = selectionResizeCornerRef.current;
    const resizeStartRect = selectionResizeStartRectRef.current;
    if (resizeCorner && resizeStartRect) {
      const rect = resizeRectFromCorner(resizeStartRect, resizeCorner, point);
      draftSelectionRef.current = rect;
      updateDraftSelectionState(rect);
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
      updateDraftSelectionState(rect);
      return;
    }
    const origin = selectionOriginRef.current;
    if (!origin) return;
    if ((props.selectionMode ?? 'rect') === 'lasso') {
      const currentPath = draftSelectionPathRef.current;
      const nextPath = shouldAppendLassoPoint(currentPath, point) ? [...currentPath, point] : currentPath;
      draftSelectionPathRef.current = nextPath;
      const rect = buildSelectionRectFromPoints(nextPath) ?? buildSelectionRectFromDrag(origin, point);
      draftSelectionRef.current = rect;
      updateDraftSelectionState(rect, undefined, nextPath);
      return;
    }
    const rect = buildSelectionRectFromDrag(origin, point);
    draftSelectionRef.current = rect;
    updateDraftSelectionState(rect);
  }, [
    completeSelectionGesture,
    currentPages,
    isCurrentPage,
    nativeSelectionGestureEnabled,
    props,
    resetOverlayGesture,
    updateDraftSelectionState,
  ]);

  const handleNativeSelectionAction = useCallback((event: NativeSelectionActionEvent) => {
    const action = event.nativeEvent.action;
    if (action === 'askAi') {
      const selection = props.selectionRect;
      const page = nativeSelectionMenu?.page ?? currentPages.find(isCurrentPage);
      if (!selection || !page) {
        props.onAskAiAboutSelection?.(null);
        return;
      }
      props.onSelectionPreviewChange?.(null);
      void buildSelectionPreview(page, selection).then((uri) => {
        if (uri) props.onSelectionPreviewChange?.(uri);
        props.onAskAiAboutSelection?.(uri ?? null);
      });
      return;
    }
    if (action === 'duplicate') {
      props.onDuplicateSelection?.();
      return;
    }
    if (action === 'delete') {
      props.onDeleteSelection?.();
      return;
    }
    if (action === 'color') {
      const color = event.nativeEvent.color;
      if (color) props.onChangeSelectedStrokesColor?.(color);
    }
  }, [
    buildSelectionPreview,
    currentPages,
    isCurrentPage,
    nativeSelectionMenu?.page,
    props,
  ]);

  const handleNativeTextAnnotationAdd = useCallback((event: NativeTextAnnotationAddEvent) => {
    props.onAddTextAnnotation?.(event.nativeEvent);
  }, [props.onAddTextAnnotation]);

  const handleOverlayEnd = useCallback(() => {
    if (props.inkTool === 'text' && textTapRef.current) {
      props.onAddTextAnnotation?.(textTapRef.current);
    }

    if (props.inkTool === 'select') {
      completeSelectionGesture();
      return;
    }

    if (props.inkTool === 'erase') {
      eraserSnapshotPushedRef.current = false;
      erasedStrokeIdsRef.current.clear();
    }

    resetOverlayGesture();
  }, [completeSelectionGesture, props.inkTool, props.onAddTextAnnotation, resetOverlayGesture]);

  const overlayPanResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: (event) => (
      Boolean((props.inkTool === 'select' || props.inkTool === 'text' || props.inkTool === 'erase') && getPointFromEvent(event))
      || Boolean(props.inkTool === 'select' && props.selectionRect)
    ),
    onMoveShouldSetPanResponder: () => props.inkTool === 'select' || props.inkTool === 'erase',
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
    const pageInkStrokes = getPageInkStrokesForView(page);
    const pageImageAnnotations = getPageImageAnnotationsForView(page);
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
    const pageAnchoredPopoverMaxWidth = Math.max(180, page.width - 28);
    const referencePopoverWidth = Math.min(430, pageAnchoredPopoverMaxWidth);
    const referencePopoverMaxHeight = Math.max(220, page.height - 68);
    const referenceImageFrameHeight = Math.max(128, Math.min(340, page.height * 0.36));
    const incomingPopoverWidth = Math.min(440, pageAnchoredPopoverMaxWidth);
    const incomingPopoverMaxHeight = Math.max(240, page.height - 68);
    const incomingImageFrameHeight = Math.max(140, Math.min(380, page.height * 0.38));
    const selectionForView = currentPage ? scaleSelectionRectToPageSize(props.selectionRect ?? null, page.width, page.height) : null;
    const selectedObjectCount = selectionForView
      ? (() => {
          const { strokeIds, textAnnotationIds, imageAnnotationIds } = getSelectedObjectIdsForSelection(selectionForView, pageInkStrokes, pageTextAnnotations, pageImageAnnotations);
          return strokeIds.size + textAnnotationIds.size + imageAnnotationIds.size;
        })()
      : 0;
    const draftForView = draftSelectionPageId === page.id && draftSelection ? scaleSelectionRectToPageSize(draftSelection, page.width, page.height) : null;
    const selectionMovePreview = getSelectionMovePreview(selectionForView, draftForView, pageInkStrokes, pageTextAnnotations, pageImageAnnotations);
    const shouldRenderSelectionMovePreview = Boolean(
      selectionMovePreview
        && (!useNativeSelectionSurface || selectionMovePreview.movedTextAnnotations.length > 0),
    );
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
    const useNativeTextAnnotations = Platform.OS === 'ios' && page.kind === 'pdf' && !nativeSurfaceOnly;
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

        {nativeSurfaceOnly && pageInkStrokes.length > 0 ? (
          <Svg width="100%" height="100%" pointerEvents="none" style={StyleSheet.absoluteFill}>
            {pageInkStrokes.map((stroke) => <InkPath key={stroke.id} stroke={stroke} />)}
          </Svg>
        ) : null}

        {pageTextAnnotations.length && !useNativeTextAnnotations ? (
          <TextAnnotationLayer
            annotations={pageTextAnnotations}
            styles={props.styles}
            onChangeText={(id, text) => props.onUpdateTextAnnotation?.(id, text)}
            onMove={moveTextAnnotation}
            onResize={resizeTextAnnotation}
            onChangeFontSize={(id, fontSize) => props.onChangeTextAnnotationFontSize?.(id, fontSize)}
            onRemove={(id) => props.onRemoveTextAnnotation?.(id)}
            variant={props.textAnnotationVariant}
            hiddenAnnotationIds={selectionMovePreview?.textAnnotationIds}
          />
        ) : null}

        {!capturingSelection && !useNativeSelectionSurface && !draftForView && selectionForView ? <SelectionOverlay rect={selectionForView} styles={props.styles} /> : null}
        {selectionMovePreview && shouldRenderSelectionMovePreview ? (
          <SelectionMovePreview
            preview={selectionMovePreview}
            styles={props.styles}
            textAnnotationVariant={props.textAnnotationVariant}
            renderInkPreview={!useNativeSelectionSurface}
          />
        ) : null}
        {!capturingSelection && !useNativeSelectionSurface && draftLassoForView.length > 1 ? <SelectionLassoOverlay points={draftLassoForView} /> : null}
        {!capturingSelection && !useNativeSelectionSurface && draftRectForView ? <SelectionOverlay rect={draftRectForView} styles={props.styles} draft /> : null}
        {!capturingSelection && !useNativeSelectionSurface && !draftForView && selectionForView ? (
          <SelectionContextMenu
            rect={selectionForView}
            pageWidth={page.width}
            pageHeight={page.height}
            styles={props.styles}
            editable={selectedObjectCount > 0}
            onAskAi={() => {
              const selection = props.selectionRect;
              if (!selection) {
                props.onAskAiAboutSelection?.(null);
                return;
              }
              props.onSelectionPreviewChange?.(null);
              void buildSelectionPreview(page, selection).then((uri) => {
                if (uri) props.onSelectionPreviewChange?.(uri);
                props.onAskAiAboutSelection?.(uri ?? null);
              });
            }}
            onDuplicate={props.onDuplicateSelection}
            onDelete={props.onDeleteSelection}
            onChangeColor={props.onChangeSelectedStrokesColor}
          />
        ) : null}

        {!useNativePageReferenceSurface && pageReferences.length ? (
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

        {!useNativePageReferenceSurface && activePageReference ? (
          <View
            style={[
              props.styles.pdfPageReferencePopover,
              { width: referencePopoverWidth, maxWidth: referencePopoverWidth, maxHeight: referencePopoverMaxHeight },
            ]}
          >
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
              <View style={[props.styles.pdfPageReferencePopoverImageFrame, { height: referenceImageFrameHeight }]}>
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
          <View
            style={[
              props.styles.pdfIncomingCapturePopover,
              { width: incomingPopoverWidth, maxWidth: incomingPopoverWidth, maxHeight: incomingPopoverMaxHeight },
            ]}
          >
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
              <View style={[props.styles.pdfIncomingCaptureImageFrame, { height: incomingImageFrameHeight }]}>
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
        page={nativeRequestedPage}
        requestedPageSerial={nativeRequestedPageSerial}
        notebookPages={props.notebookPages}
        inkTool={nativeSurfaceOnly && (props.inkTool === 'select' || props.inkTool === 'text' || props.inkTool === 'erase') ? 'view' : props.inkTool}
        fingerDrawingEnabled={nativeSurfaceOnly ? false : props.fingerDrawingEnabled}
        penColor={props.penColor}
        penWidth={props.penWidth}
        brushType={props.brushType}
        linePattern={props.linePattern}
        eraserMode={props.eraserMode ?? 'partial'}
        eraserWidth={props.eraserWidth ?? 12}
        brushSettings={props.brushSettings}
        inkStrokes={nativeSurfaceOnly ? [] : props.inkStrokes}
        textAnnotations={nativeSurfaceOnly ? [] : props.textAnnotations ?? []}
        imageAnnotations={nativeSurfaceOnly ? [] : props.imageAnnotations ?? []}
        {...(Platform.OS === 'ios' ? {
          pageCaptureReferences: nativePageCaptureReferences,
          openPageCaptureReferenceId: useNativePageReferenceSurface ? openReferenceId : null,
          onPageCaptureReferenceAction: handleNativePageCaptureReferenceAction,
        } : {})}
        hiddenTextAnnotationIds={nativeSelectionPreview?.textAnnotationIds ?? []}
        selectionPreviewStrokeIds={nativeSelectionPreview?.strokeIds ?? []}
        selectionPreviewPageNumber={nativeSelectionPreview?.pageNumber ?? 0}
        selectionPreviewGeneratedPageId={nativeSelectionPreview?.generatedPageId ?? null}
        selectionPreviewOffsetX={nativeSelectionPreview?.offsetX ?? 0}
        selectionPreviewOffsetY={nativeSelectionPreview?.offsetY ?? 0}
        selectionOverlayPageNumber={nativeSelectionOverlay?.pageNumber ?? 0}
        selectionOverlayGeneratedPageId={nativeSelectionOverlay?.generatedPageId ?? null}
        selectionOverlayX={nativeSelectionOverlay?.x ?? 0}
        selectionOverlayY={nativeSelectionOverlay?.y ?? 0}
        selectionOverlayWidth={nativeSelectionOverlay?.width ?? 0}
        selectionOverlayHeight={nativeSelectionOverlay?.height ?? 0}
        selectionOverlayPageWidth={nativeSelectionOverlay?.pageWidth ?? 1}
        selectionOverlayPageHeight={nativeSelectionOverlay?.pageHeight ?? 1}
        selectionOverlayDraft={nativeSelectionOverlay?.draft ?? false}
        selectionGestureEnabled={nativeSelectionGestureEnabled}
        selectionMode={props.selectionMode ?? 'rect'}
        selectionOverlayMode={nativeSelectionOverlay?.mode ?? 'rect'}
        selectionOverlayPath={nativeSelectionOverlay?.path ?? []}
        selectionMenuEnabled={nativeSelectionMenu?.enabled ?? false}
        selectionMenuEditable={nativeSelectionMenu?.editable ?? false}
        textGestureEnabled={nativeTextGestureEnabled}
        {...(Platform.OS === 'ios' ? { customViewportCoreEnabled: IOS_CUSTOM_PDF_CORE } : {})}
        perfLoggingEnabled={Platform.OS === 'ios' && __DEV__}
        renderDebugLoggingEnabled={Platform.OS === 'ios' && PDF_RENDER_DEBUG_LOGGING}
        style={styles.nativeView}
        onDocumentLoaded={(event) => props.onDocumentLoaded?.(event.nativeEvent.pageCount)}
        onPageChanged={handleNativePageChanged}
        onCommitInkStroke={(event) => props.onCommitInkStroke(event.nativeEvent)}
        onRemoveInkStroke={(event) => props.onRemoveInkStroke(event.nativeEvent.strokeId)}
        onReplaceInkStrokes={(event) => {
          props.onReplaceInkStrokes?.(event.nativeEvent.removedStrokeIds ?? [], event.nativeEvent.addedStrokes ?? []);
        }}
        onViewportChanged={handleNativeViewportChanged}
        onSelectionGesture={handleNativeSelectionGesture}
        onSelectionAction={handleNativeSelectionAction}
        onTextAnnotationAdd={handleNativeTextAnnotationAdd}
        onTextAnnotationChange={(event) => {
          const payload = event.nativeEvent;
          if (payload.text != null) props.onUpdateTextAnnotation?.(payload.id, payload.text);
          if (payload.x != null && payload.y != null) props.onMoveTextAnnotation?.(payload.id, payload.x, payload.y);
          if (payload.width != null && payload.height != null) props.onResizeTextAnnotation?.(payload.id, payload.width, payload.height);
          if (payload.fontSize != null) props.onChangeTextAnnotationFontSize?.(payload.id, payload.fontSize);
        }}
        onTextAnnotationRemove={(event) => props.onRemoveTextAnnotation?.(event.nativeEvent.id)}
      />
      {overlayEnabled ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          <View
            pointerEvents={
              (props.inkTool === 'select' && !nativeSelectionGestureEnabled)
              || (props.inkTool === 'text' && !nativeTextGestureEnabled)
              || props.inkTool === 'erase'
                ? 'auto'
                : 'none'
            }
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
