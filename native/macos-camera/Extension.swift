import Foundation
import CoreMediaIO
import IOKit.audio
import Security

// Provider callbacks, consumption completions and the timer use this serial queue.
let cameraQueue = DispatchQueue(label: "com.vtubeleaf.camera.extension", qos: .userInteractive)

final class CameraStream: NSObject, CMIOExtensionStreamSource {
    var stream: CMIOExtensionStream!
    unowned let owner: CameraDevice
    let sink: Bool
    let formats: [CMIOExtensionStreamFormat]
    var sinkClient: CMIOExtensionClient?
    var running = 0
    var consuming = false
    var generation = 0

    init(owner: CameraDevice, sink: Bool, format: CMVideoFormatDescription) {
        self.owner = owner
        self.sink = sink
        formats = [CMIOExtensionStreamFormat(formatDescription: format, maxFrameDuration: cameraDuration,
            minFrameDuration: cameraDuration, validFrameDurations: nil)]
        super.init()
        stream = CMIOExtensionStream(localizedName: sink ? "VTubeLeaf Input" : "VTubeLeaf Camera",
            streamID: UUID(uuidString: sink ? "CD136792-F421-48CE-9D62-60781F5D3202" : "CD136792-F421-48CE-9D62-60781F5D3201")!,
            direction: sink ? .sink : .source, clockType: .hostTime, source: self)
    }
    var availableProperties: Set<CMIOExtensionProperty> {
        var result: Set<CMIOExtensionProperty> = [.streamActiveFormatIndex, .streamFrameDuration]
        if sink { result.formUnion([.streamSinkBufferQueueSize, .streamSinkBuffersRequiredForStartup, .streamSinkBufferUnderrunCount, .streamSinkEndOfData]) }
        return result
    }
    func streamProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionStreamProperties {
        let result = CMIOExtensionStreamProperties(dictionary: [:])
        if properties.contains(.streamActiveFormatIndex) { result.activeFormatIndex = 0 }
        if properties.contains(.streamFrameDuration) { result.frameDuration = cameraDuration }
        if properties.contains(.streamSinkBufferQueueSize) { result.sinkBufferQueueSize = 1 }
        if properties.contains(.streamSinkBuffersRequiredForStartup) { result.sinkBuffersRequiredForStartup = 1 }
        if properties.contains(.streamSinkBufferUnderrunCount) { result.sinkBufferUnderrunCount = 0 }
        if properties.contains(.streamSinkEndOfData) { result.sinkEndOfData = 0 }
        return result
    }
    func setStreamProperties(_ properties: CMIOExtensionStreamProperties) throws {
        if let index = properties.activeFormatIndex, index != 0 { throw cameraError("只支持格式 0") }
        if let duration = properties.frameDuration, CMTimeCompare(duration, cameraDuration) != 0 { throw cameraError("只支持 30 FPS") }
    }
    func authorizedToStartStream(for client: CMIOExtensionClient) -> Bool {
        guard sink else { return true }
        guard sinkClient == nil || sinkClient?.clientID == client.clientID,
              client.signingID == "com.vtubeleaf.desktop",
              let team = Bundle.main.object(forInfoDictionaryKey: "CameraTeamIdentifier") as? String,
              team.range(of: "^[A-Z0-9]{10}$", options: .regularExpression) != nil else { return false }
        var code: SecCode?
        guard SecCodeCopyGuestWithAttributes(nil, [kSecGuestAttributePid: client.pid] as CFDictionary, [], &code) == errSecSuccess,
              let code else { return false }
        var requirement: SecRequirement?
        let rule = "anchor apple generic and identifier \"com.vtubeleaf.desktop\" and certificate leaf[subject.OU] = \"\(team)\""
        guard SecRequirementCreateWithString(rule as CFString, [], &requirement) == errSecSuccess,
              let requirement, SecCodeCheckValidity(code, [], requirement) == errSecSuccess else { return false }
        sinkClient = client
        return true
    }
    func startStream() throws {
        if sink && sinkClient == nil { throw cameraError("输入客户端未授权") }
        running += 1
        owner.updateTimer()
    }
    func stopStream() throws {
        running = max(0, running - 1)
        if sink && running == 0 {
            generation += 1
            consuming = false
            sinkClient = nil
            owner.clearFrame()
        }
        owner.updateTimer()
    }
    func consume() {
        guard sink, running > 0, !consuming, let client = sinkClient else { return }
        consuming = true
        let current = generation
        stream.consumeSampleBuffer(from: client) { [weak self] sample, sequence, _, _, error in
            cameraQueue.async {
                guard let self, self.generation == current else { return }
                self.consuming = false
                guard self.running > 0 else { return }
                let now = DispatchTime.now().uptimeNanoseconds
                if error == nil, let sample, CMSampleBufferIsValid(sample),
                   let pixel = CMSampleBufferGetImageBuffer(sample), validCameraFrame(pixel) {
                    self.owner.latest = pixel
                    self.owner.received = now
                }
                if sample != nil {
                    self.stream.notifyScheduledOutputChanged(CMIOExtensionScheduledOutput(sequenceNumber: sequence, hostTimeInNanoseconds: now))
                }
            }
        }
    }
}

