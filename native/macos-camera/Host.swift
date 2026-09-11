import Foundation
import AppKit
import CoreMediaIO
import SystemExtensions

private let hostQueue = DispatchQueue(label: "com.vtubeleaf.camera.host", qos: .userInteractive)
private let cameraHost = CameraHost()
private let cameraDeviceUnavailable = "摄像头扩展已启用，macOS 尚未提供设备，请稍后重试"
private let cameraRebootRequired = "macOS 要求重启以完成摄像头扩展变更；请保存工作并重启 Mac"

func objectIDs(_ object: CMIOObjectID, _ selector: CMIOObjectPropertySelector, scope: CMIOObjectPropertyScope = CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal)) -> [CMIOObjectID] {
    var address = CMIOObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
    var size: UInt32 = 0
    guard CMIOObjectGetPropertyDataSize(object, &address, 0, nil, &size) == noErr,
          size > 0, size <= 65536, size % 4 == 0 else { return [] }
    var result = [CMIOObjectID](repeating: 0, count: Int(size) / 4)
    let status = result.withUnsafeMutableBytes { CMIOObjectGetPropertyData(object, &address, 0, nil, size, &size, $0.baseAddress!) }
    return status == noErr ? Array(result.prefix(Int(size) / 4)) : []
}

func deviceUID(_ device: CMIODeviceID) -> String? {
    var address = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceUID), mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal), mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout.size(ofValue: value))
    guard CMIOObjectGetPropertyData(device, &address, 0, nil, size, &size, &value) == noErr else { return nil }
    return value?.takeRetainedValue() as String?
}

func cameraBufferQueue(_ stream: CMIOStreamID) throws -> CMSimpleQueue {
    var value: Unmanaged<CMSimpleQueue>?
    // A nil callback unregisters notifications and can return noErr with a nil queue.
    // Frame submission polls the queue, so no callback work is needed.
    let result = CMIOStreamCopyBufferQueue(stream, { _, _, _ in }, nil, &value)
    guard result == noErr, let queue = value?.takeRetainedValue(), CMSimpleQueueGetCapacity(queue) > 0 else { throw cameraError("无法打开摄像头队列：\(result)") }
    return queue
}

class CameraHost: NSObject, OSSystemExtensionRequestDelegate {
    var installed = false
    var message = "尚未安装 VTubeLeaf Camera"
    var device: CMIODeviceID = 0
    var stream: CMIOStreamID = 0
    var queue: CMSimpleQueue?
    var frames: CameraFrames?
    var requests: [ObjectIdentifier: String] = [:]
    var lastEnqueue: UInt64 = 0
    var lastRefresh: UInt64 = 0
    var approvalPromptShown = false
    var waitingForDevice = false
    var startAfterActivation = false
    var needsReboot = false
    var deviceWaitDeadline: UInt64?
    var uninstallAfterRequest = false
    var extensionBundleURL = Bundle.main.bundleURL.appendingPathComponent("Contents/Library/SystemExtensions/\(cameraIdentifier).systemextension")

