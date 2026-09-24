use serde::{Deserialize, Serialize};
use std::{
    io,
    net::{Ipv4Addr, UdpSocket},
    path::Path,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::Duration,
};

const PACKET_SIZE: usize = 1785;

#[derive(Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Bundled,
    External,
    Custom,
}

pub enum Source<'a> {
    Bundled(&'a Path),
    External,
    Python(&'a Path, &'a Path),
}

pub fn bundled_executable(resources: &Path) -> std::path::PathBuf {
    let relative = Path::new("openseeface")
        .join(std::env::consts::ARCH)
        .join(if cfg!(windows) {
            "facetracker.exe"
        } else {
            "facetracker"
        });
    let bundled = resources.join(&relative);
    #[cfg(debug_assertions)]
    if !bundled.is_file() {
        return Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../.local/openseeface-bundle")
            .join(std::env::consts::ARCH)
            .join(relative.file_name().unwrap());
    }
    bundled
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    yaw: f32,
    pitch: f32,
    roll: f32,
    eye_left: f32,
    eye_right: f32,
    mouth_open: f32,
    mouth_smile: f32,
    brow_left: f32,
    brow_right: f32,
    mouth_x: f32,
    position_x: f32,
    position_y: f32,
    position_z: f32,
}

// OpenSeeFace 85aa70fc: facetracker.py wire order and OpenSee.cs axis conversion.
fn parse_packet(bytes: &[u8]) -> Option<Frame> {
    if bytes.len() != PACKET_SIZE
        || i32::from_le_bytes(bytes[8..12].try_into().ok()?) != 0
        || bytes[28] != 1
    {
        return None;
    }
    if !f64::from_le_bytes(bytes[..8].try_into().ok()?).is_finite()
        || bytes[12..28]
            .chunks_exact(4)
            .chain(bytes[29..].chunks_exact(4))
            .any(|chunk| !f32::from_le_bytes(chunk.try_into().unwrap()).is_finite())
    {
        return None;
    }
    let float = |offset| f32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
    let wrap = |angle: f32| (angle + 180.).rem_euclid(360.) - 180.;
    Some(Frame {
        yaw: wrap(-float(53)),
        pitch: -wrap(float(49) + 180.),
        roll: wrap(float(57) - 90.),
        eye_left: float(24).clamp(0., 1.),
        eye_right: float(20).clamp(0., 1.),
        mouth_open: float(1777).clamp(0., 1.),
        mouth_smile: (float(1761) * 0.5 + float(1769) * 0.5).clamp(0., 1.),
        brow_left: float(1741).clamp(-1., 1.),
        brow_right: float(1753).clamp(-1., 1.),
        mouth_x: ((float(1773) - float(1765)) * 0.5).clamp(-1., 1.),
        // OpenSee.cs axes. These are template-model units, not cm or metres;
        // subtract the calibrated neutral position before mapping displacement.
        position_x: -float(65),
        position_y: float(61),
        position_z: -float(69),
    })
}

pub struct Tracker {
    stop: Arc<AtomicBool>,
    receiver: Option<JoinHandle<()>>,
    child: Arc<Mutex<Option<Child>>>,
}

