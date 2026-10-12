package com.moonrailgun.vtubeleaf.phone

import android.content.Context
import androidx.camera.core.CameraSelector
import androidx.camera.core.ExperimentalGetImage
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage

/** Reads one QR code with the back camera, then releases that camera before reporting it. */
@Composable
fun QrScanner(onCode: (String) -> Unit, modifier: Modifier = Modifier) {
    val latest by rememberUpdatedState(onCode)
    val owner = remember {
        object : LifecycleOwner {
            val registry = LifecycleRegistry(this)
            override val lifecycle: Lifecycle get() = registry
        }
    }
    DisposableEffect(Unit) {
        owner.registry.currentState = Lifecycle.State.RESUMED
        onDispose { owner.registry.currentState = Lifecycle.State.DESTROYED }
    }
    AndroidView(
        modifier = modifier,
        factory = { context -> PreviewView(context).also { bindScanner(context, owner, it) { code -> latest(code) } } },
    )
}

@OptIn(ExperimentalGetImage::class)
private fun bindScanner(context: Context, owner: LifecycleOwner, view: PreviewView, onCode: (String) -> Unit) {
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
        if (owner.lifecycle.currentState == Lifecycle.State.DESTROYED) return@addListener
        val provider = future.get()
        val preview = Preview.Builder().build().also { it.surfaceProvider = view.surfaceProvider }
        val scanner = BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
        )
        val analysis = ImageAnalysis.Builder()
            .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
            .build()
        var done = false
        analysis.setAnalyzer(ContextCompat.getMainExecutor(context)) { image ->
            val media = image.image
            if (done || media == null) {
                image.close()
                return@setAnalyzer
            }
            scanner.process(InputImage.fromMediaImage(media, image.imageInfo.rotationDegrees))
                .addOnSuccessListener { codes ->
                    val value = codes.firstOrNull()?.rawValue
                    if (value != null && !done) {
                        done = true
                        provider.unbindAll()
                        onCode(value)
                    }
                }
                .addOnCompleteListener { image.close() }
        }
        val cameras = listOf(CameraSelector.DEFAULT_BACK_CAMERA, CameraSelector.DEFAULT_FRONT_CAMERA)
        for (camera in cameras) {
            try {
                provider.unbindAll()
                provider.bindToLifecycle(owner, camera, preview, analysis)
                break
            } catch (_: Exception) {
                // No such camera or it is busy; the next one may do.
            }
        }
    }, ContextCompat.getMainExecutor(context))
}
