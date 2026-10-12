package com.moonrailgun.vtubeleaf.phone.ui

import androidx.appcompat.app.AppCompatDelegate
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.core.os.LocaleListCompat
import com.moonrailgun.vtubeleaf.phone.R

@Composable
fun SettingsScreen() {
    val context = LocalContext.current
    val current = AppCompatDelegate.getApplicationLocales().get(0)?.language ?: ""
    val languages = listOf(
        "" to stringResource(R.string.language_system),
        "en" to "English",
        "zh" to "中文",
        "ja" to "日本語",
        "es" to "Español",
        "fr" to "Français",
    )
    val version = runCatching {
        context.packageManager.getPackageInfo(context.packageName, 0).versionName
    }.getOrNull() ?: ""
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(stringResource(R.string.language), style = MaterialTheme.typography.titleMedium)
        for ((tag, label) in languages) {
            Row(
                Modifier.fillMaxWidth()
                    .selectable(
                        selected = current == tag,
                        role = Role.RadioButton,
                        onClick = { AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(tag)) },
                    )
                    .padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = current == tag, onClick = null)
                Spacer(Modifier.width(8.dp))
                Text(label)
            }
        }
        Section(R.string.privacy_title, R.string.privacy_text)
        Section(R.string.support_title, R.string.support_text)
        Section(R.string.help_title, R.string.help_text)
        Text(stringResource(R.string.version, version), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun Section(title: Int, body: Int) {
    Text(stringResource(title), style = MaterialTheme.typography.titleMedium)
    Text(stringResource(body))
}
