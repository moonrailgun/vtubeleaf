import Foundation
import CoreMediaIO

@main struct HostChecks {
    static func main() throws {
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
