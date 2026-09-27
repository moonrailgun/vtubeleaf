"""Fetch the pinned official Sparkle distribution, verified before extraction."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import tempfile

VERSION = "2.10.0"
SHA256 = "c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c"


def prepare():
    cache = Path(__file__).resolve().parents[1] / ".local/sparkle"
    destination = cache / VERSION
    if (destination / ".verified").is_file() and (destination / ".verified").read_text() == SHA256:
        return destination
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / f"{VERSION}.tar.xz"
    if not archive.exists() or hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        subprocess.run(["curl", "--fail", "--location", "--retry", "3", "--max-time", "300",
                        f"https://github.com/sparkle-project/Sparkle/releases/download/{VERSION}/Sparkle-{VERSION}.tar.xz",
                        "--output", str(archive)], check=True)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        raise SystemExit("Sparkle download checksum mismatch")
    with tempfile.TemporaryDirectory(dir=cache) as temporary:
        subprocess.run(["tar", "-xJf", str(archive), "-C", temporary], check=True)
        if destination.exists():
            shutil.rmtree(destination)
        shutil.move(temporary, destination)
    (destination / ".verified").write_text(SHA256)
    return destination


if __name__ == "__main__":
    print(prepare())
