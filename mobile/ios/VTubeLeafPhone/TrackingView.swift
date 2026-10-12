import ARKit
import SwiftUI

/// Shows the tracker's own camera feed; hiding it stops drawing but never the session.
struct ARPreview: UIViewRepresentable {
    let box: ARSessionBox
    let hidden: Bool

    func makeUIView(context: Context) -> ARSCNView {
        let view = ARSCNView()
        view.automaticallyUpdatesLighting = false
        view.rendersCameraGrain = false
        return view
    }

    func updateUIView(_ view: ARSCNView, context: Context) {
        if let session = box.session, view.session !== session { view.session = session }
        view.isHidden = hidden
        view.isPlaying = !hidden
    }
}

struct TrackingView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                ZStack {
                    Color.black
                    ARPreview(box: model.arSession, hidden: model.previewHidden)
                    if model.previewHidden {
                        Text("preview_hidden").foregroundStyle(.white).padding()
                    }
                }
                .aspectRatio(3 / 4, contentMode: .fit)
                .clipShape(RoundedRectangle(cornerRadius: 16))
                // Every state is spelled out in words, never signalled by colour alone.
                linkLine.font(.headline)
                trackingLine
                Text("tracking_fps \(model.fps)").font(.footnote).foregroundStyle(.secondary)
                if let notice = model.notice { Text(notice).foregroundStyle(.orange) }
                if model.thermalWarning { Text("thermal_warning").foregroundStyle(.red) }
                if !model.supported { Text("tracker_unsupported").foregroundStyle(.red) }
                HStack(spacing: 12) {
                    if model.tracking == .running {
                        Button("pause") { model.pause(reason: nil) }.buttonStyle(.borderedProminent)
                    } else {
                        Button(model.tracking == .paused ? "resume" : "start", action: model.start)
                            .buttonStyle(.borderedProminent)
                            .disabled(!model.supported)
                    }
                    Button(model.previewHidden ? "show_preview" : "hide_preview") { model.previewHidden.toggle() }
                        .buttonStyle(.bordered)
                }
                Button("disconnect", role: .destructive, action: model.disconnect)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(20)
        }
    }

    private var linkLine: Text {
        switch model.link.state {
        case .connected(let name): return Text("connected_to \(name)")
        case .reconnecting: return Text("reconnecting")
        case .connecting(let name): return Text("connecting_to \(name)")
        default: return Text("link_ended")
        }
    }

    private var trackingLine: Text {
        switch model.tracking {
        case .idle: return Text("tracking_idle")
        case .paused: return Text("tracking_paused")
        case .running: return Text(model.faceFound ? "face_found" : "face_missing")
        }
    }
}
