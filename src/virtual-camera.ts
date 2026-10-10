import { invoke, isTauri } from '@tauri-apps/api/core';
import { t } from './i18n.ts';

export type CameraStatus = {
  supported: boolean;
  installed: boolean;
  active: boolean;
  consumers?: boolean;
  message: string;
};

export type CameraFrameSource = {
  /** Opaque top-down RGBA, reused by the next call; undefined while no frame can be rendered. */
  cameraPixels(
    width: number,
    height: number,
    background: string,
    mirror: boolean,
  ): Uint8Array | undefined;
};

const WIDTH = 1280;
const HEIGHT = 720;

export class VirtualCamera {
  private current: CameraStatus = {
    supported: false,
    installed: false,
    active: false,
    message: t('camera.unsupported'),
  };
  private lastFrame = -Infinity;
  private pending?: Promise<void>;
  private control: Promise<void> = Promise.resolve();
  private poll?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private stopping = 0;
  private onStatus: (status: CameraStatus) => void;

  constructor(onStatus: (status: CameraStatus) => void) {
    this.onStatus = onStatus;
    onStatus(this.current);
    if (isTauri()) {
      void this.pollStatus();
    }
  }

  private async pollStatus(): Promise<void> {
    await this.refresh();
    if (!this.destroyed) {
      const interval = this.current.active && this.current.consumers !== undefined ? 500 : 2000;
      this.poll = setTimeout(() => void this.pollStatus(), interval);
    }
  }

  get status(): CameraStatus {
    return this.current;
  }

  private update(status: CameraStatus) {
    if (
      !status ||
      typeof status.supported !== 'boolean' ||
      typeof status.installed !== 'boolean' ||
      typeof status.active !== 'boolean' ||
      (status.consumers !== undefined && typeof status.consumers !== 'boolean') ||
      typeof status.message !== 'string'
    ) {
      throw new Error(t('camera.statusUnreadable'));
    }
    const previous = this.current;
    this.current = status;
    // Polls repeat the same status every 0.5–2 s; only a change needs the UI to re-render.
    if (
      !this.destroyed &&
      (status.supported !== previous.supported ||
        status.installed !== previous.installed ||
        status.active !== previous.active ||
        status.consumers !== previous.consumers ||
        status.message !== previous.message)
    )
      this.onStatus(status);
  }

  private fail(error: unknown) {
    this.update({ ...this.current, active: false, message: String(error) });
  }

  refresh(): Promise<void> {
    return this.command('status');
  }

  private command(action: string, requireSuccess = false): Promise<void> {
    if (!isTauri() || this.destroyed) return Promise.resolve();
    const stopping = action === 'stop' || action === 'uninstall';
    if (stopping) this.stopping++;
    let failure: unknown;
    this.control = this.control.then(async () => {
      if (this.destroyed) return;
      try {
        await this.pending;
        this.update(await invoke<CameraStatus>(`plugin:virtual-camera|${action}`));
        if (action === 'start') this.lastFrame = -Infinity;
      } catch (error) {
        failure = error;
        this.fail(error);
      } finally {
        if (stopping) this.stopping--;
      }
    });
    return this.control.then(() => {
      if (requireSuccess && failure !== undefined) throw failure;
    });
  }

  install(): Promise<void> {
    return this.command('install');
  }
  uninstall(): Promise<void> {
    return this.command('uninstall');
  }
  start(): Promise<void> {
    return this.command('start');
  }
  stop(requireSuccess = false): Promise<void> {
    return this.command('stop', requireSuccess);
  }

  submit(source: CameraFrameSource, background: string, mirror = false): void {
    const now = performance.now();
    if (
      this.destroyed ||
      this.stopping ||
      !this.current.active ||
      this.current.consumers === false ||
      this.pending ||
      // Slack for a render loop whose ticks land slightly early.
      now - this.lastFrame < 1000 / 30 - 4
    )
      return;
    try {
      const frame = source.cameraPixels(WIDTH, HEIGHT, background, mirror);
      // A zero-size stage or a lost WebGL context has no frame; retry on the next tick.
      if (!frame) return;
      this.lastFrame = now;
      // The source reuses this buffer, but fetch copies the IPC body when the request is created,
      // and `pending` keeps the next frame from being rendered until this one is answered.
      this.pending = invoke<void>('plugin:virtual-camera|submit', frame)
        .catch((error) => {
          this.fail(error);
          // A failed producer must stop the native sink; the extension then blanks its source.
          void invoke('plugin:virtual-camera|stop').catch(() => {});
        })
        .finally(() => {
          this.pending = undefined;
        });
    } catch (error) {
      this.fail(error);
      void this.stop();
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    clearTimeout(this.poll);
    if (isTauri()) {
      void this.control
        .then(() => this.pending)
        .then(() => invoke('plugin:virtual-camera|stop'))
        .catch(() => {});
    }
  }
}
