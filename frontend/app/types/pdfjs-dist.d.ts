declare module 'pdfjs-dist/build/pdf' {
  export const version: string;
  export const GlobalWorkerOptions: {
    workerSrc?: string;
    workerPort?: Worker;
  };
  export function getDocument(source: unknown): {
    promise: Promise<unknown>;
    destroy?: () => void;
  };
}
