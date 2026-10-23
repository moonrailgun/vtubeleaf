use crate::locale;
use crate::texture;
use http_body_util::{BodyExt, Full, Limited};
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
pub const URL: &str = "http://127.0.0.1:18765/";
const STALE: Duration = Duration::from_secs(2);

const OUTPUT_UNAVAILABLE: [&str; 5] = [
    "OBS output state is unavailable",
    "OBS 输出状态不可用",
    "OBS 出力の状態を利用できません",
    "El estado de la salida para OBS no está disponible",
    "L’état de la sortie OBS est indisponible",
];

#[derive(Default)]
struct Frame {
    active: bool,
    latest: Option<(Instant, Bytes)>,
    // An open OBS page polls /frame at least twice a second, even while the output is stopped.
    requested: Option<Instant>,
}

#[derive(Default)]
pub struct Output {
    server: Option<tauri::async_runtime::JoinHandle<()>>,
    frame: Arc<Mutex<Frame>>,
}

impl Output {
    fn start(&mut self, texture: Arc<Mutex<texture::Output>>) -> Result<(), String> {
        self.serve(texture)?;
        let mut frame = self
            .frame
            .lock()
            .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?;
        frame.latest = None;
        frame.active = true;
        Ok(())
    }

    /// Boots the local HTTP server. Frames can then arrive over `POST /frame` instead of the Tauri
    /// IPC channel, whose fixed round trip measured ~96 ms against ~0 ms here.
    pub fn serve(&mut self, texture: Arc<Mutex<texture::Output>>) -> Result<(), String> {
        if self.server.is_some() {
            return Ok(());
        }
        let listener = TcpListener::bind(ADDRESS).map_err(|error| {
            locale::text([
                "Could not start the OBS transparent output ({address}): {error}",
                "无法启动 OBS 透明输出（{address}）：{error}",
                "OBS 透過出力を開始できません（{address}）：{error}",
                "No se pudo iniciar la salida transparente para OBS ({address}): {error}",
                "Impossible de démarrer la sortie transparente OBS ({address}) : {error}",
            ])
            .replace("{address}", ADDRESS)
            .replace("{error}", &error.to_string())
        })?;
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
                // Without this the socket coalesces small writes and waits for an ACK, which adds
                // up to 40 ms to a request/response pair even on loopback.
                let _ = socket.set_nodelay(true);
                let Ok(permit) = slots.clone().try_acquire_owned() else {
                    continue;
                };
                let frame = frame.clone();
                let texture = texture.clone();
                tauri::async_runtime::spawn(async move {
                    let _permit = permit;
                    let service = service_fn(move |request| {
                        let frame = frame.clone();
                        let texture = texture.clone();
                        async move { Ok::<_, Infallible>(respond(request, &frame, &texture).await) }
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
        Ok(())
    }

    fn stop(&self) -> Result<(), String> {
        let mut frame = self
            .frame
            .lock()
            .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?;
        frame.active = false;
        frame.latest = None;
        // Keep the local page reachable so an existing OBS source can reconnect on restart.
        Ok(())
    }

    /// Whether an OBS browser source is polling, so PNG frames are worth encoding.
    fn wanted(&self) -> Result<bool, String> {
        let frame = self
            .frame
            .lock()
            .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?;
        Ok(frame.requested.is_some_and(|at| at.elapsed() < STALE))
    }

    fn submit(&self, bytes: &[u8]) -> Result<bool, String> {
        if bytes.len() < 33
            || bytes.len() > 8 * 1024 * 1024
            || &bytes[..8] != b"\x89PNG\r\n\x1a\n"
            || &bytes[12..16] != b"IHDR"
            || bytes[16..20] != 1280_u32.to_be_bytes()
            || bytes[20..24] != 720_u32.to_be_bytes()
        {
            return Err(locale::text([
                "OBS output needs 1280×720 PNG frames",
                "OBS 输出需要 1280×720 PNG 帧",
                "OBS 出力には 1280×720 の PNG フレームが必要です",
                "La salida para OBS necesita fotogramas PNG de 1280×720",
                "La sortie OBS nécessite des images PNG en 1280×720",
            ])
            .into());
        }
        let mut frame = self
            .frame
            .lock()
            .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?;
        if frame.active {
            frame.latest = Some((Instant::now(), Bytes::copy_from_slice(bytes)));
        }
        drop(frame);
        self.wanted()
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

fn reply(status: StatusCode, mime: &str, body: Bytes) -> Response<Full<Bytes>> {
    Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Cross-Origin-Resource-Policy", "same-origin")
        .header("Content-Security-Policy", "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'")
        .body(Full::new(body))
        .unwrap()
}

async fn respond<B>(
    request: Request<B>,
    frame: &Mutex<Frame>,
    texture: &Arc<Mutex<texture::Output>>,
) -> Response<Full<Bytes>>
where
    B: hyper::body::Body + Unpin,
    B::Error: std::error::Error + Send + Sync + 'static,
{
    let header = |name| {
        request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
    };
    // Read before any branch consumes the request: `into_body` moves it.
    let origin = header("origin").map(str::to_owned);
    // OBS's browser source is same-origin; the app itself fetches from its own webview origin,
    // which is cross-site, so it needs its own rule rather than a looser same-origin check.
    let same_origin = header("host") == Some(ADDRESS)
        && origin.as_deref().is_none_or(|origin| origin == URL.trim_end_matches('/'))
        && header("sec-fetch-site").is_none_or(|site| matches!(site, "same-origin" | "none"));
    let from_app = header("host") == Some(ADDRESS)
        && matches!(
            origin.as_deref(),
            Some("http://tauri.localhost") | Some("tauri://localhost")
        );
    let allowed = same_origin || from_app;
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let (status, mime, body) = if !allowed {
        (StatusCode::FORBIDDEN, "text/plain", Bytes::new())
    } else if method == hyper::Method::OPTIONS && path == "/frame" {
        // A binary POST is not a simple request, so the browser sends a preflight first.
        (StatusCode::NO_CONTENT, "text/plain", Bytes::new())
    } else if method == hyper::Method::POST && path == "/frame" {
        // A 1080p RGBA frame is 8.3 MB. The browser always sends `Content-Length` for an
        // `ArrayBuffer` body, so the declared size is checked first and `collect` can then reserve
        // the buffer once; reading frame by frame costs an extra runtime hop per chunk (~70 ms on
        // a 3.69 MB frame). Chunked uploads, which have no declared size, fall back to `Limited`.
        const MAX_FRAME: usize = 16 * 1024 * 1024;
        let body = request.into_body();
        let declared = body.size_hint().upper();
        if declared.is_some_and(|size| size as usize > MAX_FRAME) {
            return reply(StatusCode::PAYLOAD_TOO_LARGE, "text/plain", Bytes::new());
        }
        let read_start = Instant::now();
        let bytes = if declared.is_some() {
            match body.collect().await {
                Ok(collected) => collected.to_bytes(),
                Err(_) => return reply(StatusCode::BAD_REQUEST, "text/plain", Bytes::new()),
            }
        } else {
            match Limited::new(body, MAX_FRAME).collect().await {
                Ok(collected) => collected.to_bytes(),
                Err(_) => return reply(StatusCode::PAYLOAD_TOO_LARGE, "text/plain", Bytes::new()),
            }
        };
        let read_ms = read_start.elapsed().as_millis() as u32;
        match texture.lock() {
            Ok(output) => match output.submit(&bytes) {
                // The reply carries `wanted` so the front end keeps the receiver-aware polling it
                // had over IPC (Syphon reports whether a client is attached).
                Ok((wanted, send_ms)) => (
                    StatusCode::OK,
                    "application/json",
                    // `sendMs` covers the mutex wait plus the texture upload, so a slow frame can
                    // be attributed to the sender rather than to transport.
                    Bytes::from(format!(
                        "{{\"wanted\":{wanted},\"sendMs\":{send_ms},\"readMs\":{read_ms}}}"
                    )),
                ),
                Err(error) => (StatusCode::BAD_REQUEST, "text/plain", Bytes::from(error)),
            },
            Err(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "text/plain",
                Bytes::new(),
            ),
        }
    } else if method != hyper::Method::GET {
        (StatusCode::METHOD_NOT_ALLOWED, "text/plain", Bytes::new())
    } else {
        match path.as_str() {
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
                Ok(mut frame) => {
                    frame.requested = Some(Instant::now());
                    match &frame.latest {
                        Some((at, bytes)) if frame.active && at.elapsed() < STALE => {
                            (StatusCode::OK, "image/png", bytes.clone())
                        }
                        _ => (StatusCode::NO_CONTENT, "image/png", Bytes::new()),
                    }
                }
                Err(_) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "text/plain",
                    Bytes::new(),
                ),
            },
            _ => (StatusCode::NOT_FOUND, "text/plain", Bytes::new()),
        }
    };
    let mut response = reply(status, mime, body);
    // Without these the browser discards a cross-site response even when the server answered.
    if let Some(origin) = origin
        .filter(|origin| matches!(origin.as_str(), "http://tauri.localhost" | "tauri://localhost"))
    {
        if let Ok(value) = hyper::header::HeaderValue::from_str(&origin) {
            let headers = response.headers_mut();
            // Lets the app read the resource timing, which separates connection setup from the
            // server's own latency when a round trip looks slow.
            headers.insert("Timing-Allow-Origin", value.clone());
            headers.insert(hyper::header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
            headers.insert(
                hyper::header::ACCESS_CONTROL_ALLOW_METHODS,
                hyper::header::HeaderValue::from_static("POST, OPTIONS"),
            );
            headers.insert(
                hyper::header::ACCESS_CONTROL_ALLOW_HEADERS,
                hyper::header::HeaderValue::from_static("Content-Type"),
            );
            headers.insert(
                hyper::header::VARY,
                hyper::header::HeaderValue::from_static("Origin"),
            );
            headers.insert(
                "Cross-Origin-Resource-Policy",
                hyper::header::HeaderValue::from_static("cross-origin"),
            );
        }
    }
    response
}

#[tauri::command]
pub fn obs_start(
    window: WebviewWindow,
    output: State<'_, Mutex<Output>>,
    texture: State<'_, Arc<Mutex<texture::Output>>>,
) -> Result<&'static str, String> {
    super::require_main(&window)?;
    output
        .lock()
        .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?
        .start(texture.inner().clone())?;
    Ok(URL)
}

#[tauri::command]
pub fn obs_stop(window: WebviewWindow, output: State<'_, Mutex<Output>>) -> Result<(), String> {
    super::require_main(&window)?;
    output
        .lock()
        .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?
        .stop()
}

#[tauri::command]
pub fn obs_wanted(window: WebviewWindow, output: State<'_, Mutex<Output>>) -> Result<bool, String> {
    super::require_main(&window)?;
    output
        .lock()
        .map_err(|_| locale::text(OUTPUT_UNAVAILABLE))?
        .wanted()
}

/// Returns whether an OBS page is still polling; the app idles until one is.
#[tauri::command(async)]
pub fn obs_submit(
    window: WebviewWindow,
    output: State<'_, Mutex<Output>>,
    request: tauri::ipc::Request<'_>,
) -> Result<bool, String> {
    super::require_main(&window)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(locale::text([
            "OBS frames must be binary data",
            "OBS 帧必须是二进制数据",
            "OBS フレームはバイナリデータである必要があります",
            "Los fotogramas para OBS deben ser datos binarios",
            "Les images OBS doivent être des données binaires",
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
    use std::io::{Read, Write};

    fn png() -> Vec<u8> {
        let mut png = vec![0; 33];
        png[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        png[12..16].copy_from_slice(b"IHDR");
        png[16..20].copy_from_slice(&1280_u32.to_be_bytes());
        png[20..24].copy_from_slice(&720_u32.to_be_bytes());
        png
    }

    #[test]
    fn local_server_serves_frames_and_keeps_the_url_alive_across_restart() {
        if TcpListener::bind(ADDRESS).is_err() {
            eprintln!("skipped: {ADDRESS} is in use, probably by a running VTubeLeaf");
            return;
        }
        let mut output = Output::default();
        let texture = Arc::new(Mutex::new(texture::Output::default()));
        output.start(texture.clone()).unwrap();
        assert!(Output::default().start(texture.clone()).is_err());
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
        let png = png();
        assert!(
            output.submit(&png).unwrap(),
            "the polling page wants frames"
        );
        let frame = get("/frame");
        assert!(frame.starts_with(b"HTTP/1.1 200"));
        assert!(frame.ends_with(&png));
        output.stop().unwrap();
        output.submit(&png).unwrap();
        assert!(get("/frame").starts_with(b"HTTP/1.1 204"));
        output.start(texture).unwrap();
        output.submit(&png).unwrap();
        assert!(get("/frame").ends_with(&png));
    }

    #[test]
    fn frames_expire_and_stop_clears_them_without_exposing_other_routes_or_origins() {
        let output = Output::default();
        let texture = Arc::new(Mutex::new(texture::Output::default()));
        let get = |path, host, origin| {
            tauri::async_runtime::block_on(respond(
                Request::builder()
                    .uri(path)
                    .header("host", host)
                    .header("origin", origin)
                    .body(Full::new(Bytes::new()))
                    .unwrap(),
                &output.frame,
                &texture,
            ))
            .status()
        };
        let origin = "http://127.0.0.1:18765";
        assert_eq!(get("/", ADDRESS, origin), StatusCode::OK);
        assert_eq!(get("/frame", ADDRESS, origin), StatusCode::NO_CONTENT);
        *output.frame.lock().unwrap() = Frame {
            active: true,
            latest: Some((Instant::now(), Bytes::from_static(b"frame"))),
            ..Default::default()
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

    #[test]
    fn preflight_is_allowed_for_the_app_and_denied_for_other_origins() {
        let output = Output::default();
        let texture = Arc::new(Mutex::new(texture::Output::default()));
        let preflight = |origin: &str| {
            tauri::async_runtime::block_on(respond(
                Request::builder()
                    .method(hyper::Method::OPTIONS)
                    .uri("/frame")
                    .header("host", ADDRESS)
                    .header("origin", origin)
                    .body(Full::new(Bytes::new()))
                    .unwrap(),
                &output.frame,
                &texture,
            ))
        };
        let app = preflight("http://tauri.localhost");
        assert_eq!(app.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            app.headers()
                .get(hyper::header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap(),
            "http://tauri.localhost"
        );
        // A binary POST is not a simple request, so without this header the browser never sends it.
        assert!(app
            .headers()
            .get(hyper::header::ACCESS_CONTROL_ALLOW_METHODS)
            .unwrap()
            .to_str()
            .unwrap()
            .contains("POST"));
        assert_eq!(
            preflight("https://attacker.example").status(),
            StatusCode::FORBIDDEN
        );
    }

    #[test]
    fn frames_are_wanted_only_while_an_obs_page_polls() {
        let output = Output::default();
        let texture = Arc::new(Mutex::new(texture::Output::default()));
        let poll = |path, host| {
            let request = Request::builder()
                .uri(path)
                .header("host", host)
                .body(Full::new(Bytes::new()))
                .unwrap();
            tauri::async_runtime::block_on(respond(request, &output.frame, &texture));
        };
        assert!(!output.wanted().unwrap());
        poll("/", ADDRESS);
        poll("/frame", "attacker.example:18765");
        assert!(!output.wanted().unwrap(), "only allowed frame polls count");
        poll("/frame", ADDRESS);
        assert!(output.wanted().unwrap());
        assert!(output.submit(&png()).unwrap());
        // Stopping keeps the poll time so a restart serves an open page right away.
        output.stop().unwrap();
        assert!(output.wanted().unwrap());
        *output.frame.lock().unwrap().requested.as_mut().unwrap() -= Duration::from_secs(3);
        assert!(!output.wanted().unwrap());
        assert!(!output.submit(&png()).unwrap());
    }
}
