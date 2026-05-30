package com.anonymous.bsnap

import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.common.MapBuilder
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.annotations.ReactProp

class PdfViewportViewManager(private val reactContext: ReactApplicationContext) : SimpleViewManager<PdfViewportView>() {
  override fun getName(): String = "BsnPdfViewportView"

  override fun createViewInstance(reactContext: ThemedReactContext): PdfViewportView =
    PdfViewportView(reactContext)

  @ReactProp(name = "fileUri")
  fun setFileUri(view: PdfViewportView, fileUri: String?) {
    view.setFileUri(fileUri)
  }

  @ReactProp(name = "page", defaultInt = 1)
  fun setPage(view: PdfViewportView, page: Int) {
    view.setRequestedPage(page)
  }

  @ReactProp(name = "requestedPageSerial", defaultInt = 0)
  fun setRequestedPageSerial(view: PdfViewportView, serial: Int) {
    // iOS uses this to separate explicit page jumps from layout prop churn.
    // Android already treats requested page updates conservatively.
  }

  @ReactProp(name = "notebookPages")
  fun setNotebookPages(view: PdfViewportView, pages: ReadableArray?) {
    view.setNotebookPages(pages)
  }

  @ReactProp(name = "inkTool")
  fun setInkTool(view: PdfViewportView, value: String?) {
    view.setInkTool(value)
  }

  @ReactProp(name = "fingerDrawingEnabled", defaultBoolean = false)
  fun setFingerDrawingEnabled(view: PdfViewportView, value: Boolean) {
    view.setFingerDrawingEnabled(value)
  }

  @ReactProp(name = "penColor")
  fun setPenColor(view: PdfViewportView, value: String?) {
    view.setPenColor(value)
  }

  @ReactProp(name = "penWidth", defaultFloat = 3f)
  fun setPenWidth(view: PdfViewportView, value: Float) {
    view.setPenWidth(value)
  }

  @ReactProp(name = "brushType")
  fun setBrushType(view: PdfViewportView, value: String?) {
    view.setBrushType(value)
  }

  @ReactProp(name = "linePattern")
  fun setLinePattern(view: PdfViewportView, value: String?) {
    view.setLinePattern(value)
  }

  @ReactProp(name = "eraserMode")
  fun setEraserMode(view: PdfViewportView, value: String?) {
    view.setEraserMode(value)
  }

  @ReactProp(name = "eraserWidth", defaultFloat = 6f)
  fun setEraserWidth(view: PdfViewportView, value: Float) {
    view.setEraserWidth(value)
  }

  @ReactProp(name = "brushSettings")
  fun setBrushSettings(view: PdfViewportView, value: ReadableMap?) {
    // Parsed in a later native brush pass. Keeping the prop registered avoids RN prop warnings.
  }

  @ReactProp(name = "inkStrokes")
  fun setInkStrokes(view: PdfViewportView, strokes: ReadableArray?) {
    view.setInkStrokes(strokes)
  }

  @ReactProp(name = "textAnnotations")
  fun setTextAnnotations(view: PdfViewportView, value: ReadableArray?) {
    // iOS hosts PDF text annotations natively. Android keeps the existing JS text overlay.
  }

  @ReactProp(name = "imageAnnotations")
  fun setImageAnnotations(view: PdfViewportView, value: ReadableArray?) {
    // Registered for cross-platform prop parity while iOS owns native image placement.
  }

  @ReactProp(name = "hiddenTextAnnotationIds")
  fun setHiddenTextAnnotationIds(view: PdfViewportView, value: ReadableArray?) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionPreviewStrokeIds")
  fun setSelectionPreviewStrokeIds(view: PdfViewportView, value: ReadableArray?) {
    // iOS draws selected ink movement in native preview. Android keeps the existing JS overlay path.
  }

  @ReactProp(name = "selectionPreviewPageNumber", defaultInt = 0)
  fun setSelectionPreviewPageNumber(view: PdfViewportView, value: Int) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionPreviewGeneratedPageId")
  fun setSelectionPreviewGeneratedPageId(view: PdfViewportView, value: String?) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionPreviewOffsetX", defaultFloat = 0f)
  fun setSelectionPreviewOffsetX(view: PdfViewportView, value: Float) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionPreviewOffsetY", defaultFloat = 0f)
  fun setSelectionPreviewOffsetY(view: PdfViewportView, value: Float) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionOverlayPageNumber", defaultInt = 0)
  fun setSelectionOverlayPageNumber(view: PdfViewportView, value: Int) {
    // iOS draws the selection box/handles natively. Android keeps the existing JS overlay path.
  }

