import type { InkStroke, InkTextAnnotation } from '../../../ui-types';

export type StoredNotePageContent = {
  kind: 'bsnap-page-state';
  version: 1;
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
};

export function serializeNotePageContent(params: {
  inkStrokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
}) {
  return JSON.stringify({
    kind: 'bsnap-page-state',
    version: 1,
    inkStrokes: params.inkStrokes,
    textAnnotations: params.textAnnotations,
  } satisfies StoredNotePageContent);
}

export function parseNotePageContent(content: string | null): StoredNotePageContent | null {
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as Partial<StoredNotePageContent>;
    if (parsed.kind !== 'bsnap-page-state' || parsed.version !== 1) return null;
    return {
      kind: 'bsnap-page-state',
      version: 1,
      inkStrokes: Array.isArray(parsed.inkStrokes) ? parsed.inkStrokes : [],
      textAnnotations: Array.isArray(parsed.textAnnotations) ? parsed.textAnnotations : [],
    };
  } catch {
    return null;
  }
}
