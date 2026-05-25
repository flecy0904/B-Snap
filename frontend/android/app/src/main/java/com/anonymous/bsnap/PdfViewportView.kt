package com.anonymous.bsnap

import android.content.Context
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
import android.util.Log
import android.util.LruCache
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.ViewConfiguration
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.PixelUtil
import com.facebook.react.uimanager.events.RCTEventEmitter
import java.io.File
import java.io.FileOutputStream
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.PriorityBlockingQueue
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class PdfViewportView(context: Context) : View(context) {
  private val logTag = "BsnPdfViewport"

  private data class NativePage(
    val id: String,
    val kind: String,
    val label: String,
    val pageNumber: Int?,
    val generatedPageId: String?,
  )

  private data class PdfPageSize(val width: Int, val height: Int)
  private data class PageLayout(val page: NativePage, val index: Int, val top: Float, val height: Float)
  private data class ViewportAnchor(
    val pageId: String,
    val pageNumber: Int?,
    val generatedPageId: String?,
    val pageProgressY: Float,
  )

  private data class InkPoint(
    val x: Float,
    val y: Float,
    val pageWidth: Float,
    val pageHeight: Float,
  )

  private data class InkStroke(
    val id: String,
    val points: MutableList<InkPoint>,
    val color: Int,
    val width: Float,
    val style: String,
    val brush: String?,
    val linePattern: String?,
    val shape: String?,
    val pageNumber: Int?,
    val generatedPageId: String?,
    val pageWidth: Float,
    val pageHeight: Float,
  )

  private data class HiResRequest(
    val generation: Int,
    val pageNumber: Int,
    val targetWidth: Int,
    val regionX: Float,
    val regionY: Float,
    val regionWidth: Float,
    val regionHeight: Float,
  )

  private data class HiResOverlay(
    val request: HiResRequest,
    val bitmap: Bitmap,
  )

  private data class BaseRenderJob(
    val sequence: Long,
    val generation: Int,
    val pageNumber: Int,
    val targetWidth: Int,
    val priority: Int,
    val key: String,
    val uri: String,
  ) : Comparable<BaseRenderJob> {
    override fun compareTo(other: BaseRenderJob): Int {
      val priorityCompare = priority.compareTo(other.priority)
      return if (priorityCompare != 0) priorityCompare else sequence.compareTo(other.sequence)
    }
  }

  private val baseRenderQueue = PriorityBlockingQueue<BaseRenderJob>()
  private val baseRenderLock = Any()
  private val renderSequence = AtomicLong(0L)
  private val hiResExecutor = Executors.newSingleThreadExecutor()
  private val baseRenderWorkerCount = 2
  private val baseRenderWorkers = List(baseRenderWorkerCount) { index ->
    Thread { runBaseRenderWorker() }.apply { name = "BsnPdfBaseRender-$index" }
  }
  private fun runBaseRenderWorker() {
    while (!Thread.currentThread().isInterrupted) {
      try {
        val job = baseRenderQueue.take()
        if (!isBaseRenderJobWanted(job)) {
          markBaseRenderFinished(job.key)
          continue
        }
        val bitmapFromDisk = loadBaseBitmapFromDisk(job.key)
        val bitmap = bitmapFromDisk ?: if (isBaseRenderJobWanted(job)) renderBasePage(job.uri, job.pageNumber, job.targetWidth) else null
        if (bitmapFromDisk == null && bitmap != null && isBaseRenderJobWanted(job)) saveBaseBitmapToDisk(job.key, bitmap)
        post {
          val shouldKeep = isBaseRenderJobWanted(job)
          markBaseRenderFinished(job.key)
          if (!shouldKeep || bitmap == null) {
            bitmap?.recycle()
            return@post
          }
          baseBitmapCache.put(job.key, bitmap)
          postInvalidateOnAnimation()
        }
      } catch (_: InterruptedException) {
        Thread.currentThread().interrupt()
      } catch (error: Exception) {
        Log.w(logTag, "base render worker failed", error)
      }
    }
  }
  private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
  private val minFlingVelocity = ViewConfiguration.get(context).scaledMinimumFlingVelocity
  private val maxFlingVelocity = ViewConfiguration.get(context).scaledMaximumFlingVelocity
  private val baseBitmapCache = object : LruCache<String, Bitmap>(64 * 1024 * 1024) {
    override fun sizeOf(key: String, value: Bitmap): Int = value.allocationByteCount
    override fun entryRemoved(evicted: Boolean, key: String, oldValue: Bitmap, newValue: Bitmap?) {
      if (evicted && oldValue != newValue && !oldValue.isRecycled) oldValue.recycle()
    }
  }

  private var fileUri: String? = null
  private var sourceKey = ""
  private var descriptor: ParcelFileDescriptor? = null
  private var renderer: PdfRenderer? = null
  private var pdfPageSize: PdfPageSize? = null
  private var documentGeneration = 0
  @Volatile private var renderGeneration = 0
  @Volatile private var hiResGeneration = 0
  private var documentPageCount = 0
  private var nativePages: List<NativePage> = emptyList()
  private var pageLayouts: List<PageLayout> = emptyList()
  private var loadErrorMessage: String? = null

  private var requestedPage = 1
  private var reportedPage = 0
  private var pageGap = dp(10f)
  private var scrollYDocument = 0f
  private var translateX = 0f
  private var scale = 1f
  private var savedScale = 1f
  private var pinchStartScale = 1f
  private var pinchStartDistance = 1f
  private var pinchFocusDocumentX = 0f
  private var pinchFocusDocumentY = 0f
  private val minScale = 1f
  private val maxScale = 3f
  private val hiResMinScale = 1.35f
  private val hiResOverscan = 0.3f
  private val naturalFlingMaxVelocity = 10600f
  private val naturalFlingMinVelocity = 650f
  private val naturalFlingDecayPerSecond = 2.2f
  private val naturalFlingStopVelocity = 100f

  private var inkTool = "view"
  private var fingerDrawingEnabled = false
  private var penColor = "#111827"
  private var penWidth = 3f
  private var brushType = "ballpoint"
  private var linePattern = "solid"
  private var inkStrokes: MutableList<InkStroke> = mutableListOf()
  private var activeStroke: InkStroke? = null
  private var lastTouchX = 0f
  private var lastTouchY = 0f
  private var lastPanX = 0f
  private var lastPanY = 0f
  private var isPanning = false
  private var isDrawing = false
  private var isPinching = false
  private var suppressNextFling = false
  private var isUserInteracting = false
  private var hasAppliedInitialPage = false
  private var velocityTracker: VelocityTracker? = null
  private var inertiaVelocityX = 0f
  private var inertiaVelocityYDocument = 0f
  private var inertiaLastFrameNanos = 0L

  private val hiResOverlays = mutableMapOf<Int, HiResOverlay>()
  private val hiResInFlight = mutableMapOf<Int, HiResRequest>()
  private val baseRenderRequests = mutableSetOf<String>()
  private var wantedBaseRenderKeys: Set<String> = emptySet()
  private var baseRenderDirection = 0
  private var lastBaseRenderScheduleKey = ""
  private var lastViewportEventKey = ""
  private var viewportEventScheduled = false
  private val viewportEventDelayMs = 32L
  private val hiResRequestRunnable = Runnable { startHiResOverlayRender() }
  private val viewportEventRunnable = Runnable {
    viewportEventScheduled = false
    emitViewportChanged()
  }
  private val inertiaRunnable = object : Runnable {
    override fun run() {
      if (isUserInteracting) {
        stopInertia()
        return
      }
      val now = System.nanoTime()
      val elapsed = if (inertiaLastFrameNanos > 0L) (now - inertiaLastFrameNanos) / 1_000_000_000f else 0.016f
      val dt = elapsed.coerceIn(0.001f, 0.034f)
      inertiaLastFrameNanos = now

      scrollYDocument += inertiaVelocityYDocument * dt
      translateX += inertiaVelocityX * dt
      clampViewport()
      stopInertiaAtBounds()

      val decay = exp(-naturalFlingDecayPerSecond * dt)
      inertiaVelocityX *= decay
      inertiaVelocityYDocument *= decay
      updateBaseRenderDirection(inertiaVelocityYDocument)
      notifyPageIfNeeded(false)
      scheduleVisibleBaseRenders()
      requestViewportChanged()
      postInvalidateOnAnimation()

      if (abs(inertiaVelocityX) > naturalFlingStopVelocity || abs(inertiaVelocityYDocument) > naturalFlingStopVelocity / max(1f, scale)) {
        postOnAnimation(this)
      } else {
        stopInertia()
        resetBaseRenderDirection()
        scheduleVisibleBaseRenders(force = true)
        requestHiResOverlay(delayMs = 80L)
      }
    }
  }

  private val backgroundPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
  private val placeholderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(248, 250, 252) }
  private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(226, 232, 240)
    style = Paint.Style.STROKE
    strokeWidth = dp(1f)
  }
  private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    color = Color.rgb(148, 163, 184)
    textSize = dp(14f)
    textAlign = Paint.Align.CENTER
  }
  private val inkPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
    style = Paint.Style.STROKE
    strokeCap = Paint.Cap.ROUND
    strokeJoin = Paint.Join.ROUND
  }

  init {
    setBackgroundColor(Color.WHITE)
    isFocusable = true
    baseRenderWorkers.forEach { it.start() }
  }

  fun setFileUri(uri: String?) {
    if (fileUri == uri) return
    Log.d(logTag, "setFileUri uri=${uri?.take(160)}")
    fileUri = uri
    openDocument()
  }

  fun setRequestedPage(page: Int) {
    val nextPage = max(1, page)
    requestedPage = nextPage
    if (nextPage == reportedPage) return
    if (!hasAppliedInitialPage && width > 0 && pageLayouts.isNotEmpty()) {
      scrollToPage(nextPage, notify = false)
      hasAppliedInitialPage = true
    } else if (!isUserInteracting && reportedPage == 0 && width > 0 && pageLayouts.isNotEmpty()) {
      scrollToPage(nextPage, notify = false)
    }
  }

  fun setNotebookPages(pages: ReadableArray?) {
    val anchor = captureViewportAnchor()
    nativePages = parseNotebookPages(pages)
    rebuildPageLayouts()
    restoreViewportAnchor(anchor)
    requestViewportChanged(force = true)
    invalidate()
  }

  fun setInkTool(value: String?) {
    inkTool = value ?: "view"
    requestViewportChanged(force = true)
  }

  fun setFingerDrawingEnabled(value: Boolean) {
    fingerDrawingEnabled = value
  }

  fun setPenColor(value: String?) {
    penColor = value ?: "#111827"
  }

  fun setPenWidth(value: Float) {
    penWidth = max(1f, value)
  }

  fun setBrushType(value: String?) {
    brushType = value ?: "ballpoint"
  }

  fun setLinePattern(value: String?) {
    linePattern = value ?: "solid"
  }

  fun setInkStrokes(strokes: ReadableArray?) {
    inkStrokes = parseInkStrokes(strokes).toMutableList()
    invalidate()
  }

  override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
    super.onSizeChanged(w, h, oldw, oldh)
    Log.d(logTag, "onSizeChanged ${w}x$h old=${oldw}x$oldh")
    val anchor = if (oldw > 0 && oldh > 0) captureViewportAnchor() else null
    rebuildPageLayouts()
    if (oldw == 0 || oldh == 0) {
      scrollToPage(requestedPage, notify = false)
    } else {
      restoreViewportAnchor(anchor)
    }
    clampViewport()
    scheduleVisibleBaseRenders()
    requestViewportChanged(force = true)
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    stopInertia()
    closeDocument()
    removeCallbacks(hiResRequestRunnable)
    removeCallbacks(viewportEventRunnable)
    baseRenderWorkers.forEach { it.interrupt() }
    hiResExecutor.shutdownNow()
  }

  override fun onDraw(canvas: Canvas) {
    super.onDraw(canvas)
    canvas.drawColor(Color.WHITE)
    if (pageLayouts.isEmpty()) {
      drawEmptyState(canvas)
      return
    }

    val visibleTop = scrollYDocument
    val visibleBottom = scrollYDocument + height / scale
    pageLayouts.forEach { layout ->
      if (layout.top > visibleBottom || layout.top + layout.height < visibleTop) return@forEach
      drawPage(canvas, layout)
    }
  }

  override fun onTouchEvent(event: MotionEvent): Boolean {
    when (event.actionMasked) {
      MotionEvent.ACTION_DOWN -> {
        isUserInteracting = true
        parent.requestDisallowInterceptTouchEvent(true)
        cancelFling()
        velocityTracker = VelocityTracker.obtain()
        velocityTracker?.addMovement(event)
        lastTouchX = event.x
        lastTouchY = event.y
        lastPanX = event.x
        lastPanY = event.y
        isPanning = false
        suppressNextFling = false
        isDrawing = shouldStartInk(event)
        if (isDrawing) beginInk(event.x, event.y)
      }
      MotionEvent.ACTION_POINTER_DOWN -> {
        isUserInteracting = true
        parent.requestDisallowInterceptTouchEvent(true)
        cancelFling()
        activeStroke = null
        isDrawing = false
        isPanning = false
        suppressNextFling = true
        if (event.pointerCount >= 2) {
          isPinching = true
          pinchStartScale = scale
          pinchStartDistance = max(1f, pointerDistance(event))
          val focusX = pointerFocusX(event)
          val focusY = pointerFocusY(event)
          pinchFocusDocumentX = screenToDocumentX(focusX)
          pinchFocusDocumentY = screenToDocumentY(focusY)
        }
        velocityTracker?.clear()
        return true
      }
      MotionEvent.ACTION_MOVE -> {
        if (event.pointerCount >= 2 && isPinching) {
          val focusX = pointerFocusX(event)
          val focusY = pointerFocusY(event)
          val distanceRatio = pointerDistance(event) / max(1f, pinchStartDistance)
          val nextScale = (pinchStartScale * distanceRatio).coerceIn(minScale, maxScale)
          setScaleAroundFocus(nextScale, focusX, focusY, pinchFocusDocumentX, pinchFocusDocumentY)
          lastPanX = focusX
          lastPanY = focusY
          velocityTracker?.clear()
          return true
        }
        velocityTracker?.addMovement(event)
        if (isDrawing) {
          moveInk(event.x, event.y)
        } else {
          val dx = event.x - lastPanX
          val dy = event.y - lastPanY
          if (!isPanning && hypot((event.x - lastTouchX).toDouble(), (event.y - lastTouchY).toDouble()) > touchSlop) {
            isPanning = true
          }
          if (isPanning) {
            panBy(dx, dy)
            lastPanX = event.x
            lastPanY = event.y
          }
        }
      }
      MotionEvent.ACTION_POINTER_UP -> {
        velocityTracker?.clear()
        isPanning = false
        isDrawing = false
        if (event.pointerCount <= 2) {
          isPinching = false
          savedScale = scale
          resetPanAnchorToRemainingPointer(event)
          clampViewport(applyScaleSnap = true)
          requestHiResOverlay()
        }
        return true
      }
      MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
        velocityTracker?.addMovement(event)
        if (isPinching) {
          savedScale = scale
          clampViewport(applyScaleSnap = true)
          requestHiResOverlay()
        } else if (isDrawing) {
          endInk(commit = event.actionMasked == MotionEvent.ACTION_UP)
        } else if (event.actionMasked == MotionEvent.ACTION_UP && !suppressNextFling) {
          velocityTracker?.computeCurrentVelocity(1000, maxFlingVelocity.toFloat())
          val velocityX = velocityTracker?.xVelocity ?: 0f
          val velocityY = velocityTracker?.yVelocity ?: 0f
          if (abs(velocityY) >= max(minFlingVelocity.toFloat(), naturalFlingMinVelocity) || abs(velocityX) >= max(minFlingVelocity.toFloat(), naturalFlingMinVelocity)) {
            fling(velocityX, velocityY)
          } else {
            resetBaseRenderDirection()
            scheduleVisibleBaseRenders(force = true)
            requestHiResOverlay(delayMs = 80L)
          }
        } else {
          resetBaseRenderDirection()
          scheduleVisibleBaseRenders(force = true)
          requestHiResOverlay(delayMs = 80L)
        }
        velocityTracker?.recycle()
        velocityTracker = null
        isPanning = false
        isDrawing = false
        isPinching = false
        suppressNextFling = false
        isUserInteracting = false
        parent.requestDisallowInterceptTouchEvent(false)
      }
    }
    return true
  }

  private fun openDocument() {
    stopInertia()
    closeDocument()
    loadErrorMessage = null
    documentGeneration += 1
    renderGeneration += 1
    hiResGeneration += 1
    baseBitmapCache.evictAll()
    synchronized(baseRenderLock) {
      baseRenderRequests.clear()
      wantedBaseRenderKeys = emptySet()
    }
    baseRenderQueue.clear()
    lastBaseRenderScheduleKey = ""
    baseRenderDirection = 0
    removeCallbacks(hiResRequestRunnable)
    removeCallbacks(viewportEventRunnable)
    clearHiResOverlays()
    hiResInFlight.clear()

    val uri = fileUri
    if (uri.isNullOrBlank()) {
      loadErrorMessage = "PDF source is empty."
      invalidate()
      return
    }

    try {
      Log.d(logTag, "openDocument start uri=${uri.take(160)}")
      descriptor = openPdfDescriptor(uri)
      renderer = PdfRenderer(descriptor!!)
      documentPageCount = renderer?.pageCount ?: 0
      if (documentPageCount <= 0) throw IllegalStateException("PDF has no pages.")
      if (documentPageCount > 0) {
        renderer!!.openPage(0).use { page ->
          pdfPageSize = PdfPageSize(page.width, page.height)
        }
      }
      sourceKey = hashKey(uri)
      if (nativePages.isEmpty()) nativePages = buildDefaultPdfPages(documentPageCount)
      rebuildPageLayouts()
      emitDocumentLoaded(documentPageCount)
      scrollToPage(requestedPage, notify = false)
      hasAppliedInitialPage = true
      scheduleVisibleBaseRenders(force = true)
      requestViewportChanged(force = true)
      Log.i(logTag, "openDocument success pages=$documentPageCount size=${pdfPageSize?.width}x${pdfPageSize?.height} view=${width}x$height layouts=${pageLayouts.size}")
      invalidate()
    } catch (error: Exception) {
      Log.e(logTag, "openDocument failed uri=${uri.take(160)}", error)
      closeDocument()
      loadErrorMessage = "PDF open failed: ${error.message ?: error.javaClass.simpleName}"
      invalidate()
    }
  }

  private fun closeDocument() {
    renderer?.close()
    renderer = null
    descriptor?.close()
    descriptor = null
    documentPageCount = 0
    pdfPageSize = null
  }

  private fun rebuildPageLayouts() {
    val pageSize = pdfPageSize ?: return
    if (width <= 0) return
    if (nativePages.isEmpty() && documentPageCount > 0) nativePages = buildDefaultPdfPages(documentPageCount)
    val pageWidth = width.toFloat()
    val pageHeight = pageWidth * pageSize.height / max(1f, pageSize.width.toFloat())
    var top = dp(4f)
    pageLayouts = nativePages.mapIndexed { index, page ->
      val layout = PageLayout(page, index, top, pageHeight)
      top += pageHeight + pageGap
      layout
    }
    clampViewport()
  }

  private fun captureViewportAnchor(): ViewportAnchor? {
    if (pageLayouts.isEmpty() || height <= 0) return null
    val centerY = scrollYDocument + height / max(1f, scale) / 2f
    val layout = pageLayouts.firstOrNull { centerY >= it.top && centerY <= it.top + it.height }
      ?: pageLayouts.minByOrNull { abs((it.top + it.height / 2f) - centerY) }
      ?: return null
    val progress = ((centerY - layout.top) / max(1f, layout.height)).coerceIn(0f, 1f)
    return ViewportAnchor(
      pageId = layout.page.id,
      pageNumber = layout.page.pageNumber,
      generatedPageId = layout.page.generatedPageId,
      pageProgressY = progress,
    )
  }

  private fun restoreViewportAnchor(anchor: ViewportAnchor?) {
    if (anchor == null || pageLayouts.isEmpty() || height <= 0) return
    val layout = pageLayouts.firstOrNull { it.page.id == anchor.pageId }
      ?: pageLayouts.firstOrNull { anchor.generatedPageId != null && it.page.generatedPageId == anchor.generatedPageId }
      ?: pageLayouts.firstOrNull { anchor.pageNumber != null && it.page.pageNumber == anchor.pageNumber }
      ?: return
    val centerY = layout.top + layout.height * anchor.pageProgressY
    scrollYDocument = centerY - height / max(1f, scale) / 2f
    clampViewport()
    scheduleVisibleBaseRenders()
    requestViewportChanged(force = true)
    invalidate()
  }

  private fun drawEmptyState(canvas: Canvas) {
    val message = loadErrorMessage ?: when {
      fileUri.isNullOrBlank() -> "PDF source is empty."
      width <= 0 || height <= 0 -> "PDF view has no size."
      pdfPageSize == null -> "PDF loading..."
      else -> "PDF layout is empty."
    }
    canvas.drawText(message, width / 2f, height / 2f, textPaint)
  }

  private fun drawPage(canvas: Canvas, layout: PageLayout) {
    val pageWidth = width.toFloat()
    val screenLeft = (width - pageWidth * scale) / 2f + translateX
    val screenTop = (layout.top - scrollYDocument) * scale
    val screenRect = RectF(screenLeft, screenTop, screenLeft + pageWidth * scale, screenTop + layout.height * scale)

    canvas.drawRect(screenRect, backgroundPaint)
    if (layout.page.kind == "pdf" && layout.page.pageNumber != null) {
      val bitmap = getBaseBitmap(layout.page.pageNumber)
      if (bitmap != null && !bitmap.isRecycled) {
        canvas.drawBitmap(bitmap, null, screenRect, null)
      } else {
        canvas.drawRect(screenRect, placeholderPaint)
        canvas.drawText(layout.page.label, screenRect.centerX(), screenRect.centerY(), textPaint)
        requestBaseRender(layout.page.pageNumber)
      }
      drawHiResOverlay(canvas, layout, screenRect)
    } else {
      drawGeneratedPage(canvas, layout, screenRect)
    }
    drawInkForPage(canvas, layout, screenRect)
    canvas.drawRect(screenRect, borderPaint)
  }

  private fun drawGeneratedPage(canvas: Canvas, layout: PageLayout, rect: RectF) {
    canvas.drawRect(rect, backgroundPaint)
    canvas.drawText(layout.page.label, rect.centerX(), rect.top + dp(40f) * scale, textPaint)
  }

  private fun drawHiResOverlay(canvas: Canvas, layout: PageLayout, pageRect: RectF) {
    val pageNumber = layout.page.pageNumber ?: return
    val overlay = hiResOverlays[pageNumber] ?: return
    if (overlay.request.pageNumber != pageNumber || overlay.request.generation != hiResGeneration) return
    val request = overlay.request
    val dest = RectF(
      pageRect.left + pageRect.width() * request.regionX,
      pageRect.top + pageRect.height() * request.regionY,
      pageRect.left + pageRect.width() * (request.regionX + request.regionWidth),
      pageRect.top + pageRect.height() * (request.regionY + request.regionHeight),
    )
    canvas.drawBitmap(overlay.bitmap, null, dest, null)
  }

  private fun drawInkForPage(canvas: Canvas, layout: PageLayout, pageRect: RectF) {
    val page = layout.page
    val pageStrokes = inkStrokes.filter {
      if (page.generatedPageId != null) it.generatedPageId == page.generatedPageId
      else page.pageNumber != null && it.pageNumber == page.pageNumber
    }
    pageStrokes.forEach { drawStroke(canvas, it, pageRect) }
    activeStroke?.let { stroke ->
      if ((page.generatedPageId != null && stroke.generatedPageId == page.generatedPageId) || (page.pageNumber != null && stroke.pageNumber == page.pageNumber)) {
        drawStroke(canvas, stroke, pageRect)
      }
    }
  }

  private fun drawStroke(canvas: Canvas, stroke: InkStroke, pageRect: RectF) {
    if (stroke.points.isEmpty()) return
    inkPaint.color = stroke.color
    inkPaint.strokeWidth = max(1f, stroke.width * scale)
    inkPaint.alpha = if (stroke.style == "highlight") 95 else 255
    inkPaint.pathEffect = when (stroke.linePattern) {
      "dotted" -> DashPathEffect(floatArrayOf(inkPaint.strokeWidth, inkPaint.strokeWidth * 1.8f), 0f)
      "dashed" -> DashPathEffect(floatArrayOf(inkPaint.strokeWidth * 4f, inkPaint.strokeWidth * 2.5f), 0f)
      else -> null
    }

    if (stroke.style == "shape" && stroke.points.size >= 2) {
      drawShape(canvas, stroke, pageRect)
      inkPaint.alpha = 255
      inkPaint.pathEffect = null
      return
    }

    val path = Path()
    stroke.points.forEachIndexed { index, point ->
      val x = pageRect.left + pageRect.width() * (point.x / max(1f, point.pageWidth))
      val y = pageRect.top + pageRect.height() * (point.y / max(1f, point.pageHeight))
      if (index == 0) path.moveTo(x, y) else path.lineTo(x, y)
    }
    canvas.drawPath(path, inkPaint)
    inkPaint.alpha = 255
    inkPaint.pathEffect = null
  }

  private fun drawShape(canvas: Canvas, stroke: InkStroke, pageRect: RectF) {
    val start = stroke.points.first()
    val end = stroke.points.last()
    val left = pageRect.left + pageRect.width() * (min(start.x, end.x) / max(1f, start.pageWidth))
    val top = pageRect.top + pageRect.height() * (min(start.y, end.y) / max(1f, start.pageHeight))
    val right = pageRect.left + pageRect.width() * (max(start.x, end.x) / max(1f, start.pageWidth))
    val bottom = pageRect.top + pageRect.height() * (max(start.y, end.y) / max(1f, start.pageHeight))
    val x1 = pageRect.left + pageRect.width() * (start.x / max(1f, start.pageWidth))
    val y1 = pageRect.top + pageRect.height() * (start.y / max(1f, start.pageHeight))
    val x2 = pageRect.left + pageRect.width() * (end.x / max(1f, end.pageWidth))
    val y2 = pageRect.top + pageRect.height() * (end.y / max(1f, end.pageHeight))
    when (stroke.shape) {
      "rect" -> canvas.drawRect(left, top, right, bottom, inkPaint)
      "ellipse" -> canvas.drawOval(RectF(left, top, right, bottom), inkPaint)
      "arrow" -> {
        canvas.drawLine(x1, y1, x2, y2, inkPaint)
        drawArrowHead(canvas, x1, y1, x2, y2)
      }
      else -> canvas.drawLine(x1, y1, x2, y2, inkPaint)
    }
  }

  private fun drawArrowHead(canvas: Canvas, x1: Float, y1: Float, x2: Float, y2: Float) {
    val angle = kotlin.math.atan2((y2 - y1).toDouble(), (x2 - x1).toDouble())
    val length = dp(14f) * scale
    val leftAngle = angle + Math.PI * 0.82
    val rightAngle = angle - Math.PI * 0.82
    canvas.drawLine(x2, y2, (x2 + kotlin.math.cos(leftAngle) * length).toFloat(), (y2 + kotlin.math.sin(leftAngle) * length).toFloat(), inkPaint)
    canvas.drawLine(x2, y2, (x2 + kotlin.math.cos(rightAngle) * length).toFloat(), (y2 + kotlin.math.sin(rightAngle) * length).toFloat(), inkPaint)
  }

  private fun shouldStartInk(event: MotionEvent): Boolean {
    if (inkTool == "view") return false
    if (inkTool == "erase") return true
    val drawingTool = inkTool == "pen" || inkTool == "highlight" || inkTool == "line" || inkTool == "arrow" || inkTool == "rect" || inkTool == "ellipse"
    if (!drawingTool) return false
    val toolType = event.getToolType(0)
    val stylus = toolType == MotionEvent.TOOL_TYPE_STYLUS || toolType == MotionEvent.TOOL_TYPE_ERASER
    return fingerDrawingEnabled || stylus
  }

  private fun beginInk(x: Float, y: Float) {
    val hit = screenToPagePoint(x, y) ?: return
    if (inkTool == "erase") {
      findHitStroke(hit.first, hit.second)?.let { strokeId ->
        inkStrokes.removeAll { it.id == strokeId }
        emitRemoveInkStroke(strokeId)
        invalidate()
      }
      return
    }
    val page = hit.first
    val point = hit.second
    val style = if (inkTool == "highlight") "highlight" else if (inkTool == "line" || inkTool == "arrow" || inkTool == "rect" || inkTool == "ellipse") "shape" else "pen"
    activeStroke = InkStroke(
      id = "${System.currentTimeMillis()}-${UUID.randomUUID().toString().take(8)}",
      points = mutableListOf(point),
      color = parseColor(penColor),
      width = penWidth,
      style = style,
      brush = brushType,
      linePattern = linePattern,
      shape = if (style == "shape") inkTool else null,
      pageNumber = page.pageNumber,
      generatedPageId = page.generatedPageId,
      pageWidth = point.pageWidth,
      pageHeight = point.pageHeight,
    )
    invalidate()
  }

  private fun moveInk(x: Float, y: Float) {
    if (inkTool == "erase") {
      val hit = screenToPagePoint(x, y) ?: return
      findHitStroke(hit.first, hit.second)?.let { strokeId ->
        inkStrokes.removeAll { it.id == strokeId }
        emitRemoveInkStroke(strokeId)
      }
      invalidate()
      return
    }
    val stroke = activeStroke ?: return
    val hit = screenToPagePoint(x, y) ?: return
    val point = hit.second
    if (stroke.style == "shape") {
      if (stroke.points.size == 1) stroke.points.add(point) else stroke.points[1] = point
    } else {
      val previous = stroke.points.lastOrNull()
      if (previous == null || hypot((previous.x - point.x).toDouble(), (previous.y - point.y).toDouble()) > 1.5) {
        stroke.points.add(point)
      }
    }
    invalidate()
  }

  private fun endInk(commit: Boolean) {
    val stroke = activeStroke
    activeStroke = null
    if (commit && stroke != null && stroke.points.size > 1) {
      inkStrokes.add(stroke)
      emitCommitInkStroke(stroke)
    }
    invalidate()
  }

  private fun findHitStroke(page: NativePage, point: InkPoint): String? {
    val candidates = inkStrokes.asReversed().filter {
      if (page.generatedPageId != null) it.generatedPageId == page.generatedPageId
      else page.pageNumber != null && it.pageNumber == page.pageNumber
    }
    val tolerance = max(18f, penWidth * 3f)
    candidates.forEach { stroke ->
      if (stroke.points.any { hypot((it.x - point.x).toDouble(), (it.y - point.y).toDouble()) <= tolerance }) return stroke.id
      stroke.points.zipWithNext().forEach { (start, end) ->
        if (distanceToSegment(point, start, end) <= tolerance) return stroke.id
      }
    }
    return null
  }

  private fun distanceToSegment(point: InkPoint, start: InkPoint, end: InkPoint): Double {
    val dx = end.x - start.x
    val dy = end.y - start.y
    val lengthSquared = dx * dx + dy * dy
    if (lengthSquared <= 0.0001f) return hypot((point.x - start.x).toDouble(), (point.y - start.y).toDouble())
    val t = (((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared).coerceIn(0f, 1f)
    val projectionX = start.x + t * dx
    val projectionY = start.y + t * dy
    return hypot((point.x - projectionX).toDouble(), (point.y - projectionY).toDouble())
  }

  private fun panBy(dx: Float, dy: Float) {
    val previousScrollY = scrollYDocument
    translateX += dx
    scrollYDocument -= dy / scale
    clampViewport()
    updateBaseRenderDirection(scrollYDocument - previousScrollY)
    notifyPageIfNeeded(false)
    scheduleVisibleBaseRenders()
    requestViewportChanged()
    requestHiResOverlay(delayMs = 120L)
    postInvalidateOnAnimation()
  }

  private fun fling(velocityX: Float, velocityY: Float) {
    stopInertia()
    inertiaVelocityX = velocityX.coerceIn(-naturalFlingMaxVelocity, naturalFlingMaxVelocity)
    inertiaVelocityYDocument = (-velocityY).coerceIn(-naturalFlingMaxVelocity, naturalFlingMaxVelocity) / max(1f, scale)
    updateBaseRenderDirection(inertiaVelocityYDocument)
    stopInertiaAtBounds()
    if (abs(inertiaVelocityX) < naturalFlingStopVelocity && abs(inertiaVelocityYDocument) < naturalFlingStopVelocity / max(1f, scale)) {
      requestHiResOverlay(delayMs = 80L)
      return
    }
    inertiaLastFrameNanos = System.nanoTime()
    postOnAnimation(inertiaRunnable)
  }

  private fun cancelFling() {
    stopInertia()
  }

  private fun stopInertia() {
    removeCallbacks(inertiaRunnable)
    inertiaVelocityX = 0f
    inertiaVelocityYDocument = 0f
    inertiaLastFrameNanos = 0L
  }

  private fun stopInertiaAtBounds() {
    val maxY = maxScrollY()
    val horizontalLimit = horizontalLimit()
    if ((scrollYDocument <= 0f && inertiaVelocityYDocument < 0f) || (scrollYDocument >= maxY && inertiaVelocityYDocument > 0f)) {
      inertiaVelocityYDocument = 0f
    }
    if ((translateX <= -horizontalLimit && inertiaVelocityX < 0f) || (translateX >= horizontalLimit && inertiaVelocityX > 0f)) {
      inertiaVelocityX = 0f
    }
  }

  private fun setScaleAroundFocus(nextScale: Float, focusX: Float, focusY: Float, documentX: Float, documentY: Float) {
    scale = nextScale
    scrollYDocument = documentY - focusY / scale
    translateX = focusX - width / 2f - (documentX - width / 2f) * scale
    clampViewport(applyScaleSnap = false)
    notifyPageIfNeeded(false)
    scheduleVisibleBaseRenders()
    requestViewportChanged()
    requestHiResOverlay(delayMs = 120L)
    postInvalidateOnAnimation()
  }

  private fun resetPanAnchorToRemainingPointer(event: MotionEvent) {
    val actionIndex = event.actionIndex
    val remainingIndex = (0 until event.pointerCount).firstOrNull { it != actionIndex } ?: return
    val x = event.getX(remainingIndex)
    val y = event.getY(remainingIndex)
    lastTouchX = x
    lastTouchY = y
    lastPanX = x
    lastPanY = y
    isPanning = false
    velocityTracker?.clear()
  }

  private fun pointerDistance(event: MotionEvent): Float {
    if (event.pointerCount < 2) return 1f
    val dx = event.getX(1) - event.getX(0)
    val dy = event.getY(1) - event.getY(0)
    return hypot(dx.toDouble(), dy.toDouble()).toFloat()
  }

  private fun pointerFocusX(event: MotionEvent): Float {
    if (event.pointerCount < 2) return event.x
    return (event.getX(0) + event.getX(1)) / 2f
  }

  private fun pointerFocusY(event: MotionEvent): Float {
    if (event.pointerCount < 2) return event.y
    return (event.getY(0) + event.getY(1)) / 2f
  }

  private fun clampViewport(applyScaleSnap: Boolean = true) {
    scrollYDocument = scrollYDocument.coerceIn(0f, maxScrollY())
    translateX = translateX.coerceIn(-horizontalLimit(), horizontalLimit())
    if (applyScaleSnap && scale <= 1.02f) {
      scale = 1f
      translateX = 0f
      clearHiResOverlays()
      hiResInFlight.clear()
      removeCallbacks(hiResRequestRunnable)
    }
  }

  private fun maxScrollY(): Float {
    val contentHeight = (pageLayouts.lastOrNull()?.let { it.top + it.height + dp(24f) }) ?: 0f
    return max(0f, contentHeight - height / max(1f, scale))
  }

  private fun horizontalLimit(): Float = max(0f, (width * scale - width) / 2f)

  private fun scrollToPage(pageNumber: Int, notify: Boolean) {
    val layout = pageLayouts.firstOrNull { it.page.pageNumber == pageNumber } ?: pageLayouts.getOrNull(pageNumber - 1) ?: return
    scrollYDocument = layout.top.coerceIn(0f, maxScrollY())
    clampViewport()
    if (notify) notifyPageIfNeeded(true)
    scheduleVisibleBaseRenders()
    requestViewportChanged(force = true)
    invalidate()
  }

  private fun notifyPageIfNeeded(force: Boolean) {
    val center = scrollYDocument + height / max(1f, scale) / 2f
    val page = pageLayouts.firstOrNull { center >= it.top && center <= it.top + it.height }?.page ?: return
    val pageNumber = page.pageNumber ?: return
    if (!force && pageNumber == reportedPage) return
    reportedPage = pageNumber
    removeCallbacks(pageNotifyRunnable)
    postDelayed(pageNotifyRunnable, 120)
  }

  private val pageNotifyRunnable = Runnable {
    if (reportedPage > 0) emitPageChanged(reportedPage)
  }

  private fun requestViewportChanged(force: Boolean = false) {
    if (force) {
      removeCallbacks(viewportEventRunnable)
      viewportEventScheduled = false
      emitViewportChanged(force = true)
      return
    }
    if (viewportEventScheduled) return
    viewportEventScheduled = true
    postDelayed(viewportEventRunnable, viewportEventDelayMs)
  }

  private fun scheduleVisibleBaseRenders(force: Boolean = false) {
    val centerIndex = pageLayouts.indexOfFirst {
      val center = scrollYDocument + height / max(1f, scale) / 2f
      center >= it.top && center <= it.top + it.height
    }.let { if (it >= 0) it else 0 }
    val prioritizedIndexes = buildBaseRenderPriorityIndexes(centerIndex)
    val targetWidth = baseRenderTargetWidth()
    val wantedKeys = prioritizedIndexes.mapNotNull { index ->
      val pageNumber = pageLayouts[index].page.pageNumber ?: return@mapNotNull null
      baseCacheKey(pageNumber, targetWidth)
    }.toSet()
    val scheduleKey = "$renderGeneration:$width:$centerIndex:$baseRenderDirection:${prioritizedIndexes.joinToString(",")}"
    if (!force && scheduleKey == lastBaseRenderScheduleKey) return
    lastBaseRenderScheduleKey = scheduleKey
    pruneBaseRenderQueue(wantedKeys)
    prioritizedIndexes.forEachIndexed { priority, index ->
      val pageNumber = pageLayouts[index].page.pageNumber ?: return@forEachIndexed
      requestBaseRender(pageNumber, priority)
    }
  }

  private fun buildBaseRenderPriorityIndexes(centerIndex: Int): List<Int> {
    val indexes = mutableListOf<Int>()
    fun addOffset(offset: Int) {
      val index = centerIndex + offset
      if (index in pageLayouts.indices && index !in indexes) indexes.add(index)
    }

    addOffset(0)
    when {
      baseRenderDirection > 0 -> {
        (1..5).forEach { addOffset(it) }
      }
      baseRenderDirection < 0 -> {
        (-1 downTo -5).forEach { addOffset(it) }
      }
      else -> {
        listOf(-1, 1, -2, 2, 3).forEach { addOffset(it) }
      }
    }
    return indexes
  }

  private fun pruneBaseRenderQueue(wantedKeys: Set<String>) {
    synchronized(baseRenderLock) {
      wantedBaseRenderKeys = wantedKeys
      baseRenderRequests.retainAll(wantedKeys)
    }
    baseRenderQueue.removeIf { job ->
      job.generation != renderGeneration || job.key !in wantedKeys
    }
  }

  private fun requestBaseRender(pageNumber: Int, priority: Int = 0) {
    if (renderer == null || width <= 0) return
    val targetWidth = baseRenderTargetWidth()
    val key = baseCacheKey(pageNumber, targetWidth)
    if (baseBitmapCache.get(key) != null) return
    val generation = renderGeneration
    val uri = fileUri ?: return
    val shouldRequest = synchronized(baseRenderLock) {
      if (key !in wantedBaseRenderKeys || baseRenderRequests.contains(key)) {
        false
      } else {
        baseRenderRequests.add(key)
        true
      }
    }
    if (!shouldRequest) return
    baseRenderQueue.offer(BaseRenderJob(renderSequence.incrementAndGet(), generation, pageNumber, targetWidth, priority, key, uri))
  }

  private fun isBaseRenderJobWanted(job: BaseRenderJob): Boolean {
    if (job.generation != renderGeneration) return false
    return synchronized(baseRenderLock) { job.key in wantedBaseRenderKeys }
  }

  private fun markBaseRenderFinished(key: String) {
    synchronized(baseRenderLock) {
      baseRenderRequests.remove(key)
    }
  }

  private fun updateBaseRenderDirection(documentDeltaY: Float) {
    if (abs(documentDeltaY) < 0.5f) return
    val nextDirection = if (documentDeltaY > 0f) 1 else -1
    if (baseRenderDirection == nextDirection) return
    baseRenderDirection = nextDirection
    lastBaseRenderScheduleKey = ""
  }

  private fun resetBaseRenderDirection() {
    if (baseRenderDirection == 0) return
    baseRenderDirection = 0
    lastBaseRenderScheduleKey = ""
  }

  private fun getBaseBitmap(pageNumber: Int): Bitmap? {
    val key = baseCacheKey(pageNumber, baseRenderTargetWidth())
    return baseBitmapCache.get(key)
  }

  private fun baseRenderTargetWidth(): Int = max(1, min(width, 1200))

  private fun requestHiResOverlay(delayMs: Long = 0L) {
    removeCallbacks(hiResRequestRunnable)
    if (delayMs <= 0L) {
      startHiResOverlayRender()
    } else {
      postDelayed(hiResRequestRunnable, delayMs)
    }
  }

  private fun startHiResOverlayRender() {
    if (scale < hiResMinScale || width <= 0 || height <= 0) {
      clearHiResOverlays()
      hiResInFlight.clear()
      return
    }
    val requests = buildVisibleHiResRequests()
    val visiblePageNumbers = requests.map { it.pageNumber }.toSet()
    discardInvisibleHiResOverlays(visiblePageNumbers)
    hiResInFlight.keys.filter { it !in visiblePageNumbers }.forEach { hiResInFlight.remove(it) }
    if (requests.isEmpty()) return

    val uri = fileUri ?: return
    requests.forEach { request ->
      val current = hiResOverlays[request.pageNumber]?.request
      if (current != null && request.targetWidth == current.targetWidth && regionContains(current, request)) return@forEach
      val inFlight = hiResInFlight[request.pageNumber]
      if (inFlight != null && request.targetWidth == inFlight.targetWidth && regionContains(inFlight, request)) return@forEach

      val generationRequest = request.copy(generation = hiResGeneration)
      hiResInFlight[generationRequest.pageNumber] = generationRequest
      hiResExecutor.execute {
        val bitmap = renderRegion(uri, generationRequest)
        post {
          val currentInFlight = hiResInFlight[generationRequest.pageNumber]
          if (generationRequest.generation != hiResGeneration || currentInFlight != generationRequest || bitmap == null) {
            bitmap?.recycle()
            if (currentInFlight == generationRequest) hiResInFlight.remove(generationRequest.pageNumber)
            return@post
          }
          hiResOverlays.remove(generationRequest.pageNumber)?.bitmap?.recycle()
          hiResOverlays[generationRequest.pageNumber] = HiResOverlay(generationRequest, bitmap)
          hiResInFlight.remove(generationRequest.pageNumber)
          invalidate()
        }
      }
    }
  }

  private fun buildVisibleHiResRequests(): List<HiResRequest> {
    val viewportTop = scrollYDocument
    val viewportBottom = scrollYDocument + height / scale
    return pageLayouts
      .filter { layout ->
        layout.page.pageNumber != null
          && layout.top < viewportBottom
          && layout.top + layout.height > viewportTop
      }
      .mapNotNull { layout ->
        val request = buildHiResRequest(layout) ?: return@mapNotNull null
        val overlapTop = max(viewportTop, layout.top)
        val overlapBottom = min(viewportBottom, layout.top + layout.height)
        request to max(0f, overlapBottom - overlapTop)
      }
      .sortedByDescending { it.second }
      .map { it.first }
  }

  private fun clearHiResOverlays() {
    hiResOverlays.values.forEach { overlay ->
      if (!overlay.bitmap.isRecycled) overlay.bitmap.recycle()
    }
    hiResOverlays.clear()
  }

  private fun discardInvisibleHiResOverlays(visiblePageNumbers: Set<Int>) {
    val invisiblePageNumbers = hiResOverlays.keys.filter { it !in visiblePageNumbers }
    invisiblePageNumbers.forEach { pageNumber ->
      hiResOverlays.remove(pageNumber)?.bitmap?.let { bitmap ->
        if (!bitmap.isRecycled) bitmap.recycle()
      }
    }
  }

  private fun buildHiResRequest(layout: PageLayout): HiResRequest? {
    val pageNumber = layout.page.pageNumber ?: return null
    val viewportTop = scrollYDocument
    val viewportBottom = scrollYDocument + height / scale
    val overlapTop = max(viewportTop, layout.top)
    val overlapBottom = min(viewportBottom, layout.top + layout.height)
    if (overlapBottom <= overlapTop) return null

    val documentLeft = screenToDocumentX(0f)
    val documentRight = screenToDocumentX(width.toFloat())
    val pageLeft = 0f
    val pageRight = width.toFloat()
    val overlapLeft = max(pageLeft, documentLeft)
    val overlapRight = min(pageRight, documentRight)
    if (overlapRight <= overlapLeft) return null

    val rawX = overlapLeft / width
    val rawRight = overlapRight / width
    val rawY = (overlapTop - layout.top) / layout.height
    val rawBottom = (overlapBottom - layout.top) / layout.height
    val regionWidth = rawRight - rawX
    val regionHeight = rawBottom - rawY
    val paddedX = (rawX - regionWidth * hiResOverscan).coerceIn(0f, 1f)
    val paddedY = (rawY - regionHeight * hiResOverscan).coerceIn(0f, 1f)
    val paddedRight = (rawRight + regionWidth * hiResOverscan).coerceIn(0f, 1f)
    val paddedBottom = (rawBottom + regionHeight * hiResOverscan).coerceIn(0f, 1f)
    val targetWidth = (width * scale).roundToInt().coerceAtLeast(width)
    return HiResRequest(
      generation = hiResGeneration,
      pageNumber = pageNumber,
      targetWidth = targetWidth,
      regionX = quantize(paddedX),
      regionY = quantize(paddedY),
      regionWidth = quantize(paddedRight - paddedX),
      regionHeight = quantize(paddedBottom - paddedY),
    )
  }

  private fun regionContains(container: HiResRequest, needed: HiResRequest): Boolean {
    val left = needed.regionX >= container.regionX
    val top = needed.regionY >= container.regionY
    val right = needed.regionX + needed.regionWidth <= container.regionX + container.regionWidth
    val bottom = needed.regionY + needed.regionHeight <= container.regionY + container.regionHeight
    return left && top && right && bottom
  }

  private fun renderBasePage(uri: String, pageNumber: Int, targetWidth: Int): Bitmap? {
    var descriptor: ParcelFileDescriptor? = null
    var renderer: PdfRenderer? = null
    var page: PdfRenderer.Page? = null
    return try {
      descriptor = openPdfDescriptor(uri)
      renderer = PdfRenderer(descriptor)
      if (pageNumber < 1 || pageNumber > renderer.pageCount) return null
      page = renderer.openPage(pageNumber - 1)
      val targetHeight = max(1, (targetWidth * page.height.toFloat() / page.width.toFloat()).roundToInt())
      val bitmap = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888)
      bitmap.eraseColor(Color.WHITE)
      val matrix = Matrix().apply {
        postScale(targetWidth.toFloat() / page.width.toFloat(), targetHeight.toFloat() / page.height.toFloat())
      }
      page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
      bitmap
    } catch (error: Exception) {
      Log.w(logTag, "renderBasePage failed page=$pageNumber targetWidth=$targetWidth", error)
      null
    } finally {
      page?.close()
      renderer?.close()
      descriptor?.close()
    }
  }

  private fun renderRegion(uri: String, request: HiResRequest): Bitmap? {
    var descriptor: ParcelFileDescriptor? = null
    var renderer: PdfRenderer? = null
    var page: PdfRenderer.Page? = null
    return try {
      descriptor = openPdfDescriptor(uri)
      renderer = PdfRenderer(descriptor)
      if (request.pageNumber < 1 || request.pageNumber > renderer.pageCount) return null
      page = renderer.openPage(request.pageNumber - 1)
      val fullWidth = request.targetWidth
      val fullHeight = max(1, (fullWidth * page.height.toFloat() / page.width.toFloat()).roundToInt())
      val regionPixelWidth = max(1, (fullWidth * request.regionWidth).roundToInt())
      val regionPixelHeight = max(1, (fullHeight * request.regionHeight).roundToInt())
      val bitmap = Bitmap.createBitmap(regionPixelWidth, regionPixelHeight, Bitmap.Config.ARGB_8888)
      bitmap.eraseColor(Color.WHITE)
      val clipLeft = (page.width * request.regionX).roundToInt()
      val clipTop = (page.height * request.regionY).roundToInt()
      val clipRight = (page.width * (request.regionX + request.regionWidth)).roundToInt().coerceAtMost(page.width)
      val clipBottom = (page.height * (request.regionY + request.regionHeight)).roundToInt().coerceAtMost(page.height)
      val source = Rect(clipLeft, clipTop, clipRight, clipBottom)
      val matrix = Matrix().apply {
        postTranslate(-source.left.toFloat(), -source.top.toFloat())
        postScale(regionPixelWidth.toFloat() / max(1, source.width()).toFloat(), regionPixelHeight.toFloat() / max(1, source.height()).toFloat())
      }
      page.render(bitmap, null, matrix, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
      bitmap
    } catch (error: Exception) {
      Log.w(logTag, "renderRegion failed page=${request.pageNumber} targetWidth=${request.targetWidth}", error)
      null
    } finally {
      page?.close()
      renderer?.close()
      descriptor?.close()
    }
  }

  private fun screenToDocumentX(screenX: Float): Float = (screenX - translateX - (width - width * scale) / 2f) / scale
  private fun screenToDocumentY(screenY: Float): Float = scrollYDocument + screenY / scale

  private fun screenToPagePoint(screenX: Float, screenY: Float): Pair<NativePage, InkPoint>? {
    val documentY = screenToDocumentY(screenY)
    val layout = pageLayouts.firstOrNull { documentY >= it.top && documentY <= it.top + it.height } ?: return null
    val documentX = screenToDocumentX(screenX)
    if (documentX < 0f || documentX > width) return null
    val pageSize = pdfPageSize
    val pageWidth = pageSize?.width?.toFloat() ?: width.toFloat()
    val pageHeight = pageSize?.height?.toFloat() ?: layout.height
    val point = InkPoint(
      x = (documentX / width * pageWidth).coerceIn(0f, pageWidth),
      y = ((documentY - layout.top) / layout.height * pageHeight).coerceIn(0f, pageHeight),
      pageWidth = pageWidth,
      pageHeight = pageHeight,
    )
    return layout.page to point
  }

  private fun parseNotebookPages(pages: ReadableArray?): List<NativePage> {
    if (pages == null || pages.size() == 0) return buildDefaultPdfPages(documentPageCount)
    val result = mutableListOf<NativePage>()
    for (index in 0 until pages.size()) {
      val map = pages.getMap(index) ?: continue
      result.add(
        NativePage(
          id = map.getString("id") ?: "page:$index",
          kind = map.getString("kind") ?: "pdf",
          label = map.getString("label") ?: "${index + 1}",
          pageNumber = if (map.hasKey("pageNumber") && !map.isNull("pageNumber")) map.getInt("pageNumber") else null,
          generatedPageId = if (map.hasKey("generatedPageId") && !map.isNull("generatedPageId")) map.getString("generatedPageId") else null,
        ),
      )
    }
    return result
  }

  private fun parseInkStrokes(strokes: ReadableArray?): List<InkStroke> {
    if (strokes == null) return emptyList()
    val result = mutableListOf<InkStroke>()
    for (index in 0 until strokes.size()) {
      val map = strokes.getMap(index) ?: continue
      result.add(parseInkStroke(map))
    }
    return result
  }

  private fun parseInkStroke(map: ReadableMap): InkStroke {
    val points = mutableListOf<InkPoint>()
    val strokePageWidth = if (map.hasKey("pageWidth") && !map.isNull("pageWidth")) map.getDouble("pageWidth").toFloat() else pdfPageSize?.width?.toFloat() ?: width.toFloat()
    val strokePageHeight = if (map.hasKey("pageHeight") && !map.isNull("pageHeight")) map.getDouble("pageHeight").toFloat() else pdfPageSize?.height?.toFloat() ?: width.toFloat()
    val pointsArray = if (map.hasKey("points") && !map.isNull("points")) map.getArray("points") else null
    if (pointsArray != null) {
      for (pointIndex in 0 until pointsArray.size()) {
        val pointMap = pointsArray.getMap(pointIndex) ?: continue
        val pageWidth = if (pointMap.hasKey("pageWidth") && !pointMap.isNull("pageWidth")) pointMap.getDouble("pageWidth").toFloat() else strokePageWidth
        val pageHeight = if (pointMap.hasKey("pageHeight") && !pointMap.isNull("pageHeight")) pointMap.getDouble("pageHeight").toFloat() else strokePageHeight
        points.add(InkPoint(pointMap.getDouble("x").toFloat(), pointMap.getDouble("y").toFloat(), pageWidth, pageHeight))
      }
    }
    return InkStroke(
      id = map.getString("id") ?: UUID.randomUUID().toString(),
      points = points,
      color = parseColor(map.getString("color") ?: "#111827"),
      width = if (map.hasKey("width")) map.getDouble("width").toFloat() else 3f,
      style = map.getString("style") ?: "pen",
      brush = if (map.hasKey("brush") && !map.isNull("brush")) map.getString("brush") else null,
      linePattern = if (map.hasKey("linePattern") && !map.isNull("linePattern")) map.getString("linePattern") else null,
      shape = if (map.hasKey("shape") && !map.isNull("shape")) map.getString("shape") else null,
      pageNumber = if (map.hasKey("pageNumber") && !map.isNull("pageNumber")) map.getInt("pageNumber") else null,
      generatedPageId = if (map.hasKey("generatedPageId") && !map.isNull("generatedPageId")) map.getString("generatedPageId") else null,
      pageWidth = strokePageWidth,
      pageHeight = strokePageHeight,
    )
  }

  private fun buildDefaultPdfPages(count: Int): List<NativePage> = (1..max(1, count)).map {
    NativePage("pdf:$it", "pdf", "$it 페이지", it, null)
  }

  private fun emitViewportChanged(force: Boolean = false) {
    if (width <= 0 || height <= 0 || pageLayouts.isEmpty()) return
    val viewportTop = scrollYDocument
    val viewportBottom = scrollYDocument + height / max(1f, scale)
    val pageSize = pdfPageSize
    val pages = Arguments.createArray()
    val keyParts = mutableListOf(
      width.toString(),
      height.toString(),
      (scale * 1000f).roundToInt().toString(),
      scrollYDocument.roundToInt().toString(),
      translateX.roundToInt().toString(),
    )

    pageLayouts.forEach { layout ->
      if (layout.top > viewportBottom || layout.top + layout.height < viewportTop) return@forEach
      val screenLeft = (width - width * scale) / 2f + translateX
      val screenTop = (layout.top - scrollYDocument) * scale
      val screenWidth = width * scale
      val screenHeight = layout.height * scale
      val pageLogicalWidth = pageSize?.width?.toFloat() ?: width.toFloat()
      val pageLogicalHeight = pageSize?.height?.toFloat() ?: layout.height
      pages.pushMap(Arguments.createMap().apply {
        putString("id", layout.page.id)
        putString("kind", layout.page.kind)
        putString("label", layout.page.label)
        if (layout.page.pageNumber != null) putInt("pageNumber", layout.page.pageNumber)
        if (layout.page.generatedPageId != null) putString("generatedPageId", layout.page.generatedPageId)
        putDouble("left", PixelUtil.toDIPFromPixel(screenLeft).toDouble())
        putDouble("top", PixelUtil.toDIPFromPixel(screenTop).toDouble())
        putDouble("width", PixelUtil.toDIPFromPixel(screenWidth).toDouble())
        putDouble("height", PixelUtil.toDIPFromPixel(screenHeight).toDouble())
        putDouble("pageWidth", pageLogicalWidth.toDouble())
        putDouble("pageHeight", pageLogicalHeight.toDouble())
      })
      keyParts.add("${layout.page.id}:${screenLeft.roundToInt()}:${screenTop.roundToInt()}:${screenWidth.roundToInt()}:${screenHeight.roundToInt()}")
    }

    val key = keyParts.joinToString("|")
    if (!force && key == lastViewportEventKey) return
    lastViewportEventKey = key
    val event = Arguments.createMap().apply {
      putDouble("scale", scale.toDouble())
      putDouble("scrollY", PixelUtil.toDIPFromPixel(scrollYDocument).toDouble())
      putDouble("translateX", PixelUtil.toDIPFromPixel(translateX).toDouble())
      putDouble("viewportWidth", PixelUtil.toDIPFromPixel(width.toFloat()).toDouble())
      putDouble("viewportHeight", PixelUtil.toDIPFromPixel(height.toFloat()).toDouble())
      putDouble("contentHeight", PixelUtil.toDIPFromPixel(pageLayouts.lastOrNull()?.let { it.top + it.height + dp(24f) } ?: 0f).toDouble())
      putArray("pages", pages)
    }
    emit("topViewportChanged", event)
  }

  private fun emitDocumentLoaded(pageCount: Int) {
    val event = Arguments.createMap().apply { putInt("pageCount", pageCount) }
    emit("topDocumentLoaded", event)
  }

  private fun emitPageChanged(pageNumber: Int) {
    val event = Arguments.createMap().apply { putInt("pageNumber", pageNumber) }
    emit("topPageChanged", event)
  }

  private fun emitCommitInkStroke(stroke: InkStroke) {
    emit("topCommitInkStroke", strokeToMap(stroke))
  }

  private fun emitRemoveInkStroke(strokeId: String) {
    val event = Arguments.createMap().apply { putString("strokeId", strokeId) }
    emit("topRemoveInkStroke", event)
  }

  private fun emit(eventName: String, event: com.facebook.react.bridge.WritableMap) {
    val reactContext = context as? ReactContext ?: return
    reactContext.getJSModule(RCTEventEmitter::class.java).receiveEvent(id, eventName, event)
  }

  private fun strokeToMap(stroke: InkStroke) = Arguments.createMap().apply {
    putString("id", stroke.id)
    putString("color", colorToHex(stroke.color))
    putDouble("width", stroke.width.toDouble())
    putString("style", stroke.style)
    putString("brush", stroke.brush)
    putString("linePattern", stroke.linePattern ?: "solid")
    if (stroke.shape != null) putString("shape", stroke.shape)
    if (stroke.pageNumber != null) putInt("pageNumber", stroke.pageNumber)
    if (stroke.generatedPageId != null) putString("generatedPageId", stroke.generatedPageId)
    putDouble("pageWidth", stroke.pageWidth.toDouble())
    putDouble("pageHeight", stroke.pageHeight.toDouble())
    val pointsArray = Arguments.createArray()
    stroke.points.forEach { point ->
      pointsArray.pushMap(Arguments.createMap().apply {
        putDouble("x", point.x.toDouble())
        putDouble("y", point.y.toDouble())
        putDouble("pageWidth", point.pageWidth.toDouble())
        putDouble("pageHeight", point.pageHeight.toDouble())
        if (stroke.pageNumber != null) putInt("pageNumber", stroke.pageNumber)
        if (stroke.generatedPageId != null) putString("generatedPageId", stroke.generatedPageId)
      })
    }
    putArray("points", pointsArray)
  }

  private fun openPdfDescriptor(fileUri: String): ParcelFileDescriptor {
    if (fileUri.startsWith("content://")) {
      return context.contentResolver.openFileDescriptor(Uri.parse(fileUri), "r")
        ?: throw IllegalArgumentException("Cannot open PDF content URI.")
    }
    val path = when {
      fileUri.startsWith("file://") -> Uri.parse(fileUri).path
      fileUri.startsWith("/") -> fileUri
      else -> URLDecoder.decode(fileUri, "UTF-8")
    } ?: throw IllegalArgumentException("Invalid PDF URI.")
    return ParcelFileDescriptor.open(File(path), ParcelFileDescriptor.MODE_READ_ONLY)
  }

  private fun baseCacheKey(pageNumber: Int, targetWidth: Int) = "$sourceKey-$pageNumber-$targetWidth"

  private fun loadBaseBitmapFromDisk(key: String): Bitmap? {
    val file = File(cacheDir(), "$key.png")
    if (!file.exists()) return null
    return BitmapFactory.decodeFile(file.absolutePath)
  }

  private fun saveBaseBitmapToDisk(key: String, bitmap: Bitmap) {
    try {
      val file = File(cacheDir(), "$key.png")
      file.parentFile?.mkdirs()
      FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    } catch (_: Exception) {
    }
  }

  private fun cacheDir() = File(context.cacheDir, "bsnap-native-pdf-pages")

  private fun hashKey(value: String): String {
    val bytes = MessageDigest.getInstance("SHA-256").digest(value.toByteArray())
    return bytes.take(12).joinToString("") { "%02x".format(it) }
  }

  private fun quantize(value: Float): Float = (value * 1000f).roundToInt() / 1000f
  private fun dp(value: Float): Float = value * resources.displayMetrics.density

  private fun parseColor(value: String): Int = try {
    Color.parseColor(value)
  } catch (_: Exception) {
    Color.rgb(17, 24, 39)
  }

  private fun colorToHex(color: Int): String = String.format("#%06X", 0xFFFFFF and color)
}
