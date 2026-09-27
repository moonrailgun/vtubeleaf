import AppKit

final class TrackerProcess {
    let executable: URL
    private var process: Process?
    var onExit: ((Int32, String) -> Void)?
    var isRunning: Bool { process != nil }

    init(executable: URL) { self.executable = executable }

    static func arguments(camera: String, port: String) throws -> [String] {
        guard let camera = Int(camera.trimmingCharacters(in: .whitespacesAndNewlines)),
              (0...32).contains(camera),
              let port = Int(port.trimmingCharacters(in: .whitespacesAndNewlines)),
              (1024...65535).contains(port) else {
            throw NSError(domain: "OpenSeeFace", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "摄像头编号须为 0–32，UDP 端口须为 1024–65535。"
            ])
        }
        return ["--ip", "127.0.0.1", "--port", String(port), "--capture", String(camera),
                "--faces", "1", "-F", "24", "-W", "640", "-H", "360",
                "--gaze-tracking", "0", "--visualize", "0", "--silent", "1"]
    }

    func start(camera: String, port: String) throws {
        guard process == nil else {
            throw NSError(domain: "OpenSeeFace", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "请先停止当前追踪。"
            ])
        }
        let child = Process()
        child.arguments = try Self.arguments(camera: camera, port: port)
        child.executableURL = executable
        child.currentDirectoryURL = executable.deletingLastPathComponent()
        child.standardInput = FileHandle.nullDevice
        let output = Pipe()
        child.standardOutput = output
        child.standardError = output
        try child.run()
        process = child
        // Drain continuously so tracker output cannot fill the pipe and stall tracking.
        DispatchQueue.global(qos: .utility).async {
            var tail = Data()
            while true {
                let data = output.fileHandleForReading.availableData
                if data.isEmpty { break }
                tail.append(data)
                if tail.count > 8192 { tail.removeFirst(tail.count - 8192) }
            }
            child.waitUntilExit()
            let message = String(decoding: tail, as: UTF8.self)
            DispatchQueue.main.async {
                self.process = nil
                self.onExit?(child.terminationStatus, message)
            }
        }
    }

    func stop() {
        guard let child = process, child.isRunning else { return }
        child.interrupt()
        // A camera driver can stall during shutdown. Keep the UI responsive and reap it.
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            if child.isRunning { child.terminate() }
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            if child.isRunning { kill(child.processIdentifier, SIGKILL) }
        }
    }
}

final class LauncherDelegate: NSObject, NSApplicationDelegate {
    private let tracker = TrackerProcess(executable: Bundle.main.bundleURL
        .appendingPathComponent("Contents/Resources/OpenSeeFace/facetracker"))
    private var window: NSWindow!
    private let camera = NSTextField(string: "0")
    private let port = NSTextField(string: "11573")
    private let status = NSTextField(wrappingLabelWithString: "准备就绪")
    private let button = NSButton(title: "开始追踪", target: nil, action: nil)
    private var stopping = false
    private var quitting = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appMenu = NSMenu()
        let item = NSMenuItem()
        item.submenu = appMenu
        menu.addItem(item)
        appMenu.addItem(withTitle: "退出 OpenSeeFace", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        NSApp.mainMenu = menu

        makeWindow().makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func makeWindow() -> NSWindow {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 440, height: 280),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "VTubeLeaf OpenSeeFace"
        window.isReleasedWhenClosed = false
        let content = NSStackView()
        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 16
        content.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 24),
            content.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -24),
            content.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 24),
        ])
        let title = NSTextField(labelWithString: "OpenSeeFace 面部追踪")
        title.font = .boldSystemFont(ofSize: 20)
        content.addArrangedSubview(title)
        let hint = NSTextField(wrappingLabelWithString: "启动后，在 VTubeLeaf 中选择 OpenSeeFace，再点击「开始跟踪」。")
        hint.textColor = .secondaryLabelColor
        content.addArrangedSubview(hint)
        hint.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true
        for (label, field) in [("摄像头编号", camera), ("UDP 端口", port)] {
            field.setAccessibilityLabel(label)
            field.widthAnchor.constraint(equalToConstant: 110).isActive = true
            let text = NSTextField(labelWithString: label)
            text.widthAnchor.constraint(equalToConstant: 90).isActive = true
            let row = NSStackView(views: [text, field])
            row.spacing = 12
            content.addArrangedSubview(row)
        }
        status.textColor = .secondaryLabelColor
        content.addArrangedSubview(status)
        status.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true
        button.target = self
        button.action = #selector(toggleTracking)
        button.bezelStyle = .rounded
        button.keyEquivalent = "\r"
        content.addArrangedSubview(button)
        tracker.onExit = { [weak self] code, output in
            guard let self else { return }
            if self.quitting {
                NSApp.terminate(nil)
                return
            }
            self.camera.isEnabled = true
            self.port.isEnabled = true
            self.button.title = "开始追踪"
            self.button.isEnabled = true
            self.status.stringValue = self.stopping ? "已停止，摄像头已释放" : "追踪已退出"
            if !self.stopping {
                self.showError("追踪已退出（\(code)）。请检查摄像头权限、编号及设备是否被占用。\n\n\(output)")
            }
            self.stopping = false
        }
        window.center()
        return window
    }

    @objc private func toggleTracking() {
        if tracker.isRunning {
            stopping = true
            button.isEnabled = false
            status.stringValue = "正在停止…"
            tracker.stop()
            return
        }
        do {
            try tracker.start(camera: camera.stringValue, port: port.stringValue)
            camera.isEnabled = false
            port.isEnabled = false
            button.title = "停止追踪"
            status.stringValue = "追踪进程已启动 · 127.0.0.1:\(port.stringValue)"
        } catch {
            showError(error.localizedDescription)
        }
    }

    private func showError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "OpenSeeFace 无法继续运行"
        alert.informativeText = String(message.suffix(2000))
        alert.beginSheetModal(for: window)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard tracker.isRunning else { return .terminateNow }
        quitting = true
        tracker.stop()
        // Keep the normal event loop running for shutdown timers and onExit.
        // terminateLater enters a modal loop that does not service the main queue.
        return .terminateCancel
    }
}

#if !TESTING
@main
struct Launcher {
    static func main() {
        let app = NSApplication.shared
        let delegate = LauncherDelegate()
        app.setActivationPolicy(.regular)
        app.delegate = delegate
        app.run()
        withExtendedLifetime(delegate) {}
    }
}
#endif
