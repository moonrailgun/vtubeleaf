import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Settings } from './state';
import { t } from './i18n.ts';

/** `native` shares frames through Syphon (macOS) or Spout2 (Windows); `browser` serves PNG frames to an OBS browser source. */
export type ObsMode = Settings['obsOutput'];
// Keep in sync with src-tauri/src/texture.rs.
const NATIVE_WIDTH = 1920;
const NATIVE_HEIGHT = 1080;

export interface ObsFrameSource {
  transparentCanvas(): HTMLCanvasElement;
  transparentPixels(width: number, height: number): Uint8Array;
}

function nativeOutput(): 'Syphon' | 'Spout2' | undefined {
  if (!isTauri()) return;
  if (/Mac/.test(navigator.platform)) return 'Syphon';
  if (/Win/.test(navigator.platform)) return 'Spout2';
}

export class ObsOutput {
  readonly state = {
    supported: isTauri(),
    native: nativeOutput(),
    active: false,
    pending: false,
    url: '',
    /** Milliseconds spent rendering and reading the last native frame, and in its round trip. */
    captureMs: 0,
    transferMs: 0,
    /** Empty round trips: the Tauri IPC channel and the local HTTP server, for comparison. */
    pingMs: 0,
    httpPingMs: 0,
    /** The last HTTP round trip split into connection setup and time to first byte. */
    httpConnectMs: 0,
    httpWaitMs: 0,
    /** The part of the last transfer spent inside the native sender (mutex + texture upload). */
    sendMs: 0,
    /** The part of the last transfer spent reading the request body on the server. */
    readMs: 0,
    /** Frames actually delivered to OBS per second, which a slow round trip caps. */
    sentFps: 0,
  };
  private control: Promise<void> = Promise.resolve();
  /** Base URL of the local server that accepts native frames over `POST /frame`. */
  private nativeUrl = '';
  /** Off-main-thread sender, so a frame upload never waits for a gap in the render loop. */
  private worker?: Worker;
  private frameId = 0;
  private sent = 0;
  private sentSince = performance.now();
  /** Frames handed to the worker and not yet answered; two keep the pipe busy without piling up. */
  private inFlight = 0;
  private frame?: Promise<void>;
  private running?: ObsMode;
  private revision = 0;
  private lastFrame = -Infinity;
  // Whether a Syphon client or a polling OBS page is attached; frames are not produced for nobody.
  private wanted = true;

  constructor(
    private changed: () => void,
    private report: (message: string) => void,
  ) {}

  setEnabled(enabled: boolean, mode: ObsMode = 'browser'): Promise<void> {
    if (!this.state.supported) return Promise.reject(new Error(t('obs.needsDesktop')));
    if (!this.state.native) mode = 'browser';
    const revision = ++this.revision;
    this.state.active = false;
    this.state.pending = true;
    this.changed();
    this.control = this.control
      .catch(() => {})
      .then(async () => {
        // Drain the encoder/IPC before stopping so a late frame cannot restart the source.
        await this.frame;
        if (this.running && !(enabled && this.running === mode)) {
          await invoke(this.running === 'native' ? 'texture_stop' : 'obs_stop');
          this.running = undefined;
        }
        if (!enabled) return;
        const url = mode === 'native' ? '' : await invoke<string>('obs_start');
        if (mode === 'native') {
          this.nativeUrl = await invoke<string>('texture_start');
          // Restart the worker so it picks up the URL of this session.
          this.worker?.terminate();
          this.worker = undefined;
          await this.measure();
        }
        this.running = mode;
        if (revision === this.revision) {
          this.state.url = url;
          this.state.active = true;
          this.lastFrame = -Infinity;
          this.wanted = true;
        }
      })
      .finally(() => {
        if (revision === this.revision) {
          this.state.pending = false;
          this.changed();
        }
      });
    return this.control;
  }

  /**
   * Times an empty round trip on both channels. The IPC figure is what the app used before frames
   * moved to the local server, so the two numbers show what the switch bought.
   */
  private async measure(): Promise<void> {
    try {
      const start = performance.now();
      await invoke('texture_ping', new Uint8Array(1024));
      this.state.pingMs = Math.round(performance.now() - start);
    } catch {
      this.state.pingMs = 0;
    }
    try {
      const url = new URL('frame', this.nativeUrl);
      const start = performance.now();
      const response = await fetch(url, { cache: 'no-store' });
      // A rejected origin answers just as fast, so only a 2xx proves the channel works.
      this.state.httpPingMs = response.ok ? Math.round(performance.now() - start) : -1;
      // Splits the round trip: a large `connect` means a new TCP connection every time, a large
      // `wait` means the server or the main thread is the slow part.
      const entry = performance.getEntriesByName(url.href).at(-1) as
        | PerformanceResourceTiming
        | undefined;
      this.state.httpConnectMs = entry ? Math.round(entry.connectEnd - entry.connectStart) : 0;
      this.state.httpWaitMs = entry ? Math.round(entry.responseStart - entry.requestStart) : 0;
    } catch {
      this.state.httpPingMs = 0;
    }
  }

