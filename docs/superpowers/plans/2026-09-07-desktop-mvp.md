# VTubeLeaf desktop implementation

Approved scope: implement the supplied PRD, with OpenSeeFace added as an optional local tracker by the user. No publishing or SDK redistribution.

1. Tauri 2 shell: bounded model import (directory, entry, ZIP), settings persistence, loopback OpenSeeFace receiver and optional owned Python process. Unit checks cover untrusted paths, packets and cleanup.
2. Vite + TypeScript UI: Chinese studio, camera lifecycle, local MediaPipe inference, common calibrated mapping, Cubism rendering, separate clean output, persisted controls. Tests cover mapping, invalid settings and browser flows.
3. Local asset setup, optional OpenSeeFace setup, vector branding and platform icons, build and meeting documentation.
4. Run TypeScript checks/tests/build, Rust tests and desktop build. Record browser proof separately from native camera/OBS/meeting and platform validation.

## IPC contract

- `load_settings()` → JSON or null; `save_settings({settings})` → void.
- `choose_model({kind})` (`directory`, `file`, `zip`), `load_model({path})` → `ModelInfo | null`.
- ModelInfo: `{id, path, name, entry, files: string[]}`. Files are validated relative resource paths. No direct filesystem URLs in the webview.
- `read_model_resource({id,resource})` → binary response. Re-check canonical containment and size on reads.
- `start_openseeface({port,camera,pythonPath,scriptPath})` → void. Optional paths start a managed child; neither path means externally managed tracker.
- `stop_openseeface()` → void; `openseeface-frame` event → `{yaw,pitch,roll,eyeLeft,eyeRight,mouthOpen,mouthSmile}`. Degrees and normalized openness, finite values only, face ID 0. Bind localhost only. Stop owned process, join receiver and release port on switch/exit.
- Main owns one tracker. Output gets model ID, display settings and mapped parameters using targeted Tauri events, with a ready handshake.

## Boundaries

Core SDK must be supplied from the official SDK by the developer. MediaPipe WASM/model install locally. Native camera, real model direction/physics, background states, OBS/Feishu and two-hour reliability remain explicit acceptance checks until actually exercised. Windows/Linux cannot be claimed tested from this Mac.
