package com.moonrailgun.vtubeleaf.phone

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

sealed class LinkState {
    data object Idle : LinkState()
    data class Connecting(val name: String) : LinkState()
    data class Connected(val name: String) : LinkState()
    data class Reconnecting(val name: String) : LinkState()
    data class Ended(val reason: EndReason) : LinkState()
}

enum class EndReason { BUSY, TOKEN, SESSION, VERSION, REJECTED, DISCONNECTED, UNREACHABLE, IDENTITY, LOST }

/** Trusts exactly the certificate whose SHA-256 the pairing code carried, and nothing else. */
private class PinnedTrust(fingerprintHex: String) : X509TrustManager {
    private val expected = fingerprintHex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()

    override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {
        throw CertificateException("client certificates are not used")
    }

    override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {
        val leaf = chain.firstOrNull() ?: throw CertificateException("empty certificate chain")
        val digest = MessageDigest.getInstance("SHA-256").digest(leaf.encoded)
        if (!MessageDigest.isEqual(digest, expected)) throw CertificateException("fingerprint mismatch")
    }

    override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
}

/**
 * One TLS WebSocket to the desktop. Pairing spends the code's one-time token; afterwards the session
 * secret from `welcome` lets this phone come back within [RECONNECT_WINDOW_MS] without scanning.
 */
class DesktopLink(private val device: String, private val engine: String) {
    private val _state = MutableStateFlow<LinkState>(LinkState.Idle)
    val state: StateFlow<LinkState> = _state

    /** A new id per connection, so frames of a dead connection can never be mistaken for fresh ones. */
    @Volatile private var stream = ""
    @Volatile private var seq = 0L
    @Volatile private var socket: WebSocket? = null
    private var pairing: Pairing? = null
    private var session: String? = null
    private var client: OkHttpClient? = null
    private var attempt = 0
    private var lostAt = 0L
    private var generation = 0
    private val main = Handler(Looper.getMainLooper())
    private val name get() = pairing?.name ?: ""

    fun connect(pairing: Pairing) {
        close()
        this.pairing = pairing
        attempt = 0
        val trust = PinnedTrust(pairing.fingerprint)
        val tls = SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), SecureRandom()) }
        client = OkHttpClient.Builder()
            .sslSocketFactory(tls.socketFactory, trust)
            // The pin replaces host-name checks: the desktop has no DNS name, only its fingerprint.
            .hostnameVerifier { _, _ -> true }
            .connectTimeout(4, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.SECONDS)
            .pingInterval(5, TimeUnit.SECONDS)
            .build()
        _state.value = LinkState.Connecting(pairing.name)
        open()
    }

    private fun open() {
        val pairing = pairing ?: return
        val client = client ?: return
        val generation = ++this.generation
        val address = pairing.addresses[attempt % pairing.addresses.size]
        val request = Request.Builder().url("wss://$address:${pairing.port}/").build()
        client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                val resume = session
                webSocket.send(Messages.hello(pairing.token.takeIf { resume == null }, resume, device, engine))
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                main.post { if (generation == this@DesktopLink.generation) receive(webSocket, text) }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                main.post { if (generation == this@DesktopLink.generation) failed(t) }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                main.post { if (generation == this@DesktopLink.generation) dropped() }
            }
        })
    }

    private fun receive(webSocket: WebSocket, text: String) {
        val json = runCatching { JSONObject(text) }.getOrNull() ?: return
        when (json.optString("type")) {
            "welcome" -> {
                val secret = json.optString("session")
                if (secret.isEmpty()) return end(EndReason.REJECTED)
                session = secret
                stream = UUID.randomUUID().toString()
                seq = 0
                lostAt = 0
                socket = webSocket
                _state.value = LinkState.Connected(json.optString("name").ifEmpty { name })
            }
            "reject" -> end(
                when (json.optString("reason")) {
                    "busy" -> EndReason.BUSY
                    "token" -> EndReason.TOKEN
                    "session" -> EndReason.SESSION
                    "version" -> EndReason.VERSION
                    else -> EndReason.REJECTED
                },
            )
            "bye" -> end(
                if (json.optString("reason") == "disconnected") EndReason.DISCONNECTED else EndReason.REJECTED,
            )
        }
    }

    private fun failed(error: Throwable) {
        socket = null
        if (session != null) return dropped()
        val pairing = pairing ?: return
        val identity = generateSequence(error) { it.cause }.any { it is CertificateException }
        when {
            identity -> end(EndReason.IDENTITY)
            ++attempt < pairing.addresses.size -> open()
            else -> end(EndReason.UNREACHABLE)
        }
    }

    /** Keeps the session and retries each second for 30 s; the desktop takes the same secret back. */
    private fun dropped() {
        socket = null
        if (session == null) return
        val current = _state.value
        if (current !is LinkState.Connected && current !is LinkState.Reconnecting) return
        val now = SystemClock.elapsedRealtime()
        if (lostAt == 0L) {
            lostAt = now
            _state.value = LinkState.Reconnecting(name)
        }
        if (now - lostAt > RECONNECT_WINDOW_MS) return end(EndReason.LOST)
        attempt++
        val generation = this.generation
        main.postDelayed({ if (generation == this.generation && socket == null) open() }, RETRY_DELAY_MS)
    }

    private fun end(reason: EndReason) {
        close()
        _state.value = LinkState.Ended(reason)
    }

    private fun close() {
        generation++
        main.removeCallbacksAndMessages(null)
        socket?.close(1000, null)
        socket = null
        session = null
        lostAt = 0
    }

    /** The user's own disconnect: tells the desktop, which drops the session and shows a new code. */
    fun disconnect() {
        socket?.send(Messages.bye())
        close()
        _state.value = LinkState.Idle
    }

    fun sendState(paused: Boolean) {
        socket?.send(Messages.state(paused))
    }

    fun sendFrame(face: FaceFrame, timestampMs: Double) {
        val socket = socket ?: return
        if (_state.value !is LinkState.Connected) return
        // ponytail: OkHttp queues whole messages; dropping new frames while a few are still pending keeps
        // motion fresh instead of replaying a backlog. A single-slot sender would be the upgrade.
        if (socket.queueSize() > MAX_PENDING_BYTES) return
        socket.send(Messages.frame(stream, ++seq, timestampMs, face))
    }

    companion object {
        const val RECONNECT_WINDOW_MS = 30_000L
        const val RETRY_DELAY_MS = 1_000L
        const val MAX_PENDING_BYTES = 1_024L
    }
}
