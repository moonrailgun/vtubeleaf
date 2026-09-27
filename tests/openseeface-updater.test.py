"""macOS: exercise the real bundle/feed builders and reject tampered updates.

Uses disposable keys and a tiny tracker; never accesses the camera or installs an update.
Run: python3 tests/openseeface-updater.test.py
"""
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root / "scripts"))
from sparkle import prepare

sparkle = prepare()
namespace = "{http://www.andymatuschak.org/xml-namespaces/sparkle}"
version = json.loads((root / "package.json").read_text())["version"]
with tempfile.TemporaryDirectory(prefix="openseeface updater ") as temporary:
    directory = Path(temporary)
    # Ephemeral keys stay in this process, never in the user's Keychain or logs.
    keys = json.loads(subprocess.check_output([
        "xcrun", "swift", "-e", 'import CryptoKit; import Foundation; '
        'let k = Curve25519.Signing.PrivateKey(); '
        'print(String(data: try! JSONSerialization.data(withJSONObject: '
        '["private": k.rawRepresentation.base64EncodedString(), '
        '"public": k.publicKey.rawRepresentation.base64EncodedString()]), encoding: .utf8)!)',
    ], text=True))
    env = {**os.environ, "OPENSEEFACE_SPARKLE_PUBLIC_KEY": keys["public"],
           "OPENSEEFACE_SPARKLE_PRIVATE_KEY": keys["private"]}
    tracker = directory / "tracker"
    tracker.mkdir()
    subprocess.run(["xcrun", "clang", "-x", "c", "-", "-o", str(tracker / "facetracker")],
                   input="int main(void) { return 0; }", text=True, check=True)
    payload = directory / "payload"
    app = payload / "VTubeLeaf OpenSeeFace.app"
    subprocess.run([sys.executable, str(root / "scripts/build-openseeface-app.py"),
                    str(tracker), str(app)], env=env, check=True)
    info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
    arch = subprocess.check_output(["lipo", "-archs", str(tracker / "facetracker")], text=True).strip()
    assert info["CFBundleName"] == "VTubeLeaf OpenSeeFace"
    assert info["SUPublicEDKey"] == keys["public"]
    assert info["SUFeedURL"].endswith(f"/openseeface-{'aarch64' if arch == 'arm64' else arch}.xml")
    assert info["SURequireSignedFeed"] and info["SUVerifyUpdateBeforeExtraction"]
    assert info["SUEnableAutomaticChecks"] and not info["SUAllowsAutomaticUpdates"]
    invalid = subprocess.run([sys.executable, str(root / "scripts/build-openseeface-app.py"),
                              str(tracker), str(directory / "invalid.app")],
                             env={**env, "OPENSEEFACE_SPARKLE_PUBLIC_KEY": "invalid"}, capture_output=True)
    assert invalid.returncode and not (directory / "invalid.app").exists()
    subprocess.run([sys.executable, str(root / "scripts/sign-openseeface.py"), str(app)], check=True)
    first = directory / f"VTubeLeaf-OpenSeeFace-{version}-macos-aarch64.dmg"
    subprocess.run(["hdiutil", "create", "-quiet", "-fs", "HFS+", "-format", "UDZO",
                    "-srcfolder", str(payload), str(first)], check=True)
    shutil.copy2(first, directory / f"VTubeLeaf-OpenSeeFace-{version}-macos-x86_64.dmg")
    command = [sys.executable, str(root / "scripts/create-openseeface-appcast.py"), str(directory), f"v{version}"]
    missing = subprocess.run(command, env={**env, "OPENSEEFACE_SPARKLE_PRIVATE_KEY": ""}, capture_output=True)
    assert missing.returncode and b"Missing OPENSEEFACE_SPARKLE_PRIVATE_KEY" in missing.stderr
    wrong = subprocess.run(command, env={**env, "OPENSEEFACE_SPARKLE_PRIVATE_KEY": "A" * 43 + "="}, capture_output=True)
    assert wrong.returncode, "Mismatched signing key was accepted"
    subprocess.run(command, env=env, check=True)

    def verify(path, signature=None):
        return subprocess.run([str(sparkle / "bin/sign_update"), "--verify", "--ed-key-file", "-",
                               str(path), *([signature] if signature else [])],
                              input=keys["private"], text=True, capture_output=True).returncode

    for architecture in ("aarch64", "x86_64"):
        feed = directory / f"openseeface-{architecture}.xml"
        archive = directory / f"VTubeLeaf-OpenSeeFace-{version}-macos-{architecture}.dmg"
        items = ET.parse(feed).findall("./channel/item")
        assert len(items) == 1
        assert items[0].findtext(f"{namespace}version") == version
        enclosure = items[0].find("enclosure")
        assert enclosure.get("url") == f"https://github.com/moonrailgun/vtubeleaf/releases/download/v{version}/{archive.name}"
        assert int(enclosure.get("length")) == archive.stat().st_size
        signature = enclosure.get(f"{namespace}edSignature")
        assert signature and verify(archive, signature) == 0 and verify(feed) == 0
        with archive.open("ab") as handle:
            handle.write(b"tampered")
        assert verify(archive, signature) != 0, "Tampered archive was accepted"
        feed.write_bytes(feed.read_bytes().replace(b"https://github.com/", b"https://example.com/"))
        assert verify(feed) != 0, "Tampered feed was accepted"

print("OpenSeeFace updater checks passed: bundle, feeds, signatures and tamper rejection")
