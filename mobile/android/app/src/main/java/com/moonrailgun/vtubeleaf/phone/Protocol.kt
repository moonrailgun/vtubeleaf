package com.moonrailgun.vtubeleaf.phone

import org.json.JSONArray
import org.json.JSONObject

/** Wire protocol version shared with the desktop receiver (src-tauri/src/phone.rs). */
const val PROTOCOL_VERSION = 1

/** Optional channels this engine can provide; the desktop ignores extras that were not declared. */
val CAPABILITIES = listOf("gazeX", "gazeY", "browLeft", "browRight", "mouthX", "cheekPuff")

/** What the desktop's pairing QR code carries. */
data class Pairing(
    val version: Int,
    val addresses: List<String>,
    val port: Int,
    val token: String,
    val fingerprint: String,
    val name: String,
) {
    companion object {
        private val ipv4 = Regex("""\d{1,3}(\.\d{1,3}){3}""")

        /** Null for anything that is not a VTubeLeaf code; another version still parses so it can be explained. */
        fun parse(text: String): Pairing? = runCatching {
            val json = JSONObject(text)
            val list = json.getJSONArray("a")
            Pairing(
                version = json.getInt("v"),
                addresses = List(list.length()) { list.getString(it) }.filter(ipv4::matches).take(8),
                port = json.getInt("p"),
                token = json.getString("t"),
                fingerprint = json.getString("f").lowercase(),
                name = json.optString("n").take(32),
            )
        }.getOrNull()?.takeIf {
            it.port in 1..65535 &&
                it.addresses.isNotEmpty() &&
                it.token.matches(Regex("[0-9a-f]{16,128}")) &&
                it.fingerprint.matches(Regex("[0-9a-f]{64}"))
        }
    }
}

/**
 * One tracking result in the desktop's units: degrees, 0–1 openness, user's own left and right.
 * [extras] holds declared optional channels only.
 */
data class FaceFrame(
    val tracked: Boolean,
    val yaw: Float = 0f,
    val pitch: Float = 0f,
    val roll: Float = 0f,
    val eyeLeft: Float = 1f,
    val eyeRight: Float = 1f,
    val mouthOpen: Float = 0f,
    val mouthSmile: Float = 0f,
    val extras: Map<String, Float> = emptyMap(),
)

object Messages {
    fun hello(token: String?, session: String?, device: String, engine: String): String =
        JSONObject().apply {
            put("type", "hello")
            put("version", PROTOCOL_VERSION)
            if (session != null) put("session", session) else put("token", token ?: "")
            put("device", device)
            put("engine", engine)
            put("capabilities", JSONArray(CAPABILITIES))
        }.toString()

    fun frame(stream: String, seq: Long, timestampMs: Double, face: FaceFrame): String =
        JSONObject().apply {
            put("type", "frame")
            put("stream", stream)
            put("seq", seq)
            put("t", timestampMs)
            put("tracked", face.tracked)
            if (face.tracked) {
                put("yaw", face.yaw.toDouble())
                put("pitch", face.pitch.toDouble())
                put("roll", face.roll.toDouble())
                put("eyeLeft", face.eyeLeft.toDouble())
                put("eyeRight", face.eyeRight.toDouble())
                put("mouthOpen", face.mouthOpen.toDouble())
                put("mouthSmile", face.mouthSmile.toDouble())
                for ((key, value) in face.extras) if (key in CAPABILITIES) put(key, value.toDouble())
            }
        }.toString()

    fun state(paused: Boolean): String =
        JSONObject().put("type", "state").put("tracking", if (paused) "paused" else "running").toString()

    fun bye(): String = JSONObject().put("type", "bye").toString()
}
