//! LAN receiver for the phone companion app. The desktop shows a QR code carrying a one-time
//! pairing token and the fingerprint of a per-session self-signed certificate; the phone pins that
//! fingerprint, opens one TLS WebSocket, pairs with the token and then streams validated face
//! frames. One paired phone at a time; a lost connection may resume with its session secret.
use crate::locale;
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    net::{IpAddr, Ipv4Addr, TcpListener},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio::sync::watch;
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::tungstenite::{protocol::WebSocketConfig, Message};

/// Wire protocol version; a phone with another version is refused before it can drive anything.
pub const VERSION: u64 = 1;
const MAX_MESSAGE: usize = 4096;
const MAX_FRAMES_PER_SECOND: u32 = 120;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const PING_INTERVAL: Duration = Duration::from_secs(5);
const IDLE_TIMEOUT: Duration = Duration::from_secs(15);
/// Optional face channels a phone may declare; anything else in a frame is ignored.
const EXTRAS: [(&str, f64, f64); 7] = [
    ("gazeX", -1., 1.),
    ("gazeY", -1., 1.),
    ("browLeft", -1., 1.),
    ("browRight", -1., 1.),
    ("mouthX", -1., 1.),
    ("cheekPuff", 0., 1.),
    ("tongueOut", 0., 1.),
];

const UNAVAILABLE: [&str; 5] = [
    "Phone link state is unavailable",
    "手机连接状态不可用",
    "スマートフォン接続の状態を利用できません",
    "El estado del enlace con el teléfono no está disponible",
    "L’état de la liaison avec le téléphone est indisponible",
];

/// The desktop face frame; the same field names as the web `Face`, so the main window accepts it as is.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Face {
    yaw: f64,
    pitch: f64,
    roll: f64,
    eye_left: f64,
    eye_right: f64,
    mouth_open: f64,
    mouth_smile: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    gaze_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    gaze_y: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    brow_left: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    brow_right: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    mouth_x: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cheek_puff: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    tongue_out: Option<f64>,
}

/// What the main window shows: who is paired, whether frames can flow, and the code to scan.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// `listening` (scan the code), `connected`, `paused` (phone paused) or `reconnecting`.
    state: &'static str,
    device: String,
    engine: String,
    name: String,
    addresses: Vec<String>,
    port: u16,
    /// SVG of the pairing code; empty while a phone is connected.
    qr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    rtt_ms: Option<u64>,
}

struct Session {
    secret: String,
    device: String,
    engine: String,
    capabilities: Vec<String>,
    /// Id of the connection that currently owns the session; 0 while the phone is away.
    connection: u64,
    paused: bool,
    stream: String,
    seq: u64,
}

struct State {
    token: String,
    qr: String,
    session: Option<Session>,
    name: String,
    addresses: Vec<String>,
    port: u16,
    fingerprint: String,
    next_connection: u64,
    rtt_ms: Option<u64>,
}

type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;
type Shared = Arc<Mutex<State>>;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn random_hex(bytes: usize) -> Result<String, String> {
    use ring::rand::SecureRandom;
    let mut buffer = vec![0_u8; bytes];
    ring::rand::SystemRandom::new()
        .fill(&mut buffer)
        .map_err(|_| {
            locale::text([
                "Could not generate a pairing code",
                "无法生成配对码",
                "ペアリングコードを生成できません",
                "No se pudo generar un código de emparejamiento",
                "Impossible de générer un code d’appairage",
            ])
        })?;
    Ok(hex(&buffer))
}

/// Constant-time credential comparison; both sides are hex strings of the same length.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0_u8, |difference, (x, y)| difference | (x ^ y))
            == 0
}

/// Private, link-local and carrier-shared ranges: the link never serves a public address.
fn is_lan(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            ip.is_private()
                || ip.is_loopback()
                || ip.is_link_local()
                || (ip.octets()[0] == 100 && (64..128).contains(&ip.octets()[1]))
        }
        IpAddr::V6(ip) => ip.is_loopback(),
    }
}

/// Where the default route leaves from: the Wi-Fi or Ethernet address a phone most likely shares.
/// A UDP connect sends nothing; it only asks the kernel which source address it would use.
fn primary_address() -> Option<Ipv4Addr> {
    let socket = std::net::UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    socket.connect((Ipv4Addr::new(1, 1, 1, 1), 53)).ok()?;
    match socket.local_addr().ok()?.ip() {
        IpAddr::V4(ip) => Some(ip),
        IpAddr::V6(_) => None,
    }
}

fn lan_addresses() -> Vec<String> {
    let candidates = if_addrs::get_if_addrs()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|interface| match interface.addr {
            if_addrs::IfAddr::V4(v4) => Some((v4.ip, v4.netmask)),
            if_addrs::IfAddr::V6(_) => None,
        })
        .collect();
    rank_addresses(primary_address(), candidates)
}

