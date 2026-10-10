//! Shares transparent frames with OBS through Syphon (macOS) or Spout2 (Windows).
use crate::locale;
use std::sync::Mutex;
use tauri::{ipc::InvokeBody, State, WebviewWindow};

const WIDTH: u32 = 1920;
const HEIGHT: u32 = 1080;
const FRAME_BYTES: usize = (WIDTH * HEIGHT * 4) as usize;
const OUTPUT_UNAVAILABLE: [&str; 5] = [
    "Transparent output state is unavailable",
    "透明输出状态不可用",
    "透過出力の状態を利用できません",
    "El estado de la salida transparente no está disponible",
    "L’état de la sortie transparente est indisponible",
];

#[cfg(any(target_os = "macos", target_os = "windows"))]
extern "C" {
    fn vtubeleaf_texture_start(name: *const std::ffi::c_char) -> *mut std::ffi::c_void;
    fn vtubeleaf_texture_send(
        sender: *mut std::ffi::c_void,
        rgba: *const u8,
        width: u32,
        height: u32,
    ) -> i32;
    fn vtubeleaf_texture_stop(sender: *mut std::ffi::c_void);
    fn vtubeleaf_texture_wanted(sender: *mut std::ffi::c_void) -> i32;
}

struct Sender(*mut std::ffi::c_void);
// The native senders are only used while the surrounding mutex is held.
unsafe impl Send for Sender {}

#[derive(Default)]
pub struct Output(Option<Sender>);

impl Output {
    fn start(&mut self) -> Result<(), String> {
        if self.0.is_some() {
            return Ok(());
        }
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            let sender = unsafe { vtubeleaf_texture_start(c"VTubeLeaf".as_ptr()) };
            if sender.is_null() {
                return Err(locale::text([
                    "Could not start the native transparent output",
                    "无法启动原生透明输出",
                    "ネイティブ透過出力を開始できません",
                    "No se pudo iniciar la salida transparente nativa",
                    "Impossible de démarrer la sortie transparente native",
                ])
                .into());
            }
            self.0 = Some(Sender(sender));
            Ok(())
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        Err(locale::text([
            "Native transparent output is not supported on this platform",
            "当前平台不支持原生透明输出",
            "このプラットフォームはネイティブ透過出力に対応していません",
            "Esta plataforma no admite la salida transparente nativa",
            "La sortie transparente native n’est pas prise en charge sur cette plateforme",
        ])
        .into())
    }

    pub fn stop(&mut self) {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(sender) = self.0.take() {
            // Blanks the shared frame before retiring, so OBS does not keep the last pose.
            unsafe { vtubeleaf_texture_stop(sender.0) };
        }
    }

    /// Whether a receiver is connected. Spout2 cannot tell, so Windows always reports true.
    fn wanted(&self) -> bool {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if let Some(sender) = &self.0 {
            return unsafe { vtubeleaf_texture_wanted(sender.0) } != 0;
        }
        false
    }

    fn submit(&self, bytes: &[u8]) -> Result<bool, String> {
        if bytes.len() != FRAME_BYTES {
            return Err(locale::text([
                "Native transparent output needs 1920×1080 RGBA frames",
                "原生透明输出需要 1920×1080 的 RGBA 帧",
                "ネイティブ透過出力には 1920×1080 の RGBA フレームが必要です",
                "La salida transparente nativa necesita fotogramas RGBA de 1920×1080",
                "La sortie transparente native nécessite des images RGBA en 1920×1080",
            ])
            .into());
        }
        let Some(sender) = &self.0 else {
            return Ok(false);
        };
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if unsafe { vtubeleaf_texture_send(sender.0, bytes.as_ptr(), WIDTH, HEIGHT) } != 0 {
            return Err(locale::text([
                "Native transparent output could not write the frame",
                "原生透明输出无法写入画面",
                "ネイティブ透過出力に画面を書き込めません",
                "La salida transparente nativa no pudo escribir el fotograma",
                "La sortie transparente native n’a pas pu écrire l’image",
            ])
            .into());
        }
        let _ = sender;
        Ok(self.wanted())
    }
}

impl Drop for Output {
    fn drop(&mut self) {
        self.stop();
    }
}

#[tauri::command]
pub fn texture_start(
    window: WebviewWindow,
    output: State<'_, Mutex<Output>>,
) -> Result<(), String> {
    super::require_main(&window)?;
    output
        .lock()
        .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?
        .start()
}

#[tauri::command]
pub fn texture_stop(window: WebviewWindow, output: State<'_, Mutex<Output>>) -> Result<(), String> {
    super::require_main(&window)?;
    output
        .lock()
        .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?
        .stop();
    Ok(())
}

#[tauri::command]
pub fn texture_wanted(
    window: WebviewWindow,
    output: State<'_, Mutex<Output>>,
) -> Result<bool, String> {
    super::require_main(&window)?;
    Ok(output
        .lock()
        .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?
        .wanted())
}

// Async keeps the per-frame copy off the main thread.
#[tauri::command(async)]
pub fn texture_submit(
    window: WebviewWindow,
    output: State<'_, Mutex<Output>>,
    request: tauri::ipc::Request<'_>,
) -> Result<bool, String> {
    super::require_main(&window)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(locale::text([
            "Transparent output frames must be binary data",
            "透明输出帧必须是二进制数据",
            "透過出力のフレームはバイナリデータである必要があります",
            "Los fotogramas de la salida transparente deben ser datos binarios",
            "Les images de la sortie transparente doivent être des données binaires",
        ])
        .into());
    };
    output
        .lock()
        .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?
        .submit(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_wrong_sizes_and_ignores_frames_while_stopped() {
        let mut output = Output::default();
        assert!(output.submit(&[0; 16]).is_err());
        let frame = vec![0; FRAME_BYTES];
        assert!(!output.submit(&frame).unwrap());
        assert!(!output.wanted());
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            output.start().unwrap();
            output.start().unwrap();
            // No Syphon client is attached in tests; Spout2 always asks for frames.
            assert_eq!(output.submit(&frame).unwrap(), cfg!(target_os = "windows"));
            output.stop();
            output.stop();
            assert!(!output.submit(&frame).unwrap());
        }
    }
}
