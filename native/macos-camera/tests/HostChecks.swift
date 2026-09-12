import Foundation
import CoreMediaIO
import SystemExtensions

private final class StartingCameraHost: CameraHost {
    // Exercise the real lifecycle callbacks without activating extensions or starting video.
    var submitted: [OSSystemExtensionRequest] = []
    var streamStarts = 0
    var streamError: Error?
    var availableDevice: CMIODeviceID? = 1
    var deviceLookups = 0

    override func findDevice() -> CMIODeviceID? {
        deviceLookups += 1
        return availableDevice
    }
    override func submitRequest(_ request: OSSystemExtensionRequest) {
        submitted.append(request)
    }
    override func startStream() throws {
        streamStarts += 1
        if let streamError { throw streamError }
    }
}

private final class EnabledCameraProperties: OSSystemExtensionProperties {
    override var isEnabled: Bool { true }
    override var isAwaitingUserApproval: Bool { false }
    override var isUninstalling: Bool { false }
}

@main struct HostChecks {
    static func main() throws {
        let enabledProperties = EnabledCameraProperties()
        for kind in ["install", "start"] {
            let polling = StartingCameraHost()
            polling.extensionBundleURL = FileManager.default.temporaryDirectory
            polling.availableDevice = nil
            for _ in 0..<2 {
                polling.request("status")
                polling.request(polling.submitted.last!, foundProperties: [enabledProperties])
            }
            assert(polling.deviceLookups == 0, "Startup status must not bind CMIO to an installed extension before its version is checked")
            assert(polling.installed && !polling.waitingForDevice && !polling.message.contains("尚未提供设备"), "Enabled but uninspected devices must not be reported missing")
            polling.request(kind)
            _ = polling.snapshot()
            assert(polling.deviceLookups == 0, "Pending activation must not discover an old device")
            polling.request(polling.submitted.last!, didFailWithError: cameraError("activation rejected"))
            polling.request("status")
            polling.request(polling.submitted.last!, foundProperties: [enabledProperties])
            assert(polling.deviceLookups == 0 && polling.message.contains("activation rejected"), "Polling after failed activation must preserve its error without initializing CMIO")
            polling.request(kind)
            polling.request(polling.submitted.last!, didFinishWithResult: .willCompleteAfterReboot)
            polling.request("status")
            polling.request(polling.submitted.last!, foundProperties: [enabledProperties])
            assert(polling.deviceLookups == 0 && polling.message.contains("重启"), "Activation requiring reboot must not initialize CMIO in its completion callback or later polling")

            let activated = StartingCameraHost()
            activated.extensionBundleURL = FileManager.default.temporaryDirectory
            activated.request("status")
            activated.request(activated.submitted.last!, foundProperties: [enabledProperties])
            activated.request(kind)
            activated.request(activated.submitted.last!, didFinishWithResult: .completed)
            assert(activated.deviceLookups > 0, "Completed installation and startup must allow device discovery")
            if kind == "install" {
                assert(activated.message.contains("可以启动输出"), "An enabled status received before installation must not leave the completed installation showing an approval prompt")
            }
            let lookupsAfterActivation = activated.deviceLookups
            activated.request("status")
            activated.request(activated.submitted.last!, foundProperties: [enabledProperties])
            assert(activated.installed && activated.deviceLookups > lookupsAfterActivation, "Fresh status after successful activation must keep checking device availability")
            let lookupsBeforeRetry = activated.deviceLookups
            activated.request(kind)
            activated.request(activated.submitted.last!, didFailWithError: cameraError("activation rejected"))
            activated.request("status")
            activated.request(activated.submitted.last!, foundProperties: [enabledProperties])
            assert(activated.deviceLookups == lookupsBeforeRetry, "A prior activation success must not allow polling to bypass a failed activation retry")
        }
        print("PASS: status avoids CMIO before activation, after failure and when reboot is required; successful activation enables discovery")

        let delayed = StartingCameraHost()
        delayed.extensionBundleURL = FileManager.default.temporaryDirectory
        delayed.availableDevice = nil
        try delayed.start()
        delayed.request(delayed.submitted[0], didFinishWithResult: .completed)
        assert(delayed.streamStarts == 0 && delayed.startAfterActivation, "Activation success must wait for device arrival and retain the requested start")
        try delayed.start()
        delayed.request("install")
        _ = delayed.snapshot()
        assert(delayed.submitted.count == 1, "Waiting for a device must not submit duplicate activations or status requests")
        let delayedStatus = OSSystemExtensionRequest.propertiesRequest(forExtensionWithIdentifier: cameraIdentifier, queue: .main)
        delayed.requests[ObjectIdentifier(delayedStatus)] = "status"
        delayed.request(delayedStatus, foundProperties: [])
        assert(delayed.installed && delayed.startAfterActivation && delayed.message.contains("等待"), "Stale status must not replace device-wait progress")
        delayed.availableDevice = 1
        _ = delayed.snapshot()
        assert(delayed.streamStarts == 1 && !delayed.startAfterActivation, "A device arriving after activation must start output without another click")

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

        let lateStatusHost = StartingCameraHost()
        lateStatusHost.extensionBundleURL = FileManager.default.temporaryDirectory
        lateStatusHost.request("status")
        let lateStatus = lateStatusHost.submitted[0]
        try lateStatusHost.start()
        lateStatusHost.request(lateStatusHost.submitted.last!, didFinishWithResult: .completed)
        lateStatusHost.request(lateStatus, foundProperties: [])
        assert(lateStatusHost.installed && lateStatusHost.streamStarts == 1, "A pre-activation status response arriving after startup must not disable the camera")
        lateStatusHost.request("status")
        lateStatusHost.request(lateStatusHost.submitted.last!, foundProperties: [])
        assert(!lateStatusHost.installed, "A fresh status response must still detect a disabled extension")

        try starting.start()
        starting.stop()
        starting.request(starting.submitted.last!, didFinishWithResult: .completed)
        assert(starting.streamStarts == 1, "Stopping during activation must cancel the deferred stream start")
        try starting.start()
        starting.request("uninstall")
        starting.request(starting.submitted.last!, didFinishWithResult: .completed)
        assert(starting.streamStarts == 1 && starting.requests.values.contains("uninstall"), "Uninstalling during activation must cancel output and submit uninstall when activation finishes")
        starting.request(starting.submitted.last!, didFinishWithResult: .completed)
        assert(!starting.installed && starting.requests.isEmpty, "Deferred uninstall must complete without another click")

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

        func waitingHost() throws -> StartingCameraHost {
            let host = StartingCameraHost()
            host.extensionBundleURL = FileManager.default.temporaryDirectory
            host.availableDevice = nil
            try host.start()
            host.request(host.submitted[0], didFinishWithResult: .completed)
            return host
        }
        let timedOut = try waitingHost()
        timedOut.advanceStart(now: 0)
        assert(timedOut.startAfterActivation && timedOut.streamStarts == 0, "Device arrival must get a grace period")
        timedOut.advanceStart(now: .max)
        timedOut.advanceStart(now: .max)
        assert(timedOut.submitted.count == 1 && timedOut.installed && timedOut.requests.isEmpty, "A device timeout must leave the extension installed without submitting deactivation")
        assert(!timedOut.startAfterActivation && timedOut.streamStarts == 0 && timedOut.message.contains("后重试"), "A device timeout must end the pending start with retry feedback")
        timedOut.updateInstallation(enabled: true, deviceAvailable: false)
        assert(timedOut.message.contains("后重试"), "Status polling must preserve device-unavailable feedback")
        timedOut.availableDevice = 1
        timedOut.advanceStart(now: .max)
        assert(timedOut.streamStarts == 0, "A timed-out request must not start unexpectedly when a device later appears")
        try timedOut.start()
        timedOut.request(timedOut.submitted.last!, didFinishWithResult: .completed)
        assert(timedOut.streamStarts == 1, "A new start after timeout must still activate and start normally")

        let cancelledWait = try waitingHost()
        cancelledWait.stop()
        cancelledWait.availableDevice = 1
        cancelledWait.advanceStart(now: .max)
        assert(cancelledWait.installed && cancelledWait.submitted.count == 1 && cancelledWait.streamStarts == 0, "Stopping during device wait must cancel output and preserve the installation")

        let removedWait = try waitingHost()
        removedWait.request("uninstall")
        removedWait.request("uninstall")
        removedWait.request(removedWait.submitted.last!, didFinishWithResult: .completed)
        removedWait.advanceStart(now: .max)
        assert(!removedWait.installed && removedWait.submitted.count == 2 && removedWait.requests.isEmpty && removedWait.streamStarts == 0, "Explicit uninstall during device wait must cancel output and coalesce repeated uninstall clicks")
        print("PASS: delayed device start, non-destructive timeout, retry, cancellation and explicit uninstall")

        let host = CameraHost()
        host.message = "等待系统设置中的摄像头扩展批准"
        host.updateInstallation(enabled: true, deviceAvailable: false)
        assert(host.installed && host.stream == 0)
        assert(host.message.contains("已启用") && host.message.contains("尚未提供设备"), "An enabled extension without a device must not claim readiness")
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
