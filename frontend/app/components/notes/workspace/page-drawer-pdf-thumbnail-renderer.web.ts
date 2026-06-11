import { Image } from 'react-native';
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
};
type PdfJsDocumentSource = string | { url: string; withCredentials?: boolean; disableWorker?: boolean } | { data: Uint8Array; disableWorker?: boolean };

export type PageDrawerPdfThumbnailResult = {
  uri: string;
  width: number;
  height: number;
  pageNumber: number;
  pageCount: number;
};

const WEB_PDF_WORKER_SRC = '/pdf.worker.min.js';
const documentPromises = new Map<string, Promise<PdfJsDocument>>();
const thumbnailPromises = new Map<string, Promise<PageDrawerPdfThumbnailResult>>();

pdfjsLib.GlobalWorkerOptions.workerSrc = WEB_PDF_WORKER_SRC;

function resolvePdfUri(file: number | string | { uri: string }) {
  if (typeof file === 'string') return file;
  if (typeof file === 'number') return Image.resolveAssetSource(file)?.uri ?? null;
  return file.uri ?? null;
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
    return { data: dataUriToBytes(uri), disableWorker: false };
  }
  return { url: uri, withCredentials: false, disableWorker: false };
}

async function loadPdfDocument(uri: string) {
  const existing = documentPromises.get(uri);
  if (existing) return existing;

  const promise = pdfjsLib.getDocument(createPdfDocumentSource(uri)).promise as Promise<PdfJsDocument>;
  documentPromises.set(uri, promise);
  return promise;
}

export async function renderPageDrawerPdfThumbnail(params: {
  file: number | string | { uri: string };
  pageNumber: number;
  targetWidth: number;
}): Promise<PageDrawerPdfThumbnailResult> {
  const uri = resolvePdfUri(params.file);
  if (!uri) throw new Error('PDF source URI is unavailable.');

  const pageNumber = Math.max(1, Math.round(params.pageNumber));
  const targetWidth = Math.max(80, Math.round(params.targetWidth));
  const cacheKey = `${uri}:${pageNumber}:${targetWidth}`;
  const cached = thumbnailPromises.get(cacheKey);
  if (cached) return cached;

  const promise = (async () => {
    const document = await loadPdfDocument(uri);
    const clampedPage = Math.max(1, Math.min(pageNumber, document.numPages));
    const page = await document.getPage(clampedPage);
    const naturalViewport = page.getViewport({ scale: 1 });
    const scale = targetWidth / Math.max(1, naturalViewport.width);
    const viewport = page.getViewport({ scale });
    const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const canvas = window.document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width * pixelRatio));
    canvas.height = Math.max(1, Math.ceil(viewport.height * pixelRatio));

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas context is unavailable.');

    const renderTask = page.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : undefined,
    });
    await renderTask.promise;

    return {
      uri: canvas.toDataURL('image/png'),
      width: naturalViewport.width,
      height: naturalViewport.height,
      pageNumber: clampedPage,
      pageCount: document.numPages,
    };
  })();

  thumbnailPromises.set(cacheKey, promise);
  return promise;
}
