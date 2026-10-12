import SwiftUI

struct SettingsView: View {
    private var version: String {
        let short = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        return build.isEmpty ? short : "\(short) (\(build))"
    }

    var body: some View {
        List {
            Section("language") {
                Text("language_hint").font(.footnote).foregroundStyle(.secondary)
                Button("open_system_settings", action: openAppSettings)
            }
            Section("privacy_title") { Text("privacy_text") }
            Section("support_title") { Text("support_text_arkit") }
            Section("help_title") { Text("help_text") }
            Section { Text("version \(version)").font(.footnote).foregroundStyle(.secondary) }
        }
    }
}
