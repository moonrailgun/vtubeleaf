import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockIPC, clearMocks } from '@tauri-apps/api/mocks';
import { AppUpdater } from '../src/updater.ts';

test('updates deduplicate checks, retain retryable downloads, and require successful preparation before install', async () => {
  Object.assign(globalThis, { window: { crypto: globalThis.crypto } });
  const calls: string[] = [];
  let failDownload = true;
  let failInstall = true;
  let saved = false;
  let found = true;
  mockIPC(async (cmd) => {
    calls.push(cmd);
    if (cmd === 'plugin:updater|check')
      return found
        ? { rid: 1, currentVersion: '0.1.14', version: '0.1.15', body: '修复问题' }
        : null;
    if (cmd === 'plugin:updater|download' && failDownload) throw new Error('signature mismatch');
    if (cmd === 'plugin:updater|install' && failInstall) throw new Error('permission denied');
  });
  try {
    const updater = new AppUpdater(
      () => {},
      async () => {
        if (!saved) throw new Error('设置保存失败');
      },
    );
    await Promise.all([updater.check(), updater.check()]);
    assert.equal(calls.filter((c) => c === 'plugin:updater|check').length, 1);
    assert.equal(updater.state.status, 'available');
    await updater.install();
    assert.ok(!calls.includes('plugin:updater|install'));
    await updater.download();
    assert.equal(updater.state.status, 'available');
    assert.match(updater.state.error, /signature mismatch/);
    failDownload = false;
    await updater.download();
    assert.equal(updater.state.status, 'ready');
    await updater.check();
    assert.equal(updater.state.status, 'ready');
    await updater.install();
    assert.equal(updater.state.status, 'ready');
    assert.match(updater.state.error, /设置保存失败/);
    assert.ok(!calls.includes('plugin:updater|install'));
    saved = true;
    await updater.install();
    assert.equal(updater.state.status, 'ready');
    assert.match(updater.state.error, /permission denied/);
    assert.ok(!calls.includes('restart_app'));
    failInstall = false;
    await updater.install();
    assert.deepEqual(calls.slice(-2), ['plugin:updater|install', 'restart_app']);
    updater.dispose();

    const ignored = new AppUpdater(
      () => {},
      async () => {},
    );
    await ignored.check('0.1.15');
    assert.equal(ignored.state.status, 'idle');
    await ignored.check();
    assert.equal(ignored.state.status, 'available');
    found = false;
    await ignored.check();
    assert.equal(ignored.state.status, 'current');
    ignored.dispose();
  } finally {
    clearMocks();
    delete (globalThis as any).window;
  }
});

test('download progress reaches the UI at most every 250 ms and ends with the exact size', async () => {
  Object.assign(globalThis, { window: { crypto: globalThis.crypto } });
  mock.timers.enable({ apis: ['setTimeout'] });
  const chunk = 16 * 1024;
  mockIPC(async (cmd, args: any) => {
    if (cmd === 'plugin:updater|check')
      return { rid: 1, currentVersion: '0.1.14', version: '0.1.15', body: '' };
    if (cmd === 'plugin:updater|download') {
      let index = 0;
      const send = (message: unknown) =>
        (globalThis as any).window.__TAURI_INTERNALS__.runCallback(args.onEvent.id, {
          index: index++,
          message,
        });
      send({ event: 'Started', data: { contentLength: 3050 * chunk } });
      for (let i = 0; i < 3050; i++) {
        send({ event: 'Progress', data: { chunkLength: chunk } });
        if (i % 100 === 99) mock.timers.tick(25);
      }
      send({ event: 'Finished' });
      return 2;
    }
  });
  try {
    const shown: number[] = [];
    const updater = new AppUpdater(
      () => shown.push(updater.state.received),
      async () => {},
    );
    await updater.check();
    shown.length = 0;
    await updater.download();
    assert.equal(updater.state.status, 'ready');
    // Downloading, Started, one update per elapsed 250 ms, then the exact total when ready.
    assert.deepEqual(
      shown,
      [0, 0, 1000, 2000, 3000, 3050].map((count) => count * chunk),
    );
    mock.timers.tick(1000);
    assert.equal(shown.length, 6);
    updater.dispose();
  } finally {
    mock.timers.reset();
    clearMocks();
    delete (globalThis as any).window;
  }
});
