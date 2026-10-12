package com.moonrailgun.vtubeleaf.phone.ui

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.moonrailgun.vtubeleaf.phone.AppModel
import com.moonrailgun.vtubeleaf.phone.EndReason
import com.moonrailgun.vtubeleaf.phone.LinkState
import com.moonrailgun.vtubeleaf.phone.QrScanner
import com.moonrailgun.vtubeleaf.phone.R

fun EndReason.message() = when (this) {
    EndReason.BUSY -> R.string.reject_busy
    EndReason.TOKEN -> R.string.reject_token
    EndReason.SESSION -> R.string.reject_session
    EndReason.VERSION -> R.string.reject_version
    EndReason.REJECTED -> R.string.reject_data
    EndReason.DISCONNECTED -> R.string.bye_disconnected
    EndReason.UNREACHABLE -> R.string.link_unreachable
    EndReason.IDENTITY -> R.string.link_identity
    EndReason.LOST -> R.string.link_lost
}

@Composable
fun ConnectScreen(model: AppModel, link: LinkState) {
    val context = LocalContext.current
    var granted by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED,
        )
    }
    var denied by remember { mutableStateOf(false) }
    val request = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        granted = ok
        denied = !ok
    }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(R.string.connect_intro))
        Text(stringResource(R.string.network_intro), style = MaterialTheme.typography.bodySmall)
        when {
            !granted -> {
                Text(stringResource(R.string.camera_permission_intro))
                if (denied) {
                    // Asking again and again is not allowed to become a loop; the system settings are the way out.
                    Text(stringResource(R.string.camera_permission_denied), color = MaterialTheme.colorScheme.error)
                    Button(onClick = {
                        context.startActivity(
                            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.packageName, null)),
                        )
                    }) { Text(stringResource(R.string.open_system_settings)) }
                } else {
                    Button(onClick = { request.launch(Manifest.permission.CAMERA) }) {
                        Text(stringResource(R.string.camera_permission_button))
                    }
                }
            }
            link is LinkState.Connecting -> {
                Text(stringResource(R.string.connecting_to, link.name))
                CircularProgressIndicator()
            }
            link is LinkState.Connected -> {
                Text(stringResource(R.string.connected_to, link.name))
                Button(onClick = { model.show(AppModel.Screen.Tracking) }) { Text(stringResource(R.string.nav_tracking)) }
            }
            link is LinkState.Reconnecting -> {
                Text(stringResource(R.string.reconnecting))
                OutlinedButton(onClick = model::disconnect) { Text(stringResource(R.string.disconnect)) }
            }
            else -> {
                val reason = model.endReason
                if (reason != null) {
                    Text(stringResource(reason.message()), color = MaterialTheme.colorScheme.error)
                    Button(onClick = model::retry) { Text(stringResource(R.string.scan_again)) }
                } else {
                    model.codeError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    Text(stringResource(R.string.scan_hint))
                    key(model.scanCount) {
                        QrScanner(
                            onCode = model::scanned,
                            modifier = Modifier.fillMaxWidth().aspectRatio(3f / 4f).clip(RoundedCornerShape(16.dp)),
                        )
                    }
                }
            }
        }
    }
}
