import AppKit

// Exercise the production quit handler in AppKit's real event loop, without showing UI.
final class QuitCheckDelegate: NSObject, NSApplicationDelegate {
    let launcher = LauncherDelegate()

    func applicationDidFinishLaunching(_ notification: Notification) {
        let window = launcher.makeWindow()
        let content = window.contentView!.subviews.first as! NSStackView
        (content.arrangedSubviews.last as! NSButton).performClick(nil)
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
        precondition(condition(), "Tracker did not finish within 8 seconds")
    }

    static func main() throws {
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
                preconditionFailure("Accepted invalid camera or UDP port")
            } catch {}
        }
        let expected = ["--ip", "127.0.0.1", "--port", "12000", "--capture", "2",
                        "--faces", "1", "-F", "24", "-W", "640", "-H", "360",
                        "--gaze-tracking", "0", "--visualize", "0", "--silent", "1"]
        let actual = try TrackerProcess.arguments(camera: " 2 ", port: "12000")
        precondition(actual == expected)

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
        precondition(result!.0 == 7 && result!.1.contains(expected.joined(separator: "\n")))
        precondition(result!.1.contains("camera unavailable") && !tracker.isRunning)

        // Closing/stopping must also reap a tracker that ignores graceful shutdown.
        result = nil
        try script("trap '' INT TERM\nprintf 'ready'\nwhile :; do :; done\n")
        try tracker.start(camera: "0", port: "11573")
        RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        do {
            try tracker.start(camera: "0", port: "11573")
            preconditionFailure("Started two trackers")
        } catch {}
        tracker.stop()
        waitUntil { result != nil }
        precondition(!tracker.isRunning)

        // A subsequent start is usable; a spawn failure must leave no running state.
        result = nil
        try script("exit 0\n")
        try tracker.start(camera: "32", port: "65535")
        waitUntil { result != nil }
        precondition(result!.0 == 0)
        try FileManager.default.removeItem(at: executable)
        do {
            try tracker.start(camera: "0", port: "11573")
            preconditionFailure("Spawned a missing tracker")
        } catch {}
        precondition(!tracker.isRunning)
        // Render without opening a window or accessing a camera. Catch clipped controls.
        _ = NSApplication.shared
        let delegate = LauncherDelegate()
        let window = delegate.makeWindow()
        let content = window.contentView!
        content.layoutSubtreeIfNeeded()
        func checkBounds(_ view: NSView) {
            for child in view.subviews {
                precondition(content.bounds.contains(child.convert(child.bounds, to: content)), "Clipped launcher control")
                checkBounds(child)
            }
        }
        checkBounds(content)
        if CommandLine.arguments.count == 2 {
            let bitmap = content.bitmapImageRepForCachingDisplay(in: content.bounds)!
            content.cacheDisplay(in: content.bounds, to: bitmap)
            let image = NSImage(size: content.bounds.size)
            image.lockFocus()
            NSColor.windowBackgroundColor.setFill()
            content.bounds.fill()
            let foreground = NSImage(size: content.bounds.size)
            foreground.addRepresentation(bitmap)
            foreground.draw(in: content.bounds, from: .zero, operation: .sourceOver, fraction: 1)
            image.unlockFocus()
            let png = NSBitmapImageRep(data: image.tiffRepresentation!)!.representation(using: .png, properties: [:])!
            try png.write(to: URL(fileURLWithPath: CommandLine.arguments[1]))
        }
        print("Native launcher input, error reporting, stop and restart checks passed")
    }
}