/// Up to four addresses for the QR code: the default route first, then home and office ranges.
/// Virtual bridges that only hold a network address (x.y.z.0) or a point-to-point VPN address
/// cannot be reached by a phone, so they are left out before the list is cut.
fn rank_addresses(primary: Option<Ipv4Addr>, candidates: Vec<(Ipv4Addr, Ipv4Addr)>) -> Vec<String> {
    let mut addresses: Vec<Ipv4Addr> = candidates
        .into_iter()
        .filter(|(ip, netmask)| {
            !ip.is_loopback()
                && !ip.is_link_local()
                && is_lan((*ip).into())
                && u32::from(*ip) & !u32::from(*netmask) != 0
        })
        .map(|(ip, _)| ip)
        .collect();
    addresses.sort_by_key(|ip| (Some(*ip) != primary, !ip.is_private(), *ip));
    addresses.dedup();
    addresses.truncate(4);
    addresses.iter().map(ToString::to_string).collect()
}

fn computer_name() -> String {
    hostname::get()
        .map(|name| {
            name.to_string_lossy()
                .trim_end_matches(".local")
                .to_string()
        })
        .ok()
        .filter(|name| !name.is_empty())
        .map(|name| name.chars().take(32).collect())
        .unwrap_or_else(|| "VTubeLeaf".to_string())
}

fn tls() -> Result<(TlsAcceptor, String), String> {
    let error = || {
        locale::text([
            "Could not prepare the encrypted phone link",
            "无法准备手机加密连接",
            "スマートフォンとの暗号化接続を準備できません",
            "No se pudo preparar el enlace cifrado con el teléfono",
            "Impossible de préparer la liaison chiffrée avec le téléphone",
        ])
    };
    let certified = rcgen::generate_simple_self_signed(vec!["vtubeleaf.local".to_string()])
        .map_err(|_| error())?;
    let certificate = certified.cert.der().clone();
    let fingerprint =
        hex(ring::digest::digest(&ring::digest::SHA256, certificate.as_ref()).as_ref());
    let key = rustls::pki_types::PrivatePkcs8KeyDer::from(certified.signing_key.serialize_der());
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| error())?
    .with_no_client_auth()
    .with_single_cert(vec![certificate], key.into())
    .map_err(|_| error())?;
    Ok((TlsAcceptor::from(Arc::new(config)), fingerprint))
}

/// Issues a fresh one-time token and the QR code that carries it.
/// What the QR code carries; the phone apps parse exactly this.
fn pairing(state: &State) -> String {
    json!({
        "v": VERSION,
        "a": state.addresses,
        "p": state.port,
        "t": state.token,
        "f": state.fingerprint,
        "n": state.name,
    })
    .to_string()
}

fn rotate_token(state: &mut State) -> Result<(), String> {
    state.token = random_hex(24)?;
    state.qr = qrcode::QrCode::new(pairing(state).as_bytes())
        .map_err(|_| {
            locale::text([
                "Could not draw the pairing QR code",
                "无法绘制配对二维码",
                "ペアリング用 QR コードを描画できません",
                "No se pudo dibujar el código QR de emparejamiento",
                "Impossible de dessiner le QR code d’appairage",
            ])
        })?
        .render::<qrcode::render::svg::Color>()
        .min_dimensions(192, 192)
        .build();
    Ok(())
}

fn status(state: &State) -> Status {
    let (kind, device, engine) = match &state.session {
        Some(session) if session.connection != 0 => (
            if session.paused {
                "paused"
            } else {
                "connected"
            },
            session.device.clone(),
            session.engine.clone(),
        ),
        Some(session) => (
            "reconnecting",
            session.device.clone(),
            session.engine.clone(),
        ),
        None => ("listening", String::new(), String::new()),
    };
    let connected = matches!(kind, "connected" | "paused");
    Status {
        state: kind,
        device,
        engine,
        name: state.name.clone(),
        addresses: state.addresses.clone(),
        port: state.port,
        qr: if connected {
            String::new()
        } else {
            state.qr.clone()
        },
        rtt_ms: if connected { state.rtt_ms } else { None },
    }
}

fn publish(state: &State, emit: &Emit) {
    emit(
        "phone-status",
        serde_json::to_value(status(state)).unwrap_or(Value::Null),
    );
}

fn text_field<'a>(value: &'a Value, key: &str, max: usize) -> Option<&'a str> {
    value[key]
        .as_str()
        .map(str::trim)
        .filter(|text| !text.is_empty() && text.chars().count() <= max)
}

