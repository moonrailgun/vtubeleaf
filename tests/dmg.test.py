"""macOS smoke check: python tests/dmg.test.py (requires dmgbuild)."""

import plistlib
import shutil
import subprocess
import tempfile
from pathlib import Path

from dmgbuild import build_dmg
from ds_store import DSStore


with tempfile.TemporaryDirectory(prefix="vtubeleaf dmg ") as temporary:
    root = Path(temporary)
    app = root / "VTubeLeaf.app"
    contents = app / "Contents"
    contents.mkdir(parents=True)
    resources = contents / "Resources"
    resources.mkdir()
    payload = b"DMG packaging smoke check\n"
    (resources / "payload").write_bytes(payload)
    (resources / "payload-link").symlink_to("payload")
    (contents / "MacOS").mkdir()
    shutil.copy("/usr/bin/true", contents / "MacOS/VTubeLeaf")
    (contents / "Info.plist").write_bytes(
        plistlib.dumps({
            "CFBundleName": "VTubeLeaf",
            "CFBundlePackageType": "APPL",
            "CFBundleIdentifier": "com.moonrailgun.vtubeleaf.dmg-test",
            "CFBundleExecutable": "VTubeLeaf",
        })
    )
    subprocess.run(["codesign", "--force", "--sign", "-", str(app)], check=True)
    dmg = root / "VTubeLeaf test.dmg"
    build_dmg(
        str(dmg),
        "VTubeLeaf",
        settings_file="scripts/dmg-settings.py",
        defines={"app": str(app)},
    )
    mount = root / "mounted"
    subprocess.run(
        ["hdiutil", "attach", "-readonly", "-nobrowse", "-mountpoint", str(mount), str(dmg)],
        check=True,
        stdout=subprocess.DEVNULL,
    )
    try:
        subprocess.run(
            ["codesign", "--verify", "--deep", "--strict", str(mount / "VTubeLeaf.app")],
            check=True,
        )
        assert (mount / "VTubeLeaf.app/Contents/Resources/payload").read_bytes() == payload
        assert (mount / "VTubeLeaf.app/Contents/Resources/payload-link").readlink() == Path("payload")
        assert (mount / "Applications").readlink() == Path("/Applications")
        assert (mount / ".VolumeIcon.icns").read_bytes() == Path("src-tauri/icons/icon.icns").read_bytes()
        assert (mount / ".background.tiff").stat().st_size > 0
        with DSStore.open(str(mount / ".DS_Store"), "r") as store:
            assert store["VTubeLeaf.app"]["Iloc"] == (180, 210)
            assert store["Applications"]["Iloc"] == (540, 210)
            window = store["."]["bwsp"]
            assert window["WindowBounds"] == "{{160, 160}, {720, 440}}"
            assert not window["ShowToolbar"]
            assert not window["ShowSidebar"]
            view = store["."]["icvp"]
            assert view["backgroundType"] == 2
            assert view["iconSize"] == 112
            assert view["arrangeBy"] == "none"
    finally:
        subprocess.run(["hdiutil", "detach", str(mount)], check=True, stdout=subprocess.DEVNULL)

print("DMG smoke check passed: app signature, contents, symlinks, icon, background and Finder layout.")
