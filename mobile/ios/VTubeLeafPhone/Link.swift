import CryptoKit
import Foundation

enum EndReason: Equatable {
    case busy, token, session, version, rejected, disconnected, unreachable, identity, lost
}

enum LinkState: Equatable {
    case idle
    case connecting(name: String)
    case connected(name: String)
    case reconnecting(name: String)
    case ended(EndReason)
}

/// One TLS WebSocket to the desktop, trusting exactly the certificate whose SHA-256 the pairing
/// code carried. Pairing spends the code's one-time token; afterwards the session secret from
/// `welcome` lets this phone come back within `reconnectWindow` without scanning again.
final class DesktopLink: NSObject, ObservableObject, URLSessionDelegate, URLSessionWebSocketDelegate {
    static let reconnectWindow: TimeInterval = 30
    static let retryDelay: TimeInterval = 1

    @Published private(set) var state: LinkState = .idle
    /// A new id per connection, so frames of a dead connection can never be mistaken for fresh ones.
    private(set) var stream = ""
    private var seq = 0
    private var pairing: Pairing?
    private var session: String?
    private var urlSession: URLSession?
    private var task: URLSessionWebSocketTask?
    private var opened = false
    private var identityFailed = false
    private var attempt = 0
    private var lostAt: TimeInterval = 0
    private var generation = 0
    private var sending = false
    private var pendingFrame: String?
    private let device: String
    private let engine: String

    init(device: String, engine: String) {
        self.device = device
        self.engine = engine
    }

    private var name: String { pairing?.name ?? "" }

    func connect(_ pairing: Pairing) {
        close()
        urlSession?.invalidateAndCancel()
        self.pairing = pairing
        attempt = 0
        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        urlSession = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
        state = .connecting(name: pairing.name)
        open()
    }

    private func open() {
        guard let pairing, let urlSession else { return }
        generation += 1
        let generation = self.generation
        let address = pairing.addresses[attempt % pairing.addresses.count]
        guard let url = URL(string: "wss://\(address):\(pairing.port)/") else { return end(.unreachable) }
        let task = urlSession.webSocketTask(with: url)
        task.maximumMessageSize = 4096
        self.task = task
        opened = false
        task.resume()
        receive(task, generation)
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) { [weak self] in
            guard let self, self.generation == generation, !self.opened else { return }
            task.cancel()
            self.failed(URLError(.timedOut))
        }
    }

    private func receive(_ task: URLSessionWebSocketTask, _ generation: Int) {
        task.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, self.generation == generation else { return }
                switch result {
                case .success(.string(let text)):
                    self.handle(text)
                    self.receive(task, generation)
                case .success:
                    self.receive(task, generation)
                case .failure(let error):
                    self.failed(error)
                }
            }
        }
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return }
        switch json["type"] as? String {
        case "welcome":
            guard let secret = json["session"] as? String, !secret.isEmpty else { return end(.rejected) }
            session = secret
            stream = UUID().uuidString
            seq = 0
            lostAt = 0
            state = .connected(name: (json["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? name)
        case "reject":
            switch json["reason"] as? String {
            case "busy": end(.busy)
            case "token": end(.token)
            case "session": end(.session)
            case "version": end(.version)
            default: end(.rejected)
            }
        case "bye":
            end((json["reason"] as? String) == "disconnected" ? .disconnected : .rejected)
        default:
            break
        }
    }

    // MARK: URLSession delegates

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard webSocketTask === task else { return }
        opened = true
        let resume = self.session
        sendControl(Messages.hello(token: resume == nil ? pairing?.token : nil, session: resume, device: device, engine: engine))
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        guard webSocketTask === task else { return }
        dropped()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard task === self.task else { return }
        if let error { failed(error) } else { dropped() }
    }

    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust,
              let pairing,
              let leaf = (SecTrustCopyCertificateChain(trust) as? [SecCertificate])?.first
        else { return completionHandler(.cancelAuthenticationChallenge, nil) }
        let digest = SHA256.hash(data: SecCertificateCopyData(leaf) as Data).map { String(format: "%02x", $0) }.joined()
        if digest == pairing.fingerprint {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            identityFailed = true
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    // MARK: Failure handling

    private func failed(_ error: Error) {
        guard task != nil else { return }
        task = nil
        opened = false
        if session != nil { return dropped() }
        guard let pairing else { return }
        if identityFailed {
            identityFailed = false
            return end(.identity)
        }
        attempt += 1
        if attempt < pairing.addresses.count { open() } else { end(.unreachable) }
    }

    /// Keeps the session and retries each second for 30 s; the desktop takes the same secret back.
    private func dropped() {
        task = nil
        opened = false
        guard session != nil else { return }
        switch state {
        case .connected, .reconnecting: break
        default: return
        }
        let now = ProcessInfo.processInfo.systemUptime
        if lostAt == 0 {
            lostAt = now
            state = .reconnecting(name: name)
        }
        if now - lostAt > Self.reconnectWindow { return end(.lost) }
        attempt += 1
        let generation = self.generation
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.retryDelay) { [weak self] in
            guard let self, self.generation == generation, self.task == nil else { return }
            self.open()
        }
    }

    private func end(_ reason: EndReason) {
        close()
        state = .ended(reason)
    }

    private func close() {
        generation += 1
        task?.cancel(with: .normalClosure, reason: nil)
        task = nil
        opened = false
        session = nil
        lostAt = 0
        sending = false
        pendingFrame = nil
    }

    /// The user's own disconnect: tells the desktop, which drops the session and shows a new code.
    func disconnect() {
        if task != nil { sendControl(Messages.bye()) }
        close()
        state = .idle
    }

    func sendState(paused: Bool) {
        sendControl(Messages.state(paused: paused))
    }

    private func sendControl(_ text: String) {
        task?.send(.string(text)) { _ in }
    }

    /// One frame in flight and one waiting: a newer frame replaces the waiting one, never queues behind it.
    func sendFrame(_ face: FaceFrame, timestamp: Double) {
        guard case .connected = state, task != nil else { return }
        seq += 1
        let text = Messages.frame(stream: stream, seq: seq, timestamp: timestamp, face: face)
        if sending { pendingFrame = text } else { push(text) }
    }

    private func push(_ text: String) {
        guard let task else { return }
        sending = true
        task.send(.string(text)) { [weak self] _ in
            DispatchQueue.main.async {
                guard let self else { return }
                self.sending = false
                if let next = self.pendingFrame {
                    self.pendingFrame = nil
                    self.push(next)
                }
            }
        }
    }
}
