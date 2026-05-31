import { NativeModules, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { InkImageAnnotation, InkStroke, InkTextAnnotation, SelectionRect } from '../ui-types';

type NativePdfPageRenderer = {
  renderPage: (fileUri: string, pageNumber: number, targetWidth: number) => Promise<RenderedPdfPage>;
  renderSelectionPreview?: (
    fileUri: string,
    pageNumber: number,
    rect: SelectionRect,
    targetWidth: number,
    inkStrokes: InkStroke[],
    textAnnotations: InkTextAnnotation[],
    imageAnnotations?: InkImageAnnotation[],
  ) => Promise<RenderedPdfPage>;
};

export type RenderedPdfPage = {
  uri: string;
  width: number;
  height: number;
  pageNumber: number;
  pageCount: number;
};

export type PdfRenderSource = string | { uri: string };

const nativeRenderer = NativeModules.BsnPdfPageRenderer as NativePdfPageRenderer | undefined;
const PDF_SOURCE_CACHE_DIR = `${FileSystem.cacheDirectory ?? ''}bsnap-pdf-sources/`;
const pdfSourceDownloadPromises = new Map<string, Promise<string>>();

function hashKey(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return Math.abs(hash).toString(36);
}

async function ensureLocalPdfUri(fileUri: string) {
  if (!/^https?:\/\//i.test(fileUri)) return fileUri;
  if (!FileSystem.cacheDirectory) {
    throw new Error('PDF cache directory is unavailable.');
  }

  await FileSystem.makeDirectoryAsync(PDF_SOURCE_CACHE_DIR, { intermediates: true });
  const targetUri = `${PDF_SOURCE_CACHE_DIR}${hashKey(fileUri)}.pdf`;
  const cached = await FileSystem.getInfoAsync(targetUri);
  if (cached.exists) return targetUri;

  const existingDownload = pdfSourceDownloadPromises.get(fileUri);
  if (existingDownload) return existingDownload;

  const downloadPromise = FileSystem.downloadAsync(fileUri, targetUri)
    .then((downloaded) => downloaded.uri)
    .finally(() => {
      pdfSourceDownloadPromises.delete(fileUri);
    });
  pdfSourceDownloadPromises.set(fileUri, downloadPromise);
  return downloadPromise;
}

export async function resolveLocalPdfUri(file: PdfRenderSource) {
  const sourceUri = typeof file === 'string' ? file : file.uri;

  if (!sourceUri) {
    throw new Error('PDF source URI is unavailable.');
  }

  return ensureLocalPdfUri(sourceUri);
}

export async function renderPdfPageToImage(params: {
  file: PdfRenderSource;
  pageNumber: number;
  targetWidth: number;
}) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Native PDF page rendering is only enabled on iOS and Android.');
  }
  if (!nativeRenderer) {
    throw new Error('BsnPdfPageRenderer native module is unavailable.');
  }

  const sourceUri = typeof params.file === 'string' ? params.file : params.file.uri;

  if (!sourceUri) {
    throw new Error('PDF source URI is unavailable.');
  }

  const localUri = await ensureLocalPdfUri(sourceUri);
  return nativeRenderer.renderPage(localUri, params.pageNumber, Math.max(1, Math.round(params.targetWidth)));
}

export async function renderPdfSelectionPreview(params: {
  file: PdfRenderSource;
  pageNumber: number;
  rect: SelectionRect;
  targetWidth: number;
  inkStrokes?: InkStroke[];
  textAnnotations?: InkTextAnnotation[];
  imageAnnotations?: InkImageAnnotation[];
}) {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    throw new Error('Native PDF selection rendering is only enabled on iOS and Android.');
  }
  if (!nativeRenderer?.renderSelectionPreview) {
    throw new Error('BsnPdfPageRenderer selection rendering is unavailable.');
  }

  const sourceUri = typeof params.file === 'string' ? params.file : params.file.uri;

  if (!sourceUri) {
    throw new Error('PDF source URI is unavailable.');
  }

  const localUri = await ensureLocalPdfUri(sourceUri);
  return nativeRenderer.renderSelectionPreview(
    localUri,
    params.pageNumber,
    params.rect,
    Math.max(1, Math.round(params.targetWidth)),
    params.inkStrokes ?? [],
    params.textAnnotations ?? [],
    params.imageAnnotations ?? [],
  );
}
