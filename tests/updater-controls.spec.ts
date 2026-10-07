import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

test('About controls the main-owned download and installation waits for settings and camera shutdown', async ({
  page,
  context,
}, testInfo) => {
  await context.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true;
      const label = location.search.includes('about') ? 'about' : 'main';
      mockWindows(label);
      const listeners = new Map();
      const channel = new BroadcastChannel('updater-test');
      const dispatch = args => {
        if (args.target?.label && args.target.label !== label) return;
        for (const id of listeners.get(args.event) || [])
          window.__TAURI_INTERNALS__.runCallback(id, { ...args, id });
      };
      channel.onmessage = event => dispatch(event.data);
      const state = window.updaterTest = { calls: [], failSave: false, failStop: false, settings: null };
      mockIPC(async (cmd, args) => {
        state.calls.push(cmd);
        if (cmd === 'plugin:event|listen') {
          if (!listeners.has(args.event)) listeners.set(args.event, new Set());
          listeners.get(args.event).add(args.handler);
          return args.handler;
        }
        if (cmd === 'plugin:event|unlisten') return listeners.get(args.event)?.delete(args.eventId);
        if (cmd === 'plugin:event|emit_to' || cmd === 'plugin:event|emit') {
          dispatch(args); channel.postMessage(args); return;
        }
        if (cmd === 'list_models') return { models: [], directory: '/test/models', errors: [] };
        if (cmd === 'open_about') { window.open('/?about=1'); return; }
        if (cmd === 'plugin:window|get_all_windows') return [];
        if (cmd === 'save_settings') {
          if (state.failSave) throw new Error('disk full');
          state.settings = args.settings; return;
        }
        if (cmd.startsWith('plugin:virtual-camera|')) {
          if (cmd.endsWith('|stop') && state.failStop) throw new Error('camera busy');
          return { supported: false, installed: false, active: false, message: 'test' };
        }
        if (cmd === 'plugin:updater|check') return { rid: 1, currentVersion: '0.1.14', version: '0.2.0', body: '修复跟踪问题' };
        if (cmd === 'plugin:updater|download') {
          const id = args.onEvent.id;
          window.__TAURI_INTERNALS__.runCallback(id, { index: 0, message: { event: 'Started', data: { contentLength: 1024 } } });
          window.__TAURI_INTERNALS__.runCallback(id, { index: 1, message: { event: 'Progress', data: { chunkLength: 512 } } });
          await new Promise(resolve => { state.finishDownload = resolve; });
          return 2;
        }
      });\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/');
  const openAbout = async () => {
    const popup = context.waitForEvent('page');
    await page.getByRole('button', { name: '关于与检查更新', exact: true }).click();
    const about = await popup;
    await about.setViewportSize({ width: 640, height: 700 });
    await expect(about.getByRole('button', { name: '检查更新', exact: true })).toBeEnabled();
    return about;
  };
  let about = await openAbout();
  await about.getByRole('switch', { name: '自动检查更新' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).updaterTest.settings?.autoCheckUpdates))
    .toBe(false);
  await about.getByRole('button', { name: '检查更新', exact: true }).click();
  await expect(about.getByText('发现新版本 v0.2.0')).toBeVisible();
  await about.getByRole('button', { name: '忽略此版本' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).updaterTest.settings?.skippedUpdateVersion))
    .toBe('0.2.0');
  await about.getByRole('button', { name: '检查更新', exact: true }).click();
  await about.getByRole('button', { name: '下载更新', exact: true }).click();
  await expect(about.getByRole('progressbar', { name: '更新下载进度' })).toHaveAttribute(
    'value',
    '512',
  );
  await about.close();
  await page.evaluate(() => (window as any).updaterTest.finishDownload());
  await expect(page.getByRole('button', { name: '关于与检查更新', exact: true })).toHaveText(
    '更新已就绪',
  );
  const popup = context.waitForEvent('page');
  await page.getByRole('button', { name: '关于与检查更新', exact: true }).click();
  about = await popup;
  await about.setViewportSize({ width: 640, height: 700 });
  const install = about.getByRole('button', { name: '安装并重启', exact: true });
  await expect(install).toBeEnabled();
  await expect(about.getByRole('switch', { name: '自动检查更新' })).not.toBeChecked();
  await about.screenshot({ path: testInfo.outputPath('update-ready.png') });
  await page.evaluate(() => {
    (window as any).updaterTest.failSave = true;
  });
  await install.click();
  await expect(about.getByRole('alert')).toContainText('设置保存失败');
  const calls = () => page.evaluate(() => (window as any).updaterTest.calls as string[]);
  expect(await calls()).not.toContain('plugin:updater|install');
  await page.evaluate(() =>
    Object.assign((window as any).updaterTest, { failSave: false, failStop: true }),
  );
  await install.click();
  await expect(about.getByRole('alert')).toContainText('camera busy');
  expect(await calls()).not.toContain('plugin:updater|install');
  await page.evaluate(() =>
    Object.assign((window as any).updaterTest, { failStop: false, calls: [] }),
  );
  await install.click();
  await expect.poll(calls).toContain('restart_app');
  expect(
    (await calls()).filter((cmd) =>
      [
        'save_settings',
        'plugin:virtual-camera|stop',
        'plugin:updater|install',
        'restart_app',
      ].includes(cmd),
    ),
  ).toEqual([
    'save_settings',
    'plugin:virtual-camera|stop',
    'plugin:updater|install',
    'restart_app',
  ]);
});

test('after an update the main window lists what changed since the last launch once', async ({
  page,
  context,
}, testInfo) => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  await context.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true;
      mockWindows('main');
      mockIPC((cmd, args) => {
        if (cmd === 'load_settings')
          return JSON.parse(localStorage.getItem('whats-new-settings') ?? '{"lastSeenVersion":"1.0.0"}');
        if (cmd === 'save_settings')
          return localStorage.setItem('whats-new-settings', JSON.stringify(args.settings));
        if (cmd === 'list_models') return { models: [], directory: '', errors: [] };
        if (cmd === 'plugin:virtual-camera|status')
          return { supported: false, installed: false, active: false, message: '' };
      }, { shouldMockEvents: true });\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: `已更新到 v${version}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /^v1\.0\.3/ })).toBeVisible();
  await expect(dialog.getByText('虚拟摄像头新增「镜像输出」开关', { exact: false })).toBeVisible();
  await expect(dialog.getByRole('heading', { name: /^v1\.0\.0/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('whats-new.png') });
  await dialog.getByRole('button', { name: '知道了' }).click();
  await expect(dialog).toBeHidden();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('whats-new-settings') ?? 'null')?.lastSeenVersion,
      ),
    )
    .toBe(version);
  await page.reload();
  await expect(page.getByRole('button', { name: '关于与检查更新', exact: true })).toBeVisible();
  await expect(page.locator('#stage canvas')).toBeVisible();
  await expect(dialog).toHaveCount(0);
});
