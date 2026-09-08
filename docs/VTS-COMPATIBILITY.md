# VTube Studio configuration import

VTubeLeaf automatically reads an adjacent Version 1 `.vtube.json` the first time a model is loaded without an existing VTubeLeaf profile. This works for folders, `.model3.json` files and ZIP imports. It prefers `<model-name>.vtube.json`, otherwise accepts a single adjacent candidate. Multiple candidates, an invalid file or a `FileReferences.Model` pointing to another model are reported and skipped while the model remains usable. Valid configuration data is kept in the managed model library. Later model switches and application restarts preserve the user's VTubeLeaf tuning instead of reapplying the source configuration.

The **导入 VTube Studio 配置** button remains available to select or reapply a configuration manually. Both paths use the same partial-profile converter and show a saved import report. They never modify the original or open filenames referenced inside it. Configurations must be regular local files up to 2 MiB; symbolic links (including parent components) are rejected. The converter bounds nesting, values, arrays, IDs and strings and rejects prototype keys.

## Verified format

Checked on 2026-09-08. VTS explicitly says there is **no published file-format specification**; this is bounded compatibility, not a full VTS implementation.

- [Official model-file documentation](https://github.com/DenchiSoft/VTubeStudio/wiki/VTube-Studio-Model-File).
- [Official mapping, auto-blink/breath and physics semantics](https://github.com/DenchiSoft/VTubeStudio/wiki/VTS-Model-Settings).
- [Official action enum](https://github.com/DenchiSoft/VTubeStudio/blob/master/Files/HotkeyAction.cs) and [keyboard enum](https://github.com/DenchiSoft/VTubeStudio/blob/master/Files/RestrictedRawKey.cs).
- [Official API: input ranges and filename/action semantics](https://github.com/DenchiSoft/VTubeStudio/blob/master/README.md).
- Representative data: [TEN-framework Memu Cat config](https://github.com/TEN-framework/ten-framework/blob/23d2c18d8d014e3e310bad14897f5254d0a8fbca/ai_agents/agents/examples/voice-assistant-companion/frontend/public/models/memU/memu_cat.vtube.json) and [EasyLive2D llny config](https://github.com/EasyLive2D/relive2d/blob/d86d85adf27d6091d52f79d9a3f351d81533cc63/Resources/v3/llny/llny.vtube.json).

The test fixture is a reduced, renamed example of those actual field layouts: `ParameterSettings[].InputRangeLower/Upper`, `OutputRangeLower/Upper`, `OutputLive2D`, and `Hotkeys[].Triggers.Trigger1/2/3`. Public API response fields are not mistaken for model-file fields. The JSON layout is tested without copying or installing model assets.

## Converted

- `FaceAngleX/Y/Z` → normalized yaw/pitch/roll, dividing degree endpoints by 30. `EyeOpenLeft/Right`, `MouthOpen` and `MouthSmile` retain unit-scale endpoints. Reversed input endpoints swap output endpoints. Outputs must exist in current model metadata and remain inside its parameter bounds. Duplicate outputs preserve the first entry.
- Smoothing 0 is exact. Nonzero VTS 0–100 slider values are **approximated** linearly to VTubeLeaf's 0–0.5-second time constant, with an explicit warning. VTS does not document its smoothing algorithm. Tracking calibration, sensitivity and mirroring remain active, so preview calibration is necessary; sensor output equivalence is not claimed. VTubeLeaf always clamps input/output, and warns when a VTS mapping allows extrapolation.
- `ToggleExpression`, `TriggerAnimation` and `RemoveAllExpressions` map to existing runtime actions. Expression/motion/idle filenames resolve only against current metadata: exact relative path first, otherwise a unique basename. Ambiguous, absolute, traversal and missing paths are skipped. Imported animation hotkeys use one-shot playback, independently of the workbench playback selector. `StopsOnLastFrame` imports a held last frame; the next press stops that same held motion. VTubeLeaf currently holds tracked parameters too, unlike VTS; the report explicitly warns about this difference.
- Actual VTS string keyboard enums are translated: `N1` → `Digit1`, `A` → `KeyA`, function/numpad keys and supported navigation keys. Only modifier(s) plus one ordinary key are accepted. Left/right modifier distinction is lost and warned. Duplicate actions or shortcuts retain the first entry. A disabled VTS action or disabled keyboard-hotkey setting is skipped. `IsGlobal=false` stays local to the focused application; global shortcuts use the OS registration on desktop. Browser previews remain page-local.
- `FileReferences.IdleAnimation` becomes `idleMotion` when resolved. `PhysicsSettings.Use=false` becomes `physicsStrength=0`; other physics fields remain unchanged and are reported.
- `ToggleExpression` supports `DeactivateAfterKeyUp` and `DeactivateAfterSeconds` with a positive duration up to 3,600 seconds. Local key release, modifier release, focus loss and rebinding release held expressions; native global bindings consume the OS release event. Timing and scope survive profile saving and model switching. Manually replacing a shortcut clears its imported behavior.

## Explicitly skipped

Per-parameter blink cannot be represented by VTubeLeaf's global blink switch. A blinking mapping imports tracking only and warns; breath replaces input in VTS, so a breathing mapping is skipped entirely. Unsupported input sources (including custom/plugin, gaze, position, hand and voice inputs) warn; importing never enables camera or microphone.

Gesture deactivation and animation release/timer options still skip the whole hotkey. Gesture, Twitch and on-screen triggers are reported as unsupported. Custom fade durations are reported and use the existing runtime fade. Local scope does not enable desktop-global registration.

The verified VTS action enum has no matching standalone stop-animation or reset-display action. `MoveModel` moves to an arbitrary saved position and is not treated as reset. Scene/item actions cannot resolve against the supplied model-only metadata and are skipped. No tracking toggle, file loading, microphone reload or other VTS-only action is mapped.

Physics strength/wind slider units, FPS enums, legacy physics, per-group VTS physics, saved transforms, saved expressions, lost-tracking idle, item behavior, art meshes, custom parameter settings and unknown root settings produce warnings rather than speculative conversions. Reading extra motion/expression files and native VTS visual parity are outside this importer.
