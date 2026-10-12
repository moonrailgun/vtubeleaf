package com.moonrailgun.vtubeleaf.phone

import kotlin.math.cos
import kotlin.math.sin
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Fixed inputs shared in spirit with the desktop's src/state.ts tests: same signs, same left/right. */
class MappingTest {
    private val identity = floatArrayOf(1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f, 1f)
    private fun scores(vararg pairs: Pair<String, Float>) = pairs.toMap().let { map -> { name: String -> map[name] ?: 0f } }
    private fun radians(degrees: Double) = degrees * Math.PI / 180

    @Test
    fun neutralMatrixKeepsAnglesAtZeroAndEyesOpen() {
        val face = faceFromMediaPipe(scores("eyeBlinkLeft" to 0.81f, "eyeBlinkRight" to 0.2f, "jawOpen" to 1f), identity)!!
        assertEquals(0f, face.yaw, 1e-5f)
        assertEquals(0f, face.pitch, 1e-5f)
        assertEquals(0f, face.roll, 1e-5f)
        assertEquals(0.19f, face.eyeLeft, 1e-5f)
        assertEquals(0.8f, face.eyeRight, 1e-5f)
        assertEquals(1f, face.mouthOpen, 0f)
        assertEquals(0f, face.extras.getValue("gazeX"), 0f)
    }

    @Test
    fun headTurnToTheUsersLeftIsPositiveYaw() {
        // Rotation about camera +Y: the nose swings toward +X, the user's own left.
        val theta = radians(20.0)
        val m = identity.copyOf()
        m[0] = cos(theta).toFloat(); m[2] = -sin(theta).toFloat()
        m[8] = sin(theta).toFloat(); m[10] = cos(theta).toFloat()
        assertEquals(20f, faceFromMediaPipe(scores(), m)!!.yaw, 1e-3f)
    }

    @Test
    fun lookingDownIsNegativePitchAndRightTiltIsNegativeRoll() {
        val phi = radians(15.0)
        val down = identity.copyOf()
        down[5] = cos(phi).toFloat(); down[6] = sin(phi).toFloat()
        down[9] = -sin(phi).toFloat(); down[10] = cos(phi).toFloat()
        assertEquals(-15f, faceFromMediaPipe(scores(), down)!!.pitch, 1e-3f)
        val psi = radians(10.0)
        val tilt = identity.copyOf()
        tilt[0] = cos(psi).toFloat(); tilt[1] = sin(psi).toFloat()
        tilt[4] = -sin(psi).toFloat(); tilt[5] = cos(psi).toFloat()
        assertEquals(-10f, faceFromMediaPipe(scores(), tilt)!!.roll, 1e-3f)
    }

    @Test
    fun invalidMatricesAndWildScoresAreContained() {
        assertNull(faceFromMediaPipe(scores(), floatArrayOf(1f, 2f)))
        assertNull(faceFromMediaPipe(scores(), identity.copyOf().also { it[5] = Float.NaN }))
        val face = faceFromMediaPipe(scores("jawOpen" to 7f, "browInnerUp" to 1f, "browOuterUpLeft" to 1f, "mouthLeft" to Float.NaN), identity)!!
        assertEquals(1f, face.mouthOpen, 0f)
        assertEquals(1f, face.extras.getValue("browLeft"), 0f)
        assertEquals(0f, face.extras.getValue("mouthX"), 0f)
    }
}
