# Windows virtual camera

The Windows 10/11 x64 app includes **VTubeLeaf Camera**, a DirectShow capture source at 1280×720, RGB32, 30 FPS. Both x64 and x86 DLLs are built so 64-bit and 32-bit desktop clients can load the device. This is a user-mode COM filter, with no OBS dependency, kernel driver, developer account, or administrator installation requirement. Native ARM64 and clients that only enumerate Media Foundation cameras are outside this implementation.

## Build and use

Install Visual Studio C++ Build Tools with the x64/x86 MSVC tools, Windows SDK and C++ CMake tools. Make `cmake` available on PATH. Use the x64 Rust MSVC toolchain and follow the repository's [Windows setup](../../docs/SETUP.md#windows-开发与打包).

```powershell
npm run tauri dev
# Or build the per-user NSIS installer:
npm run tauri -- build --bundles nsis
```

`src-tauri/build.rs` builds both camera DLLs using CMake, links the x64 producer into Rust and stages the DLLs under the ignored `bin/` directory. Tauri copies them to `camera/x64/` and `camera/x86/` beside the executable in development and in the installed app. The Windows configuration also bundles the vendor licenses. MSVC runtime libraries are statically linked; the camera DLLs do not require a separate Visual C++ runtime installation.

In the app's 接入 page, select **安装虚拟摄像头**, then **启动虚拟摄像头**. Reopen the meeting client's camera list and select **VTubeLeaf Camera**. Audio uses the microphone already selected in that client. Only the rendered stage is transmitted; controls and the real-camera preview are excluded. Stop output when finished. Installation does not start transmission automatically.

Registration uses the current user's `Software\Classes` COM/camera-category entries, in both registry views. The app invokes Windows' matching `regsvr32.exe`; it does not request elevation. Keep the app at its registered path. Close camera clients before removing or replacing the DLLs. Use the app's uninstall action to remove the camera, or uninstall the app through its NSIS installer. Cleanup only removes registration pointing to that app copy. After an upgrade or moving a development checkout, reinstall the camera from the new app if its registration was removed or points to the old path.

## Frame transport

The producer writes the latest frame to fixed-size shared memory. Object names include the current user's SID and use the local Windows session namespace; an explicit ACL grants access to that user and SYSTEM. A single producer owns transmission, while multiple capture clients can read the frame. The protocol uses fixed-width fields for interoperability between x64 and x86 processes.

The reader maps a fixed-size view read-only and checks the magic, version, activity, sequence and monotonic age before copying pixels. Invalid or absent frames, stopped output and frames older than 500 ms produce black. Incoming RGBA is converted to bottom-up opaque BGRA for DirectShow RGB32. A bounded mutex wait drops a busy frame instead of accumulating a queue. Receivers can remain open across producer restarts.

The COM/filter/thread machinery comes from the vendored DirectShow BaseClasses; source and local changes are recorded in [vendor/README.md](vendor/README.md).

## Runnable checks

Run on a disposable Windows account/runner with no existing VTubeLeaf camera registration or running producer:

```powershell
foreach ($platform in @('x64', 'Win32')) {
  $output = ".local/camera-check/$platform"
  cmake -S native/windows-camera -B $output -A $platform -DBUILD_TESTING=ON
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  cmake --build $output --config Release --parallel
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
  ctest --test-dir $output -C Release --output-on-failure
  if ($LASTEXITCODE) { exit $LASTEXITCODE }
}
```

CTest covers blank/stale/invalid frames, channel restart, producer exclusivity, color and orientation, COM instantiation without an active producer, format validation, running a DirectShow graph, per-user device enumeration/binding, and uninstall ownership. It temporarily registers this camera; it refuses to replace an existing registration. These checks are included in the Windows CI job.

Current evidence: x64/x86 DLLs and test executables cross-compile and link on macOS with Clang and the MSVC/Windows SDK. The Windows CMake/MSVC build, CTest execution, NSIS installation, cross-process x64-to-x86 video and actual meeting clients have **not** been run yet. Cross-compilation does not establish runtime compatibility.

Windows acceptance must cover install → enumerate → start → sustained moving scene in a second meeting endpoint → stop/black → restart → uninstall, both client bitnesses, an already-open receiver, background operation, clean machines, and upgrade cleanup. Record client versions and whether their camera backend accepts DirectShow. Test Windows 10 and 11 separately.
