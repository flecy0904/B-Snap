import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import type * as DocumentPicker from 'expo-document-picker';

const LOCAL_PDF_DIR = `${FileSystem.documentDirectory ?? ''}bsnap-pdfs/`;
const PDF_PAGE_COUNT_CHUNK_BYTES = 256 * 1024;
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function sanitizePdfFileName(name: string | null | undefined) {
  const fallback = 'document.pdf';
  let decodedName = name || fallback;
  try {
    decodedName = decodeURIComponent(decodedName);
  } catch {
    decodedName = name || fallback;
  }
  const safeName = decodedName.replace(/[^A-Za-z0-9가-힣._ -]+/g, '-').trim();
  return safeName || fallback;
}

function decodeBase64ToBinary(input: string) {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  let output = '';

  for (let index = 0; index < clean.length; index += 4) {
    const encoded1 = BASE64_CHARS.indexOf(clean[index]);
    const encoded2 = BASE64_CHARS.indexOf(clean[index + 1]);
    const encoded3 = clean[index + 2] === '=' ? -1 : BASE64_CHARS.indexOf(clean[index + 2]);
    const encoded4 = clean[index + 3] === '=' ? -1 : BASE64_CHARS.indexOf(clean[index + 3]);

    if (encoded1 < 0 || encoded2 < 0) continue;

    const byte1 = (encoded1 << 2) | (encoded2 >> 4);
    output += String.fromCharCode(byte1);

    if (encoded3 >= 0) {
      const byte2 = ((encoded2 & 15) << 4) | (encoded3 >> 2);
      output += String.fromCharCode(byte2);
    }

    if (encoded3 >= 0 && encoded4 >= 0) {
      const byte3 = ((encoded3 & 3) << 6) | encoded4;
      output += String.fromCharCode(byte3);
    }
  }

  return output;
}

function countPdfPagesInBinaryChunk(chunk: string, carry: string) {
  const text = `${carry}${chunk}`;
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return {
    count: matches?.length ?? 0,
    carry: text.slice(-32),
  };
}

export function createLocalStudyDocumentId() {
  return Date.now();
}

export async function persistPickedPdfAsset(picked: DocumentPicker.DocumentPickerAsset) {
  if (Platform.OS === 'web') {
    if (picked.base64) return `data:application/pdf;base64,${picked.base64}`;
    return picked.uri;
  }

  if (!picked.uri || !FileSystem.documentDirectory) return picked.uri;

  await FileSystem.makeDirectoryAsync(LOCAL_PDF_DIR, { intermediates: true });
  const safeName = sanitizePdfFileName(picked.name);
  const targetUri = `${LOCAL_PDF_DIR}${Date.now()}-${safeName}`;
  try {
    await FileSystem.copyAsync({ from: picked.uri, to: targetUri });
    return targetUri;
  } catch {
    return picked.uri;
  }
}

export async function readPdfPageCount(picked: DocumentPicker.DocumentPickerAsset, pdfUri: string) {
  try {
    if (Platform.OS === 'web') {
      const base64 = pdfUri.startsWith('data:application/pdf')
        ? pdfUri.split(',')[1] ?? ''
        : picked.base64 ?? '';
      if (!base64) return 1;
      const binary = decodeBase64ToBinary(base64);
      return Math.max(1, countPdfPagesInBinaryChunk(binary, '').count);
    }

    const fileInfo = await FileSystem.getInfoAsync(pdfUri);
    const fileSize = fileInfo.exists && typeof fileInfo.size === 'number' ? fileInfo.size : 0;
    if (!fileSize) return 1;

    let pageCount = 0;
    let carry = '';
    for (let position = 0; position < fileSize; position += PDF_PAGE_COUNT_CHUNK_BYTES) {
      const length = Math.min(PDF_PAGE_COUNT_CHUNK_BYTES, fileSize - position);
      const base64 = await FileSystem.readAsStringAsync(pdfUri, {
        encoding: FileSystem.EncodingType.Base64,
        position,
        length,
      });
      const result = countPdfPagesInBinaryChunk(decodeBase64ToBinary(base64), carry);
      pageCount += result.count;
      carry = result.carry;
    }
    return Math.max(1, pageCount);
  } catch {
    return 1;
  }
}
