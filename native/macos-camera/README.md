# VTubeLeaf Camera Extension

This is a macOS 14+ Core Media IO Camera Extension and a Swift host bridge linked into the Tauri app. The source exposes **VTubeLeaf Camera**, fixed at 1280×720 BGRA / 30 FPS. It receives the rendered scene through a CMIO sink stream; it never captures a screen or physical camera.

The frontend composites the stage canvas over the selected background, letterboxes it, and submits raw RGBA bytes with one IPC frame in flight. The host converts RGBA to an IOSurface-backed BGRA pixel buffer, enqueues at most one sample, and caps the producer at 30 FPS. The extension keeps the latest valid sample and outputs opaque black when input is stale for 500 ms or the producer disconnects. The sink accepts one client with the host bundle ID and the packaged Apple Team ID, checked using Security.framework.

## Compile and check without installing

Requires macOS, the full Xcode installation selected with `xcode-select`, and the repository's Node/Rust dependencies.

```sh
node scripts/build-camera.mjs --arch universal --test
cargo test --manifest-path src-tauri/Cargo.toml camera::tests --lib
node --experimental-strip-types --test tests/virtual-camera.test.ts
```

The first command checks profile App Group authorization and the built extension's Mach service prefix, compiles arm64 and x86_64 extension executables, combines them, and runs the native frame/queue checks on the current architecture. Output is under the ignored `native/macos-camera/build/` directory. It is unsigned and cannot be installed. `src-tauri/build.rs` separately compiles and links the host bridge for the Rust target architecture. Non-macOS builds skip the Swift bridge. Windows uses its [DirectShow camera](../windows-camera/README.md); other platforms return unsupported camera status.

The host checks cover enabled-but-missing devices, later device arrival, startup error preservation and disable/re-enable status transitions. If a signed VTubeLeaf Camera is already installed and enabled, `--test` also checks actual device discovery and opening its CMIO sink queue without starting output. Otherwise this device check reports `SKIP`. Run `native/macos-camera/build/host-checks --require-device` to require a real device and fail if it is missing.

## Package a distributable app

For automated production DMG / ZIP builds, use the [GitHub Actions release workflow and configuration guide](../../docs/RELEASE-MACOS.md). It runs the signing script below, notarizes and staples the final app and DMG, and uploads only completed release packages.

Build a fresh Tauri app bundle first. The normal Tauri build does **not** embed this extension. Packaging changes the supplied app bundle; use a fresh build or a copy of it.

Before packaging, the distributor must explicitly provide an Apple Developer Team ID, a matching Developer ID Application signing identity, and valid provisioning profiles for both IDs:

- Host: `com.moonrailgun.vtubeleaf`, with `com.apple.developer.system-extension.install` enabled.
- Extension: `com.moonrailgun.vtubeleaf.camera`.
- Both: App Groups enabled, with profiles authorizing `TEAMID1234.*` or the exact group `TEAMID1234.com.vtubeleaf.camera`. The script signs both bundles with the exact group, replacing `TEAMID1234` with the actual Team ID. This macOS-style group does not need registration in the developer portal; see [Apple's explanation](https://developer.apple.com/forums/thread/721701).

The extension's `CMIOExtensionMachServiceName` uses this same App Group. CoreMediaIO requires that name to be prefixed with an entitled App Group; a mismatch fails activation with `extension category returned error`, even if code signing and notarization pass.

Create/download profiles with these entitlements in the distributor's Apple Developer account. The extension is sandboxed. No physical-camera entitlement is needed for its generated output.

```sh
npm run tauri -- build --bundles app
node scripts/build-camera.mjs \
  --app /absolute/path/VTubeLeaf.app \
  --team-id TEAMID1234 \
  --identity 'Developer ID Application: Your Organization (TEAMID1234)' \
  --host-profile /absolute/path/host.provisionprofile \
  --extension-profile /absolute/path/camera.provisionprofile
```

The script validates profile IDs, Team ID, expiration and required capabilities; matches the extension architecture/version to the host; embeds the extension at `Contents/Library/SystemExtensions/com.moonrailgun.vtubeleaf.camera.systemextension`; signs the extension before the host; and runs `codesign --verify --deep --strict`. It preserves existing host entitlements and adds the supplied profile's entitlements. It never chooses an identity, installs an extension, or notarizes automatically. A pre-existing embedded extension is rejected; rebuild a fresh app before packaging again.

Notarize the final, signed app using the distributor's credentials, then staple the app before creating the final DMG/ZIP. For example, with an already configured explicit notarytool keychain profile:

```sh
ditto -c -k --keepParent /absolute/path/VTubeLeaf.app /absolute/path/VTubeLeaf-notarization.zip
xcrun notarytool submit /absolute/path/VTubeLeaf-notarization.zip --keychain-profile YOUR_PROFILE --wait
xcrun stapler staple /absolute/path/VTubeLeaf.app
xcrun stapler validate /absolute/path/VTubeLeaf.app
```

Do not distribute the earlier unmodified Tauri DMG: it lacks the separately embedded extension.

## Activate and validate the signed build

Move the packaged app into `/Applications`, launch that copy, and use its native-camera installation action. macOS owns approval through System Settings. The app uses `OSSystemExtensionRequest`; no privileged helper or legacy DAL plug-in is installed. Updates/removal can require a reboot, which is reported in status. Use the app's uninstall action before deleting it when removal is desired.

When approval is pending, the app shows a dialog linking to System Settings. On macOS 15+, enable VTubeLeaf under **General → Login Items & Extensions → Camera Extensions**; on macOS 14, allow it under **Privacy & Security**. Status distinguishes an enabled extension from a discovered device and updates when the device appears. If an enabled extension is still missing from the app's device list, quit and reopen VTubeLeaf before starting output.

After approval, start camera output and select **VTubeLeaf Camera** in a conferencing app. Check scene-only pixels, background/letterboxing, motion, stop/crash blanking, repeated start/stop, and relaunch. Repeat on Intel and Apple Silicon before claiming both platforms are supported in distribution. Conference-client compatibility requires a real signed installation and client test.

Current automated evidence covers compilation, frame conversion/validation, bounded queue retain transfer, stale-frame policy and frontend backpressure. Actual camera enumeration and native sink queue creation are covered only when the installed-device check passes. These checks do **not** establish signed packaging, OS approval, cross-process sink authorization/delivery, conference acceptance, or sustained CPU/memory behavior.

References: [Apple's Camera Extension overview and sink/source model](https://developer.apple.com/videos/play/wwdc2022/10022/), [Creating a camera extension](https://developer.apple.com/documentation/coremediaio/creating-a-camera-extension-with-core-media-i-o), and the Camera Extension template and CoreMediaIO/SystemExtensions headers in the installed Xcode SDK.
