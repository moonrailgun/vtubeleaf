import ARKit
import XCTest
@testable import VTubeLeafPhone

/// Fixed inputs shared in spirit with the desktop's src/state.ts tests: same signs, same left/right.
final class MappingTests: XCTestCase {
    private func scores(_ values: [ARFaceAnchor.BlendShapeLocation: Double]) -> (ARFaceAnchor.BlendShapeLocation) -> Double {
        { values[$0] ?? 0 }
    }

    func testNeutralPoseKeepsAnglesAtZeroAndEyesOpen() {
        let face = faceFromARKit(transform: matrix_identity_float4x4, view: matrix_identity_float4x4,
                                 score: scores([.eyeBlinkLeft: 0.81, .eyeBlinkRight: 0.2, .jawOpen: 1]))
        XCTAssertEqual(face.yaw, 0, accuracy: 1e-5)
        XCTAssertEqual(face.pitch, 0, accuracy: 1e-5)
        XCTAssertEqual(face.roll, 0, accuracy: 1e-5)
        XCTAssertEqual(face.eyeLeft, 0.19, accuracy: 1e-5)
        XCTAssertEqual(face.eyeRight, 0.8, accuracy: 1e-5)
        XCTAssertEqual(face.mouthOpen, 1)
        XCTAssertEqual(face.extras["gazeX"], 0)
    }

    func testHeadTurnToTheUsersLeftIsPositiveYaw() {
        // Rotation about camera +Y: the nose swings toward +X, the user's own left.
        let theta = Float(20 * Double.pi / 180)
        let turn = simd_float4x4(simd_quatf(angle: theta, axis: SIMD3(0, 1, 0)))
        XCTAssertEqual(faceFromARKit(transform: turn, view: matrix_identity_float4x4, score: scores([:])).yaw, 20, accuracy: 1e-3)
        // The view matrix undoes the camera pose: a face turned with the camera reads as straight.
        XCTAssertEqual(faceFromARKit(transform: turn, view: turn.inverse, score: scores([:])).yaw, 0, accuracy: 1e-3)
    }

    func testLookingDownIsNegativePitchAndRightTiltIsNegativeRoll() {
        let down = simd_float4x4(simd_quatf(angle: Float(15 * Double.pi / 180), axis: SIMD3(1, 0, 0)))
        XCTAssertEqual(faceFromARKit(transform: down, view: matrix_identity_float4x4, score: scores([:])).pitch, -15, accuracy: 1e-3)
        let tilt = simd_float4x4(simd_quatf(angle: Float(10 * Double.pi / 180), axis: SIMD3(0, 0, 1)))
        XCTAssertEqual(faceFromARKit(transform: tilt, view: matrix_identity_float4x4, score: scores([:])).roll, -10, accuracy: 1e-3)
    }

    func testWildScoresAreContained() {
        let face = faceFromARKit(transform: matrix_identity_float4x4, view: matrix_identity_float4x4,
                                 score: scores([.jawOpen: 7, .browInnerUp: 1, .browOuterUpLeft: 1, .mouthLeft: .nan]))
        XCTAssertEqual(face.mouthOpen, 1)
        XCTAssertEqual(face.extras["browLeft"], 1)
        XCTAssertEqual(face.extras["mouthX"], 0)
    }
}
