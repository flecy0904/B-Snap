import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';

type PdfJsViewport = { width: number; height: number };
type PdfJsRenderTask = { promise: Promise<void>; cancel?: () => void };
type PdfJsPage = {
  getViewport: (options: { scale: number }) => PdfJsViewport;
  render: (params: { canvasContext: CanvasRenderingContext2D; viewport: PdfJsViewport; transform?: number[] }) => PdfJsRenderTask;
};
type PdfJsDocument = {
  numPages: number;
  getPage: (pageNumber: number) => Promise<PdfJsPage>;
  destroy?: () => void;
};
type PdfJsDocumentSource = string | { url: string; withCredentials?: boolean; disableWorker?: boolean } | { data: Uint8Array; disableWorker?: boolean };

export type WebPdfZoomMode = 'fit' | 'manual';

export type WebPdfPageFrame = {
  pageNumber: number;
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  visible: boolean;
};

export type WebPdfViewportSnapshot = {
  isLoading: boolean;
  loadError: string | null;
  pageCount: number;
  currentPage: number;
  zoomMode: WebPdfZoomMode;
  scale: number;
  panX: number;
  panY: number;
  pages: Record<number, WebPdfPageFrame>;
  viewportWidth: number;
  viewportHeight: number;
  contentWidth: number;
  contentHeight: number;
};

type WebPdfTarget = {
  key: string;
  pageNumber?: number;
  generatedPageId?: string;
  sourcePageNumber?: number;
};

type CaptureRect = { x: number; y: number; width: number; height: number };
type WebPdfPoint = {
  x: number;
  y: number;
  pageNumber?: number;
  generatedPageId?: string;
  pageWidth: number;
  pageHeight: number;
};
type ViewportAnchor = { viewportX: number; viewportY: number };
type PageAnchor = {
  targetKey?: string;
  pageNumber: number;
  pageX: number;
  pageY: number;
  viewportX: number;
  viewportY: number;
};
type WebPdfHiResRequest = {
  pageNumber: number;
  targetWidth: number;
  regionX: number;
  regionY: number;
  regionWidth: number;
  regionHeight: number;
};

type WebPdfViewportEngineCallbacks = {
  onDocumentLoaded?: (pageCount: number) => void;
  onPageChanged?: (page: number) => void;
  onOpenGeneratedPage?: (pageId: string) => void;
};

type UseWebPdfViewportEngineOptions = WebPdfViewportEngineCallbacks & {
  sourceUri: string | null;
  currentPage: number;
  pageGap: number;
};

const WEB_PDF_MIN_ZOOM = 0.5;
const WEB_PDF_MAX_ZOOM = 3;
const WEB_PDF_RENDER_IDLE_MS = 50;
const WEB_PDF_HI_RES_RENDER_IDLE_MS = 120;
const WEB_PDF_VIEWPORT_NOTIFY_MS = 32;
const WEB_PDF_PAGE_NOTIFY_MS = 80;
const WEB_PDF_WHEEL_ZOOM_SENSITIVITY = 0.0016;
const WEB_PDF_ZOOM_GESTURE_IDLE_MS = 180;
const WEB_PDF_HORIZONTAL_PADDING = 40;
const WEB_PDF_VERTICAL_PADDING = 18;
const WEB_PDF_FALLBACK_WIDTH = 820;
const WEB_PDF_FALLBACK_HEIGHT = 1060;
const WEB_PDF_WORKER_SRC = '/pdf.worker.min.js';
const WEB_PDF_BASE_RENDER_MIN_WIDTH = 900;
const WEB_PDF_BASE_RENDER_MAX_WIDTH = 1800;
const WEB_PDF_HI_RES_MAX_PAGE_WIDTH = 3600;
const WEB_PDF_HI_RES_MAX_REGION_AREA = 12000000;
const WEB_PDF_HI_RES_OVERSCAN_RATIO = 0.3;

pdfjsLib.GlobalWorkerOptions.workerSrc = WEB_PDF_WORKER_SRC;

function clampZoom(value: number) {
  return Math.max(WEB_PDF_MIN_ZOOM, Math.min(WEB_PDF_MAX_ZOOM, value));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
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

function createPdfDocumentSource(uri: string, disableWorker = false): PdfJsDocumentSource {
  if (uri.startsWith('data:application/pdf')) {
    return { data: dataUriToBytes(uri), disableWorker };
  }
  return { url: uri, withCredentials: false, disableWorker };
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

function normalizeWheelDelta(event: WheelEvent) {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    return { x: event.deltaX * 16, y: event.deltaY * 16 };
  }
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    return { x: event.deltaX * 800, y: event.deltaY * 800 };
  }
  return { x: event.deltaX, y: event.deltaY };
}

function shouldIgnoreWheelTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('textarea,input,select,[contenteditable="true"]'));
}

function buildRenderPriority(currentPage: number, pageCount: number, direction: number) {
  const offsets = direction > 0
    ? [0, 1, 2, 3, -1, 4, -2]
    : direction < 0
      ? [0, -1, -2, -3, 1, -4, 2]
      : [0, -1, 1, -2, 2, 3, -3];
  const pages: number[] = [];
  offsets.forEach((offset) => {
    const pageNumber = currentPage + offset;
    if (pageNumber >= 1 && pageNumber <= pageCount && !pages.includes(pageNumber)) {
      pages.push(pageNumber);
    }
  });
  return pages;
}

function makeDefaultSnapshot(): WebPdfViewportSnapshot {
  return {
    isLoading: false,
    loadError: null,
    pageCount: 0,
    currentPage: 1,
    zoomMode: 'fit',
    scale: 1,
    panX: 0,
    panY: 0,
    pages: {},
    viewportWidth: 0,
    viewportHeight: 0,
    contentWidth: 0,
    contentHeight: 0,
  };
}

export class WebPdfViewportEngine {
  private rootElement: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private callbacks: WebPdfViewportEngineCallbacks = {};
  private notifySnapshot: (snapshot: WebPdfViewportSnapshot) => void;
  private snapshot: WebPdfViewportSnapshot = makeDefaultSnapshot();
  private document: PdfJsDocument | null = null;
  private loadTask: { promise: Promise<unknown>; destroy?: () => void } | null = null;
  private loadGeneration = 0;
  private renderGeneration = 0;
  private hiResGeneration = 0;
  private targets = new Map<string, WebPdfTarget>();
  private orderedTargets: WebPdfTarget[] = [];
  private targetFrames = new Map<string, WebPdfPageFrame>();
  private layoutFrames: Array<{ targetKey: string; frame: WebPdfPageFrame }> = [];
  private canvasElements = new Map<number, HTMLCanvasElement>();
  private hiResCanvasElements = new Map<number, HTMLCanvasElement>();
  private naturalPages: Record<number, { width: number; height: number }> = {};
  private renderTasks = new Map<number, PdfJsRenderTask>();
  private hiResRenderTasks = new Map<number, PdfJsRenderTask>();
  private renderQueue: number[] = [];
  private hiResRenderQueue: WebPdfHiResRequest[] = [];
  private renderRunning = false;
  private hiResRenderRunning = false;
  private wantedRenderPages = new Set<number>();
  private renderedPageKeys = new Map<number, string>();
  private hiResOverlayRequests = new Map<number, WebPdfHiResRequest>();
  private hiResInFlightRequests = new Map<number, WebPdfHiResRequest>();
  private wantedHiResPages = new Set<number>();
  private targetDetachTimers = new Map<string, number>();
  private canvasDetachTimers = new Map<number, number>();
  private hiResCanvasDetachTimers = new Map<number, number>();
  private renderTimer: number | null = null;
  private hiResRenderTimer: number | null = null;
  private snapshotTimer: number | null = null;
  private pageTimer: number | null = null;
  private zoomGestureTimer: number | null = null;
  private zoomGestureAnchor: PageAnchor | null = null;
  private panDirection = 0;
  private lastNotifiedPage = 0;
  private manualScale = 1;
  private pageGap: number;

