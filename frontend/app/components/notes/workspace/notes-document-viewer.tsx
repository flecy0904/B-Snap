import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Image, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { BlankNoteCanvas } from '../canvas/blank-note-canvas';
import { PdfPreview } from '../pdf/pdf-preview';
import { useNotesGlobalContext } from './notes-global-context';
import { useDocumentContext } from './document-context';
import { useNavigationContext } from './navigation-context';
import { useCanvasContext } from '../canvas/canvas-context';

const HANDWRITING_DEBUG_ENABLED = process.env.EXPO_PUBLIC_ENABLE_HANDWRITING_DEBUG === 'true';

function formatVisionSkipReason(reason?: string | null) {
  switch (reason) {
    case 'disabled':
      return 'fallback-disabled';
    case 'missing-api-key':
      return 'missing-api-key';
    case 'cluster-limit':
      return 'cluster-limit-exceeded';
    case 'page-limit':
      return 'note-page-limit-exceeded';
    case 'no-star-anchor':
      return 'no-star-anchor';
    case 'no-star-text-anchor':
      return 'no-star-text-anchor';
    default:
      return reason || '없음';
  }
}

export function HandwritingDebugFloatingPanel() {
  const globalContext = useNotesGlobalContext();
  const [expanded, setExpanded] = React.useState(true);
  const [showAdvanced, setShowAdvanced] = React.useState(false);
  const recognition = globalContext.currentPageHandwritingRecognition;
  const mlKit = globalContext.mlKitHandwritingDebug;
  const handwritingBusy = globalContext.handwritingAnalysisBusy;
  const readiness = globalContext.handwritingDebugReadiness;
  const firstCluster = recognition?.clusters?.[0] ?? null;
  const rejectedSymbolCandidate = firstCluster?.symbolCandidates?.find((candidate) => !candidate.accepted && candidate.confidence > 0)
    ?? firstCluster?.symbolCandidates?.find((candidate) => !candidate.accepted)
    ?? null;
  const disabled = !globalContext.canAnalyzeCurrentPageHandwriting || Boolean(handwritingBusy);
  const mlKitDisabled = !globalContext.canAnalyzeCurrentPageHandwriting || Boolean(mlKit?.busy) || Boolean(handwritingBusy);
  const missingReadiness = React.useMemo(() => {
    if (!readiness) return ['readiness'];
    const missing: string[] = [];
    if (!readiness.workspaceHydrated) missing.push('hydrated');
    if (!readiness.backendApiEnabled) missing.push('api');
    if (!readiness.studyDocumentId) missing.push('doc');
    if (!readiness.backendNoteId) missing.push('noteId');
    if (!readiness.currentDocumentHasBackendPages) missing.push('backendPages');
    if (typeof readiness.pageNumber !== 'number') missing.push('page');
    if (!readiness.pageId) missing.push('pageId');
    if (readiness.pendingPageSaveCount || readiness.savingPageCount) missing.push('save-pending');
    return missing;
  }, [readiness]);
  const debugReadyText = globalContext.canAnalyzeCurrentPageHandwriting
    ? 'analyze ready'
    : `not ready: missing ${missingReadiness.join(', ') || 'unknown'}`;
  const panelStyle = {
    position: 'absolute' as const,
    right: 12,
    top: 12,
    zIndex: 80,
    width: 320,
    maxWidth: '92%' as const,
    maxHeight: '72%' as const,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D9E2FF',
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    padding: 10,
    shadowColor: '#172033',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  };
  const rowTextStyle = {
    fontSize: 11,
    lineHeight: 15,
    color: '#5D687A',
    fontWeight: '700' as const,
  };
  const buttonStyle = {
    minHeight: 28,
    paddingHorizontal: 9,
    borderRadius: 9,
    backgroundColor: '#EEF2FF',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  const primaryButtonStyle = {
    ...buttonStyle,
    backgroundColor: '#4F68D2',
  };
  const buttonTextStyle = {
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '900' as const,
    color: '#4F68D2',
  };
  const primaryButtonTextStyle = {
    ...buttonTextStyle,
    color: '#FFFFFF',
  };

  if (!HANDWRITING_DEBUG_ENABLED) return null;

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', inset: 0, zIndex: 80 }}>
      <View style={panelStyle}>
        <Pressable
          onPress={() => setExpanded((current) => !current)}
          style={{ minHeight: 28, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
        >
          <Text style={{ fontSize: 12, fontWeight: '900', color: '#23304A' }}>손필기 디버그</Text>
          <Text style={{ fontSize: 11, fontWeight: '900', color: '#4F68D2' }}>{recognition?.status ?? 'not-run'}</Text>
        </Pressable>
        {expanded ? (
          <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false} style={{ maxHeight: 430 }} contentContainerStyle={{ gap: 6, paddingTop: 8 }}>
            <Text style={rowTextStyle} numberOfLines={1}>engine {recognition?.engine ?? '없음'} · confidence {typeof recognition?.confidence === 'number' ? `${Math.round(recognition.confidence * 100)}%` : '없음'}</Text>
            <Text style={[rowTextStyle, { color: globalContext.canAnalyzeCurrentPageHandwriting ? '#15803D' : '#B45309' }]} numberOfLines={2}>
              ready {debugReadyText}
            </Text>
            <Text style={rowTextStyle} numberOfLines={2}>
              persist {readiness?.handwritingSaveState ?? 'idle'} · persisted {readiness?.handwritingPersisted === null || readiness?.handwritingPersisted === undefined ? 'unknown' : readiness.handwritingPersisted ? 'yes' : 'no'}
            </Text>
            {readiness?.lastHandwritingSaveError ? (
              <Text style={[rowTextStyle, { color: '#B45309' }]} numberOfLines={2}>
                save error {readiness.lastHandwritingSaveError}
              </Text>
            ) : null}
            <Text style={rowTextStyle} numberOfLines={2}>keywords {recognition?.keywords?.length ? recognition.keywords.join(', ') : '없음'}</Text>
            <Text style={rowTextStyle} numberOfLines={2}>symbols {recognition?.symbols?.length ? recognition.symbols.join(', ') : '없음'}</Text>
            <Text style={rowTextStyle} numberOfLines={2}>
              clusters {recognition?.analyzedClusterCount ?? recognition?.clusters?.length ?? 0} · vision {recognition?.visionAnalyzedClusterCount ?? 0} · skipped {formatVisionSkipReason(recognition?.visionFallbackSkippedReason)}
            </Text>
            <Text style={rowTextStyle} numberOfLines={2}>
              mlkit {mlKit?.available === null ? 'unknown' : mlKit?.available ? 'available' : 'unavailable'} · model {mlKit?.modelState ?? (mlKit?.modelReady === null ? 'unknown' : mlKit?.modelReady ? 'ready' : 'missing')}
            </Text>
            <Text style={rowTextStyle} numberOfLines={2}>
              mlkit keywords {mlKit?.result?.keywords?.length ? mlKit.result.keywords.join(', ') : '없음'} · clusters {mlKit?.result?.clusters?.length ?? 0}
            </Text>
            <Text style={rowTextStyle} numberOfLines={2}>
              candidates {mlKit?.result?.candidates?.length ? mlKit.result.candidates.slice(0, 2).map((candidate) => candidate.text).join(' · ') : '없음'}
            </Text>
            <Pressable onPress={() => setShowAdvanced((current) => !current)} style={{ alignSelf: 'flex-start', paddingVertical: 2 }}>
              <Text style={[buttonTextStyle, { fontSize: 11 }]}>{showAdvanced ? '상세 숨기기' : '상세 보기'}</Text>
            </Pressable>
            {showAdvanced ? (
              <>
                <Text style={rowTextStyle} numberOfLines={2}>
                  ids doc {readiness?.studyDocumentId ?? '없음'} · note {readiness?.backendNoteId ?? '없음'} · page {readiness?.pageNumber ?? '없음'} · pageId {readiness?.pageId ?? '없음'}
                </Text>
                <Text style={rowTextStyle} numberOfLines={2}>
                  state platform {readiness?.platform ?? Platform.OS} · api {readiness?.backendApiEnabled ? 'on' : 'off'} · url {readiness?.backendUrlPresent ? 'env' : 'default'}
                </Text>
                <Text style={rowTextStyle} numberOfLines={2}>
                  sync hydrated {readiness?.workspaceHydrated ? 'yes' : 'no'} · backendPages {readiness?.currentDocumentHasBackendPages ? 'yes' : 'no'} · pageCount {readiness?.backendPageCount ?? 0}
                </Text>
                <Text style={rowTextStyle} numberOfLines={2}>
                  autosave queue p/s/f {readiness?.pendingPageSaveCount ?? 0}/{readiness?.savingPageCount ?? 0}/{readiness?.failedPageSaveCount ?? 0}
                </Text>
                <Text style={rowTextStyle} numberOfLines={1}>hash {recognition?.strokeHash ? recognition.strokeHash.slice(0, 12) : '없음'}</Text>
                <Text style={rowTextStyle} numberOfLines={2}>text {recognition?.text || '없음'}</Text>
                {firstCluster ? (
                  <Text style={rowTextStyle} numberOfLines={2}>
                    cluster {firstCluster.clusterKind ?? 'unknown'} · text {typeof firstCluster.textLikeScore === 'number' ? Math.round(firstCluster.textLikeScore * 100) : 0}% · symbol {typeof firstCluster.symbolLikeScore === 'number' ? Math.round(firstCluster.symbolLikeScore * 100) : 0}%
                  </Text>
                ) : null}
                {rejectedSymbolCandidate ? (
                  <Text style={rowTextStyle} numberOfLines={2}>
                    rejected {rejectedSymbolCandidate.symbol} {Math.round((rejectedSymbolCandidate.confidence ?? 0) * 100)}% · {rejectedSymbolCandidate.rejectionReason ?? 'below threshold'}
                  </Text>
                ) : null}
                {mlKit?.detail ? <Text style={rowTextStyle} numberOfLines={2}>detail {mlKit.detail}</Text> : null}
              </>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
              <Pressable style={[primaryButtonStyle, disabled && { opacity: 0.5 }]} disabled={disabled} onPress={globalContext.analyzeCurrentPageHandwriting}>
                <Text style={primaryButtonTextStyle}>{handwritingBusy === 'page' ? '분석 중' : 'geometry 저장'}</Text>
              </Pressable>
              <Pressable style={[buttonStyle, disabled && { opacity: 0.5 }]} disabled={disabled} onPress={globalContext.forceAnalyzeCurrentPageHandwriting}>
                <Text style={buttonTextStyle}>force</Text>
              </Pressable>
              <Pressable style={[buttonStyle, disabled && { opacity: 0.5 }]} disabled={disabled} onPress={globalContext.analyzeCurrentPageHandwritingWithVision}>
                <Text style={buttonTextStyle}>Vision</Text>
              </Pressable>
              <Pressable style={[buttonStyle, mlKit?.busy && { opacity: 0.5 }]} disabled={Boolean(mlKit?.busy)} onPress={globalContext.checkMlKitHandwritingAvailability}>
                <Text style={buttonTextStyle}>ML Kit 확인</Text>
              </Pressable>
              <Pressable style={[buttonStyle, mlKit?.busy && { opacity: 0.5 }]} disabled={Boolean(mlKit?.busy)} onPress={globalContext.prepareKoreanHandwritingModel}>
                <Text style={buttonTextStyle}>모델 준비</Text>
              </Pressable>
              <Pressable style={[buttonStyle, mlKitDisabled && { opacity: 0.5 }]} disabled={mlKitDisabled} onPress={globalContext.recognizeCurrentPageWithMlKit}>
                <Text style={buttonTextStyle}>ML Kit 실행</Text>
              </Pressable>
              <Pressable style={[primaryButtonStyle, mlKitDisabled && { opacity: 0.5 }]} disabled={mlKitDisabled} onPress={globalContext.recognizeAndSaveCurrentPageWithMlKit}>
                <Text style={primaryButtonTextStyle}>ML Kit 저장</Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : null}
      </View>
    </View>
  );
}

export const NotesDocumentViewer = React.memo(function NotesDocumentViewer() {
  const globalContext = useNotesGlobalContext();
  const documentContext = useDocumentContext();
  const navigationContext = useNavigationContext();
  const canvasContext = useCanvasContext();

  if (documentContext.activeGeneratedPage?.status === 'generating') {
    return (
      <View style={globalContext.styles.generatedPageCard}>
        <View style={globalContext.styles.generatedPageContent}>
          {globalContext.activeGeneratedAttachment ? (
            <View style={globalContext.styles.generatedPageHeader}>
              <View style={globalContext.styles.fill} />
              <Pressable style={globalContext.styles.generatedPageDeleteButton} onPress={() => globalContext.activeGeneratedAttachment && globalContext.onRemoveWorkspaceAttachment(globalContext.activeGeneratedAttachment.id)}>
                <Text style={globalContext.styles.generatedPageDeleteText}>삭제</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={globalContext.styles.generatedPageLoading}>
            <ActivityIndicator size="large" color={globalContext.blueColor} />
            <Text style={globalContext.styles.generatedPageLoadingTitle}>판서+LLM 정리본을 만드는 중입니다.</Text>
            <Text style={globalContext.styles.generatedPageLoadingBody}>완료되면 현재 PDF 다음 위치에 새 페이지로 추가됩니다.</Text>
          </View>
        </View>
      </View>
    );
  }

  const pdfSurfaceFile = documentContext.studyDocument?.file;
  const usePdfSurfaceDocument = (
    (
      documentContext.studyDocument?.type === 'pdf'
      || (Platform.OS !== 'web' && documentContext.studyDocument?.type === 'blank')
    )
    && pdfSurfaceFile
  );

  if (usePdfSurfaceDocument && pdfSurfaceFile) {
    const documentInkStrokes = documentContext.studyDocument?.id
      ? (canvasContext.inkByDocument[documentContext.studyDocument.id] ?? []).filter((stroke) => !stroke.generatedPageId || documentContext.notebookPages.some((page) => page.generatedPageId === stroke.generatedPageId))
      : canvasContext.inkStrokes;
    const documentTextAnnotations = documentContext.studyDocument?.id
      ? (canvasContext.textAnnotationsByDocument[documentContext.studyDocument.id] ?? []).filter((annotation) => !annotation.generatedPageId || documentContext.notebookPages.some((page) => page.generatedPageId === annotation.generatedPageId))
      : canvasContext.textAnnotations;
    const documentImageAnnotations = documentContext.studyDocument?.id
      ? (canvasContext.imageAnnotationsByDocument[documentContext.studyDocument.id] ?? []).filter((annotation) => !annotation.generatedPageId || documentContext.notebookPages.some((page) => page.generatedPageId === annotation.generatedPageId))
      : canvasContext.imageAnnotations;
    const readMode = globalContext.studyInteractionMode === 'read';
    const effectiveInkTool = readMode ? 'view' : canvasContext.inkTool;
    const webChatSidebarOpen = !globalContext.usesAppAiPanelLayout && globalContext.aiPanelOpen && globalContext.aiPanelMode === 'sidebar';
    const webAiCanvasSidebarOpen = !globalContext.usesAppAiPanelLayout && globalContext.aiCanvas.isOpen;
    const pdfPageAlign = webChatSidebarOpen && !webAiCanvasSidebarOpen
      ? 'start'
      : webAiCanvasSidebarOpen && !webChatSidebarOpen
        ? 'end'
        : 'center';

    return (
      <View style={{ flex: 1 }}>
        <PdfPreview
          file={pdfSurfaceFile}
          viewStateKey={documentContext.studyDocument?.id ? `study-document:${documentContext.studyDocument.id}` : null}
          pageAlign={pdfPageAlign}
          page={documentContext.currentPdfPage}
          inkTool={effectiveInkTool}
          fingerDrawingEnabled={readMode ? false : globalContext.fingerDrawingEnabled}
          penColor={canvasContext.penColor}
          penWidth={canvasContext.penWidth}
          brushType={canvasContext.brushType}
          linePattern={canvasContext.linePattern}
          eraserMode={canvasContext.eraserMode}
          eraserWidth={canvasContext.eraserWidth}
          selectionMode={canvasContext.selectionMode}
          brushSettings={canvasContext.brushSettings}
          inkStrokes={documentInkStrokes}
          textAnnotations={documentTextAnnotations}
          imageAnnotations={documentImageAnnotations}
          readOnly={readMode}
          notebookPages={documentContext.notebookPages}
          activeGeneratedPageId={documentContext.currentDocumentPage?.kind === 'generated' ? documentContext.currentDocumentPage.pageId : null}
          pageCaptureReferences={globalContext.pageCaptureReferences}
          incomingAssetSuggestion={globalContext.incomingAssetSuggestion}
          handwritingDebugClusters={HANDWRITING_DEBUG_ENABLED ? globalContext.currentPageHandwritingRecognition?.clusters ?? [] : []}
          onAcceptIncomingAsset={globalContext.onAcceptIncomingAsset}
          onArchiveIncomingAsset={globalContext.onArchiveIncomingAsset}
          onDismissIncomingAsset={globalContext.onDismissIncomingAsset}
          onOpenPageCaptureReference={globalContext.onOpenPageCaptureReference}
          onAskAiAboutPageCaptureReference={globalContext.onAskAiAboutPageCaptureReference}
          selectionRect={readMode ? null : canvasContext.selectionRect}
          onCommitInkStroke={canvasContext.commitInkStroke}
          onRemoveInkStroke={canvasContext.removeInkStroke}
          onReplaceInkStrokes={canvasContext.replaceInkStrokes}
          onAddTextAnnotation={canvasContext.addTextAnnotation}
          onUpdateTextAnnotation={canvasContext.updateTextAnnotation}
          onRemoveTextAnnotation={canvasContext.removeTextAnnotation}
          onMoveTextAnnotation={canvasContext.moveTextAnnotation}
          onResizeTextAnnotation={canvasContext.resizeTextAnnotation}
          onChangeTextAnnotationFontSize={canvasContext.changeTextAnnotationFontSize}
          onEraseInkAtPoint={canvasContext.eraseInkAtPoint}
          onSelectionChange={canvasContext.setSelectionRect}
          onMoveSelection={canvasContext.nudgeSelectedStrokes}
          onResizeSelection={canvasContext.resizeSelectedStrokesToRect}
          onAskAiAboutSelection={globalContext.onAskAiAboutSelection}
          onDuplicateSelection={canvasContext.duplicateSelectedStrokes}
          onDeleteSelection={canvasContext.deleteSelectedStrokes}
          onChangeSelectedStrokesColor={canvasContext.changeSelectedStrokesColor}
          onChangeInkTool={canvasContext.setInkTool}
          onSelectionPreviewChange={canvasContext.setSelectionPreviewUri}
          onPageChanged={documentContext.onSetCurrentPdfPage}
          onOpenGeneratedPage={documentContext.onOpenGeneratedPage}
          onDocumentLoaded={documentContext.onUpdateStudyDocumentPageCount}
          onViewportDoubleTap={globalContext.onToggleFocusMode}
          styles={globalContext.styles}
        />
        <HandwritingDebugFloatingPanel />
      </View>
    );
  }

  if (documentContext.activeGeneratedPage) {
    if (documentContext.activeGeneratedPage.pageKind === 'memo') {
      return (
        <BlankNoteCanvas
          styles={globalContext.styles}
          generatedPageId={documentContext.activeGeneratedPage.id}
          readOnly={globalContext.studyInteractionMode === 'read'}
        />
      );
    }

    return (
      <View style={globalContext.styles.generatedPageCard}>
        <View style={globalContext.styles.generatedPageSheet}>
          <View style={globalContext.styles.generatedPageContent}>
            {globalContext.activeGeneratedAttachment ? (
              <View style={globalContext.styles.generatedPageHeader}>
                <View style={globalContext.styles.fill} />
                <Pressable style={globalContext.styles.generatedPageDeleteButton} onPress={() => globalContext.activeGeneratedAttachment && globalContext.onRemoveWorkspaceAttachment(globalContext.activeGeneratedAttachment.id)}>
                  <Text style={globalContext.styles.generatedPageDeleteText}>삭제</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={globalContext.styles.generatedPageLayout}>
              <View style={globalContext.styles.generatedPageImageColumn}>
                {globalContext.activeGeneratedPreviewImage ? (
                  <Image source={globalContext.activeGeneratedPreviewImage} style={globalContext.styles.generatedPageImage} resizeMode="contain" />
                ) : (
                  <View style={globalContext.styles.generatedPageImageFallback}>
                    <MaterialCommunityIcons name="image-outline" size={32} color="#6D7BD9" />
                  </View>
                )}
              </View>
              <View style={globalContext.styles.generatedPagePaper}>
                <ScrollView contentContainerStyle={globalContext.styles.generatedPagePaperContent} showsVerticalScrollIndicator={false}>
                  <Text style={globalContext.styles.generatedSummaryTitle}>{documentContext.activeGeneratedPage.summaryTitle}</Text>
                  {documentContext.activeGeneratedPage.summarySections.slice(0, 2).map((section: any, index: number) => (
                    <View key={`${section.title}-${index}`} style={[globalContext.styles.generatedSummaryCard, index === 1 && globalContext.styles.generatedSummaryCardSoft]}>
                      <Text style={globalContext.styles.generatedSummaryLabel}>{section.title}</Text>
                      <Text style={globalContext.styles.generatedSummaryBody}>{section.body}</Text>
                    </View>
                  ))}
                  {documentContext.activeGeneratedPage.formulaText ? (
                    <View style={globalContext.styles.generatedFormulaCallout}>
                      <Text style={globalContext.styles.generatedSummaryLabel}>필기 핵심</Text>
                      <Text style={globalContext.styles.generatedSummaryBody}>{documentContext.activeGeneratedPage.formulaText}</Text>
                    </View>
                  ) : null}
                </ScrollView>
              </View>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const backgroundImageUri =
    documentContext.studyDocument?.type === 'image' && typeof documentContext.studyDocument?.file === 'object'
      ? documentContext.studyDocument?.file.uri
      : null;

  return (
    <BlankNoteCanvas
      backgroundImageUri={backgroundImageUri}
      styles={globalContext.styles}
      pageCount={documentContext.studyDocument?.type === 'blank' ? documentContext.studyDocument.pageCount : 1}
      currentPage={documentContext.currentPdfPage}
      template={documentContext.studyDocument?.blankTemplate ?? 'plain'}
      onPageChange={documentContext.studyDocument?.type === 'blank' ? documentContext.onSetCurrentPdfPage : undefined}
      readOnly={globalContext.studyInteractionMode === 'read'}
    />
  );
});
