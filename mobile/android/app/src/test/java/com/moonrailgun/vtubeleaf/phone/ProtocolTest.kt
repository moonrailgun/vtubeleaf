package com.moonrailgun.vtubeleaf.phone

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
    private val token = "0123456789abcdef0123456789abcdef0123456789abcdef"
    private val fingerprint = "f".repeat(64)
    private val code = """{"v":1,"a":["192.168.1.20","10.0.0.5","nope"],"p":51234,"t":"$token","f":"$fingerprint","n":"Studio Mac"}"""

    @Test
    fun pairingCodeParsesAndRejectsJunk() {
        val pairing = Pairing.parse(code)!!
        assertEquals(1, pairing.version)
        assertEquals(listOf("192.168.1.20", "10.0.0.5"), pairing.addresses)
        assertEquals(51234, pairing.port)
        assertEquals("Studio Mac", pairing.name)
        assertEquals(2, Pairing.parse(code.replace("\"v\":1", "\"v\":2"))!!.version)
        assertNull(Pairing.parse("https://example.com"))
        assertNull(Pairing.parse(code.replace(fingerprint, "zz")))
        assertNull(Pairing.parse(code.replace("51234", "70000")))
        assertNull(Pairing.parse(code.replace("\"192.168.1.20\",\"10.0.0.5\",", "")))
    }

    @Test
    fun helloSpendsTheTokenOrResumesTheSession() {
        val pairing = JSONObject(Messages.hello(token, null, "Pixel", "mediapipe"))
        assertEquals("hello", pairing.getString("type"))
        assertEquals(PROTOCOL_VERSION, pairing.getInt("version"))
        assertEquals(token, pairing.getString("token"))
        assertFalse(pairing.has("session"))
        assertEquals(CAPABILITIES.size, pairing.getJSONArray("capabilities").length())
        val resume = JSONObject(Messages.hello(token, "secret", "Pixel", "mediapipe"))
        assertEquals("secret", resume.getString("session"))
        assertFalse(resume.has("token"))
    }

    @Test
    fun framesCarryOrderingAndOnlyDeclaredExtras() {
        val face = FaceFrame(true, yaw = 12.5f, eyeRight = 0.3f, extras = mapOf("browLeft" to 0.4f, "tongueOut" to 1f))
        val frame = JSONObject(Messages.frame("s1", 7, 1234.5, face))
        assertEquals("s1", frame.getString("stream"))
        assertEquals(7, frame.getLong("seq"))
        assertTrue(frame.getBoolean("tracked"))
        assertEquals(12.5, frame.getDouble("yaw"), 1e-6)
        assertEquals(0.3, frame.getDouble("eyeRight"), 1e-6)
        assertEquals(0.4, frame.getDouble("browLeft"), 1e-6)
        assertFalse(frame.has("tongueOut"))
        val lost = JSONObject(Messages.frame("s1", 8, 1267.8, FaceFrame(tracked = false)))
        assertFalse(lost.getBoolean("tracked"))
        assertFalse(lost.has("yaw"))
        assertEquals("paused", JSONObject(Messages.state(true)).getString("tracking"))
    }
}
