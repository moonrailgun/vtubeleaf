"""Run OpenSeeFace with the CPU provider, optionally prompting for camera and port."""
from pathlib import Path
import os
import runpy
import sys


def launcher_arguments():
    print("VTubeLeaf OpenSeeFace - independent tracker\nSelect OpenSeeFace in VTubeLeaf and start receiving.\nPress Enter for defaults; Ctrl+C stops and releases the camera.", flush=True)
    values = []
    for label, default, low, high in (("Camera", 0, 0, 32), ("UDP port", 11573, 1024, 65535)):
        while True:
            try:
                value = int(input(f"{label} [{default}]: ").strip() or default)
                if low <= value <= high:
                    values.append(str(value))
                    break
            except ValueError:
                pass
            print(f"Enter a whole number from {low} to {high}.", flush=True)
    camera, port = values
    print(f"Starting camera {camera} -> 127.0.0.1:{port}. Allow camera access if prompted.", flush=True)
    return ["--ip", "127.0.0.1", "--port", port, "--capture", camera,
            "--faces", "1", "-F", "24", "-W", "640", "-H", "360",
            "--gaze-tracking", "0", "--visualize", "0", "--silent", "1"]


def main():
    if sys.argv[1:] == ["--launcher"]:
        sys.argv[1:] = launcher_arguments()
    import onnxruntime

    session = onnxruntime.InferenceSession

    def cpu_session(*args, **kwargs):
        # Pinned upstream selects every provider; CoreML stalls on this model on macOS.
        kwargs["providers"] = ["CPUExecutionProvider"]
        return session(*args, **kwargs)

    onnxruntime.InferenceSession = cpu_session
    if getattr(sys, "frozen", False):
        import facetracker  # Bundled by PyInstaller; upstream runs at import time.
        return

    script = Path(__file__).resolve().parent.parent / ".local/openseeface/facetracker.py"
    if not script.is_file():
        raise SystemExit("Run npm run setup:openseeface first")
    sys.path.insert(0, str(script.parent))
    sys.argv[0] = str(script)
    os.chdir(script.parent)
    runpy.run_path(str(script), run_name="__main__")


if __name__ == "__main__":
    try:
        main()
    except (KeyboardInterrupt, EOFError):
        print("\nOpenSeeFace stopped.")