/// Decides whether a `hello` may drive the avatar. Pairing consumes the token; a session secret
/// resumes (and takes over) its own session; everything else is refused with a reason the phone shows.
fn admit(state: &mut State, hello: &Value, connection: u64) -> Result<String, &'static str> {
    if hello["type"] != "hello" {
        return Err("format");
    }
    if hello["version"].as_u64() != Some(VERSION) {
        return Err("version");
    }
    let welcome = |state: &State, secret: &str| {
        json!({ "type": "welcome", "version": VERSION, "session": secret, "name": state.name })
            .to_string()
    };
    if let Some(secret) = hello["session"].as_str() {
        return match state.session.as_mut() {
            Some(session) if same(&session.secret, secret) => {
                session.connection = connection;
                session.paused = false;
                session.stream.clear();
                session.seq = 0;
                let secret = session.secret.clone();
                Ok(welcome(state, &secret))
            }
            _ => Err("session"),
        };
    }
    let connected = state
        .session
        .as_ref()
        .is_some_and(|session| session.connection != 0);
    let Some(token) = hello["token"].as_str() else {
        return Err("format");
    };
    if !same(&state.token, token) {
        return Err(if connected { "busy" } else { "token" });
    }
    if connected {
        return Err("busy");
    }
    let secret = random_hex(24).map_err(|_| "internal")?;
    state.session = Some(Session {
        secret: secret.clone(),
        device: text_field(hello, "device", 64)
            .unwrap_or("Phone")
            .to_string(),
        engine: text_field(hello, "engine", 32)
            .unwrap_or("unknown")
            .to_string(),
        capabilities: hello["capabilities"]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(Value::as_str)
                    .filter(|name| EXTRAS.iter().any(|(extra, ..)| extra == name))
                    .map(String::from)
                    .collect()
            })
            .unwrap_or_default(),
        connection,
        paused: false,
        stream: String::new(),
        seq: 0,
    });
    // The code on screen is spent; a second phone needs a new one issued by the desktop.
    rotate_token(state).map_err(|_| "internal")?;
    Ok(welcome(state, &secret))
}

/// Validates one frame. `Ok(None)` is a frame to skip (no face, stale or duplicate); `Err` is
/// malformed data that ends the connection.
fn accept_frame(session: &mut Session, value: &Value) -> Result<Option<Face>, ()> {
    let stream = value["stream"].as_str().ok_or(())?;
    if stream.is_empty() || stream.len() > 64 {
        return Err(());
    }
    let seq = value["seq"].as_u64().ok_or(())?;
    if stream == session.stream {
        if seq <= session.seq {
            return Ok(None);
        }
    } else {
        // A new stream after a reconnect; frames of the old one can no longer arrive out of order.
        session.stream = stream.to_string();
    }
    session.seq = seq;
    if !value["tracked"].as_bool().ok_or(())? {
        return Ok(None);
    }
    let number = |key: &str| -> Result<f64, ()> {
        let number = value[key].as_f64().ok_or(())?;
        if number.is_finite() {
            Ok(number)
        } else {
            Err(())
        }
    };
    let angle = |key: &str| number(key).and_then(|v| if v.abs() <= 180. { Ok(v) } else { Err(()) });
    let unit = |key: &str| number(key).map(|v| v.clamp(0., 1.));
    let extra = |key: &str| -> Result<Option<f64>, ()> {
        let Some((_, min, max)) = EXTRAS.iter().find(|(name, ..)| *name == key) else {
            return Err(());
        };
        if !session.capabilities.iter().any(|name| name == key) || value[key].is_null() {
            return Ok(None);
        }
        number(key).map(|v| Some(v.clamp(*min, *max)))
    };
    Ok(Some(Face {
        yaw: angle("yaw")?,
        pitch: angle("pitch")?,
        roll: angle("roll")?,
        eye_left: unit("eyeLeft")?,
        eye_right: unit("eyeRight")?,
        mouth_open: unit("mouthOpen")?,
        mouth_smile: unit("mouthSmile")?,
        gaze_x: extra("gazeX")?,
        gaze_y: extra("gazeY")?,
        brow_left: extra("browLeft")?,
        brow_right: extra("browRight")?,
        mouth_x: extra("mouthX")?,
        cheek_puff: extra("cheekPuff")?,
        tongue_out: extra("tongueOut")?,
    }))
}

pub struct Receiver {
    shutdown: watch::Sender<bool>,
    accept: Option<tauri::async_runtime::JoinHandle<()>>,
    // Tests read the pairing secrets here instead of decoding the QR code.
    #[cfg_attr(not(test), allow(dead_code))]
    shared: Shared,
}

