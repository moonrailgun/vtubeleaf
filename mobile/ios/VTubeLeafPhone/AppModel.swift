import ARKit
import Combine
import SwiftUI
import UIKit

@MainActor
final class AppModel: ObservableObject {
    enum Screen: Hashable { case connect, tracking, settings }
    enum Tracking { case idle, running, paused }

    let link = DesktopLink(device: UIDevice.current.name, engine: "arkit")
    let supported = FaceTracker.isSupported
    @Published var screen: Screen = .connect {
        didSet { if screen != .connect { scanning = false } }
    }
    @Published private(set) var tracking: Tracking = .idle {
        didSet { UIApplication.shared.isIdleTimerDisabled = tracking == .running }
    }
    @Published private(set) var faceFound = false
    @Published private(set) var fps = 0
    @Published var previewHidden = false
    /// Why the last link ended; shown on the connect screen until the next scan.
    @Published private(set) var endReason: EndReason?
    @Published private(set) var codeError: String?
    /// Remounts the scanner after each code so an invalid one can be followed by another.
    @Published private(set) var scanCount = 0
    /// The scan camera runs only after the user asks for it, and stops when they leave the screen.
    @Published private(set) var scanning = false
    /// One actionable message at a time: why tracking paused or stopped.
    @Published private(set) var notice: String?
    @Published private(set) var thermalWarning = false

    private var tracker: FaceTracker?
    private var cancellables: Set<AnyCancellable> = []

    var arSession: ARSessionBox { ARSessionBox(session: tracker?.session) }

    init() {
        link.$state
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in self?.linkChanged(state) }
            .store(in: &cancellables)
        Timer.publish(every: 1, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                guard let self else { return }
                fps = tracking == .running ? tracker?.fps ?? 0 : 0
            }
            .store(in: &cancellables)
        NotificationCenter.default.publisher(for: ProcessInfo.thermalStateDidChangeNotification)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.thermal() }
            .store(in: &cancellables)
        thermal()
    }

    private func linkChanged(_ state: LinkState) {
        switch state {
        case .connected:
            endReason = nil
            if screen == .connect { screen = .tracking }
        case .ended(let reason):
            pause(reason: nil)
            endReason = reason
            screen = .connect
        default:
            break
        }
    }

    func scan() {
        endReason = nil
        codeError = nil
        scanning = true
    }

    func scanned(_ text: String) {
        scanCount += 1
        guard let pairing = Pairing.parse(text) else {
            codeError = String(localized: "qr_invalid")
            return
        }
        guard pairing.version == protocolVersion else {
            codeError = String(localized: "qr_version \(pairing.version) \(protocolVersion)")
            return
        }
        scanning = false
        codeError = nil
        endReason = nil
        link.connect(pairing)
    }

    func retry() {
        link.disconnect()
        scan()
    }

    func start() {
        guard tracking != .running else { return }
        guard supported else {
            notice = String(localized: "tracker_unsupported")
            return
        }
        notice = nil
        if tracker == nil {
            tracker = FaceTracker(
                onFrame: { [weak self] face in self?.frame(face) },
                onInterrupted: { [weak self] in self?.pause(reason: String(localized: "paused_interrupted")) },
                onError: { [weak self] message in self?.pause(reason: String(localized: "tracker_failed \(message)")) }
            )
        }
        tracker?.start()
        tracking = .running
        link.sendState(paused: false)
    }

    private func frame(_ face: FaceFrame) {
        guard tracking == .running else { return }
        faceFound = face.tracked
        link.sendFrame(face, timestamp: ProcessInfo.processInfo.systemUptime * 1000)
    }

    /// Releases the camera and stops sending; the link stays so Resume is one tap.
    func pause(reason: String?) {
        guard tracking == .running else { return }
        tracker?.stop()
        faceFound = false
        fps = 0
        tracking = .paused
        notice = reason
        link.sendState(paused: true)
    }

    func background() {
        scanning = false
        pause(reason: String(localized: "paused_background"))
    }

    func disconnect() {
        tracker?.stop()
        faceFound = false
        fps = 0
        tracking = .idle
        notice = nil
        link.disconnect()
        screen = .connect
    }

    private func thermal() {
        let state = ProcessInfo.processInfo.thermalState
        thermalWarning = state == .serious || state == .critical
        if state == .critical { pause(reason: String(localized: "thermal_paused")) }
    }
}

/// Lets SwiftUI hand the tracker's session to the preview view without owning it.
struct ARSessionBox {
    let session: ARSession?
}
