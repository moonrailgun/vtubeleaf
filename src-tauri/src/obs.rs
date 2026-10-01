use http_body_util::Full;
use hyper::{body::Bytes, server::conn::http1, service::service_fn, Request, Response, StatusCode};
use hyper_util::rt::{TokioIo, TokioTimer};
use std::{
    convert::Infallible,
    net::TcpListener,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{ipc::InvokeBody, State, WebviewWindow};

const ADDRESS: &str = "127.0.0.1:18765";
const URL: &str = "http://127.0.0.1:18765/";
const STALE: Duration = Duration::from_secs(2);

#[derive(Default)]
struct Frame {
    active: bool,
    latest: Option<(Instant, Bytes)>,
}

#[derive(Default)]
pub struct Output {
    server: Option<tauri::async_runtime::JoinHandle<()>>,
    frame: Arc<Mutex<Frame>>,
}

impl Output {
    fn start(&mut self) -> Result<(), String> {
        if self.server.is_none() {
            let listener = TcpListener::bind(ADDRESS)
                .map_err(|error| format!("无法启动 OBS 透明输出（{ADDRESS}）：{error}"))?;
            listener
                .set_nonblocking(true)
                .map_err(|error| error.to_string())?;
            let frame = self.frame.clone();
            self.server = Some(tauri::async_runtime::spawn(async move {
                let Ok(listener) = tokio::net::TcpListener::from_std(listener) else {
                    return;
                };
                let slots = Arc::new(tokio::sync::Semaphore::new(16));
                loop {
                    // A transient failure (e.g. out of file descriptors) must not end the server.
                    let Ok((socket, _)) = listener.accept().await else {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    };
                    let Ok(permit) = slots.clone().try_acquire_owned() else {
                        continue;
                    };
                    let frame = frame.clone();
                    tauri::async_runtime::spawn(async move {
                        let _permit = permit;
                        let service = service_fn(move |request| {
                            let response = respond(&request, &frame);
                            async move { Ok::<_, Infallible>(response) }
                        });
                        let _ = http1::Builder::new()
                            .timer(TokioTimer::new())
                            .header_read_timeout(Duration::from_secs(5))
                            .max_buf_size(8192)
                            .serve_connection(TokioIo::new(socket), service)
                            .await;
                    });
                }
            }));
        }
        let mut frame = self.frame.lock().map_err(|_| "OBS 输出状态不可用")?;
        frame.latest = None;
        frame.active = true;
        Ok(())
    }

    fn stop(&self) -> Result<(), String> {
        let mut frame = self.frame.lock().map_err(|_| "OBS 输出状态不可用")?;
        frame.active = false;
        frame.latest = None;
        // Keep the local page reachable so an existing OBS source can reconnect on restart.
        Ok(())
    }

    fn submit(&self, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() < 33
            || bytes.len() > 8 * 1024 * 1024
            || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
            || &bytes[12..16] != b"IHDR"
            || bytes[16..20] != 1280_u32.to_be_bytes()
            || bytes[20..24] != 720_u32.to_be_bytes()
        {
            return Err("OBS 输出需要 1280×720 PNG 帧".into());
        }
        let mut frame = self.frame.lock().map_err(|_| "OBS 输出状态不可用")?;
        if frame.active {
            frame.latest = Some((Instant::now(), Bytes::copy_from_slice(bytes)));
        }
        Ok(())
    }
}

impl Drop for Output {
    fn drop(&mut self) {
        let _ = self.stop();
        if let Some(server) = self.server.take() {
            server.abort();
        }
    }
}

fn respond<B>(request: &Request<B>, frame: &Mutex<Frame>) -> Response<Full<Bytes>> {
    let header = |name| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
    };
    let allowed = header("host") == Some(ADDRESS)
        && header("origin").is_none_or(|origin| origin == URL.trim_end_matches('/'))
        && header("sec-fetch-site").is_none_or(|site| matches!(site, "same-origin" | "none"));
    let (status, mime, body) = if !allowed {
        (StatusCode::FORBIDDEN, "text/plain", Bytes::new())
    } else if request.method() != hyper::Method::GET {
        (StatusCode::METHOD_NOT_ALLOWED, "text/plain", Bytes::new())
    } else {
        match request.uri().path() {
            "/" => (
                StatusCode::OK,
                "text/html; charset=utf-8",
                Bytes::from_static(include_bytes!("obs-source.html")),
            ),
            "/source.js" => (
                StatusCode::OK,
                "text/javascript; charset=utf-8",
                Bytes::from_static(include_bytes!("obs-source.js")),
            ),
            "/frame" => match frame.lock() {
                Ok(frame) => match &frame.latest {
                    Some((at, bytes)) if frame.active && at.elapsed() < STALE => {
                        (StatusCode::OK, "image/png", bytes.clone())
                    }
                    _ => (StatusCode::NO_CONTENT, "image/png", Bytes::new()),
                },
                Err(_) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "text/plain",
                    Bytes::new(),
                ),
            },
            _ => (StatusCode::NOT_FOUND, "text/plain", Bytes::new()),
        }
    };
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cross-Origin-Resource-Policy", "same-origin")
        .header("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'")
        .body(Full::new(body)).unwrap()
}

