import SwiftUI

@main
struct VTubeLeafPhoneApp: App {
    @StateObject private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(model)
                // Lock screen, app switch or a call pauses tracking; resuming is the user's decision.
                .onChange(of: phase) { phase in
                    if phase == .background { model.background() }
                }
        }
    }
}
