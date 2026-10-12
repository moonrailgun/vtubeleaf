package com.moonrailgun.vtubeleaf.phone

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Size
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.LifecycleRegistry
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarker
import com.google.mediapipe.tasks.vision.facelandmarker.FaceLandmarkerResult
import java.util.concurrent.Executors

/**
 * Front camera → MediaPipe Face Landmarker → [FaceFrame]. Frames are made upright but never
 * mirrored, so left and right are the user's own, exactly as with the desktop webcam; the on-screen
 * preview mirrors for display only. One instance serves one start/stop cycle.
 */
class FaceTracker(
    private val context: Context,
    private val onFrame: (FaceFrame) -> Unit,
    private val onError: (String) -> Unit,
) {
    /** The camera follows this owner rather than the activity, so leaving the app never restarts it. */
    private val owner = object : LifecycleOwner {
        val registry = LifecycleRegistry(this)
        override val lifecycle: Lifecycle get() = registry
    }
    private val executor = Executors.newSingleThreadExecutor()
    private var landmarker: FaceLandmarker? = null
    private var provider: ProcessCameraProvider? = null
    private var buffer: Bitmap? = null
    private var windowStart = 0L
    private var windowResults = 0
    private var lastMissAt = 0L

    /** Valid face results per second over the last whole second. */
    @Volatile var fps = 0
        private set

    fun start(previewView: PreviewView) {
        landmarker = create(Delegate.GPU) ?: create(Delegate.CPU)
        if (landmarker == null) return onError(context.getString(R.string.tracker_unsupported))
        owner.registry.currentState = Lifecycle.State.RESUMED
        val future = ProcessCameraProvider.getInstance(context)
        future.addListener({
            if (owner.registry.currentState != Lifecycle.State.RESUMED) return@addListener
            val provider = future.get().also { this.provider = it }
            val preview = Preview.Builder().build().also { it.surfaceProvider = previewView.surfaceProvider }
            val analysis = ImageAnalysis.Builder()
                .setResolutionSelector(
                    ResolutionSelector.Builder()
                        .setResolutionStrategy(
                            ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER),
                        )
                        .build(),
                )
                // Bounded by design: a frame the model has not taken yet is replaced, never queued.
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
                .build()
            analysis.setAnalyzer(executor, ::analyze)
            try {
                provider.unbindAll()
                provider.bindToLifecycle(owner, CameraSelector.DEFAULT_FRONT_CAMERA, preview, analysis)
            } catch (error: Exception) {
                stop()
                onError(context.getString(R.string.camera_busy))
            }
        }, ContextCompat.getMainExecutor(context))
    }

    private fun create(delegate: Delegate): FaceLandmarker? = try {
        FaceLandmarker.createFromOptions(
            context,
            FaceLandmarker.FaceLandmarkerOptions.builder()
                .setBaseOptions(
                    BaseOptions.builder().setModelAssetPath("face_landmarker.task").setDelegate(delegate).build(),
                )
                .setRunningMode(RunningMode.LIVE_STREAM)
                .setNumFaces(1)
                .setOutputFaceBlendshapes(true)
                .setOutputFacialTransformationMatrixes(true)
                .setResultListener { result, _ -> deliver(result) }
                .setErrorListener { error ->
                    onError(context.getString(R.string.tracker_failed, error.message ?: ""))
                }
                .build(),
        )
    } catch (error: Exception) {
        null
    }

    private fun analyze(image: ImageProxy) {
        val landmarker = landmarker
        if (landmarker == null) {
            image.close()
            return
        }
        val bitmap = buffer?.takeIf { it.width == image.width && it.height == image.height }
            ?: Bitmap.createBitmap(image.width, image.height, Bitmap.Config.ARGB_8888).also { buffer = it }
        bitmap.copyPixelsFromBuffer(image.planes[0].buffer)
        val rotation = image.imageInfo.rotationDegrees
        image.close()
        // Upright only. No horizontal flip: the data must mean the same as the desktop's webcam frames.
        val upright = if (rotation == 0) bitmap else Bitmap.createBitmap(
            bitmap, 0, 0, bitmap.width, bitmap.height, Matrix().apply { postRotate(rotation.toFloat()) }, false,
        )
        try {
            landmarker.detectAsync(BitmapImageBuilder(upright).build(), SystemClock.uptimeMillis())
        } catch (_: Exception) {
            // A frame older than the previous one is skipped by MediaPipe; nothing to recover.
        }
    }

    private fun deliver(result: FaceLandmarkerResult) {
        val now = SystemClock.elapsedRealtime()
        val matrix = result.facialTransformationMatrixes().orElse(null)?.firstOrNull()
        val scores = result.faceBlendshapes().orElse(null)?.firstOrNull()
            ?.associate { it.categoryName() to it.score() }
        val face = if (matrix != null && scores != null) faceFromMediaPipe({ scores[it] ?: 0f }, matrix) else null
        if (now - windowStart >= 1000) {
            fps = windowResults
            windowResults = 0
            windowStart = now
        }
        if (face != null) {
            windowResults++
            onFrame(face)
        } else if (now - lastMissAt >= MISS_INTERVAL_MS) {
            // A few "no face" frames a second let the desktop tell a lost face from a dead link.
            lastMissAt = now
            onFrame(FaceFrame(tracked = false))
        }
    }

    fun stop() {
        if (owner.registry.currentState != Lifecycle.State.INITIALIZED) {
            owner.registry.currentState = Lifecycle.State.DESTROYED
        }
        provider?.unbindAll()
        provider = null
        landmarker?.close()
        landmarker = null
        executor.shutdown()
        fps = 0
    }

    companion object {
        const val MISS_INTERVAL_MS = 200L
    }
}
