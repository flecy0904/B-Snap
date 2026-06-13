import { Image } from 'react-native';
import { renderPdfPageToImage } from '../../../services/pdf-page-renderer';

export type PageDrawerPdfThumbnailResult = {
  uri: string;
  width: number;
  height: number;
  pageNumber: number;
  pageCount: number;
};

function resolvePdfSource(file: number | string | { uri: string }) {
  if (typeof file === 'string') return file;
  if (typeof file === 'number') return Image.resolveAssetSource(file)?.uri ?? null;
  return file.uri ?? null;
}

export async function renderPageDrawerPdfThumbnail(params: {
  file: number | string | { uri: string };
  pageNumber: number;
  targetWidth: number;
}): Promise<PageDrawerPdfThumbnailResult> {
  const uri = resolvePdfSource(params.file);
  if (!uri) throw new Error('PDF source URI is unavailable.');

  return renderPdfPageToImage({
    file: { uri },
    pageNumber: params.pageNumber,
    targetWidth: params.targetWidth,
  });
}
