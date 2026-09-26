"""The launcher rejects invalid input and emits only local tracking arguments."""
import runpy
from pathlib import Path
from unittest.mock import patch

launcher = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/run-openseeface.py"))

with patch("builtins.input", side_effect=["", ""]):
    args = launcher["launcher_arguments"]()
assert args[:6] == ["--ip", "127.0.0.1", "--port", "11573", "--capture", "0"]
with patch("builtins.input", side_effect=["-1", "33", "$(touch x)", "2", "0", "65536", "12000"]):
    args = launcher["launcher_arguments"]()
assert args[:6] == ["--ip", "127.0.0.1", "--port", "12000", "--capture", "2"]
assert args[6:] == ["--faces", "1", "-F", "24", "-W", "640", "-H", "360", "--gaze-tracking", "0", "--visualize", "0", "--silent", "1"]
print("OpenSeeFace launcher checks passed")
