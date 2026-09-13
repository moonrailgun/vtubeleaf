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

The host checks cover activation before CMIO discovery and streaming, repeated clicks, cancellation, activation failures, reboot prompts, stale status responses, delayed device arrival, non-destructive timeouts, deferred uninstall, startup error preservation and disable/re-enable status transitions. Lifecycle checks intercept system submission and stream I/O; they do not install or update an extension. If a signed VTubeLeaf Camera is already installed and enabled, `--test` also checks actual device discovery and opening its CMIO sink queue without starting output. Otherwise this device check reports `SKIP`. Run `native/macos-camera/build/host-checks --require-device` to require a real device and fail if it is missing.

Authorization checks reject an unsigned process even when its callback metadata claims the host signing ID. To also check a real signed host with `unknown`/missing metadata, build with `--test --team-id YOURTEAMID`, then run `native/macos-camera/build/authorization-checks HOST_PID` using a running signed VTubeLeaf process from that team. The check calls the extension's authorization method with test client metadata and real Security.framework validation; it does not install an extension or test its sandbox or frame delivery.

Reproduce the camera sandbox's host-bundle read restriction with the same signed host:

```sh
sandbox-exec -D HOST_BUNDLE=/Applications/VTubeLeaf.app \
  -f native/macos-camera/tests/AuthorizationSandbox.sb \
  native/macos-camera/build/authorization-checks HOST_PID
```

This regression must still authorize the real host while rejecting the unsigned test process. It checks the file-access restriction, not the complete camera extension sandbox; signed extension activation and video delivery remain separate checks.

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

The script validates profile IDs, Team ID, expiration and required capabilities; matches the extension architecture to the host; embeds the extension at `Contents/Library/SystemExtensions/com.moonrailgun.vtubeleaf.camera.systemextension`; signs the extension before the host; and runs `codesign --verify --deep --strict`. It preserves existing host entitlements and adds the supplied profile's entitlements. It never chooses an identity, installs an extension, or notarizes automatically. A pre-existing embedded extension is rejected; rebuild a fresh app before packaging again.

