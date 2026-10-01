# Windows Spout2 output

Shares the transparent 1920×1080 output with OBS through a Spout2 sender named **VTubeLeaf**. OBS needs the [Spout2 plugin](https://github.com/Off-World-Live/obs-spout2-plugin); add a「Spout2 Capture」source, pick VTubeLeaf and set「Composite mode」to Premultiplied Alpha.

`Output.cpp` is the C bridge called by `src-tauri/src/texture.rs`. It uploads each top-down premultiplied RGBA frame into an `R8G8B8A8_UNORM` shared Direct3D 11 texture with `spoutDX::SendImage`. Stopping sends one blank frame first, because receivers keep the last shared frame after a sender closes. `src-tauri/build.rs` builds the static library with CMake for x64.

## Check

```powershell
cmake -S native/windows-spout -B .local/spout-check -A x64 -DBUILD_TESTING=ON
cmake --build .local/spout-check --config Release --parallel
ctest --test-dir .local/spout-check -C Release --output-on-failure
```

The test sends frames through the bridge and reads them back with a Spout receiver in the same process. It reports `SKIP` when Direct3D 11 is unavailable.

## Vendored Spout provenance

`vendor/Spout/` holds the DirectX sender subset of [Spout2](https://github.com/leadedge/Spout2/tree/c2bcc12147711d12ace7d5f08e869d774d840f8a/SPOUTSDK), pinned to commit `c2bcc12147711d12ace7d5f08e869d774d840f8a`: `SpoutDX` from `SPOUTSDK/SpoutDirectX/SpoutDX` and its dependencies from `SPOUTSDK/SpoutGL`. Preserve `vendor/LICENSE.spout` and the notices in the sources; the Windows app bundles the license and shows it under 关于 → 许可.

Local change: `SpoutUtils.h` no longer emits the `/manifestdependency` linker pragma for Common-Controls 6. The app embeds its own manifest, which already declares that dependency, so the static library should not add linker manifest directives of its own. All other copied files retain the pinned contents.
