# Tracking quality alignment implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent modules; integrate and verify in this session.

**Goal:** Implement the six tracking-quality gaps identified in the VTube Studio comparison: calibration, eye linking, capture controls, hands, microphone lipsync and physics controls.

**Architecture:** Keep the existing Tracker → normalizedFace → FaceMapper → AvatarStage flow. Add optional hands and local audio as input sources; preserve per-model settings and existing output/motion behavior.

**Tech Stack:** TypeScript, React, MediaPipe 0.10.32, Web Audio, existing Cubism runtime, node:test and Playwright.

**Spec:** The user's request to align VTube Studio capabilities after the six-row quality comparison. Reference: official VTube Studio wiki pages VTube-Studio-Settings, Hand-Tracking, Lipsync, VTS-Model-Settings.

## Global Constraints

- Preserve existing uncommitted work; no commits, pushes, deployment or physical camera/microphone use during automation.
- Default real-camera preview stays off. Microphone and hand tracking are opt-in.
- Use existing dependencies. Process all camera/audio locally; do not record or transmit audio.
- Provide input validation, cancellation and cleanup; synthetic evidence must not be described as real-device acceptance.
- Existing per-model settings must restore independently; global device/capture preferences must survive model switches.

### Task 1: Local audio input

**Files:** Create `src/lipsync.ts`, `tests/lipsync.test.ts` only.

**Interfaces:** Export `vowels = ['A','I','U','E','O'] as const`, `type Vowel`, `type VoiceTemplates = Partial<Record<Vowel, number[]>>`, `type VoiceFrame = { voiceVolume:number; voiceA:number; voiceI:number; voiceU:number; voiceE:number; voiceO:number }`. Export `AudioLipSync` with `start(deviceId: string): Promise<void>`, `stop(): Promise<void>`, `pause(paused: boolean): void`, `read(gain:number, noiseGate:number, templates:VoiceTemplates): VoiceFrame`, `calibrate(): Promise<number[]>`, `active: boolean`, `deviceLabel: string`. Constructor accepts optional `fail: (message:string)=>void`.

- [x] Write a minimal node:test for silence gating, finite/clamped outputs and matching distinguishable calibrated vowel spectra, plus malformed-template rejection.
- [ ] Historical gap: the initial audio test failure before implementation was not fully preserved. Final unit and browser checks pass.
- [x] Implement RMS volume and MFCC nearest-template vowel weights using Web Audio AnalyserNode. Export pure helpers for meaningful synthetic checks. Use 13 coefficients/26 mel filters over finite FFT bins and per-frame normalization; only classify when all five valid voice templates exist. Volume remains usable without vowel calibration. `calibrate()` collects a one-second voiced sample from the already-active analyser, rejects silence/stop/concurrent attempts and resolves a mean MFCC vector. Do not auto-start the microphone from `read()` or calibration.
- [x] `start` requests audio only (exact selected device when specified), uses generation guards across getUserMedia/AudioContext resume, closes obsolete contexts and tracks, reports device disconnection. Connect analyser through zero gain for clocking without audible loopback. `stop` cancels calibration and releases all tracks/nodes/context. `pause` emits silence and does not classify samples.
- [x] Run the focused node test and TypeScript check. Report any integration-only type failures explicitly.

### Task 2: Hand and capture input

**Files:** Create `src/hands.ts`, `tests/hands.test.ts`; modify `src/tracker.ts`, `scripts/setup-assets.mjs`.

**Interfaces:** `HandSignals` uses optional numeric handLeft/RightFound, X, Y, Z, Angle, Open, Thumb, Index, Middle, Ring, Little fields. `handSources` maps keys to Chinese labels. `fromHands` accepts MediaPipe-style landmarks/worldLandmarks/handedness and returns these bounded signals. Settings integration uses `handTracking:boolean`, `cameraResolution:'360p'|'720p'|'1080p'`, `trackingFps:15|24|30|60`, `bodyFps:5|10|15|30`, `handFps:5|10|15|30`.

- [x] Add geometry and confidence checks for straight/folded fingers, left/right assignment, missing hands and invalid points, run red.
- [x] Implement optional HandLandmarker, independently throttled capture (no overlapping inference), landmark preview, statuses and cleanup. Reuse existing camera lifecycle and body fallbacks. On auxiliary model failure keep face tracking working. Hand output must work without a visible face; absent hands must clear previous pose without inventing facial data.
- [x] Use requested resolution/FPS in getUserMedia and tracking loop; expose actual camera settings in a status string. Keep changes to capture settings requiring stop/start in UI.
- [x] Add official versioned hand model with verified byte size and SHA-256 to setup script; prepare/check local assets and run focused tests.

### Task 3: Model physics controls

**Files:** Modify `src/renderer.ts`; create a small physics helper/test only if needed.

**Interfaces:** Per-model `physicsStrength:number` (0..2), `physicsWind:number` (-2..2), `physicsFps:0|30|60` (0 = render rate), `physicsGroups:Record<string,number>` (0..2). Expose `AvatarStage.physicsGroups: {id:string; name:string}[]` with stable ids/names from the model's physics metadata, empty for no physics/passive output.

- [x] Inspect actual installed Cubism evaluator and write a focused check for scaled outputs, unchanged base weights, fixed-step bounds and zero-strength behavior.
- [x] Wrap the existing evaluator with reversible global/per-group output-weight multipliers, wind and bounded fixed steps, preserving the motion/tracking/expression update order and passive output's disabled physics.
- [x] Verify with real bundled model resources using synthetic input; test strength changes and model switch cleanup.

### Task 4: Quality controls and integration

**Files:** Modify `src/state.ts`, `src/studio.ts`, `src/App.tsx`, `tests/state.test.ts`, `tests/browser.spec.ts`, native microphone usage text, README and setup/validation docs.

- [x] Add failing tests for multi-frame calibration rejection/averaging, linked blinking (off/always/side), profile validation/isolation, hand mirroring and independent audio input.
- [x] Add a one-second minimum 12-frame neutral calibration with stability checks and a separate closed-eye sample; keep current calibration on failure and cancel on stop/model/engine changes. Normalize per-eye closed/open endpoints. Link eyes by average or side-angle blend to the visible eye, configurable transition threshold; preserve front-facing winks.
- [x] Add requested capture controls and measured inference/render counters, independent renderFps 30/60, lost tracking hold/neutral modes.
- [x] Add hand/voice sources to existing mapping editor. Audio volume drives mouth via selected off/volume/vowels mode and blend; calibrated AIUEO remain separately mappable. Do not claim models without hand/vowel parameters can display them.
- [x] Expose physics controls and optional microphone device/gain/noise gate/calibration; errors release audio without stopping face tracking. Update privacy copy and native microphone usage text.
- [x] Run node tests, TypeScript/build, fixture-backed browser tests, inspect relevant screenshots and build the macOS app. Document implementation and real-device validation boundary.
