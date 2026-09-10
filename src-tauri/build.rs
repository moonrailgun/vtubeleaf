use std::{env, path::PathBuf, process::Command};

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        assert_eq!(
            env::var("CARGO_CFG_TARGET_ARCH").as_deref(),
            Ok("x86_64"),
            "The Windows app currently targets x64"
        );
        // Keep ordinary Windows paths: CMake/MSBuild mishandles canonicalize's \\?\ prefix.
        let native = std::path::absolute("../native/windows-camera").unwrap();
        let output = PathBuf::from(env::var_os("OUT_DIR").unwrap()).join("windows-camera");
        for file in [
            "CMakeLists.txt",
            "Frame.h",
            "Host.cpp",
            "Filter.cpp",
            "Camera.def",
            "vendor",
        ] {
            println!("cargo:rerun-if-changed={}", native.join(file).display());
        }
        for (arch, platform) in [("x64", "x64"), ("x86", "Win32")] {
            let build = output.join(arch);
            let status = Command::new("cmake")
                .arg("-S")
                .arg(&native)
                .arg("-B")
                .arg(&build)
                .args(["-A", platform, "-DBUILD_TESTING=OFF"])
                .status()
                .expect("Install Visual Studio C++ Build Tools and CMake");
            assert!(
                status.success(),
                "Could not configure the Windows camera ({arch})"
            );
            let status = Command::new("cmake")
                .arg("--build")
                .arg(&build)
                .args(["--config", "Release", "--parallel"])
                .status()
                .unwrap();
            assert!(
                status.success(),
                "Could not compile the Windows camera ({arch})"
            );
            let resources = native.join("bin").join(arch);
            std::fs::create_dir_all(&resources).unwrap();
            std::fs::copy(
                build.join("Release/VTubeLeafCamera.dll"),
                resources.join("VTubeLeafCamera.dll"),
            )
            .unwrap();
        }
        println!(
            "cargo:rustc-link-search=native={}",
            output.join("x64/Release").display()
        );
        println!("cargo:rustc-link-lib=static=VTubeLeafCameraHost");
        println!("cargo:rustc-link-lib=advapi32");
        println!("cargo:rustc-link-lib=libcpmt");
    }
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let native = PathBuf::from("../native/macos-camera");
        let output = PathBuf::from(env::var_os("OUT_DIR").unwrap());
        let arch = match env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
            Ok("aarch64") => "arm64",
            Ok("x86_64") => "x86_64",
            _ => panic!("Unsupported macOS camera architecture"),
        };
        for file in ["Frame.swift", "Host.swift"] {
            println!("cargo:rerun-if-changed={}", native.join(file).display());
        }
        let result = Command::new("xcrun")
            .args([
                "swiftc",
                "-swift-version",
                "5",
                "-O",
                "-target",
                &format!("{arch}-apple-macos14.0"),
                "-emit-library",
                "-static",
                "-module-name",
                "VTubeLeafCamera",
            ])
            .arg(native.join("Frame.swift"))
            .arg(native.join("Host.swift"))
            .arg("-o")
            .arg(output.join("libVTubeLeafCamera.a"))
            .status()
            .expect("Xcode swiftc is required for the macOS camera bridge");
        assert!(
            result.success(),
            "Could not compile the macOS camera bridge"
        );
        println!("cargo:rustc-link-search=native={}", output.display());
        println!("cargo:rustc-link-lib=static=VTubeLeafCamera");
        println!("cargo:rustc-link-search=native=/usr/lib/swift");
        // Swift's object autolink directives resolve its runtime libraries from the toolchain.
        let swift = Command::new("xcrun")
            .args(["--find", "swiftc"])
            .output()
            .unwrap();
        let swift_path = PathBuf::from(String::from_utf8(swift.stdout).unwrap().trim());
        println!(
            "cargo:rustc-link-search=native={}",
            swift_path
                .parent()
                .unwrap()
                .join("../lib/swift/macosx")
                .display()
        );
        for framework in [
            "Foundation",
            "CoreMedia",
            "CoreVideo",
            "CoreMediaIO",
            "SystemExtensions",
            "Accelerate",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }
    tauri_build::try_build(tauri_build::Attributes::new().plugin(
        "virtual-camera",
        tauri_build::InlinedPlugin::new()
            .commands(&["status", "install", "uninstall", "start", "stop", "submit"]),
    ))
    .expect("Could not build Tauri permissions")
}
