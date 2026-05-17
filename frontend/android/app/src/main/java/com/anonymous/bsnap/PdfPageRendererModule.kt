package com.anonymous.bsnap

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.io.FileOutputStream
import java.net.URLDecoder
import java.security.MessageDigest
import kotlin.math.max
import kotlin.math.roundToInt

class PdfPageRendererModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

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
      descriptor = openPdfDescriptor(fileUri)
      renderer = PdfRenderer(descriptor)

      if (pageNumber > renderer.pageCount) {
        promise.reject("PDF_RENDER_PAGE_OUT_OF_RANGE", "PDF pageNumber exceeds page count.")
        return
      }

      page = renderer.openPage(pageNumber - 1)
      val ratio = page.height.toFloat() / page.width.toFloat()
      val bitmapWidth = safeTargetWidth
      val bitmapHeight = max(1, (bitmapWidth * ratio).roundToInt())

      bitmap = Bitmap.createBitmap(bitmapWidth, bitmapHeight, Bitmap.Config.ARGB_8888)
      bitmap.eraseColor(Color.WHITE)
      page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)

      val outputFile = getOutputFile(fileUri, pageNumber, bitmapWidth)
      outputFile.parentFile?.mkdirs()
      FileOutputStream(outputFile).use { stream ->
        bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
      }

      val result = Arguments.createMap().apply {
        putString("uri", Uri.fromFile(outputFile).toString())
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

  private fun getOutputFile(fileUri: String, pageNumber: Int, targetWidth: Int): File {
    val cacheDir = File(reactContext.cacheDir, "bsnap-pdf-pages")
    val key = sha1("$fileUri:$pageNumber:$targetWidth")
    return File(cacheDir, "$key.png")
  }

  private fun sha1(value: String): String {
    val bytes = MessageDigest.getInstance("SHA-1").digest(value.toByteArray(Charsets.UTF_8))
    return bytes.joinToString("") { "%02x".format(it) }
  }
}
