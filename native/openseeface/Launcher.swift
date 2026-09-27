import AppKit
import AVFoundation

// Shared with the desktop form controls in src/style.css and src/components/ui.
private enum LauncherStyle {
    static func color(_ hex: Int) -> NSColor {
        NSColor(srgbRed: CGFloat((hex >> 16) & 255) / 255,
                green: CGFloat((hex >> 8) & 255) / 255,
                blue: CGFloat(hex & 255) / 255, alpha: 1)
    }

    static let foreground = color(0x423e4a)
    static let muted = color(0x77717e)
    static let primary = color(0xd34477)

    static func field(_ frame: NSRect, focused: Bool, enabled: Bool, fill: NSColor = color(0xfcfafd)) {
        // Leave room for the same 3pt focus ring used by the main application's inputs.
        let outline = NSBezierPath(roundedRect: frame.insetBy(dx: 3, dy: 3), xRadius: 10, yRadius: 10)
        fill.withAlphaComponent(enabled ? 1 : 0.5).setFill()
        outline.fill()
        if focused && enabled {
            primary.withAlphaComponent(0.5).setStroke()
            outline.lineWidth = 6
            outline.stroke()
            fill.setFill()
            outline.fill()
        }
        (focused && enabled ? primary : color(0xe5d8e1)).withAlphaComponent(enabled ? 1 : 0.5).setStroke()
        outline.lineWidth = 1
        outline.stroke()
    }

    static func title(_ title: String, in frame: NSRect, enabled: Bool, centered: Bool = false) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        paragraph.alignment = centered ? .center : .left
        let text = NSAttributedString(string: title, attributes: [
            .font: NSFont.systemFont(ofSize: 12),
            .foregroundColor: foreground.withAlphaComponent(enabled ? 1 : 0.5),
            .paragraphStyle: paragraph,
        ])
        text.draw(in: NSRect(x: frame.minX, y: frame.midY - text.size().height / 2,
                            width: frame.width, height: text.size().height))
    }
}

private final class CameraButton: NSPopUpButton {
    override var alignmentRectInsets: NSEdgeInsets { NSEdgeInsetsZero }
}

private final class RefreshButton: NSButton {
    override var alignmentRectInsets: NSEdgeInsets { NSEdgeInsetsZero }
}

private final class CameraCell: NSPopUpButtonCell {
    override func draw(withFrame frame: NSRect, in view: NSView) {
        LauncherStyle.field(frame, focused: showsFirstResponder, enabled: isEnabled)
        LauncherStyle.title(title, in: NSRect(x: frame.minX + 15, y: frame.minY,
                                            width: frame.width - 48, height: frame.height), enabled: isEnabled)
        let chevron = NSBezierPath()
        chevron.move(to: NSPoint(x: frame.maxX - 25, y: frame.midY - 2))
        chevron.line(to: NSPoint(x: frame.maxX - 21, y: frame.midY + 2))
        chevron.line(to: NSPoint(x: frame.maxX - 17, y: frame.midY - 2))
        chevron.lineWidth = 1.5
        chevron.lineCapStyle = .round
        chevron.lineJoinStyle = .round
        LauncherStyle.muted.withAlphaComponent(isEnabled ? 0.6 : 0.3).setStroke()
        chevron.stroke()
    }
}

private final class RefreshCell: NSButtonCell {
    override func draw(withFrame frame: NSRect, in view: NSView) {
        LauncherStyle.field(frame, focused: showsFirstResponder, enabled: isEnabled,
                            fill: isHighlighted ? LauncherStyle.color(0xfbeef4) : .white)
        LauncherStyle.title(title, in: frame, enabled: isEnabled, centered: true)
    }
}

private final class PortField: NSTextField {
    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if let editor = currentEditor() as? NSTextView {
            editor.selectedTextAttributes = [.backgroundColor: LauncherStyle.primary, .foregroundColor: NSColor.white]
            editor.insertionPointColor = LauncherStyle.primary
        }
        superview?.needsDisplay = true
        return accepted
    }

    override var isEnabled: Bool {
        didSet { superview?.needsDisplay = true }
    }
}

private final class PortInput: NSView, NSTextFieldDelegate {
    let field: NSTextField

