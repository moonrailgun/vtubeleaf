import Foundation
import CoreMediaIO
import ObjectiveC

// CoreMediaIO supplies clients and exposes no public initializer. This test-only
// subclass supplies callback metadata while keeping Security.framework checks real.
private var testPID = getpid()
private var testSigningID: String? = "com.moonrailgun.vtubeleaf"
private final class TestCameraClient: CMIOExtensionClient {
    override var pid: pid_t { testPID }
    override var signingID: String? { testSigningID }
    override var clientID: UUID { UUID(uuidString: "C88B2E65-64F8-4B6A-97BE-D5D823C28E71")! }
}

@main struct AuthorizationChecks {
    static func main() throws {
        let client = class_createInstance(TestCameraClient.self, 0) as! TestCameraClient
        let provider = CameraProvider()
        let camera = provider.camera
        assert(camera.availableProperties.contains(.deviceCanBeDefaultInputDevice))
        let properties = try camera.deviceProperties(forProperties: [.deviceCanBeDefaultInputDevice])
        let canBeDefault = properties.propertiesDictionary[.deviceCanBeDefaultInputDevice]?.value as? NSNumber
        assert(canBeDefault == false, "The virtual camera must not become the default input device")
        print("PASS: virtual camera is ineligible as the default input device")
        try cameraQueue.sync {
            let demand = CMIOExtensionProperty(rawValue: "4cc_vlcs_glob_0000")
            func hasConsumers() -> String? {
                (try? camera.deviceProperties(forProperties: [demand]))?.propertiesDictionary[demand]?.value as? String
            }
            assert(camera.availableProperties.contains(demand), "The host must be able to query source demand")
            assert(hasConsumers() == "0", "An idle source must not request frames")
            camera.sink.running = 1
            assert(hasConsumers() == "0", "The producer sink must not count as a source client")
            try camera.source.startStream()
            try camera.source.startStream()
            assert(hasConsumers() == "1", "Source clients must resume the producer")
            try camera.source.stopStream()
            assert(hasConsumers() == "1", "One remaining source client still needs frames")
            try camera.source.stopStream()
            assert(hasConsumers() == "0", "The last departing client must stop frame requests")
            camera.sink.running = 0
            camera.updateTimer()
        }
        print("PASS: source demand excludes the producer and tracks the last client")
        assert(camera.source.authorizedToStartStream(for: client))
        assert(!camera.sink.authorizedToStartStream(for: client), "Claimed signing ID must not authorize this unsigned test process")
        assert(camera.sink.sinkClient == nil)
        print("PASS: sink rejects an unsigned process claiming the host signing ID")

        guard CommandLine.arguments.count == 2, let hostPID = pid_t(CommandLine.arguments[1]) else {
            print("SKIP: pass a running signed VTubeLeaf PID to check unknown/missing signing metadata")
            return
        }
        testPID = hostPID
        for signingID: String? in ["unknown", nil] {
            testSigningID = signingID
            assert(camera.sink.authorizedToStartStream(for: client), "Valid signed host rejected with signingID=\(signingID ?? "nil")")
            assert(camera.sink.sinkClient?.clientID == client.clientID)
            camera.sink.sinkClient = nil
        }
        print("PASS: real host signature authorizes unknown/missing CoreMediaIO signing metadata")
    }
}