  constructor(notifySnapshot: (snapshot: WebPdfViewportSnapshot) => void, pageGap: number) {
    this.notifySnapshot = notifySnapshot;
    this.pageGap = pageGap;
  }

  setCallbacks(callbacks: WebPdfViewportEngineCallbacks) {
    this.callbacks = callbacks;
  }

  setRootElement(element: HTMLDivElement | null) {
    if (this.rootElement === element) return;
    if (this.rootElement) {
      this.rootElement.removeEventListener('wheel', this.handleWheel);
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.rootElement = element;
    if (this.rootElement) {
      this.rootElement.addEventListener('wheel', this.handleWheel, { passive: false });
      this.resizeObserver = new ResizeObserver(() => this.measureViewport());
      this.resizeObserver.observe(this.rootElement);
      this.measureViewport();
    }
  }

  setCallbacksPageGap(pageGap: number) {
    if (this.pageGap === pageGap) return;
    this.pageGap = pageGap;
    this.relayoutKeepingViewportCenter();
  }

  setTargetElement(target: WebPdfTarget, element: HTMLElement | null) {
    const pendingDetach = this.targetDetachTimers.get(target.key);
    if (pendingDetach) {
      window.clearTimeout(pendingDetach);
      this.targetDetachTimers.delete(target.key);
    }
    if (!element) {
      const timer = window.setTimeout(() => {
        this.targets.delete(target.key);
        this.targetDetachTimers.delete(target.key);
      }, 0);
      this.targetDetachTimers.set(target.key, timer);
      return;
    }
    this.targets.set(target.key, target);
  }

  setPageTargets(targets: WebPdfTarget[]) {
    const nextKey = targets.map((target) => `${target.key}:${target.pageNumber ?? ''}:${target.generatedPageId ?? ''}:${target.sourcePageNumber ?? ''}`).join('|');
    const currentKey = this.orderedTargets.map((target) => `${target.key}:${target.pageNumber ?? ''}:${target.generatedPageId ?? ''}:${target.sourcePageNumber ?? ''}`).join('|');
    if (nextKey === currentKey) return;
    this.orderedTargets = targets;
    targets.forEach((target) => this.targets.set(target.key, target));
    this.relayoutKeepingViewportCenter();
  }

  setCanvasElement(pageNumber: number, element: HTMLCanvasElement | null) {
    const pendingDetach = this.canvasDetachTimers.get(pageNumber);
    if (pendingDetach) {
      window.clearTimeout(pendingDetach);
      this.canvasDetachTimers.delete(pageNumber);
    }
    if (!element) {
      const timer = window.setTimeout(() => {
        this.canvasElements.delete(pageNumber);
        this.renderedPageKeys.delete(pageNumber);
        this.cancelRenderTask(pageNumber);
        this.canvasDetachTimers.delete(pageNumber);
      }, 0);
      this.canvasDetachTimers.set(pageNumber, timer);
      return;
    }
    if (this.canvasElements.get(pageNumber) === element) return;
    this.canvasElements.set(pageNumber, element);
    this.renderedPageKeys.delete(pageNumber);
    this.scheduleVisibleRenders(0);
  }

  setHiResCanvasElement(pageNumber: number, element: HTMLCanvasElement | null) {
    const pendingDetach = this.hiResCanvasDetachTimers.get(pageNumber);
    if (pendingDetach) {
      window.clearTimeout(pendingDetach);
      this.hiResCanvasDetachTimers.delete(pageNumber);
    }
    if (!element) {
      const timer = window.setTimeout(() => {
        this.hiResCanvasElements.delete(pageNumber);
        this.cancelHiResRenderTask(pageNumber);
        this.hiResCanvasDetachTimers.delete(pageNumber);
      }, 0);
      this.hiResCanvasDetachTimers.set(pageNumber, timer);
      return;
    }
    if (this.hiResCanvasElements.get(pageNumber) === element) return;
    this.hiResCanvasElements.set(pageNumber, element);
    this.hideHiResCanvas(element);
    this.scheduleHiResOverlayRender(WEB_PDF_HI_RES_RENDER_IDLE_MS);
  }

  setExternalPage(pageNumber: number, panIntoView = false) {
    if (!Number.isFinite(pageNumber) || pageNumber <= 0) return;
    const nextPage = clamp(Math.round(pageNumber), 1, Math.max(1, this.snapshot.pageCount || pageNumber));
    if (panIntoView) {
      if (!this.panToPage(nextPage)) {
        this.snapshot = { ...this.snapshot, currentPage: nextPage };
        this.scheduleSnapshot();
      }
      return;
    }
    if (this.snapshot.currentPage === nextPage) return;
    this.snapshot = { ...this.snapshot, currentPage: nextPage };
    this.scheduleSnapshot();
  }

  async setSourceUri(uri: string | null) {
    this.loadGeneration += 1;
    const generation = this.loadGeneration;
    this.cancelAllRenders();
    this.cancelHiResOverlayRenders(true);
    this.loadTask?.destroy?.();
    this.document?.destroy?.();
    this.document = null;
    this.loadTask = null;
    this.naturalPages = {};
    this.snapshot = {
      ...makeDefaultSnapshot(),
      currentPage: Math.max(1, this.snapshot.currentPage),
      viewportWidth: this.snapshot.viewportWidth,
      viewportHeight: this.snapshot.viewportHeight,
    };
    this.emitSnapshotNow();

    if (!uri) {
      this.snapshot = {
        ...this.snapshot,
        loadError: 'No PDF is selected.',
      };
      this.emitSnapshotNow();
      return;
    }

    this.snapshot = { ...this.snapshot, isLoading: true, loadError: null };
    this.emitSnapshotNow();

    try {
      const document = await this.loadPdfDocument(uri, generation);
      if (generation !== this.loadGeneration) {
        document.destroy?.();
        return;
      }
      this.document = document;
      const requestedPage = this.snapshot.currentPage;
      const clampedPage = Math.min(Math.max(1, requestedPage), Math.max(1, document.numPages));
      const firstPage = await document.getPage(1);
      const firstViewport = firstPage.getViewport({ scale: 1 });
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        this.naturalPages[pageNumber] = { width: firstViewport.width, height: firstViewport.height };
      }
      this.snapshot = {
        ...this.snapshot,
        isLoading: false,
        pageCount: document.numPages,
        currentPage: clampedPage,
        zoomMode: 'fit',
        scale: 1,
        panX: 0,
        panY: 0,
        pages: {},
        loadError: null,
      };
      this.callbacks.onDocumentLoaded?.(document.numPages);
      if (requestedPage !== clampedPage) this.callbacks.onPageChanged?.(clampedPage);
      this.layoutPages();
      this.panToPage(clampedPage, false);
      this.scheduleVisibleRenders(0);
      this.scheduleHiResOverlayRender(WEB_PDF_HI_RES_RENDER_IDLE_MS);
      void this.loadNaturalPageSizes(document, generation);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      console.warn('[WebPdfViewportEngine] Failed to load PDF document.', error);
      this.snapshot = {
        ...this.snapshot,
        isLoading: false,
        loadError: 'Failed to load PDF.',
      };
      this.emitSnapshotNow();
    }
  }

