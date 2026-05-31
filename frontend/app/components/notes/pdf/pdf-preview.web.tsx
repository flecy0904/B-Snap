import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { getCaptureOriginalImageSource, getPageCaptureReferenceImageSource } from '../shared/capture-assets';
import { cleanAiDisplayText, finalizeInkStroke, findHitInkStrokeId, getInkCenterlinePath, getInkStrokeSvgPath, isDrawingTool, isShapeTool, resolveInkStrokeAppearance, resolveShapeStrokeAppearance, scaleInkStrokeToPageSize, scaleSelectionRectToPageSize, scaleTextAnnotationToPageSize, shouldAppendInkPoint } from '../../../ui-helpers';
import { InkBrush, InkBrushSettings, InkImageAnnotation, InkLinePattern, InkPoint, InkSelectionMode, InkStroke, InkTextAnnotation, InkTool, SelectionRect } from '../../../ui-types';
import { CaptureAsset, NotebookPage, PageCaptureReference } from '../../../types';
import { useWebPdfViewportEngine, WebPdfPageFrame } from './web-pdf-viewport-engine';

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

type PageFrame = WebPdfPageFrame;
type ResizeCorner = 'nw' | 'ne' | 'sw' | 'se';
const WEB_PDF_ZOOM_STEP = 0.15;
const WEB_PDF_PAGE_GAP = 10;

function getCaptureAssetSummary(asset: CaptureAsset | null | undefined) {
  if (!asset) return '';
  return cleanAiDisplayText(asset.analysisSummary || asset.summary);
}

function isPdfUri(uri: string | undefined) {
  return !!uri && /\.pdf(?:$|[?#])/i.test(uri);
}

function getResizeCorner(rect: SelectionRect | null, point: InkPoint, threshold = 24): ResizeCorner | null {
  if (!rect) return null;
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

function getLassoPath(points: InkPoint[]) {
  if (!points.length) return '';
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');
}

function percent(value: number, total: number) {
  return `${(value / Math.max(1, total)) * 100}%`;
}

function SelectionOverlay(props: { rect: SelectionRect; styles: any; pageWidth: number; pageHeight: number; draft?: boolean }) {
  const handleOffset = -7;
  const lassoPath = props.rect.path && props.rect.path.length > 2 ? getLassoPath(props.rect.path) : '';
  if (props.rect.mode === 'lasso') {
    if (!lassoPath) return null;
    return (
      <Svg width="100%" height="100%" viewBox={`0 0 ${props.pageWidth} ${props.pageHeight}`} preserveAspectRatio="none" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
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
    <View
      style={[
        props.styles.selectionOverlayRect,
        props.draft && props.styles.selectionOverlayDraft,
        {
          left: percent(props.rect.x, props.pageWidth),
          top: percent(props.rect.y, props.pageHeight),
          width: percent(props.rect.width, props.pageWidth),
          height: percent(props.rect.height, props.pageHeight),
          pointerEvents: 'none',
        },
      ]}
    >
      {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
        <View
          key={corner}
          style={[
            props.styles.selectionResizeHandle,
            {
              left: corner === 'nw' || corner === 'sw' ? handleOffset : `calc(100% + ${handleOffset}px)`,
              top: corner === 'nw' || corner === 'ne' ? handleOffset : `calc(100% + ${handleOffset}px)`,
            },
          ]}
        />
      ))}
    </View>
  );
}

function SelectionLassoOverlay(props: { points: InkPoint[]; pageWidth: number; pageHeight: number }) {
  if (props.points.length < 2) return null;
  return (
    <Svg width="100%" height="100%" viewBox={`0 0 ${props.pageWidth} ${props.pageHeight}`} preserveAspectRatio="none" pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0 }}>
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

function formatZoomPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

const floatingControlBaseStyle: React.CSSProperties = {
  position: 'absolute',
  bottom: 18,
  zIndex: 80,
  display: 'flex',
  alignItems: 'center',
  minHeight: 31,
  borderRadius: 14,
  border: '1px solid rgba(198, 204, 214, 0.82)',
  backgroundColor: 'rgba(250, 250, 250, 0.96)',
  boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12), 0 1px 2px rgba(15, 23, 42, 0.08)',
  backdropFilter: 'blur(10px)',
  pointerEvents: 'auto',
};

const floatingControlButtonStyle: React.CSSProperties = {
  width: 24,
  height: 28,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 0,
  borderRadius: 10,
  backgroundColor: 'transparent',
  color: '#2F3745',
  fontSize: 15,
  fontWeight: 800,
  cursor: 'pointer',
  lineHeight: 1,
};

const floatingControlDividerStyle: React.CSSProperties = {
  width: 1,
  height: 17,
  backgroundColor: 'rgba(198, 204, 214, 0.9)',
};

const scrollbarTrackBaseStyle: React.CSSProperties = {
  position: 'absolute',
  zIndex: 75,
  borderRadius: 999,
  backgroundColor: 'transparent',
  pointerEvents: 'auto',
};

const scrollbarThumbBaseStyle: React.CSSProperties = {
  position: 'absolute',
  borderRadius: 999,
  backgroundColor: 'rgba(54, 63, 78, 0.48)',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.16)',
};

type ScrollbarDragState = {
  axis: 'x' | 'y';
  pointerId: number;
  trackStart: number;
  trackLength: number;
  thumbLength: number;
  pointerOffset: number;
};

function isPrimaryDomPointer(event: React.PointerEvent<HTMLElement>) {
  if (!event.isPrimary) return false;
  if (event.pointerType === 'mouse') return event.button === 0 || event.buttons === 1;
  return true;
}

function isStylusPointer(event: React.PointerEvent<HTMLElement>) {
  const pointerType = String(event.pointerType);
  return pointerType === 'pen' || pointerType === 'stylus';
}

