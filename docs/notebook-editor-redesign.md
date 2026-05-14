# Notebook Editor Redesign

## Goal

B-Snap notes should behave like a real handwriting notebook, not like a PDF viewer with an ink overlay. Opening a PDF creates a notebook made of full-page surfaces. PDF pages, blank pages, images, and AI pages are all editable pages in one vertical document.

## Core Decisions

1. The editor works with `NotebookPage` items.
2. Every ink, text, image, and shape object belongs to a stable page identity.
3. PDF page navigation is scroll-first. Previous/next page arrow buttons are removed from the writing workflow.
4. Blank pages are inserted after the currently visible page, including between original PDF pages.
5. PDF rendering must be virtualized. Only visible or nearby pages may render heavy PDF content.
6. Backend PDF imports should create page image caches when possible, so the editor can use stable bitmap page backgrounds instead of live PDF rendering during handwriting.

## Page Model

```ts
type NotebookPage =
  | {
      id: string;
      kind: 'pdf';
      documentId: number;
      pageNumber: number;
      label: string;
    }
  | {
      id: string;
      kind: 'blank';
      documentId: number;
      generatedPageId: string;
      insertAfterPage: number;
      label: string;
      template: 'plain' | 'ruled' | 'grid';
    }
  | {
      id: string;
      kind: 'summary';
      documentId: number;
      generatedPageId: string;
      insertAfterPage: number;
      label: string;
    };
```

The current migration layer maps existing data into this model:

- PDF original page: `pdf:${pageNumber}`
- Blank memo page: `generated:${pageId}`
- AI summary page: `generated:${pageId}`

## Editor Layers

`NotebookEditor`

- owns the virtualized vertical list
- tracks current page from scroll position
- routes page-level actions

`NotebookPageSurface`

- renders one page box
- chooses background by page kind
- mounts ink/text/selection layers

`PdfPageBackground`

- renders a single PDF page only when the page is close to the viewport
- otherwise shows a lightweight placeholder
- prefers a cached page image URL when the backend import pipeline produced one

`BlankPageBackground`

- renders paper templates

`InkObjectLayer`, `TextObjectLayer`, `SelectionLayer`

- receive only page-scoped objects
- commit mutations with the current `NotebookPage`

## Implementation Phases

1. Add notebook model and conversion helpers.
2. Replace current PDF page controls with scroll-first current-page tracking.
3. Replace PDF preview internals with a virtualized notebook page list.
4. Change blank-page insertion to insert after the current notebook page.
5. Move ink/text persistence from page-number-first to page-identity-first while keeping backward compatibility.
6. Add page thumbnails and page management.
7. Reconnect AI actions as generated notebook pages.
8. Promote undo/redo to a document action history, covering ink, text, objects, generated page insert/delete, and page reorder operations.

## Compatibility Rules

- Existing PDF ink with `pageNumber` remains valid.
- Existing memo pages keep their `generatedPageId`.
- Backend page saves continue to serialize PDF original page content by `pageNumber`.
- Generated blank/summary pages remain local-first until backend support is expanded.
