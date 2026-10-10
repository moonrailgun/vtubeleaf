use crate::locale;
use serde_json::Value;
use std::{
    io::{BufRead, BufReader, Read},
    path::Path,
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

const PREFIX: &str = "VTUBELEAF_NVIDIA ";

fn validate(value: &Value) -> Result<(), String> {
    if let Some(error) = value.get("error").and_then(Value::as_str) {
        return Err(error.chars().take(512).collect());
    }
    if value.get("ready") == Some(&Value::Bool(true))
        || value.get("detected") == Some(&Value::Bool(false))
    {
        return Ok(());
    }
    let numbers = |key: &str, len: usize| {
        value
            .get(key)
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items.len() == len && items.iter().all(|v| v.as_f64().is_some_and(f64::is_finite))
            })
    };
    if value.get("detected") == Some(&Value::Bool(true))
        && numbers("rotation", 4)
        && numbers("expressions", 53)
    {
        Ok(())
    } else {
        Err(locale::text([
            "The NVIDIA extension data format is incompatible. Check the extension version",
            "NVIDIA 扩展数据格式不兼容，请检查扩展版本",
            "NVIDIA 拡張機能のデータ形式に互換性がありません。拡張機能のバージョンを確認してください",
            "El formato de datos de la extensión de NVIDIA no es compatible. Comprueba la versión de la extensión",
            "Le format de données de l’extension NVIDIA est incompatible. Vérifiez la version de l’extension",
        ]).into())
    }
}

pub struct Tracker {
    stop: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
}

impl Tracker {
    pub fn start(
        executable: &Path,
        model_dir: &Path,
        camera: u32,
        fps: u32,
        resolution: &str,
        on_frame: impl Fn(Value) + Send + 'static,
        on_error: impl Fn(String) + Send + 'static,
    ) -> Result<Self, String> {
        if !executable.is_absolute()
            || !executable.is_file()
            || executable
                .extension()
                .and_then(|s| s.to_str())
                .is_none_or(|s| !s.eq_ignore_ascii_case("exe"))
        {
            return Err(locale::text([
                "Choose the full path of the installed VTubeLeafNvidia.exe",
                "请选择已安装的 VTubeLeafNvidia.exe 完整路径",
                "インストール済みの VTubeLeafNvidia.exe のフルパスを選択してください",
                "Elige la ruta completa del VTubeLeafNvidia.exe instalado",
                "Choisissez le chemin complet du VTubeLeafNvidia.exe installé",
            ])
            .into());
        }
        if !model_dir.is_absolute() || !model_dir.is_dir() {
            return Err(locale::text([
                "Choose the full path of the NVIDIA AR SDK models folder",
                "请选择 NVIDIA AR SDK 的 models 目录完整路径",
                "NVIDIA AR SDK の models フォルダーのフルパスを選択してください",
                "Elige la ruta completa de la carpeta models del NVIDIA AR SDK",
                "Choisissez le chemin complet du dossier models du NVIDIA AR SDK",
            ])
            .into());
        }
        if camera > 32 || ![15, 24, 30, 60].contains(&fps) {
            return Err(locale::text([
                "Invalid camera number or frame rate",
                "摄像头编号或帧率无效",
                "カメラ番号またはフレームレートが無効です",
                "Número de cámara o velocidad de fotogramas no válidos",
                "Numéro de caméra ou fréquence d’images invalide",
            ])
            .into());
        }
        let (width, height) = match resolution {
            "360p" => (640, 360),
            "720p" => (1280, 720),
            "1080p" => (1920, 1080),
            _ => {
                return Err(locale::text([
                    "Invalid camera resolution",
                    "摄像头分辨率无效",
                    "カメラの解像度が無効です",
                    "Resolución de cámara no válida",
                    "Résolution de caméra invalide",
                ])
                .into())
            }
        };
        let mut command = Command::new(executable);
        command
            .current_dir(executable.parent().ok_or(locale::text([
                "Invalid extension path",
                "扩展程序路径无效",
                "拡張機能のパスが無効です",
                "Ruta de la extensión no válida",
                "Chemin de l’extension invalide",
            ]))?)
            .arg(model_dir)
            .arg(camera.to_string())
            .arg(fps.to_string())
            .arg(width.to_string())
            .arg(height.to_string());
        Self::spawn(
            command,
            Duration::from_secs(120),
            Duration::from_secs(10),
            on_frame,
            on_error,
        )
    }

