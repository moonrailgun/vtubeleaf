//! Shares transparent frames with OBS through Syphon (macOS) or Spout2 (Windows).
use crate::locale;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{ipc::InvokeBody, State, WebviewWindow};

/// Frame sizes the sender accepts. The front end picks one with the "OBS output size" setting;
/// 720p moves 44% less data, which is the only lever on the per-frame IPC cost.
const FRAME_SIZES: [(u32, u32); 2] = [(1920, 1080), (1280, 720)];
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

    pub fn submit(&self, bytes: &[u8]) -> Result<(bool, u32), String> {
        let Some((width, height)) = FRAME_SIZES
            .into_iter()
            .find(|(w, h)| bytes.len() == (*w as usize) * (*h as usize) * 4)
        else {
            return Err(locale::text([
                "Native transparent output needs 1920×1080 or 1280×720 RGBA frames",
                "原生透明输出需要 1920×1080 或 1280×720 的 RGBA 帧",
                "ネイティブ透過出力には 1920×1080 または 1280×720 の RGBA フレームが必要です",
                "La salida transparente nativa necesita fotogramas RGBA de 1920×1080 o 1280×720",
                "La sortie transparente native nécessite des images RGBA en 1920×1080 ou 1280×720",
            ])
            .into());
        };
        let Some(sender) = &self.0 else {
            return Ok((false, 0));
        };
        let started = Instant::now();
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        if unsafe { vtubeleaf_texture_send(sender.0, bytes.as_ptr(), width, height) } != 0 {
            return Err(locale::text([
                "Native transparent output could not write the frame",
                "原生透明输出无法写入画面",
                "ネイティブ透過出力に画面を書き込めません",
                "La salida transparente nativa no pudo escribir el fotograma",
                "La sortie transparente native n’a pas pu écrire l’image",
            ])
            .into());
        }
        let send_ms = started.elapsed().as_millis() as u32;
        let _ = sender;
        Ok((self.wanted(), send_ms))
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
    output: State<'_, Arc<Mutex<Output>>>,
    obs: State<'_, Mutex<crate::obs::Output>>,
) -> Result<String, String> {
    super::require_main(&window)?;
    output
        .lock()
        .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?
        .start()?;
    // The same local server accepts native frames over `POST /frame`, which avoids the Tauri IPC
    // channel's ~96 ms fixed round trip. A busy port must not fail the start: the front end falls
    // back to IPC on its own, and native output worked without this port before.
    if let Ok(mut obs) = obs.lock() {
        let _ = obs.serve(Arc::clone(output.inner()));
    }
    Ok(crate::obs::URL.to_owned())
}

#[tauri::command]
pub fn texture_stop(window: WebviewWindow, output: State<'_, Arc<Mutex<Output>>>) -> Result<(), String> {
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
    output: State<'_, Arc<Mutex<Output>>>,
) -> Result<bool, String> {
    super::require_main(&window)?;
    Ok(output
        .lock()
        .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?
        .wanted())
}

// Runs on the IPC thread: the raw body is already parsed, and the send itself measured 0 ms, so
// the runtime hop async used to add is pure overhead on the critical path.
#[tauri::command]
pub fn texture_submit(
    window: WebviewWindow,
    output: State<'_, Arc<Mutex<Output>>>,
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
    let (wanted, _) = output
        .lock()
        .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?
        .submit(bytes)?;
    Ok(wanted)
}

/// Round-trips a raw body without touching the sender, so the status bar can show what the IPC
/// channel costs next to the local HTTP server that frames actually use.
#[tauri::command(async)]
pub fn texture_ping(
    window: WebviewWindow,
    request: tauri::ipc::Request<'_>,
) -> Result<usize, String> {
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
    Ok(bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_wrong_sizes_and_ignores_frames_while_stopped() {
        let mut output = Output::default();
        assert!(output.submit(&[0; 16]).is_err());
        let frame = vec![0; 1920 * 1080 * 4];
        assert!(!output.submit(&frame).unwrap().0);
        assert!(!output.wanted());
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        {
            output.start().unwrap();
            output.start().unwrap();
            // No Syphon client is attached in tests; Spout2 always asks for frames.
            assert_eq!(
                output.submit(&frame).unwrap().0,
                cfg!(target_os = "windows")
            );
            // The 720p size is accepted too, so the front end can switch without a restart.
            assert!(output.submit(&vec![0; 1280 * 720 * 4]).is_ok());
            output.stop();
            output.stop();
            assert!(!output.submit(&frame).unwrap().0);
        }
    }
}
