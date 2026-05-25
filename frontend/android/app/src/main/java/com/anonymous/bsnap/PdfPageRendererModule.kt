package com.anonymous.bsnap

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.UUID
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

class PdfPageRendererModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private data class SourceFingerprint(
    val key: String,
    val size: Long,
    val modifiedAt: Long
  )

  private data class SelectionCropRect(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
    val pageWidth: Float,
    val pageHeight: Float
  )

  private data class InkPoint(
    val x: Float,
    val y: Float,
    val pageWidth: Float,
    val pageHeight: Float
  )

  private data class InkStroke(
    val points: List<InkPoint>,
    val color: Int,
    val width: Float,
    val style: String,
    val linePattern: String?,
    val shape: String?,
    val pageNumber: Int?,
    val generatedPageId: String?,
    val pageWidth: Float,
    val pageHeight: Float
  )

  private data class TextAnnotation(
    val x: Float,
    val y: Float,
    val width: Float,
    val text: String,
    val pageNumber: Int?,
    val generatedPageId: String?,
    val pageWidth: Float,
    val pageHeight: Float
  )

  private val cacheMetadataVersion = 1
  private val cacheMetadataKind = "base"
  private val maxCachedPageImages = 11
  private val maxSelectionPreviewImages = 30

  override fun getName(): String = "BsnPdfPageRenderer"

  @ReactMethod
  fun renderPage(fileUri: String, pageNumber: Int, targetWidth: Int, promise: Promise) {
    if (fileUri.isBlank()) {
      promise.reject("PDF_RENDER_INVALID_URI", "PDF file URI is empty.")
      return
    }

    if (pageNumber < 1) {
      promise.reject("PDF_RENDER_INVALID_PAGE", "PDF pageNumber must start at 1.")
      return
    }

    val safeTargetWidth = max(1, targetWidth)
    var descriptor: ParcelFileDescriptor? = null
    var renderer: PdfRenderer? = null
    var page: PdfRenderer.Page? = null
    var bitmap: Bitmap? = null

    try {
      val outputFile = getOutputFile(fileUri, pageNumber, safeTargetWidth)
      val sourceFingerprint = getSourceFingerprint(fileUri)
      val cachedResult = if (sourceFingerprint != null) {
        readCachedPageResult(outputFile, pageNumber, safeTargetWidth, sourceFingerprint)
      } else {
        null
      }
      if (cachedResult != null) {
        prunePageImageCache(outputFile)
        promise.resolve(cachedResult)
        return
      }

      descriptor = openPdfDescriptor(fileUri)
      renderer = PdfRenderer(descriptor)

      if (pageNumber > renderer.pageCount) {
        promise.reject("PDF_RENDER_PAGE_OUT_OF_RANGE", "PDF pageNumber exceeds page count.")
        return
      }

      val fallbackCachedResult = readCachedPageResult(outputFile, pageNumber, safeTargetWidth, sourceFingerprint, renderer.pageCount)
      if (fallbackCachedResult != null) {
        prunePageImageCache(outputFile)
        promise.resolve(fallbackCachedResult)
        return
      }

      page = renderer.openPage(pageNumber - 1)
      val ratio = page.height.toFloat() / page.width.toFloat()
      val bitmapWidth = safeTargetWidth
      val bitmapHeight = max(1, (bitmapWidth * ratio).roundToInt())

      bitmap = Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.ARGB_8888)
      bitmap.eraseColor(Color.WHITE)
      val renderMatrix = Matrix().apply {
        postScale(
          bitmapWidth.toFloat() / page.width.toFloat(),
          bitmapHeight.toFloat() / page.height.toFloat()
        )
      }
      page.render(bitmap, null, renderMatrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)

      val temporaryOutputFile = getTemporaryOutputFile(outputFile)
      outputFile.parentFile?.mkdirs()
      temporaryOutputFile.delete()
      try {
        FileOutputStream(temporaryOutputFile).use { stream ->
          if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
            throw IllegalStateException("Cannot encode PDF page image.")
          }
        }
        if (outputFile.exists() && !outputFile.delete()) {
          throw IllegalStateException("Cannot replace cached PDF page image.")
        }
        if (!temporaryOutputFile.renameTo(outputFile)) {
          throw IllegalStateException("Cannot commit cached PDF page image.")
        }
        writeCacheMetadata(outputFile, pageNumber, renderer.pageCount, bitmapWidth, bitmapHeight, sourceFingerprint)
        prunePageImageCache(outputFile)
      } catch (error: Exception) {
        temporaryOutputFile.delete()
        throw error
      }

      val outputUri = "${Uri.fromFile(outputFile)}?v=${outputFile.lastModified()}"
      val result = Arguments.createMap().apply {
        putString("uri", outputUri)
        putInt("width", bitmapWidth)
        putInt("height", bitmapHeight)
        putInt("pageNumber", pageNumber)
        putInt("pageCount", renderer.pageCount)
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("PDF_RENDER_FAILED", error.message, error)
    } finally {
      bitmap?.recycle()
      page?.close()
      renderer?.close()
      descriptor?.close()
    }
  }

  @ReactMethod
  fun renderSelectionPreview(
    fileUri: String,
    pageNumber: Int,
    rect: ReadableMap,
    targetWidth: Int,
    inkStrokes: ReadableArray?,
    textAnnotations: ReadableArray?,
    promise: Promise
  ) {
    if (fileUri.isBlank()) {
      promise.reject("PDF_SELECTION_INVALID_URI", "PDF file URI is empty.")
      return
    }

    if (pageNumber < 1) {
      promise.reject("PDF_SELECTION_INVALID_PAGE", "PDF pageNumber must start at 1.")
      return
    }

    val selectionRect = parseSelectionRect(rect)
    if (selectionRect.width <= 0f || selectionRect.height <= 0f) {
      promise.reject("PDF_SELECTION_INVALID_RECT", "Selection rect must have a positive size.")
      return
    }

    val safeTargetWidth = max(1, targetWidth)
    var descriptor: ParcelFileDescriptor? = null
    var renderer: PdfRenderer? = null
    var page: PdfRenderer.Page? = null
    var bitmap: Bitmap? = null

    try {
      descriptor = openPdfDescriptor(fileUri)
      renderer = PdfRenderer(descriptor)

      if (pageNumber > renderer.pageCount) {
        promise.reject("PDF_SELECTION_PAGE_OUT_OF_RANGE", "PDF pageNumber exceeds page count.")
        return
      }

      page = renderer.openPage(pageNumber - 1)
      val sourceRect = selectionRectToPdfPageRect(selectionRect, page)
      if (sourceRect.width() <= 0f || sourceRect.height() <= 0f) {
        promise.reject("PDF_SELECTION_EMPTY_RECT", "Selection rect is outside the PDF page.")
        return
      }

      val bitmapWidth = safeTargetWidth
      val bitmapHeight = max(1, (bitmapWidth * sourceRect.height() / sourceRect.width()).roundToInt())
      bitmap = Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.ARGB_8888)
      bitmap.eraseColor(Color.WHITE)

      val renderMatrix = Matrix().apply {
        postTranslate(-sourceRect.left, -sourceRect.top)
        postScale(
          bitmapWidth.toFloat() / sourceRect.width(),
          bitmapHeight.toFloat() / sourceRect.height()
        )
      }
      page.render(bitmap, Rect(0, 0, bitmapWidth, bitmapHeight), renderMatrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)

      val canvas = Canvas(bitmap)
      val cropToBitmap = Matrix().apply {
        postTranslate(-sourceRect.left, -sourceRect.top)
        postScale(
          bitmapWidth.toFloat() / sourceRect.width(),
          bitmapHeight.toFloat() / sourceRect.height()
        )
      }
      val strokes = parseInkStrokes(inkStrokes)
        .filter { it.generatedPageId == null && it.pageNumber == pageNumber }
      drawInkStrokes(canvas, strokes, cropToBitmap, page)
      val annotations = parseTextAnnotations(textAnnotations)
        .filter { it.generatedPageId == null && it.pageNumber == pageNumber }
      drawTextAnnotations(canvas, annotations, cropToBitmap, page)

      val outputFile = getSelectionPreviewOutputFile()
      outputFile.parentFile?.mkdirs()
      FileOutputStream(outputFile).use { stream ->
        if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)) {
          throw IllegalStateException("Cannot encode PDF selection image.")
        }
      }
      pruneSelectionPreviewImages(outputFile)

      val result = Arguments.createMap().apply {
        putString("uri", "${Uri.fromFile(outputFile)}?v=${outputFile.lastModified()}")
        putInt("width", bitmapWidth)
        putInt("height", bitmapHeight)
        putInt("pageNumber", pageNumber)
        putInt("pageCount", renderer.pageCount)
      }
      promise.resolve(result)
    } catch (error: Exception) {
      promise.reject("PDF_SELECTION_RENDER_FAILED", error.message, error)
    } finally {
      bitmap?.recycle()
      page?.close()
      renderer?.close()
      descriptor?.close()
    }
  }

  private fun openPdfDescriptor(fileUri: String): ParcelFileDescriptor {
    val uri = Uri.parse(fileUri)
    if (uri.scheme == "content") {
      return reactContext.contentResolver.openFileDescriptor(uri, "r")
        ?: throw IllegalArgumentException("Cannot open PDF content URI.")
    }

    val path = when (uri.scheme) {
      "file" -> uri.path
      null, "" -> fileUri
      else -> null
    } ?: throw IllegalArgumentException("Only local file or content PDF URIs are supported.")

    val decodedPath = URLDecoder.decode(path, "UTF-8")
    val file = File(decodedPath)
    if (!file.exists()) {
      throw IllegalArgumentException("PDF file does not exist.")
    }
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  private fun parseSelectionRect(rect: ReadableMap): SelectionCropRect {
    val pageWidth = if (rect.hasKey("pageWidth") && !rect.isNull("pageWidth")) rect.getDouble("pageWidth").toFloat() else 1f
    val pageHeight = if (rect.hasKey("pageHeight") && !rect.isNull("pageHeight")) rect.getDouble("pageHeight").toFloat() else 1f
    return SelectionCropRect(
      x = rect.getDouble("x").toFloat(),
      y = rect.getDouble("y").toFloat(),
      width = rect.getDouble("width").toFloat(),
      height = rect.getDouble("height").toFloat(),
      pageWidth = max(1f, pageWidth),
      pageHeight = max(1f, pageHeight)
    )
  }

  private fun selectionRectToPdfPageRect(rect: SelectionCropRect, page: PdfRenderer.Page): RectF {
    val left = (rect.x / rect.pageWidth * page.width).coerceIn(0f, page.width.toFloat())
    val top = (rect.y / rect.pageHeight * page.height).coerceIn(0f, page.height.toFloat())
    val right = ((rect.x + rect.width) / rect.pageWidth * page.width).coerceIn(0f, page.width.toFloat())
    val bottom = ((rect.y + rect.height) / rect.pageHeight * page.height).coerceIn(0f, page.height.toFloat())
    return RectF(
      min(left, right),
      min(top, bottom),
      max(left, right),
      max(top, bottom)
    )
  }

  private fun parseInkStrokes(strokes: ReadableArray?): List<InkStroke> {
    if (strokes == null) return emptyList()
    val result = mutableListOf<InkStroke>()
    for (index in 0 until strokes.size()) {
      val map = strokes.getMap(index) ?: continue
      val points = mutableListOf<InkPoint>()
      val strokePageWidth = if (map.hasKey("pageWidth") && !map.isNull("pageWidth")) map.getDouble("pageWidth").toFloat() else 1f
      val strokePageHeight = if (map.hasKey("pageHeight") && !map.isNull("pageHeight")) map.getDouble("pageHeight").toFloat() else 1f
      val pointsArray = if (map.hasKey("points") && !map.isNull("points")) map.getArray("points") else null
      if (pointsArray != null) {
        for (pointIndex in 0 until pointsArray.size()) {
          val pointMap = pointsArray.getMap(pointIndex) ?: continue
          val pageWidth = if (pointMap.hasKey("pageWidth") && !pointMap.isNull("pageWidth")) pointMap.getDouble("pageWidth").toFloat() else strokePageWidth
          val pageHeight = if (pointMap.hasKey("pageHeight") && !pointMap.isNull("pageHeight")) pointMap.getDouble("pageHeight").toFloat() else strokePageHeight
          points.add(InkPoint(
            x = pointMap.getDouble("x").toFloat(),
            y = pointMap.getDouble("y").toFloat(),
            pageWidth = max(1f, pageWidth),
            pageHeight = max(1f, pageHeight)
          ))
        }
      }
      result.add(InkStroke(
        points = points,
        color = parseColor(map.getString("color") ?: "#111827"),
        width = if (map.hasKey("width") && !map.isNull("width")) map.getDouble("width").toFloat() else 3f,
        style = map.getString("style") ?: "pen",
        linePattern = if (map.hasKey("linePattern") && !map.isNull("linePattern")) map.getString("linePattern") else null,
        shape = if (map.hasKey("shape") && !map.isNull("shape")) map.getString("shape") else null,
        pageNumber = if (map.hasKey("pageNumber") && !map.isNull("pageNumber")) map.getInt("pageNumber") else null,
        generatedPageId = if (map.hasKey("generatedPageId") && !map.isNull("generatedPageId")) map.getString("generatedPageId") else null,
        pageWidth = max(1f, strokePageWidth),
        pageHeight = max(1f, strokePageHeight)
      ))
    }
    return result
  }

  private fun parseTextAnnotations(annotations: ReadableArray?): List<TextAnnotation> {
    if (annotations == null) return emptyList()
    val result = mutableListOf<TextAnnotation>()
    for (index in 0 until annotations.size()) {
      val map = annotations.getMap(index) ?: continue
      val pageWidth = if (map.hasKey("pageWidth") && !map.isNull("pageWidth")) map.getDouble("pageWidth").toFloat() else 1f
      val pageHeight = if (map.hasKey("pageHeight") && !map.isNull("pageHeight")) map.getDouble("pageHeight").toFloat() else 1f
      result.add(TextAnnotation(
        x = if (map.hasKey("x") && !map.isNull("x")) map.getDouble("x").toFloat() else 0f,
        y = if (map.hasKey("y") && !map.isNull("y")) map.getDouble("y").toFloat() else 0f,
        width = if (map.hasKey("width") && !map.isNull("width")) map.getDouble("width").toFloat() else 160f,
        text = map.getString("text") ?: "",
        pageNumber = if (map.hasKey("pageNumber") && !map.isNull("pageNumber")) map.getInt("pageNumber") else null,
        generatedPageId = if (map.hasKey("generatedPageId") && !map.isNull("generatedPageId")) map.getString("generatedPageId") else null,
        pageWidth = max(1f, pageWidth),
        pageHeight = max(1f, pageHeight)
      ))
    }
    return result
  }

  private fun drawInkStrokes(canvas: Canvas, strokes: List<InkStroke>, cropToBitmap: Matrix, page: PdfRenderer.Page) {
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeCap = Paint.Cap.ROUND
      strokeJoin = Paint.Join.ROUND
    }
    strokes.forEach { stroke ->
      if (stroke.points.isEmpty()) return@forEach
      paint.color = stroke.color
      paint.alpha = if (stroke.style == "highlight") 95 else Color.alpha(stroke.color).takeIf { it > 0 } ?: 255
      paint.strokeWidth = max(1f, stroke.width * strokeToBitmapScale(stroke.pageWidth, stroke.pageHeight, cropToBitmap, page))
      paint.pathEffect = when (stroke.linePattern) {
        "dotted" -> DashPathEffect(floatArrayOf(paint.strokeWidth, paint.strokeWidth * 1.8f), 0f)
        "dashed" -> DashPathEffect(floatArrayOf(paint.strokeWidth * 4f, paint.strokeWidth * 2.5f), 0f)
        else -> null
      }

      if (stroke.style == "shape" && stroke.points.size >= 2) {
        drawSelectionShape(canvas, paint, stroke, cropToBitmap, page)
      } else {
        val path = Path()
        stroke.points.forEachIndexed { pointIndex, point ->
          val mapped = mapInkPoint(point, cropToBitmap, page)
          if (pointIndex == 0) path.moveTo(mapped[0], mapped[1]) else path.lineTo(mapped[0], mapped[1])
        }
        canvas.drawPath(path, paint)
      }
      paint.alpha = 255
      paint.pathEffect = null
    }
  }

  private fun drawSelectionShape(canvas: Canvas, paint: Paint, stroke: InkStroke, cropToBitmap: Matrix, page: PdfRenderer.Page) {
    val start = stroke.points.first()
    val end = stroke.points.last()
    val mappedStart = mapInkPoint(start, cropToBitmap, page)
    val mappedEnd = mapInkPoint(end, cropToBitmap, page)
    val left = min(mappedStart[0], mappedEnd[0])
    val top = min(mappedStart[1], mappedEnd[1])
    val right = max(mappedStart[0], mappedEnd[0])
    val bottom = max(mappedStart[1], mappedEnd[1])
    when (stroke.shape) {
      "rect" -> canvas.drawRect(left, top, right, bottom, paint)
      "ellipse" -> canvas.drawOval(RectF(left, top, right, bottom), paint)
      "arrow" -> {
        canvas.drawLine(mappedStart[0], mappedStart[1], mappedEnd[0], mappedEnd[1], paint)
        drawSelectionArrowHead(canvas, paint, mappedStart[0], mappedStart[1], mappedEnd[0], mappedEnd[1])
      }
      else -> canvas.drawLine(mappedStart[0], mappedStart[1], mappedEnd[0], mappedEnd[1], paint)
    }
  }

  private fun drawSelectionArrowHead(canvas: Canvas, paint: Paint, x1: Float, y1: Float, x2: Float, y2: Float) {
    val angle = kotlin.math.atan2((y2 - y1).toDouble(), (x2 - x1).toDouble())
    val length = max(10f, paint.strokeWidth * 4f)
    val leftAngle = angle + Math.PI * 0.82
    val rightAngle = angle - Math.PI * 0.82
    canvas.drawLine(x2, y2, (x2 + cos(leftAngle) * length).toFloat(), (y2 + sin(leftAngle) * length).toFloat(), paint)
    canvas.drawLine(x2, y2, (x2 + cos(rightAngle) * length).toFloat(), (y2 + sin(rightAngle) * length).toFloat(), paint)
  }

  private fun drawTextAnnotations(canvas: Canvas, annotations: List<TextAnnotation>, cropToBitmap: Matrix, page: PdfRenderer.Page) {
    val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(235, 255, 255, 255)
      style = Paint.Style.FILL
    }
    val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.argb(210, 198, 207, 224)
      style = Paint.Style.STROKE
      strokeWidth = 1.5f
    }
    val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.rgb(17, 24, 39)
      style = Paint.Style.FILL
      textSize = 14f
    }

    annotations.forEach { annotation ->
      val topLeft = mapLogicalPoint(annotation.x, annotation.y, annotation.pageWidth, annotation.pageHeight, cropToBitmap, page)
      val bottomRight = mapLogicalPoint(annotation.x + annotation.width, annotation.y + 96f, annotation.pageWidth, annotation.pageHeight, cropToBitmap, page)
      val rect = RectF(
        min(topLeft[0], bottomRight[0]),
        min(topLeft[1], bottomRight[1]),
        max(topLeft[0], bottomRight[0]),
        max(topLeft[1], bottomRight[1])
      )
      if (rect.width() <= 2f || rect.height() <= 2f) return@forEach
      canvas.drawRoundRect(rect, 8f, 8f, backgroundPaint)
      canvas.drawRoundRect(rect, 8f, 8f, borderPaint)

      val scale = strokeToBitmapScale(annotation.pageWidth, annotation.pageHeight, cropToBitmap, page)
      textPaint.textSize = max(10f, 14f * scale)
      val padding = max(6f, 8f * scale)
      val lineHeight = textPaint.textSize * 1.28f
      val maxTextWidth = max(1f, rect.width() - padding * 2)
      var y = rect.top + padding + textPaint.textSize
      wrapText(annotation.text, textPaint, maxTextWidth).forEach { line ->
        if (y + lineHeight > rect.bottom - padding) return@forEach
        canvas.drawText(line, rect.left + padding, y, textPaint)
        y += lineHeight
      }
    }
  }

  private fun wrapText(text: String, paint: Paint, maxWidth: Float): List<String> {
    val source = text.trim()
    if (source.isBlank()) return emptyList()
    val lines = mutableListOf<String>()
    source.split('\n').forEach { paragraph ->
      var current = ""
      paragraph.split(Regex("\\s+")).filter { it.isNotBlank() }.forEach { word ->
        val candidate = if (current.isBlank()) word else "$current $word"
        if (paint.measureText(candidate) <= maxWidth) {
          current = candidate
        } else {
          if (current.isNotBlank()) lines.add(current)
          current = word
        }
      }
      if (current.isNotBlank()) lines.add(current)
    }
    return lines
  }

  private fun mapInkPoint(point: InkPoint, cropToBitmap: Matrix, page: PdfRenderer.Page): FloatArray {
    return mapLogicalPoint(point.x, point.y, point.pageWidth, point.pageHeight, cropToBitmap, page)
  }

  private fun mapLogicalPoint(x: Float, y: Float, pageWidth: Float, pageHeight: Float, cropToBitmap: Matrix, page: PdfRenderer.Page): FloatArray {
    val mapped = floatArrayOf(
      x / max(1f, pageWidth) * page.width,
      y / max(1f, pageHeight) * page.height
    )
    cropToBitmap.mapPoints(mapped)
    return mapped
  }

  private fun strokeToBitmapScale(pageWidth: Float, pageHeight: Float, cropToBitmap: Matrix, page: PdfRenderer.Page): Float {
    val origin = floatArrayOf(0f, 0f, page.width.toFloat(), page.height.toFloat())
    cropToBitmap.mapPoints(origin)
    val scaleX = kotlin.math.abs(origin[2] - origin[0]) / max(1f, pageWidth)
    val scaleY = kotlin.math.abs(origin[3] - origin[1]) / max(1f, pageHeight)
    return (scaleX + scaleY) / 2f
  }

  private fun getSourceFingerprint(fileUri: String): SourceFingerprint? {
    val file = getLocalPdfFile(fileUri) ?: return null
    if (!file.exists()) return null
    return SourceFingerprint(
      key = sha1(file.absolutePath),
      size = file.length(),
      modifiedAt = file.lastModified()
    )
  }

  private fun getLocalPdfFile(fileUri: String): File? {
    val uri = Uri.parse(fileUri)
    val path = when (uri.scheme) {
      "file" -> uri.path
      null, "" -> fileUri
      else -> null
    } ?: return null
    return File(URLDecoder.decode(path, "UTF-8"))
  }

  private fun getOutputFile(fileUri: String, pageNumber: Int, targetWidth: Int): File {
    val cacheDir = File(reactContext.cacheDir, "bsnap-pdf-pages")
    val key = sha1("$fileUri:$pageNumber:$targetWidth")
    return File(cacheDir, "$key.png")
  }

  private fun getSelectionPreviewOutputFile(): File {
    val cacheDir = File(reactContext.cacheDir, "bsnap-pdf-selections")
    return File(cacheDir, "selection-${System.currentTimeMillis()}-${UUID.randomUUID()}.png")
  }

  private fun getMetadataFile(outputFile: File): File {
    return File(outputFile.parentFile, "${outputFile.nameWithoutExtension}.json")
  }

  private fun getTemporaryOutputFile(outputFile: File): File {
    return File(outputFile.parentFile, "${outputFile.name}.${UUID.randomUUID()}.tmp")
  }

  private fun readCachedPageResult(
    outputFile: File,
    pageNumber: Int,
    targetWidth: Int,
    sourceFingerprint: SourceFingerprint?,
    expectedPageCount: Int? = null
  ) = try {
    val metadataFile = getMetadataFile(outputFile)
    if (!outputFile.isFile || !metadataFile.isFile) {
      null
    } else {
      val metadata = JSONObject(metadataFile.readText())
      val valid = metadata.optInt("version") == cacheMetadataVersion
        && metadata.optString("kind") == cacheMetadataKind
        && metadata.optInt("pageNumber") == pageNumber
        && metadata.optInt("pageCount") > 0
        && metadata.optInt("targetWidth") == targetWidth
        && (expectedPageCount == null || metadata.optInt("pageCount") == expectedPageCount)
        && isSourceFingerprintValid(metadata, sourceFingerprint, expectedPageCount != null)
      if (!valid) {
        null
      } else {
        val bounds = BitmapFactory.Options().apply {
          inJustDecodeBounds = true
        }
        BitmapFactory.decodeFile(outputFile.absolutePath, bounds)
        val width = bounds.outWidth
        val height = bounds.outHeight
        if (width <= 0 || height <= 0 || width != metadata.optInt("width") || height != metadata.optInt("height")) {
          null
        } else {
          val now = System.currentTimeMillis()
          metadata.put("lastAccessedAt", now)
          if (sourceFingerprint != null) {
            metadata.put("sourceKey", sourceFingerprint.key)
            metadata.put("sourceSize", sourceFingerprint.size)
            metadata.put("sourceModifiedAt", sourceFingerprint.modifiedAt)
          }
          metadataFile.writeText(metadata.toString())
          outputFile.setLastModified(now)
          Arguments.createMap().apply {
            putString("uri", "${Uri.fromFile(outputFile)}?v=${outputFile.lastModified()}")
            putInt("width", width)
            putInt("height", height)
            putInt("pageNumber", pageNumber)
            putInt("pageCount", metadata.optInt("pageCount"))
          }
        }
      }
    }
  } catch (_: Exception) {
    null
  }

  private fun isSourceFingerprintValid(metadata: JSONObject, sourceFingerprint: SourceFingerprint?, allowLegacyCache: Boolean): Boolean {
    if (sourceFingerprint == null) return true
    if (!metadata.has("sourceKey") && !metadata.has("sourceSize") && !metadata.has("sourceModifiedAt")) {
      return allowLegacyCache
    }
    return metadata.optString("sourceKey") == sourceFingerprint.key
      && metadata.optLong("sourceSize") == sourceFingerprint.size
      && metadata.optLong("sourceModifiedAt") == sourceFingerprint.modifiedAt
  }

  private fun writeCacheMetadata(
    outputFile: File,
    pageNumber: Int,
    pageCount: Int,
    width: Int,
    height: Int,
    sourceFingerprint: SourceFingerprint?
  ) {
    val now = System.currentTimeMillis()
    val metadata = JSONObject().apply {
      put("version", cacheMetadataVersion)
      put("kind", cacheMetadataKind)
      put("pageNumber", pageNumber)
      put("pageCount", pageCount)
      put("targetWidth", width)
      put("width", width)
      put("height", height)
      put("createdAt", now)
      put("lastAccessedAt", now)
      if (sourceFingerprint != null) {
        put("sourceKey", sourceFingerprint.key)
        put("sourceSize", sourceFingerprint.size)
        put("sourceModifiedAt", sourceFingerprint.modifiedAt)
      }
    }
    getMetadataFile(outputFile).writeText(metadata.toString())
  }

  private fun prunePageImageCache(activeOutputFile: File) {
    val cacheDir = activeOutputFile.parentFile ?: return
    val cachedImages = cacheDir.listFiles { file ->
      file.isFile && file.extension == "png"
    }?.toList() ?: return

    if (cachedImages.size <= maxCachedPageImages) return

    cachedImages
      .filter { it.name != activeOutputFile.name }
      .sortedByDescending { it.lastModified() }
      .drop(maxCachedPageImages - 1)
      .forEach { file ->
        getMetadataFile(file).delete()
        file.delete()
      }
  }

  private fun pruneSelectionPreviewImages(activeOutputFile: File) {
    val cacheDir = activeOutputFile.parentFile ?: return
    val cachedImages = cacheDir.listFiles { file ->
      file.isFile && file.extension == "png"
    }?.toList() ?: return

    if (cachedImages.size <= maxSelectionPreviewImages) return

    cachedImages
      .filter { it.name != activeOutputFile.name }
      .sortedByDescending { it.lastModified() }
      .drop(maxSelectionPreviewImages - 1)
      .forEach { file -> file.delete() }
  }

  private fun parseColor(value: String): Int {
    val trimmed = value.trim()
    val rgbaMatch = Regex("""rgba?\(([^)]+)\)""").find(trimmed)
    if (rgbaMatch != null) {
      val parts = rgbaMatch.groupValues[1].split(',').map { it.trim() }
      val red = parts.getOrNull(0)?.toFloatOrNull()?.roundToInt()?.coerceIn(0, 255) ?: 17
      val green = parts.getOrNull(1)?.toFloatOrNull()?.roundToInt()?.coerceIn(0, 255) ?: 24
      val blue = parts.getOrNull(2)?.toFloatOrNull()?.roundToInt()?.coerceIn(0, 255) ?: 39
      val alpha = parts.getOrNull(3)?.toFloatOrNull()?.let {
        if (it <= 1f) (it * 255f).roundToInt() else it.roundToInt()
      }?.coerceIn(0, 255) ?: 255
      return Color.argb(alpha, red, green, blue)
    }
    return try {
      Color.parseColor(trimmed)
    } catch (_: Exception) {
      Color.rgb(17, 24, 39)
    }
  }

  private fun sha1(value: String): String {
    val bytes = MessageDigest.getInstance("SHA-1").digest(value.toByteArray(Charsets.UTF_8))
    return bytes.joinToString("") { "%02x".format(it) }
  }
}
