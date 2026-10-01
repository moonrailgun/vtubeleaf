# macOS Syphon output

Shares the transparent 1920×1080 output with OBS's built-in **Syphon Client** source. `Output.m` is the C bridge called by `src-tauri/src/texture.rs`: it converts each top-down premultiplied RGBA frame into Syphon's bottom-up BGRA IOSurface and publishes it. Stopping publishes one blank frame first, because clients keep showing the last surface after a server retires. While no client is attached, the app only polls `vtubeleaf_texture_wanted` and produces no frames.

`src-tauri/build.rs` compiles `Output.m` and `vendor/Syphon` into a static library with Xcode's clang. No framework is bundled.

## Vendored Syphon provenance

`vendor/Syphon/` holds the server-side subset of [Syphon-Framework](https://github.com/Syphon/Syphon-Framework/tree/f4761677a45b8034a3c2069ec0f3d2553da81fba), pinned to commit `f4761677a45b8034a3c2069ec0f3d2553da81fba`: `SyphonServerBase`, the connection manager and the messaging classes. The OpenGL/Metal servers and all client classes are left out; frames are written to the IOSurface on the CPU. The copied files are unmodified. Preserve `vendor/LICENSE.syphon` and the notices in the sources; the app shows the license under 关于 → 许可.

## Check against OBS

Start the transparent output in VTubeLeaf, add a「Syphon客户端」source in OBS, pick VTubeLeaf and enable「允许透明度」. `cargo test --manifest-path src-tauri/Cargo.toml texture` starts and stops a real server without a client.
