package com.anonymous.bsnap

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import com.google.mlkit.common.MlKitException
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizer
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizerOptions
import com.google.mlkit.vision.digitalink.recognition.Ink
import com.google.mlkit.vision.digitalink.recognition.RecognitionContext
import com.google.mlkit.vision.digitalink.recognition.WritingArea
import kotlin.math.max
import kotlin.math.min

class HandwritingRecognitionModule(
  reactContext: ReactApplicationContext
) : ReactContextBaseJavaModule(reactContext) {
  private data class InkPayload(
    val ink: Ink,
    val strokeCount: Int,
    val bbox: WritableMap,
    val pageNumber: Int
  )

  private val remoteModelManager: RemoteModelManager = RemoteModelManager.getInstance()
  private val lock = Any()
  private var koreanModelIdentifier: DigitalInkRecognitionModelIdentifier? = null
  private var koreanModel: DigitalInkRecognitionModel? = null
  private var koreanRecognizer: DigitalInkRecognizer? = null
  private var downloadInProgress = false
  private var lastModelState = "missing"
  private var lastModelDetail = "Korean Digital Ink model is missing."

  override fun getName(): String = "BsnHandwritingRecognition"

  @ReactMethod
  fun isAvailable(promise: Promise) {
    val model = getKoreanModel()
    if (model == null) {
      promise.resolve(availabilityMap(false, "failed", "Korean Digital Ink model identifier is unavailable on Android."))
      return
    }

    remoteModelManager.isModelDownloaded(model)
      .addOnSuccessListener { downloaded ->
        if (downloaded) {
          setModelState("ready", "Android ML Kit Korean Digital Ink model is ready.")
          promise.resolve(availabilityMap(true, "ready", lastModelDetail))
          return@addOnSuccessListener
        }

        val state = synchronized(lock) {
          if (downloadInProgress) "downloading" else "missing"
        }
        val detail = if (state == "downloading") {
          "Android ML Kit Korean model download is in progress."
        } else {
          "Android ML Kit bridge is installed, but the Korean model is missing."
        }
        setModelState(state, detail)
        promise.resolve(availabilityMap(true, state, detail))
      }
      .addOnFailureListener { error ->
        val detail = error.localizedMessage ?: "Android ML Kit model state check failed."
        setModelState("failed", detail)
        promise.resolve(availabilityMap(false, "failed", detail))
      }
  }

  @ReactMethod
  fun ensureKoreanModel(promise: Promise) {
    val model = getKoreanModel()
    if (model == null) {
      promise.resolve(availabilityMap(false, "failed", "Korean Digital Ink model identifier is unavailable on Android."))
      return
    }

    remoteModelManager.isModelDownloaded(model)
      .addOnSuccessListener { downloaded ->
        if (downloaded) {
          setModelState("ready", "Android ML Kit Korean Digital Ink model is ready.")
          promise.resolve(availabilityMap(true, "ready", lastModelDetail))
          return@addOnSuccessListener
        }

        val alreadyDownloading = synchronized(lock) {
          if (downloadInProgress) {
            true
          } else {
            downloadInProgress = true
            false
          }
        }
        if (alreadyDownloading) {
          val detail = "Android ML Kit Korean model download is already in progress."
          setModelState("downloading", detail)
          promise.resolve(availabilityMap(false, "downloading", detail))
          return@addOnSuccessListener
        }

        val detail = "Android ML Kit Korean model download started. Tap model check again after it finishes."
        setModelState("downloading", detail)
        remoteModelManager.download(model, DownloadConditions.Builder().build())
          .addOnSuccessListener {
            synchronized(lock) { downloadInProgress = false }
            setModelState("ready", "Android ML Kit Korean Digital Ink model is ready.")
          }
          .addOnFailureListener { error ->
            synchronized(lock) { downloadInProgress = false }
            setModelState("failed", error.localizedMessage ?: "Android ML Kit Korean model download failed.")
          }
        promise.resolve(availabilityMap(false, "downloading", detail))
      }
      .addOnFailureListener { error ->
        val detail = error.localizedMessage ?: "Android ML Kit model state check failed."
        setModelState("failed", detail)
        promise.resolve(availabilityMap(false, "failed", detail))
      }
  }

  @ReactMethod
  fun recognizeKoreanInk(inkStrokes: ReadableArray?, options: ReadableMap?, promise: Promise) {
    if (inkStrokes == null || inkStrokes.size() == 0) {
      promise.resolve(unavailableRecognition("No B-Snap ink strokes were provided.", "missing"))
      return
    }

    val model = getKoreanModel()
    if (model == null) {
      promise.resolve(unavailableRecognition("Korean Digital Ink model identifier is unavailable on Android.", "failed"))
      return
    }

    remoteModelManager.isModelDownloaded(model)
      .addOnSuccessListener { downloaded ->
        if (!downloaded) {
          val state = synchronized(lock) { if (downloadInProgress) "downloading" else "missing" }
          val detail = if (state == "downloading") {
            "Android ML Kit Korean model download is in progress. Wait until it is ready."
          } else {
            "Android ML Kit Korean model is missing. Prepare the model first."
          }
          setModelState(state, detail)
          promise.resolve(unavailableRecognition(detail, state))
          return@addOnSuccessListener
        }

        val payload = try {
          inkPayloadFromBsnStrokes(inkStrokes, options)
        } catch (error: Exception) {
          promise.resolve(failedRecognition(error.localizedMessage ?: "Failed to convert B-Snap strokes to Android ML Kit ink."))
          return@addOnSuccessListener
        }

        if (payload == null || payload.strokeCount == 0) {
          promise.resolve(unavailableRecognition("No eligible pen strokes were found for Android ML Kit recognition.", "ready"))
          return@addOnSuccessListener
        }

        val recognizer = getKoreanRecognizer(model)
        val recognitionContext = recognitionContextFromOptions(options)
        val task = if (recognitionContext != null) {
          recognizer.recognize(payload.ink, recognitionContext)
        } else {
          recognizer.recognize(payload.ink)
        }

        task
          .addOnSuccessListener { result ->
            val topText = if (result.candidates.isNotEmpty()) result.candidates[0].text else ""
            val hasCandidates = result.candidates.isNotEmpty()
            val candidateTexts = result.candidates.map { candidate -> candidate.text }
            val cluster = Arguments.createMap().apply {
              putString("id", stringOption(options, "clusterId") ?: "mlkit-cluster-1")
              putInt("pageNumber", payload.pageNumber)
              putMap("bbox", payload.bbox)
              putString("text", topText)
              putArray("candidates", candidatesArray(candidateTexts))
              putArray("keywords", Arguments.createArray())
              putArray("symbols", Arguments.createArray())
              putDouble("confidence", if (hasCandidates) 0.82 else 0.0)
              putString("source", "mlkit-digital-ink")
            }
            val clusters = Arguments.createArray()
            if (hasCandidates) clusters.pushMap(cluster)

            promise.resolve(Arguments.createMap().apply {
              putString("status", if (hasCandidates) "ready" else "unavailable")
              putString("engine", "mlkit-digital-ink")
              putString("text", topText)
              putArray("keywords", Arguments.createArray())
              putArray("symbols", Arguments.createArray())
              putDouble("confidence", if (hasCandidates) 0.82 else 0.0)
              putArray("clusters", clusters)
              putArray("candidates", candidatesArray(candidateTexts))
              putString("modelState", "ready")
              putString("detail", if (hasCandidates) {
                "Android ML Kit Digital Ink recognition completed."
              } else {
                "Android ML Kit returned no candidates."
              })
            })
          }
          .addOnFailureListener { error ->
            promise.resolve(failedRecognition(error.localizedMessage ?: "Android ML Kit recognition failed."))
          }
      }
      .addOnFailureListener { error ->
        val detail = error.localizedMessage ?: "Android ML Kit model state check failed."
        setModelState("failed", detail)
        promise.resolve(failedRecognition(detail))
      }
  }

  @ReactMethod
  fun recognizeGestureInk(inkStrokes: ReadableArray?, options: ReadableMap?, promise: Promise) {
    promise.resolve(Arguments.createMap().apply {
      putString("status", "unavailable")
      putString("engine", "mlkit-digital-ink")
      putArray("symbols", Arguments.createArray())
      putDouble("confidence", 0.0)
      putString("detail", "Android ML Kit gesture bridge is not connected. Geometry symbol detection remains active.")
    })
  }

  private fun getKoreanModel(): DigitalInkRecognitionModel? {
    synchronized(lock) {
      koreanModel?.let { return it }
      val identifier = try {
        DigitalInkRecognitionModelIdentifier.fromLanguageTag("ko")
      } catch (_: MlKitException) {
        null
      } ?: return null
      koreanModelIdentifier = identifier
      koreanModel = DigitalInkRecognitionModel.builder(identifier).build()
      return koreanModel
    }
  }

  private fun getKoreanRecognizer(model: DigitalInkRecognitionModel): DigitalInkRecognizer {
    synchronized(lock) {
      val existing = koreanRecognizer
      if (existing != null) return existing
      val recognizer = DigitalInkRecognition.getClient(
        DigitalInkRecognizerOptions.builder(model).build()
      )
      koreanRecognizer = recognizer
      return recognizer
    }
  }

  private fun setModelState(state: String, detail: String) {
    synchronized(lock) {
      lastModelState = state
      lastModelDetail = detail
    }
  }

  private fun availabilityMap(available: Boolean, state: String, detail: String): WritableMap =
    Arguments.createMap().apply {
      putBoolean("available", available)
      putString("state", state)
      putString("detail", detail)
    }

  private fun unavailableRecognition(detail: String, modelState: String = lastModelState): WritableMap =
    Arguments.createMap().apply {
      putString("status", "unavailable")
      putString("engine", "mlkit-digital-ink")
      putString("text", "")
      putArray("keywords", Arguments.createArray())
      putArray("symbols", Arguments.createArray())
      putDouble("confidence", 0.0)
      putArray("clusters", Arguments.createArray())
      putArray("candidates", Arguments.createArray())
      putString("modelState", modelState)
      putString("detail", detail)
    }

  private fun failedRecognition(detail: String): WritableMap =
    unavailableRecognition(detail, "failed").apply {
      putString("status", "failed")
    }

  private fun candidatesArray(candidateTexts: List<String>): WritableArray =
    Arguments.createArray().apply {
      candidateTexts.forEach { text ->
        pushMap(Arguments.createMap().apply {
          putString("text", text)
        })
      }
    }

  private fun inkPayloadFromBsnStrokes(inkStrokes: ReadableArray, options: ReadableMap?): InkPayload? {
    val inkBuilder = Ink.builder()
    var strokeCount = 0
    var minX = Float.POSITIVE_INFINITY
    var minY = Float.POSITIVE_INFINITY
    var maxX = Float.NEGATIVE_INFINITY
    var maxY = Float.NEGATIVE_INFINITY
    val fallbackPageNumber = doubleOption(options, "pageNumber")?.toInt() ?: 1
    var pageNumber = fallbackPageNumber
    var lastTime = 0L

    for (index in 0 until inkStrokes.size()) {
      val stroke = inkStrokes.getMap(index) ?: continue
      if (!isEligibleTextStroke(stroke)) continue
      val points = stroke.getArray("points") ?: continue
      if (points.size() < 2) continue

      val strokeBuilder = Ink.Stroke.builder()
      var pointCount = 0
      for (pointIndex in 0 until points.size()) {
        val point = points.getMap(pointIndex) ?: continue
        val x = doubleValue(point, "x")?.toFloat() ?: continue
        val y = doubleValue(point, "y")?.toFloat() ?: continue
        val rawTime = doubleValue(point, "t")?.toLong()
        val t = if (rawTime != null) {
          max(lastTime + 1, rawTime)
        } else {
          lastTime + 16
        }
        lastTime = t
        strokeBuilder.addPoint(Ink.Point.create(x, y, t))
        minX = min(minX, x)
        minY = min(minY, y)
        maxX = max(maxX, x)
        maxY = max(maxY, y)
        pointCount += 1
      }

      if (pointCount >= 2) {
        inkBuilder.addStroke(strokeBuilder.build())
        strokeCount += 1
        pageNumber = doubleValue(stroke, "pageNumber")?.toInt()
          ?: firstPointPageNumber(points)
          ?: fallbackPageNumber
        lastTime += 24
      }
    }

    if (strokeCount == 0 || !minX.isFinite() || !minY.isFinite() || !maxX.isFinite() || !maxY.isFinite()) {
      return null
    }

    val bbox = mapOption(options, "clusterBbox") ?: Arguments.createMap().apply {
      putDouble("x", minX.toDouble())
      putDouble("y", minY.toDouble())
      putDouble("width", max(0f, maxX - minX).toDouble())
      putDouble("height", max(0f, maxY - minY).toDouble())
    }
    return InkPayload(inkBuilder.build(), strokeCount, bbox, pageNumber)
  }

  private fun isEligibleTextStroke(stroke: ReadableMap): Boolean {
    if (stringValue(stroke, "generatedPageId") != null) return false
    val style = stringValue(stroke, "style")
    val brush = stringValue(stroke, "brush")
    if (style == "highlight" || style == "shape") return false
    if (brush == "highlighter") return false
    if (stringValue(stroke, "shape") != null) return false
    return true
  }

  private fun recognitionContextFromOptions(options: ReadableMap?): RecognitionContext? {
    val width = doubleOption(options, "writingAreaWidth")?.toFloat()
    val height = doubleOption(options, "writingAreaHeight")?.toFloat()
    val preContext = stringOption(options, "preContext")
    if ((width == null || height == null || width <= 0 || height <= 0) && preContext.isNullOrBlank()) {
      return null
    }

    val builder = RecognitionContext.builder()
    if (width != null && height != null && width > 0 && height > 0) {
      builder.setWritingArea(WritingArea(width, height))
    }
    if (!preContext.isNullOrBlank()) {
      builder.setPreContext(preContext.takeLast(20))
    }
    return builder.build()
  }

  private fun firstPointPageNumber(points: ReadableArray): Int? {
    for (index in 0 until points.size()) {
      val pageNumber = points.getMap(index)?.let { doubleValue(it, "pageNumber")?.toInt() }
      if (pageNumber != null) return pageNumber
    }
    return null
  }

  private fun mapOption(options: ReadableMap?, key: String): WritableMap? {
    val value = if (options?.hasKey(key) == true && !options.isNull(key)) options.getMap(key) else null
    if (value == null) return null
    return Arguments.createMap().apply {
      putDouble("x", doubleValue(value, "x") ?: 0.0)
      putDouble("y", doubleValue(value, "y") ?: 0.0)
      putDouble("width", doubleValue(value, "width") ?: 0.0)
      putDouble("height", doubleValue(value, "height") ?: 0.0)
    }
  }

  private fun doubleOption(options: ReadableMap?, key: String): Double? =
    if (options?.hasKey(key) == true && !options.isNull(key)) options.getDouble(key) else null

  private fun stringOption(options: ReadableMap?, key: String): String? =
    if (options?.hasKey(key) == true && !options.isNull(key)) options.getString(key) else null

  private fun doubleValue(map: ReadableMap, key: String): Double? =
    if (map.hasKey(key) && !map.isNull(key)) map.getDouble(key) else null

  private fun stringValue(map: ReadableMap, key: String): String? =
    if (map.hasKey(key) && !map.isNull(key)) map.getString(key) else null
}
