"""Sign the independent macOS tracker code inside-out before packaging it."""
import argparse
from pathlib import Path
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
    if path.is_dir() and path.suffix == ".framework":
        paths.append(path)
    elif path.is_file():
        with path.open("rb") as handle:
            if handle.read(4) in magics:
                paths.append(path)
if not any(path.name == "facetracker" for path in paths):
    raise SystemExit("No OpenSeeFace executable to sign")
for path in sorted(paths, key=lambda value: len(value.parts), reverse=True):
    command = ["codesign", "--force", "--sign", args.identity]
    if args.identity != "-":
        command += ["--options", "runtime", "--timestamp"]
    if path.name == "facetracker":
        command += ["--entitlements", str(Path(__file__).resolve().parent.parent / "src-tauri/Entitlements.plist")]
    subprocess.run(command + [str(path)], check=True)
    subprocess.run(["codesign", "--verify", "--strict", str(path)], check=True)
print(f"Signed and verified {len(paths)} OpenSeeFace code objects")
