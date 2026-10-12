import XCTest
@testable import VTubeLeafPhone

final class ProtocolTests: XCTestCase {
    private let token = "0123456789abcdef0123456789abcdef0123456789abcdef"
    private let fingerprint = String(repeating: "f", count: 64)
    private var code: String {
        #"{"v":1,"a":["192.168.1.20","10.0.0.5","nope"],"p":51234,"t":"\#(token)","f":"\#(fingerprint)","n":"Studio Mac"}"#
    }

    private func json(_ text: String) -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: text.data(using: .utf8)!)) as? [String: Any] ?? [:]
    }

    func testPairingCodeParsesAndRejectsJunk() {
        let pairing = Pairing.parse(code)!
        XCTAssertEqual(pairing.version, 1)
        XCTAssertEqual(pairing.addresses, ["192.168.1.20", "10.0.0.5"])
        XCTAssertEqual(pairing.port, 51234)
        XCTAssertEqual(pairing.name, "Studio Mac")
        XCTAssertEqual(Pairing.parse(code.replacingOccurrences(of: "\"v\":1", with: "\"v\":2"))?.version, 2)
        XCTAssertNil(Pairing.parse("https://example.com"))
        XCTAssertNil(Pairing.parse(code.replacingOccurrences(of: fingerprint, with: "zz")))
        XCTAssertNil(Pairing.parse(code.replacingOccurrences(of: "51234", with: "70000")))
        XCTAssertNil(Pairing.parse(code.replacingOccurrences(of: "\"192.168.1.20\",\"10.0.0.5\",", with: "")))
    }

    func testHelloSpendsTheTokenOrResumesTheSession() {
        let pairing = json(Messages.hello(token: token, session: nil, device: "iPhone", engine: "arkit"))
        XCTAssertEqual(pairing["type"] as? String, "hello")
        XCTAssertEqual(pairing["version"] as? Int, protocolVersion)
        XCTAssertEqual(pairing["token"] as? String, token)
        XCTAssertNil(pairing["session"])
        XCTAssertEqual((pairing["capabilities"] as? [String])?.count, capabilities.count)
        let resume = json(Messages.hello(token: token, session: "secret", device: "iPhone", engine: "arkit"))
        XCTAssertEqual(resume["session"] as? String, "secret")
        XCTAssertNil(resume["token"])
    }

    func testFramesCarryOrderingAndOnlyDeclaredExtras() {
        var face = FaceFrame(tracked: true)
        face.yaw = 12.5
        face.eyeRight = 0.3
        face.extras = ["browLeft": 0.4, "bogus": 1, "mouthX": .nan]
        let frame = json(Messages.frame(stream: "s1", seq: 7, timestamp: 1234.5, face: face))
        XCTAssertEqual(frame["stream"] as? String, "s1")
        XCTAssertEqual(frame["seq"] as? Int, 7)
        XCTAssertEqual(frame["tracked"] as? Bool, true)
        XCTAssertEqual(frame["yaw"] as? Double, 12.5)
        XCTAssertEqual(frame["eyeRight"] as? Double, 0.3)
        XCTAssertEqual(frame["browLeft"] as? Double, 0.4)
        XCTAssertEqual(frame["mouthX"] as? Double, 0)
        XCTAssertNil(frame["bogus"])
        let lost = json(Messages.frame(stream: "s1", seq: 8, timestamp: 1267.8, face: FaceFrame(tracked: false)))
        XCTAssertEqual(lost["tracked"] as? Bool, false)
        XCTAssertNil(lost["yaw"])
        XCTAssertEqual(json(Messages.state(paused: true))["tracking"] as? String, "paused")
    }
}
