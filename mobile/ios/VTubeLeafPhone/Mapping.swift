import ARKit
import simd

/// ARKit face anchor → desktop face values, with the same formulas as `fromMediaPipe` in the
/// desktop's src/state.ts applied to the face pose in display-oriented camera space, so both
/// engines mean the same thing by yaw, pitch, roll and left/right.
///
/// - Parameters:
///   - transform: the face anchor's world transform.
///   - view: `ARCamera.viewMatrix(for: .portrait)`, world → camera with x right, y up, z toward the user.
///   - score: blend shape coefficients, 0–1, named from the user's own perspective like MediaPipe's.
func faceFromARKit(
    transform: simd_float4x4,
    view: simd_float4x4,
    score: (ARFaceAnchor.BlendShapeLocation) -> Double
) -> FaceFrame {
    let face = view * transform
    let c0 = face.columns.0, c1 = face.columns.1, c2 = face.columns.2
    let degrees = 180 / Double.pi
    func s(_ name: ARFaceAnchor.BlendShapeLocation) -> Double {
        let value = score(name)
        return value.isFinite ? min(max(value, 0), 1) : 0
    }
    return FaceFrame(
        tracked: true,
        // Column-major like MediaPipe's matrix: m[2] = c0.z, m[6] = c1.z, m[10] = c2.z, m[1] = c0.y, m[0] = c0.x.
        yaw: asin(min(max(Double(-c0.z), -1), 1)) * degrees,
        // Positive pitch looks up; the camera-space X rotation is the opposite.
        pitch: -atan2(Double(c1.z), Double(c2.z)) * degrees,
        // Camera +Y points up; a screen-right tilt is positive roll.
        roll: -atan2(Double(c0.y), Double(c0.x)) * degrees,
        eyeLeft: 1 - s(.eyeBlinkLeft),
        eyeRight: 1 - s(.eyeBlinkRight),
        mouthOpen: s(.jawOpen),
        mouthSmile: (s(.mouthSmileLeft) + s(.mouthSmileRight)) / 2,
        extras: [
            "gazeX": (s(.eyeLookOutLeft) - s(.eyeLookInLeft) + s(.eyeLookInRight) - s(.eyeLookOutRight)) / 2,
            "gazeY": (s(.eyeLookUpLeft) + s(.eyeLookUpRight) - s(.eyeLookDownLeft) - s(.eyeLookDownRight)) / 2,
            "browLeft": min(max(s(.browInnerUp) + s(.browOuterUpLeft) - s(.browDownLeft), -1), 1),
            "browRight": min(max(s(.browInnerUp) + s(.browOuterUpRight) - s(.browDownRight), -1), 1),
            "mouthX": s(.mouthRight) - s(.mouthLeft),
            "cheekPuff": s(.cheekPuff),
            "tongueOut": s(.tongueOut),
        ]
    )
}
