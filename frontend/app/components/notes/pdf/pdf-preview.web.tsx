import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, Image, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
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
    context.stroke(new Path2D(path));
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
  const availableHeight = Math.max(520, containerSize.height || height);
  const viewerWidth = Math.min(1240, Math.max(320, availableWidth - 28));
  const viewerHeight = Math.max(520, availableHeight - 20);
  const pageGap = 22;
  const [pdfDocument, setPdfDocument] = useState<PdfJsDocument | null>(null);
  const [pageFrames, setPageFrames] = useState<Record<number, PageFrame>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const textTapRef = useRef<InkPoint | null>(null);
  const canvasRefs = useRef<Record<number, HTMLCanvasElement | null>>({});
  const scrollingProgrammaticallyRef = useRef(false);

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

  const getFrameForPage = (page: NotebookPage): PageFrame => {
    const sourcePageNumber = page.pageNumber ?? page.insertAfterPage;
    if (sourcePageNumber && pageFrames[sourcePageNumber]) return pageFrames[sourcePageNumber];
    return { width: Math.min(960, viewerWidth - 80), height: 900 };
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
    const pageStrokes = props.inkStrokes.filter((stroke) => !stroke.pageNumber || stroke.pageNumber === pageNumber);
    return frame ? pageStrokes.map((stroke) => scaleInkStrokeToPageSize(stroke, frame.width, frame.height)) : pageStrokes;
  };

  const getPdfPageTextAnnotationsForView = (pageNumber: number) => {
    const frame = pageFrames[pageNumber];
    const pageAnnotations = props.textAnnotations.filter((annotation) => annotation.pageNumber === pageNumber);
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
      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        if (Math.abs(pageNumber - props.page) > 1) continue;
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
    scrollingProgrammaticallyRef.current = true;
    const element = document.getElementById(`bsnap-pdf-page-${props.page}`);
    element?.scrollIntoView({ block: 'nearest' });
    window.setTimeout(() => {
      scrollingProgrammaticallyRef.current = false;
    }, 120);
  }, [props.page, pageFrames]);

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
    if (bestPage !== props.page) props.onPageChanged?.(bestPage);
  };

  const beginInteraction = (page: NotebookPage) => {
    if (page.generatedPageId) props.onOpenGeneratedPage?.(page.generatedPageId);
    if (page.pageNumber) props.onPageChanged?.(page.pageNumber);
  };

  const finishSelection = (page: NotebookPage) => {
    if (props.inkTool === 'select') {
      const rect = draftSelectionRef.current;
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

        <View
          style={[props.styles.inkOverlay, { pointerEvents: props.inkTool === 'view' ? 'none' : 'auto' }]}
          onStartShouldSetResponder={(event) => {
            if (event.nativeEvent.touches && event.nativeEvent.touches.length > 1) return false;
            if (!isPrimaryPointerEvent(event)) return false;
            return props.inkTool !== 'view';
          }}
          onMoveShouldSetResponder={(event) => {
            if (event.nativeEvent.touches && event.nativeEvent.touches.length > 1) return false;
            if (!isPrimaryPointerEvent(event)) return false;
            return isDrawingTool(props.inkTool) || props.inkTool === 'select';
          }}
          onResponderGrant={(event) => {
            beginInteraction(page);
            const point = clampPointToPage(page, event.nativeEvent.locationX, event.nativeEvent.locationY, props.inkTool === 'text' ? 'annotate' : 'draw');
            if (!point) return;

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
                pageWidth: point.pageWidth,
                pageHeight: point.pageHeight,
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
        >
          <Svg width="100%" height="100%" pointerEvents="none">
            {pageStrokesForView.filter((stroke) => stroke.style !== 'highlight').map((stroke) => <InkPath key={stroke.id} stroke={stroke} />)}
            {(page.generatedPageId ? currentStroke?.generatedPageId === page.generatedPageId : currentStroke?.pageNumber === page.pageNumber) && currentStroke?.style !== 'highlight' && currentStroke ? <InkPath stroke={currentStroke} draft /> : null}
          </Svg>
          {!draftSelectionStyle && selectionRectStyle ? <View style={[props.styles.selectionOverlayRect, { left: selectionRectStyle.x, top: selectionRectStyle.y, width: selectionRectStyle.width, height: selectionRectStyle.height, pointerEvents: 'none' }]} /> : null}
          {draftSelectionStyle ? <View style={[props.styles.selectionOverlayRect, props.styles.selectionOverlayDraft, { left: draftSelectionStyle.x, top: draftSelectionStyle.y, width: draftSelectionStyle.width, height: draftSelectionStyle.height, pointerEvents: 'none' }]} /> : null}
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
        scrollEnabled={props.inkTool === 'view'}
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