The extension has its own version in `Info.plist`, initially matching the shipped `0.1.12` extension. App release bumps leave both extension version fields unchanged, so ordinary app updates reuse the installed camera. Bump **both** `CFBundleShortVersionString` and `CFBundleVersion` when changing the extension payload (`Extension.swift`, `Frame.swift`, `main.swift`, extension metadata or entitlements); host-only changes do not require a camera version bump. Apple uses these two fields to decide whether to replace an installed extension. Keeping them stable avoids unnecessary CMIO service replacement: on macOS 15.7.4, a `0.1.11` → `0.1.12` replacement was observed failing with launchd `Operation already in progress` while the extension still became `activated enabled`. This does not repair macOS replacement failures when the extension itself needs an upgrade. See [Apple's replacement contract](<https://developer.apple.com/documentation/systemextensions/ossystemextensionrequestdelegate/request(_:actionforreplacingextension:withextension:)>).

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

Each start action first requests activation of the bundled extension, allowing macOS to check its version and replace an older installation without uninstalling it first. Output starts only after activation completes and the device appears. Approval, activation errors and required reboots are shown in status; repeated clicks do not submit another pending request. Stopping or uninstalling while activation is pending cancels the deferred video start. Uninstall is queued until the pending request finishes.

Before successful activation, status polling reads only system extension properties. CMIO device discovery stays deferred, including after activation fails or requires a reboot, to avoid binding an older extension before macOS can replace it. An enabled extension whose device has not been checked is not reported as missing.

After activation succeeds, the host waits up to eight seconds for device discovery, checked by the existing two-second status poll. Device arrival during that wait resumes output automatically. If the device remains absent, the pending start ends with retry feedback and a native recovery prompt, leaving the extension installed. The prompt appears once per timed-out start; routine status polling does not repeat it. Stop cancels the pending start. Only an explicit uninstall action requests deactivation; repeated uninstall clicks are coalesced. A missing device does not prove that reinstalling the extension or restarting the app will repair the system service.

For an enabled extension whose device is missing on macOS 15+, try quitting VTubeLeaf, switching its camera extension off and back on under **System Settings → General → Login Items & Extensions → Camera Extensions**, then reopening the app and starting output. This recovery attempt does not require restarting the Mac, but is not guaranteed to recover every system. If macOS explicitly reports that activation requires a reboot, the app preserves that result.

Approval and recovery dialogs share the same System Settings shortcut. On macOS 15+, **Open Camera Extensions** opens the camera extension panel directly using `x-apple.systempreferences:com.apple.ExtensionsPreferences?extensionPointIdentifier=com.apple.system_extension.cmio.extension-point` (verified on macOS 15.7.4, including the VTubeLeaf Camera toggle). On macOS 14, the button opens Privacy & Security. Status distinguishes an enabled extension from a discovered device and updates when the device appears. A pending start continues after approval and device discovery. Recovery after a device timeout requires another start attempt. macOS may require approval during activation or return a result requiring reboot; the app cannot bypass those requirements.

After approval, start camera output and select **VTubeLeaf Camera** in a conferencing app. Check scene-only pixels, background/letterboxing, motion, stop/crash blanking, repeated start/stop, and relaunch. Repeat on Intel and Apple Silicon before claiming both platforms are supported in distribution. Conference-client compatibility requires a real signed installation and client test.

For upgrade validation, begin with the previous signed version installed, replace the app with the new signed package, and start output without manually uninstalling the extension. For an app-only update, confirm that the extension version stays unchanged with `systemextensionsctl list` and that launchd does not replace its service. When the extension payload changes, confirm the new extension version instead. In both cases, verify actual video in a conferencing app. An `activated enabled` entry alone does not establish device discovery or streaming. Test closing the app while activation or device discovery is pending, then relaunching and starting again.

Current automated evidence covers compilation, frame conversion/validation, bounded queue retain transfer, stale-frame policy and frontend backpressure. Actual camera enumeration and native sink queue creation are covered only when the installed-device check passes. These checks do **not** establish signed packaging, OS approval, cross-process sink authorization/delivery, conference acceptance, or sustained CPU/memory behavior.

## Diagnose input stream authorization failures

For `Unable to start camera input stream: -4` / `无法启动摄像头输入流：-4` with `Refusing streaming request`, collect the extension's authorization log after reproducing the failure:

```sh
/usr/bin/log show --last 10m --style compact \
  --predicate 'subsystem == "com.moonrailgun.vtubeleaf.camera" AND category == "authorization"'
```

Rebuild/sign the app and start camera output to activate its bundled extension first; merely replacing the app without starting output may leave an older extension running. Confirm the active version with `systemextensionsctl list`. The diagnostic entries include `extensionVersion`, the requesting PID/client ID/signing ID, the configured Team ID, and the existing sink client/running count. These fields are public so unified logging does not redact the evidence. No frame data or user paths are logged.

CoreMediaIO can report `signingID=unknown` for a correctly signed host. This field is diagnostic only; authorization checks the running process's Apple signature, host identifier and packaged Team ID with Security.framework. Version 0.1.7 rejected such clients early with `stage=signing-id`; that requires a rebuilt, signed extension to fix.

Version 0.1.8 can fail at `stage=guest-code osStatus=100001` because the camera sandbox denies reading the host app bundle. Authorization now requests `kSecGuestAttributeDynamicCode`, so Security.framework obtains the running process's signature from the kernel and uses its signing helper for bundle metadata. The signature requirement is unchanged and failures still reject the client. See [Apple's implementation](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_codesigning/lib/cskernel.cpp). This fix also requires a rebuilt, signed extension.

Each rejected request names its `stage`: `client-busy`, `team-id`, `guest-code` (process lookup), `requirement` (signature rule creation), or `signature` (running process validation). Security API failures retain their original `osStatus`; lookup and rule creation also record whether an object was returned. `Sink authorization accepted` confirms only authorization, so continue checking frame delivery and conferencing output separately. Logs are emitted per authorization request, never per frame.

References: [Apple's Camera Extension overview and sink/source model](https://developer.apple.com/videos/play/wwdc2022/10022/), [Creating a camera extension](https://developer.apple.com/documentation/coremediaio/creating-a-camera-extension-with-core-media-i-o), and the Camera Extension template and CoreMediaIO/SystemExtensions headers in the installed Xcode SDK.
