import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type { NotebookPageTemplate } from '../../../types';

const LOCAL_BLANK_PDF_DIR = `${FileSystem.documentDirectory ?? ''}bsnap-blank-pdfs/`;
const BLANK_PDF_WIDTH = 1156;
const BLANK_PDF_HEIGHT = 786;

function buildTemplateStream(template: NotebookPageTemplate) {
  const lines: string[] = [
    'q',
    '1 1 1 rg',
    `0 0 ${BLANK_PDF_WIDTH} ${BLANK_PDF_HEIGHT} re f`,
  ];

  if (template === 'ruled' || template === 'grid') {
    lines.push('0.90 0.93 0.98 RG', '0.8 w');
    for (let y = 46; y < BLANK_PDF_HEIGHT; y += 38) {
      lines.push(`38 ${y} m ${BLANK_PDF_WIDTH - 38} ${y} l S`);
    }
  }

  if (template === 'grid') {
    lines.push('0.93 0.95 0.99 RG', '0.55 w');
    for (let x = 44; x < BLANK_PDF_WIDTH; x += 38) {
      lines.push(`${x} 36 m ${x} ${BLANK_PDF_HEIGHT - 36} l S`);
    }
  }

  lines.push('Q');
  return `${lines.join('\n')}\n`;
}

function buildBlankPdf(pageCount: number, template: NotebookPageTemplate) {
  const objects: string[] = [];
  const addObject = (body: string) => {
    objects.push(body);
    return objects.length;
  };

  const catalogObjectId = addObject('<< /Type /Catalog /Pages 2 0 R >>');
  const pagesObjectId = addObject('');
  const pageObjectIds: number[] = [];

  for (let page = 1; page <= pageCount; page += 1) {
    const content = buildTemplateStream(template);
    const contentObjectId = addObject(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    const pageObjectId = addObject([
      '<<',
      '/Type /Page',
      '/Parent 2 0 R',
      `/MediaBox [0 0 ${BLANK_PDF_WIDTH} ${BLANK_PDF_HEIGHT}]`,
      `/Contents ${contentObjectId} 0 R`,
      '>>',
    ].join('\n'));
    pageObjectIds.push(pageObjectId);
  }

  objects[pagesObjectId - 1] = [
    '<<',
    '/Type /Pages',
    `/Count ${pageObjectIds.length}`,
    `/Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}]`,
    '>>',
  ].join('\n');

  let pdf = '%PDF-1.4\n%BSNAP\n';
  const offsets = [0];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += [
    'trailer',
    `<< /Size ${objects.length + 1} /Root ${catalogObjectId} 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    '',
  ].join('\n');

  return pdf;
}

function encodePdfDataUri(pdf: string) {
  const encoder = (globalThis as unknown as { btoa?: (value: string) => string }).btoa;
  if (typeof encoder === 'function') {
    return `data:application/pdf;base64,${encoder(pdf)}`;
  }
  return `data:application/pdf,${encodeURIComponent(pdf)}`;
}

export async function persistBlankPdfDocument(params: {
  documentId: number;
  pageCount: number;
  template: NotebookPageTemplate;
}) {
  const pageCount = Math.max(1, Math.floor(params.pageCount));
  const pdf = buildBlankPdf(pageCount, params.template);

  if (Platform.OS === 'web') {
    return encodePdfDataUri(pdf);
  }

  if (!FileSystem.documentDirectory) return null;

  await FileSystem.makeDirectoryAsync(LOCAL_BLANK_PDF_DIR, { intermediates: true });
  const targetUri = `${LOCAL_BLANK_PDF_DIR}${params.documentId}-${pageCount}-${params.template}-${Date.now()}.pdf`;
  await FileSystem.writeAsStringAsync(targetUri, pdf, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  return targetUri;
}
