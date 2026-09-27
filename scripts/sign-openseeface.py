"""Sign the independent macOS tracker code inside-out before packaging it."""
import argparse
from pathlib import Path
import plistlib
import subprocess


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("directory", type=Path)
parser.add_argument("--identity", default="-", help="Developer ID identity, or ad-hoc for local checks")
args = parser.parse_args()
directory = args.directory.resolve(strict=True)
magics = {bytes.fromhex(value) for value in ("feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca")}
paths = []
for path in directory.rglob("*"):
    if path.is_symlink():
        continue
    if path.is_dir() and path.suffix in (".framework", ".app"):
        paths.append(path)
    elif path.is_file():
        with path.open("rb") as handle:
            if handle.read(4) in magics:
                paths.append(path)
if directory.suffix == ".app":
    paths.append(directory)
# Signing an app also signs its main executable; defer that until all nested code.
app_executables = {
    path / "Contents/MacOS" / plistlib.loads((path / "Contents/Info.plist").read_bytes())["CFBundleExecutable"]
    for path in paths if path.suffix == ".app"
}
paths = [path for path in paths if path not in app_executables]
if not any(path.name == "facetracker" for path in paths):
    raise SystemExit("No OpenSeeFace executable to sign")
for path in sorted(paths, key=lambda value: len(value.parts), reverse=True):
    command = ["codesign", "--force", "--sign", args.identity]
    if args.identity != "-":
        command += ["--options", "runtime", "--timestamp"]
    if path.name == "facetracker" or path.suffix == ".app":
        command += ["--entitlements", str(Path(__file__).resolve().parent.parent / "src-tauri/Entitlements.plist")]
    subprocess.run(command + [str(path)], check=True)
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(path)], check=True)
print(f"Signed and verified {len(paths)} OpenSeeFace code objects")
