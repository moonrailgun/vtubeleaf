# Scene and output implementation plan

Spec: `docs/superpowers/specs/2026-09-08-scenes-camera-vts.md`

## Global Constraints

Preserve existing dirty work; no commit, push, deployment, native GUI control or physical camera/microphone access. Validate all external files/settings. Camera and microphone remain opt-in. Do not select a signing identity without user team information or bypass platform protections. Use existing dependencies where practical. Keep output and scene composition consistent. Report unverified system installation honestly.

### Task 1: macOS native virtual camera

Own only `native/macos-camera/**`, `scripts/build-camera.mjs`, `src-tauri/src/camera.rs`, `src-tauri/build.rs`, optional `src-tauri/Camera.entitlements`, `src/virtual-camera.ts`, and focused new camera tests. Parent will register the Rust plugin, add UI and invoke frame submission; do not edit parent-owned files.

Build an actual Apple CMIO Camera Extension plus host bridge from SDK/official references. Host manages supported OSSystemExtension installation/removal requests and feeds canvas frames into a sink stream; extension publishes a camera source. Use native efficient local transport with strict frame-size/type bounds, one in-flight submission, clean shutdown and stale-frame blanking. Provide reproducible build/bundling/signing script, no automatic installation; the unsigned build must compile locally. Keep macOS-only code gated; report unsupported on other platforms.

Rust export `pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R>` with plugin name `virtual-camera`; state/commands reside in camera.rs, require main window. Frontend exports `CameraStatus` {supported:boolean, installed:boolean, active:boolean, message:string} and `VirtualCamera` with constructor `(onStatus:(status:CameraStatus)=>void)`, `refresh():Promise<void>`, `install():Promise<void>`, `uninstall():Promise<void>`, `start():Promise<void>`, `stop():Promise<void>`, `submit(canvas:HTMLCanvasElement, background:string):void`, `destroy():void`, getter `status:CameraStatus`. Submit must composite background and letterbox a canvas at 1280x720, cap 30 FPS with backpressure, and never capture UI or hardware. Expose failure state via callback. Browser mode unsupported without throwing at construction. Parent calls submit immediately after the stage renders.

Verify Swift/native compilation against installed SDK, Rust module compile and focused bounds/transport tests. Record exact commands and gaps; do not claim signed installation or conferencing acceptance. Native camera may need a separate packaging command after Tauri build to embed and sign the extension; document this clearly. Write full report to task-1-report.md in this plan's SDD workspace. No subagents or commits.

### Task 2: items, scenes and global actions

Parent implementation: bounded native local asset import/read; normalized scene types and saved settings; PIXI image/GIF/Live2D layers; model-relative attachment and transforms; scene CRUD/recall; appearance UI; global actions with persistent application-wide bindings; shared output state. Focused data tests and real browser rendering checks, including persistence/invalid assets/output parity.

### Task 3: VTS compatibility

Verify representative `.vtube.json` documents and official VTS docs. Implement a bounded pure importer with explicit supported mappings/actions and warnings, native picker and optional adjacent model configuration discovery. Parent owns integration/UI. Verify range/enum/prototype/path validation and actual fixture conversion; never guess unsupported semantics.

### Task 4: integrate, review and verify

Wire camera plugin/UI/canvas submission and cleanup. Run targeted tests while developing, then full type/build/unit/browser checks and Rust/app build. Capture and inspect actual browser screenshots. Update README, SETUP, VALIDATION with working capabilities and platform limitations. Review each delegated task and final integrated change before delivery. Leave all edits uncommitted.
