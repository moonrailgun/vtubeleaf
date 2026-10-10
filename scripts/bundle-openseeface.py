"""Build the independent, relocatable OpenSeeFace launch package."""
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
if arch is None or sys.platform not in ("darwin", "win32", "linux") or (sys.platform != "darwin" and arch != "x86_64"):
    raise SystemExit("OpenSeeFace bundles support macOS arm64/x86_64, Windows x64 and Linux x64")

# Launchers never pass --model, --model-dir or --benchmark, so tracker.py loads only these.
models = ("lm_model3_opt.onnx", "retinaface_640x640_opt.onnx", "priorbox_640x640.json",
          "mnv3_gaze32_split_opt.onnx", "mnv3_detection_opt.onnx")
command = [
    sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
    "--name", "facetracker", "--distpath", str(work / "dist"),
    "--workpath", str(work / "build"), "--specpath", str(work), "--paths", str(source),
    *(arg for name in models for arg in ("--add-data", f"{source / 'models' / name}:models")),
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
if sys.platform == "win32":
    (bundle / "Start OpenSeeFace.cmd").write_bytes(b'@echo off\r\ncd /d "%~dp0"\r\nfacetracker.exe --launcher\r\npause\r\n')
shutil.copy2(root / "scripts/openseeface-README.txt", bundle / "README.txt")
licenses = bundle / "licenses"
shutil.copy2(root / "LICENSE", bundle / "VTubeLeaf-LICENSE.txt")
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
if sys.platform == "darwin":
    target.mkdir(parents=True)
    app = target / "VTubeLeaf OpenSeeFace.app"
    subprocess.run([sys.executable, str(root / "scripts/build-openseeface-app.py"), str(bundle), str(app)], check=True)
    subprocess.run([sys.executable, str(root / "scripts/sign-openseeface.py"), str(target)], check=True)
    executable = app / "Contents/Resources/OpenSeeFace/facetracker"
else:
    shutil.copytree(bundle, target, symlinks=True)
    executable = target / ("facetracker.exe" if sys.platform == "win32" else "facetracker")
subprocess.run([str(executable), "--help"], cwd=target, check=True, stdout=subprocess.DEVNULL)
print(f"Bundled OpenSeeFace ({arch}): {executable}")