    func showApprovalPrompt() {
        let settingsURL: String
        if #available(macOS 15, *) {
            message = "请在系统设置 → 通用 → 登录项与扩展 → 相机扩展中开启 VTubeLeaf"
            settingsURL = "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"
        } else {
            message = "请在系统设置 → 隐私与安全性中允许 VTubeLeaf Camera 扩展"
            settingsURL = "x-apple.systempreferences:com.apple.preference.security"
        }
        guard !approvalPromptShown else { return }
        approvalPromptShown = true
        let instructions = message
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.messageText = "需要启用 VTubeLeaf Camera"
            alert.informativeText = instructions + "。开启后回到应用，待处理的启动会自动继续。"
            alert.addButton(withTitle: "打开系统设置")
            alert.addButton(withTitle: "稍后")
            if alert.runModal() == .alertFirstButtonReturn {
                NSWorkspace.shared.open(URL(string: settingsURL)!)
            }
        }
    }

    func findDevice() -> CMIODeviceID? {
        objectIDs(CMIOObjectID(kCMIOObjectSystemObject), CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices)).first { deviceUID($0) == cameraDeviceUID }
    }
    func updateInstallation(enabled: Bool, deviceAvailable: Bool) {
        let wasInstalled = installed
        installed = enabled
        guard !needsReboot, !startAfterActivation else { return }
        if !installed && wasInstalled {
            stop()
            waitingForDevice = false
            message = "摄像头扩展已停用，请在系统设置中重新开启或安装"
        } else if installed && stream == 0 && (!wasInstalled || waitingForDevice) {
            waitingForDevice = !deviceAvailable
            message = deviceAvailable ? "摄像头已安装，可以启动输出" : cameraDeviceUnavailable
        }
    }
    func snapshot() -> [String: Any] {
        let now = DispatchTime.now().uptimeNanoseconds
        advanceStart(now: now)
        if stream != 0 && findDevice() != device {
            stop()
            message = "虚拟摄像头已断开，请重新启动输出"
        }
        if now - lastRefresh > 2_000_000_000 && requests.isEmpty && !startAfterActivation {
            lastRefresh = now
            request("status")
        }
        return ["supported": true, "installed": installed, "active": stream != 0, "message": message]
    }
    func request(_ kind: String) {
        if kind == "install" && startAfterActivation { return }
        if kind == "uninstall" {
            guard !requests.values.contains("uninstall") else { return }
            stop()
        }
        if kind != "status" && requests.values.contains(where: { $0 != "status" }) {
            if kind == "uninstall" {
                uninstallAfterRequest = true
                message = "当前请求完成后将自动卸载摄像头扩展"
            } else if kind != "start" { message = "系统扩展请求正在处理中，请完成后重试" }
            return
        }
        if kind == "install" || kind == "start" {
            guard FileManager.default.fileExists(atPath: extensionBundleURL.path) else {
                startAfterActivation = false
                message = "安装包缺少摄像头扩展，请先完成签名打包"; return
            }
            approvalPromptShown = false
        }
        if kind == "start" {
            startAfterActivation = true
            waitingForDevice = false
        }
        // Pre-change status results are obsolete even if they arrive after this request finishes.
        if kind != "status" { requests = requests.filter { $0.value != "status" } }
        let request: OSSystemExtensionRequest
        switch kind {
        case "install", "start": request = .activationRequest(forExtensionWithIdentifier: cameraIdentifier, queue: hostQueue)
        case "uninstall": request = .deactivationRequest(forExtensionWithIdentifier: cameraIdentifier, queue: hostQueue)
        default: request = .propertiesRequest(forExtensionWithIdentifier: cameraIdentifier, queue: hostQueue)
        }
        requests[ObjectIdentifier(request)] = kind
        request.delegate = self
        switch kind {
        case "install": message = "正在请求安装，请在系统设置中批准扩展"
        case "start": message = "正在检查并更新摄像头扩展"
        case "uninstall": message = "正在请求卸载摄像头扩展"
        default: break
        }
        submitRequest(request)
    }
    func submitRequest(_ request: OSSystemExtensionRequest) {
        OSSystemExtensionManager.shared.submitRequest(request)
    }
    func start() throws {
        if stream != 0 { return }
        guard !needsReboot else { message = cameraRebootRequired; return }
        guard !startAfterActivation,
              !requests.values.contains(where: { $0 != "status" }) else { return }
        // Activation also checks/replaces an installed version; never open its stream first.
        request("start")
    }
    func advanceStart(now: UInt64) {
        guard startAfterActivation, let deadline = deviceWaitDeadline else { return }
        if findDevice() != nil {
            deviceWaitDeadline = nil
            startAfterActivation = false
            waitingForDevice = false
            do { try startStream() }
            catch { message = error.localizedDescription }
        } else if now >= deadline {
            deviceWaitDeadline = nil
            startAfterActivation = false
            message = cameraDeviceUnavailable
        }
    }
    func startStream() throws {
        if stream != 0 { return }
        guard let device = findDevice() else {
            waitingForDevice = installed
            throw cameraError(installed
                ? cameraDeviceUnavailable
                : "找不到 VTubeLeaf Camera，请先安装并在系统设置中启用相机扩展")
        }
        waitingForDevice = false
        let outputs = objectIDs(device, CMIOObjectPropertySelector(kCMIODevicePropertyStreams), scope: CMIOObjectPropertyScope(kCMIODevicePropertyScopeOutput))
        guard let stream = outputs.first, outputs.count == 1 else { throw cameraError("找不到摄像头输入流") }
        let queue = try cameraBufferQueue(stream)
        let frames = try CameraFrames()
        let status = CMIODeviceStartStream(device, stream)
        guard status == noErr else { throw cameraError("无法启动摄像头输入流：\(status)") }
        self.device = device; self.stream = stream; self.queue = queue; self.frames = frames
        installed = true; lastEnqueue = 0; message = "正在输出 1280×720 / 30 FPS"
    }
    func stop() {
        startAfterActivation = false
        deviceWaitDeadline = nil
        if stream != 0 { CMIODeviceStopStream(device, stream) }
        // CMIO owns buffers after enqueue; do not race its consumer by draining/resetting its queue.
        queue = nil; frames = nil; stream = 0; device = 0; lastEnqueue = 0
        message = needsReboot ? cameraRebootRequired : (installed ? "摄像头已安装，输出已停止" : "尚未安装 VTubeLeaf Camera")
    }
    func submit(_ bytes: UnsafeRawPointer, count: Int) throws {
        guard count == cameraBytes else { throw cameraError("帧必须是 1280×720 RGBA") }
        guard stream != 0, let queue, let frames else { throw cameraError("摄像头输出尚未启动") }
        let now = DispatchTime.now().uptimeNanoseconds
        if CMSimpleQueueGetCount(queue) > 0 {
            if lastEnqueue > 0 && now - lastEnqueue > 2_000_000_000 {
                stop(); throw cameraError("摄像头输入流超时，请重新启动输出")
            }
            return // One native frame in flight; drop newer frames while CMIO consumes it.
        }
        guard lastEnqueue == 0 || now - lastEnqueue >= 33_333_333 else { return }
        let image = try frames.pixelBuffer(rgba: bytes, count: count)
        let sample = try frames.sample(image, at: CMClockGetTime(CMClockGetHostTimeClock()))
        let retained = Unmanaged.passRetained(sample)
        let status = CMSimpleQueueEnqueue(queue, element: retained.toOpaque())
        if status != noErr {
            retained.release()
            throw cameraError("摄像头帧入队失败：\(status)")
        }
        lastEnqueue = now
    }
    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        guard requests[ObjectIdentifier(request)] != nil, !uninstallAfterRequest else { return }
        showApprovalPrompt()
    }
    func request(_ request: OSSystemExtensionRequest, actionForReplacingExtension existing: OSSystemExtensionProperties, withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction { .replace }
    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        guard let kind = requests.removeValue(forKey: ObjectIdentifier(request)), kind != "status" else { return }
        if result == .willCompleteAfterReboot {
            startAfterActivation = false
            needsReboot = true
        }
        if uninstallAfterRequest {
            uninstallAfterRequest = false
            self.request("uninstall")
            return
        }
        if kind == "install" || kind == "start" {
            updateInstallation(enabled: true, deviceAvailable: findDevice() != nil)
        }
        if kind == "uninstall" { updateInstallation(enabled: false, deviceAvailable: false); message = "摄像头已卸载" }
        if needsReboot {
            message = cameraRebootRequired
            return
        }
        if kind == "start" && startAfterActivation {
            let now = DispatchTime.now().uptimeNanoseconds
            deviceWaitDeadline = now + 8_000_000_000
            waitingForDevice = true
            message = "正在等待摄像头设备就绪，将自动启动输出"
            advanceStart(now: now)
        }
    }
    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        guard let kind = requests.removeValue(forKey: ObjectIdentifier(request)) else { return }
        if kind != "status" {
            startAfterActivation = false
            deviceWaitDeadline = nil
            waitingForDevice = false
            if uninstallAfterRequest {
                uninstallAfterRequest = false
                self.request("uninstall")
                return
            }
        }
        if needsReboot {
            message = kind == "status" ? cameraRebootRequired : "系统扩展：\(error.localizedDescription)。\(cameraRebootRequired)"
            return
        }
        guard !requests.values.contains(where: { $0 != "status" }),
              !startAfterActivation else { return }
        // A bare development executable may not be entitled to inspect system extensions.
        if kind != "status" || !installed { message = "系统扩展：\(error.localizedDescription)" }
    }
    func request(_ request: OSSystemExtensionRequest, foundProperties properties: [OSSystemExtensionProperties]) {
        guard requests.removeValue(forKey: ObjectIdentifier(request)) == "status" else { return }
        // A status request submitted before activation must not replace update/approval feedback.
        guard !requests.values.contains(where: { $0 != "status" }), !needsReboot,
              !startAfterActivation else { return }
        updateInstallation(enabled: properties.contains { $0.isEnabled && !$0.isUninstalling }, deviceAvailable: findDevice() != nil)
        if !installed && properties.contains(where: { $0.isAwaitingUserApproval }) { showApprovalPrompt() }
        else if !installed && properties.contains(where: { $0.isUninstalling }) { message = "摄像头正在卸载，可能需要重启" }
    }
}