    fn spawn(
        mut command: Command,
        startup_timeout: Duration,
        frame_timeout: Duration,
        on_frame: impl Fn(Value) + Send + 'static,
        on_error: impl Fn(String) + Send + 'static,
    ) -> Result<Self, String> {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut child = command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| {
                format!(
                    "{}{error}",
                    locale::text([
                        "Could not start the NVIDIA extension: ",
                        "无法启动 NVIDIA 扩展：",
                        "NVIDIA 拡張機能を起動できません：",
                        "No se pudo iniciar la extensión de NVIDIA: ",
                        "Impossible de démarrer l’extension NVIDIA : "
                    ])
                )
            })?;
        let stdout = child.stdout.take().expect("stdout was piped");
        let stop = Arc::new(AtomicBool::new(false));
        let cancelled = Arc::clone(&stop);
        let worker = thread::spawn(move || {
            let (send, receive) = mpsc::sync_channel(1);
            let reader = thread::spawn(move || {
                let mut input = BufReader::new(stdout);
                loop {
                    let mut line = String::new();
                    match input.by_ref().take(4097).read_line(&mut line) {
                        Ok(0) => break,
                        Ok(_) if line.len() <= 4096 => {
                            // SDK diagnostic output is not part of our frame protocol.
                            let Some(json) = line.strip_prefix(PREFIX) else {
                                continue;
                            };
                            let packet = serde_json::from_str::<Value>(json)
                                .map_err(|_| {
                                    locale::text([
                                        "The NVIDIA extension sent invalid data",
                                        "NVIDIA 扩展输出了无效数据",
                                        "NVIDIA 拡張機能が無効なデータを出力しました",
                                        "La extensión de NVIDIA envió datos no válidos",
                                        "L’extension NVIDIA a envoyé des données invalides",
                                    ])
                                    .to_string()
                                })
                                .and_then(|value| {
                                    validate(&value)?;
                                    Ok(value)
                                });
                            let failed = packet.is_err();
                            if send.send(packet).is_err() || failed {
                                break;
                            }
                        }
                        _ => {
                            let _ = send.send(Err(locale::text([
                                "The NVIDIA extension output is too long or unreadable",
                                "NVIDIA 扩展输出过长或无法读取",
                                "NVIDIA 拡張機能の出力が長すぎるか、読み込めません",
                                "La salida de la extensión de NVIDIA es demasiado larga o ilegible",
                                "La sortie de l’extension NVIDIA est trop longue ou illisible",
                            ])
                            .into()));
                            break;
                        }
                    }
                }
            });
            let mut last_frame = Instant::now();
            let mut timeout = startup_timeout;
            let mut error = None;
            while !cancelled.load(Ordering::SeqCst) {
                match receive.recv_timeout(Duration::from_millis(100)) {
                    Ok(Ok(value)) => {
                        if cancelled.load(Ordering::SeqCst) {
                            break;
                        }
                        if value.get("detected").is_some() {
                            last_frame = Instant::now();
                            timeout = frame_timeout;
                            on_frame(value);
                        }
                    }
                    Ok(Err(message)) => {
                        error = Some(message);
                        break;
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        error = Some(
                            locale::text([
                                "The NVIDIA extension exited. Check the RTX driver, SDK DLLs, models and camera",
                                "NVIDIA 扩展已退出，请检查 RTX 驱动、SDK DLL、模型与摄像头",
                                "NVIDIA 拡張機能が終了しました。RTX ドライバー、SDK DLL、モデル、カメラを確認してください",
                                "La extensión de NVIDIA se cerró. Comprueba el controlador RTX, las DLL del SDK, los modelos y la cámara",
                                "L’extension NVIDIA s’est arrêtée. Vérifiez le pilote RTX, les DLL du SDK, les modèles et la caméra",
                            ]).into(),
                        );
                        break;
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                if last_frame.elapsed() > timeout {
                    error = Some(locale::text([
                        "The NVIDIA extension timed out waiting for data. Check model loading and the camera",
                        "NVIDIA 扩展等待数据超时，请检查模型加载与摄像头",
                        "NVIDIA 拡張機能のデータ待ちがタイムアウトしました。モデルの読み込みとカメラを確認してください",
                        "Se agotó el tiempo de espera de datos de la extensión de NVIDIA. Comprueba la carga de modelos y la cámara",
                        "L’extension NVIDIA a dépassé le délai d’attente des données. Vérifiez le chargement des modèles et la caméra",
                    ]).into());
                    break;
                }
            }
            drop(receive);
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            if !cancelled.load(Ordering::SeqCst) {
                if let Some(message) = error {
                    on_error(message);
                }
            }
        });
        Ok(Self {
            stop,
            worker: Some(worker),
        })
    }
}

impl Drop for Tracker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn protocol_rejects_wrong_layout_and_reports_sdk_errors() {
        assert!(validate(
            &json!({"detected": true, "rotation": [0,0,0,1], "expressions": vec![0;53]})
        )
        .is_ok());
        assert!(validate(&json!({"detected": false})).is_ok());
        assert!(validate(&json!({"ready": true})).is_ok());
        assert!(validate(
            &json!({"detected": true, "rotation": [0,0,0,1], "expressions": vec![0;52]})
        )
        .is_err());
        assert!(validate(
            &json!({"detected": true, "rotation": [0,0,0,"1"], "expressions": vec![0;53]})
        )
        .is_err());
        assert_eq!(
            validate(&json!({"error": "SDK load failed"})),
            Err("SDK load failed".into())
        );
    }

