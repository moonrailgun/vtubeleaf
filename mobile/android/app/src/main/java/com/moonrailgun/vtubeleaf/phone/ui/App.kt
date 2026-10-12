package com.moonrailgun.vtubeleaf.phone.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Face
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.moonrailgun.vtubeleaf.phone.AppModel
import com.moonrailgun.vtubeleaf.phone.LinkState
import com.moonrailgun.vtubeleaf.phone.R

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun App(model: AppModel) {
    val link by model.link.state.collectAsStateWithLifecycle()
    val connected = link is LinkState.Connected || link is LinkState.Reconnecting
    val titles = mapOf(
        AppModel.Screen.Connect to R.string.nav_connect,
        AppModel.Screen.Tracking to R.string.nav_tracking,
        AppModel.Screen.Settings to R.string.nav_settings,
    )
    MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFFE15F7D), background = Color(0xFFF8F5F9))) {
        Scaffold(
            topBar = { TopAppBar(title = { Text(stringResource(titles.getValue(model.screen))) }) },
            bottomBar = {
                NavigationBar {
                    NavigationBarItem(
                        selected = model.screen == AppModel.Screen.Connect,
                        onClick = { model.show(AppModel.Screen.Connect) },
                        icon = { Icon(Icons.Default.Phone, contentDescription = null) },
                        label = { Text(stringResource(R.string.nav_connect)) },
                    )
                    NavigationBarItem(
                        selected = model.screen == AppModel.Screen.Tracking,
                        enabled = connected,
                        onClick = { model.show(AppModel.Screen.Tracking) },
                        icon = { Icon(Icons.Default.Face, contentDescription = null) },
                        label = { Text(stringResource(R.string.nav_tracking)) },
                    )
                    NavigationBarItem(
                        selected = model.screen == AppModel.Screen.Settings,
                        onClick = { model.show(AppModel.Screen.Settings) },
                        icon = { Icon(Icons.Default.Settings, contentDescription = null) },
                        label = { Text(stringResource(R.string.nav_settings)) },
                    )
                }
            },
        ) { padding ->
            Box(Modifier.padding(padding).fillMaxSize()) {
                when (model.screen) {
                    AppModel.Screen.Connect -> ConnectScreen(model, link)
                    AppModel.Screen.Tracking -> TrackingScreen(model, link)
                    AppModel.Screen.Settings -> SettingsScreen()
                }
            }
        }
    }
}
