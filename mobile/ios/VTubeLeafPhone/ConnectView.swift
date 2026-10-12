import AVFoundation
import SwiftUI

struct ConnectView: View {
    @EnvironmentObject private var model: AppModel
    @State private var authorization = AVCaptureDevice.authorizationStatus(for: .video)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Text("connect_intro")
                Text("network_intro").font(.footnote).foregroundStyle(.secondary)
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
    }

    @ViewBuilder
    private var content: some View {
        switch authorization {
        case .notDetermined:
            Text("camera_permission_intro")
            Button("camera_permission_button") {
                AVCaptureDevice.requestAccess(for: .video) { _ in
                    DispatchQueue.main.async { authorization = AVCaptureDevice.authorizationStatus(for: .video) }
                }
            }
            .buttonStyle(.borderedProminent)
        case .denied, .restricted:
            // Asking again and again is not allowed to become a loop; Settings is the way out.
            Text("camera_permission_denied").foregroundStyle(.red)
            Button("open_system_settings", action: openAppSettings).buttonStyle(.bordered)
        default:
            linkContent
        }
    }

    @ViewBuilder
    private var linkContent: some View {
        switch model.link.state {
        case .connecting(let name):
            Text("connecting_to \(name)")
            ProgressView()
        case .connected(let name):
            Text("connected_to \(name)")
            Button("nav_tracking") { model.screen = .tracking }.buttonStyle(.borderedProminent)
        case .reconnecting:
            Text("reconnecting")
            Button("disconnect", action: model.disconnect).buttonStyle(.bordered)
        case .ended, .idle:
            if let reason = model.endReason {
                Text(reason.message).foregroundStyle(.red)
                if reason == .unreachable {
                    Text("local_network_hint").font(.footnote)
                    Button("open_system_settings", action: openAppSettings).buttonStyle(.bordered)
                }
                Button("scan_again", action: model.retry).buttonStyle(.borderedProminent)
            } else if model.scanning {
                if let error = model.codeError { Text(error).foregroundStyle(.red) }
                Text("scan_hint")
                QrScanner(onCode: model.scanned)
                    .id(model.scanCount)
                    .aspectRatio(3 / 4, contentMode: .fit)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .accessibilityLabel("scan_hint")
            } else {
                Button("scan", action: model.scan).buttonStyle(.borderedProminent)
            }
        }
    }
}
