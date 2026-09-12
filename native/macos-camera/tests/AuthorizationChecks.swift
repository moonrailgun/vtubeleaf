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
        let camera = CameraDevice()
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