    init(_ field: NSTextField) {
        self.field = field
        super.init(frame: .zero)
        field.isBezeled = false
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 12)
        field.textColor = LauncherStyle.foreground
        field.delegate = self
        field.translatesAutoresizingMaskIntoConstraints = false
        addSubview(field)
        NSLayoutConstraint.activate([
            field.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 15),
            field.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -15),
            field.centerYAnchor.constraint(equalTo: centerYAnchor),
            heightAnchor.constraint(equalToConstant: 46),
            widthAnchor.constraint(equalToConstant: 110),
        ])
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    override func draw(_ dirtyRect: NSRect) {
        LauncherStyle.field(bounds, focused: field.currentEditor() != nil, enabled: field.isEnabled)
    }

    func controlTextDidEndEditing(_ notification: Notification) { needsDisplay = true }

    override func mouseDown(with event: NSEvent) {
        if field.isEnabled { window?.makeFirstResponder(field) }
    }
}

struct CameraDevice {
    let id: String
    let name: String

    static func available() -> [CameraDevice] {
        // Match OpenCV's AVFoundation backend, including muxed devices.
        // https://github.com/opencv/opencv/blob/4.11.0/modules/videoio/src/cap_avfoundation_mac.mm
        (AVCaptureDevice.devices(for: .video) + AVCaptureDevice.devices(for: .muxed))
            .map { CameraDevice(id: $0.uniqueID, name: $0.localizedName) }
    }
}

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
    private let camera = CameraButton(frame: .zero, pullsDown: false)
    private let refresh = RefreshButton(title: "刷新", target: nil, action: nil)
    private let cameraDevices: () -> [CameraDevice]
    private let port = PortField(string: "11573")
    private let status = NSTextField(wrappingLabelWithString: "准备就绪")
    private let button = NSButton(title: "开始追踪", target: nil, action: nil)
    private var stopping = false
    private var quitting = false

    init(cameraDevices: @escaping () -> [CameraDevice] = CameraDevice.available) {
        self.cameraDevices = cameraDevices
        super.init()
    }

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
        let color = LauncherStyle.color
        let foreground = LauncherStyle.foreground
        let muted = LauncherStyle.muted
        let primary = LauncherStyle.primary
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 396),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = "VTubeLeaf OpenSeeFace"
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: .aqua)
        window.backgroundColor = color(0xe5ebdd)
        window.titlebarAppearsTransparent = true
        let panel = NSBox()
        panel.boxType = .custom
        panel.titlePosition = .noTitle
        panel.fillColor = .white
        panel.borderColor = color(0xe9dfe6)
        panel.borderWidth = 1
        panel.cornerRadius = 16
        panel.contentViewMargins = .zero
        panel.translatesAutoresizingMaskIntoConstraints = false
        window.contentView!.addSubview(panel)
        NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: window.contentView!.leadingAnchor, constant: 16),
            panel.trailingAnchor.constraint(equalTo: window.contentView!.trailingAnchor, constant: -16),
            panel.topAnchor.constraint(equalTo: window.contentView!.topAnchor, constant: 16),
            panel.bottomAnchor.constraint(equalTo: window.contentView!.bottomAnchor, constant: -16),
        ])
        let content = NSStackView()
        content.orientation = .vertical
        content.alignment = .leading
        content.spacing = 16
        content.translatesAutoresizingMaskIntoConstraints = false
        panel.contentView!.addSubview(content)
        NSLayoutConstraint.activate([
            content.leadingAnchor.constraint(equalTo: panel.contentView!.leadingAnchor, constant: 24),
            content.trailingAnchor.constraint(equalTo: panel.contentView!.trailingAnchor, constant: -24),
            content.topAnchor.constraint(equalTo: panel.contentView!.topAnchor, constant: 24),
        ])
        let title = NSTextField(labelWithString: "OpenSeeFace 面部追踪")
        title.font = .systemFont(ofSize: 22, weight: .semibold)
        title.textColor = foreground
        content.addArrangedSubview(title)
        let hint = NSTextField(wrappingLabelWithString: "启动后，在 VTubeLeaf 中选择 OpenSeeFace，再点击「开始跟踪」。")
        hint.font = .systemFont(ofSize: 12)
        hint.textColor = muted
        content.addArrangedSubview(hint)
        hint.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true
        camera.cell = CameraCell(textCell: "", pullsDown: false)
        camera.isBordered = false
        camera.focusRingType = .none
        camera.heightAnchor.constraint(equalToConstant: 46).isActive = true
        camera.setAccessibilityLabel("摄像头")
        camera.lineBreakMode = .byTruncatingTail
        camera.toolTip = "选择用于面部追踪的摄像头"
        refresh.cell = RefreshCell(textCell: "刷新")
        refresh.isBordered = false
        refresh.focusRingType = .none
        refresh.heightAnchor.constraint(equalToConstant: 46).isActive = true
        refresh.target = self
        refresh.action = #selector(refreshCameras)
        refresh.setAccessibilityLabel("刷新摄像头列表")
        refresh.toolTip = "刷新摄像头列表"
        let cameraRow = NSStackView(views: [camera, refresh])
        cameraRow.spacing = 8
        camera.setContentHuggingPriority(.defaultLow, for: .horizontal)
        camera.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        camera.widthAnchor.constraint(equalTo: cameraRow.widthAnchor, constant: -72).isActive = true
        refresh.widthAnchor.constraint(equalToConstant: 64).isActive = true
        port.setAccessibilityLabel("UDP 端口")
        let portInput = PortInput(port)
        let portHint = NSTextField(labelWithString: "与 VTubeLeaf 中的端口保持一致")
        portHint.font = .systemFont(ofSize: 11)
        portHint.textColor = muted
        let portRow = NSStackView(views: [portInput, portHint])
        portRow.spacing = 12
        for (label, row) in [("摄像头", cameraRow), ("UDP 端口", portRow)] {
            let text = NSTextField(labelWithString: label)
            text.font = .systemFont(ofSize: 12, weight: .semibold)
            text.textColor = foreground
            let field = NSStackView(views: [text, row])
            field.orientation = .vertical
            field.alignment = .leading
            field.spacing = 8
            content.addArrangedSubview(field)
            field.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true
        }
        cameraRow.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true
        status.font = .systemFont(ofSize: 12)
        status.textColor = muted
        content.addArrangedSubview(status)
        status.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true
        button.target = self
        button.action = #selector(toggleTracking)
        button.isBordered = false
        (button.cell as! NSButtonCell).backgroundColor = primary
        button.contentTintColor = .white
        button.wantsLayer = true
        button.layer?.cornerRadius = 8
        button.layer?.masksToBounds = true
        button.font = .systemFont(ofSize: 14, weight: .semibold)
        button.controlSize = .large
        button.keyEquivalent = "\r"
        content.addArrangedSubview(button)
        button.widthAnchor.constraint(equalTo: content.widthAnchor).isActive = true
        button.heightAnchor.constraint(equalToConstant: 36).isActive = true
        refreshCameras()
        tracker.onExit = { [weak self] code, output in
            guard let self else { return }
            if self.quitting {
                NSApp.terminate(nil)
                return
            }
            self.refresh.isEnabled = true
            self.port.isEnabled = true
            self.button.title = "开始追踪"
            self.button.isEnabled = true
            self.status.stringValue = self.stopping ? "已停止，摄像头已释放" : "追踪已退出"
            self.refreshCameras()
            if !self.stopping {
                self.showError("追踪已退出（\(code)）。请检查摄像头权限、所选设备及设备是否被占用。\n\n\(output)")
            }
            self.stopping = false
        }
        window.center()
        return window
    }

    @objc private func refreshCameras() {
        guard !tracker.isRunning else { return }
        let selected = camera.selectedItem?.representedObject as? String
        camera.removeAllItems()
        // OpenCV sorts by NSString.compare before assigning capture indices. Filter afterwards.
        let devices = cameraDevices().sorted {
            ($0.id as NSString).compare($1.id) == .orderedAscending
        }
        for (index, device) in devices.prefix(33).enumerated()
            where !device.name.lowercased().contains("vtubeleaf camera") {
            let item = NSMenuItem(title: device.name, action: nil, keyEquivalent: "")
            item.tag = index
            item.representedObject = device.id
            camera.menu!.addItem(item)
            if device.id == selected { camera.select(item) }
        }
        let available = camera.numberOfItems > 0
        camera.isEnabled = available
        button.isEnabled = available
        if !available {
            camera.addItem(withTitle: "未找到可用摄像头")
            status.stringValue = "请连接摄像头后刷新；VTubeLeaf Camera 仅用于输出。"
        } else {
            if camera.indexOfSelectedItem < 0 { camera.selectItem(at: 0) }
            if selected == nil { status.stringValue = "准备就绪" }
        }
        camera.toolTip = camera.titleOfSelectedItem
    }

    @objc private func toggleTracking() {
        if tracker.isRunning {
            stopping = true
            button.isEnabled = false
            status.stringValue = "正在停止…"
            tracker.stop()
            return
        }
        let selected = camera.selectedItem?.representedObject as? String
        refreshCameras()
        guard let selected, selected == camera.selectedItem?.representedObject as? String else {
            status.stringValue = "所选摄像头已断开，请重新选择。"
            return
        }
        do {
            try tracker.start(camera: String(camera.selectedTag()), port: port.stringValue)
            camera.isEnabled = false
            refresh.isEnabled = false
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
