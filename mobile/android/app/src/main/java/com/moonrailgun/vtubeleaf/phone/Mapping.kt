package com.moonrailgun.vtubeleaf.phone

import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.atan2

/**
 * MediaPipe Face Landmarker → desktop face values, with the same formulas as `fromMediaPipe` in
 * the desktop's src/state.ts so both engines mean the same thing by yaw, pitch, roll and left/right.
 * [matrix] is the column-major 4×4 facial transformation matrix of an upright, un-mirrored image.
 */
fun faceFromMediaPipe(score: (String) -> Float, matrix: FloatArray): FaceFrame? {
    if (matrix.size != 16 || matrix.any { !it.isFinite() }) return null
    val s = { name: String -> score(name).let { if (it.isFinite()) it.coerceIn(0f, 1f) else 0f } }
    val degrees = (180.0 / PI).toFloat()
    return FaceFrame(
        tracked = true,
        yaw = asin((-matrix[2]).coerceIn(-1f, 1f)) * degrees,
        // Positive pitch looks up; MediaPipe's X rotation is the opposite.
        pitch = -atan2(matrix[6], matrix[10]) * degrees,
        // Camera +Y points up; a screen-right tilt is positive roll.
        roll = -atan2(matrix[1], matrix[0]) * degrees,
        eyeLeft = 1f - s("eyeBlinkLeft"),
        eyeRight = 1f - s("eyeBlinkRight"),
        mouthOpen = s("jawOpen"),
        mouthSmile = (s("mouthSmileLeft") + s("mouthSmileRight")) / 2f,
        extras = mapOf(
            "gazeX" to (s("eyeLookOutLeft") - s("eyeLookInLeft") + s("eyeLookInRight") - s("eyeLookOutRight")) / 2f,
            "gazeY" to (s("eyeLookUpLeft") + s("eyeLookUpRight") - s("eyeLookDownLeft") - s("eyeLookDownRight")) / 2f,
            "browLeft" to (s("browInnerUp") + s("browOuterUpLeft") - s("browDownLeft")).coerceIn(-1f, 1f),
            "browRight" to (s("browInnerUp") + s("browOuterUpRight") - s("browDownRight")).coerceIn(-1f, 1f),
            "mouthX" to s("mouthRight") - s("mouthLeft"),
            "cheekPuff" to s("cheekPuff"),
        ),
    )
}
