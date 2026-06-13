import React from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Svg from 'react-native-svg';
import type { GeneratedWorkspacePage, NotebookPage, StudyDocumentEntry } from '../../../types';
import type { InkStroke, InkTextAnnotation } from '../../../ui-types';
import { scaleInkStrokeToPageSize, scaleTextAnnotationToPageSize } from '../../../ui-helpers';
import { resolveBackendAssetUrl } from '../../../services/backend-api';
import { InkPath } from '../canvas/ink-path';
import { renderPageDrawerPdfThumbnail, type PageDrawerPdfThumbnailResult } from './page-drawer-pdf-thumbnail-renderer';

const THUMBNAIL_TARGET_WIDTH = 220;
const DEFAULT_PAGE_WIDTH = 612;
const DEFAULT_PAGE_HEIGHT = 792;

type ThumbnailState = {
  uri: string | null;
  width: number;
  height: number;
  loading: boolean;
  failed: boolean;
};

function getFileUri(file: StudyDocumentEntry['file']) {
  if (!file) return null;
  if (typeof file === 'string') return file;
  if (typeof file === 'object' && 'uri' in file) return file.uri;
  return null;
}

function getRenderableImageUri(uri: string | null | undefined) {
  const normalized = resolveBackendAssetUrl(uri) ?? uri ?? null;
  if (!normalized) return null;
  if (/^(https?:\/\/|file:\/\/|data:image\/)/i.test(normalized)) return normalized;
  return null;
}

function getPageKindLabel(page: NotebookPage, documentType?: StudyDocumentEntry['type']) {
  if (page.kind === 'blank') return 'MEMO';
  if (page.kind === 'summary') return 'AI';
  if (documentType === 'blank') return 'NOTE';
  if (documentType === 'image') return 'IMG';
  return 'PDF';
}

function getPageDimensions(props: {
  thumbnail: ThumbnailState;
  strokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
}) {
  if (props.thumbnail.width > 0 && props.thumbnail.height > 0) {
    return { width: props.thumbnail.width, height: props.thumbnail.height };
  }

  const sizedStroke = props.strokes.find((stroke) => stroke.pageWidth && stroke.pageHeight);
  if (sizedStroke?.pageWidth && sizedStroke.pageHeight) {
    return { width: sizedStroke.pageWidth, height: sizedStroke.pageHeight };
  }

  const sizedText = props.textAnnotations.find((annotation) => annotation.pageWidth && annotation.pageHeight);
  if (sizedText?.pageWidth && sizedText.pageHeight) {
    return { width: sizedText.pageWidth, height: sizedText.pageHeight };
  }

  return { width: DEFAULT_PAGE_WIDTH, height: DEFAULT_PAGE_HEIGHT };
}

function pageScopedInk(page: NotebookPage, strokes: InkStroke[]) {
  if (page.generatedPageId) {
    return strokes.filter((stroke) => stroke.generatedPageId === page.generatedPageId);
  }
  return strokes.filter((stroke) => !stroke.generatedPageId && (!stroke.pageNumber || stroke.pageNumber === page.pageNumber));
}

function pageScopedText(page: NotebookPage, annotations: InkTextAnnotation[]) {
  if (page.generatedPageId) {
    return annotations.filter((annotation) => annotation.generatedPageId === page.generatedPageId);
  }
  return annotations.filter((annotation) => !annotation.generatedPageId && annotation.pageNumber === page.pageNumber);
}

function percent(value: number, total: number) {
  return `${(value / Math.max(1, total)) * 100}%`;
}

function PaperLines(props: { kind: 'plain' | 'ruled' | 'grid' | 'summary'; styles: any }) {
  if (props.kind === 'plain') {
    return <View pointerEvents="none" style={props.styles.pageDrawerPaperTopRule} />;
  }

  if (props.kind === 'grid') {
    return (
      <View pointerEvents="none" style={props.styles.pageDrawerPaperGrid}>
        {Array.from({ length: 8 }, (_, index) => (
          <View key={`row-${index}`} style={[props.styles.pageDrawerPaperGridLine, { top: `${(index + 1) * 11}%` }]} />
        ))}
        {Array.from({ length: 6 }, (_, index) => (
          <View key={`col-${index}`} style={[props.styles.pageDrawerPaperGridColumn, { left: `${(index + 1) * 14}%` }]} />
        ))}
      </View>
    );
  }

  return (
    <View pointerEvents="none" style={props.styles.pageDrawerPaperLines}>
      {Array.from({ length: props.kind === 'summary' ? 6 : 7 }, (_, index) => (
        <View key={index} style={[props.styles.pageDrawerPaperLine, { top: `${18 + index * 11}%` }]} />
      ))}
    </View>
  );
}

