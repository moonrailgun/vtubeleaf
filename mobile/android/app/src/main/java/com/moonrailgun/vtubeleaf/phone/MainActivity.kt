package com.moonrailgun.vtubeleaf.phone

import android.content.pm.ApplicationInfo
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.viewModels
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.moonrailgun.vtubeleaf.phone.ui.App

class MainActivity : AppCompatActivity() {
    private val model: AppModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Lock screen, app switch or a call pauses tracking; resuming is the user's decision.
        lifecycle.addObserver(LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) model.background()
        })
        setContent { App(model) }
        // Debug builds also take the QR payload as an intent extra, so adb can drive a device test:
        // adb shell am start -S -n com.moonrailgun.vtubeleaf.phone/.MainActivity --es pairing '<json>'
        if (applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            intent.getStringExtra("pairing")?.let(model::scanned)
        }
    }
}
