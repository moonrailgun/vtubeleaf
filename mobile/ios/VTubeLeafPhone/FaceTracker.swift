import ARKit

/// Front TrueDepth/ARKit face tracking → `FaceFrame`. One session for the app's lifetime; `start`
/// runs it and `stop` pauses it, so nothing restarts the camera without the user.
final class FaceTracker: NSObject, ARSessionDelegate {
    static let missInterval: TimeInterval = 0.2
    static var isSupported: Bool { ARFaceTrackingConfiguration.isSupported }

    let session = ARSession()
    private let onFrame: (FaceFrame) -> Void
    private let onInterrupted: () -> Void
    private let onError: (String) -> Void
    private var windowStart: TimeInterval = 0
    private var windowResults = 0
    private var lastMissAt: TimeInterval = 0
    /// Valid face results per second over the last whole second.
    private(set) var fps = 0

    init(onFrame: @escaping (FaceFrame) -> Void, onInterrupted: @escaping () -> Void, onError: @escaping (String) -> Void) {
        self.onFrame = onFrame
        self.onInterrupted = onInterrupted
        self.onError = onError
        super.init()
        session.delegate = self
    }

    func start() {
        let configuration = ARFaceTrackingConfiguration()
        configuration.isLightEstimationEnabled = false
        configuration.maximumNumberOfTrackedFaces = 1
        session.run(configuration, options: [.resetTracking, .removeExistingAnchors])
    }

    func stop() {
        session.pause()
        fps = 0
    }

    func session(_ session: ARSession, didUpdate frame: ARFrame) {
        let now = frame.timestamp
        if now - windowStart >= 1 {
            fps = windowResults
            windowResults = 0
            windowStart = now
        }
        if let anchor = frame.anchors.lazy.compactMap({ $0 as? ARFaceAnchor }).first, anchor.isTracked {
            windowResults += 1
            onFrame(faceFromARKit(
                transform: anchor.transform,
                view: frame.camera.viewMatrix(for: .portrait),
                score: { anchor.blendShapes[$0]?.doubleValue ?? 0 }
            ))
        } else if now - lastMissAt >= Self.missInterval {
            // A few "no face" frames a second let the desktop tell a lost face from a dead link.
            lastMissAt = now
            onFrame(FaceFrame(tracked: false))
        }
    }

    func sessionWasInterrupted(_ session: ARSession) {
        onInterrupted()
    }

    func session(_ session: ARSession, didFailWithError error: Error) {
        onError(error.localizedDescription)
    }
}
