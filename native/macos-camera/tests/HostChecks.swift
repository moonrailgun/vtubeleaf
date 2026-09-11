import Foundation
import CoreMediaIO
import SystemExtensions

private final class StartingCameraHost: CameraHost {
    // Exercise the real lifecycle callbacks without activating extensions or starting video.
    var submitted: [OSSystemExtensionRequest] = []
    var streamStarts = 0
    var streamError: Error?

    override func submitRequest(_ request: OSSystemExtensionRequest) {
        submitted.append(request)
    }
    override func startStream() throws {
        streamStarts += 1
        if let streamError { throw streamError }
    }
}

@main struct HostChecks {
    static func main() throws {
        let starting = StartingCameraHost()
        starting.installed = true
        starting.extensionBundleURL = FileManager.default.temporaryDirectory
        try starting.start()
        assert(starting.streamStarts == 0, "Start must wait for system extension activation instead of opening the old stream")
        assert(starting.submitted.count == 1, "Start must request activation so macOS checks the bundled extension version")
        let activation = starting.submitted[0]
        starting.message = "等待系统设置中的摄像头扩展批准"
        try starting.start()
        assert(starting.submitted.count == 1 && starting.message.contains("批准"), "Repeated clicks must not submit duplicate activations or hide approval instructions")
        _ = starting.snapshot()
        assert(starting.submitted.count == 1, "Polling must wait while activation is in progress")
        let staleStatus = OSSystemExtensionRequest.propertiesRequest(forExtensionWithIdentifier: cameraIdentifier, queue: .main)
        starting.requests[ObjectIdentifier(staleStatus)] = "status"
        starting.request(staleStatus, foundProperties: [])
        assert(starting.installed && starting.message.contains("批准"), "An older status response must not clobber pending activation")
        starting.request(activation, didFinishWithResult: .completed)
        assert(starting.streamStarts == 1, "Completed activation must resume the requested stream")
        starting.request(activation, didFinishWithResult: .completed)
        assert(starting.streamStarts == 1, "A completed request must not start twice")

        try starting.start()
        starting.stop()
        starting.request(starting.submitted.last!, didFinishWithResult: .completed)
        assert(starting.streamStarts == 1, "Stopping during activation must cancel the deferred stream start")
        try starting.start()
        starting.request("uninstall")
        starting.request(starting.submitted.last!, didFinishWithResult: .completed)
        assert(starting.streamStarts == 1, "Uninstalling during activation must not unexpectedly start output")

        try starting.start()
        starting.request(starting.submitted.last!, didFailWithError: cameraError("activation rejected"))
        assert(starting.streamStarts == 1 && starting.message.contains("activation rejected"), "Failed activation must report its error without opening the old stream")
        try starting.start()
        starting.streamError = cameraError("stream unavailable")
        starting.request(starting.submitted.last!, didFinishWithResult: .completed)
        assert(starting.streamStarts == 2 && starting.message.contains("stream unavailable"), "A post-update stream error must remain visible")
        starting.updateInstallation(enabled: true, deviceAvailable: true)
        assert(starting.message.contains("stream unavailable"), "Polling must preserve post-update stream failures")

        try starting.start()
        starting.request(starting.submitted.last!, didFinishWithResult: .willCompleteAfterReboot)
        let requestCount = starting.submitted.count
        starting.updateInstallation(enabled: false, deviceAvailable: false)
        starting.updateInstallation(enabled: true, deviceAvailable: true)
        starting.requests[ObjectIdentifier(staleStatus)] = "status"
        starting.request(staleStatus, didFinishWithResult: .completed)
        try starting.start()
        assert(starting.streamStarts == 2 && starting.submitted.count == requestCount && starting.message.contains("重启"), "A reboot-required update must block the old stream and preserve restart instructions")

        let missingBundle = StartingCameraHost()
        missingBundle.extensionBundleURL = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try missingBundle.start()
        assert(missingBundle.submitted.isEmpty && missingBundle.streamStarts == 0 && missingBundle.message.contains("缺少"), "Missing packaged extensions must fail before activation or streaming")
        print("PASS: activation before start, duplicate clicks, stale polling, cancellation, failures and reboot handling")

        let host = CameraHost()
        host.message = "等待系统设置中的摄像头扩展批准"
        host.updateInstallation(enabled: true, deviceAvailable: false)
        assert(host.installed && host.stream == 0)
        assert(host.message.contains("已启用") && host.message.contains("重新打开"), "An enabled extension without a device must explain recovery instead of claiming readiness")
        host.updateInstallation(enabled: true, deviceAvailable: true)
        assert(host.message == "摄像头已安装，可以启动输出", "Device arrival must clear the stale approval or restart message")
        host.message = "无法启动摄像头输入流：-4"
        host.updateInstallation(enabled: true, deviceAvailable: true)
        assert(host.message == "无法启动摄像头输入流：-4", "Routine status polling must preserve a startup error")
        host.updateInstallation(enabled: false, deviceAvailable: false)
        assert(!host.installed && host.message.contains("停用"), "Disabling the extension must clear stale installed status")
        host.updateInstallation(enabled: true, deviceAvailable: true)
        assert(host.installed && host.message == "摄像头已安装，可以启动输出")
        print("PASS: approval, device arrival, startup failure and disable/re-enable status transitions")

        let devices = objectIDs(CMIOObjectID(kCMIOObjectSystemObject), CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices))
        guard let device = devices.first(where: { deviceUID($0) == cameraDeviceUID }) else {
            guard !CommandLine.arguments.contains("--require-device") else {
                throw cameraError("Enable the signed VTubeLeaf Camera extension before running this check")
            }
            print("SKIP: host queue check requires an installed, enabled VTubeLeaf Camera")
            return
        }
        let streams = objectIDs(device, CMIOObjectPropertySelector(kCMIODevicePropertyStreams), scope: CMIOObjectPropertyScope(kCMIODevicePropertyScopeOutput))
        assert(streams.count == 1, "VTubeLeaf Camera must expose one sink stream")
        // This opens the real CMIO queue without starting capture or bypassing sink authorization.
        let queue = try cameraBufferQueue(streams[0])
        assert(CMSimpleQueueGetCapacity(queue) > 0, "CMIO must return a usable queue before starting output")
        print("PASS: installed camera discovery and native sink queue creation")
    }
}
