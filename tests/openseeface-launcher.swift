import AppKit

// Test failures should report to the terminal, not open macOS Crash Reporter.
func check(_ condition: @autoclosure () -> Bool, _ message: String = "Check failed",
           file: StaticString = #fileID, line: UInt = #line) {
    guard condition() else {
        FileHandle.standardError.write(Data("\(file):\(line): \(message)\n".utf8))
        exit(EXIT_FAILURE)
    }
}

func descendants(_ view: NSView) -> [NSView] {
    view.subviews.flatMap { [$0] + descendants($0) }
}

// Exercise the production quit handler in AppKit's real event loop, without showing UI.
final class QuitCheckDelegate: NSObject, NSApplicationDelegate {
    let launcher = LauncherDelegate(cameraDevices: { [CameraDevice(id: "test", name: "Test camera")] })

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = launcher.makeWindow()
        let button = descendants(window.contentView!).compactMap { $0 as? NSButton }
            .first { $0.keyEquivalent == "\r" }!
        button.performClick(nil)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { NSApp.terminate(nil) }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        launcher.applicationShouldTerminate(sender)
    }
}

@main
struct LauncherChecks {
    static func waitUntil(_ condition: () -> Bool) {
        let deadline = Date().addingTimeInterval(8)
        while !condition() && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.01))
        }
        check(condition(), "Tracker did not finish within 8 seconds")
    }

    static func main() {
        do { try run() }
        catch { check(false, error.localizedDescription) }
    }

    static func run() throws {
        if CommandLine.arguments.contains("--failure-check") {
            check(false, "Expected test failure")
        }
        if CommandLine.arguments.contains("--quit-check") {
            let app = NSApplication.shared
            let delegate = QuitCheckDelegate()
            app.setActivationPolicy(.prohibited)
            app.delegate = delegate
            app.run()
            withExtendedLifetime(delegate) {}
            return
        }
        // Invalid input must never become tracker arguments (or shell commands).
        for (camera, port) in [("-1", "11573"), ("33", "11573"), ("0", "1023"),
                               ("0", "65536"), ("$(touch bad)", "11573")] {
            do {
                _ = try TrackerProcess.arguments(camera: camera, port: port)
                check(false, "Accepted invalid camera or UDP port")
            } catch {}
        }
        let expected = ["--ip", "127.0.0.1", "--port", "12000", "--capture", "2",
                        "--faces", "1", "-F", "24", "-W", "640", "-H", "360",
                        "--gaze-tracking", "0", "--visualize", "0", "--silent", "1"]
        let actual = try TrackerProcess.arguments(camera: " 2 ", port: "12000")
        check(actual == expected)

        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("tracker checks \(UUID())")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let executable = folder.appendingPathComponent("facetracker")
        func script(_ body: String) throws {
            try ("#!/bin/sh\n" + body).write(to: executable, atomically: true, encoding: .utf8)
            try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: executable.path)
        }
        let tracker = TrackerProcess(executable: executable)
        var result: (Int32, String)?
        tracker.onExit = { result = ($0, $1) }

        // Launch a real process in a path containing spaces and preserve its arguments/errors.
        try script("printf '%s\\n' \"$@\"\nprintf 'camera unavailable' >&2\nexit 7\n")
        try tracker.start(camera: "2", port: "12000")
        waitUntil { result != nil }
        check(result!.0 == 7 && result!.1.contains(expected.joined(separator: "\n")))
        check(result!.1.contains("camera unavailable") && !tracker.isRunning)

        // Closing/stopping must also reap a tracker that ignores graceful shutdown.
        result = nil
        try script("trap '' INT TERM\nprintf 'ready'\nwhile :; do :; done\n")
        try tracker.start(camera: "0", port: "11573")
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        do {
            try tracker.start(camera: "0", port: "11573")
            check(false, "Started two trackers")
        } catch {}
        tracker.stop()
        waitUntil { result != nil }
        check(!tracker.isRunning)

        // A subsequent start is usable; a spawn failure must leave no running state.
        result = nil
        try script("exit 0\n")
        try tracker.start(camera: "32", port: "65535")
        waitUntil { result != nil }
        check(result!.0 == 0)
        try FileManager.default.removeItem(at: executable)
        do {
            try tracker.start(camera: "0", port: "11573")
            check(false, "Spawned a missing tracker")
        } catch {}
        check(!tracker.isRunning)
        // Render without opening a window or accessing a camera. Catch clipped controls.
        _ = NSApplication.shared
        var devices = [CameraDevice(id: "c", name: "USB Camera"),
                       CameraDevice(id: "a", name: "VTubeLeaf Camera"),
                       CameraDevice(id: "b", name: "FaceTime HD Camera")]
        let delegate = LauncherDelegate(cameraDevices: { devices })
        let window = delegate.makeWindow()
        let content = window.contentView!
        check(descendants(content).contains { $0 is NSPopUpButton },
                     "Camera selection must be a dropdown, not a numeric text field")
        let camera = descendants(content).compactMap { $0 as? NSPopUpButton }.first!
        let buttons = descendants(content).compactMap { $0 as? NSButton }
        let refresh = buttons.first { $0.accessibilityLabel() == "刷新摄像头列表" }!
        let start = buttons.first { $0.keyEquivalent == "\r" }!
        let port = descendants(content).compactMap { $0 as? NSTextField }
            .first { $0.accessibilityLabel() == "UDP 端口" }!
        check(!camera.isBordered && !refresh.isBordered && !port.isBezeled,
                     "Launcher fields must not use macOS native bezels")
        check(camera.focusRingType == .none && port.focusRingType == .none,
                     "Launcher fields must use the app's pink focus treatment")
        check(camera.itemTitles == ["FaceTime HD Camera", "USB Camera"])
        check(camera.itemArray.map(\.tag) == [1, 2], "Filtering changed OpenCV indices")
        camera.selectItem(at: 1)
        devices.append(CameraDevice(id: "aa", name: "External camera"))
        refresh.performClick(nil)
        check(camera.titleOfSelectedItem == "USB Camera" && camera.selectedTag() == 3,
                     "Refresh must preserve device identity when indices change")

        // Start re-enumerates and must never silently switch to another camera after unplugging.
        devices.removeAll { $0.id == "c" }
        start.performClick(nil)
        check(start.title == "开始追踪" && camera.isEnabled)
        check(descendants(content).compactMap { $0 as? NSTextField }
            .contains { $0.stringValue.contains("已断开") })
        devices = [CameraDevice(id: "a", name: "VTubeLeaf Camera")]
        refresh.performClick(nil)
        check(!camera.isEnabled && !start.isEnabled, "Output-only camera cannot start tracking")
        devices = []
        refresh.performClick(nil)
        check(!camera.isEnabled && !start.isEnabled, "Empty device list cannot start tracking")
        devices = [CameraDevice(id: "a", name: "VTubeLeaf Camera"),
                   CameraDevice(id: "b", name: "FaceTime HD Camera"),
                   CameraDevice(id: "c", name: "USB Camera")]
        refresh.performClick(nil)
        check(camera.isEnabled && start.isEnabled)

        // Exercise the actual UI-to-process path, without opening a camera.
        let uiTracker = Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/OpenSeeFace/facetracker")
        try FileManager.default.createDirectory(at: uiTracker.deletingLastPathComponent(), withIntermediateDirectories: true)
        let argumentsFile = folder.appendingPathComponent("ui-arguments")
        try ("#!/bin/sh\nprintf '%s\\n' \"$@\" > '\(argumentsFile.path)'\nwhile :; do sleep 0.1; done\n")
            .write(to: uiTracker, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: uiTracker.path)
        camera.selectItem(at: 1)
        start.performClick(nil)
        waitUntil { FileManager.default.fileExists(atPath: argumentsFile.path) }
        let uiArguments = try String(contentsOf: argumentsFile, encoding: .utf8)
        check(uiArguments.contains("--capture\n2\n"), "Dropdown selection did not reach tracker")
        check(!camera.isEnabled && !refresh.isEnabled && start.title == "停止追踪")
        start.performClick(nil)
        waitUntil { start.title == "开始追踪" }
        check(camera.isEnabled && refresh.isEnabled && start.isEnabled)
        try FileManager.default.removeItem(at: uiTracker)
        content.layoutSubtreeIfNeeded()
        func checkBounds(_ view: NSView) {
            for child in view.subviews {
                check(content.bounds.contains(child.convert(child.bounds, to: content)), "Clipped launcher control")
                checkBounds(child)
            }
        }
        checkBounds(content)
        func render(to url: URL) throws {
            let bitmap = content.bitmapImageRepForCachingDisplay(in: content.bounds)!
            content.cacheDisplay(in: content.bounds, to: bitmap)
            let image = NSImage(size: content.bounds.size)
            image.lockFocus()
            window.backgroundColor.setFill()
            content.bounds.fill()
            let foreground = NSImage(size: content.bounds.size)
            foreground.addRepresentation(bitmap)
            foreground.draw(in: content.bounds, from: .zero, operation: .sourceOver, fraction: 1)
            image.unlockFocus()
            let png = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
            try png.write(to: url)
        }
        if CommandLine.arguments.count == 2 {
            try render(to: URL(fileURLWithPath: CommandLine.arguments[1]))
        }
        check(window.makeFirstResponder(port), "Port must support keyboard input")
        let editor = port.currentEditor() as! NSTextView
        let selectionColor = editor.selectedTextAttributes[.backgroundColor] as! NSColor
        check(selectionColor.usingColorSpace(.sRGB)!.redComponent > 0.8,
                     "Port selection must use the app's pink, not the macOS accent color")
        editor.selectAll(nil)
        content.layoutSubtreeIfNeeded()
        if CommandLine.arguments.count == 2 {
            let url = URL(fileURLWithPath: CommandLine.arguments[1]).deletingPathExtension()
            try render(to: url.deletingLastPathComponent().appendingPathComponent(url.lastPathComponent + "-focused.png"))
        }
        print("Native launcher checks passed: camera selection, arguments, process lifecycle and layout")
    }
}
