package com.anonymous.bsnap

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.URLDecoder
import java.security.MessageDigest
import java.util.UUID
import kotlin.math.max
import kotlin.math.roundToInt

class PdfPageRendererModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  private data class SourceFingerprint(
    val key: String,
    val size: Long,
    val modifiedAt: Long
  )

  private val cacheMetadataVersion = 1
  private val cacheMetadataKind = "base"
  private val maxCachedPageImages = 11

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

  private fun sha1(value: String): String {
    val bytes = MessageDigest.getInstance("SHA-1").digest(value.toByteArray(Charsets.UTF_8))
    return bytes.joinToString("") { "%02x".format(it) }
  }
}
