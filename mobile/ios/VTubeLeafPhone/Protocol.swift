import Foundation

/// Wire protocol version shared with the desktop receiver (src-tauri/src/phone.rs).
let protocolVersion = 1

/// Optional channels ARKit can provide; the desktop ignores extras that were not declared.
let capabilities = ["gazeX", "gazeY", "browLeft", "browRight", "mouthX", "cheekPuff", "tongueOut"]

/// What the desktop's pairing QR code carries.
struct Pairing: Equatable {
    let version: Int
    let addresses: [String]
    let port: Int
    let token: String
    let fingerprint: String
    let name: String

    /// Nil for anything that is not a VTubeLeaf code; another version still parses so it can be explained.
    static func parse(_ text: String) -> Pairing? {
        guard let data = text.data(using: .utf8),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let version = json["v"] as? Int,
              let list = json["a"] as? [String],
              let port = json["p"] as? Int,
              let token = json["t"] as? String,
              let fingerprint = (json["f"] as? String)?.lowercased()
        else { return nil }
        let addresses = Array(list.filter { $0.matches(#"^\d{1,3}(\.\d{1,3}){3}$"#) }.prefix(8))
        guard (1...65535).contains(port),
              !addresses.isEmpty,
              token.matches("^[0-9a-f]{16,128}$"),
              fingerprint.matches("^[0-9a-f]{64}$")
        else { return nil }
        let name = String(((json["n"] as? String) ?? "").prefix(32))
        return Pairing(version: version, addresses: addresses, port: port, token: token, fingerprint: fingerprint, name: name)
    }
}

private extension String {
    func matches(_ pattern: String) -> Bool {
        range(of: pattern, options: .regularExpression) != nil
    }
}

/// One tracking result in the desktop's units: degrees, 0–1 openness, the user's own left and right.
/// `extras` holds declared optional channels only.
struct FaceFrame: Equatable {
    var tracked: Bool
    var yaw: Double = 0
    var pitch: Double = 0
    var roll: Double = 0
    var eyeLeft: Double = 1
    var eyeRight: Double = 1
    var mouthOpen: Double = 0
    var mouthSmile: Double = 0
    var extras: [String: Double] = [:]
}

enum Messages {
    private static func encode(_ object: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8)
        else { return "{}" }
        return text
    }

    static func hello(token: String?, session: String?, device: String, engine: String) -> String {
        var object: [String: Any] = [
            "type": "hello", "version": protocolVersion, "device": device, "engine": engine,
            "capabilities": capabilities,
        ]
        if let session { object["session"] = session } else { object["token"] = token ?? "" }
        return encode(object)
    }

    static func frame(stream: String, seq: Int, timestamp: Double, face: FaceFrame) -> String {
        var object: [String: Any] = ["type": "frame", "stream": stream, "seq": seq, "t": timestamp, "tracked": face.tracked]
        if face.tracked {
            let finite = { (value: Double) in value.isFinite ? value : 0 }
            object["yaw"] = finite(face.yaw)
            object["pitch"] = finite(face.pitch)
            object["roll"] = finite(face.roll)
            object["eyeLeft"] = finite(face.eyeLeft)
            object["eyeRight"] = finite(face.eyeRight)
            object["mouthOpen"] = finite(face.mouthOpen)
            object["mouthSmile"] = finite(face.mouthSmile)
            for (key, value) in face.extras where capabilities.contains(key) { object[key] = finite(value) }
        }
        return encode(object)
    }

    static func state(paused: Bool) -> String {
        encode(["type": "state", "tracking": paused ? "paused" : "running"])
    }

    static func bye() -> String {
        encode(["type": "bye"])
    }
}
