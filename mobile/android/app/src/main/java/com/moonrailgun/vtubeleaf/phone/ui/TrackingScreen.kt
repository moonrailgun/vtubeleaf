package com.moonrailgun.vtubeleaf.phone.ui

import androidx.camera.view.PreviewView
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.moonrailgun.vtubeleaf.phone.AppModel
import com.moonrailgun.vtubeleaf.phone.LinkState
import com.moonrailgun.vtubeleaf.phone.R

@Composable
fun TrackingScreen(model: AppModel, link: LinkState) {
    val context = LocalContext.current
    val view = LocalView.current
    val running = model.tracking == AppModel.Tracking.Running
    // The screen stays on while tracking so a phone on a stand keeps working.
    DisposableEffect(running) {
        view.keepScreenOn = running
        onDispose { view.keepScreenOn = false }
    }
    val previewView = remember { PreviewView(context).apply { scaleType = PreviewView.ScaleType.FILL_CENTER } }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            Modifier.fillMaxWidth().aspectRatio(3f / 4f).clip(RoundedCornerShape(16.dp)).background(Color.Black),
        ) {
            // Hidden means transparent: the camera keeps feeding the tracker underneath.
            AndroidView(factory = { previewView }, modifier = Modifier.fillMaxSize().alpha(if (model.previewHidden) 0f else 1f))
            if (model.previewHidden) {
                Text(stringResource(R.string.preview_hidden), Modifier.align(Alignment.Center).padding(16.dp), color = Color.White)
            }
        }
        // Every state is spelled out in words, never signalled by colour alone.
        Text(
            when (link) {
                is LinkState.Connected -> stringResource(R.string.connected_to, link.name)
                is LinkState.Reconnecting -> stringResource(R.string.reconnecting)
                is LinkState.Connecting -> stringResource(R.string.connecting_to, link.name)
                else -> stringResource(R.string.link_ended)
            },
            style = MaterialTheme.typography.titleMedium,
        )
        Text(
            when (model.tracking) {
                AppModel.Tracking.Idle -> stringResource(R.string.tracking_idle)
                AppModel.Tracking.Paused -> stringResource(R.string.tracking_paused)
                AppModel.Tracking.Running ->
                    stringResource(if (model.faceFound) R.string.face_found else R.string.face_missing)
            },
        )
        Text(stringResource(R.string.tracking_fps, model.fps), style = MaterialTheme.typography.bodySmall)
        model.notice?.let { Text(it, color = MaterialTheme.colorScheme.tertiary) }
        if (model.thermalWarning) Text(stringResource(R.string.thermal_warning), color = MaterialTheme.colorScheme.error)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (running) {
                Button(onClick = { model.pause(null) }) { Text(stringResource(R.string.pause)) }
            } else {
                Button(onClick = { model.start(previewView) }) {
                    Text(stringResource(if (model.tracking == AppModel.Tracking.Paused) R.string.resume else R.string.start))
                }
            }
            OutlinedButton(onClick = { model.previewHidden = !model.previewHidden }) {
                Text(stringResource(if (model.previewHidden) R.string.show_preview else R.string.hide_preview))
            }
        }
        TextButton(onClick = model::disconnect) { Text(stringResource(R.string.disconnect)) }
    }
}