  /** Lazily starts the frame worker and points it at the local server. */
  private workerFor(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./frame-worker.ts', import.meta.url), { type: 'module' });
      this.worker.postMessage({
        type: 'config',
        url: new URL('frame', this.nativeUrl || 'http://127.0.0.1:18765/').href,
      });
    }
    return this.worker;
  }

  /** Hands one frame to the worker and resolves with its reply, or `undefined` on failure. */
  private sendInWorker(buffer: ArrayBuffer): Promise<{ ok: boolean; wanted?: boolean; sendMs?: number; readMs?: number } | undefined> {
    const worker = this.workerFor();
    const id = ++this.frameId;
    return new Promise((resolve) => {
      const handler = (event: MessageEvent) => {
        if ((event.data as { id?: number }).id !== id) return;
        worker.removeEventListener('message', handler);
        resolve(event.data);
      };
      worker.addEventListener('message', handler);
      worker.postMessage({ type: 'frame', id, buffer }, [buffer]);
    });
  }

  submit(source: ObsFrameSource, width = NATIVE_WIDTH, height = NATIVE_HEIGHT): void {
    const now = performance.now();
    const native = this.running === 'native';
    const idle = !this.wanted;
    // Native frames follow the render loop. PNG encoding is capped at 30 FPS, with slack for a
    // 30 FPS render loop whose ticks land slightly early. Without a receiver, only poll for one.
    if (
      !this.state.active ||
      this.state.pending ||
      // A single in-flight frame serialised submissions: when the round trip was longer than the
      // frame interval, every second frame was skipped and the output halved (30 FPS rendered,
      // 15 FPS delivered). Two frames overlap instead, which keeps the pipe full at one frame of
      // extra latency.
      this.inFlight >= 2 ||
      now - this.lastFrame < (idle ? 250 : native ? 0 : 1000 / 30 - 4)
    )
      return;
    this.lastFrame = now;
    const revision = this.revision;
    this.frame = (async () => {
      if (idle) {
        this.wanted = await invoke<boolean>(native ? 'texture_wanted' : 'obs_wanted');
        return;
      }
      if (native) {
        const captureStart = performance.now();
        const pixels = source.transparentPixels(width, height);
        this.state.captureMs = performance.now() - captureStart;
        const start = performance.now();
        // The upload runs in a worker. On the main thread its response had to wait for a gap in
        // the render loop, which cost ~39 ms even for an empty round trip and grew with frame rate.
        // The buffer is copied because the worker takes ownership of what it is given.
        this.inFlight++;
        const reply = await this.sendInWorker(pixels.slice().buffer).finally(() => {
          this.inFlight--;
        });
        if (reply?.ok) {
          // Syphon reports whether a client is attached; keeping that avoids rendering frames
          // nobody reads on macOS.
          this.wanted = reply.wanted ?? true;
          this.state.sendMs = reply.sendMs ?? 0;
          this.state.readMs = reply.readMs ?? 0;
        } else {
          // Fall back to IPC so a server that failed to bind cannot stop the output outright.
          this.wanted = await invoke<boolean>('texture_submit', pixels);
        }
        this.state.transferMs = performance.now() - start;
        // A slow round trip serialises submissions, so report what OBS really receives.
        this.sent++;
        const now = performance.now();
        if (now - this.sentSince >= 1000) {
          this.state.sentFps = Math.round((this.sent * 1000) / (now - this.sentSince));
          this.sent = 0;
          this.sentSince = now;
        }
        return;
      }
      // ponytail: PNG readback/encoding caps throughput; the native mode avoids it.
      const blob = await new Promise<Blob>((resolve, reject) => {
        source
          .transparentCanvas()
          .toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error(t('obs.encodeFailed')))),
            'image/png',
          );
      });
      const bytes = await blob.arrayBuffer();
      if (this.state.active && revision === this.revision)
        this.wanted = await invoke<boolean>('obs_submit', bytes);
    })()
      .catch((error) => {
        if (revision !== this.revision) return;
        this.report(t('obs.outputFailed', { error: String(error) }));
        void this.setEnabled(false).catch((failure) => this.report(String(failure)));
      })
      .finally(() => {
        this.frame = undefined;
      });
  }

  destroy(): void {
    if (this.state.supported) void this.setEnabled(false).catch(() => {});
  }
}
