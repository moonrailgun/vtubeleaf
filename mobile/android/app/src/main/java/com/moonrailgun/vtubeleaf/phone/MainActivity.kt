package com.moonrailgun.vtubeleaf.phone

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
    }
}
