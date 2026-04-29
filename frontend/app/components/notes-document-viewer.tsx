import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { BlankNoteCanvas } from './blank-note-canvas';
import { PdfPreview } from './pdf-preview';
import { useDesktopNotesWorkspaceContext } from './notes-workspace-context';

export const NotesDocumentViewer = React.memo(function NotesDocumentViewer() {
  const workspace = useDesktopNotesWorkspaceContext();

  if (workspace.activeGeneratedPage?.status === 'generating') {
    return (
      <View style={workspace.styles.generatedPageCard}>
        <View style={workspace.styles.generatedPageContent}>
          {workspace.activeGeneratedAttachment ? (
            <View style={workspace.styles.generatedPageHeader}>
              <View style={workspace.styles.fill} />
              <Pressable style={workspace.styles.generatedPageDeleteButton} onPress={() => workspace.activeGeneratedAttachment && workspace.onRemoveWorkspaceAttachment(workspace.activeGeneratedAttachment.id)}>
                <Text style={workspace.styles.generatedPageDeleteText}>삭제</Text>
              </Pressable>
            </View>
          ) : null}
          <View style={workspace.styles.generatedPageLoading}>
            <ActivityIndicator size="large" color={workspace.blueColor} />
            <Text style={workspace.styles.generatedPageLoadingTitle}>판서+LLM 정리본을 만드는 중입니다.</Text>
            <Text style={workspace.styles.generatedPageLoadingBody}>완료되면 현재 PDF 다음 위치에 새 페이지로 추가됩니다.</Text>
          </View>
        </View>
      </View>
    );
  }

  if (workspace.activeGeneratedPage) {
    if (workspace.activeGeneratedPage.pageKind === 'memo') {
      return (
        <BlankNoteCanvas
          inkTool={workspace.inkTool}
          penColor={workspace.penColor}
          penWidth={workspace.penWidth}
          inkStrokes={workspace.inkStrokes}
          textAnnotations={workspace.textAnnotations}
          selectionRect={workspace.selectionRect}
          onCommitInkStroke={workspace.onCommitInkStroke}
          onRemoveInkStroke={workspace.onRemoveInkStroke}
          onAddTextAnnotation={workspace.onAddTextAnnotation}
          onUpdateTextAnnotation={workspace.onUpdateTextAnnotation}
          onRemoveTextAnnotation={workspace.onRemoveTextAnnotation}
          onSelectionChange={workspace.onSelectionChange}
          styles={workspace.styles}
        />
      );
    }

    return (
      <View style={workspace.styles.generatedPageCard}>
        <View style={workspace.styles.generatedPageSheet}>
          <View style={workspace.styles.generatedPageContent}>
            {workspace.activeGeneratedAttachment ? (
              <View style={workspace.styles.generatedPageHeader}>
                <View style={workspace.styles.fill} />
                <Pressable style={workspace.styles.generatedPageDeleteButton} onPress={() => workspace.activeGeneratedAttachment && workspace.onRemoveWorkspaceAttachment(workspace.activeGeneratedAttachment.id)}>
                  <Text style={workspace.styles.generatedPageDeleteText}>삭제</Text>
                </Pressable>
              </View>
            ) : null}
            <View style={workspace.styles.generatedPageLayout}>
              <View style={workspace.styles.generatedPageImageColumn}>
                {workspace.activeGeneratedPreviewImage ? (
                  <Image source={workspace.activeGeneratedPreviewImage} style={workspace.styles.generatedPageImage} resizeMode="cover" />
                ) : (
                  <View style={workspace.styles.generatedPageImageFallback}>
                    <MaterialCommunityIcons name="image-outline" size={32} color="#6D7BD9" />
                  </View>
                )}
              </View>
              <View style={workspace.styles.generatedPagePaper}>
                <ScrollView contentContainerStyle={workspace.styles.generatedPagePaperContent} showsVerticalScrollIndicator={false}>
                  <Text style={workspace.styles.generatedSummaryTitle}>{workspace.activeGeneratedPage.summaryTitle}</Text>
                  {workspace.activeGeneratedPage.summarySections.slice(0, 2).map((section, index) => (
                    <View key={`${section.title}-${index}`} style={[workspace.styles.generatedSummaryCard, index === 1 && workspace.styles.generatedSummaryCardSoft]}>
                      <Text style={workspace.styles.generatedSummaryLabel}>{section.title}</Text>
                      <Text style={workspace.styles.generatedSummaryBody}>{section.body}</Text>
                    </View>
                  ))}
                  {workspace.activeGeneratedPage.formulaText ? (
                    <View style={workspace.styles.generatedFormulaCallout}>
                      <Text style={workspace.styles.generatedSummaryLabel}>필기 핵심</Text>
                      <Text style={workspace.styles.generatedSummaryBody}>{workspace.activeGeneratedPage.formulaText}</Text>
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

  if (workspace.studyDocument.type === 'pdf' && workspace.studyDocument.file) {
    return (
      <PdfPreview
        file={workspace.studyDocument.file}
        page={workspace.currentPdfPage}
        inkTool={workspace.inkTool}
        penColor={workspace.penColor}
        penWidth={workspace.penWidth}
        inkStrokes={workspace.inkStrokes}
        textAnnotations={workspace.textAnnotations}
        textAnnotationVariant="marker"
        selectionRect={workspace.selectionRect}
        onCommitInkStroke={workspace.onCommitInkStroke}
        onRemoveInkStroke={workspace.onRemoveInkStroke}
        onAddTextAnnotation={workspace.onAddTextAnnotation}
        onUpdateTextAnnotation={workspace.onUpdateTextAnnotation}
        onRemoveTextAnnotation={workspace.onRemoveTextAnnotation}
        onSelectionChange={workspace.onSelectionChange}
        onSelectionPreviewChange={workspace.onSelectionPreviewChange}
        onPageChanged={workspace.onSetCurrentPdfPage}
        onDocumentLoaded={workspace.onUpdateStudyDocumentPageCount}
        styles={workspace.styles}
      />
    );
  }

  return <BlankNoteCanvas inkTool={workspace.inkTool} penColor={workspace.penColor} penWidth={workspace.penWidth} inkStrokes={workspace.inkStrokes} textAnnotations={workspace.textAnnotations} onCommitInkStroke={workspace.onCommitInkStroke} onRemoveInkStroke={workspace.onRemoveInkStroke} onAddTextAnnotation={workspace.onAddTextAnnotation} onUpdateTextAnnotation={workspace.onUpdateTextAnnotation} onRemoveTextAnnotation={workspace.onRemoveTextAnnotation} styles={workspace.styles} />;
});
