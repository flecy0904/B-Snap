import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist/build/pdf';

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

export type WebPdfZoomMode = 'fit' | 'manual';

export type WebPdfPageFrame = {
  pageNumber: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  scale: number;
};

export type WebPdfViewportSnapshot = {
  isLoading: boolean;
  loadError: string | null;
  pageCount: number;
  currentPage: number;
  zoomMode: WebPdfZoomMode;
  scale: number;
  pages: Record<number, WebPdfPageFrame>;
  viewportWidth: number;
  viewportHeight: number;
  scrollLeft: number;
  scrollTop: number;
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
type WebPdfZoomAnchor = {
  targetKey: string;
  sourcePageNumber?: number;
  viewportX: number;
  viewportY: number;
  pageRatioX: number;
  pageRatioY: number;
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
const WEB_PDF_RENDER_IDLE_MS = 140;
const WEB_PDF_VIEWPORT_NOTIFY_MS = 48;
const WEB_PDF_PAGE_NOTIFY_MS = 96;
const WEB_PDF_WHEEL_ZOOM_SENSITIVITY = 0.0015;
const WEB_PDF_HORIZONTAL_PADDING = 40;
const WEB_PDF_VERTICAL_PADDING = 18;
const WEB_PDF_FALLBACK_WIDTH = 820;
const WEB_PDF_FALLBACK_HEIGHT = 1060;
const WEB_PDF_WORKER_SRC = '/pdf.worker.min.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = WEB_PDF_WORKER_SRC;

function clampZoom(value: number) {
  return Math.max(WEB_PDF_MIN_ZOOM, Math.min(WEB_PDF_MAX_ZOOM, value));
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

function buildRenderPriority(currentPage: number, pageCount: number, direction: number) {
  const offsets = direction > 0
    ? [0, 1, 2, 3, 4, 5, -1]
    : direction < 0
      ? [0, -1, -2, -3, -4, -5, 1]
      : [0, -1, 1, -2, 2, 3];
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
    pages: {},
    viewportWidth: 0,
    viewportHeight: 0,
    scrollLeft: 0,
    scrollTop: 0,
    contentWidth: 0,
    contentHeight: 0,
  };
}

export class WebPdfViewportEngine {
  private rootElement: HTMLDivElement | null = null;
  private scrollElement: HTMLDivElement | null = null;
  private contentElement: HTMLDivElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private callbacks: WebPdfViewportEngineCallbacks = {};
  private notifySnapshot: (snapshot: WebPdfViewportSnapshot) => void;
  private snapshot: WebPdfViewportSnapshot = makeDefaultSnapshot();
  private document: PdfJsDocument | null = null;
  private loadTask: { promise: Promise<unknown>; destroy?: () => void } | null = null;
  private loadGeneration = 0;
  private renderGeneration = 0;
  private pageElements = new Map<string, { target: WebPdfTarget; element: HTMLElement }>();
  private canvasElements = new Map<number, HTMLCanvasElement>();
  private naturalPages: Record<number, { width: number; height: number }> = {};
  private renderTasks = new Map<number, PdfJsRenderTask>();
  private renderQueue: number[] = [];
  private renderRunning = false;
  private wantedRenderPages = new Set<number>();
  private renderedPageKeys = new Map<number, string>();
  private targetDetachTimers = new Map<string, number>();
  private canvasDetachTimers = new Map<number, number>();
  private renderTimer: number | null = null;
  private snapshotTimer: number | null = null;
  private pageTimer: number | null = null;
  private scrollDirection = 0;
  private previousScrollTop = 0;
  private programmaticScroll = false;
  private pendingExternalScrollPage: number | null = null;
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
      this.rootElement.removeEventListener('wheel', this.handleWheel, { capture: false } as AddEventListenerOptions);
    }
    this.rootElement = element;
    if (this.rootElement) {
      this.rootElement.addEventListener('wheel', this.handleWheel, { passive: false });
    }
  }

  setScrollElement(element: HTMLDivElement | null) {
    if (this.scrollElement === element) return;
    if (this.scrollElement) this.scrollElement.removeEventListener('scroll', this.handleScroll);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.scrollElement = element;
    if (this.scrollElement) {
      this.scrollElement.addEventListener('scroll', this.handleScroll, { passive: true });
      this.resizeObserver = new ResizeObserver(() => this.measureViewport());
      this.resizeObserver.observe(this.scrollElement);
      this.measureViewport();
    }
  }

  setContentElement(element: HTMLDivElement | null) {
    this.contentElement = element;
    this.applyDomLayout();
  }

  setCallbacksPageGap(pageGap: number) {
    if (this.pageGap === pageGap) return;
    this.pageGap = pageGap;
    this.layoutPages();
  }

  setTargetElement(target: WebPdfTarget, element: HTMLElement | null) {
    const pendingDetach = this.targetDetachTimers.get(target.key);
    if (pendingDetach) {
      window.clearTimeout(pendingDetach);
      this.targetDetachTimers.delete(target.key);
    }
    if (!element) {
      const timer = window.setTimeout(() => {
        this.pageElements.delete(target.key);
        this.targetDetachTimers.delete(target.key);
      }, 0);
      this.targetDetachTimers.set(target.key, timer);
      return;
    }
    const current = this.pageElements.get(target.key);
    if (current?.element === element) {
      current.target = target;
      this.applyTargetLayout(target, element);
      return;
    }
    this.pageElements.set(target.key, { target, element });
    this.applyTargetLayout(target, element);
    if (target.pageNumber === this.pendingExternalScrollPage) {
      this.scrollToPendingExternalPage();
    }
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

  setExternalPage(pageNumber: number, scrollIntoView = false) {
    if (!Number.isFinite(pageNumber) || pageNumber <= 0) return;
    if (this.snapshot.currentPage === pageNumber) return;
    this.snapshot = { ...this.snapshot, currentPage: pageNumber };
    this.scheduleSnapshot();
    if (scrollIntoView) {
      this.pendingExternalScrollPage = pageNumber;
      this.scrollToPendingExternalPage();
    }
  }

  async setSourceUri(uri: string | null) {
    this.loadGeneration += 1;
    const generation = this.loadGeneration;
    this.cancelAllRenders();
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
        loadError: '현재 선택한 PDF를 미리보기 할 수 없습니다.',
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
        pages: {},
        loadError: null,
      };
      this.callbacks.onDocumentLoaded?.(document.numPages);
      if (requestedPage !== clampedPage) this.callbacks.onPageChanged?.(clampedPage);
      this.layoutPages();
      this.scheduleVisibleRenders(0);
      void this.loadNaturalPageSizes(document, generation);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      console.warn('[WebPdfViewportEngine] Failed to load PDF document.', error);
      this.snapshot = {
        ...this.snapshot,
        isLoading: false,
        loadError: 'PDF를 불러오지 못했습니다. 브라우저 파일 접근 권한과 네트워크 상태를 확인해 주세요.',
      };
      this.emitSnapshotNow();
    }
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

  zoomBy(delta: number) {
    this.applyManualZoom(this.snapshot.scale + delta);
  }

  resetZoomToFit() {
    this.cancelAllRenders();
    this.snapshot = { ...this.snapshot, zoomMode: 'fit' };
    this.layoutPages();
    this.scheduleVisibleRenders(WEB_PDF_RENDER_IDLE_MS);
  }

  scrollToPage(pageNumber: number) {
    const target = Array.from(this.pageElements.values()).find((entry) => entry.target.pageNumber === pageNumber);
    if (!target) return false;
    this.programmaticScroll = true;
    target.element.scrollIntoView({ block: 'nearest', inline: 'center' });
    window.setTimeout(() => {
      this.programmaticScroll = false;
    }, 160);
    return true;
  }

  private scrollToPendingExternalPage() {
    if (!this.pendingExternalScrollPage) return;
    if (this.scrollToPage(this.pendingExternalScrollPage)) {
      this.pendingExternalScrollPage = null;
    }
  }

  activateTarget(target: WebPdfTarget) {
    if (target.generatedPageId) this.callbacks.onOpenGeneratedPage?.(target.generatedPageId);
    if (target.pageNumber) this.queuePageChanged(target.pageNumber);
  }

  getFrameForSourcePage(pageNumber: number | undefined) {
    if (!pageNumber) return this.getFallbackFrame();
    return this.snapshot.pages[pageNumber] ?? this.getFallbackFrame();
  }

  screenToTargetPoint(targetKey: string, clientX: number, clientY: number, mode: 'draw' | 'annotate' = 'draw') {
    const entry = this.pageElements.get(targetKey);
    if (!entry) return null;
    const sourcePageNumber = entry.target.sourcePageNumber ?? entry.target.pageNumber;
    const frame = this.getFrameForSourcePage(sourcePageNumber);
    const rect = entry.element.getBoundingClientRect();
    const annotateWidth = mode === 'annotate' ? 180 : 0;
    const annotateHeight = mode === 'annotate' ? 110 : 0;
    return {
      x: Math.max(0, Math.min(frame.width - annotateWidth, clientX - rect.left)),
      y: Math.max(0, Math.min(frame.height - annotateHeight, clientY - rect.top)),
      pageNumber: entry.target.pageNumber,
      generatedPageId: entry.target.generatedPageId,
      pageWidth: frame.width,
      pageHeight: frame.height,
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

    const rectScaleX = renderCanvas.width / frame.width;
    const rectScaleY = renderCanvas.height / frame.height;
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
    this.setScrollElement(null);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.cancelAllRenders();
    this.loadTask?.destroy?.();
    this.document?.destroy?.();
    if (this.renderTimer) window.clearTimeout(this.renderTimer);
    if (this.snapshotTimer) window.clearTimeout(this.snapshotTimer);
    if (this.pageTimer) window.clearTimeout(this.pageTimer);
    this.targetDetachTimers.forEach((timer) => window.clearTimeout(timer));
    this.canvasDetachTimers.forEach((timer) => window.clearTimeout(timer));
    this.targetDetachTimers.clear();
    this.canvasDetachTimers.clear();
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
    this.layoutPages();
    this.scheduleVisibleRenders(WEB_PDF_RENDER_IDLE_MS);
  }

  private measureViewport() {
    if (!this.scrollElement) return;
    const rect = this.scrollElement.getBoundingClientRect();
    const width = Math.max(0, Math.floor(rect.width));
    const height = Math.max(0, Math.floor(rect.height));
    if (width === this.snapshot.viewportWidth && height === this.snapshot.viewportHeight) return;
    this.snapshot = {
      ...this.snapshot,
      viewportWidth: width,
      viewportHeight: height,
    };
    this.layoutPages();
  }

  private calculateFitScale() {
    const currentNatural = this.naturalPages[this.snapshot.currentPage] ?? this.naturalPages[1] ?? { width: WEB_PDF_FALLBACK_WIDTH };
    const targetWidth = Math.max(320, this.snapshot.viewportWidth || WEB_PDF_FALLBACK_WIDTH) - 80;
    return clampZoom(targetWidth / Math.max(1, currentNatural.width));
  }

  private layoutPages() {
    const scale = this.snapshot.zoomMode === 'fit' ? this.calculateFitScale() : clampZoom(this.manualScale || this.snapshot.scale);
    this.manualScale = this.snapshot.zoomMode === 'manual' ? scale : this.manualScale;
    const pages: Record<number, WebPdfPageFrame> = {};
    for (let pageNumber = 1; pageNumber <= this.snapshot.pageCount; pageNumber += 1) {
      const natural = this.naturalPages[pageNumber] ?? this.naturalPages[1] ?? {
        width: WEB_PDF_FALLBACK_WIDTH,
        height: WEB_PDF_FALLBACK_HEIGHT,
      };
      pages[pageNumber] = {
        pageNumber,
        width: Math.max(160, Math.round(natural.width * scale)),
        height: Math.max(160, Math.round(natural.height * scale)),
        naturalWidth: natural.width,
        naturalHeight: natural.height,
        scale,
      };
    }
    const contentWidth = Math.max(
      this.snapshot.viewportWidth,
      ...Object.values(pages).map((frame) => frame.width + WEB_PDF_HORIZONTAL_PADDING * 2),
      WEB_PDF_FALLBACK_WIDTH,
    );
    const contentHeight = WEB_PDF_VERTICAL_PADDING * 2
      + Object.values(pages).reduce((sum, frame) => sum + frame.height + this.pageGap, 0);
    this.snapshot = {
      ...this.snapshot,
      scale,
      pages,
      contentWidth,
      contentHeight,
      scrollLeft: this.scrollElement?.scrollLeft ?? this.snapshot.scrollLeft,
      scrollTop: this.scrollElement?.scrollTop ?? this.snapshot.scrollTop,
    };
    this.applyDomLayout();
    this.scheduleSnapshot();
  }

  private applyDomLayout() {
    if (this.contentElement) {
      this.contentElement.style.minWidth = `${Math.max(this.snapshot.viewportWidth, this.snapshot.contentWidth)}px`;
      this.contentElement.style.minHeight = `${Math.max(this.snapshot.viewportHeight, this.snapshot.contentHeight)}px`;
    }
    this.pageElements.forEach(({ target, element }) => this.applyTargetLayout(target, element));
  }

  private applyTargetLayout(target: WebPdfTarget, element: HTMLElement) {
    const frame = this.getFrameForSourcePage(target.sourcePageNumber ?? target.pageNumber);
    element.style.width = `${frame.width}px`;
    element.style.height = `${frame.height}px`;
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
    const wantedPages = buildRenderPriority(this.snapshot.currentPage, this.snapshot.pageCount, this.scrollDirection);
    this.wantedRenderPages = new Set(wantedPages);
    this.renderTasks.forEach((task, pageNumber) => {
      if (!this.wantedRenderPages.has(pageNumber)) {
        task.cancel?.();
        this.renderTasks.delete(pageNumber);
      }
    });
    this.renderQueue = wantedPages.filter((pageNumber) => this.canvasElements.has(pageNumber));
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

  private async renderPage(pageNumber: number, generation: number) {
    const canvas = this.canvasElements.get(pageNumber);
    const frame = this.snapshot.pages[pageNumber];
    if (!this.document || !canvas || !frame) return;
    const deviceScale = window.devicePixelRatio || 1;
    const renderKey = `${this.renderGeneration}:${frame.width}:${frame.height}:${frame.scale}:${deviceScale}`;
    if (this.renderedPageKeys.get(pageNumber) === renderKey && canvas.width > 0 && canvas.height > 0) return;
    this.cancelRenderTask(pageNumber);
    try {
      const page = await this.document.getPage(pageNumber);
      if (generation !== this.renderGeneration) return;
      const viewport = page.getViewport({ scale: frame.scale });
      const context = canvas.getContext('2d');
      if (!context) return;
      canvas.width = Math.max(1, Math.floor(viewport.width * deviceScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * deviceScale));
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      context.setTransform(deviceScale, 0, 0, deviceScale, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);
      const task = page.render({ canvasContext: context, viewport });
      this.renderTasks.set(pageNumber, task);
      await withTimeout(task.promise, 12000, 'PDF page render timed out.');
      this.renderTasks.delete(pageNumber);
      this.renderedPageKeys.set(pageNumber, renderKey);
    } catch (error) {
      this.renderTasks.delete(pageNumber);
      if (String((error as Error)?.name) === 'RenderingCancelledException') return;
      console.warn('[WebPdfViewportEngine] Failed to render page.', error);
      this.snapshot = {
        ...this.snapshot,
        loadError: 'PDF 페이지를 렌더링하지 못했습니다.',
      };
      this.scheduleSnapshot();
    }
  }

  private applyManualZoom(nextScale: number, anchor?: { clientX: number; clientY: number }) {
    const scrollElement = this.scrollElement;
    const previousScale = this.snapshot.scale || 1;
    const scale = clampZoom(nextScale);
    if (Math.abs(scale - previousScale) < 0.001) return;
    const zoomAnchor = this.resolveZoomAnchor(anchor);

    this.manualScale = scale;
    this.snapshot = {
      ...this.snapshot,
      zoomMode: 'manual',
      scale,
    };
    this.cancelAllRenders();
    this.layoutPages();

    if (zoomAnchor) this.restoreZoomAnchor(zoomAnchor);
    this.scheduleVisibleRenders(WEB_PDF_RENDER_IDLE_MS);
  }

  private resolveZoomAnchor(anchor?: { clientX: number; clientY: number }): WebPdfZoomAnchor | null {
    if (!this.scrollElement) return null;
    const viewportRect = this.scrollElement.getBoundingClientRect();
    const clientX = anchor?.clientX ?? viewportRect.left + viewportRect.width / 2;
    const clientY = anchor?.clientY ?? viewportRect.top + viewportRect.height / 2;
    const viewportX = clientX - viewportRect.left;
    const viewportY = clientY - viewportRect.top;
    let best: {
      targetKey: string;
      sourcePageNumber?: number;
      element: HTMLElement;
      distance: number;
    } | null = null;

    for (const [targetKey, { target, element }] of Array.from(this.pageElements.entries())) {
      const rect = element.getBoundingClientRect();
      const inside = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      const distance = inside
        ? 0
        : Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2));
      if (!best || distance < best.distance) {
        best = {
          targetKey,
          sourcePageNumber: target.sourcePageNumber ?? target.pageNumber,
          element,
          distance,
        };
      }
    }

    if (!best) return null;
    const frame = this.getFrameForSourcePage(best.sourcePageNumber);
    const rect = best.element.getBoundingClientRect();
    return {
      targetKey: best.targetKey,
      sourcePageNumber: best.sourcePageNumber,
      viewportX,
      viewportY,
      pageRatioX: Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, frame.width))),
      pageRatioY: Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, frame.height))),
    };
  }

  private restoreZoomAnchor(anchor: WebPdfZoomAnchor) {
    const scrollElement = this.scrollElement;
    const entry = this.pageElements.get(anchor.targetKey);
    if (!scrollElement || !entry) return;
    const frame = this.getFrameForSourcePage(anchor.sourcePageNumber);
    window.requestAnimationFrame(() => {
      const latestEntry = this.pageElements.get(anchor.targetKey);
      if (!this.scrollElement || !latestEntry) return;
      const targetLeft = latestEntry.element.offsetLeft + frame.width * anchor.pageRatioX;
      const targetTop = latestEntry.element.offsetTop + frame.height * anchor.pageRatioY;
      this.scrollElement.scrollLeft = Math.max(0, targetLeft - anchor.viewportX);
      this.scrollElement.scrollTop = Math.max(0, targetTop - anchor.viewportY);
    });
  }

  private handleWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    event.stopPropagation();
    this.applyManualZoom(this.snapshot.scale * Math.exp(-event.deltaY * WEB_PDF_WHEEL_ZOOM_SENSITIVITY), {
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };

  private handleScroll = () => {
    if (!this.scrollElement) return;
    const nextScrollTop = this.scrollElement.scrollTop;
    const deltaY = nextScrollTop - this.previousScrollTop;
    if (Math.abs(deltaY) > 0.5) this.scrollDirection = deltaY > 0 ? 1 : -1;
    this.previousScrollTop = nextScrollTop;
    this.snapshot = {
      ...this.snapshot,
      scrollLeft: this.scrollElement.scrollLeft,
      scrollTop: nextScrollTop,
    };
    this.updateCurrentTargetFromScroll();
    this.scheduleVisibleRenders(0);
    this.scheduleSnapshot();
  };

  private updateCurrentTargetFromScroll() {
    if (!this.scrollElement || this.programmaticScroll) return;
    const viewportRect = this.scrollElement.getBoundingClientRect();
    const probeY = viewportRect.top + viewportRect.height * 0.38;
    let bestTarget: WebPdfTarget | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const { target, element } of Array.from(this.pageElements.values())) {
      const rect = element.getBoundingClientRect();
      if (rect.height <= 0) continue;
      const mid = rect.top + rect.height / 2;
      const distance = Math.abs(mid - probeY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestTarget = target;
      }
    }
    if (!bestTarget) return;
    const target = bestTarget;
    if (target.generatedPageId) this.callbacks.onOpenGeneratedPage?.(target.generatedPageId);
    if (target.pageNumber && target.pageNumber !== this.snapshot.currentPage) {
      this.snapshot = { ...this.snapshot, currentPage: target.pageNumber };
      this.queuePageChanged(target.pageNumber);
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
    const width = Math.max(320, Math.min(900, (this.snapshot.viewportWidth || WEB_PDF_FALLBACK_WIDTH) - 80));
    const height = Math.round(width * (WEB_PDF_FALLBACK_HEIGHT / WEB_PDF_FALLBACK_WIDTH));
    return {
      pageNumber: 1,
      width,
      height,
      naturalWidth: WEB_PDF_FALLBACK_WIDTH,
      naturalHeight: WEB_PDF_FALLBACK_HEIGHT,
      scale: width / WEB_PDF_FALLBACK_WIDTH,
    };
  }

  private cancelRenderTask(pageNumber: number) {
    const task = this.renderTasks.get(pageNumber);
    task?.cancel?.();
    this.renderTasks.delete(pageNumber);
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

  if (!engineRef.current) {
    engineRef.current = new WebPdfViewportEngine(setSnapshot, options.pageGap);
  }

  const engine = engineRef.current;

  useEffect(() => {
    engine.setCallbacks({
      onDocumentLoaded: options.onDocumentLoaded,
      onPageChanged: options.onPageChanged,
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
    engine.setExternalPage(options.currentPage, true);
  }, [engine, options.currentPage]);

  useEffect(() => () => engine.dispose(), [engine]);

  const rootRef = useCallback((element: HTMLDivElement | null) => {
    engine.setRootElement(element);
  }, [engine]);

  const scrollRef = useCallback((element: HTMLDivElement | null) => {
    engine.setScrollElement(element);
  }, [engine]);

  const contentRef = useCallback((element: HTMLDivElement | null) => {
    engine.setContentElement(element);
  }, [engine]);

  return {
    engine,
    snapshot,
    rootRef,
    scrollRef,
    contentRef,
  };
}

export { clampZoom, WEB_PDF_MAX_ZOOM, WEB_PDF_MIN_ZOOM };
