import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, Image, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { TextAnnotationLayer } from '../canvas/text-annotation-layer';
import { cleanAiDisplayText, derivePreprocessedCropUrl, findHitInkStrokeId, getInkCenterlinePath, getInkStrokeSvgPath, isDrawingTool, isShapeTool, resolveInkStrokeAppearance, resolveShapeStrokeAppearance, scaleInkStrokeToPageSize, scaleSelectionRectToPageSize, scaleTextAnnotationToPageSize } from '../../../ui-helpers';
import { InkBrush, InkBrushSettings, InkLinePattern, InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { CaptureAsset, NotebookPage, PageCaptureReference } from '../../../types';

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

  const lines = Array.from({ length: 28 }, (_, index) => index);

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

type PdfJsViewport = { width: number; height: number };
type PdfJsRenderTask = { promise: Promise<void>; cancel?: () => void };
type PdfJsPage = {
  getViewport: (options: { scale: number }) => PdfJsViewport;
  render: (params: { canvasContext: CanvasRenderingContext2D; viewport: PdfJsViewport }) => PdfJsRenderTask;
};
type PdfJsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
  destroy?: () => void;
};
type PdfJsDocumentSource = string | { url: string; withCredentials?: boolean; disableWorker?: boolean } | { data: Uint8Array; disableWorker?: boolean };
type PdfJsLib = {
  version: string;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (source: PdfJsDocumentSource) => { promise: Promise<PdfJsDocument>; destroy?: () => void };
};
type PageFrame = { width: number; height: number };
type WebGestureNativeEvent = GestureResponderEvent['nativeEvent'] & { buttons?: number };
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
type ResponderStartPoint = { x: number; y: number } | null;
const PDF_RENDER_PAGE_RADIUS = 2;

function getPriorityPageNumbers(currentPage: number, pageCount: number) {
  const pageNumbers: number[] = [];
  for (let offset = 0; offset <= PDF_RENDER_PAGE_RADIUS; offset += 1) {
    const candidates = offset === 0 ? [currentPage] : [currentPage - offset, currentPage + offset];
    candidates.forEach((pageNumber) => {
      if (pageNumber >= 1 && pageNumber <= pageCount && !pageNumbers.includes(pageNumber)) {
        pageNumbers.push(pageNumber);
      }
    });
  }
  return pageNumbers;
}

function getReferencePreviewImage(reference: PageCaptureReference) {
  const cropUrl = derivePreprocessedCropUrl(reference.processedUrl);
  if (cropUrl) return { uri: cropUrl };
  if (reference.thumbnailUrl) return { uri: reference.thumbnailUrl };
  if (reference.processedUrl) return { uri: reference.processedUrl };
  if (reference.type === 'image' && reference.fileUrl) return { uri: reference.fileUrl };
  return reference.previewImage ?? null;
}

function getCaptureAssetPreviewImage(asset: CaptureAsset | null | undefined) {
  if (!asset) return null;
  const cropUrl = derivePreprocessedCropUrl(asset.processedUrl);
  if (cropUrl) return { uri: cropUrl };
  if (asset.thumbnailUrl) return { uri: asset.thumbnailUrl };
  if (asset.processedUrl) return { uri: asset.processedUrl };
  if (asset.type === 'image' && asset.fileUrl) return { uri: asset.fileUrl };
  return asset.previewImage ?? null;
}

function getCaptureAssetSummary(asset: CaptureAsset | null | undefined) {
  if (!asset) return '';
  return cleanAiDisplayText(asset.analysisSummary || asset.summary);
}

declare global {
  interface Window {
    pdfjsLib?: PdfJsLib;
  }
}

let pdfJsLoaderPromise: Promise<PdfJsLib> | null = null;

function isPrimaryPointerEvent(event: GestureResponderEvent) {
  const nativeEvent = event.nativeEvent as WebGestureNativeEvent;
  return nativeEvent.buttons === undefined || nativeEvent.buttons === 1;
}

