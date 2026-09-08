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
        Err("NVIDIA 扩展数据格式不兼容，请检查扩展版本".into())
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
            return Err("请选择已安装的 VTubeLeafNvidia.exe 完整路径".into());
        }
        if !model_dir.is_absolute() || !model_dir.is_dir() {
            return Err("请选择 NVIDIA AR SDK 的 models 目录完整路径".into());
        }
        if camera > 32 || ![15, 24, 30, 60].contains(&fps) {
            return Err("摄像头编号或帧率无效".into());
        }
        let (width, height) = match resolution {
            "360p" => (640, 360),
            "720p" => (1280, 720),
            "1080p" => (1920, 1080),
            _ => return Err("摄像头分辨率无效".into()),
        };
        let mut command = Command::new(executable);
        command
            .current_dir(executable.parent().ok_or("扩展程序路径无效")?)
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
            .map_err(|error| format!("无法启动 NVIDIA 扩展：{error}"))?;
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
                                .map_err(|_| "NVIDIA 扩展输出了无效数据".to_string())
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
                            let _ = send.send(Err("NVIDIA 扩展输出过长或无法读取".into()));
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
                            "NVIDIA 扩展已退出，请检查 RTX 驱动、SDK DLL、模型与摄像头".into(),
                        );
                        break;
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                if last_frame.elapsed() > timeout {
                    error = Some("NVIDIA 扩展等待数据超时，请检查模型加载与摄像头".into());
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