impl Tracker {
    pub fn start(
        port: u16,
        camera: u32,
        source: Source<'_>,
        on_frame: impl Fn(Frame) + Send + 'static,
        on_error: impl Fn(&'static str) + Send + 'static,
    ) -> Result<Self, String> {
        if port == 0 || camera > 128 {
            return Err("OpenSeeFace 端口或摄像头编号无效".into());
        }
        let socket = UdpSocket::bind((Ipv4Addr::LOCALHOST, port))
            .map_err(|_| "无法绑定 OpenSeeFace 本机端口，可能已被占用")?;
        socket
            .set_read_timeout(Some(Duration::from_millis(100)))
            .map_err(|_| "无法设置 OpenSeeFace 接收超时")?;
        let command = match source {
            Source::External => None,
            Source::Bundled(executable) => {
                if !executable.is_file() {
                    return Err("内置 OpenSeeFace 不完整，请重新安装应用；开发环境请先运行 npm run bundle:openseeface".into());
                }
                let mut command = Command::new(executable);
                command.current_dir(executable.parent().ok_or("OpenSeeFace 程序目录无效")?);
                Some(command)
            }
            Source::Python(python, script) => {
                // Keep the venv launcher path: resolving its symlink would lose pyvenv.cfg.
                let python = if python.is_absolute() {
                    python.to_owned()
                } else {
                    std::env::current_dir()
                        .map_err(|_| "无法解析 Python 相对路径")?
                        .join(python)
                };
                let script = script
                    .canonicalize()
                    .map_err(|_| "OpenSeeFace 脚本路径不存在")?;
                if !python.is_file()
                    || !script.is_file()
                    || script.extension().is_none_or(|extension| extension != "py")
                {
                    return Err("请选择 Python 可执行文件和 OpenSeeFace 启动脚本".into());
                }
                let mut command = Command::new(python);
                command
                    .arg("-u")
                    .arg(&script)
                    .current_dir(script.parent().ok_or("OpenSeeFace 脚本目录无效")?);
                Some(command)
            }
        };
        let child = if let Some(mut command) = command {
            command
                .args([
                    "--ip",
                    "127.0.0.1",
                    "--port",
                    &port.to_string(),
                    "--capture",
                    &camera.to_string(),
                    "--faces",
                    "1",
                    "-F",
                    "24",
                    "-W",
                    "640",
                    "-H",
                    "360",
                    "--gaze-tracking",
                    "0",
                    "--visualize",
                    "0",
                    "--silent",
                    "1",
                ])
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command.creation_flags(0x08000000);
            }
            Some(
                command
                    .spawn()
                    .map_err(|_| "无法启动 OpenSeeFace，请检查程序是否完整及执行权限")?,
            )
        } else {
            None
        };
        let child = Arc::new(Mutex::new(child));
        let receiver_child = Arc::clone(&child);
        let stop = Arc::new(AtomicBool::new(false));
        let receiver_stop = Arc::clone(&stop);
        let receiver = thread::Builder::new()
            .name("openseeface-udp".into())
            .spawn(move || {
                let mut buffer = [0_u8; 65_535];
                while !receiver_stop.load(Ordering::Acquire) {
                    let child_exited = {
                        let mut child = receiver_child
                            .lock()
                            .unwrap_or_else(|error| error.into_inner());
                        match child.as_mut().map(Child::try_wait) {
                            Some(Ok(Some(_))) => {
                                child.take();
                                true
                            }
                            Some(Err(_)) => {
                                stop_child(&mut child);
                                true
                            }
                            _ => false,
                        }
                    };
                    if child_exited {
                        if !receiver_stop.load(Ordering::Acquire) {
                            on_error(
                                "OpenSeeFace 进程已退出，请检查摄像头权限、占用情况和跟踪程序是否完整",
                            );
                        }
                        break;
                    }
                    match socket.recv_from(&mut buffer) {
                        Ok((length, sender))
                            if sender.ip().is_loopback()
                                && length > 0
                                && length % PACKET_SIZE == 0 =>
                        {
                            for packet in buffer[..length].chunks_exact(PACKET_SIZE) {
                                if receiver_stop.load(Ordering::Acquire) {
                                    break;
                                }
                                if let Some(frame) = parse_packet(packet) {
                                    on_frame(frame);
                                }
                            }
                        }
                        Ok(_) => {}
                        Err(error)
                            if matches!(
                                error.kind(),
                                io::ErrorKind::WouldBlock
                                    | io::ErrorKind::TimedOut
                                    | io::ErrorKind::Interrupted
                            ) => {}
                        Err(_) => break,
                    }
                }
            });
        let receiver = match receiver {
            Ok(receiver) => receiver,
            Err(_) => {
                stop_child(&mut child.lock().unwrap_or_else(|error| error.into_inner()));
                return Err("无法启动 OpenSeeFace 接收线程".into());
            }
        };
        Ok(Self {
            stop,
            receiver: Some(receiver),
            child,
        })
    }

    pub fn stop(&mut self) {
        self.stop.store(true, Ordering::Release);
        stop_child(&mut self.child.lock().unwrap_or_else(|error| error.into_inner()));
        if let Some(receiver) = self.receiver.take() {
            let _ = receiver.join();
        }
    }
}

fn stop_child(child: &mut Option<Child>) {
    if let Some(mut child) = child.take() {
        if !matches!(child.try_wait(), Ok(Some(_))) {
            let _ = child.kill();
        }
        let _ = child.wait();
    }
}