function isLikelyStylusEvent(event: GestureResponderEvent) {
  const nativeEvent = event.nativeEvent as any;
  const pointerType = nativeEvent.pointerType ?? nativeEvent.touchType;
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

function isInkCaptureTool(tool: InkTool) {
  return isDrawingTool(tool) || tool === 'select' || tool === 'erase';
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
    <View style={[props.styles.selectionOverlayRect, props.draft && props.styles.selectionOverlayDraft, { left: props.rect.x, top: props.rect.y, width: props.rect.width, height: props.rect.height, pointerEvents: 'none' }]}>
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

function loadPdfJs(): Promise<PdfJsLib> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('PDF.js is only available on web.'));
  }

  if (window.pdfjsLib) {
    return Promise.resolve(window.pdfjsLib);
  }

  if (!pdfJsLoaderPromise) {
    pdfJsLoaderPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-pdfjs-runtime="true"]') as HTMLScriptElement | null;
      const handleReady = () => {
        if (!window.pdfjsLib) {
          reject(new Error('PDF.js runtime did not initialize.'));
          return;
        }
        resolve(window.pdfjsLib);
      };

      if (existing) {
        existing.addEventListener('load', handleReady, { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load PDF.js runtime.')), { once: true });
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      script.async = true;
      script.dataset.pdfjsRuntime = 'true';
      script.onload = handleReady;
      script.onerror = () => reject(new Error('Failed to load PDF.js runtime.'));
      document.head.appendChild(script);
    });
  }

  return pdfJsLoaderPromise;
}