function shouldCaptureDomPointer(tool: InkTool, event: React.PointerEvent<HTMLElement>, fingerDrawingEnabled: boolean | undefined) {
  if (!isPrimaryDomPointer(event)) return false;
  if (tool === 'select' || tool === 'text') return true;
  if (isDrawingTool(tool) || tool === 'erase') {
    if (event.pointerType === 'mouse') return true;
    if (isStylusPointer(event)) return true;
    return Boolean(fingerDrawingEnabled);
  }
  return false;
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

function scaleInkStrokeToViewportPageSize(stroke: InkStroke, pageWidth: number, pageHeight: number): InkStroke {
  const scaledStroke = scaleInkStrokeToPageSize(stroke, pageWidth, pageHeight);
  if (scaledStroke === stroke) return stroke;
  return {
    ...scaledStroke,
    width: stroke.width,
  };
}

function scaleInkStrokeToLogicalHitTestSize(stroke: InkStroke, pageWidth: number, pageHeight: number, pageScale: number): InkStroke {
  const scaledStroke = scaleInkStrokeToPageSize(stroke, pageWidth, pageHeight);
  return {
    ...scaledStroke,
    width: Math.max(1, stroke.width / Math.max(0.001, pageScale)),
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

function getSelectionRectFromDrag(origin: InkPoint, point: InkPoint, mode: InkSelectionMode = 'rect'): SelectionRect {
  return {
    x: Math.min(origin.x, point.x),
    y: Math.min(origin.y, point.y),
    width: Math.abs(point.x - origin.x),
    height: Math.abs(point.y - origin.y),
    mode,
    pageWidth: point.pageWidth,
    pageHeight: point.pageHeight,
  };
}

function WebPdfInkCanvasLayer(props: {
  pageWidth: number;
  pageHeight: number;
  strokes: InkStroke[];
  currentStroke: InkStroke | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const deviceScale = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(props.pageWidth * deviceScale));
    const height = Math.max(1, Math.floor(props.pageHeight * deviceScale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
    context.clearRect(0, 0, props.pageWidth, props.pageHeight);
    props.strokes.filter((stroke) => stroke.style === 'highlight').forEach((stroke) => drawPath(context, stroke, 0.72));
    if (props.currentStroke?.style === 'highlight') drawPath(context, props.currentStroke, 0.72);
    props.strokes.filter((stroke) => stroke.style !== 'highlight').forEach((stroke) => drawPath(context, stroke));
    if (props.currentStroke && props.currentStroke.style !== 'highlight') drawPath(context, props.currentStroke);
  }, [props.currentStroke, props.pageHeight, props.pageWidth, props.strokes]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        zIndex: 12,
        pointerEvents: 'none',
      }}
    />
  );
}

const MIN_TEXT_BOX_WIDTH = 96;
const MIN_TEXT_BOX_HEIGHT = 56;
const DEFAULT_TEXT_FONT_SIZE = 17;
const MIN_TEXT_FONT_SIZE = 12;
const MAX_TEXT_FONT_SIZE = 40;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function WebPdfTextAnnotationLayer(props: {
  annotations: InkTextAnnotation[];
  pageWidth: number;
  pageHeight: number;
  onChangeText: (id: string, text: string) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onResize?: (id: string, width: number, height: number) => void;
  onChangeFontSize?: (id: string, fontSize: number) => void;
  onRemove: (id: string) => void;
  variant?: 'floating' | 'marker';
}) {
  const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
  const [draftFrame, setDraftFrame] = useState<Record<string, { x: number; y: number; width: number; height: number }>>({});
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const pointerDragRef = useRef<{
    id: string;
    mode: 'move' | 'resize';
    pointerId: number;
    startClientX: number;
    startClientY: number;
    scaleX: number;
    scaleY: number;
    sourcePageWidth: number;
    sourcePageHeight: number;
    startFrame: { x: number; y: number; width: number; height: number };
    currentFrame: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const variant = props.variant ?? 'floating';

  useEffect(() => {
    if (!activeAnnotationId) return;
    if (props.annotations.some((annotation) => annotation.id === activeAnnotationId)) return;
    setActiveAnnotationId(null);
  }, [activeAnnotationId, props.annotations]);

  useEffect(() => {
    const emptyAnnotation = props.annotations.find((annotation) => !annotation.text.trim());
    if (!emptyAnnotation) return undefined;
    const timer = window.setTimeout(() => {
      setActiveAnnotationId(emptyAnnotation.id);
      textareaRefs.current[emptyAnnotation.id]?.focus();
    }, 80);
    return () => window.clearTimeout(timer);
  }, [props.annotations]);

  const getFrame = (annotation: InkTextAnnotation) => (
    draftFrame[annotation.id] ?? {
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height ?? 88,
    }
  );

  const activate = (id: string) => {
    setActiveAnnotationId(id);
    window.setTimeout(() => textareaRefs.current[id]?.focus(), 0);
  };

  const changeFontSize = (annotation: InkTextAnnotation, delta: number) => {
    setActiveAnnotationId(annotation.id);
    const fontSize = clamp(Math.round(annotation.fontSize ?? DEFAULT_TEXT_FONT_SIZE), MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE);
    props.onChangeFontSize?.(annotation.id, clamp(fontSize + delta, MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE));
  };

  const startDrag = (event: React.PointerEvent<HTMLElement>, annotation: InkTextAnnotation, renderAnnotation: InkTextAnnotation, mode: 'move' | 'resize') => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setActiveAnnotationId(annotation.id);
    const layerRect = layerRef.current?.getBoundingClientRect();
    const scaleX = layerRect ? layerRect.width / Math.max(1, props.pageWidth) : 1;
    const scaleY = layerRect ? layerRect.height / Math.max(1, props.pageHeight) : 1;
    pointerDragRef.current = {
      id: annotation.id,
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      scaleX,
      scaleY,
      sourcePageWidth: annotation.pageWidth ?? props.pageWidth,
      sourcePageHeight: annotation.pageHeight ?? props.pageHeight,
      startFrame: getFrame(renderAnnotation),
      currentFrame: getFrame(renderAnnotation),
    };
  };

  const moveDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = (event.clientX - drag.startClientX) / Math.max(0.001, drag.scaleX);
    const dy = (event.clientY - drag.startClientY) / Math.max(0.001, drag.scaleY);
    const frame = drag.mode === 'move'
      ? {
        ...drag.startFrame,
        x: drag.startFrame.x + dx,
        y: drag.startFrame.y + dy,
      }
      : {
        ...drag.startFrame,
        width: Math.max(MIN_TEXT_BOX_WIDTH, drag.startFrame.width + dx),
        height: Math.max(MIN_TEXT_BOX_HEIGHT, drag.startFrame.height + dy),
      };
    pointerDragRef.current = { ...drag, currentFrame: frame };
    setDraftFrame((current) => ({ ...current, [drag.id]: frame }));
  };

  const finishDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const frame = drag.currentFrame;
    if (drag.mode === 'move') {
      props.onMove?.(
        drag.id,
        frame.x / Math.max(1, props.pageWidth) * drag.sourcePageWidth,
        frame.y / Math.max(1, props.pageHeight) * drag.sourcePageHeight,
      );
    }
    if (drag.mode === 'resize') {
      props.onResize?.(
        drag.id,
        frame.width / Math.max(1, props.pageWidth) * drag.sourcePageWidth,
        frame.height / Math.max(1, props.pageHeight) * drag.sourcePageHeight,
      );
    }
    pointerDragRef.current = null;
    setDraftFrame((current) => {
      const next = { ...current };
      delete next[drag.id];
      return next;
    });
  };

  return (
    <div ref={layerRef} style={{ position: 'absolute', inset: 0, zIndex: 25, pointerEvents: 'none' }}>
      {props.annotations.map((annotation) => {
        const renderAnnotation = scaleTextAnnotationToPageSize(annotation, props.pageWidth, props.pageHeight);
        if (variant === 'marker' && renderAnnotation.anchorRect) {
          return (
            <div key={annotation.id} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              <div
                style={{
                  position: 'absolute',
                  left: percent(renderAnnotation.anchorRect.x, props.pageWidth),
                  top: percent(renderAnnotation.anchorRect.y, props.pageHeight),
                  width: percent(renderAnnotation.anchorRect.width, props.pageWidth),
                  height: percent(renderAnnotation.anchorRect.height, props.pageHeight),
                  borderRadius: 10,
                  border: '1px solid rgba(95, 121, 255, 0.28)',
                  backgroundColor: 'rgba(95, 121, 255, 0.08)',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  left: percent(renderAnnotation.anchorRect.x + renderAnnotation.anchorRect.width, props.pageWidth),
                  top: percent(Math.max(12, renderAnnotation.anchorRect.y - 12), props.pageHeight),
                  transform: 'translateX(-12px)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  minHeight: 24,
                  padding: '0 8px',
                  borderRadius: 999,
                  backgroundColor: '#5F79FF',
                  color: '#FFFFFF',
                  fontSize: 10,
                  fontWeight: 900,
                }}
              >
                <MaterialCommunityIcons name="note-text-outline" size={12} color="#FFFFFF" />
                {annotation.text.trim() ? '메모' : '새 메모'}
              </div>
            </div>
          );
        }

        const frame = getFrame(renderAnnotation);
        const active = activeAnnotationId === annotation.id || !annotation.text.trim();
        const fontSize = clamp(Math.round(annotation.fontSize ?? DEFAULT_TEXT_FONT_SIZE), MIN_TEXT_FONT_SIZE, MAX_TEXT_FONT_SIZE);
        return (
          <div
            key={annotation.id}
            style={{
              position: 'absolute',
              left: percent(frame.x, props.pageWidth),
              top: percent(frame.y, props.pageHeight),
              width: percent(frame.width, props.pageWidth),
              height: percent(frame.height, props.pageHeight),
              minHeight: MIN_TEXT_BOX_HEIGHT,
              padding: active ? '42px 10px 10px' : 10,
              borderRadius: 10,
              border: `1px solid ${active ? '#5F79FF' : 'rgba(95, 121, 255, 0.22)'}`,
              backgroundColor: active ? 'rgba(255,255,255,0.74)' : 'rgba(255,255,255,0.1)',
              boxShadow: active ? '0 6px 12px rgba(95,121,255,0.16)' : 'none',
              boxSizing: 'border-box',
              pointerEvents: 'auto',
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {active ? (
              <div
                style={{
                  position: 'absolute',
                  top: 6,
                  left: 7,
                  right: 7,
                  height: 30,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <button
                  type="button"
                  onPointerDown={(event) => startDrag(event, annotation, renderAnnotation, 'move')}
                  onPointerMove={moveDrag}
                  onPointerUp={finishDrag}
                  onPointerCancel={() => { pointerDragRef.current = null; }}
                  style={{
                    minWidth: 54,
                    height: 30,
                    borderRadius: 999,
                    border: '1px solid #DDE5F5',
                    backgroundColor: '#FFFFFF',
                    cursor: 'grab',
                  }}
                >
                  <MaterialCommunityIcons name="drag-horizontal-variant" size={17} color="#4B5565" />
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    type="button"
                    onClick={() => changeFontSize(annotation, -1)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      border: '1px solid #DDE5F5',
                      backgroundColor: '#FFFFFF',
                      cursor: 'pointer',
                    }}
                  >
                    <MaterialCommunityIcons name="minus" size={14} color="#4B5565" />
                  </button>
                  <div style={{ minWidth: 28, height: 28, borderRadius: 999, display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF3FF', color: '#4F63D7', fontSize: 11, fontWeight: 800 }}>
                    {fontSize}
                  </div>
                  <button
                    type="button"
                    onClick={() => changeFontSize(annotation, 1)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: 999,
                      border: '1px solid #DDE5F5',
                      backgroundColor: '#FFFFFF',
                      cursor: 'pointer',
                    }}
                  >
                    <MaterialCommunityIcons name="plus" size={14} color="#4B5565" />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => props.onRemove(annotation.id)}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 999,
                    border: '1px solid #FAD5D5',
                    backgroundColor: '#FFFFFF',
                    cursor: 'pointer',
                  }}
                >
                  <MaterialCommunityIcons name="close" size={14} color="#EF4444" />
                </button>
              </div>
            ) : null}
            <textarea
              ref={(node) => {
                textareaRefs.current[annotation.id] = node;
              }}
              value={annotation.text}
              onFocus={() => setActiveAnnotationId(annotation.id)}
              onChange={(event) => props.onChangeText(annotation.id, event.currentTarget.value)}
              placeholder="텍스트 입력"
              style={{
                width: '100%',
                height: '100%',
                minHeight: Math.max(32, frame.height - (active ? 56 : 24)),
                resize: 'none',
                border: 0,
                outline: 'none',
                backgroundColor: 'transparent',
                color: '#111827',
                fontSize,
                lineHeight: `${Math.round(fontSize * 1.35)}px`,
                fontWeight: 700,
                boxSizing: 'border-box',
              }}
            />
            {active ? (
              <button
                type="button"
                onPointerDown={(event) => startDrag(event, annotation, renderAnnotation, 'resize')}
                onPointerMove={moveDrag}
                onPointerUp={finishDrag}
                onPointerCancel={() => { pointerDragRef.current = null; }}
                style={{
                  position: 'absolute',
                  right: -12,
                  bottom: -12,
                  width: 28,
                  height: 28,
                  borderRadius: 999,
                  border: '1px solid #BFD0FF',
                  backgroundColor: '#FFFFFF',
                  cursor: 'nwse-resize',
                }}
              >
                <MaterialCommunityIcons name="resize-bottom-right" size={13} color="#5F79FF" />
              </button>
            ) : (
              <button
                type="button"
                aria-label="텍스트 메모 선택"
                onClick={() => activate(annotation.id)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  border: 0,
                  background: 'transparent',
                  cursor: 'text',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
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
  imageAnnotations?: InkImageAnnotation[];
  textAnnotationVariant?: 'floating' | 'marker';
  selectionRect: SelectionRect | null;
  onCommitInkStroke: (stroke: InkStroke) => void;
  onRemoveInkStroke: (strokeId: string) => void;
  onAddTextAnnotation: (point: InkPoint) => void;
  onUpdateTextAnnotation: (id: string, text: string) => void;
  onRemoveTextAnnotation: (id: string) => void;
  onMoveTextAnnotation: (id: string, x: number, y: number) => void;
  onResizeTextAnnotation: (id: string, width: number, height: number) => void;
  onChangeTextAnnotationFontSize: (id: string, fontSize: number) => void;
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
  const [currentStroke, setCurrentStroke] = useState<InkStroke | null>(null);
  const [draftSelection, setDraftSelection] = useState<SelectionRect | null>(null);
  const [draftSelectionPageKey, setDraftSelectionPageKey] = useState<string | null>(null);
  const [openReferenceId, setOpenReferenceId] = useState<string | null>(null);
  const currentStrokeRef = useRef<InkStroke | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activePointerPageRef = useRef<NotebookPage | null>(null);
  const selectionOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveOriginRef = useRef<InkPoint | null>(null);
  const selectionMoveStartRectRef = useRef<SelectionRect | null>(null);
  const selectionResizeCornerRef = useRef<ResizeCorner | null>(null);
  const selectionResizeStartRectRef = useRef<SelectionRect | null>(null);
  const draftSelectionRef = useRef<SelectionRect | null>(null);
  const textTapRef = useRef<InkPoint | null>(null);
  const selectionPreviewRequestRef = useRef(0);
  const scrollbarDragRef = useRef<ScrollbarDragState | null>(null);
  const verticalScrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const horizontalScrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const [scrollbarTrackSizes, setScrollbarTrackSizes] = useState({ vertical: 0, horizontal: 0 });
  const pdfUri = useMemo(() => {
    if (typeof props.file === 'string') return props.file;
    if (typeof props.file === 'number') return Image.resolveAssetSource(props.file)?.uri ?? null;
    return props.file.uri ?? null;
  }, [props.file]);
  const { engine, snapshot, rootRef } = useWebPdfViewportEngine({
    sourceUri: pdfUri,
    currentPage: props.page,
    pageGap: WEB_PDF_PAGE_GAP,
    onDocumentLoaded: props.onDocumentLoaded,
    onPageChanged: props.onPageChanged,
    onOpenGeneratedPage: props.onOpenGeneratedPage,
  });
  const pageCount = snapshot.pageCount;
  const pageLabel = pageCount ? `${snapshot.currentPage} / ${pageCount}` : `${props.page}`;
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
  const pageTargets = useMemo(
    () => pageItems.map((page) => ({
      key: page.id,
      pageNumber: page.pageNumber,
      generatedPageId: page.generatedPageId,
      sourcePageNumber: page.pageNumber ?? page.insertAfterPage,
    })),
    [pageItems],
  );

  useEffect(() => {
    engine.setPageTargets(pageTargets);
  }, [engine, pageTargets]);
  const getPageCaptureReferences = (page: NotebookPage) => (
    (props.pageCaptureReferences ?? []).filter((reference) => {
      if (page.generatedPageId) return reference.page.kind === 'generated' && reference.page.pageId === page.generatedPageId;
      return reference.page.kind === 'pdf' && reference.page.pageNumber === page.pageNumber;
    })
  );
  const zoomLabel = formatZoomPercent(snapshot.scale);

  useEffect(() => {
    if (!openReferenceId) return;
    if (!(props.pageCaptureReferences ?? []).some((reference) => reference.id === openReferenceId)) {
      setOpenReferenceId(null);
    }
  }, [openReferenceId, props.pageCaptureReferences]);

  const getFrameForPage = (page: NotebookPage): PageFrame => {
    const sourcePageNumber = page.pageNumber ?? page.insertAfterPage;
    return engine.getFrameForTarget(page.id, sourcePageNumber);
  };

  const getRawPageStrokes = (page: NotebookPage) => (
    props.inkStrokes.filter((stroke) => (
      page.generatedPageId
        ? stroke.generatedPageId === page.generatedPageId
        : !stroke.generatedPageId && (!stroke.pageNumber || stroke.pageNumber === page.pageNumber)
    ))
  );

  const getPageStrokesForRender = (page: NotebookPage) => {
    const frame = getFrameForPage(page);
    return getRawPageStrokes(page).map((stroke) => scaleInkStrokeToViewportPageSize(stroke, frame.width, frame.height));
  };

  const getPageTextAnnotationsForRender = (page: NotebookPage) => {
    return props.textAnnotations.filter((annotation) => (
      page.generatedPageId
        ? annotation.generatedPageId === page.generatedPageId
        : !annotation.generatedPageId && annotation.pageNumber === page.pageNumber
    ));
  };

  const getPdfPageStrokesForCapture = (pageNumber: number, pageWidth: number, pageHeight: number) => {
    const pageStrokes = props.inkStrokes.filter((stroke) => !stroke.generatedPageId && (!stroke.pageNumber || stroke.pageNumber === pageNumber));
    return pageStrokes.map((stroke) => scaleInkStrokeToPageSize(stroke, pageWidth, pageHeight));
  };

  const getPdfPageTextAnnotationsForCapture = (pageNumber: number, pageWidth: number, pageHeight: number) => {
    const pageAnnotations = props.textAnnotations.filter((annotation) => !annotation.generatedPageId && annotation.pageNumber === pageNumber);
    return pageAnnotations.map((annotation) => scaleTextAnnotationToPageSize(annotation, pageWidth, pageHeight));
  };

  const zoomBy = useCallback((delta: number) => {
    engine.zoomBy(delta);
  }, [engine]);

  const verticalScrollRange = Math.max(0, snapshot.contentHeight - snapshot.viewportHeight);
  const horizontalScrollRange = Math.max(0, snapshot.contentWidth - snapshot.viewportWidth);
  const showHorizontalScrollbar = horizontalScrollRange > 1;
  const getScrollbarMetrics = useCallback((axis: 'x' | 'y', trackLength: number) => {
    const viewportLength = axis === 'y' ? snapshot.viewportHeight : snapshot.viewportWidth;
    const contentLength = axis === 'y' ? snapshot.contentHeight : snapshot.contentWidth;
    const pan = axis === 'y' ? snapshot.panY : snapshot.panX;
    const range = Math.max(0, contentLength - viewportLength);
    if (trackLength <= 0 || contentLength <= 0 || viewportLength <= 0 || range <= 0) {
      return { range, thumbLength: trackLength, thumbStart: 0, thumbTravel: 0 };
    }
    const thumbLength = Math.min(trackLength, Math.max(36, (viewportLength / contentLength) * trackLength));
    const thumbTravel = Math.max(0, trackLength - thumbLength);
    const clampedPan = Math.min(Math.max(pan, 0), range);
    const thumbStart = thumbTravel > 0 ? (clampedPan / range) * thumbTravel : 0;
    return { range, thumbLength, thumbStart, thumbTravel };
  }, [
    snapshot.contentHeight,
    snapshot.contentWidth,
    snapshot.panX,
    snapshot.panY,
    snapshot.viewportHeight,
    snapshot.viewportWidth,
  ]);
  const panFromScrollbarPointer = useCallback((axis: 'x' | 'y', clientPosition: number, drag: ScrollbarDragState) => {
    const metrics = getScrollbarMetrics(axis, drag.trackLength);
    if (metrics.range <= 0 || metrics.thumbTravel <= 0) return;
    const thumbStart = Math.max(0, Math.min(metrics.thumbTravel, clientPosition - drag.trackStart - drag.pointerOffset));
    const nextPan = (thumbStart / metrics.thumbTravel) * metrics.range;
    if (axis === 'y') {
      engine.panTo(snapshot.panX, nextPan);
    } else {
      engine.panTo(nextPan, snapshot.panY);
    }
  }, [engine, getScrollbarMetrics, snapshot.panX, snapshot.panY]);
  const startScrollbarDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, axis: 'x' | 'y') => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const track = event.currentTarget.parentElement;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const trackStart = axis === 'y' ? rect.top : rect.left;
    const trackLength = axis === 'y' ? rect.height : rect.width;
    const metrics = getScrollbarMetrics(axis, trackLength);
    const clientPosition = axis === 'y' ? event.clientY : event.clientX;
    scrollbarDragRef.current = {
      axis,
      pointerId: event.pointerId,
      trackStart,
      trackLength,
      thumbLength: metrics.thumbLength,
      pointerOffset: clientPosition - trackStart - metrics.thumbStart,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [getScrollbarMetrics]);
  const handleScrollbarTrackPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>, axis: 'x' | 'y') => {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const trackStart = axis === 'y' ? rect.top : rect.left;
    const trackLength = axis === 'y' ? rect.height : rect.width;
    const metrics = getScrollbarMetrics(axis, trackLength);
    if (metrics.range <= 0 || metrics.thumbTravel <= 0) return;
    const clientPosition = axis === 'y' ? event.clientY : event.clientX;
    const drag = {
      axis,
      pointerId: event.pointerId,
      trackStart,
      trackLength,
      thumbLength: metrics.thumbLength,
      pointerOffset: metrics.thumbLength / 2,
    };
    panFromScrollbarPointer(axis, clientPosition, drag);
  }, [getScrollbarMetrics, panFromScrollbarPointer]);
  const handleScrollbarPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = scrollbarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    panFromScrollbarPointer(drag.axis, drag.axis === 'y' ? event.clientY : event.clientX, drag);
  }, [panFromScrollbarPointer]);
  const finishScrollbarDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = scrollbarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    scrollbarDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const updateTrackSizes = () => {
      const vertical = verticalScrollbarTrackRef.current?.getBoundingClientRect().height ?? 0;
      const horizontal = horizontalScrollbarTrackRef.current?.getBoundingClientRect().width ?? 0;
      setScrollbarTrackSizes((current) => (
        Math.abs(current.vertical - vertical) < 0.5 && Math.abs(current.horizontal - horizontal) < 0.5
          ? current
          : { vertical, horizontal }
      ));
    };
    const observer = new ResizeObserver(updateTrackSizes);
    if (verticalScrollbarTrackRef.current) observer.observe(verticalScrollbarTrackRef.current);
    if (horizontalScrollbarTrackRef.current) observer.observe(horizontalScrollbarTrackRef.current);
    updateTrackSizes();
    return () => observer.disconnect();
  }, [showHorizontalScrollbar]);

  const verticalScrollbarMetrics = getScrollbarMetrics('y', scrollbarTrackSizes.vertical || Math.max(0, snapshot.viewportHeight - (showHorizontalScrollbar ? 28 : 16)));
  const horizontalScrollbarMetrics = getScrollbarMetrics('x', scrollbarTrackSizes.horizontal || Math.max(0, snapshot.viewportWidth - 32));

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

  const buildSelectionPreview = async (page: NotebookPage, rect: SelectionRect | null) => {
    const pageNumber = page.pageNumber;
    if (!pageNumber) return null;
    const capturePageWidth = rect?.pageWidth ?? snapshot.pages[pageNumber]?.naturalWidth ?? snapshot.pages[pageNumber]?.width ?? 1;
    const capturePageHeight = rect?.pageHeight ?? snapshot.pages[pageNumber]?.naturalHeight ?? snapshot.pages[pageNumber]?.height ?? 1;
    return engine.capturePageRect(pageNumber, rect, (context) => {
      const captureStrokes = getPdfPageStrokesForCapture(pageNumber, capturePageWidth, capturePageHeight);
      captureStrokes.filter((stroke) => stroke.style === 'highlight').forEach((stroke) => drawPath(context, stroke, 0.72));
      getPdfPageTextAnnotationsForCapture(pageNumber, capturePageWidth, capturePageHeight).forEach((annotation) => drawTextAnnotation(context, annotation));
      captureStrokes.filter((stroke) => stroke.style !== 'highlight').forEach((stroke) => drawPath(context, stroke));
    });
  };

  const beginInteraction = (page: NotebookPage) => {
    engine.activateTarget({
      key: page.id,
      pageNumber: page.pageNumber,
      generatedPageId: page.generatedPageId,
      sourcePageNumber: page.pageNumber ?? page.insertAfterPage,
    });
  };

  const clearDraftSelection = () => {
    draftSelectionRef.current = null;
    setDraftSelection(null);
    setDraftSelectionPageKey(null);
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
        props.onSelectionPreviewChange?.(null);
        selectionPreviewRequestRef.current += 1;
        selectionResizeCornerRef.current = null;
        selectionResizeStartRectRef.current = null;
        selectionMoveOriginRef.current = null;
        selectionMoveStartRectRef.current = null;
        clearDraftSelection();
        selectionOriginRef.current = null;
        return;
      }
      if (rect && moveOrigin && moveStartRect) {
        const dx = rect.x - moveStartRect.x;
        const dy = rect.y - moveStartRect.y;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) props.onMoveSelection?.(dx, dy);
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          props.onSelectionPreviewChange?.(null);
          selectionPreviewRequestRef.current += 1;
        }
        selectionMoveOriginRef.current = null;
        selectionMoveStartRectRef.current = null;
        clearDraftSelection();
        selectionOriginRef.current = null;
        return;
      }
      if (rect && rect.width > 24 && rect.height > 24) {
        props.onSelectionChange(rect);
        const previewRequestId = selectionPreviewRequestRef.current + 1;
        selectionPreviewRequestRef.current = previewRequestId;
        props.onSelectionPreviewChange?.(null);
        void buildSelectionPreview(page, rect).then((uri) => {
          if (selectionPreviewRequestRef.current === previewRequestId) {
            props.onSelectionPreviewChange?.(uri);
          }
        });
      }
      clearDraftSelection();
      selectionOriginRef.current = null;
    }
    if (props.inkTool === 'text' && textTapRef.current) {
      props.onAddTextAnnotation(textTapRef.current);
      textTapRef.current = null;
    }
  };

  const renderPage = (page: NotebookPage) => {
    const frame = getFrameForPage(page);
    const pageStrokesForRender = getPageStrokesForRender(page);
    const pageTextAnnotationsForRender = getPageTextAnnotationsForRender(page);
    const active = page.generatedPageId ? page.generatedPageId === props.activeGeneratedPageId : page.pageNumber === props.page;
    const selectionRectStyle = active ? scaleSelectionRectToPageSize(props.selectionRect, frame.width, frame.height) : null;
    const draftSelectionStyle = draftSelectionPageKey === page.id
      ? scaleSelectionRectToPageSize(draftSelection, frame.width, frame.height)
      : null;
    const draftLassoPoints = draftSelectionStyle?.mode === 'lasso' ? draftSelectionStyle.path ?? [] : [];
    const draftRectStyle = draftSelectionStyle?.mode === 'lasso' ? null : draftSelectionStyle;
    const currentStrokeForRender = currentStroke && (page.generatedPageId ? currentStroke.generatedPageId === page.generatedPageId : currentStroke.pageNumber === page.pageNumber)
      ? scaleInkStrokeToViewportPageSize(currentStroke, frame.width, frame.height)
      : null;
    const pageReferences = getPageCaptureReferences(page);
    const activePageReference = pageReferences.find((reference) => reference.id === openReferenceId) ?? null;
    const activeReferenceIndex = activePageReference ? pageReferences.findIndex((reference) => reference.id === activePageReference.id) : -1;
    const activeReferenceImage = activePageReference ? getPageCaptureReferenceImageSource(activePageReference) : null;
    const imageReferenceCount = pageReferences.filter((reference) => reference.type === 'image').length;
    const referenceButtonLabel = imageReferenceCount > 0 ? `사진 ${imageReferenceCount}` : `자료 ${pageReferences.length}`;
    const incomingAsset = active ? props.incomingAssetSuggestion : null;
    const incomingAssetImage = incomingAsset ? getCaptureOriginalImageSource(incomingAsset) : null;
    const incomingAssetSummary = getCaptureAssetSummary(incomingAsset);
    const targetMeta = {
      key: page.id,
      pageNumber: page.pageNumber,
      generatedPageId: page.generatedPageId,
      sourcePageNumber: page.pageNumber ?? page.insertAfterPage,
    };
    const getPointerPoint = (event: React.PointerEvent<HTMLElement>, mode: 'draw' | 'annotate' = 'draw') => (
      engine.screenToTargetPoint(page.id, event.clientX, event.clientY, mode)
    );
    const clearPointerInteraction = () => {
      activePointerIdRef.current = null;
      activePointerPageRef.current = null;
    };
    const resetDraftInteraction = () => {
      currentStrokeRef.current = null;
      clearDraftSelection();
      selectionOriginRef.current = null;
      selectionMoveOriginRef.current = null;
      selectionMoveStartRectRef.current = null;
      selectionResizeCornerRef.current = null;
      selectionResizeStartRectRef.current = null;
      textTapRef.current = null;
      setCurrentStroke(null);
      clearPointerInteraction();
    };
    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
      if (!shouldCaptureDomPointer(props.inkTool, event, props.fingerDrawingEnabled)) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      activePointerIdRef.current = event.pointerId;
      activePointerPageRef.current = page;
      beginInteraction(page);
      const point = getPointerPoint(event, props.inkTool === 'text' ? 'annotate' : 'draw');
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
        const currentSelection = active ? props.selectionRect : null;
        const resizeCorner = getResizeCorner(currentSelection, point, 24 / Math.max(0.001, frame.scale));
        if (currentSelection && resizeCorner) {
          selectionResizeCornerRef.current = resizeCorner;
          selectionResizeStartRectRef.current = currentSelection;
          draftSelectionRef.current = currentSelection;
          setDraftSelection(currentSelection);
          setDraftSelectionPageKey(page.id);
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
          setDraftSelectionPageKey(page.id);
          return;
        }
        props.onSelectionChange(null);
        selectionPreviewRequestRef.current += 1;
        props.onSelectionPreviewChange?.(null);
        selectionOriginRef.current = point;
        const selectionMode = props.selectionMode ?? 'rect';
        const rect = { x: point.x, y: point.y, width: 0, height: 0, mode: selectionMode, path: selectionMode === 'lasso' ? [point] : undefined, pageWidth: point.pageWidth, pageHeight: point.pageHeight };
        draftSelectionRef.current = rect;
        setDraftSelection(rect);
        setDraftSelectionPageKey(page.id);
        return;
      }

      if (props.inkTool === 'text') {
        textTapRef.current = point;
        return;
      }

      if (props.inkTool === 'erase') {
        const hitTestStrokes = getRawPageStrokes(page).map((stroke) => scaleInkStrokeToLogicalHitTestSize(stroke, point.pageWidth, point.pageHeight, frame.scale));
        const hitStrokeId = findHitInkStrokeId(hitTestStrokes, point, 18 / Math.max(0.001, frame.scale));
        if (hitStrokeId) props.onRemoveInkStroke(hitStrokeId);
      }
    };
    const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      const point = getPointerPoint(event);
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
        const selectionMode = props.selectionMode ?? 'rect';
        const rect = selectionMode === 'lasso'
          ? (() => {
              const currentPath = draftSelectionRef.current?.path ?? [origin];
              const lastPoint = currentPath[currentPath.length - 1];
              const nextPath = !lastPoint || Math.hypot(lastPoint.x - point.x, lastPoint.y - point.y) > 5 / Math.max(0.001, frame.scale)
                ? [...currentPath, point]
                : currentPath;
              return getSelectionRectFromPoints(nextPath) ?? getSelectionRectFromDrag(origin, point, 'lasso');
            })()
          : getSelectionRectFromDrag(origin, point, 'rect');
        draftSelectionRef.current = rect;
        setDraftSelection(rect);
      }
    };
    const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
      if (activePointerIdRef.current !== event.pointerId) return;
      event.preventDefault();
      const stroke = currentStrokeRef.current;
      if (stroke && stroke.points.length > 1) props.onCommitInkStroke(finalizeInkStroke(stroke));
      finishSelection(activePointerPageRef.current ?? page);
      currentStrokeRef.current = null;
      setCurrentStroke(null);
      clearPointerInteraction();
    };

    return (
      <div
        key={page.id}
        id={page.pageNumber ? `bsnap-pdf-page-${page.pageNumber}` : `bsnap-page-${page.id}`}
        ref={(node) => engine.setTargetElement(targetMeta, node)}
        style={{
          width: frame.width,
          height: frame.height,
          left: frame.x - snapshot.panX,
          top: frame.y - snapshot.panY,
          backgroundColor: '#FFFFFF',
          boxShadow: '0 10px 18px rgba(24,36,54,0.08)',
          position: 'absolute',
          overflowAnchor: 'none',
          overflow: 'hidden',
        }}
      >
        {page.kind === 'pdf' && page.pageNumber ? (
          <>
            <canvas
              ref={(node) => {
                engine.setCanvasElement(page.pageNumber!, node);
              }}
              style={{
                display: 'block',
                position: 'absolute',
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                backgroundColor: '#FFFFFF',
              }}
            />
            <canvas
              ref={(node) => {
                engine.setHiResCanvasElement(page.pageNumber!, node);
              }}
              style={{
                display: 'none',
                position: 'absolute',
                left: 0,
                top: 0,
                width: 0,
                height: 0,
                pointerEvents: 'none',
              }}
            />
          </>
        ) : (
          <NotebookPaperBackground page={page} />
        )}

        <WebPdfInkCanvasLayer
          pageWidth={frame.width}
          pageHeight={frame.height}
          strokes={pageStrokesForRender}
          currentStroke={currentStrokeForRender}
        />

        <WebPdfTextAnnotationLayer
          annotations={pageTextAnnotationsForRender}
          pageWidth={frame.width}
          pageHeight={frame.height}
          onChangeText={props.onUpdateTextAnnotation}
          onChangeFontSize={props.onChangeTextAnnotationFontSize}
          onMove={(id, x, y) => {
            props.onMoveTextAnnotation(
              id,
              x,
              y,
            );
          }}
          onResize={(id, width, height) => {
            props.onResizeTextAnnotation(
              id,
              width,
              height,
            );
          }}
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
                <Text style={props.styles.pdfPageReferencePopoverPrimaryText}>AI로 물어보기</Text>
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
                <Text style={props.styles.pdfIncomingCaptureLabel}>새 {incomingAsset.type === 'image' ? '사진' : '자료'} 연결</Text>
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

        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            pointerEvents: props.inkTool === 'view' ? 'none' : 'auto',
            touchAction: props.inkTool === 'view' ? 'auto' : 'none',
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={resetDraftInteraction}
          onLostPointerCapture={clearPointerInteraction}
        >
          {!draftSelectionStyle && selectionRectStyle ? <SelectionOverlay rect={selectionRectStyle} styles={props.styles} pageWidth={frame.width} pageHeight={frame.height} /> : null}
          {draftLassoPoints.length > 1 ? <SelectionLassoOverlay points={draftLassoPoints} pageWidth={frame.width} pageHeight={frame.height} /> : null}
          {draftRectStyle ? <SelectionOverlay rect={draftRectStyle} styles={props.styles} pageWidth={frame.width} pageHeight={frame.height} draft /> : null}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        flex: 1,
        width: '100%',
        minHeight: 0,
        overflow: 'hidden',
        backgroundColor: '#EFF2F8',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
      }}
    >
      <div
        ref={rootRef}
        style={{
          width: '100%',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          overscrollBehavior: 'contain',
          overflowAnchor: 'none',
          touchAction: 'none',
          boxSizing: 'border-box',
          position: 'relative',
          cursor: props.inkTool === 'view' ? 'default' : 'crosshair',
        }}
      >
        {pageItems.map(renderPage)}
        {snapshot.isLoading ? (
          <div style={{ position: 'absolute', top: 18, left: 0, right: 0, textAlign: 'center', color: '#6B7280', fontWeight: 700 }}>
            PDF 페이지를 렌더링하는 중...
          </div>
        ) : null}
        {!snapshot.isLoading && snapshot.loadError ? (
          <div style={{ position: 'absolute', top: 18, left: 0, right: 0, color: '#6B7280', textAlign: 'center', padding: '0 24px' }}>{snapshot.loadError}</div>
        ) : null}
      </div>
      <div
        ref={verticalScrollbarTrackRef}
        aria-label="PDF vertical scrollbar"
        role="scrollbar"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={Math.round(verticalScrollRange)}
        aria-valuenow={Math.round(snapshot.panY)}
        style={{
          ...scrollbarTrackBaseStyle,
          top: 8,
          right: 5,
          bottom: showHorizontalScrollbar ? 22 : 8,
          width: 10,
        }}
        onPointerDown={(event) => handleScrollbarTrackPointerDown(event, 'y')}
      >
        <div
          style={{
            ...scrollbarThumbBaseStyle,
            top: verticalScrollbarMetrics.thumbStart,
            right: 1,
            width: 8,
            height: verticalScrollbarMetrics.thumbLength,
            opacity: verticalScrollRange > 0 ? 1 : 0.52,
            cursor: 'default',
          }}
          onPointerDown={(event) => startScrollbarDrag(event, 'y')}
          onPointerMove={handleScrollbarPointerMove}
          onPointerUp={finishScrollbarDrag}
          onPointerCancel={finishScrollbarDrag}
          onLostPointerCapture={finishScrollbarDrag}
        />
      </div>
      {showHorizontalScrollbar ? (
        <div
          ref={horizontalScrollbarTrackRef}
          aria-label="PDF horizontal scrollbar"
          role="scrollbar"
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={Math.round(horizontalScrollRange)}
          aria-valuenow={Math.round(snapshot.panX)}
          style={{
            ...scrollbarTrackBaseStyle,
            left: 8,
            right: 24,
            bottom: 6,
            height: 10,
          }}
          onPointerDown={(event) => handleScrollbarTrackPointerDown(event, 'x')}
        >
          <div
            style={{
              ...scrollbarThumbBaseStyle,
              left: horizontalScrollbarMetrics.thumbStart,
              top: 1,
              width: horizontalScrollbarMetrics.thumbLength,
              height: 8,
              cursor: 'default',
            }}
            onPointerDown={(event) => startScrollbarDrag(event, 'x')}
            onPointerMove={handleScrollbarPointerMove}
            onPointerUp={finishScrollbarDrag}
            onPointerCancel={finishScrollbarDrag}
            onLostPointerCapture={finishScrollbarDrag}
          />
        </div>
      ) : null}
      <div
        aria-label="Current PDF page"
        style={{
          ...floatingControlBaseStyle,
          left: 18,
          padding: '0 12px',
          color: '#5F636A',
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {pageLabel}
      </div>
      <div
        aria-label="PDF zoom controls"
        style={{
          ...floatingControlBaseStyle,
          right: 18,
          gap: 0,
          padding: '1px 3px',
        }}
      >
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          style={floatingControlButtonStyle}
          onClick={() => zoomBy(-WEB_PDF_ZOOM_STEP)}
        >
          -
        </button>
        <div style={floatingControlDividerStyle} />
        <div
          aria-label="Current zoom"
          style={{
            minWidth: 42,
            padding: '0 4px',
            textAlign: 'center',
            color: '#4F5560',
            fontSize: 12,
            fontWeight: 800,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {zoomLabel}
        </div>
        <div style={floatingControlDividerStyle} />
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          style={floatingControlButtonStyle}
          onClick={() => zoomBy(WEB_PDF_ZOOM_STEP)}
        >
          +
        </button>
      </div>
    </div>
  );
}
