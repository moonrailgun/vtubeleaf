use crate::locale;
use serde::{Deserialize, Serialize};
use tauri::{ipc::InvokeBody, plugin::TauriPlugin, Runtime, WebviewWindow};

const FRAME_BYTES: usize = 1280 * 720 * 4;

#[derive(Clone, Deserialize, Serialize)]
pub struct CameraStatus {
    supported: bool,
    installed: bool,
    active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    consumers: Option<bool>,
    message: String,
}

fn require_main<R: Runtime>(window: &WebviewWindow<R>) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(locale::text([
            "The virtual camera can only be controlled from the main window",
            "虚拟摄像头仅允许从工作台控制",
            "仮想カメラはメインウィンドウからのみ操作できます",
            "La cámara virtual solo se puede controlar desde la ventana principal",
            "La caméra virtuelle ne peut être contrôlée que depuis la fenêtre principale",
        ])
        .into())
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
        let status: CameraStatus = serde_json::from_slice(&output[..length]).map_err(|_| {
            locale::text([
                "The camera bridge returned an invalid status",
                "摄像头桥接返回无效状态",
                "カメラブリッジが無効な状態を返しました",
                "El puente de la cámara devolvió un estado no válido",
                "Le pont de la caméra a renvoyé un état invalide",
            ])
        })?;
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
            consumers: None,
            message: locale::text([
                "On Linux, output through OBS. For meeting apps, start the virtual camera in OBS and install v4l2loopback",
                "Linux 请通过 OBS 输出画面；会议摄像头需在 OBS 中启动虚拟摄像头，并安装 v4l2loopback",
                "Linux では OBS 経由で出力してください。会議アプリで使うには OBS で仮想カメラを開始し、v4l2loopback をインストールしてください",
                "En Linux, emite a través de OBS. Para apps de reuniones, inicia la cámara virtual en OBS e instala v4l2loopback",
                "Sous Linux, passez par OBS pour la sortie. Pour les applis de visio, démarrez la caméra virtuelle dans OBS et installez v4l2loopback",
            ]).into(),
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
        _ => Err(locale::text([
            "Frames must be 1280×720 binary RGBA data",
            "帧必须是 1280×720 的 RGBA 二进制数据",
            "フレームは 1280×720 の RGBA バイナリデータである必要があります",
            "Los fotogramas deben ser datos binarios RGBA de 1280×720",
            "Les images doivent être des données binaires RGBA en 1280×720",
        ])
        .into()),
    }
}

// Async keeps the per-frame conversion and its wait for the host queue off the main thread.
#[tauri::command(async)]
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
        Err(locale::text([
            "The native virtual camera is not supported on this platform",
            "当前平台不支持原生虚拟摄像头",
            "このプラットフォームはネイティブ仮想カメラに対応していません",
            "Esta plataforma no admite la cámara virtual nativa",
            "La caméra virtuelle native n’est pas prise en charge sur cette plateforme",
        ])
        .into())
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
    fn preserves_optional_camera_consumers() {
        for consumers in [None, Some(false), Some(true)] {
            let mut input = serde_json::json!({
                "supported": true, "installed": true, "active": true, "message": "test"
            });
            if let Some(consumers) = consumers {
                input["consumers"] = serde_json::json!(consumers);
            }
            let status: CameraStatus = serde_json::from_value(input.clone()).unwrap();
            assert_eq!(serde_json::to_value(status).unwrap(), input);
        }
    }

    #[test]
    fn accepts_only_exact_raw_rgba_frames() {
        assert!(frame_body(&InvokeBody::Raw(vec![0; FRAME_BYTES])).is_ok());
        for size in [0, FRAME_BYTES - 1, FRAME_BYTES + 1] {
            assert!(frame_body(&InvokeBody::Raw(vec![0; size])).is_err());
        }
        assert!(frame_body(&InvokeBody::Json(serde_json::json!([0, 1, 2, 3]))).is_err());
    }
}