impl Drop for Tracker {
    fn drop(&mut self) {
        self.stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Port probes and release checks must not race with another test's ephemeral bind.
    static UDP_TEST_LOCK: Mutex<()> = Mutex::new(());

    #[cfg(unix)]
    #[test]
    fn bundled_process_receives_arguments_and_is_stopped_with_tracker() {
        use std::os::unix::fs::PermissionsExt;
        let _guard = UDP_TEST_LOCK.lock().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("facetracker");
        std::fs::write(
            &executable,
            "#!/bin/sh\nprintf '%s\\n' \"$@\" > arguments\nexec /bin/sleep 30\n",
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let available = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = available.local_addr().unwrap().port();
        drop(available);
        let mut tracker =
            Tracker::start(port, 2, Source::Bundled(&executable), |_| {}, |_| {}).unwrap();
        let pid = tracker.child.lock().unwrap().as_ref().unwrap().id();
        let arguments = directory.path().join("arguments");
        for _ in 0..100 {
            if arguments.is_file() {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        tracker.stop();
        let args = std::fs::read_to_string(arguments).unwrap();
        assert!(args.contains(&format!("--ip\n127.0.0.1\n--port\n{port}\n--capture\n2\n")));
        assert!(!args.contains(".py"));
        assert!(!Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success());
        let _rebound = UdpSocket::bind((Ipv4Addr::LOCALHOST, port)).unwrap();
        assert!(Tracker::start(
            port,
            0,
            Source::Bundled(&directory.path().join("missing")),
            |_| {},
            |_| {}
        )
        .is_err());
    }

    fn packet() -> Vec<u8> {
        let mut packet = vec![0; 1785];
        packet[..8].copy_from_slice(&1_f64.to_le_bytes());
        packet[28] = 1;
        for (offset, value) in [
            (20, 0.3_f32),
            (24, 0.8),
            (49, 170.),
            (53, 20.),
            (57, 105.),
            (61, 0.2),
            (65, -0.3),
            (69, 2.5),
            (1741, -0.5),
            (1753, 0.75),
            (1761, 0.6),
            (1765, -0.2),
            (1769, 0.2),
            (1773, 0.4),
            (1777, 0.7),
        ] {
            packet[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
        }
        packet
    }
    #[test]
    fn decodes_axes_eyes_and_features_with_official_offsets() {
        let frame = parse_packet(&packet()).unwrap();
        assert_eq!(
            frame,
            Frame {
                yaw: -20.,
                pitch: 10.,
                roll: 15.,
                eye_left: 0.8,
                eye_right: 0.3,
                mouth_open: 0.7,
                mouth_smile: 0.4,
                brow_left: -0.5,
                brow_right: 0.75,
                mouth_x: 0.3,
                position_x: 0.3,
                position_y: 0.2,
                position_z: -2.5,
            }
        );
    }
    #[test]
    fn ignores_truncated_failed_nonfinite_and_other_faces() {
        let mut bytes = packet();
        assert!(parse_packet(&bytes[..1784]).is_none());
        bytes[8..12].copy_from_slice(&1_i32.to_le_bytes());
        assert!(parse_packet(&bytes).is_none());
        bytes[8..12].copy_from_slice(&0_i32.to_le_bytes());
        bytes[28] = 0;
        assert!(parse_packet(&bytes).is_none());
        bytes[28] = 1;
        bytes[49..53].copy_from_slice(&f32::NAN.to_le_bytes());
        assert!(parse_packet(&bytes).is_none());
    }

    #[test]
    fn receives_loopback_packets_and_releases_port_when_stopped() {
        let _guard = UDP_TEST_LOCK.lock().unwrap();
        let available = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = available.local_addr().unwrap().port();
        drop(available);
        let (sender, receiver) = std::sync::mpsc::channel();
        let mut tracker = Tracker::start(
            port,
            0,
            Source::External,
            move |frame| {
                let _ = sender.send(frame);
            },
            |_| {},
        )
        .unwrap();
        let client = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        client
            .send_to(&packet(), (Ipv4Addr::LOCALHOST, port))
            .unwrap();
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(2)).unwrap(),
            parse_packet(&packet()).unwrap()
        );
        tracker.stop();
        let rebound = UdpSocket::bind((Ipv4Addr::LOCALHOST, port)).unwrap();
        assert_eq!(rebound.local_addr().unwrap().ip(), Ipv4Addr::LOCALHOST);
    }

    #[cfg(unix)]
    #[test]
    fn stop_terminates_only_the_owned_process() {
        let _guard = UDP_TEST_LOCK.lock().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let script = directory.path().join("facetracker.py");
        // A bounded test stand-in accepts the same argv but never uses a camera.
        std::fs::write(&script, "exec /bin/sleep 30\n").unwrap();
        let available = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = available.local_addr().unwrap().port();
        drop(available);
        let mut unrelated = Command::new("/bin/sleep").arg("30").spawn().unwrap();
        let mut tracker = Tracker::start(
            port,
            0,
            Source::Python(Path::new("/bin/sh"), &script),
            |_| {},
            |_| {},
        )
        .unwrap();
        let pid = tracker.child.lock().unwrap().as_ref().unwrap().id();
        tracker.stop();
        let owned_alive = Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap()
            .success();
        let unrelated_alive = unrelated.try_wait().unwrap().is_none();
        let _ = unrelated.kill();
        let _ = unrelated.wait();
        assert!(!owned_alive);
        assert!(unrelated_alive);
    }

    #[cfg(unix)]
    #[test]
    fn reports_owned_process_exit_and_releases_port() {
        let _guard = UDP_TEST_LOCK.lock().unwrap();
        let directory = tempfile::tempdir().unwrap();
        let script = directory.path().join("facetracker.py");
        std::fs::write(&script, "exit 7\n").unwrap();
        let available = UdpSocket::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = available.local_addr().unwrap().port();
        drop(available);
        let (sender, receiver) = std::sync::mpsc::channel();
        let mut tracker = Tracker::start(
            port,
            0,
            Source::Python(Path::new("/bin/sh"), &script),
            |_| {},
            move |error| {
                let _ = sender.send(error);
            },
        )
        .unwrap();
        let error = receiver.recv_timeout(Duration::from_secs(2));
        tracker.stop();
        assert_eq!(
            error.unwrap(),
            "OpenSeeFace 进程已退出，请检查摄像头权限、占用情况和跟踪程序是否完整"
        );
        let _rebound = UdpSocket::bind((Ipv4Addr::LOCALHOST, port)).unwrap();
    }
}
