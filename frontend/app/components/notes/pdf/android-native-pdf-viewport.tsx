import React, { useEffect, useMemo, useState } from 'react';
import { Image, Platform, requireNativeComponent, StyleSheet, Text, View, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from 'react-native';
import type { InkBrush, InkBrushSettings, InkLinePattern, InkStroke, InkTool } from '../../../ui-types';
import type { NotebookPage } from '../../../types';
import { resolveLocalPdfUri, type PdfRenderSource } from '../../../services/pdf-page-renderer';

type NativeDocumentLoadedEvent = NativeSyntheticEvent<{ pageCount: number }>;
type NativePageChangedEvent = NativeSyntheticEvent<{ pageNumber: number }>;
type NativeCommitInkStrokeEvent = NativeSyntheticEvent<InkStroke>;
type NativeRemoveInkStrokeEvent = NativeSyntheticEvent<{ strokeId: string }>;
type NativeViewportChangedEvent = NativeSyntheticEvent<PdfViewportOverlayState>;

export type PdfViewportOverlayPage = {
  id: string;
  kind: NotebookPage['kind'];
  label: string;
  pageNumber?: number;
  generatedPageId?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  pageWidth: number;
  pageHeight: number;
};

export type PdfViewportOverlayState = {
  scale: number;
  scrollY: number;
  translateX: number;
  viewportWidth: number;
  viewportHeight: number;
  contentHeight: number;
  pages: PdfViewportOverlayPage[];
};

type BsnPdfViewportNativeProps = {
  fileUri: string;
  page: number;
  notebookPages?: NotebookPage[];
  inkTool: InkTool;
  fingerDrawingEnabled?: boolean;
  penColor: string;
  penWidth: number;
  brushType: InkBrush;
  linePattern: InkLinePattern;
  brushSettings?: InkBrushSettings;
  inkStrokes: InkStroke[];
  style?: StyleProp<ViewStyle>;
  onDocumentLoaded?: (event: NativeDocumentLoadedEvent) => void;
  onPageChanged?: (event: NativePageChangedEvent) => void;
  onCommitInkStroke?: (event: NativeCommitInkStrokeEvent) => void;
  onRemoveInkStroke?: (event: NativeRemoveInkStrokeEvent) => void;
  onViewportChanged?: (event: NativeViewportChangedEvent) => void;
};

const NativeBsnPdfViewportView = Platform.OS === 'android'
  ? requireNativeComponent<BsnPdfViewportNativeProps>('BsnPdfViewportView')
  : null;

function getPdfRenderSource(source: number | string | { uri: string }): PdfRenderSource | null {
  if (typeof source === 'number') return null;
  return source;
}

export function AndroidNativePdfViewport(props: {
  file: number | string | { uri: string };
  page: number;
  inkTool: InkTool;
  fingerDrawingEnabled?: boolean;
  penColor: string;
  penWidth: number;
  brushType: InkBrush;
  linePattern: InkLinePattern;
  brushSettings?: InkBrushSettings;
  inkStrokes: InkStroke[];
  notebookPages?: NotebookPage[];
  onCommitInkStroke: (stroke: InkStroke) => void;
  onRemoveInkStroke: (strokeId: string) => void;
  onPageChanged?: (page: number) => void;
  onDocumentLoaded?: (pageCount: number) => void;
  onViewportChanged?: (viewport: PdfViewportOverlayState) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const [localFileUri, setLocalFileUri] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pdfSource = useMemo(() => getPdfRenderSource(props.file), [props.file]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setLocalFileUri(null);

    if (!pdfSource) {
      const assetSource = typeof props.file === 'number' ? Image.resolveAssetSource(props.file) : null;
      if (assetSource?.uri) {
        setLocalFileUri(assetSource.uri);
      } else {
        setLoadError('PDF source URI is unavailable.');
      }
      return () => {
        cancelled = true;
      };
    }

    void resolveLocalPdfUri(pdfSource)
      .then((uri) => {
        if (!cancelled) setLocalFileUri(uri);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'PDF source URI is unavailable.');
      });

    return () => {
      cancelled = true;
    };
  }, [pdfSource, props.file]);

  if (Platform.OS !== 'android' || !NativeBsnPdfViewportView) return null;

  if (!localFileUri) {
    return (
      <View style={[styles.fallback, props.style]}>
        <Text style={styles.fallbackText}>{loadError ?? 'PDF loading...'}</Text>
      </View>
    );
  }

  return (
    <NativeBsnPdfViewportView
      fileUri={localFileUri}
      page={props.page}
      notebookPages={props.notebookPages}
      inkTool={props.inkTool}
      fingerDrawingEnabled={props.fingerDrawingEnabled}
      penColor={props.penColor}
      penWidth={props.penWidth}
      brushType={props.brushType}
      linePattern={props.linePattern}
      brushSettings={props.brushSettings}
      inkStrokes={props.inkStrokes}
      style={[styles.nativeView, props.style]}
      onDocumentLoaded={(event) => props.onDocumentLoaded?.(event.nativeEvent.pageCount)}
      onPageChanged={(event) => props.onPageChanged?.(event.nativeEvent.pageNumber)}
      onCommitInkStroke={(event) => props.onCommitInkStroke(event.nativeEvent)}
      onRemoveInkStroke={(event) => props.onRemoveInkStroke(event.nativeEvent.strokeId)}
      onViewportChanged={(event) => props.onViewportChanged?.(event.nativeEvent)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    flex: 1,
    justifyContent: 'center',
    width: '100%',
  },
  fallbackText: {
    color: '#94A3B8',
    fontWeight: '800',
  },
  nativeView: {
    alignSelf: 'stretch',
    backgroundColor: '#FFFFFF',
    flex: 1,
    width: '100%',
  },
});
