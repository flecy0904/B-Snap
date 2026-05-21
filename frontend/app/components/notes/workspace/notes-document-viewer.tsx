import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { BlankNoteCanvas } from '../canvas/blank-note-canvas';
import { PdfPreview } from '../pdf/pdf-preview';
import { useNotesGlobalContext } from './notes-global-context';
import { useDocumentContext } from './document-context';
import { useNavigationContext } from './navigation-context';
import { useCanvasContext } from '../canvas/canvas-context';

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

  if (documentContext.studyDocument?.type === 'pdf' && documentContext.studyDocument?.file) {
    const documentInkStrokes = documentContext.studyDocument?.id
      ? (canvasContext.inkByDocument[documentContext.studyDocument.id] ?? []).filter((stroke) => !stroke.generatedPageId || documentContext.notebookPages.some((page) => page.generatedPageId === stroke.generatedPageId))
      : canvasContext.inkStrokes;
    const documentTextAnnotations = documentContext.studyDocument?.id
      ? (canvasContext.textAnnotationsByDocument[documentContext.studyDocument.id] ?? []).filter((annotation) => !annotation.generatedPageId || documentContext.notebookPages.some((page) => page.generatedPageId === annotation.generatedPageId))
      : canvasContext.textAnnotations;

    return (
      <PdfPreview
        file={documentContext.studyDocument?.file}
        page={documentContext.currentPdfPage}
        inkTool={canvasContext.inkTool}
        fingerDrawingEnabled={globalContext.fingerDrawingEnabled}
        penColor={canvasContext.penColor}
        penWidth={canvasContext.penWidth}
        brushType={canvasContext.brushType}
        linePattern={canvasContext.linePattern}
        eraserMode={canvasContext.eraserMode}
        selectionMode={canvasContext.selectionMode}
        brushSettings={canvasContext.brushSettings}
        inkStrokes={documentInkStrokes}
        textAnnotations={documentTextAnnotations}
        notebookPages={documentContext.notebookPages}
        activeGeneratedPageId={documentContext.currentDocumentPage?.kind === 'generated' ? documentContext.currentDocumentPage.pageId : null}
        pageCaptureReferences={globalContext.pageCaptureReferences}
        incomingAssetSuggestion={globalContext.incomingAssetSuggestion}
        onAcceptIncomingAsset={globalContext.onAcceptIncomingAsset}
        onArchiveIncomingAsset={globalContext.onArchiveIncomingAsset}
        onDismissIncomingAsset={globalContext.onDismissIncomingAsset}
        onOpenPageCaptureReference={globalContext.onOpenPageCaptureReference}
        onAskAiAboutPageCaptureReference={globalContext.onAskAiAboutPageCaptureReference}
        selectionRect={canvasContext.selectionRect}
        onCommitInkStroke={canvasContext.commitInkStroke}
        onRemoveInkStroke={canvasContext.removeInkStroke}
        onAddTextAnnotation={canvasContext.addTextAnnotation}
        onUpdateTextAnnotation={canvasContext.updateTextAnnotation}
        onRemoveTextAnnotation={canvasContext.removeTextAnnotation}
        onMoveTextAnnotation={canvasContext.moveTextAnnotation}
        onResizeTextAnnotation={canvasContext.resizeTextAnnotation}
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
        styles={globalContext.styles}
      />
    );
  }

  if (documentContext.activeGeneratedPage) {
    if (documentContext.activeGeneratedPage.pageKind === 'memo') {
      return (
        <BlankNoteCanvas
          styles={globalContext.styles}
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
                  <Image source={globalContext.activeGeneratedPreviewImage} style={globalContext.styles.generatedPageImage} resizeMode="cover" />
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

  return <BlankNoteCanvas backgroundImageUri={backgroundImageUri} styles={globalContext.styles} />;
});
