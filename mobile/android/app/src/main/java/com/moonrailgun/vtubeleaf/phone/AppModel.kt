package com.moonrailgun.vtubeleaf.phone

import android.app.Application
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import androidx.camera.view.PreviewView
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class AppModel(application: Application) : AndroidViewModel(application) {
    enum class Screen { Connect, Tracking, Settings }
    enum class Tracking { Idle, Running, Paused }

    val link = DesktopLink(device = Build.MODEL.take(64), engine = "mediapipe")
    var screen by mutableStateOf(Screen.Connect)
        private set
    var tracking by mutableStateOf(Tracking.Idle)
        private set
    var faceFound by mutableStateOf(false)
        private set
    var fps by mutableIntStateOf(0)
        private set
    var previewHidden by mutableStateOf(false)

    /** Why the last link ended; shown on the connect screen until the next scan. */
    var endReason by mutableStateOf<EndReason?>(null)
        private set
    var codeError by mutableStateOf<String?>(null)
        private set

    /** Remounts the scanner after each code so an invalid one can be followed by another. */
    var scanCount by mutableIntStateOf(0)
        private set

    /** The scan camera runs only after the user asks for it, and stops when they leave the screen. */
    var scanning by mutableStateOf(false)
        private set

    /** One actionable message at a time: why tracking paused or stopped. */
    var notice by mutableStateOf<String?>(null)
        private set
    var thermalWarning by mutableStateOf(false)
        private set

    private var tracker: FaceTracker? = null
    private val app: Application get() = getApplication()
    private var thermalListener: PowerManager.OnThermalStatusChangedListener? = null

    init {
        viewModelScope.launch {
            link.state.collect { state ->
                when (state) {
                    is LinkState.Connected -> {
                        endReason = null
                        if (screen == Screen.Connect) screen = Screen.Tracking
                    }
                    is LinkState.Ended -> {
                        pause(null)
                        endReason = state.reason
                        screen = Screen.Connect
                    }
                    else -> {}
                }
            }
        }
        viewModelScope.launch {
            while (true) {
                delay(1000)
                fps = if (tracking == Tracking.Running) tracker?.fps ?: 0 else 0
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val listener = PowerManager.OnThermalStatusChangedListener { status -> thermal(status) }
            app.getSystemService(PowerManager::class.java)
                ?.addThermalStatusListener(ContextCompat.getMainExecutor(app), listener)
            thermalListener = listener
        }
    }

    fun show(screen: Screen) {
        this.screen = screen
        if (screen != Screen.Connect) scanning = false
    }

    fun scan() {
        endReason = null
        codeError = null
        scanning = true
    }

    fun scanned(text: String) {
        scanCount++
        val pairing = Pairing.parse(text)
        codeError = when {
            pairing == null -> app.getString(R.string.qr_invalid)
            pairing.version != PROTOCOL_VERSION ->
                app.getString(R.string.qr_version, pairing.version, PROTOCOL_VERSION)
            else -> null
        }
        if (pairing == null || codeError != null) return
        scanning = false
        endReason = null
        link.connect(pairing)
    }

    fun retry() {
        link.disconnect()
        scan()
    }

    fun start(previewView: PreviewView) {
        if (tracking == Tracking.Running) return
        notice = null
        val tracker = FaceTracker(
            app,
            onFrame = { face ->
                faceFound = face.tracked
                link.sendFrame(face, SystemClock.elapsedRealtime().toDouble())
            },
            onError = { message ->
                viewModelScope.launch(Dispatchers.Main) {
                    pause(message)
                }
            },
        )
        this.tracker = tracker
        tracker.start(previewView)
        tracking = Tracking.Running
        link.sendState(paused = false)
    }

    /** Releases the camera and stops sending; the link stays so Resume is one tap. */
    fun pause(reason: String?) {
        if (tracking != Tracking.Running) return
        stopTracking()
        tracking = Tracking.Paused
        notice = reason
        link.sendState(paused = true)
    }

    fun background() {
        scanning = false
        if (tracking == Tracking.Running) pause(app.getString(R.string.paused_background))
    }

    fun disconnect() {
        stopTracking()
        tracking = Tracking.Idle
        notice = null
        link.disconnect()
        screen = Screen.Connect
    }

    private fun stopTracking() {
        tracker?.stop()
        tracker = null
        faceFound = false
        fps = 0
    }

    private fun thermal(status: Int) {
        thermalWarning = status >= PowerManager.THERMAL_STATUS_SEVERE
        if (status >= PowerManager.THERMAL_STATUS_CRITICAL) pause(app.getString(R.string.thermal_paused))
    }

    override fun onCleared() {
        stopTracking()
        link.disconnect()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            thermalListener?.let { app.getSystemService(PowerManager::class.java)?.removeThermalStatusListener(it) }
        }
    }
}