impl Receiver {
    /// Opens the listener on an OS-chosen port and publishes the first `phone-status`.
    pub fn start(emit: impl Fn(&str, Value) + Send + Sync + 'static) -> Result<Self, String> {
        let (acceptor, fingerprint) = tls()?;
        let listener = TcpListener::bind((Ipv4Addr::UNSPECIFIED, 0)).map_err(|_| {
            locale::text([
                "Could not open a port for the phone link",
                "无法为手机连接打开端口",
                "スマートフォン接続用のポートを開けません",
                "No se pudo abrir un puerto para el enlace con el teléfono",
                "Impossible d’ouvrir un port pour la liaison avec le téléphone",
            ])
        })?;
        listener
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
        let port = listener
            .local_addr()
            .map_err(|error| error.to_string())?
            .port();
        let mut state = State {
            token: String::new(),
            qr: String::new(),
            session: None,
            name: computer_name(),
            addresses: lan_addresses(),
            port,
            fingerprint,
            next_connection: 1,
            rtt_ms: None,
        };
        rotate_token(&mut state)?;
        let emit: Emit = Arc::new(emit);
        publish(&state, &emit);
        let shared: Shared = Arc::new(Mutex::new(state));
        let (shutdown, closing) = watch::channel(false);
        let accept = tauri::async_runtime::spawn(accept_loop(
            listener,
            acceptor,
            shared.clone(),
            emit,
            closing,
        ));
        Ok(Self {
            shutdown,
            accept: Some(accept),
            shared,
        })
    }
}

impl Drop for Receiver {
    fn drop(&mut self) {
        if let Some(accept) = self.accept.take() {
            accept.abort();
        }
        // Connection tasks say goodbye to the phone and end on their own.
        let _ = self.shutdown.send(true);
    }
}

async fn accept_loop(
    listener: TcpListener,
    acceptor: TlsAcceptor,
    shared: Shared,
    emit: Emit,
    closing: watch::Receiver<bool>,
) {
    let Ok(listener) = tokio::net::TcpListener::from_std(listener) else {
        emit(
            "phone-error",
            Value::String(locale::text(UNAVAILABLE).into()),
        );
        return;
    };
    let slots = Arc::new(tokio::sync::Semaphore::new(8));
    loop {
        let Ok((socket, peer)) = listener.accept().await else {
            tokio::time::sleep(Duration::from_millis(100)).await;
            continue;
        };
        if !is_lan(peer.ip()) {
            continue;
        }
        let Ok(permit) = slots.clone().try_acquire_owned() else {
            continue;
        };
        let (acceptor, shared, emit, closing) = (
            acceptor.clone(),
            shared.clone(),
            emit.clone(),
            closing.clone(),
        );
        tauri::async_runtime::spawn(async move {
            let _permit = permit;
            serve(socket, acceptor, shared, emit, closing).await;
        });
    }
}