  zoomBy(delta: number, anchor?: ViewportAnchor) {
    this.applyZoom(clampZoom(this.snapshot.scale + delta), anchor ?? this.getViewportCenterAnchor(), false);
  }

  zoomByWheelEvent(event: WheelEvent) {
    const delta = normalizeWheelDelta(event);
    const nextScale = clampZoom((this.snapshot.scale || 1) * Math.exp(-delta.y * WEB_PDF_WHEEL_ZOOM_SENSITIVITY));
    this.applyZoom(nextScale, this.getViewportCenterAnchor(), true);
  }

  resetZoomToFit() {
    const anchor = this.resolvePageAnchor(this.getViewportCenterAnchor());
    this.manualScale = this.calculateFitScale();
    this.snapshot = { ...this.snapshot, zoomMode: 'fit' };
    this.cancelHiResOverlayRenders();
    this.layoutPages(anchor);
    this.scheduleVisibleRenders(0);
    this.scheduleHiResOverlayRender(WEB_PDF_HI_RES_RENDER_IDLE_MS);
  }

  panBy(dx: number, dy: number) {
    if (!this.snapshot.pageCount) return;
    const previousPanY = this.snapshot.panY;
    const nextPanX = this.clampPanX(this.snapshot.panX + dx);
    const nextPanY = this.clampPanY(this.snapshot.panY + dy);
    if (Math.abs(nextPanX - this.snapshot.panX) < 0.1 && Math.abs(nextPanY - this.snapshot.panY) < 0.1) return;
    const deltaY = nextPanY - previousPanY;
    if (Math.abs(deltaY) > 0.5) this.panDirection = deltaY > 0 ? 1 : -1;
    this.snapshot = {
      ...this.snapshot,
      panX: nextPanX,
      panY: nextPanY,
    };
    this.updateVisibility();
    this.updateCurrentPageFromPan();
    this.scheduleVisibleRenders(0);
    this.scheduleHiResOverlayRender(WEB_PDF_HI_RES_RENDER_IDLE_MS);
    this.scheduleSnapshot();
  }

  panToPage(pageNumber: number, notifyPageChanged = true) {
    const frame = this.snapshot.pages[pageNumber];
    if (!frame) return false;
    const panX = this.clampPanX(frame.x + frame.width / 2 - this.snapshot.viewportWidth / 2);
    const panY = this.clampPanY(frame.y - WEB_PDF_VERTICAL_PADDING);
    this.snapshot = {
      ...this.snapshot,
      currentPage: pageNumber,
      panX,
      panY,
    };
    this.updateVisibility();
    if (notifyPageChanged) this.queuePageChanged(pageNumber);
    this.scheduleVisibleRenders(0);
    this.scheduleHiResOverlayRender(WEB_PDF_HI_RES_RENDER_IDLE_MS);
    this.scheduleSnapshot();
    return true;
  }

  scrollToPage(pageNumber: number) {
    return this.panToPage(pageNumber);
  }

  activateTarget(target: WebPdfTarget) {
    this.targets.set(target.key, target);
    if (target.generatedPageId) this.callbacks.onOpenGeneratedPage?.(target.generatedPageId);
    if (target.pageNumber) {
      this.snapshot = { ...this.snapshot, currentPage: target.pageNumber };
      this.queuePageChanged(target.pageNumber);
      this.scheduleSnapshot();
    }
  }

  getFrameForSourcePage(pageNumber: number | undefined) {
    if (!pageNumber) return this.getFallbackFrame();
    return this.snapshot.pages[pageNumber] ?? this.getFallbackFrame();
  }

  getFrameForTarget(targetKey: string, sourcePageNumber: number | undefined) {
    return this.targetFrames.get(targetKey) ?? this.getFrameForSourcePage(sourcePageNumber);
  }

  private documentPointToLogicalPoint(
    frame: WebPdfPageFrame,
    documentX: number,
    documentY: number,
    mode: 'draw' | 'annotate',
  ): WebPdfPoint {
    const logicalWidth = Math.max(1, frame.naturalWidth);
    const logicalHeight = Math.max(1, frame.naturalHeight);
    const logicalX = ((documentX - frame.x) / Math.max(1, frame.width)) * logicalWidth;
    const logicalY = ((documentY - frame.y) / Math.max(1, frame.height)) * logicalHeight;
    const annotateWidth = mode === 'annotate' ? 220 : 0;
    const annotateHeight = mode === 'annotate' ? 110 : 0;
    return {
      x: clamp(logicalX, 0, Math.max(0, logicalWidth - annotateWidth)),
      y: clamp(logicalY, 0, Math.max(0, logicalHeight - annotateHeight)),
      pageWidth: logicalWidth,
      pageHeight: logicalHeight,
    };
  }

  screenToPage(clientX: number, clientY: number, mode: 'draw' | 'annotate' = 'draw') {
    const rootRect = this.rootElement?.getBoundingClientRect();
    if (!rootRect) return null;
    const documentX = this.snapshot.panX + clientX - rootRect.left;
    const documentY = this.snapshot.panY + clientY - rootRect.top;
    const frame = this.findFrameAtDocumentPoint(documentX, documentY) ?? this.findNearestFrame(documentY);
    if (!frame) return null;
    return {
      ...this.documentPointToLogicalPoint(frame, documentX, documentY, mode),
      pageNumber: frame.pageNumber,
    };
  }

  screenToTargetPoint(targetKey: string, clientX: number, clientY: number, mode: 'draw' | 'annotate' = 'draw') {
    const target = this.targets.get(targetKey);
    if (!target) return null;
    const rootRect = this.rootElement?.getBoundingClientRect();
    if (!rootRect) return null;
    const sourcePageNumber = target.sourcePageNumber ?? target.pageNumber;
    const frame = this.targetFrames.get(targetKey) ?? this.getFrameForSourcePage(sourcePageNumber);
    const documentX = this.snapshot.panX + clientX - rootRect.left;
    const documentY = this.snapshot.panY + clientY - rootRect.top;
    return {
      ...this.documentPointToLogicalPoint(frame, documentX, documentY, mode),
      pageNumber: target.pageNumber,
      generatedPageId: target.generatedPageId,
    };
  }

