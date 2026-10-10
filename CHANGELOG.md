# Changelog

## Unreleased

## v1.2.0 · 2026-10-11

### Added

- The interface is now available in English, Chinese, Japanese, Spanish and French. It follows your system language by default (English if your system uses another language), and you can also pick one under "Language" in "Connect → Quality and general"; the change takes effect after restarting the app.
- "Tracking → Tracking engine and capture" adds "Tracking processor": GPU by default, or switch to CPU, and your choice is kept after a restart.

### Improved

- With MediaPipe tracking, "Start tracking" gets going faster: the tracking models start loading while the camera opens, and the upper-body and hand models load at the same time.
- With both "Track upper body" and "Track hands and fingers" on, they no longer share the same frame, so the avatar moves more smoothly.
- The "Built-in virtual camera" now composites on the GPU, giving sharper avatar and scene edges with less CPU use; on macOS the frame rate is also steadier and closer to 30 FPS.
- When OBS is connected through a "Browser source", nothing is encoded while OBS isn't reading frames, so idle CPU use drops noticeably.
- Microphone lip sync uses less CPU and keeps the interface smoother, with a shorter hitch the first time you speak.
- Dragging and scroll-zooming avatars and props on the stage is smoother.
- Moving the mouse over the interface no longer costs extra CPU, and overall usage is lower and easier on battery.
- On startup your last avatar comes back first, without waiting for every thumbnail in the "Library" to load.
- Importing avatar folders is faster and uses less memory, and avatars and thumbnails loading during an import no longer get stuck.
- Background thumbnails on the "Appearance" tab show up faster and use less memory.
- The main window stays smoother while an update downloads, instead of redrawing on every bit of progress.
- The "About VTubeLeaf" window and the output window open faster.
- Smaller installers; the standalone OpenSeeFace package now ships only the default tracking model and is about a third smaller.
- The hint in the stage's top-left corner moved up to share a row with the tracking status on the right, leaving no empty gap.
- Pinned avatars in the "Library" show a pin badge in the top-right corner of their thumbnail, so they're easy to spot.

### Fixed

- With "Face tracking FPS" set to 24 or 15 FPS, "Upper body FPS" and "Hand tracking FPS" no longer run below their set values.

## v1.1.1 · 2026-10-10

### Added

- Right-click an avatar in the "Library" to "Pin to top" or "Unpin" it. Pinned avatars appear first and stay pinned after a restart.

### Improved

- Removed the redundant stage label from the stage's top-left corner.
- Regular hints now hide after 5 seconds; errors and hints for calibration or loading in progress stay visible.

## v1.1.0 · 2026-10-09

### Added

- The output window can now drop its background: turn on "Transparent output window" in "Connect → Quality and general" and it no longer draws the background color or image (the window reopens once when you switch it).
- Your avatar's eyes now narrow when you smile. This works by default for models with left and right eye smile parameters, with no manual binding needed.
- "Avatar scale" now goes down to 0.05 (previously 0.25), so avatars can be made much smaller.
- The first launch after an update shows what changed in this version; if you skipped a few versions, the ones in between are listed too.
- "About VTubeLeaf" adds "Release notes", where you can look back at what changed in every version.

### Improved

- When the window is hidden and nothing is tracking, using the microphone, recording or sending output, rendering pauses automatically to save background resources.
- The macOS virtual camera stops sending frames when no app is receiving them, and resumes automatically when a meeting or streaming app connects.
- Calibration instructions moved to the center of the stage, larger and easier to see, and hide automatically when done.
- The settings panel is tidier: each tab keeps the common settings up top and tucks the rest into expandable sections, with nothing removed.
- Render frame rate, HD rendering, transparent output window and "Restore defaults" moved to "Quality and general" at the bottom of the "Connect" tab.
- The preview box on the "Tracking" tab only appears after you turn on "Show tracking preview", so it takes no space otherwise.
- "Reset this model" now asks for confirmation first, so a misclick can't wipe that model's parameters, mappings and calibration all at once.
- On Windows, turning on the camera or microphone no longer pops up a prompt asking to allow camera access.
- When a new version is available, "App updates" spells out what changed instead of only showing a GitHub link.

### Fixed

- The avatar no longer suddenly grows, as if leaning into the camera, when you open your mouth to talk.
- Semi-transparent Live2D props no longer show their overlapping inner parts, and the whole prop fades in and out together.

## v1.0.7 · 2026-10-03

- No feature changes in this version; it only patches a few dependencies used for packaging and publishing.

## v1.0.6 · 2026-10-03

### Added

- Transparent OBS output: start it in "Connect → OBS" and your avatar and props go straight into OBS with a transparent background, no chroma key needed. macOS uses Syphon and Windows uses Spout2 for the lowest latency; if you'd rather not install a plugin, use a "Browser" source instead.
- "HD rendering" switch: draws the avatar with 2× supersampling for crisper lines and edges; turn it off if your GPU struggles.
- Experimental Linux support, with `.deb` and AppImage packages.
- OpenSeeFace on macOS is now a standalone windowed app, "VTubeLeaf OpenSeeFace": no Terminal needed, pick your camera by name, and it checks for and installs its own updates.
- When you choose OpenSeeFace under "Tracking", you can download the launcher package for your computer's chip right there.

### Improved

- Rendering quality settings are now gathered on the "Appearance" tab.
- Avatar animation follows your display's refresh rhythm, so frames are more evenly spaced and motion looks smoother.
- The output window's frame rate now follows the "Render frame rate" setting.

## v1.0.5 · 2026-09-27

### Added

- OpenSeeFace is now a separate download that bundles its own runtime, so you no longer need to install Python. If you don't use OpenSeeFace, you don't need to download it.
- New "Turn on mic when tracking starts" option.

### Improved

- The microphone level meter now uses colors that match the rest of the app.

## v1.0.3 · 2026-09-23

### Added

- The virtual camera adds a "Mirror output" switch that flips the output horizontally.
- A new app icon in the native system style on macOS 26.

## v1.0.0 · 2026-09-19

- The first stable release, with the same features as v0.1.20; version numbers move to 1.x from here on.

## v0.1.20 · 2026-09-18

v0.1.1 through v0.1.20 were early test builds, during which VTubeLeaf gained its core features:

- Use your camera to make a Live2D avatar blink, talk and turn its head with you, growing and shrinking as you move closer or farther away.
- Three built-in avatars, Haru, Hiyori and Mao; drag a model folder or ZIP into the window to import your own.
- Turn on upper-body tracking, finger tracking and microphone lip sync; lip sync comes with vowel presets and can also be calibrated yourself.
- Dress up the scene with images, animated images, Live2D props and built-in stream backgrounds, and save them as scenes to switch any time.
- Switch the avatar's own expressions and motions and assign hotkeys; VTube Studio model settings and hotkeys can be read in.
- Record your avatar's movements and export them, without capturing camera footage or sound.
- Bring your avatar into meeting apps with the virtual camera, or capture it in OBS with "Stream mode" or the "Output window".
- Check for, download and install updates inside the app.