async fn serve(
    socket: tokio::net::TcpStream,
    acceptor: TlsAcceptor,
    shared: Shared,
    emit: Emit,
    mut closing: watch::Receiver<bool>,
) {
    let Ok(Ok(tls)) = tokio::time::timeout(HANDSHAKE_TIMEOUT, acceptor.accept(socket)).await else {
        return;
    };
    let config = WebSocketConfig::default()
        .max_message_size(Some(MAX_MESSAGE))
        .max_frame_size(Some(MAX_MESSAGE));
    let Ok(Ok(mut ws)) = tokio::time::timeout(
        HANDSHAKE_TIMEOUT,
        tokio_tungstenite::accept_async_with_config(tls, Some(config)),
    )
    .await
    else {
        return;
    };
    let Ok(Some(Ok(Message::Text(hello)))) =
        tokio::time::timeout(HANDSHAKE_TIMEOUT, ws.next()).await
    else {
        return;
    };
    let Ok(hello) = serde_json::from_str::<Value>(&hello) else {
        return;
    };
    let admitted = {
        let Ok(mut state) = shared.lock() else {
            return;
        };
        let connection = state.next_connection;
        state.next_connection += 1;
        admit(&mut state, &hello, connection).map(|welcome| (connection, welcome))
    };
    let connection = match admitted {
        Ok((connection, welcome)) => {
            if ws.send(Message::text(welcome)).await.is_err() {
                return;
            }
            connection
        }
        Err(reason) => {
            let reject = json!({ "type": "reject", "reason": reason, "version": VERSION });
            let _ = ws.send(Message::text(reject.to_string())).await;
            let _ = ws.close(None).await;
            return;
        }
    };
    let owns = |state: &State| {
        state
            .session
            .as_ref()
            .is_some_and(|session| session.connection == connection)
    };
    if let Ok(state) = shared.lock() {
        publish(&state, &emit);
    }
    let mut ping = tokio::time::interval(PING_INTERVAL);
    ping.tick().await;
    let mut last_activity = Instant::now();
    let mut ping_sent: Option<Instant> = None;
    let mut window = (Instant::now(), 0_u32);
    let goodbye = loop {
        tokio::select! {
            message = ws.next() => match message {
                Some(Ok(Message::Text(text))) => {
                    last_activity = Instant::now();
                    if window.0.elapsed() >= Duration::from_secs(1) {
                        window = (Instant::now(), 0);
                    }
                    window.1 += 1;
                    if window.1 > MAX_FRAMES_PER_SECOND {
                        break Some("rate");
                    }
                    let Ok(value) = serde_json::from_str::<Value>(&text) else {
                        break Some("format");
                    };
                    let Ok(mut state) = shared.lock() else {
                        break None;
                    };
                    if !owns(&state) {
                        break None;
                    }
                    match value["type"].as_str() {
                        Some("frame") => {
                            let session = state.session.as_mut().expect("owned session");
                            match accept_frame(session, &value) {
                                Ok(Some(face)) => {
                                    drop(state);
                                    emit("phone-frame", serde_json::to_value(face).unwrap_or(Value::Null));
                                }
                                Ok(None) => {}
                                Err(()) => break Some("format"),
                            }
                        }
                        Some("state") => {
                            let paused = value["tracking"] == "paused";
                            state.session.as_mut().expect("owned session").paused = paused;
                            publish(&state, &emit);
                        }
                        Some("bye") => {
                            state.session = None;
                            state.rtt_ms = None;
                            if rotate_token(&mut state).is_ok() {
                                publish(&state, &emit);
                            }
                            break None;
                        }
                        _ => {}
                    }
                }
                Some(Ok(Message::Pong(_))) => {
                    last_activity = Instant::now();
                    if let (Some(sent), Ok(mut state)) = (ping_sent.take(), shared.lock()) {
                        state.rtt_ms = Some(sent.elapsed().as_millis() as u64);
                    }
                }
                Some(Ok(Message::Ping(_) | Message::Frame(_))) => last_activity = Instant::now(),
                Some(Ok(Message::Binary(_))) => break Some("format"),
                Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break None,
            },
            _ = ping.tick() => {
                // Scoped so the guard is provably gone before the send below.
                let alive = match shared.lock() {
                    Ok(state) if owns(&state) && last_activity.elapsed() <= IDLE_TIMEOUT => {
                        publish(&state, &emit);
                        true
                    }
                    _ => false,
                };
                if !alive {
                    break None;
                }
                ping_sent = Some(Instant::now());
                if ws.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break None;
                }
            }
            _ = closing.changed() => break Some("disconnected"),
        }
    };
    if let Some(reason) = goodbye {
        let bye = json!({ "type": "bye", "reason": reason });
        let _ = ws.send(Message::text(bye.to_string())).await;
    }
    let _ = ws.close(None).await;
    // Only the owner marks the phone as away; a reconnect that took over keeps its own state.
    if let Ok(mut state) = shared.lock() {
        if owns(&state) {
            let session = state.session.as_mut().expect("owned session");
            session.connection = 0;
            state.rtt_ms = None;
            if goodbye == Some("disconnected") {
                state.session = None;
            } else if rotate_token(&mut state).is_err() {
                return;
            }
            publish(&state, &emit);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
    use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
    use std::sync::mpsc;

    /// Trusts exactly the certificate whose SHA-256 is in the QR code, as the phone apps do.
    #[derive(Debug)]
    struct Pinned(String);
    impl ServerCertVerifier for Pinned {
        fn verify_server_cert(
            &self,
            end_entity: &CertificateDer<'_>,
            _: &[CertificateDer<'_>],
            _: &ServerName<'_>,
            _: &[u8],
            _: UnixTime,
        ) -> Result<ServerCertVerified, rustls::Error> {
            let digest = ring::digest::digest(&ring::digest::SHA256, end_entity.as_ref());
            if hex(digest.as_ref()) == self.0 {
                Ok(ServerCertVerified::assertion())
            } else {
                Err(rustls::Error::General("fingerprint mismatch".into()))
            }
        }
        fn verify_tls12_signature(
            &self,
            _: &[u8],
            _: &CertificateDer<'_>,
            _: &rustls::DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, rustls::Error> {
            Ok(HandshakeSignatureValid::assertion())
        }
        fn verify_tls13_signature(
            &self,
            _: &[u8],
            _: &CertificateDer<'_>,
            _: &rustls::DigitallySignedStruct,
        ) -> Result<HandshakeSignatureValid, rustls::Error> {
            Ok(HandshakeSignatureValid::assertion())
        }
        fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
            rustls::crypto::ring::default_provider()
                .signature_verification_algorithms
                .supported_schemes()
        }
    }

    type Client =
        tokio_tungstenite::WebSocketStream<tokio_rustls::client::TlsStream<tokio::net::TcpStream>>;

    struct Harness {
        events: mpsc::Receiver<(String, Value)>,
        _receiver: Receiver,
        port: u16,
        fingerprint: String,
        token: String,
    }

    fn start() -> Harness {
        let (sender, events) = mpsc::channel();
        let receiver = Receiver::start(move |event, payload| {
            let _ = sender.send((event.to_string(), payload));
        })
        .unwrap();
        let (event, status) = events.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(event, "phone-status");
        assert_eq!(status["state"], "listening");
        assert!(status["qr"].as_str().unwrap().starts_with("<?xml"));
        let shared = receiver_state(&receiver);
        Harness {
            events,
            port: status["port"].as_u64().unwrap() as u16,
            fingerprint: shared.0,
            token: shared.1,
            _receiver: receiver,
        }
    }

    // Tests read what the QR code carries through this side door rather than decoding the SVG.
    fn receiver_state(receiver: &Receiver) -> (String, String) {
        let state = receiver.shared.lock().unwrap();
        (state.fingerprint.clone(), state.token.clone())
    }

    async fn connect(port: u16, fingerprint: &str) -> Client {
        let config = rustls::ClientConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(Pinned(fingerprint.to_string())))
        .with_no_client_auth();
        let tcp = tokio::net::TcpStream::connect(("127.0.0.1", port))
            .await
            .unwrap();
        let tls = tokio_rustls::TlsConnector::from(Arc::new(config))
            .connect(ServerName::try_from("vtubeleaf.local").unwrap(), tcp)
            .await
            .unwrap();
        let (client, _) = tokio_tungstenite::client_async(format!("wss://127.0.0.1:{port}/"), tls)
            .await
            .unwrap();
        client
    }

    async fn say(client: &mut Client, message: Value) {
        client
            .send(Message::text(message.to_string()))
            .await
            .unwrap();
    }

    async fn hear(client: &mut Client) -> Value {
        match tokio::time::timeout(Duration::from_secs(2), client.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => serde_json::from_str(&text).unwrap(),
            other => panic!("unexpected message: {other:?}"),
        }
    }

    fn next_event(harness: &Harness, event: &str) -> Value {
        loop {
            let (name, payload) = harness.events.recv_timeout(Duration::from_secs(2)).unwrap();
            if name == event {
                return payload;
            }
        }
    }

    /// Skips intermediate statuses (a takeover publishes one too) until the expected state shows.
    fn wait_status(harness: &Harness, state: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            let status = next_event(harness, "phone-status");
            if status["state"] == state {
                return status;
            }
            assert!(Instant::now() < deadline, "no {state} status");
        }
    }

    fn frame(stream: &str, seq: u64) -> Value {
        json!({
            "type": "frame", "stream": stream, "seq": seq, "t": seq as f64 * 33.3, "tracked": true,
            "yaw": 12.5, "pitch": -4.0, "roll": 1.5,
            "eyeLeft": 0.9, "eyeRight": 1.2, "mouthOpen": 0.3, "mouthSmile": 0.1,
            "browLeft": 0.4, "gazeX": 2.0, "cheekPuff": 0.5,
        })
    }

    /// Device check, not a unit test: prints the QR payload (feed it to the debug app with
    /// `adb shell am start -S -n com.moonrailgun.vtubeleaf.phone/.MainActivity --es pairing '<json>'`
    /// or scan it), then logs statuses and tracked frames for `VTUBELEAF_PHONE_SECONDS` (default 60).
    /// cargo test --locked --manifest-path src-tauri/Cargo.toml link_a_real_phone -- --ignored --nocapture
    #[test]
    #[ignore]
    fn link_a_real_phone() {
        let harness = start();
        println!(
            "PAIRING {}",
            pairing(&harness._receiver.shared.lock().unwrap())
        );
        let seconds = std::env::var("VTUBELEAF_PHONE_SECONDS")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(60);
        let deadline = Instant::now() + Duration::from_secs(seconds);
        let (mut frames, mut first, mut last) = (0u64, None::<Instant>, Value::Null);
        while let Ok((event, payload)) = harness
            .events
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
        {
            match event.as_str() {
                "phone-status" => println!("STATUS {payload}"),
                "phone-frame" => {
                    frames += 1;
                    let since = first
                        .get_or_insert_with(Instant::now)
                        .elapsed()
                        .as_secs_f64();
                    if frames == 1 {
                        println!("FRAME first {payload}");
                    } else if frames % 100 == 0 {
                        println!("FRAME {frames} {:.1} fps {payload}", frames as f64 / since);
                    }
                    last = payload;
                }
                _ => {}
            }
        }
        let fps = first.map_or(0.0, |start| {
            frames as f64 / start.elapsed().as_secs_f64().max(0.001)
        });
        println!("SUMMARY tracked_frames={frames} fps={fps:.1} last={last}");
    }

    #[test]
    fn qr_addresses_lead_with_the_default_route_and_skip_virtual_bridges() {
        let mask = Ipv4Addr::new(255, 255, 255, 0);
        let wifi = Ipv4Addr::new(192, 168, 111, 33);
        let ranked = rank_addresses(
            Some(wifi),
            vec![
                (Ipv4Addr::new(10, 211, 55, 2), mask),
                (Ipv4Addr::new(192, 168, 97, 0), mask),
                (Ipv4Addr::new(192, 168, 107, 0), mask),
                (Ipv4Addr::new(100, 110, 157, 26), Ipv4Addr::BROADCAST),
                (Ipv4Addr::LOCALHOST, Ipv4Addr::new(255, 0, 0, 0)),
                (Ipv4Addr::new(10, 37, 129, 2), mask),
                (
                    Ipv4Addr::new(192, 168, 139, 3),
                    Ipv4Addr::new(255, 255, 254, 0),
                ),
                (wifi, Ipv4Addr::new(255, 255, 254, 0)),
                (Ipv4Addr::new(8, 8, 8, 8), mask),
            ],
        );
        assert_eq!(
            ranked,
            [
                "192.168.111.33",
                "10.37.129.2",
                "10.211.55.2",
                "192.168.139.3"
            ]
        );
        assert_eq!(
            rank_addresses(None, vec![(wifi, mask), (wifi, mask)]),
            ["192.168.111.33"]
        );
    }

    #[test]
    fn pairs_once_validates_frames_and_refuses_other_phones() {
        let harness = start();
        tauri::async_runtime::block_on(async {
            // A mismatched fingerprint never reaches the WebSocket.
            let config = rustls::ClientConfig::builder_with_provider(Arc::new(
                rustls::crypto::ring::default_provider(),
            ))
            .with_safe_default_protocol_versions()
            .unwrap()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(Pinned("00".repeat(32))))
            .with_no_client_auth();
            let tcp = tokio::net::TcpStream::connect(("127.0.0.1", harness.port))
                .await
                .unwrap();
            assert!(tokio_rustls::TlsConnector::from(Arc::new(config))
                .connect(ServerName::try_from("vtubeleaf.local").unwrap(), tcp)
                .await
                .is_err());

            let mut stale = connect(harness.port, &harness.fingerprint).await;
            say(
                &mut stale,
                json!({ "type": "hello", "version": 2, "token": harness.token }),
            )
            .await;
            assert_eq!(hear(&mut stale).await["reason"], "version");

            let mut wrong = connect(harness.port, &harness.fingerprint).await;
            say(
                &mut wrong,
                json!({ "type": "hello", "version": 1, "token": "deadbeef" }),
            )
            .await;
            assert_eq!(hear(&mut wrong).await["reason"], "token");

            let mut phone = connect(harness.port, &harness.fingerprint).await;
            say(
                &mut phone,
                json!({
                    "type": "hello", "version": 1, "token": harness.token,
                    "device": "Test phone", "engine": "arkit",
                    "capabilities": ["browLeft", "gazeX", "bogus"],
                }),
            )
            .await;
            let welcome = hear(&mut phone).await;
            assert_eq!(welcome["type"], "welcome");
            let secret = welcome["session"].as_str().unwrap().to_string();
            assert_eq!(secret.len(), 48);
            let status = wait_status(&harness, "connected");
            assert_eq!(status["device"], "Test phone");
            assert_eq!(status["engine"], "arkit");
            assert_eq!(status["qr"], "");

            // The token was spent: a second phone is told the desktop is busy.
            let mut second = connect(harness.port, &harness.fingerprint).await;
            say(
                &mut second,
                json!({ "type": "hello", "version": 1, "token": harness.token }),
            )
            .await;
            assert_eq!(hear(&mut second).await["reason"], "busy");

            say(&mut phone, frame("s1", 1)).await;
            let face = next_event(&harness, "phone-frame");
            assert_eq!(
                face,
                json!({
                    "yaw": 12.5, "pitch": -4.0, "roll": 1.5,
                    "eyeLeft": 0.9, "eyeRight": 1.0, "mouthOpen": 0.3, "mouthSmile": 0.1,
                    "browLeft": 0.4, "gazeX": 1.0,
                })
            );
            // Duplicate and out-of-order frames and untracked frames drive nothing.
            say(&mut phone, frame("s1", 1)).await;
            say(&mut phone, frame("s1", 0)).await;
            let mut lost = frame("s1", 2);
            lost["tracked"] = Value::Bool(false);
            say(&mut phone, lost).await;
            say(&mut phone, json!({ "type": "state", "tracking": "paused" })).await;
            wait_status(&harness, "paused");
            say(&mut phone, frame("s2", 1)).await;
            assert_eq!(next_event(&harness, "phone-frame")["yaw"], 12.5);

            // Resuming with the session secret takes over, and a new stream starts its own order.
            let mut resumed = connect(harness.port, &harness.fingerprint).await;
            say(
                &mut resumed,
                json!({ "type": "hello", "version": 1, "session": secret }),
            )
            .await;
            assert_eq!(hear(&mut resumed).await["type"], "welcome");
            say(&mut resumed, frame("s3", 1)).await;
            assert_eq!(next_event(&harness, "phone-frame")["yaw"], 12.5);
            say(&mut phone, frame("s2", 2)).await;
            let mut wrong_secret = connect(harness.port, &harness.fingerprint).await;
            say(
                &mut wrong_secret,
                json!({ "type": "hello", "version": 1, "session": "nope" }),
            )
            .await;
            assert_eq!(hear(&mut wrong_secret).await["reason"], "session");

            // Malformed data closes the connection with a reason, and the session can still resume.
            let mut bad = frame("s3", 2);
            bad["yaw"] = json!(400);
            say(&mut resumed, bad).await;
            assert_eq!(
                hear(&mut resumed).await,
                json!({ "type": "bye", "reason": "format" })
            );
            let status = wait_status(&harness, "reconnecting");
            assert_eq!(status["device"], "Test phone");
            assert!(status["qr"].as_str().unwrap().starts_with("<?xml"));

            // Saying goodbye ends the session: the old secret is gone and a new code is issued.
            let mut back = connect(harness.port, &harness.fingerprint).await;
            say(
                &mut back,
                json!({ "type": "hello", "version": 1, "session": secret }),
            )
            .await;
            assert_eq!(hear(&mut back).await["type"], "welcome");
            wait_status(&harness, "connected");
            say(&mut back, json!({ "type": "bye" })).await;
            wait_status(&harness, "listening");
            let mut gone = connect(harness.port, &harness.fingerprint).await;
            say(
                &mut gone,
                json!({ "type": "hello", "version": 1, "session": secret }),
            )
            .await;
            assert_eq!(hear(&mut gone).await["reason"], "session");
        });
    }

    #[test]
    fn dropping_the_receiver_says_goodbye_and_frees_the_port() {
        let harness = start();
        let port = harness.port;
        tauri::async_runtime::block_on(async {
            let mut phone = connect(port, &harness.fingerprint).await;
            say(
                &mut phone,
                json!({ "type": "hello", "version": 1, "token": harness.token }),
            )
            .await;
            assert_eq!(hear(&mut phone).await["type"], "welcome");
            drop(harness);
            assert_eq!(
                hear(&mut phone).await,
                json!({ "type": "bye", "reason": "disconnected" })
            );
            tokio::time::sleep(Duration::from_millis(100)).await;
            assert!(tokio::net::TcpStream::connect(("127.0.0.1", port))
                .await
                .is_err());
        });
    }

    #[test]
    fn frame_validation_is_strict_about_shape_and_optional_channels() {
        let mut session = Session {
            secret: String::new(),
            device: String::new(),
            engine: String::new(),
            capabilities: vec!["mouthX".into()],
            connection: 1,
            paused: false,
            stream: String::new(),
            seq: 0,
        };
        let base = json!({
            "type": "frame", "stream": "a", "seq": 5, "tracked": true,
            "yaw": 0, "pitch": 0, "roll": 0,
            "eyeLeft": 1, "eyeRight": 1, "mouthOpen": 0, "mouthSmile": 0,
            "mouthX": -3, "tongueOut": 1,
        });
        let face = accept_frame(&mut session, &base).unwrap().unwrap();
        assert_eq!(face.mouth_x, Some(-1.));
        assert_eq!(face.tongue_out, None);
        assert!(accept_frame(&mut session, &json!({ "stream": "a", "seq": 6 })).is_err());
        let mut nan = base.clone();
        nan["seq"] = json!(7);
        nan["eyeLeft"] = Value::String("NaN".into());
        assert!(accept_frame(&mut session, &nan).is_err());
        let mut long_stream = base.clone();
        long_stream["stream"] = Value::String("x".repeat(65));
        assert!(accept_frame(&mut session, &long_stream).is_err());
        assert!(accept_frame(&mut session, &base).unwrap().is_none());
    }

    #[test]
    fn only_lan_peers_are_served() {
        assert!(is_lan("192.168.1.20".parse().unwrap()));
        assert!(is_lan("10.0.0.1".parse().unwrap()));
        assert!(is_lan("100.100.1.1".parse().unwrap()));
        assert!(is_lan("127.0.0.1".parse().unwrap()));
        assert!(!is_lan("8.8.8.8".parse().unwrap()));
        assert!(!is_lan("2001:db8::1".parse().unwrap()));
    }
}
