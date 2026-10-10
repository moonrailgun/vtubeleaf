import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Settings } from './state';

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
  };
  private control: Promise<void> = Promise.resolve();
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
    if (!this.state.supported) return Promise.reject(new Error('OBS 透明输出需要桌面应用'));
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
        if (mode === 'native') await invoke('texture_start');
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

  submit(source: ObsFrameSource): void {
    const now = performance.now();
    const native = this.running === 'native';
    const idle = !this.wanted;
    // Native frames follow the render loop. PNG encoding is capped at 30 FPS, with slack for a
    // 30 FPS render loop whose ticks land slightly early. Without a receiver, only poll for one.
    if (
      !this.state.active ||
      this.state.pending ||
      this.frame ||
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
        this.wanted = await invoke<boolean>(
          'texture_submit',
          source.transparentPixels(NATIVE_WIDTH, NATIVE_HEIGHT),
        );
        return;
      }
      // ponytail: PNG readback/encoding caps throughput; the native mode avoids it.
      const blob = await new Promise<Blob>((resolve, reject) => {
        source
          .transparentCanvas()
          .toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('无法编码透明画面'))),
            'image/png',
          );
      });
      const bytes = await blob.arrayBuffer();
      if (this.state.active && revision === this.revision)
        this.wanted = await invoke<boolean>('obs_submit', bytes);
    })()
      .catch((error) => {
        if (revision !== this.revision) return;
        this.report(`OBS 透明输出失败：${String(error)}`);
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