  pageToScreen(pageNumber: number, x: number, y: number) {
    const rootRect = this.rootElement?.getBoundingClientRect();
    const frame = this.snapshot.pages[pageNumber];
    if (!rootRect || !frame) return null;
    return {
      x: rootRect.left + frame.x + (x / Math.max(1, frame.naturalWidth)) * frame.width - this.snapshot.panX,
      y: rootRect.top + frame.y + (y / Math.max(1, frame.naturalHeight)) * frame.height - this.snapshot.panY,
    };
  }

  async capturePageRect(
    pageNumber: number,
    rect: CaptureRect | null,
    paintOverlay?: (context: CanvasRenderingContext2D) => void,
  ) {
    if (!rect || !this.document) return null;
    const frame = this.snapshot.pages[pageNumber];
    if (!frame) return null;
    const renderScale = Math.max(2, window.devicePixelRatio || 1, frame.scale);
    const pdfPage = await this.document.getPage(pageNumber);
    const viewport = pdfPage.getViewport({ scale: renderScale });
    const renderCanvas = document.createElement('canvas');
    renderCanvas.width = Math.max(1, Math.floor(viewport.width));
    renderCanvas.height = Math.max(1, Math.floor(viewport.height));
    const renderContext = renderCanvas.getContext('2d');
    if (!renderContext) return null;
    const renderTask = pdfPage.render({ canvasContext: renderContext, viewport });
    await withTimeout(renderTask.promise, 12000, 'PDF selection render timed out.');

    const rectScaleX = renderCanvas.width / Math.max(1, frame.naturalWidth);
    const rectScaleY = renderCanvas.height / Math.max(1, frame.naturalHeight);
    const cropCanvas = document.createElement('canvas');
    cropCanvas.width = Math.max(1, Math.floor(rect.width * rectScaleX));
    cropCanvas.height = Math.max(1, Math.floor(rect.height * rectScaleY));
    const context = cropCanvas.getContext('2d');
    if (!context) return null;
    context.drawImage(
      renderCanvas,
      Math.floor(rect.x * rectScaleX),
      Math.floor(rect.y * rectScaleY),
      cropCanvas.width,
      cropCanvas.height,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height,
    );
    if (paintOverlay) {
      context.save();
      context.scale(rectScaleX, rectScaleY);
      context.translate(-rect.x, -rect.y);
      paintOverlay(context);
      context.restore();
    }
    return cropCanvas.toDataURL('image/png');
  }

  dispose() {
    this.setRootElement(null);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.cancelAllRenders();
    this.cancelHiResOverlayRenders(true);
    this.loadTask?.destroy?.();
    this.document?.destroy?.();
    if (this.renderTimer) window.clearTimeout(this.renderTimer);
    if (this.hiResRenderTimer) window.clearTimeout(this.hiResRenderTimer);
    if (this.snapshotTimer) window.clearTimeout(this.snapshotTimer);
    if (this.pageTimer) window.clearTimeout(this.pageTimer);
    if (this.zoomGestureTimer) window.clearTimeout(this.zoomGestureTimer);
    this.targetDetachTimers.forEach((timer) => window.clearTimeout(timer));
    this.canvasDetachTimers.forEach((timer) => window.clearTimeout(timer));
    this.hiResCanvasDetachTimers.forEach((timer) => window.clearTimeout(timer));
    this.targetDetachTimers.clear();
    this.canvasDetachTimers.clear();
    this.hiResCanvasDetachTimers.clear();
  }

  private async loadPdfDocument(uri: string, generation: number) {
    try {
      return await this.startPdfDocumentLoad(uri, generation, false);
    } catch (error) {
      if (generation !== this.loadGeneration) throw error;
      console.warn('[WebPdfViewportEngine] PDF worker load failed. Retrying without worker.', error);
      return this.startPdfDocumentLoad(uri, generation, true);
    }
  }

  private async startPdfDocumentLoad(uri: string, generation: number, disableWorker: boolean) {
    const task = pdfjsLib.getDocument(createPdfDocumentSource(uri, disableWorker) as unknown) as { promise: Promise<unknown>; destroy?: () => void };
    this.loadTask = task;
    try {
      return await withTimeout(task.promise as Promise<PdfJsDocument>, 12000, 'PDF document load timed out.');
    } finally {
      if (generation === this.loadGeneration && this.loadTask === task) {
        this.loadTask = null;
      }
    }
  }