    #[cfg(unix)]
    #[test]
    fn owned_process_streams_times_out_and_stops_without_spurious_error() {
        use std::sync::mpsc::channel;
        let (frames, received) = channel();
        let (errors, failed) = channel();
        let mut command = Command::new("/bin/sh");
        command.args([
            "-c",
            "printf 'SDK log\\nVTUBELEAF_NVIDIA {\"detected\":false}\\n'; exec sleep 10",
        ]);
        let tracker = Tracker::spawn(
            command,
            Duration::from_secs(1),
            Duration::from_millis(150),
            move |frame| {
                frames.send(frame).unwrap();
            },
            move |error| {
                errors.send(error).unwrap();
            },
        )
        .unwrap();
        assert_eq!(
            received.recv_timeout(Duration::from_secs(2)).unwrap()["detected"],
            false
        );
        assert!(failed
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .contains("超时"));
        drop(tracker);

        let (errors, failed) = channel();
        let mut command = Command::new("/bin/sleep");
        command.arg("10");
        let tracker = Tracker::spawn(
            command,
            Duration::from_secs(20),
            Duration::from_secs(10),
            |_| {},
            move |error| {
                let _ = errors.send(error);
            },
        )
        .unwrap();
        let before = Instant::now();
        drop(tracker);
        assert!(before.elapsed() < Duration::from_secs(2));
        assert!(failed.try_recv().is_err());

        let (errors, failed) = channel();
        let tracker = Tracker::spawn(
            Command::new("/usr/bin/false"),
            Duration::from_secs(1),
            Duration::from_secs(1),
            |_| {},
            move |error| {
                errors.send(error).unwrap();
            },
        )
        .unwrap();
        assert!(failed
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .contains("已退出"));
        drop(tracker);
    }
}