final class CameraDevice: NSObject, CMIOExtensionDeviceSource {
    var device: CMIOExtensionDevice!
    var source: CameraStream!
    var sink: CameraStream!
    let frames: CameraFrames
    let blank: CVPixelBuffer
    var latest: CVPixelBuffer?
    var received: UInt64 = 0
    var timer: DispatchSourceTimer?
    override init() {
        do { frames = try CameraFrames(); blank = try frames.pixelBuffer() }
        catch { fatalError("Camera buffer initialization failed: \(error)") }
        super.init()
        device = CMIOExtensionDevice(localizedName: "VTubeLeaf Camera",
            deviceID: UUID(uuidString: "CD136792-F421-48CE-9D62-60781F5D3200")!, legacyDeviceID: cameraDeviceUID, source: self)
        source = CameraStream(owner: self, sink: false, format: frames.format)
        sink = CameraStream(owner: self, sink: true, format: frames.format)
        do { try device.addStream(source.stream); try device.addStream(sink.stream) }
        catch { fatalError("Camera stream registration failed: \(error)") }
    }
    var availableProperties: Set<CMIOExtensionProperty> { [.deviceTransportType, .deviceModel] }
    func deviceProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionDeviceProperties {
        let result = CMIOExtensionDeviceProperties(dictionary: [:])
        if properties.contains(.deviceTransportType) { result.transportType = kIOAudioDeviceTransportTypeVirtual }
        if properties.contains(.deviceModel) { result.model = "VTubeLeaf Camera" }
        return result
    }
    func setDeviceProperties(_ properties: CMIOExtensionDeviceProperties) throws {}
    func clearFrame() { latest = nil; received = 0 }
    func updateTimer() {
        guard source.running > 0 || sink.running > 0 else {
            timer?.cancel(); timer = nil; clearFrame(); return
        }
        guard timer == nil else { return }
        let timer = DispatchSource.makeTimerSource(queue: cameraQueue)
        timer.schedule(deadline: .now(), repeating: .nanoseconds(33_333_333), leeway: .milliseconds(1))
        timer.setEventHandler { [weak self] in self?.tick() }
        self.timer = timer
        timer.resume()
    }
    func tick() {
        sink.consume()
        let now = DispatchTime.now().uptimeNanoseconds
        if !frameIsFresh(received: received, now: now) { clearFrame() }
        guard source.running > 0 else { return }
        let time = CMClockGetTime(CMClockGetHostTimeClock())
        guard let sample = try? frames.sample(latest ?? blank, at: time) else { return }
        source.stream.send(sample, discontinuity: [], hostTimeInNanoseconds: UInt64(CMTimeConvertScale(time, timescale: 1_000_000_000, method: .default).value))
    }
}

final class CameraProvider: NSObject, CMIOExtensionProviderSource {
    var provider: CMIOExtensionProvider!
    let camera = CameraDevice()
    override init() {
        super.init()
        provider = CMIOExtensionProvider(source: self, clientQueue: cameraQueue)
        do { try provider.addDevice(camera.device) }
        catch { fatalError("Camera registration failed: \(error)") }
    }
    var availableProperties: Set<CMIOExtensionProperty> { [.providerManufacturer] }
    func providerProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionProviderProperties {
        let result = CMIOExtensionProviderProperties(dictionary: [:])
        if properties.contains(.providerManufacturer) { result.manufacturer = "VTubeLeaf" }
        return result
    }
    func setProviderProperties(_ properties: CMIOExtensionProviderProperties) throws {}
    func connect(to client: CMIOExtensionClient) throws {}
    func disconnect(from client: CMIOExtensionClient) {
        if camera.sink.sinkClient?.clientID == client.clientID {
            camera.sink.running = 1
            try? camera.sink.stopStream()
        }
    }
}
