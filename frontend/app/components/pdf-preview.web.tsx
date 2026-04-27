import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GestureResponderEvent, Image, PanResponder, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { TextAnnotationLayer } from './text-annotation-layer';
import { findHitInkStrokeId, getInkStrokeSvgPath, resolveInkStrokeAppearance, scaleInkStrokeToPageSize, scaleSelectionRectToPageSize, scaleTextAnnotationToPageSize } from '../ui-helpers';
import { InkPoint, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../ui-types';

type PdfJsViewport = { width: number; height: number };

type PdfJsRenderTask = {
  promise: Promise<void>;
  cancel?: () => void;
};

type PdfJsPage = {
  getViewport: (options: { scale: number }) => PdfJsViewport;
  render: (params: { canvasContext: CanvasRenderingContext2D; viewport: PdfJsViewport }) => PdfJsRenderTask;
};

type PdfJsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
  destroy?: () => void;
};

type PdfJsLib = {
  version: string;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (source: string | { url: string; withCredentials?: boolean }) => { promise: Promise<PdfJsDocument>; destroy?: () => void };
};

type PageFrame = { x: number; y: number; width: number; height: number };
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
  const viewerWidth = Math.min(1240, Math.max(860, width - 150));
  const viewerHeight = Math.max(700, height - 130);
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const [pdfDocument, setPdfDocument] = useState<PdfJsDocument | null>(null);
  const [pageFrame, setPageFrame] = useState<PageFrame | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const textTapRef = useRef<InkPoint | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const pdfUri = useMemo(() => {
    if (typeof props.file === 'string') {
      return props.file;
    }
    if (typeof props.file === 'number') {
      return Image.resolveAssetSource(props.file)?.uri ?? null;
    }
    return props.file.uri ?? null;
  }, [props.file]);

  const pageInkStrokes = useMemo(
    () => props.inkStrokes.filter((stroke) => !stroke.pageNumber || stroke.pageNumber === props.page),
    [props.inkStrokes, props.page],
  );
  const pageInkStrokesForView = useMemo(
    () => (pageFrame ? pageInkStrokes.map((stroke) => scaleInkStrokeToPageSize(stroke, pageFrame.width, pageFrame.height)) : pageInkStrokes),
    [pageFrame, pageInkStrokes],
  );
  const pageTextAnnotationsForView = useMemo(
    () => (pageFrame ? props.textAnnotations.map((annotation) => scaleTextAnnotationToPageSize(annotation, pageFrame.width, pageFrame.height)) : props.textAnnotations),
    [pageFrame, props.textAnnotations],
  );

  const pageTransform = pageFrame ? `translate(${pageFrame.x} ${pageFrame.y})` : undefined;

  const clampPointToPage = (x: number, y: number) => {
    if (!pageFrame) return null;
    const localX = x - pageFrame.x;
    const localY = y - pageFrame.y;

    if (localX < 0 || localY < 0 || localX > pageFrame.width || localY > pageFrame.height) {
      return null;
    }

    return {
      x: Math.max(0, Math.min(pageFrame.width, localX)),
      y: Math.max(0, Math.min(pageFrame.height, localY)),
      pageWidth: pageFrame.width,
      pageHeight: pageFrame.height,
    };
  };

  const toStageRect = (rect: SelectionRect | null) => {
    if (!rect || !pageFrame) return null;
    return {
      left: pageFrame.x + rect.x,
      top: pageFrame.y + rect.y,
      width: rect.width,
      height: rect.height,
    };
  };

  useEffect(() => {
    let cancelled = false;
    let task: { promise: Promise<PdfJsDocument>; destroy?: () => void } | null = null;

    if (!pdfUri) {
      setPdfDocument(null);
      setPageFrame(null);
      setLoadError('웹에서 현재 선택한 PDF를 미리보기할 수 없습니다.');
      return;
    }

    setIsLoading(true);
    setLoadError(null);

    loadPdfJs()
      .then((pdfjsLib) => {
        if (cancelled) return null;
        pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
        task = pdfjsLib.getDocument({ url: pdfUri, withCredentials: false });
        return task.promise;
      })
      .then((document) => {
        if (!document || cancelled) return;
        setPdfDocument(document);
        setIsLoading(false);
        props.onDocumentLoaded?.(document.numPages);
        if (document.numPages > 0 && props.page > document.numPages) {
          props.onPageChanged?.(document.numPages);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setPdfDocument(null);
        setPageFrame(null);
        setIsLoading(false);
        setLoadError('PDF를 불러오지 못했습니다. 브라우저에서 파일 접근 권한과 네트워크 상태를 확인해 주세요.');
      });

    return () => {
      cancelled = true;
      task?.destroy?.();
    };
  }, [pdfUri, props.onPageChanged, props.page]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: PdfJsRenderTask | null = null;

    if (!pdfDocument || !canvasRef.current) {
      setPageFrame(null);
      return;
    }

    setIsLoading(true);

    pdfDocument
      .getPage(props.page)
      .then((page) => {
        if (cancelled || !canvasRef.current) return;

        const naturalViewport = page.getViewport({ scale: 1 });
        const scale = Math.min((viewerWidth - 48) / naturalViewport.width, (viewerHeight - 40) / naturalViewport.height);
        const viewport = page.getViewport({ scale: Math.max(scale, 0.1) });
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (!context) {
          throw new Error('Canvas context unavailable');
        }

        const deviceScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * deviceScale);
        canvas.height = Math.floor(viewport.height * deviceScale);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);

        setPageFrame({
          x: Math.max(0, (viewerWidth - viewport.width) / 2),
          y: 16,
          width: viewport.width,
          height: viewport.height,
        });

        renderTask = page.render({ canvasContext: context, viewport });
        return renderTask.promise;
      })
      .then(() => {
        if (cancelled) return;
        setIsLoading(false);
      })
      .catch(() => {
        renderTask?.cancel?.();
        if (cancelled) return;
        setIsLoading(false);
        setLoadError('PDF 페이지를 렌더링하지 못했습니다.');
      });

    return () => {
      cancelled = true;
      renderTask?.cancel?.();
    };
  }, [pdfDocument, props.page, viewerHeight, viewerWidth]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (e) => {
          if (e.nativeEvent.touches && e.nativeEvent.touches.length > 1) return false;
          if (!isPrimaryPointerEvent(e)) return false;
          return !!pageFrame && (props.inkTool === 'pen' || props.inkTool === 'highlight');
        },
        onMoveShouldSetPanResponder: (e) => {
          if (e.nativeEvent.touches && e.nativeEvent.touches.length > 1) return false;
          if (!isPrimaryPointerEvent(e)) return false;
          return !!pageFrame && (props.inkTool === 'pen' || props.inkTool === 'highlight');
        },
        onPanResponderGrant: (event) => {
          const point = clampPointToPage(event.nativeEvent.locationX, event.nativeEvent.locationY);
          if (!point) return;
          if (props.inkTool === 'pen' || props.inkTool === 'highlight') {
            const appearance = resolveInkStrokeAppearance(props.inkTool, props.penColor, props.penWidth);
            const stroke: InkStroke = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              color: appearance.color,
              width: appearance.width,
              style: props.inkTool === 'highlight' ? 'highlight' : 'pen',
              pageNumber: props.page,
              pageWidth: point.pageWidth,
              pageHeight: point.pageHeight,
              points: [point],
            };
            currentStrokeRef.current = stroke;
            setCurrentStroke(stroke);
          }
        },
        onPanResponderMove: (event) => {
          const point = clampPointToPage(event.nativeEvent.locationX, event.nativeEvent.locationY);
          if (!point) return;
          if (props.inkTool === 'pen' || props.inkTool === 'highlight') {
            const stroke = currentStrokeRef.current;
            if (stroke) {
              const lastPoint = stroke.points[stroke.points.length - 1];
              if (Math.hypot(point.x - lastPoint.x, point.y - lastPoint.y) < 1.2) {
                return;
              }
              const nextStroke = { ...stroke, points: [...stroke.points, point] };
              currentStrokeRef.current = nextStroke;
              setCurrentStroke(nextStroke);
            }
          }
        },
        onPanResponderRelease: () => {
          const stroke = currentStrokeRef.current;
          if (stroke && stroke.points.length > 1) props.onCommitInkStroke(stroke);
          currentStrokeRef.current = null;
          setCurrentStroke(null);
        },
        onPanResponderTerminate: () => {
          const stroke = currentStrokeRef.current;
          if (stroke && stroke.points.length > 1) props.onCommitInkStroke(stroke);
          currentStrokeRef.current = null;
          setCurrentStroke(null);
        },
      }),
    [pageFrame, props],
  );

  const handleOverlayStart = (x: number, y: number) => {
    const point = clampPointToPage(x, y);
    if (!point) return;

    if (props.inkTool === 'select') {
      props.onSelectionChange(null);
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
      const hitStrokeId = findHitInkStrokeId(pageInkStrokesForView, point);
      if (hitStrokeId) {
        props.onRemoveInkStroke(hitStrokeId);
      }
    }
  };

  const handleSelectionMove = (x: number, y: number) => {
    if (props.inkTool !== 'select') return;
    const origin = selectionOriginRef.current;
    if (!origin) return;
    const point = clampPointToPage(x, y);
    if (!point) return;
    const nextRect = {
      x: Math.min(origin.x, point.x),
      y: Math.min(origin.y, point.y),
      width: Math.abs(point.x - origin.x),
      height: Math.abs(point.y - origin.y),
      pageWidth: point.pageWidth,
      pageHeight: point.pageHeight,
    };
    draftSelectionRef.current = nextRect;
    setDraftSelection(nextRect);
  };

  const finishSelection = () => {
    if (props.inkTool === 'select') {
      const rect = draftSelectionRef.current;
      if (rect && rect.width > 24 && rect.height > 24) props.onSelectionChange(rect);
      draftSelectionRef.current = null;
      selectionOriginRef.current = null;
      setDraftSelection(null);
    }
    if (props.inkTool === 'text' && textTapRef.current) {
      props.onAddTextAnnotation(textTapRef.current);
      textTapRef.current = null;
    }
  };

  const currentPenPath = currentStroke?.style === 'pen' ? getInkStrokeSvgPath(currentStroke, false) : '';
  const currentHighlightPath = currentStroke?.style === 'highlight' ? getInkStrokeSvgPath(currentStroke, false) : '';
  const selectionRectStyle = toStageRect(pageFrame ? scaleSelectionRectToPageSize(props.selectionRect, pageFrame.width, pageFrame.height) : props.selectionRect);
  const draftSelectionStyle = toStageRect(draftSelection);

  return (
    <View style={props.styles.pdfViewerCard}>
      <View style={[props.styles.pdfStage, { width: viewerWidth, height: viewerHeight, overflow: 'hidden' }]}> 
        {pdfUri ? (
          <View style={[props.styles.pdfViewer, { alignItems: 'center', justifyContent: 'flex-start' }]}>
            <canvas
              ref={canvasRef}
              style={{
                display: pageFrame ? 'block' : 'none',
                position: 'absolute',
                left: pageFrame?.x ?? 0,
                top: pageFrame?.y ?? 0,
                backgroundColor: '#FFFFFF',
                boxShadow: '0 18px 42px rgba(24, 36, 54, 0.08)',
              }}
            />
            {isLoading ? <Text style={{ color: '#6B7280', fontWeight: '700' }}>PDF 페이지를 렌더링하는 중...</Text> : null}
            {!isLoading && loadError ? (
              <Text style={{ color: '#6B7280', textAlign: 'center', paddingHorizontal: 24 }}>{loadError}</Text>
            ) : null}
          </View>
        ) : (
          <View style={[props.styles.pdfViewer, { alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 24 }]}>
            <Text style={{ color: '#6B7280', textAlign: 'center' }}>
              웹에서는 현재 선택한 PDF를 미리보기할 수 없습니다.
            </Text>
          </View>
        )}

        <Svg width="100%" height="100%" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
          {pageInkStrokesForView
            .filter((stroke) => stroke.style === 'highlight')
            .map((stroke) => {
              const path = getInkStrokeSvgPath(stroke);
              if (!path) return null;
              return (
                <Path
                  key={stroke.id}
                  d={path}
                  transform={pageTransform}
                  fill={stroke.color}
                  opacity={0.72}
                />
              );
            })}
          {currentHighlightPath ? (
            <Path
              d={currentHighlightPath}
              transform={pageTransform}
              fill={currentStroke?.color}
              opacity={0.72}
            />
          ) : null}
        </Svg>

        {pageFrame ? (
          <View style={{ position: 'absolute', left: pageFrame.x, top: pageFrame.y, width: pageFrame.width, height: pageFrame.height, pointerEvents: 'box-none' }}>
            <TextAnnotationLayer
              annotations={pageTextAnnotationsForView}
              styles={props.styles}
              onChangeText={props.onUpdateTextAnnotation}
              onRemove={props.onRemoveTextAnnotation}
              variant={props.textAnnotationVariant}
            />
          </View>
        ) : null}

        <View
          style={[props.styles.inkOverlay, { pointerEvents: props.inkTool === 'view' ? 'none' : 'auto' }]}
          onStartShouldSetResponder={() => !!pageFrame && (props.inkTool === 'select' || props.inkTool === 'text' || props.inkTool === 'erase')}
          onMoveShouldSetResponder={() => !!pageFrame && props.inkTool === 'select'}
          onResponderGrant={(event) => handleOverlayStart(event.nativeEvent.locationX, event.nativeEvent.locationY)}
          onResponderMove={(event) => handleSelectionMove(event.nativeEvent.locationX, event.nativeEvent.locationY)}
          onResponderRelease={finishSelection}
          onResponderTerminate={finishSelection}
          {...(props.inkTool === 'pen' || props.inkTool === 'highlight' ? panResponder.panHandlers : {})}
        >
          <Svg width="100%" height="100%" pointerEvents="none">
            {pageInkStrokesForView
              .filter((stroke) => stroke.style !== 'highlight')
              .map((stroke) => {
                const path = getInkStrokeSvgPath(stroke);
                if (!path) return null;
                return <Path key={stroke.id} d={path} transform={pageTransform} fill={stroke.color} />;
              })}
            {currentPenPath ? <Path d={currentPenPath} transform={pageTransform} fill={currentStroke?.color} /> : null}
          </Svg>
          {!draftSelection && selectionRectStyle ? <View style={[props.styles.selectionOverlayRect, selectionRectStyle, { pointerEvents: 'none' }]} /> : null}
          {draftSelectionStyle ? <View style={[props.styles.selectionOverlayRect, props.styles.selectionOverlayDraft, draftSelectionStyle, { pointerEvents: 'none' }]} /> : null}
        </View>
      </View>
    </View>
  );
}
