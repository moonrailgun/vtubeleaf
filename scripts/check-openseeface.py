"""Check real OpenSeeFace inference and localhost UDP using a local video/image, never a camera."""
import argparse
import math
from pathlib import Path
import socket
import struct
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Existing local video/image containing a face")
    args = parser.parse_args()
    source = args.input.resolve()
    if not source.is_file():
        parser.error("input must be an existing file; camera IDs are not accepted")
    root = Path(__file__).resolve().parent.parent
    script = root / "scripts/run-openseeface.py"
    if not (root / ".local/openseeface/facetracker.py").is_file():
        parser.error("Run npm run setup:openseeface first")

    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as receiver:
        receiver.bind(("127.0.0.1", 0))
        receiver.settimeout(1)
        process = subprocess.Popen([
            sys.executable, str(script), "--capture", str(source),
            "--ip", "127.0.0.1", "--port", str(receiver.getsockname()[1]),
            "--faces", "1", "--gaze-tracking", "0", "--visualize", "0",
            "--silent", "1", "--repeat-video", "1",
        ], cwd=script.parent, stdout=subprocess.DEVNULL)
        try:
            received, deadline = 0, time.monotonic() + 45
            while received < 3 and time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f"OpenSeeFace exited early ({process.returncode})")
                try:
                    packet, sender = receiver.recvfrom(65535)
                except socket.timeout:
                    continue
                if sender[0] != "127.0.0.1" or len(packet) != 1785:
                    raise RuntimeError("Unexpected OpenSeeFace packet")
                if struct.unpack_from("<i", packet, 8)[0] != 0 or packet[28] != 1:
                    continue
                offsets = [20, 24, 49, 53, 57, 1729 + 8 * 4, 1729 + 10 * 4, 1729 + 12 * 4]
                if not all(math.isfinite(struct.unpack_from("<f", packet, offset)[0]) for offset in offsets):
                    raise RuntimeError("Non-finite tracking parameters")
                received += 1
            if received < 3:
                raise RuntimeError("No three valid face packets within 45 seconds")
            print("OpenSeeFace inference passed: 3 valid localhost face packets; no camera used.")
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == "__main__":
    main()
