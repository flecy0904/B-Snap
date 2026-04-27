import { Platform } from 'react-native';
import { PdfPreview as NativePdfPreview } from './pdf-preview.native';
import { PdfPreview as WebPdfPreview } from './pdf-preview.web';

export const PdfPreview = Platform.OS === 'web' ? WebPdfPreview : NativePdfPreview;
