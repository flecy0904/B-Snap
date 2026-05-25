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

  @ReactProp(name = "brushSettings")
  fun setBrushSettings(view: PdfViewportView, value: ReadableMap?) {
    // Parsed in a later native brush pass. Keeping the prop registered avoids RN prop warnings.
  }

  @ReactProp(name = "inkStrokes")
  fun setInkStrokes(view: PdfViewportView, strokes: ReadableArray?) {
    view.setInkStrokes(strokes)
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    MapBuilder.builder<String, Any>()
      .put("topDocumentLoaded", MapBuilder.of("registrationName", "onDocumentLoaded"))
      .put("topPageChanged", MapBuilder.of("registrationName", "onPageChanged"))
      .put("topCommitInkStroke", MapBuilder.of("registrationName", "onCommitInkStroke"))
      .put("topRemoveInkStroke", MapBuilder.of("registrationName", "onRemoveInkStroke"))
      .build()
      .toMutableMap()
}