@_cdecl("vtubeleaf_camera_command")
public func cameraCommand(_ operation: Int32, _ output: UnsafeMutablePointer<CChar>?, _ capacity: Int) -> Int32 {
    hostQueue.sync {
        var code: Int32 = 0
        do {
            switch operation {
            case 0: break
            case 1: cameraHost.request("install")
            case 2: cameraHost.request("uninstall")
            case 3: try cameraHost.start()
            case 4: cameraHost.stop()
            default: throw cameraError("未知摄像头操作")
            }
        } catch { cameraHost.message = error.localizedDescription; code = -1 }
        if let output, capacity > 0, let data = try? JSONSerialization.data(withJSONObject: cameraHost.snapshot()) {
            guard data.count < capacity else { output[0] = 0; return -1 }
            data.copyBytes(to: UnsafeMutableRawPointer(output).assumingMemoryBound(to: UInt8.self), count: data.count)
            output[data.count] = 0
        }
        return code
    }
}

@_cdecl("vtubeleaf_camera_submit")
public func cameraSubmit(_ bytes: UnsafeRawPointer?, _ count: Int) -> Int32 {
    guard let bytes, count == cameraBytes else { return -1 }
    return hostQueue.sync {
        do { try cameraHost.submit(bytes, count: count); return 0 }
        catch { cameraHost.message = error.localizedDescription; return -1 }
    }
}
