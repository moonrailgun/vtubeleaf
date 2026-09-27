"""macOS: verify the built GUI launcher, its relocatable tracker and code signature."""
import plistlib
from pathlib import Path
import os
import shlex
import signal
import shutil
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
app = Path(sys.argv[1]).resolve()
assert app.is_dir(), f"Missing double-clickable OpenSeeFace application: {app}"
info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
assert info["CFBundlePackageType"] == "APPL"
assert info["CFBundleName"] == info["CFBundleDisplayName"] == "VTubeLeaf OpenSeeFace"
frameworks = app / "Contents/Frameworks"
assert (frameworks / "Sparkle.framework/Sparkle").is_file()
if "SUPublicEDKey" in info:
    arch = subprocess.check_output(["lipo", "-archs", str(app / "Contents/MacOS" / info["CFBundleExecutable"])], text=True).strip()
    assert info["SUFeedURL"].endswith(f"/openseeface-{'aarch64' if arch == 'arm64' else arch}.xml")
    assert info["SUEnableAutomaticChecks"] and info["SURequireSignedFeed"] and info["SUVerifyUpdateBeforeExtraction"]
    assert not info["SUAllowsAutomaticUpdates"]
assert info["NSCameraUsageDescription"]
assert (app / "Contents/MacOS" / info["CFBundleExecutable"]).is_file()
tracker = app / "Contents/Resources/OpenSeeFace/facetracker"
subprocess.run([str(tracker), "--help"], cwd="/", check=True, stdout=subprocess.DEVNULL)
subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)

with tempfile.TemporaryDirectory(prefix="openseeface checks ") as temporary:
    test_app = Path(temporary) / "QuitCheck.app"
    executable = test_app / "Contents/MacOS/launcher-check"
    executable.parent.mkdir(parents=True)
    shutil.copytree(frameworks, test_app / "Contents/Frameworks", symlinks=True)
    (test_app / "Contents/Info.plist").write_bytes(plistlib.dumps({
        "CFBundleIdentifier": "com.moonrailgun.vtubeleaf.openseeface.test",
        "CFBundleExecutable": "launcher-check", "CFBundlePackageType": "APPL",
    }))
    subprocess.run([
        "xcrun", "swiftc", "-swift-version", "5", "-D", "TESTING", "-parse-as-library",
        "-F", str(frameworks), "-framework", "Sparkle",
        "-Xlinker", "-rpath", "-Xlinker", "@executable_path/../Frameworks",
        str(root / "native/openseeface/Launcher.swift"),
        str(root / "tests/openseeface-launcher.swift"), "-o", str(executable),
    ], check=True)
    failure = subprocess.run([str(executable), "--failure-check"], capture_output=True, text=True, timeout=5)
    assert failure.returncode == 1 and "Expected test failure" in failure.stderr, \
        "A failed test must exit normally instead of triggering macOS Crash Reporter"
    subprocess.run([str(executable), *sys.argv[2:]], check=True, timeout=30)

    # Quitting must reap even a stuck tracker before the app exits. Never open a camera.
    fake_tracker = test_app / "Contents/Resources/OpenSeeFace/facetracker"
    fake_tracker.parent.mkdir(parents=True, exist_ok=True)
    pid_file = Path(temporary) / "tracker.pid"
    fake_tracker.write_text("#!/bin/sh\ntrap '' INT TERM\n"
                            f"echo $$ > {shlex.quote(str(pid_file))}\nwhile :; do :; done\n")
    fake_tracker.chmod(0o755)
    try:
        subprocess.run([str(executable), "--quit-check"], check=True, timeout=12)
        pid = int(pid_file.read_text())
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            pass
        else:
            raise AssertionError("Quitting left the tracker running")
    finally:
        if pid_file.exists():
            try:
                os.kill(int(pid_file.read_text()), signal.SIGKILL)
            except ProcessLookupError:
                pass

print("OpenSeeFace app checks passed: bundle, relocated tracker, signature, process lifecycle and quit")
