use serde::{Deserialize, Serialize};
use tauri::{ipc::InvokeBody, plugin::TauriPlugin, Runtime, WebviewWindow};

const FRAME_BYTES: usize = 1280 * 720 * 4;

#[derive(Clone, Deserialize, Serialize)]
pub struct CameraStatus {
    supported: bool,
    installed: bool,
    active: bool,
    message: String,
}

fn require_main<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("虚拟摄像头仅允许从工作台控制".into())
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
extern "C" {
    fn vtubeleaf_camera_command(
        operation: i32,
        output: *mut std::ffi::c_char,
        capacity: usize,
    ) -> i32;
    fn vtubeleaf_camera_submit(bytes: *const u8, count: usize) -> i32;
}

fn control(operation: i32) -> Result<CameraStatus, String> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let mut output = [0_u8; 8192];
        let result = unsafe {
            vtubeleaf_camera_command(operation, output.as_mut_ptr().cast(), output.len())
        };
        let length = output
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(output.len());
        let status: CameraStatus =
            serde_json::from_slice(&output[..length]).map_err(|_| "摄像头桥接返回无效状态")?;
        if result == 0 {
            Ok(status)
        } else {
            Err(status.message)
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = operation;
        Ok(CameraStatus {
            supported: false,
            installed: false,
            active: false,
            message: "原生虚拟摄像头支持 Windows 10/11 x64 和 macOS 14 及以上版本".into(),
        })
    }
}

#[tauri::command]
async fn status<R: Runtime>(window: WebviewWindow<R>) -> Result<CameraStatus, String> {
    require_main(&window)?;
    background_control(0).await
}
#[tauri::command]
async fn install<R: Runtime>(window: WebviewWindow<R>) -> Result<CameraStatus, String> {
    require_main(&window)?;
    background_control(1).await
}
#[tauri::command]
async fn uninstall<R: Runtime>(window: WebviewWindow<R>) -> Result<CameraStatus, String> {
    require_main(&window)?;
    background_control(2).await
}
#[tauri::command]
async fn start<R: Runtime>(window: WebviewWindow<R>) -> Result<CameraStatus, String> {
    require_main(&window)?;
    background_control(3).await
}
#[tauri::command]
async fn stop<R: Runtime>(window: WebviewWindow<R>) -> Result<CameraStatus, String> {
    require_main(&window)?;
    background_control(4).await
}

async fn background_control(operation: i32) -> Result<CameraStatus, String> {
    tauri::async_runtime::spawn_blocking(move || control(operation))
        .await
        .map_err(|error| error.to_string())?
}

fn frame_body(body: &InvokeBody) -> Result<&[u8], String> {
    match body {
        InvokeBody::Raw(bytes) if bytes.len() == FRAME_BYTES => Ok(bytes),
        _ => Err("帧必须是 1280×720 的 RGBA 二进制数据".into()),
    }
}

#[tauri::command]
fn submit<R: Runtime>(
    window: WebviewWindow<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    require_main(&window)?;
    let bytes = frame_body(request.body())?;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        if unsafe { vtubeleaf_camera_submit(bytes.as_ptr(), bytes.len()) } != 0 {
            return Err(control(0)?.message);
        }
        Ok(())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = bytes;
        Err("当前平台不支持原生虚拟摄像头".into())
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    tauri::plugin::Builder::new("virtual-camera")
        .setup(|app, _| {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::ffi::OsStrExt;
                use tauri::Manager;
                extern "C" {
                    fn vtubeleaf_camera_paths(x64: *const u16, x86: *const u16);
                }
                let resources = app.path().resource_dir()?;
                let wide = |arch: &str| {
                    resources
                        .join("camera")
                        .join(arch)
                        .join("VTubeLeafCamera.dll")
                        .as_os_str()
                        .encode_wide()
                        .chain(Some(0))
                        .collect::<Vec<_>>()
                };
                let (x64, x86) = (wide("x64"), wide("x86"));
                unsafe {
                    vtubeleaf_camera_paths(x64.as_ptr(), x86.as_ptr());
                }
            }
            #[cfg(not(target_os = "windows"))]
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            status, install, uninstall, start, stop, submit
        ])
        .on_event(|_, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                let _ = control(4);
            }
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn accepts_only_exact_raw_rgba_frames() {
        assert!(frame_body(&InvokeBody::Raw(vec![0; FRAME_BYTES])).is_ok());
        for size in [0, FRAME_BYTES - 1, FRAME_BYTES + 1] {
            assert!(frame_body(&InvokeBody::Raw(vec![0; size])).is_err());
        }
        assert!(frame_body(&InvokeBody::Json(serde_json::json!([0, 1, 2, 3]))).is_err());
    }
}
