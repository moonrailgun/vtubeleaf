// Native WKWebView regression; uses WebKit's synthetic camera, never a physical camera.
// From the repo root:
// echo 'export { Tracker } from "./src/tracker"; export { startFrameLoop } from "./src/frame-loop";' | node_modules/.bin/esbuild --bundle --format=iife --global-name=Tracking --outfile=/tmp/vtubeleaf-tracking.js
// swift -module-cache-path /tmp/vtubeleaf-swift-cache tests/macos-tracking.swift /tmp/vtubeleaf-tracking.js
import AppKit
import WebKit

final class Probe: NSObject, WKScriptMessageHandler, WKUIDelegate {
    var ready: (() -> Void)?
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let result = message.body as? [String: Any] else { return }
        if result["ready"] as? Bool == true { ready?(); return }
        let data = try! JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
        print(String(data: data, encoding: .utf8)!)
        fflush(stdout)
        if let passed = result["passed"] as? Bool { exit(passed ? 0 : 1) }
        if result["error"] != nil { exit(1) }
    }
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let probe = Probe()
let config = WKWebViewConfiguration()
config.preferences.inactiveSchedulingPolicy = .none
// Test-only WebKit SPI: getUserMedia produces an animated test pattern.
config.preferences.setValue(true, forKey: "mockCaptureDevicesEnabled")
config.preferences.setValue(false, forKey: "mockCaptureDevicesPromptEnabled")
config.preferences.setValue(false, forKey: "getUserMediaRequiresFocus")
config.preferences.setValue(true, forKey: "mediaDevicesEnabled")
config.userContentController.add(probe, name: "probe")
let rect = NSRect(x: 100, y: 100, width: 320, height: 160)
let window = NSWindow(contentRect: rect, styleMask: [.titled], backing: .buffered, defer: false)
window.title = "VTubeLeaf tracking regression"
window.level = .floating
let web = WKWebView(frame: NSRect(origin: .zero, size: rect.size), configuration: config)
web.uiDelegate = probe
window.contentView = web
window.orderFrontRegardless()
let cover = NSWindow(contentRect: rect.insetBy(dx: -20, dy: -40), styleMask: [.borderless], backing: .buffered, defer: false)
cover.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)
cover.backgroundColor = .darkGray
probe.ready = {
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
        cover.orderFrontRegardless()
        web.evaluateJavaScript("phase = 'covered'; reset()")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 7) {
        web.evaluateJavaScript("tracker.pause(true); phase = 'paused'; reset()")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 9) {
        web.evaluateJavaScript("tracker.pause(false); phase = 'resumed'; reset()")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 13) {
        cover.orderOut(nil)
        web.evaluateJavaScript("phase = 'foreground'; reset()")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 16) { web.evaluateJavaScript("finish()") }
}
let source = try String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8)
web.loadHTMLString("""
<video autoplay muted playsinline style="opacity:0" width="160" height="120"></video>
<script>
\(source)
const report = value => window.webkit.messageHandlers.probe.postMessage(value);
let tracker, phase = 'foreground', calls = 0, changes = 0, previous = -1, since = performance.now();
const samples = [];
function reset() { calls = changes = 0; since = performance.now(); }
async function finish() {
  const active = samples.filter(s => s.phase === 'covered' || s.phase === 'resumed');
  const paused = samples.filter(s => s.phase === 'paused');
  await tracker.stop();
  report({ passed: active.length >= 4 && active.every(s => s.hidden && s.calls >= 15 && s.changes >= 15)
    && paused.length >= 1 && paused.every(s => s.calls === 0), samples });
}
(async () => {
  const video = document.querySelector('video');
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, frameRate: 30 } });
  video.srcObject = stream;
  await video.play();
  // Model stub uses the same WebGL texture upload as MediaPipe and checks changing pixels.
  // A 2D drawImage here would itself prevent WebKit's background pause and mask the bug.
  const gl = document.createElement('canvas').getContext('webgl');
  const texture = gl.createTexture(), framebuffer = gl.createFramebuffer();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  const pixels = new Uint8Array(320 * 240 * 4);
  tracker = new Tracking.Tracker(video, () => {}, error => report({ error }));
  tracker.stream = stream;
  tracker.landmarker = {
    detectForVideo(input) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, input);
      gl.readPixels(0, 0, 320, 240, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const hash = pixels.reduce((sum, value) => sum + value, 0);
      calls++;
      if (hash !== previous) changes++;
      previous = hash;
      return { facialTransformationMatrixes: [], faceBlendshapes: [], faceLandmarks: [] };
    },
    close() { gl.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
  tracker.stopFrames = Tracking.startFrameLoop(() => {
    tracker.tick(tracker.generation);
    if (performance.now() - since >= 1000) {
      const sample = { phase, hidden: document.hidden, calls, changes, videoPaused: video.paused };
      samples.push(sample); report(sample); reset();
    }
  }, () => 30);
  report({ ready: true });
})().catch(error => report({ error: String(error) }));
</script>
""", baseURL: URL(string: "https://localhost"))
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { print("FAIL: probe timed out"); exit(1) }
app.run()
