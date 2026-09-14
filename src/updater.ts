import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';

export type UpdateState = {
  status:
    | 'idle'
    | 'checking'
    | 'current'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'installing'
    | 'installed';
  version: string;
  notes: string;
  received: number;
  total?: number;
  error: string;
};
export const initialUpdateState: UpdateState = {
  status: 'idle',
  version: '',
  notes: '',
  received: 0,
  error: '',
};

// The main window owns the native resources so closing About never interrupts a download.
export class AppUpdater {
  state: UpdateState = { ...initialUpdateState };
  private update?: Update;
  private disposed = false;
  private onChange: () => void;
  private prepare: () => Promise<void>;

  constructor(onChange: () => void, prepare: () => Promise<void>) {
    this.onChange = onChange;
    this.prepare = prepare;
  }

  private set(patch: Partial<UpdateState>) {
    this.state = { ...this.state, ...patch };
    if (!this.disposed) this.onChange();
  }

  async check(skippedVersion = '', silent = false) {
    if (this.disposed || !['idle', 'current', 'available'].includes(this.state.status)) return;
    const previous = this.state.status;
    this.set({ status: 'checking', error: '' });
    try {
      const next = await check({ timeout: 15000 });
      if (this.disposed) {
        await next?.close();
        return;
      }
      await this.update?.close().catch(() => {});
      this.update = undefined;
      if (next && next.version === skippedVersion) {
        await next.close();
        this.set({ ...initialUpdateState });
      } else {
        this.update = next ?? undefined;
        this.set({
          ...initialUpdateState,
          status: next ? 'available' : 'current',
          version: next?.version ?? '',
          notes: next?.body ?? '',
        });
      }
    } catch (error) {
      this.set({ status: previous, error: silent ? '' : `检查更新失败：${String(error)}` });
    }
  }

  dismiss() {
    if (this.state.status !== 'available') return;
    void this.update?.close().catch(() => {});
    this.update = undefined;
    this.set({ ...initialUpdateState });
  }

  async download() {
    if (this.disposed || this.state.status !== 'available' || !this.update) return;
    const update = this.update;
    this.set({ status: 'downloading', error: '', received: 0, total: undefined });
    try {
      await update.download(
        (event) => {
          if (event.event === 'Started') this.set({ total: event.data.contentLength });
          if (event.event === 'Progress')
            this.set({ received: this.state.received + event.data.chunkLength });
        },
        { timeout: 900000 },
      );
      if (this.disposed) {
        await update.close().catch(() => {});
        return;
      }
      this.set({ status: 'ready' });
    } catch (error) {
      this.set({ status: 'available', error: `下载或签名校验失败，请重试：${String(error)}` });
    }
  }

  async install() {
    if (this.disposed || !['ready', 'installed'].includes(this.state.status) || !this.update)
      return;
    const installed = this.state.status === 'installed';
    this.set({ status: 'installing', error: '' });
    try {
      await this.prepare();
    } catch (error) {
      this.set({ status: installed ? 'installed' : 'ready', error: String(error) });
      return;
    }
    if (this.disposed) return;
    if (!installed) {
      try {
        await this.update.install();
      } catch (error) {
        this.set({ status: 'ready', error: `安装失败，请重试：${String(error)}` });
        return;
      }
    }
    this.set({ status: 'installed' });
    try {
      await invoke('restart_app');
    } catch (error) {
      this.set({ error: `更新已安装，请退出并重新打开应用：${String(error)}` });
    }
  }

  dispose() {
    this.disposed = true;
    void this.update?.close().catch(() => {});
  }
}