  private async loadNaturalPageSizes(document: PdfJsDocument, generation: number) {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      if (generation !== this.loadGeneration) return;
      try {
        const page = await document.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 1 });
        this.naturalPages[pageNumber] = { width: viewport.width, height: viewport.height };
      } catch (error) {
        console.warn('[WebPdfViewportEngine] Failed to read page size.', error);
      }
    }
    if (generation !== this.loadGeneration) return;
    this.relayoutKeepingViewportCenter();
    this.scheduleVisibleRenders(WEB_PDF_RENDER_IDLE_MS);
    this.scheduleHiResOverlayRender(WEB_PDF_HI_RES_RENDER_IDLE_MS);
  }

  private measureViewport() {
    if (!this.rootElement) return;
    const rect = this.rootElement.getBoundingClientRect();
    const width = Math.max(0, Math.floor(rect.width));
    const height = Math.max(0, Math.floor(rect.height));
    if (width === this.snapshot.viewportWidth && height === this.snapshot.viewportHeight) return;
    const anchor = this.resolvePageAnchor(this.getViewportCenterAnchor());
    this.snapshot = {
      ...this.snapshot,
      viewportWidth: width,
      viewportHeight: height,
    };
    this.layoutPages(anchor);
    this.scheduleVisibleRenders(0);
    this.scheduleHiResOverlayRender(WEB_PDF_HI_RES_RENDER_IDLE_MS);
  }

  private relayoutKeepingViewportCenter() {
    const anchor = this.resolvePageAnchor(this.getViewportCenterAnchor());
    this.layoutPages(anchor);
    this.scheduleVisibleRenders(WEB_PDF_RENDER_IDLE_MS);
    this.scheduleHiResOverlayRender(WEB_PDF_HI_RES_RENDER_IDLE_MS);
  }

  private calculateFitScale() {
    const currentNatural = this.naturalPages[this.snapshot.currentPage] ?? this.naturalPages[1] ?? { width: WEB_PDF_FALLBACK_WIDTH };
    const targetWidth = Math.max(320, this.snapshot.viewportWidth || WEB_PDF_FALLBACK_WIDTH) - WEB_PDF_HORIZONTAL_PADDING * 2;
    return clampZoom(targetWidth / Math.max(1, currentNatural.width));
  }

  private layoutPages(anchor?: PageAnchor | null) {
    const scale = this.snapshot.zoomMode === 'fit' ? this.calculateFitScale() : clampZoom(this.manualScale || this.snapshot.scale);
    this.manualScale = this.snapshot.zoomMode === 'manual' ? scale : this.manualScale;
    const pageCount = this.snapshot.pageCount;
    const layoutTargets = this.orderedTargets.length
      ? this.orderedTargets
      : Array.from({ length: pageCount }, (_, index) => ({
          key: `pdf:${index + 1}`,
          pageNumber: index + 1,
          sourcePageNumber: index + 1,
        }));
    const measuredPages = layoutTargets.map((target, index) => {
      const sourcePageNumber = target.sourcePageNumber ?? target.pageNumber ?? index + 1;
      const natural = this.naturalPages[sourcePageNumber] ?? this.naturalPages[1] ?? {
        width: WEB_PDF_FALLBACK_WIDTH,
        height: WEB_PDF_FALLBACK_HEIGHT,
      };
      return {
        target,
        sourcePageNumber,
        naturalWidth: natural.width,
        naturalHeight: natural.height,
        width: Math.max(160, Math.round(natural.width * scale)),
        height: Math.max(160, Math.round(natural.height * scale)),
      };
    });
    const maxPageWidth = measuredPages.reduce((max, page) => Math.max(max, page.width), 0);
    const contentWidth = Math.max(this.snapshot.viewportWidth, maxPageWidth + WEB_PDF_HORIZONTAL_PADDING * 2, WEB_PDF_FALLBACK_WIDTH);
    let nextY = WEB_PDF_VERTICAL_PADDING;
    const pages: Record<number, WebPdfPageFrame> = {};
    this.targetFrames.clear();
    this.layoutFrames = [];
    measuredPages.forEach((page) => {
      const x = Math.max(WEB_PDF_HORIZONTAL_PADDING, Math.round((contentWidth - page.width) / 2));
      const frame: WebPdfPageFrame = {
        pageNumber: page.sourcePageNumber,
        naturalWidth: page.naturalWidth,
        naturalHeight: page.naturalHeight,
        x,
        y: nextY,
        width: page.width,
        height: page.height,
        scale,
        visible: false,
      };
      this.targetFrames.set(page.target.key, frame);
      this.layoutFrames.push({ targetKey: page.target.key, frame });
      if (page.target.pageNumber) {
        pages[page.target.pageNumber] = { ...frame, pageNumber: page.target.pageNumber };
      }
      nextY += page.height + this.pageGap;
    });
    const contentHeight = Math.max(this.snapshot.viewportHeight, nextY + WEB_PDF_VERTICAL_PADDING - this.pageGap);
    let panX = this.snapshot.panX;
    let panY = this.snapshot.panY;
    if (anchor) {
      const frame = anchor.targetKey ? this.targetFrames.get(anchor.targetKey) : pages[anchor.pageNumber];
      if (frame) {
        panX = frame.x + anchor.pageX * frame.scale - anchor.viewportX;
        panY = frame.y + anchor.pageY * frame.scale - anchor.viewportY;
      }
    }
    this.snapshot = {
      ...this.snapshot,
      scale,
      pages,
      contentWidth,
      contentHeight,
      panX: this.clampPanX(panX, contentWidth),
      panY: this.clampPanY(panY, contentHeight),
    };
    this.updateVisibility();
    this.scheduleSnapshot();
  }

  private updateVisibility() {
    const overscanX = this.snapshot.viewportWidth * 0.65;
    const overscanY = this.snapshot.viewportHeight * 0.9;
    const left = this.snapshot.panX - overscanX;
    const right = this.snapshot.panX + this.snapshot.viewportWidth + overscanX;
    const top = this.snapshot.panY - overscanY;
    const bottom = this.snapshot.panY + this.snapshot.viewportHeight + overscanY;
    let changed = false;
    const pages: Record<number, WebPdfPageFrame> = {};
    Object.values(this.snapshot.pages).forEach((frame) => {
      const visible = frame.x + frame.width >= left
        && frame.x <= right
        && frame.y + frame.height >= top
        && frame.y <= bottom;
      pages[frame.pageNumber] = visible === frame.visible ? frame : { ...frame, visible };
      if (visible !== frame.visible) changed = true;
    });
    if (changed) {
      this.snapshot = { ...this.snapshot, pages };
    }
  }

  private applyZoom(nextScale: number, anchor: ViewportAnchor, keepGestureAnchor: boolean) {
    const previousScale = this.snapshot.scale || 1;
    const scale = clampZoom(nextScale);
    if (Math.abs(scale - previousScale) < 0.001) return;
    const pageAnchor = keepGestureAnchor ? this.getWheelZoomGestureAnchor(anchor) : this.resolvePageAnchor(anchor);
    this.manualScale = scale;
    this.snapshot = {
      ...this.snapshot,
      zoomMode: 'manual',
      scale,
    };
    this.cancelHiResOverlayRenders();
    this.layoutPages(pageAnchor);
    this.scheduleVisibleRenders(0);
    this.scheduleHiResOverlayRender(WEB_PDF_HI_RES_RENDER_IDLE_MS);
  }

  private handleWheel = (event: WheelEvent) => {
    if (shouldIgnoreWheelTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = normalizeWheelDelta(event);
    if (event.ctrlKey || event.metaKey) {
      this.zoomByWheelEvent(event);
      return;
    }
    this.zoomGestureAnchor = null;
    if (this.zoomGestureTimer) {
      window.clearTimeout(this.zoomGestureTimer);
      this.zoomGestureTimer = null;
    }
    this.panBy(delta.x, delta.y);
  };

  private getWheelZoomGestureAnchor(anchor: ViewportAnchor) {
    if (!this.zoomGestureAnchor) {
      this.zoomGestureAnchor = this.resolvePageAnchor(anchor);
    }
    if (this.zoomGestureTimer) window.clearTimeout(this.zoomGestureTimer);
    this.zoomGestureTimer = window.setTimeout(() => {
      this.zoomGestureAnchor = null;
      this.zoomGestureTimer = null;
    }, WEB_PDF_ZOOM_GESTURE_IDLE_MS);
    return this.zoomGestureAnchor;
  }

  private getViewportCenterAnchor(): ViewportAnchor {
    return {
      viewportX: this.snapshot.viewportWidth / 2,
      viewportY: this.snapshot.viewportHeight / 2,
    };
  }

  private resolvePageAnchor(anchor: ViewportAnchor): PageAnchor | null {
    const documentX = this.snapshot.panX + anchor.viewportX;
    const documentY = this.snapshot.panY + anchor.viewportY;
    const frameEntry = this.findFrameEntryAtDocumentPoint(documentX, documentY) ?? this.findNearestFrameEntry(documentY);
    const frame = frameEntry?.frame ?? null;
    if (!frame) return null;
    return {
      targetKey: frameEntry?.targetKey,
      pageNumber: frame.pageNumber,
      pageX: clamp((documentX - frame.x) / Math.max(0.001, frame.scale), 0, frame.naturalWidth),
      pageY: clamp((documentY - frame.y) / Math.max(0.001, frame.scale), 0, frame.naturalHeight),
      viewportX: anchor.viewportX,
      viewportY: anchor.viewportY,
    };
  }

  private findFrameAtDocumentPoint(documentX: number, documentY: number) {
    return this.findFrameEntryAtDocumentPoint(documentX, documentY)?.frame ?? null;
  }

  private findFrameEntryAtDocumentPoint(documentX: number, documentY: number): { targetKey: string; frame: WebPdfPageFrame } | null {
    return this.layoutFrames.find(({ frame }) => (
        documentX >= frame.x
        && documentX <= frame.x + frame.width
        && documentY >= frame.y
        && documentY <= frame.y + frame.height
      )) ?? null;
  }

  private findNearestFrame(documentY: number) {
    return this.findNearestFrameEntry(documentY)?.frame ?? null;
  }

  private findNearestFrameEntry(documentY: number): { targetKey: string; frame: WebPdfPageFrame } | null {
    let best: { targetKey: string; frame: WebPdfPageFrame } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    this.layoutFrames.forEach((entry) => {
      const frame = entry.frame;
      const distance = Math.abs(documentY - (frame.y + frame.height / 2));
      if (distance < bestDistance) {
        best = entry;
        bestDistance = distance;
      }
    });
    return best;
  }

  private clampPanX(value: number, contentWidth = this.snapshot.contentWidth) {
    return clamp(value, 0, Math.max(0, contentWidth - this.snapshot.viewportWidth));
  }

  private clampPanY(value: number, contentHeight = this.snapshot.contentHeight) {
    return clamp(value, 0, Math.max(0, contentHeight - this.snapshot.viewportHeight));
  }

  private updateCurrentPageFromPan() {
    if (!this.snapshot.pageCount) return;
    const probeY = this.snapshot.panY + this.snapshot.viewportHeight * 0.38;
    let bestPage = this.snapshot.currentPage;
    let bestDistance = Number.POSITIVE_INFINITY;
    Object.values(this.snapshot.pages).forEach((frame) => {
      const distance = Math.abs((frame.y + frame.height / 2) - probeY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPage = frame.pageNumber;
      }
    });
    if (bestPage !== this.snapshot.currentPage) {
      this.snapshot = { ...this.snapshot, currentPage: bestPage };
      this.queuePageChanged(bestPage);
    }
  }

  private queuePageChanged(pageNumber: number) {
    if (this.lastNotifiedPage === pageNumber) return;
    this.lastNotifiedPage = pageNumber;
    if (this.pageTimer) window.clearTimeout(this.pageTimer);
    this.pageTimer = window.setTimeout(() => {
      this.callbacks.onPageChanged?.(pageNumber);
    }, WEB_PDF_PAGE_NOTIFY_MS);
  }

  private scheduleVisibleRenders(delayMs: number) {
    if (this.renderTimer) window.clearTimeout(this.renderTimer);
    this.renderTimer = window.setTimeout(() => {
      this.renderTimer = null;
      this.enqueueVisibleRenders();
    }, delayMs);
  }

  private enqueueVisibleRenders() {
    if (!this.document || !this.snapshot.pageCount) return;
    const visiblePages = Object.values(this.snapshot.pages)
      .filter((frame) => frame.visible)
      .sort((a, b) => {
        const centerY = this.snapshot.panY + this.snapshot.viewportHeight / 2;
        return Math.abs((a.y + a.height / 2) - centerY) - Math.abs((b.y + b.height / 2) - centerY);
      })
      .map((frame) => frame.pageNumber);
    const priority = Array.from(new Set([
      ...visiblePages,
      ...buildRenderPriority(this.snapshot.currentPage, this.snapshot.pageCount, this.panDirection),
    ]));
    this.wantedRenderPages = new Set(priority);
    this.renderTasks.forEach((task, pageNumber) => {
      if (!this.wantedRenderPages.has(pageNumber)) {
        task.cancel?.();
        this.renderTasks.delete(pageNumber);
      }
    });
    this.renderQueue = priority.filter((pageNumber) => this.canvasElements.has(pageNumber));
    void this.runRenderQueue(this.renderGeneration);
  }

  private async runRenderQueue(generation: number) {
    if (this.renderRunning || !this.document) return;
    this.renderRunning = true;
    try {
      while (this.renderQueue.length && this.document && generation === this.renderGeneration) {
        const pageNumber = this.renderQueue.shift();
        if (!pageNumber || !this.wantedRenderPages.has(pageNumber)) continue;
        await this.renderPage(pageNumber, generation);
      }
    } finally {
      this.renderRunning = false;
      if (this.renderQueue.length && this.document) {
        void this.runRenderQueue(this.renderGeneration);
      }
    }
  }

  private getBaseRenderTargetWidth() {
    const deviceScale = window.devicePixelRatio || 1;
    const viewportTarget = Math.round((this.snapshot.viewportWidth || WEB_PDF_FALLBACK_WIDTH) * deviceScale);
    return Math.round(clamp(viewportTarget, WEB_PDF_BASE_RENDER_MIN_WIDTH, WEB_PDF_BASE_RENDER_MAX_WIDTH));
  }

  private async renderPage(pageNumber: number, generation: number) {
    const canvas = this.canvasElements.get(pageNumber);
    const frame = this.snapshot.pages[pageNumber];
    if (!this.document || !canvas || !frame) return;
    const targetWidth = this.getBaseRenderTargetWidth();
    const renderKey = `${this.renderGeneration}:${frame.naturalWidth}:${frame.naturalHeight}:${targetWidth}`;
    if (this.renderedPageKeys.get(pageNumber) === renderKey && canvas.width > 0 && canvas.height > 0) return;
    this.cancelRenderTask(pageNumber);
    try {
      const page = await this.document.getPage(pageNumber);
      if (generation !== this.renderGeneration) return;
      const viewport = page.getViewport({ scale: targetWidth / Math.max(1, frame.naturalWidth) });
      const renderCanvas = document.createElement('canvas');
      renderCanvas.width = Math.max(1, Math.floor(viewport.width));
      renderCanvas.height = Math.max(1, Math.floor(viewport.height));
      const renderContext = renderCanvas.getContext('2d');
      if (!renderContext) return;
      const task = page.render({ canvasContext: renderContext, viewport });
      this.renderTasks.set(pageNumber, task);
      await withTimeout(task.promise, 12000, 'PDF page render timed out.');
      this.renderTasks.delete(pageNumber);
      if (generation !== this.renderGeneration || this.canvasElements.get(pageNumber) !== canvas) return;
      const visibleContext = canvas.getContext('2d');
      if (!visibleContext) return;
      canvas.width = renderCanvas.width;
      canvas.height = renderCanvas.height;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      visibleContext.setTransform(1, 0, 0, 1, 0, 0);
      visibleContext.clearRect(0, 0, canvas.width, canvas.height);
      visibleContext.drawImage(renderCanvas, 0, 0);
      this.renderedPageKeys.set(pageNumber, renderKey);
    } catch (error) {
      this.renderTasks.delete(pageNumber);
      if (String((error as Error)?.name) === 'RenderingCancelledException') return;
      console.warn('[WebPdfViewportEngine] Failed to render page.', error);
      this.snapshot = {
        ...this.snapshot,
        loadError: 'Failed to render PDF page.',
      };
      this.scheduleSnapshot();
    }
  }

  private scheduleHiResOverlayRender(delayMs: number) {
    if (this.hiResRenderTimer) window.clearTimeout(this.hiResRenderTimer);
    this.hiResRenderTimer = window.setTimeout(() => {
      this.hiResRenderTimer = null;
      this.enqueueHiResOverlayRenders();
    }, delayMs);
  }

  private enqueueHiResOverlayRenders() {
    if (!this.document || !this.snapshot.pageCount) return;
    const requests = this.buildVisibleHiResRequests();
    const wantedPages = new Set(requests.map((request) => request.pageNumber));
    this.wantedHiResPages = wantedPages;

    this.hiResCanvasElements.forEach((canvas, pageNumber) => {
      const frame = this.snapshot.pages[pageNumber];
      if (frame?.visible && !wantedPages.has(pageNumber)) {
        this.clearHiResOverlay(pageNumber, canvas);
      }
    });

    this.hiResRenderTasks.forEach((task, pageNumber) => {
      const request = requests.find((candidate) => candidate.pageNumber === pageNumber);
      const inFlight = this.hiResInFlightRequests.get(pageNumber);
      if (!request || !inFlight || !this.hiResRequestContains(inFlight, request)) {
        this.cancelHiResRenderTask(pageNumber);
      }
    });

    this.hiResRenderQueue = requests.filter((request) => {
      const canvas = this.hiResCanvasElements.get(request.pageNumber);
      if (!canvas) return false;
      const current = this.hiResOverlayRequests.get(request.pageNumber);
      const inFlight = this.hiResInFlightRequests.get(request.pageNumber);
      if (this.hiResRenderTasks.has(request.pageNumber) && inFlight && this.hiResRequestContains(inFlight, request)) return false;
      if (current && this.hiResRequestContains(current, request) && canvas.width > 0 && canvas.height > 0) return false;
      return true;
    });
    void this.runHiResRenderQueue(this.hiResGeneration);
  }

  private buildVisibleHiResRequests() {
    const centerY = this.snapshot.panY + this.snapshot.viewportHeight / 2;
    return Object.values(this.snapshot.pages)
      .filter((frame) => frame.visible && this.hiResCanvasElements.has(frame.pageNumber))
      .sort((a, b) => Math.abs((a.y + a.height / 2) - centerY) - Math.abs((b.y + b.height / 2) - centerY))
      .map((frame) => this.buildHiResRequest(frame))
      .filter((request): request is WebPdfHiResRequest => Boolean(request));
  }

  private buildHiResRequest(frame: WebPdfPageFrame): WebPdfHiResRequest | null {
    const deviceScale = window.devicePixelRatio || 1;
    const desiredPageWidth = Math.max(1, Math.round(frame.width * deviceScale));
    if (desiredPageWidth <= this.getBaseRenderTargetWidth() * 1.08) return null;

    const viewportLeft = this.snapshot.panX;
    const viewportTop = this.snapshot.panY;
    const viewportRight = viewportLeft + this.snapshot.viewportWidth;
    const viewportBottom = viewportTop + this.snapshot.viewportHeight;
    const overlapLeft = Math.max(frame.x, viewportLeft);
    const overlapTop = Math.max(frame.y, viewportTop);
    const overlapRight = Math.min(frame.x + frame.width, viewportRight);
    const overlapBottom = Math.min(frame.y + frame.height, viewportBottom);
    if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) return null;

    let regionX = (overlapLeft - frame.x) / Math.max(1, frame.width);
    let regionY = (overlapTop - frame.y) / Math.max(1, frame.height);
    let regionWidth = (overlapRight - overlapLeft) / Math.max(1, frame.width);
    let regionHeight = (overlapBottom - overlapTop) / Math.max(1, frame.height);
    const overscanX = regionWidth * WEB_PDF_HI_RES_OVERSCAN_RATIO;
    const overscanY = regionHeight * WEB_PDF_HI_RES_OVERSCAN_RATIO;
    const regionRight = Math.min(1, regionX + regionWidth + overscanX);
    const regionBottom = Math.min(1, regionY + regionHeight + overscanY);
    regionX = Math.max(0, regionX - overscanX);
    regionY = Math.max(0, regionY - overscanY);
    regionWidth = Math.max(0.001, regionRight - regionX);
    regionHeight = Math.max(0.001, regionBottom - regionY);

    let targetWidth = Math.min(desiredPageWidth, WEB_PDF_HI_RES_MAX_PAGE_WIDTH);
    const regionPixelWidth = targetWidth * regionWidth;
    const regionPixelHeight = targetWidth * (frame.naturalHeight / Math.max(1, frame.naturalWidth)) * regionHeight;
    const regionArea = regionPixelWidth * regionPixelHeight;
    if (regionArea > WEB_PDF_HI_RES_MAX_REGION_AREA) {
      targetWidth = Math.max(1, Math.floor(targetWidth * Math.sqrt(WEB_PDF_HI_RES_MAX_REGION_AREA / regionArea)));
    }

    return {
      pageNumber: frame.pageNumber,
      targetWidth: Math.round(targetWidth),
      regionX,
      regionY,
      regionWidth,
      regionHeight,
    };
  }

  private hiResRequestContains(current: WebPdfHiResRequest, needed: WebPdfHiResRequest) {
    const epsilon = 0.002;
    return current.pageNumber === needed.pageNumber
      && current.targetWidth >= needed.targetWidth * 0.92
      && current.regionX <= needed.regionX + epsilon
      && current.regionY <= needed.regionY + epsilon
      && current.regionX + current.regionWidth >= needed.regionX + needed.regionWidth - epsilon
      && current.regionY + current.regionHeight >= needed.regionY + needed.regionHeight - epsilon;
  }

  private async runHiResRenderQueue(generation: number) {
    if (this.hiResRenderRunning || !this.document) return;
    this.hiResRenderRunning = true;
    try {
      while (this.hiResRenderQueue.length && this.document && generation === this.hiResGeneration) {
        const request = this.hiResRenderQueue.shift();
        if (!request || !this.wantedHiResPages.has(request.pageNumber)) continue;
        await this.renderHiResOverlay(request, generation);
      }
    } finally {
      this.hiResRenderRunning = false;
      if (this.hiResRenderQueue.length && this.document) {
        void this.runHiResRenderQueue(this.hiResGeneration);
      }
    }
  }

  private async renderHiResOverlay(request: WebPdfHiResRequest, generation: number) {
    const canvas = this.hiResCanvasElements.get(request.pageNumber);
    const frame = this.snapshot.pages[request.pageNumber];
    if (!this.document || !canvas || !frame) return;
    this.cancelHiResRenderTask(request.pageNumber);
    this.hiResInFlightRequests.set(request.pageNumber, request);
    try {
      const page = await this.document.getPage(request.pageNumber);
      if (generation !== this.hiResGeneration) {
        this.hiResInFlightRequests.delete(request.pageNumber);
        return;
      }
      const viewport = page.getViewport({ scale: request.targetWidth / Math.max(1, frame.naturalWidth) });
      const renderCanvas = document.createElement('canvas');
      renderCanvas.width = Math.max(1, Math.ceil(viewport.width * request.regionWidth));
      renderCanvas.height = Math.max(1, Math.ceil(viewport.height * request.regionHeight));
      const renderContext = renderCanvas.getContext('2d');
      if (!renderContext) {
        this.hiResInFlightRequests.delete(request.pageNumber);
        return;
      }
      const task = page.render({
        canvasContext: renderContext,
        viewport,
        transform: [1, 0, 0, 1, -viewport.width * request.regionX, -viewport.height * request.regionY],
      });
      this.hiResRenderTasks.set(request.pageNumber, task);
      await withTimeout(task.promise, 12000, 'PDF high resolution region render timed out.');
      this.hiResRenderTasks.delete(request.pageNumber);
      this.hiResInFlightRequests.delete(request.pageNumber);
      if (generation !== this.hiResGeneration || this.hiResCanvasElements.get(request.pageNumber) !== canvas) return;

      const visibleContext = canvas.getContext('2d');
      if (!visibleContext) return;
      canvas.width = renderCanvas.width;
      canvas.height = renderCanvas.height;
      canvas.style.position = 'absolute';
      canvas.style.left = `${request.regionX * 100}%`;
      canvas.style.top = `${request.regionY * 100}%`;
      canvas.style.width = `${request.regionWidth * 100}%`;
      canvas.style.height = `${request.regionHeight * 100}%`;
      canvas.style.display = 'block';
      visibleContext.setTransform(1, 0, 0, 1, 0, 0);
      visibleContext.clearRect(0, 0, canvas.width, canvas.height);
      visibleContext.drawImage(renderCanvas, 0, 0);
      this.hiResOverlayRequests.set(request.pageNumber, request);
    } catch (error) {
      this.hiResRenderTasks.delete(request.pageNumber);
      this.hiResInFlightRequests.delete(request.pageNumber);
      if (String((error as Error)?.name) === 'RenderingCancelledException') return;
      console.warn('[WebPdfViewportEngine] Failed to render high resolution page region.', error);
    }
  }

  private scheduleSnapshot() {
    if (this.snapshotTimer) return;
    this.snapshotTimer = window.setTimeout(() => {
      this.snapshotTimer = null;
      this.emitSnapshotNow();
    }, WEB_PDF_VIEWPORT_NOTIFY_MS);
  }

  private emitSnapshotNow() {
    if (this.snapshotTimer) {
      window.clearTimeout(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    this.notifySnapshot({ ...this.snapshot, pages: { ...this.snapshot.pages } });
  }

  private getFallbackFrame(): WebPdfPageFrame {
    const firstPage = this.snapshot.pages[1];
    if (firstPage) return firstPage;
    const width = Math.max(320, Math.min(900, (this.snapshot.viewportWidth || WEB_PDF_FALLBACK_WIDTH) - WEB_PDF_HORIZONTAL_PADDING * 2));
    const height = Math.round(width * (WEB_PDF_FALLBACK_HEIGHT / WEB_PDF_FALLBACK_WIDTH));
    return {
      pageNumber: 1,
      naturalWidth: WEB_PDF_FALLBACK_WIDTH,
      naturalHeight: WEB_PDF_FALLBACK_HEIGHT,
      x: WEB_PDF_HORIZONTAL_PADDING,
      y: WEB_PDF_VERTICAL_PADDING,
      width,
      height,
      scale: width / WEB_PDF_FALLBACK_WIDTH,
      visible: true,
    };
  }

  private cancelRenderTask(pageNumber: number) {
    const task = this.renderTasks.get(pageNumber);
    task?.cancel?.();
    this.renderTasks.delete(pageNumber);
  }

  private cancelHiResRenderTask(pageNumber: number) {
    const task = this.hiResRenderTasks.get(pageNumber);
    task?.cancel?.();
    this.hiResRenderTasks.delete(pageNumber);
    this.hiResInFlightRequests.delete(pageNumber);
  }

  private clearHiResOverlay(pageNumber: number, canvas = this.hiResCanvasElements.get(pageNumber)) {
    this.hiResOverlayRequests.delete(pageNumber);
    this.hiResInFlightRequests.delete(pageNumber);
    if (canvas) this.hideHiResCanvas(canvas);
  }

  private hideHiResCanvas(canvas: HTMLCanvasElement) {
    canvas.width = 0;
    canvas.height = 0;
    canvas.style.display = 'none';
    canvas.style.left = '0';
    canvas.style.top = '0';
    canvas.style.width = '0';
    canvas.style.height = '0';
  }

  private cancelHiResOverlayRenders(clearCanvases = false) {
    this.hiResGeneration += 1;
    if (this.hiResRenderTimer) {
      window.clearTimeout(this.hiResRenderTimer);
      this.hiResRenderTimer = null;
    }
    this.hiResRenderTasks.forEach((task) => task.cancel?.());
    this.hiResRenderTasks.clear();
    this.hiResInFlightRequests.clear();
    this.hiResRenderQueue = [];
    this.wantedHiResPages.clear();
    if (clearCanvases) {
      this.hiResOverlayRequests.clear();
      this.hiResCanvasElements.forEach((canvas) => this.hideHiResCanvas(canvas));
    }
  }

  private cancelAllRenders() {
    this.renderGeneration += 1;
    this.renderTasks.forEach((task) => task.cancel?.());
    this.renderTasks.clear();
    this.renderQueue = [];
    this.renderedPageKeys.clear();
  }
}

export function useWebPdfViewportEngine(options: UseWebPdfViewportEngineOptions) {
  const [snapshot, setSnapshot] = useState<WebPdfViewportSnapshot>(() => makeDefaultSnapshot());
  const engineRef = useRef<WebPdfViewportEngine | null>(null);
  const engineReportedPageRef = useRef<number | null>(null);

  if (!engineRef.current) {
    engineRef.current = new WebPdfViewportEngine(setSnapshot, options.pageGap);
  }

  const engine = engineRef.current;

  useEffect(() => {
    engine.setCallbacks({
      onDocumentLoaded: options.onDocumentLoaded,
      onPageChanged: (pageNumber) => {
        engineReportedPageRef.current = pageNumber;
        options.onPageChanged?.(pageNumber);
      },
      onOpenGeneratedPage: options.onOpenGeneratedPage,
    });
  }, [engine, options.onDocumentLoaded, options.onOpenGeneratedPage, options.onPageChanged]);

  useEffect(() => {
    engine.setCallbacksPageGap(options.pageGap);
  }, [engine, options.pageGap]);

  useEffect(() => {
    void engine.setSourceUri(options.sourceUri);
  }, [engine, options.sourceUri]);

  useEffect(() => {
    const fromEnginePanSync = engineReportedPageRef.current === options.currentPage;
    engine.setExternalPage(options.currentPage, !fromEnginePanSync);
    engineReportedPageRef.current = null;
  }, [engine, options.currentPage]);

  useEffect(() => () => engine.dispose(), [engine]);

  const rootRef = useCallback((element: HTMLDivElement | null) => {
    engine.setRootElement(element);
  }, [engine]);

  return {
    engine,
    snapshot,
    rootRef,
  };
}

export { clampZoom, WEB_PDF_MAX_ZOOM, WEB_PDF_MIN_ZOOM };