  @ReactProp(name = "selectionOverlayGeneratedPageId")
  fun setSelectionOverlayGeneratedPageId(view: PdfViewportView, value: String?) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionOverlayX", defaultFloat = 0f)
  fun setSelectionOverlayX(view: PdfViewportView, value: Float) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionOverlayY", defaultFloat = 0f)
  fun setSelectionOverlayY(view: PdfViewportView, value: Float) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionOverlayWidth", defaultFloat = 0f)
  fun setSelectionOverlayWidth(view: PdfViewportView, value: Float) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionOverlayHeight", defaultFloat = 0f)
  fun setSelectionOverlayHeight(view: PdfViewportView, value: Float) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionOverlayPageWidth", defaultFloat = 1f)
  fun setSelectionOverlayPageWidth(view: PdfViewportView, value: Float) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionOverlayPageHeight", defaultFloat = 1f)
  fun setSelectionOverlayPageHeight(view: PdfViewportView, value: Float) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionOverlayDraft", defaultBoolean = false)
  fun setSelectionOverlayDraft(view: PdfViewportView, value: Boolean) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionGestureEnabled", defaultBoolean = false)
  fun setSelectionGestureEnabled(view: PdfViewportView, value: Boolean) {
    // iOS uses native selection gesture hit-testing. Android keeps the existing JS overlay path.
  }

  @ReactProp(name = "selectionMode")
  fun setSelectionMode(view: PdfViewportView, value: String?) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionOverlayMode")
  fun setSelectionOverlayMode(view: PdfViewportView, value: String?) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionOverlayPath")
  fun setSelectionOverlayPath(view: PdfViewportView, value: ReadableArray?) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "selectionMenuEnabled", defaultBoolean = false)
  fun setSelectionMenuEnabled(view: PdfViewportView, value: Boolean) {
    // iOS draws and hit-tests the native selection menu. Android keeps the existing JS menu.
  }

  @ReactProp(name = "selectionMenuEditable", defaultBoolean = false)
  fun setSelectionMenuEditable(view: PdfViewportView, value: Boolean) {
    // Registered for cross-platform prop parity.
  }

  @ReactProp(name = "textGestureEnabled", defaultBoolean = false)
  fun setTextGestureEnabled(view: PdfViewportView, value: Boolean) {
    // iOS places new text annotations through native hit-testing. Android keeps the JS overlay path.
  }

  @ReactProp(name = "perfLoggingEnabled", defaultBoolean = false)
  fun setPerfLoggingEnabled(view: PdfViewportView, value: Boolean) {
    // iOS emits throttled native perf logs for Android parity comparison.
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    MapBuilder.builder<String, Any>()
      .put("topDocumentLoaded", MapBuilder.of("registrationName", "onDocumentLoaded"))
      .put("topPageChanged", MapBuilder.of("registrationName", "onPageChanged"))
      .put("topViewportChanged", MapBuilder.of("registrationName", "onViewportChanged"))
      .put("topCommitInkStroke", MapBuilder.of("registrationName", "onCommitInkStroke"))
      .put("topRemoveInkStroke", MapBuilder.of("registrationName", "onRemoveInkStroke"))
      .put("topReplaceInkStrokes", MapBuilder.of("registrationName", "onReplaceInkStrokes"))
      .put("topSelectionGesture", MapBuilder.of("registrationName", "onSelectionGesture"))
      .put("topSelectionAction", MapBuilder.of("registrationName", "onSelectionAction"))
      .put("topTextAnnotationAdd", MapBuilder.of("registrationName", "onTextAnnotationAdd"))
      .put("topTextAnnotationChange", MapBuilder.of("registrationName", "onTextAnnotationChange"))
      .put("topTextAnnotationRemove", MapBuilder.of("registrationName", "onTextAnnotationRemove"))
      .build()
      .toMutableMap()
}
