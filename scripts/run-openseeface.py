"""Run the pinned local OpenSeeFace checkout with ONNX Runtime's CPU provider."""
from pathlib import Path
import os
import runpy
import sys

import onnxruntime


def main():
    script = Path(__file__).resolve().parent.parent / ".local/openseeface/facetracker.py"
    if not script.is_file():
        raise SystemExit("Run npm run setup:openseeface first")

    session = onnxruntime.InferenceSession

    def cpu_session(*args, **kwargs):
        # Pinned upstream selects every provider; CoreML stalls on this model on macOS.
        kwargs["providers"] = ["CPUExecutionProvider"]
        return session(*args, **kwargs)

    onnxruntime.InferenceSession = cpu_session
    sys.path.insert(0, str(script.parent))
    sys.argv[0] = str(script)
    os.chdir(script.parent)
    runpy.run_path(str(script), run_name="__main__")


if __name__ == "__main__":
    main()