#[tauri::command]
pub fn obs_start(
    window: WebviewWindow,
    output: State<'_, Mutex<Output>>,
) -> Result<&'static str, String> {
    super::require_main(&window)?;
    output.lock().map_err(|_| "OBS 输出状态不可用")?.start()?;
    Ok(URL)
}

#[tauri::command]
pub fn obs_stop(window: WebviewWindow, output: State<'_, Mutex<Output>>) -> Result<(), String> {
    super::require_main(&window)?;
    output.lock().map_err(|_| "OBS 输出状态不可用")?.stop()
}

#[tauri::command(async)]
pub fn obs_submit(
    window: WebviewWindow,
    output: State<'_, Mutex<Output>>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    super::require_main(&window)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("OBS 帧必须是二进制数据".into());
    };
    output
        .lock()
        .map_err(|_| "OBS 输出状态不可用")?
        .submit(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn local_server_serves_frames_and_keeps_the_url_alive_across_restart() {
        if TcpListener::bind(ADDRESS).is_err() {
            eprintln!("skipped: {ADDRESS} is in use, probably by a running VTubeLeaf");
            return;
        }
        let mut output = Output::default();
        output.start().unwrap();
        assert!(Output::default().start().is_err());
        let get = |path| {
            let mut socket = std::net::TcpStream::connect(ADDRESS).unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            write!(
                socket,
                "GET {path} HTTP/1.1\r\nHost: {ADDRESS}\r\nConnection: close\r\n\r\n"
            )
            .unwrap();
            let mut response = Vec::new();
            socket.read_to_end(&mut response).unwrap();
            response
        };
        let page = get("/");
        assert!(page.starts_with(b"HTTP/1.1 200"));
        assert!(String::from_utf8(page).unwrap().contains("/source.js"));
        assert!(get("/frame").starts_with(b"HTTP/1.1 204"));
        let mut png = vec![0; 33];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[12..16].copy_from_slice(b"IHDR");
        png[16..20].copy_from_slice(&1280_u32.to_be_bytes());
        png[20..24].copy_from_slice(&720_u32.to_be_bytes());
        output.submit(&png).unwrap();
        let frame = get("/frame");
        assert!(frame.starts_with(b"HTTP/1.1 200"));
        assert!(frame.ends_with(&png));
        output.stop().unwrap();
        output.submit(&png).unwrap();
        assert!(get("/frame").starts_with(b"HTTP/1.1 204"));
        output.start().unwrap();
        output.submit(&png).unwrap();
        assert!(get("/frame").ends_with(&png));
    }

    #[test]
    fn frames_expire_and_stop_clears_them_without_exposing_other_routes_or_origins() {
        let output = Output::default();
        let get = |path, host, origin| {
            respond(
                &Request::builder()
                    .uri(path)
                    .header("host", host)
                    .header("origin", origin)
                    .body(())
                    .unwrap(),
                &output.frame,
            )
            .status()
        };
        let origin = "http://127.0.0.1:18765";
        assert_eq!(get("/", ADDRESS, origin), StatusCode::OK);
        assert_eq!(get("/frame", ADDRESS, origin), StatusCode::NO_CONTENT);
        *output.frame.lock().unwrap() = Frame {
            active: true,
            latest: Some((Instant::now(), Bytes::from_static(b"frame"))),
        };
        assert_eq!(get("/frame", ADDRESS, origin), StatusCode::OK);
        assert_eq!(
            get("/frame", "attacker.example:18765", origin),
            StatusCode::FORBIDDEN
        );
        assert_eq!(
            get("/frame", ADDRESS, "https://attacker.example"),
            StatusCode::FORBIDDEN
        );
        assert_eq!(get("/frame", ADDRESS, "null"), StatusCode::FORBIDDEN);
        assert_eq!(get("/settings", ADDRESS, origin), StatusCode::NOT_FOUND);
        output.frame.lock().unwrap().latest.as_mut().unwrap().0 -= Duration::from_secs(3);
        assert_eq!(get("/frame", ADDRESS, origin), StatusCode::NO_CONTENT);
        assert!(output.submit(b"invalid").is_err());
        output.stop().unwrap();
        assert!(output.frame.lock().unwrap().latest.is_none());
        assert!(!output.frame.lock().unwrap().active);
    }
}
