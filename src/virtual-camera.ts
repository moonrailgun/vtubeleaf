import { invoke, isTauri } from '@tauri-apps/api/core';

export type CameraStatus = {
  supported: boolean;
  installed: boolean;
  active: boolean;
  message: string;
};

const WIDTH = 1280;
const HEIGHT = 720;

export class VirtualCamera {
  private current: CameraStatus = {
    supported: false,
    installed: false,
    active: false,
    message: '原生虚拟摄像头需要 Windows 或 macOS 桌面应用',
  };
  private composite?: HTMLCanvasElement;
  private context?: CanvasRenderingContext2D;
  private lastFrame = -Infinity;
  private pending?: Promise<void>;
  private control: Promise<void> = Promise.resolve();
  private poll?: ReturnType<typeof setInterval>;
  private destroyed = false;
  private stopping = false;
  private onStatus: (status: CameraStatus) => void;

  constructor(onStatus: (status: CameraStatus) => void) {
    this.onStatus = onStatus;
    onStatus(this.current);
    if (isTauri()) {
      void this.refresh();
      this.poll = setInterval(() => void this.refresh(), 2000);
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
      typeof status.message !== 'string'
    ) {
      throw new Error('无法读取摄像头状态');
    }
    this.current = status;
    if (!this.destroyed) this.onStatus(status);
  }

  private fail(error: unknown) {
    this.update({ ...this.current, active: false, message: String(error) });
  }

  async refresh(): Promise<void> {
    if (this.destroyed || !isTauri()) return;
    try {
      this.update(await invoke<CameraStatus>('plugin:virtual-camera|status'));
    } catch (error) {
      this.fail(error);
    }
  }

  private command(action: string): Promise<void> {
    if (!isTauri() || this.destroyed) return Promise.resolve();
    if (action === 'stop' || action === 'uninstall') this.stopping = true;
    this.control = this.control.then(async () => {
      if (this.destroyed) return;
      try {
        await this.pending;
        this.update(await invoke<CameraStatus>(`plugin:virtual-camera|${action}`));
        if (action === 'start') this.lastFrame = -Infinity;
      } catch (error) {
        this.fail(error);
      } finally {
        this.stopping = false;
      }
    });
    return this.control;
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
  stop(): Promise<void> {
    return this.command('stop');
  }

  submit(canvas: HTMLCanvasElement, background: string): void {
    const now = performance.now();
    if (
      this.destroyed ||
      this.stopping ||
      !this.current.active ||
      this.pending ||
      now - this.lastFrame < 1000 / 30 ||
      canvas.width <= 0 ||
      canvas.height <= 0
    )
      return;
    try {
      if (!this.composite) {
        this.composite = document.createElement('canvas');
        this.composite.width = WIDTH;
        this.composite.height = HEIGHT;
        this.context =
          this.composite.getContext('2d', { alpha: false, willReadFrequently: true }) ?? undefined;
      }
      const context = this.context;
      if (!context) throw new Error('无法创建摄像头画布');
      // Reset to opaque black before applying a possibly transparent scene background.
      context.fillStyle = '#000000';
      context.fillRect(0, 0, WIDTH, HEIGHT);
      context.fillStyle = background;
      context.fillRect(0, 0, WIDTH, HEIGHT);
      const scale = Math.min(WIDTH / canvas.width, HEIGHT / canvas.height);
      const width = canvas.width * scale;
      const height = canvas.height * scale;
      context.drawImage(canvas, (WIDTH - width) / 2, (HEIGHT - height) / 2, width, height);
      const frame = context.getImageData(0, 0, WIDTH, HEIGHT).data;
      this.lastFrame = now;
      this.pending = invoke<void>('plugin:virtual-camera|submit', frame.buffer)
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
    this.stopping = true;
    clearInterval(this.poll);
    if (isTauri()) {
      void this.control
        .then(() => this.pending)
        .then(() => invoke('plugin:virtual-camera|stop'))
        .catch(() => {});
    }
    this.composite = undefined;
    this.context = undefined;
  }
}