function GeneratedSummaryPreview(props: { generatedPage: GeneratedWorkspacePage | null; styles: any }) {
  const title = props.generatedPage?.summaryTitle || props.generatedPage?.title || 'AI 정리';
  const sections = props.generatedPage?.summarySections ?? [];

  return (
    <View pointerEvents="none" style={props.styles.pageDrawerGeneratedContent}>
      <Text style={props.styles.pageDrawerGeneratedTitle} numberOfLines={2}>{title}</Text>
      {sections.slice(0, 3).map((section, index) => (
        <View key={`${section.title}-${index}`} style={props.styles.pageDrawerGeneratedSection}>
          <View style={[props.styles.pageDrawerGeneratedBullet, section.tone === 'highlight' && props.styles.pageDrawerGeneratedBulletHot]} />
          <View style={props.styles.pageDrawerGeneratedLines}>
            <View style={[props.styles.pageDrawerGeneratedLine, index === 0 && props.styles.pageDrawerGeneratedLineStrong]} />
            <View style={[props.styles.pageDrawerGeneratedLine, { width: `${62 + index * 9}%` }]} />
          </View>
        </View>
      ))}
      {props.generatedPage?.formulaText ? <View style={props.styles.pageDrawerFormulaStrip} /> : null}
    </View>
  );
}