function dataUriToBytes(uri: string) {
  const base64 = uri.includes(',') ? uri.slice(uri.indexOf(',') + 1) : uri;
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function createPdfDocumentSource(uri: string): PdfJsDocumentSource {
  if (uri.startsWith('data:application/pdf')) {
    return { data: dataUriToBytes(uri), disableWorker: true };
  }
  return { url: uri, withCredentials: false, disableWorker: true };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function drawPath(context: CanvasRenderingContext2D, stroke: InkStroke, opacity = 1) {
  const path = getInkStrokeSvgPath(stroke);
  if (!path || typeof Path2D === 'undefined') return;
  context.save();
  context.globalAlpha = opacity;
  if (stroke.style === 'shape') {
    context.strokeStyle = stroke.color;
    context.lineWidth = stroke.width;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    if (stroke.linePattern && stroke.linePattern !== 'solid') {
      context.setLineDash(stroke.linePattern === 'dotted' ? [Math.max(1, stroke.width * 0.45), Math.max(6, stroke.width * 2)] : [Math.max(8, stroke.width * 3), Math.max(5, stroke.width * 1.8)]);
    }
    context.stroke(new Path2D(path));
  } else if (stroke.linePattern && stroke.linePattern !== 'solid' && stroke.style !== 'highlight') {
    const centerlinePath = getInkCenterlinePath(stroke.points);
    if (centerlinePath) {
      context.strokeStyle = stroke.color;
      context.lineWidth = stroke.width;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.setLineDash(stroke.linePattern === 'dotted' ? [Math.max(1, stroke.width * 0.45), Math.max(6, stroke.width * 2)] : [Math.max(8, stroke.width * 3), Math.max(5, stroke.width * 1.8)]);
      context.stroke(new Path2D(centerlinePath));
    }
  } else {
    context.fillStyle = stroke.color;
    context.fill(new Path2D(path));
  }
  context.restore();
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
  const availableHeight = Math.max(520, containerSize.height || height);
  const viewerWidth = Math.min(1800, Math.max(320, availableWidth - 12));
  const viewerHeight = Math.max(520, availableHeight - 20);
  const pageGap = 22;
  const [pdfDocument, setPdfDocument] = useState<PdfJsDocument | null>(null);
  const [pageFrames, setPageFrames] = useState<Record<number, PageFrame>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const [openReferenceId, setOpenReferenceId] = useState<string | null>(null);
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveStartRectRef = useRef<SelectionRect | null>(null);
  const selectionResizeCornerRef = useRef<ResizeCorner | null>(null);
  const selectionResizeStartRectRef = useRef<SelectionRect | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const textTapRef = useRef<InkPoint | null>(null);
  const responderStartPointRef = useRef<ResponderStartPoint>(null);
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const scrollingProgrammaticallyRef = useRef(false);
  const suppressNextScrollSyncRef = useRef(false);
  const inkInputLocksScroll = Boolean(props.fingerDrawingEnabled && isInkCaptureTool(props.inkTool));
  const scrollEnabled = !inkInputLocksScroll;

  const pdfUri = useMemo(() => {
    if (typeof props.file === 'string') return props.file;
    if (typeof props.file === 'number') return Image.resolveAssetSource(props.file)?.uri ?? null;
    return props.file.uri ?? null;
  }, [props.file]);
  const pageCount = pdfDocument?.numPages ?? 0;
  const pageItems = useMemo<NotebookPage[]>(
    () => props.notebookPages?.length
      ? props.notebookPages
      : Array.from({ length: Math.max(1, pageCount || props.page) }, (_, index) => ({
          id: `pdf:${index + 1}`,
          documentId: 0,
          kind: 'pdf' as const,
          label: `${index + 1} 페이지`,
          pageNumber: index + 1,
        })),
    [pageCount, props.notebookPages, props.page],
  );
  const getPageCaptureReferences = (page: NotebookPage) => (
    (props.pageCaptureReferences ?? []).filter((reference) => {
      if (page.generatedPageId) return reference.page.kind === 'generated' && reference.page.pageId === page.generatedPageId;
      return reference.page.kind === 'pdf' && reference.page.pageNumber === page.pageNumber;
    })
  );

  useEffect(() => {
    if (!openReferenceId) return;
    if (!(props.pageCaptureReferences ?? []).some((reference) => reference.id === openReferenceId)) {
      setOpenReferenceId(null);
    }
  }, [openReferenceId, props.pageCaptureReferences]);

  const fitPageFrame = (naturalWidth?: number, naturalHeight?: number): PageFrame => {
    const aspectRatio = naturalWidth && naturalHeight
      ? Math.max(0.45, Math.min(3.2, naturalWidth / naturalHeight))
      : 16 / 9;
    const width = Math.min(1180, Math.max(320, viewerWidth - 64));
    return { width, height: Math.round(width / aspectRatio) };
  };

  const getFrameForPage = (page: NotebookPage): PageFrame => {
    const sourcePageNumber = page.pageNumber ?? page.insertAfterPage;
    if (sourcePageNumber && pageFrames[sourcePageNumber]) return pageFrames[sourcePageNumber];
    return fitPageFrame();
  };

  const getPageStrokesForView = (page: NotebookPage) => {
    const frame = getFrameForPage(page);
    const pageStrokes = props.inkStrokes.filter((stroke) => (
      page.generatedPageId
        ? stroke.generatedPageId === page.generatedPageId
        : !stroke.generatedPageId && (!stroke.pageNumber || stroke.pageNumber === page.pageNumber)
    ));
    return pageStrokes.map((stroke) => scaleInkStrokeToPageSize(stroke, frame.width, frame.height));
  };

  const getPageTextAnnotationsForView = (page: NotebookPage) => {
    const frame = getFrameForPage(page);
    const pageAnnotations = props.textAnnotations.filter((annotation) => (
      page.generatedPageId
        ? annotation.generatedPageId === page.generatedPageId
        : !annotation.generatedPageId && annotation.pageNumber === page.pageNumber
    ));
    return pageAnnotations.map((annotation) => scaleTextAnnotationToPageSize(annotation, frame.width, frame.height));
  };

  const getPdfPageStrokesForView = (pageNumber: number) => {
    const frame = pageFrames[pageNumber];
    const pageStrokes = props.inkStrokes.filter((stroke) => !stroke.generatedPageId && (!stroke.pageNumber || stroke.pageNumber === pageNumber));
    return frame ? pageStrokes.map((stroke) => scaleInkStrokeToPageSize(stroke, frame.width, frame.height)) : pageStrokes;
  };

  const getPdfPageTextAnnotationsForView = (pageNumber: number) => {
    const frame = pageFrames[pageNumber];
    const pageAnnotations = props.textAnnotations.filter((annotation) => !annotation.generatedPageId && annotation.pageNumber === pageNumber);
    return frame ? pageAnnotations.map((annotation) => scaleTextAnnotationToPageSize(annotation, frame.width, frame.height)) : pageAnnotations;
  };

  const clampPointToPage = (page: NotebookPage, x: number, y: number, mode: 'draw' | 'annotate' = 'draw'): InkPoint | null => {
    const frame = getFrameForPage(page);
    if (!frame) return null;
    return {
      x: Math.max(0, Math.min(frame.width - (mode === 'annotate' ? 180 : 0), x)),
      y: Math.max(0, Math.min(frame.height - (mode === 'annotate' ? 110 : 0), y)),
      pageNumber: page.pageNumber,
      generatedPageId: page.generatedPageId,
      pageWidth: frame.width,
      pageHeight: frame.height,
    };
  };

  const drawTextAnnotation = (context: CanvasRenderingContext2D, annotation: InkTextAnnotation) => {
    context.save();
    context.font = '700 12px sans-serif';
    context.textBaseline = 'top';

    if (props.textAnnotationVariant === 'marker' && annotation.anchorRect) {
      context.strokeStyle = 'rgba(95, 121, 255, 0.58)';
      context.lineWidth = 1;
      context.setLineDash([5, 4]);
      context.strokeRect(annotation.anchorRect.x, annotation.anchorRect.y, annotation.anchorRect.width, annotation.anchorRect.height);
      const markerX = annotation.anchorRect.x + annotation.anchorRect.width - 12;
      const markerY = Math.max(12, annotation.anchorRect.y - 12);
      context.setLineDash([]);
      context.fillStyle = '#5F79FF';
      context.beginPath();
      context.roundRect(markerX, markerY, 48, 22, 11);
      context.fill();
      context.fillStyle = '#FFFFFF';
      context.fillText(annotation.text.trim() ? '메모' : '새 메모', markerX + 9, markerY + 5);
      context.restore();
      return;
    }

    const annotationWidth = annotation.width || 180;
    const annotationHeight = Math.max(48, 30 + Math.ceil((annotation.text.length || 1) / 18) * 18);
    context.fillStyle = '#FFFFFF';
    context.strokeStyle = '#DDE3EC';
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(annotation.x, annotation.y, annotationWidth, annotationHeight, 12);
    context.fill();
    context.stroke();
    context.fillStyle = '#303744';
    (annotation.text || '텍스트 메모 입력').split(/\s+/).slice(0, 4).forEach((line, index) => {
      context.fillText(line, annotation.x + 12, annotation.y + 12 + index * 17);
    });
    context.restore();
  };

  const buildSelectionPreview = (page: NotebookPage, rect: SelectionRect | null) => {
    const pageNumber = page.pageNumber;
    if (!pageNumber) return null;
    const sourceCanvas = canvasRefs.current[pageNumber];
    const frame = pageFrames[pageNumber];
    if (!rect || !sourceCanvas || !frame) return null;
    const deviceScale = sourceCanvas.width / frame.width;
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.max(1, Math.floor(rect.width * deviceScale));
    cropCanvas.height = Math.max(1, Math.floor(rect.height * deviceScale));
    const context = cropCanvas.getContext('2d');
    if (!context) return null;
    context.drawImage(
      sourceCanvas,
      Math.floor(rect.x * deviceScale),
      Math.floor(rect.y * deviceScale),
      cropCanvas.width,
      cropCanvas.height,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height,
    );
    context.save();
    context.scale(deviceScale, deviceScale);
    context.translate(-rect.x, -rect.y);
    getPdfPageStrokesForView(pageNumber).filter((stroke) => stroke.style === 'highlight').forEach((stroke) => drawPath(context, stroke, 0.72));
    getPdfPageTextAnnotationsForView(pageNumber).forEach((annotation) => drawTextAnnotation(context, annotation));
    getPdfPageStrokesForView(pageNumber).filter((stroke) => stroke.style !== 'highlight').forEach((stroke) => drawPath(context, stroke));
    context.restore();
    return cropCanvas.toDataURL('image/png');
  };

  useEffect(() => {
    let cancelled = false;
    let task: { promise: Promise<PdfJsDocument>; destroy?: () => void } | null = null;

    if (!pdfUri) {
      setPdfDocument(null);
      setPageFrames({});
      setLoadError('웹에서 현재 선택한 PDF를 미리보기할 수 없습니다.');
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    loadPdfJs()
      .then((pdfjsLib) => {
        if (cancelled) return null;
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
        task = pdfjsLib.getDocument(createPdfDocumentSource(pdfUri));
        return withTimeout(task.promise, 12000, 'PDF document load timed out.');
      })
      .then((document) => {
        if (!document || cancelled) return;
        setPdfDocument(document);
        props.onDocumentLoaded?.(document.numPages);
        if (document.numPages > 0 && props.page > document.numPages) props.onPageChanged?.(document.numPages);
      })
      .catch(() => {
        if (cancelled) return;
        setPdfDocument(null);
        setPageFrames({});
        setIsLoading(false);
        setLoadError('PDF를 불러오지 못했습니다. 브라우저에서 파일 접근 권한과 네트워크 상태를 확인해 주세요.');
      });

    return () => {
      cancelled = true;
      task?.destroy?.();
    };
  }, [pdfUri]);

  useEffect(() => {
    let cancelled = false;
    const renderTasks: PdfJsRenderTask[] = [];

    if (!pdfDocument) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const renderPages = async () => {
      const nextFrames: Record<number, PageFrame> = {};
      for (const pageNumber of getPriorityPageNumbers(props.page, pdfDocument.numPages)) {
        const canvas = canvasRefs.current[pageNumber];
        if (!canvas || cancelled) continue;
        const page = await pdfDocument.getPage(pageNumber);
        if (cancelled) return;
        const naturalViewport = page.getViewport({ scale: 1 });
        const scale = Math.max(0.1, Math.min((viewerWidth - 80) / naturalViewport.width, 1.6));
        const viewport = page.getViewport({ scale });
        const context = canvas.getContext('2d');
        if (!context) continue;

        const deviceScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * deviceScale);
        canvas.height = Math.floor(viewport.height * deviceScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);
        nextFrames[pageNumber] = { width: viewport.width, height: viewport.height };
        setPageFrames((current) => ({ ...current, [pageNumber]: nextFrames[pageNumber] }));

        const renderTask = page.render({ canvasContext: context, viewport });
        renderTasks.push(renderTask);
        await withTimeout(renderTask.promise, 12000, 'PDF page render timed out.');
      }
    };

    renderPages()
      .then(() => {
        if (!cancelled) setIsLoading(false);
      })
      .catch(() => {
        renderTasks.forEach((task) => task.cancel?.());
        if (!cancelled) {
          setIsLoading(false);
          setLoadError('PDF 페이지를 렌더링하지 못했습니다.');
        }
      });

    return () => {
      cancelled = true;
      renderTasks.forEach((task) => task.cancel?.());
    };
  }, [pdfDocument, props.page, viewerWidth]);

  useEffect(() => {
    if (!pageFrames[props.page]) return;
    if (suppressNextScrollSyncRef.current) {
      suppressNextScrollSyncRef.current = false;
      return;
    }
    scrollingProgrammaticallyRef.current = true;
    const element = document.getElementById(`bsnap-pdf-page-${props.page}`);
    element?.scrollIntoView({ block: 'nearest' });
    window.setTimeout(() => {
      scrollingProgrammaticallyRef.current = false;
    }, 120);
  }, [pageFrames[props.page], props.page]);

  const handleScroll = (event: any) => {
    if (scrollingProgrammaticallyRef.current || props.inkTool !== 'view') return;
    const offsetY = event.nativeEvent?.contentOffset?.y ?? event.target?.scrollTop ?? 0;
    let cursor = 0;
    let bestPage = props.page;
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestNotebookPage: NotebookPage | null = null;
    pageItems.forEach((page) => {
      const height = getFrameForPage(page).height;
      const pageMid = cursor + height / 2;
      const distance = Math.abs(pageMid - (offsetY + viewerHeight * 0.38));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPage = page.pageNumber ?? bestPage;
        bestNotebookPage = page;
      }
      cursor += height + pageGap;
    });
    const activePage = bestNotebookPage as NotebookPage | null;
    if (activePage?.generatedPageId) props.onOpenGeneratedPage?.(activePage.generatedPageId);
    if (bestPage !== props.page) {
      suppressNextScrollSyncRef.current = true;
      props.onPageChanged?.(bestPage);
    }
  };

  const beginInteraction = (page: NotebookPage) => {
    if (page.generatedPageId) props.onOpenGeneratedPage?.(page.generatedPageId);
    if (page.pageNumber) {
      suppressNextScrollSyncRef.current = true;
      props.onPageChanged?.(page.pageNumber);
    }
  };

  const finishSelection = (page: NotebookPage) => {
    if (props.inkTool === 'select') {
      const rect = draftSelectionRef.current;
      const resizeCorner = selectionResizeCornerRef.current;
      const resizeStartRect = selectionResizeStartRectRef.current;
      const moveOrigin = selectionMoveOriginRef.current;
      const moveStartRect = selectionMoveStartRectRef.current;
      if (rect && resizeCorner && resizeStartRect) {
        props.onResizeSelection?.(rect);
        selectionResizeCornerRef.current = null;
        selectionResizeStartRectRef.current = null;
        selectionMoveOriginRef.current = null;
        selectionMoveStartRectRef.current = null;
        draftSelectionRef.current = null;
        selectionOriginRef.current = null;
        setDraftSelection(null);
        return;
      }
      if (rect && moveOrigin && moveStartRect) {
        const dx = rect.x - moveStartRect.x;
        const dy = rect.y - moveStartRect.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) props.onMoveSelection?.(dx, dy);
        selectionMoveOriginRef.current = null;
        selectionMoveStartRectRef.current = null;
        draftSelectionRef.current = null;
        selectionOriginRef.current = null;
        setDraftSelection(null);
        return;
      }
      if (rect && rect.width > 24 && rect.height > 24) {
        props.onSelectionChange(rect);
        props.onSelectionPreviewChange?.(buildSelectionPreview(page, rect));
      }
      draftSelectionRef.current = null;
      selectionOriginRef.current = null;
      setDraftSelection(null);
    }
    if (props.inkTool === 'text' && textTapRef.current) {
      props.onAddTextAnnotation(textTapRef.current);
      textTapRef.current = null;
    }
  };

  const renderPage = (page: NotebookPage) => {
    const frame = getFrameForPage(page);
    const pageStrokesForView = getPageStrokesForView(page);
    const pageTextAnnotationsForView = getPageTextAnnotationsForView(page);
    const active = page.generatedPageId ? page.generatedPageId === props.activeGeneratedPageId : page.pageNumber === props.page;
    const selectionRectStyle = active ? scaleSelectionRectToPageSize(props.selectionRect, frame.width, frame.height) : null;
    const draftSelectionStyle = (page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) ? draftSelection : null;
    const pageReferences = getPageCaptureReferences(page);
    const activePageReference = pageReferences.find((reference) => reference.id === openReferenceId) ?? null;
    const activeReferenceIndex = activePageReference ? pageReferences.findIndex((reference) => reference.id === activePageReference.id) : -1;
    const activeReferenceImage = activePageReference ? getReferencePreviewImage(activePageReference) : null;
    const imageReferenceCount = pageReferences.filter((reference) => reference.type === 'image').length;
    const referenceButtonLabel = imageReferenceCount > 0 ? `사진 ${imageReferenceCount}` : `자료 ${pageReferences.length}`;
    const incomingAsset = active ? props.incomingAssetSuggestion : null;
    const incomingAssetImage = getCaptureAssetPreviewImage(incomingAsset);
    const incomingAssetSummary = getCaptureAssetSummary(incomingAsset);

    return (
      <View
        key={page.id}
        nativeID={page.pageNumber ? `bsnap-pdf-page-${page.pageNumber}` : `bsnap-page-${page.id}`}
        style={{ width: frame.width, height: frame.height, marginBottom: pageGap, backgroundColor: '#FFFFFF', shadowColor: '#182436', shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, position: 'relative' }}
      >
        {page.kind === 'pdf' && page.pageNumber ? (
          <canvas
            ref={(node) => {
              canvasRefs.current[page.pageNumber!] = node;
            }}
            style={{
              display: 'block',
              position: 'absolute',
              left: 0,
              top: 0,
              backgroundColor: '#FFFFFF',
            }}
          />
        ) : (
          <NotebookPaperBackground page={page} />
        )}

        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          {pageStrokesForView.filter((stroke) => stroke.style === 'highlight').map((stroke) => <InkPath key={stroke.id} stroke={stroke} />)}
          {(page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) && currentStroke?.style === 'highlight' ? <InkPath stroke={currentStroke} draft /> : null}
        </Svg>

        <TextAnnotationLayer
          annotations={pageTextAnnotationsForView}
          styles={props.styles}
          onChangeText={props.onUpdateTextAnnotation}
          onRemove={props.onRemoveTextAnnotation}
          variant={props.textAnnotationVariant}
        />

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
                <Image source={activeReferenceImage} style={props.styles.pdfPageReferencePopoverImage} resizeMode="contain" />
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
                <Image source={incomingAssetImage} style={props.styles.pdfIncomingCaptureImage} resizeMode="cover" />
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
          style={[props.styles.inkOverlay, { pointerEvents: props.inkTool === 'view' ? 'none' : 'auto' }]}
          onStartShouldSetResponder={(event) => {
            responderStartPointRef.current = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
            if (event.nativeEvent.touches && event.nativeEvent.touches.length > 1) return false;
            if (!isPrimaryPointerEvent(event)) return false;
            if (isInkCaptureTool(props.inkTool) && (props.fingerDrawingEnabled || isLikelyStylusEvent(event))) return true;
            return props.inkTool === 'text';
          }}
          onMoveShouldSetResponder={(event) => {
            if (event.nativeEvent.touches && event.nativeEvent.touches.length > 1) return false;
            if (!isPrimaryPointerEvent(event)) return false;
            if (isInkCaptureTool(props.inkTool)) {
              return props.fingerDrawingEnabled || shouldCaptureDrawingMove(event, responderStartPointRef.current);
            }
            return false;
          }}
          onResponderGrant={(event) => {
            beginInteraction(page);
            const point = clampPointToPage(page, event.nativeEvent.locationX, event.nativeEvent.locationY, props.inkTool === 'text' ? 'annotate' : 'draw');
            if (!point) return;

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
                pageWidth: point.pageWidth,
                pageHeight: point.pageHeight,
                points: [point],
              };
              currentStrokeRef.current = stroke;
              setCurrentStroke(stroke);
              return;
            }

            if (props.inkTool === 'select') {
              const currentSelection = active ? scaleSelectionRectToPageSize(props.selectionRect, frame.width, frame.height) : null;
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
              const hitStrokeId = findHitInkStrokeId(pageStrokesForView, point);
              if (hitStrokeId) props.onRemoveInkStroke(hitStrokeId);
            }
          }}
          onResponderMove={(event) => {
            const point = clampPointToPage(page, event.nativeEvent.locationX, event.nativeEvent.locationY);
            if (!point) return;

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
            finishSelection(page);
            currentStrokeRef.current = null;
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
        >
          <Svg width="100%" height="100%" pointerEvents="none">
            {pageStrokesForView.filter((stroke) => stroke.style !== 'highlight').map((stroke) => <InkPath key={stroke.id} stroke={stroke} />)}
            {(page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) && currentStroke?.style !== 'highlight' && currentStroke ? <InkPath stroke={currentStroke} draft /> : null}
          </Svg>
          {!draftSelectionStyle && selectionRectStyle ? <SelectionOverlay rect={selectionRectStyle} styles={props.styles} /> : null}
          {draftSelectionStyle ? <SelectionOverlay rect={draftSelectionStyle} styles={props.styles} draft /> : null}
        </View>
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
      <ScrollView
        style={{ width: '100%', maxHeight: viewerHeight }}
        contentContainerStyle={{ alignItems: 'center', paddingTop: 18, paddingBottom: 36 }}
        scrollEnabled={scrollEnabled}
        scrollEventThrottle={80}
        onScroll={handleScroll}
        showsVerticalScrollIndicator
      >
        {pageItems.map(renderPage)}
        {isLoading ? <Text style={{ color: '#6B7280', fontWeight: '700', marginTop: 12 }}>PDF 페이지를 렌더링하는 중...</Text> : null}
        {!isLoading && loadError ? (
          <Text style={{ color: '#6B7280', textAlign: 'center', paddingHorizontal: 24 }}>{loadError}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}
