"""Wrap a frozen macOS tracker in a relocatable native app, without launching Terminal."""
import argparse
import base64
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
from sparkle import prepare

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("tracker", type=Path, help="Frozen PyInstaller directory")
parser.add_argument("app", type=Path, help="New output .app path")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
tracker = args.tracker.resolve(strict=True)
app = args.app.resolve()
if app.exists() or app.suffix != ".app":
    raise SystemExit("Output must be a new .app path")
arch = subprocess.check_output(["lipo", "-archs", str(tracker / "facetracker")], text=True).strip()
if arch not in ("arm64", "x86_64"):
    raise SystemExit(f"Expected one native tracker architecture, got {arch}")
version = json.loads((root / "package.json").read_text())["version"]
minimum = json.loads((root / "src-tauri/tauri.conf.json").read_text())["bundle"]["macOS"]["minimumSystemVersion"]
public_key = os.environ.get("OPENSEEFACE_SPARKLE_PUBLIC_KEY", "").strip()
try:
    valid_key = not public_key or len(base64.b64decode(public_key, validate=True)) == 32
except ValueError:
    valid_key = False
if not valid_key:
    raise SystemExit("OPENSEEFACE_SPARKLE_PUBLIC_KEY must be a base64 Ed25519 public key")
sparkle = prepare()
contents = app / "Contents"
(contents / "MacOS").mkdir(parents=True)
(contents / "Resources").mkdir()
# PyInstaller mixes libraries and data; preserve its layout in Resources instead
# of a code-only bundle slot. sign-openseeface.py signs every embedded Mach-O.
shutil.copytree(tracker, contents / "Resources/OpenSeeFace", symlinks=True,
                ignore=shutil.ignore_patterns("Start OpenSeeFace.command"))
shutil.copy2(root / "src-tauri/icons/icon.icns", contents / "Resources/icon.icns")
shutil.copytree(sparkle / "Sparkle.framework", contents / "Frameworks/Sparkle.framework", symlinks=True)
shutil.copy2(sparkle / "LICENSE", contents / "Resources/Sparkle-LICENSE.txt")
(contents / "Info.plist").write_bytes(plistlib.dumps({
    "CFBundleName": "VTubeLeaf OpenSeeFace",
    "CFBundleDisplayName": "VTubeLeaf OpenSeeFace",
    "CFBundleIdentifier": "com.moonrailgun.vtubeleaf.openseeface",
    "CFBundlePackageType": "APPL",
    "CFBundleExecutable": "VTubeLeafOpenSeeFace",
    "CFBundleShortVersionString": version,
    "CFBundleVersion": version,
    "CFBundleIconFile": "icon.icns",
    "LSMinimumSystemVersion": minimum,
    "NSHighResolutionCapable": True,
    "NSCameraUsageDescription": "OpenSeeFace 使用摄像头在本机进行面部追踪，并将结果发送给 VTubeLeaf。",
    # Local builds without a release key do not contact the production update feed.
    **({
        "SUPublicEDKey": public_key,
        "SUFeedURL": "https://github.com/moonrailgun/vtubeleaf/releases/latest/download/"
                     f"openseeface-{'aarch64' if arch == 'arm64' else arch}.xml",
        "SUEnableAutomaticChecks": True,
        "SUAllowsAutomaticUpdates": False,
        "SUVerifyUpdateBeforeExtraction": True,
        "SURequireSignedFeed": True,
    } if public_key else {}),
}))
subprocess.run([
    "xcrun", "swiftc", "-swift-version", "5", "-O", "-parse-as-library",
    "-F", str(sparkle), "-framework", "Sparkle",
    "-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks",
    "-target", f"{arch}-apple-macos{minimum}",
    str(root / "native/openseeface/Launcher.swift"),
    "-o", str(contents / "MacOS/VTubeLeafOpenSeeFace"),
], check=True)
print(f"Built native OpenSeeFace app: {app}")