function InkAndTextOverlay(props: {
  pageWidth: number;
  pageHeight: number;
  strokes: InkStroke[];
  textAnnotations: InkTextAnnotation[];
  styles: any;
}) {
  const scaledStrokes = props.strokes
    .filter((stroke) => stroke.points.length > 0)
    .slice(-28)
    .map((stroke) => scaleInkStrokeToPageSize(stroke, props.pageWidth, props.pageHeight));
  const scaledTextAnnotations = props.textAnnotations
    .filter((annotation) => annotation.text.trim().length > 0)
    .slice(-5)
    .map((annotation) => scaleTextAnnotationToPageSize(annotation, props.pageWidth, props.pageHeight));

  if (!scaledStrokes.length && !scaledTextAnnotations.length) return null;

  return (
    <View pointerEvents="none" style={props.styles.pageDrawerAnnotationOverlay}>
      {scaledStrokes.length ? (
        <Svg width="100%" height="100%" viewBox={`0 0 ${props.pageWidth} ${props.pageHeight}`} preserveAspectRatio="none" style={props.styles.pageDrawerInkSvg}>
          {scaledStrokes.map((stroke) => <InkPath key={stroke.id} stroke={stroke} />)}
        </Svg>
      ) : null}
      {scaledTextAnnotations.map((annotation) => (
        <View
          key={annotation.id}
          style={[
            props.styles.pageDrawerTextAnnotationMark,
            {
              left: percent(annotation.x, props.pageWidth),
              top: percent(annotation.y, props.pageHeight),
              width: percent(Math.max(40, annotation.width), props.pageWidth),
              minHeight: percent(Math.max(20, annotation.height ?? 26), props.pageHeight),
            },
          ]}
        >
          <Text style={props.styles.pageDrawerTextAnnotationText} numberOfLines={2}>
            {annotation.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function PageDrawerThumbnail(props: {
  page: NotebookPage;
  studyDocument: StudyDocumentEntry | null;
  generatedPage: GeneratedWorkspacePage | null;
  documentInkStrokes: InkStroke[];
  documentTextAnnotations: InkTextAnnotation[];
  isActive: boolean;
  bookmarked: boolean;
  renderOrder: number;
  styles: any;
}) {
  const { page, studyDocument } = props;
  const scopedStrokes = React.useMemo(() => pageScopedInk(page, props.documentInkStrokes), [page, props.documentInkStrokes]);
  const scopedTextAnnotations = React.useMemo(() => pageScopedText(page, props.documentTextAnnotations), [page, props.documentTextAnnotations]);
  const [thumbnail, setThumbnail] = React.useState<ThumbnailState>({
    uri: null,
    width: 0,
    height: 0,
    loading: false,
    failed: false,
  });
  const fileUri = getFileUri(studyDocument?.file);
  const pdfFile = React.useMemo(
    () => studyDocument?.file ?? (studyDocument?.remoteFileUrl ? { uri: studyDocument.remoteFileUrl } : null),
    [studyDocument?.file, studyDocument?.remoteFileUrl],
  );
  const imagePreviewUri = getRenderableImageUri(
    studyDocument?.type === 'image'
      ? fileUri ?? studyDocument?.remoteFileUrl ?? studyDocument?.thumbnailUrl
      : page.pageNumber === 1
        ? studyDocument?.thumbnailUrl
        : null,
  );
  const shouldRenderPdf = page.kind === 'pdf' && studyDocument?.type === 'pdf' && Boolean(pdfFile) && Boolean(page.pageNumber);

  React.useEffect(() => {
    if (!shouldRenderPdf || !pdfFile || !page.pageNumber) {
      setThumbnail((current) => (current.uri || current.loading || current.failed ? { uri: null, width: 0, height: 0, loading: false, failed: false } : current));
      return;
    }

    let cancelled = false;
    const pageNumber = page.pageNumber;
    setThumbnail((current) => ({ ...current, loading: !current.uri, failed: false }));

    const renderDelay = Math.min(2400, Math.max(0, props.renderOrder) * 35);
    const timer = setTimeout(() => {
      renderPageDrawerPdfThumbnail({
        file: pdfFile,
        pageNumber,
        targetWidth: THUMBNAIL_TARGET_WIDTH,
      })
        .then((result: PageDrawerPdfThumbnailResult) => {
          if (cancelled) return;
          setThumbnail({
            uri: result.uri,
            width: result.width,
            height: result.height,
            loading: false,
            failed: false,
          });
        })
        .catch(() => {
          if (cancelled) return;
          setThumbnail((current) => ({
            uri: current.uri,
            width: current.width,
            height: current.height,
            loading: false,
            failed: true,
          }));
        });
    }, renderDelay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [page.pageNumber, pdfFile, props.renderOrder, shouldRenderPdf]);

  const dimensions = getPageDimensions({ thumbnail, strokes: scopedStrokes, textAnnotations: scopedTextAnnotations });
  const aspectRatio = Math.max(0.55, Math.min(1.9, dimensions.width / Math.max(1, dimensions.height)));
  const paperKind = page.kind === 'summary'
    ? 'summary'
    : (page.template ?? studyDocument?.blankTemplate ?? 'plain');
  const sheetSizing = aspectRatio >= 1
    ? { width: '100%' as const, aspectRatio }
    : { height: '100%' as const, aspectRatio };
  const imageUri = thumbnail.uri ?? imagePreviewUri;

  return (
    <View style={[
      props.styles.pageDrawerPreview,
      page.kind !== 'pdf' && props.styles.pageDrawerPreviewGenerated,
      props.isActive && props.styles.pageDrawerPreviewActive,
    ]}>
      <View style={[
        props.styles.pageDrawerSheet,
        page.kind === 'blank' && props.styles.pageDrawerSheetBlank,
        page.kind === 'summary' && props.styles.pageDrawerSheetSummary,
        props.isActive && props.styles.pageDrawerSheetActive,
        sheetSizing,
      ]}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={props.styles.pageDrawerThumbnailImage} resizeMode="cover" />
        ) : null}
        {!imageUri && page.kind === 'pdf' && studyDocument?.type === 'pdf' ? (
          <View pointerEvents="none" style={props.styles.pageDrawerPdfFallback}>
            <MaterialCommunityIcons name="file-pdf-box" size={22} color="#A8B0BE" />
            <Text style={props.styles.pageDrawerPdfFallbackText}>{page.pageNumber}</Text>
          </View>
        ) : null}
        {page.kind !== 'pdf' || studyDocument?.type === 'blank' ? <PaperLines kind={paperKind as 'plain' | 'ruled' | 'grid' | 'summary'} styles={props.styles} /> : null}
        {page.kind === 'summary' ? <GeneratedSummaryPreview generatedPage={props.generatedPage} styles={props.styles} /> : null}
        <InkAndTextOverlay
          pageWidth={dimensions.width}
          pageHeight={dimensions.height}
          strokes={scopedStrokes}
          textAnnotations={scopedTextAnnotations}
          styles={props.styles}
        />
      </View>
      <View style={props.styles.pageDrawerThumbnailTypeBadge}>
        <Text style={props.styles.pageDrawerThumbnailTypeText}>{getPageKindLabel(page, studyDocument?.type)}</Text>
      </View>
      {thumbnail.loading ? (
        <View style={props.styles.pageDrawerThumbnailLoading}>
          <ActivityIndicator size="small" color="#7EA7FF" />
        </View>
      ) : null}
      {props.bookmarked ? (
        <View style={props.styles.pageDrawerBookmarkBadge}>
          <MaterialCommunityIcons name="star" size={12} color="#FBBF24" />
        </View>
      ) : null}
    </View>
  );
}
