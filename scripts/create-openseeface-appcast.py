"""Sign independent, architecture-specific Sparkle feeds from the notarized DMGs."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as ET
from sparkle import prepare

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("directory", type=Path)
parser.add_argument("tag")
args = parser.parse_args()
if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?", args.tag):
    parser.error("Expected a VTubeLeaf version tag")
key = os.environ.get("OPENSEEFACE_SPARKLE_PRIVATE_KEY", "").strip()
if not key:
    raise SystemExit("Missing OPENSEEFACE_SPARKLE_PRIVATE_KEY")
sparkle = prepare()
directory = args.directory.resolve(strict=True)
namespace = "{http://www.andymatuschak.org/xml-namespaces/sparkle}"
for arch in ("aarch64", "x86_64"):
    archive = directory / f"VTubeLeaf-OpenSeeFace-{args.tag[1:]}-macos-{arch}.dmg"
    with tempfile.TemporaryDirectory(prefix="openseeface-feed-") as temporary:
        shutil.copy2(archive, Path(temporary) / archive.name)
        feed = Path(temporary) / "appcast.xml"
        # Never expose the private key in argv. Sparkle skips archives on key
        # mismatch without failing, so validate its output before publishing it.
        subprocess.run([
            str(sparkle / "bin/generate_appcast"), "--ed-key-file", "-",
            "--maximum-deltas", "0", "--maximum-versions", "1",
            "--download-url-prefix", f"https://github.com/moonrailgun/vtubeleaf/releases/download/{args.tag}/",
            "-o", str(feed), temporary,
        ], input=key, text=True, check=True)
        items = ET.parse(feed).findall("./channel/item")
        if len(items) != 1 or items[0].findtext(f"{namespace}version") != args.tag[1:]:
            raise SystemExit(f"Missing signed update for {arch}; check Sparkle keys and bundle version")
        enclosure = items[0].find("enclosure")
        signature = enclosure.get(f"{namespace}edSignature") if enclosure is not None else None
        if not signature:
            raise SystemExit(f"Unsigned update for {arch}; check Sparkle keys")
        for path, signatures in ((archive, [signature]), (feed, [])):
            subprocess.run([str(sparkle / "bin/sign_update"), "--verify", "--ed-key-file", "-",
                            str(path), *signatures], input=key, text=True, check=True)
        shutil.copy2(feed, directory / f"openseeface-{arch}.xml")
