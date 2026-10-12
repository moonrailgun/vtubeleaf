import SwiftUI

struct RootView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        TabView(selection: $model.screen) {
            NavigationStack { ConnectView().navigationTitle("nav_connect") }
                .tabItem { Label("nav_connect", systemImage: "qrcode.viewfinder") }
                .tag(AppModel.Screen.connect)
            NavigationStack { TrackingView().navigationTitle("nav_tracking") }
                .tabItem { Label("nav_tracking", systemImage: "face.smiling") }
                .tag(AppModel.Screen.tracking)
            NavigationStack { SettingsView().navigationTitle("nav_settings") }
                .tabItem { Label("nav_settings", systemImage: "gearshape") }
                .tag(AppModel.Screen.settings)
        }
        .tint(Color(red: 0.88, green: 0.37, blue: 0.49))
    }
}

extension EndReason {
    var message: LocalizedStringKey {
        switch self {
        case .busy: return "reject_busy"
        case .token: return "reject_token"
        case .session: return "reject_session"
        case .version: return "reject_version"
        case .rejected: return "reject_data"
        case .disconnected: return "bye_disconnected"
        case .unreachable: return "link_unreachable"
        case .identity: return "link_identity"
        case .lost: return "link_lost"
        }
    }
}

/// Opens this app's page in Settings, where iOS keeps per-app language and permissions.
func openAppSettings() {
    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
}
