import test from 'node:test';
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
