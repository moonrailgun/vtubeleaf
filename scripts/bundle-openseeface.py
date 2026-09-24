"""Freeze the verified local checkout into a relocatable, CPU-only tracker."""
import importlib.metadata
import json
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import sysconfig


root = Path(__file__).resolve().parent.parent
source = root / ".local/openseeface"
work = root / ".local/openseeface-build"
arch = {"arm64": "aarch64", "aarch64": "aarch64", "amd64": "x86_64", "x86_64": "x86_64"}.get(platform.machine().lower())
if arch is None or sys.platform not in ("darwin", "win32") or (sys.platform == "win32" and arch != "x86_64"):
    raise SystemExit("OpenSeeFace bundles support macOS arm64/x86_64 and Windows x64")

command = [
    sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
    "--name", "facetracker", "--distpath", str(work / "dist"),
    "--workpath", str(work / "build"), "--specpath", str(work),
    "--paths", str(source), "--add-data", f"{source / 'models'}:models",
    # These are optional training/GUI dependencies, not needed for tracking.
    "--exclude-module", "torch", "--exclude-module", "matplotlib",
    "--exclude-module", "scipy", "--exclude-module", "tkinter",
]
if sys.platform == "win32":
    for folder, dll in (("dshowcapture", "dshowcapture_x64.dll"), ("escapi", "escapi_x64.dll")):
        command += ["--add-binary", f"{source / folder / dll}:{folder}"]
command.append(str(root / "scripts/run-openseeface.py"))
subprocess.run(command, check=True, cwd=root)
bundle = work / "dist/facetracker"
licenses = bundle / "licenses"
shutil.copytree(source / "Licenses", licenses / "OpenSeeFace", dirs_exist_ok=True)
shutil.copy2(source / "LICENSE", licenses / "OpenSeeFace/LICENSE")
shutil.copy2(source / "README.md", licenses / "OpenSeeFace/README.md")
python_license = next((p for p in (
    Path(sysconfig.get_path("stdlib")) / "LICENSE.txt",
    Path(sys.base_prefix) / "LICENSE.txt",
) if p.is_file()), None)
if python_license is None:
    raise SystemExit("Python LICENSE.txt is required for redistribution")
shutil.copy2(python_license, licenses / "Python.txt")
packages = {}
for distribution in importlib.metadata.distributions():
    name = distribution.metadata["Name"]
    packages[name] = distribution.version
    for file in distribution.files or []:
        if any(word in str(file).lower() for word in ("license", "copying", "notice")):
            original = Path(distribution.locate_file(file))
            if original.is_file() and ".." not in file.parts:
                destination = licenses / name / str(file)
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(original, destination)
(bundle / "BUILD.json").write_text(json.dumps({
    "openseeface": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip(),
    "python": platform.python_version(), "platform": sys.platform, "arch": arch, "packages": packages,
}, indent=2) + "\n", encoding="utf-8")
target = root / ".local/openseeface-bundle" / arch
if target.exists():
    shutil.rmtree(target)
shutil.copytree(bundle, target, symlinks=True)
executable = target / ("facetracker.exe" if sys.platform == "win32" else "facetracker")
subprocess.run([str(executable), "--help"], cwd=target, check=True, stdout=subprocess.DEVNULL)
print(f"Bundled OpenSeeFace ({arch}): {executable}")
