import AVFoundation
import SwiftUI

/// Reads one QR code with the back camera, then stops that camera before reporting it.
struct QrScanner: UIViewRepresentable {
    let onCode: (String) -> Void

    func makeUIView(context: Context) -> ScannerView { ScannerView(onCode: onCode) }
    func updateUIView(_ uiView: ScannerView, context: Context) {}
    static func dismantleUIView(_ uiView: ScannerView, coordinator: ()) { uiView.stop() }
}

final class ScannerView: UIView, AVCaptureMetadataOutputObjectsDelegate {
    private let session = AVCaptureSession()
    private let onCode: (String) -> Void
    private var done = false

    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }

    init(onCode: @escaping (String) -> Void) {
        self.onCode = onCode
        super.init(frame: .zero)
        backgroundColor = .black
        configure()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    private func configure() {
        let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
            ?? AVCaptureDevice.default(for: .video)
        guard let camera, let input = try? AVCaptureDeviceInput(device: camera) else { return }
        session.beginConfiguration()
        if session.canAddInput(input) { session.addInput(input) }
        let output = AVCaptureMetadataOutput()
        if session.canAddOutput(output) {
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
        }
        session.commitConfiguration()
        let preview = layer as! AVCaptureVideoPreviewLayer
        preview.session = session
        preview.videoGravity = .resizeAspectFill
        DispatchQueue.global(qos: .userInitiated).async { [session] in session.startRunning() }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !done, let code = objects.compactMap({ ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }).first else { return }
        done = true
        stop()
        onCode(code)
    }

    func stop() {
        guard session.isRunning else { return }
        DispatchQueue.global(qos: .userInitiated).async { [session] in session.stopRunning() }
    }
}
