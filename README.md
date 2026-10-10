# VTubeLeaf

**English** | [简体中文](README.zh-CN.md)

<img src="public/brand/lockup-light.svg" width="360" alt="VTubeLeaf" />

VTubeLeaf is free avatar software for **Windows and macOS**, with **experimental Linux x64 support**. Using your webcam, it makes a Live2D character blink, talk and turn its head along with you — for streaming, screen recording or video calls.

Your camera feed is processed on your computer and never uploaded. Three characters are built in, so you can try it right after installing. The interface is available in English, Chinese, Japanese, Spanish and French. It follows your system language by default, or pick one under “Connect → Quality and general → Language”.

**[Download from the website](https://vtubeleaf.vercel.app/) · [Releases and downloads](https://github.com/moonrailgun/vtubeleaf/releases/latest) · [Report an issue](https://github.com/moonrailgun/vtubeleaf/issues)**

## Download and install

- **Windows**: Windows 10 or later on a 64-bit Intel / AMD PC. Download the installer and follow the prompts.
- **macOS**: macOS 14 or later, on Apple silicon or Intel. Open the disk image and drag VTubeLeaf into the Applications folder.
- **Linux (experimental)**: built against Ubuntu 22.04+ x64, shipped as `.deb` and AppImage. Downloads appear only when the matching Release has been published; you can also run from source following the [Linux build notes](docs/SETUP.md#linux-开发与打包) (Chinese). Camera and desktop compatibility still needs testing on real hardware.

On first launch, allow the app to use your camera. If you want the character's mouth to follow your microphone, allow microphone access too.

## Getting started

1. Open “Library” and pick a built-in character: **Haru, Hiyori or Mao**.
2. In “Tracking”, choose your camera and click “Start tracking”.
3. Face the camera with your eyes naturally open and mouth closed, click “Calibrate neutral pose” and hold still as prompted so the character learns your resting expression.
4. Turn your head, blink and talk to see how the character responds.
5. Drag the character on the stage with the left mouse button to move it, and use the scroll wheel to resize it. Settings are remembered per character.

Even lighting on your face helps, and keep your eyes and mouth uncovered. Recalibrate after changing your seating or camera position.

## Use your own character

Drag a complete Live2D model folder or ZIP archive into the window to add it to “Library”. You can also pick the model's `.model3.json` file — keep the other resource files next to it.

The app keeps its own copy after importing, so moving the original files won't affect the character in your library. Click a character card to switch to it.

Plain PNG or JPEG images can't become a character that follows your expressions, but you can place them on the stage as decorations. Only use models you have the rights to use; see the [model notes](vendor/models/README.md) for the sources and terms of the built-in characters.

## Streaming and video calls

### Use your character as a camera in other apps

1. In VTubeLeaf, choose a character and start tracking.
2. Open “Connect” and click “Install virtual camera”. On macOS, the first install asks you to allow the camera extension in System Settings.
3. Click “Start virtual camera”.
4. In your streaming or video call app, reopen the camera list and choose **VTubeLeaf Camera**. Keep using your usual microphone.

Virtual camera support varies between apps. If you can't find your character there, try the OBS options below.

Linux has no built-in virtual camera yet; output through OBS instead. For video calls, install `v4l2loopback`, start OBS's virtual camera and select “OBS Virtual Camera”.

### Stream or record with OBS

For a transparent background, start the transparent output in VTubeLeaf under “Connect → OBS”. Character and prop transparency is kept as-is, so no chroma key is needed; VTubeLeaf's solid color and background image are not part of this source, so add your background in OBS. There are two output methods:

- **Syphon (macOS) / Spout2 (Windows)**: the default. Shares frames with OBS directly at `1920×1080`, at the “Render frame rate” you set, with the lowest latency and overhead. On macOS, add a “Syphon Client” source in OBS, choose VTubeLeaf and tick “Allow Transparency”. On Windows, first install the [Spout2 plugin](https://github.com/Off-World-Live/obs-spout2-plugin) for OBS, then add a “Spout2 Capture” source, choose VTubeLeaf and set “Composite mode” to Premultiplied Alpha.
- **Browser source**: no plugin needed. Copy the address, add a “Browser” source in OBS and paste it, with width `1280`, height `720` and FPS `30`. Frames are served only on a local address; the actual frame rate depends on PNG encoding speed, up to 30 FPS.

Both methods need VTubeLeaf to keep running. Stopping the output clears the image, and it comes back when you start the output again.

Click “Stream mode” at the top of VTubeLeaf to hide the settings panels, then capture the VTubeLeaf window in OBS. Press `Esc` in VTubeLeaf to bring the interface back; the character keeps following you the whole time.

To adjust settings while sending video out, use the “Output window”. The “Connect” page in the app also walks you through the OBS setup.

## What else you can do

- **Richer movement**: tracks upper-body motion, with optional finger tracking or microphone lip sync. The character needs to support those motions.
- **Build your own scene**: add images, animated GIFs or Live2D props, save them as scenes and switch any time.
- **Expressions and motions**: trigger the character's own expressions and motions, with hotkeys if you like.
- **Record motions**: record and export your character's movements manually. Your camera image and voice are never recorded.

## Updating

Click the version number at the bottom of the main window and choose “Check for updates”. When a new version is available, click “Download update”, then “Install and restart” when it's ready. Save any unsaved motion recording first — updating stops tracking and the virtual camera.

The app checks for updates automatically by default, but downloading and installing are always up to you, and you can turn automatic checks off. Older versions without the update option can be reinstalled from the [website](https://vtubeleaf.vercel.app/).

## FAQ

**My camera won't open.**

Check that your system settings allow VTubeLeaf to use the camera, and that no other app is using it. Then reselect the device in “Tracking” and try again.

**The character doesn't move, or its expressions look off.**

Make sure you clicked “Start tracking” and that your face is in frame and well lit. Recalibrate with a relaxed expression. If only one part doesn't move, the character itself may not include that motion.

**Importing a character says files are missing.**

Use the complete model folder or archive. The `.model3.json` file alone isn't enough — the character also needs its textures and other files.

## Feedback and contributing

Found a problem or have a feature idea? [Open an issue](https://github.com/moonrailgun/vtubeleaf/issues). Please include your OS version, app version and what you did before the problem appeared; screenshots help a lot.

To help with development, documentation or testing, see the [contributing guide](CONTRIBUTING.md).

Community: [**linux.do**](http://linux.do)

## License

VTubeLeaf's own code is released under the [MIT License](LICENSE). Character assets and third-party components have their own terms; see the [model notes](vendor/models/README.md) and [third-party licenses](docs/THIRD_PARTY.md).
