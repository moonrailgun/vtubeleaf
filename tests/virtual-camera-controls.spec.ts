import { test, expect } from '@playwright/test';

test('tracking auto-starts camera output only when enabled and tracking starts successfully', async ({
  page,
}, testInfo) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main');
      const camera = window.cameraTest = {
        status: { supported: true, installed: true, active: false, message: '已安装' },
        actions: [], failTracking: false, holdTracking: false, failOutput: false
      };
      mockIPC(async (cmd, args) => {
        if (cmd === 'load_settings') return JSON.parse(localStorage.getItem('camera-test-settings') || '{"engine":"openseeface","autoCheckUpdates":false}');
        if (cmd === 'save_settings') { localStorage.setItem('camera-test-settings', JSON.stringify(args.settings)); return; }
        if (cmd === 'list_models') return { models: [], directory: '/test/models', errors: [] };
        if (cmd === 'start_openseeface') {
          if (camera.failTracking) throw new Error('跟踪启动失败');
          if (camera.holdTracking) await new Promise(resolve => { camera.finishTracking = resolve; });
        }
        if (!cmd.startsWith('plugin:virtual-camera|')) return;
        const action = cmd.split('|')[1];
        if (action !== 'status' && action !== 'submit') camera.actions.push(action);
        if (action === 'start') {
          if (camera.failOutput) throw new Error('输出启动失败');
          camera.status.active = true;
        }
        if (action === 'stop') camera.status.active = false;
        return { ...camera.status };
      }, { shouldMockEvents: true });\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '接入', exact: true }).click();
  const autoStart = page.getByRole('switch', { name: '开始跟踪时自动输出', exact: true });
  const tracking = page.locator('#start');
  const status = page.locator('#tracking-status');
  const actions = () => page.evaluate(() => (window as any).cameraTest.actions);
  await expect(autoStart).not.toBeChecked();
  expect(await actions()).not.toContain('start');
  await page.evaluate(() => ((window as any).cameraTest.actions = []));
  await tracking.click();
  await expect(status).toHaveText('正在跟踪');
  expect(await actions()).toEqual([]);
  await tracking.click();
  await autoStart.check();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('camera-test-settings') || '{}').autoStartVirtualCamera,
      ),
    )
    .toBe(true);
  await page.reload();
  await page.getByRole('button', { name: '接入', exact: true }).click();
  await expect(autoStart).toBeChecked();
  expect(await actions()).not.toContain('start');
  await page.evaluate(() => ((window as any).cameraTest.actions = []));
  await page
    .locator('#controls')
    .screenshot({ path: testInfo.outputPath('camera-auto-start.png') });

  await page.evaluate(() => ((window as any).cameraTest.failTracking = true));
  await tracking.click();
  await expect(page.locator('#notice')).toContainText('OpenSeeFace 启动失败');
  await expect(status).toHaveText('尚未开始');
  expect(await actions()).toEqual([]);

  await page.evaluate(() =>
    Object.assign((window as any).cameraTest, { failTracking: false, holdTracking: true }),
  );
  await tracking.click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).cameraTest.finishTracking))
    .toBe(true);
  await tracking.click();
  await page.evaluate(() => {
    (window as any).cameraTest.holdTracking = false;
    (window as any).cameraTest.finishTracking();
  });
  await expect(page.locator('#notice')).toContainText('已停止接收');
  expect(await actions()).toEqual([]);

  await tracking.click();
  await expect(status).toHaveText('正在跟踪');
  await expect(page.getByRole('button', { name: '停止虚拟摄像头', exact: true })).toBeVisible();
  expect(await actions()).toEqual(['start']);
  await tracking.click();
  await expect(status).toHaveText('尚未开始');
  await tracking.click();
  await expect(status).toHaveText('正在跟踪');
  expect(await actions()).toEqual(['start']);

  await page.getByRole('button', { name: '停止虚拟摄像头', exact: true }).click();
  await tracking.click();
  await page.evaluate(() => ((window as any).cameraTest.failOutput = true));
  await tracking.click();
  await expect(page.getByRole('tabpanel').getByRole('status')).toContainText('输出启动失败');
  await expect(status).toHaveText('正在跟踪');
  expect(await actions()).toEqual(['start', 'stop', 'start']);
});

test('stopping tracking optionally stops output, including an output start still in flight', async ({
  page,
}, testInfo) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main');
      const camera = window.cameraTest = {
        status: { supported: true, installed: true, active: false, message: '已安装' },
        actions: [], holdOutput: false
      };
      mockIPC(async (cmd, args) => {
        if (cmd === 'load_settings') return JSON.parse(localStorage.getItem('camera-test-settings') || '{"engine":"openseeface","autoCheckUpdates":false,"globalHotkeys":{"pause-tracking":"P","stop-tracking":"S"}}');
        if (cmd === 'save_settings') { localStorage.setItem('camera-test-settings', JSON.stringify(args.settings)); return; }
        if (cmd === 'list_models') return { models: [], directory: '/test/models', errors: [] };
        if (!cmd.startsWith('plugin:virtual-camera|')) return;
        const action = cmd.split('|')[1];
        if (action !== 'status' && action !== 'submit') camera.actions.push(action);
        if (action === 'start') {
          if (camera.holdOutput) await new Promise(resolve => { camera.finishOutput = resolve; });
          camera.status.active = true;
        }
        if (action === 'stop') camera.status.active = false;
        return { ...camera.status };
      }, { shouldMockEvents: true });\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '接入', exact: true }).click();
  const autoStop = page.getByRole('switch', { name: '停止跟踪时自动停止输出', exact: true });
  const autoStart = page.getByRole('switch', { name: '开始跟踪时自动输出', exact: true });
  const tracking = page.locator('#start');
  const status = page.locator('#tracking-status');
  const startOutput = page.getByRole('button', { name: '启动虚拟摄像头', exact: true });
  const stopOutput = page.getByRole('button', { name: '停止虚拟摄像头', exact: true });
  const actions = () => page.evaluate(() => (window as any).cameraTest.actions);

  await expect(autoStop).not.toBeChecked();
  expect(await actions()).not.toContain('start');
  await page.evaluate(() => ((window as any).cameraTest.actions = []));
  await startOutput.click();
  await tracking.click();
  await expect(status).toHaveText('正在跟踪');
  await tracking.click();
  await expect(status).toHaveText('尚未开始');
  await expect(stopOutput).toBeVisible();
  expect(await actions()).toEqual(['start']);

  await autoStop.check();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('camera-test-settings') || '{}').autoStopVirtualCamera,
      ),
    )
    .toBe(true);
  await page.reload();
  await page.getByRole('button', { name: '接入', exact: true }).click();
  await expect(autoStop).toBeChecked();
  await expect(autoStart).not.toBeChecked();
  expect(await actions()).not.toContain('start');
  await page.evaluate(() => ((window as any).cameraTest.actions = []));
  await page.locator('#controls').screenshot({ path: testInfo.outputPath('camera-auto-stop.png') });

  await startOutput.click();
  await tracking.click();
  await expect(status).toHaveText('正在跟踪');
  await page.keyboard.press('p');
  await expect(status).toHaveText('已暂停');
  await expect(stopOutput).toBeVisible();
  expect(await actions()).toEqual(['start']);
  await page.keyboard.press('s');
  await expect(status).toHaveText('尚未开始');
  await expect(startOutput).toBeVisible();
  expect(await actions()).toEqual(['start', 'stop']);

  await autoStart.check();
  await page.evaluate(() => ((window as any).cameraTest.holdOutput = true));
  await tracking.click();
  await expect
    .poll(() => page.evaluate(() => !!(window as any).cameraTest.finishOutput))
    .toBe(true);
  await tracking.click();
  await expect(status).toHaveText('尚未开始');
  await page.evaluate(() => (window as any).cameraTest.finishOutput());
  await expect.poll(actions).toEqual(['start', 'stop', 'start', 'stop']);
  await expect(startOutput).toBeVisible();
});

test('camera controls follow installation and output state, and confirm uninstall from the menu', async ({
  page,
}, testInfo) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main');
      const camera = window.cameraTest = {
        status: { supported: true, installed: false, active: false, message: '尚未安装' },
        actions: []
      };
      mockIPC(async cmd => {
        if (cmd === 'list_models') return { models: [], directory: '/test/models', errors: [] };
        if (!cmd.startsWith('plugin:virtual-camera|')) return;
        const action = cmd.split('|')[1];
        if (action !== 'status' && action !== 'submit') camera.actions.push(action);
        if (action === 'install') {
          await new Promise(resolve => { camera.finishInstall = resolve; });
          camera.status.installed = true;
          camera.status.message = '摄像头已安装，可以启动输出';
        }
        if (action === 'start') camera.status.active = true;
        if (action === 'stop') camera.status.active = false;
        if (action === 'uninstall') Object.assign(camera.status, { installed: false, active: false });
        return { ...camera.status };
      }, { shouldMockEvents: true });\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '接入', exact: true }).click();
  const panel = page.getByRole('tabpanel');
  const more = page.getByRole('button', { name: '虚拟摄像头更多操作', exact: true });
  const install = page.getByRole('button', { name: '安装虚拟摄像头', exact: true });
  const start = page.getByRole('button', { name: '启动虚拟摄像头', exact: true });
  const stop = page.getByRole('button', { name: '停止虚拟摄像头', exact: true });
  const autoStart = page.getByRole('switch', { name: '开始跟踪时自动输出', exact: true });
  const autoStop = page.getByRole('switch', { name: '停止跟踪时自动停止输出', exact: true });
  const actions = () => page.evaluate(() => (window as any).cameraTest.actions);

  await expect(panel.getByRole('button')).toHaveCount(2);
  await expect(install).toBeEnabled();
  await expect(more).toBeDisabled();
  await expect(autoStart).toBeDisabled();
  await expect(autoStop).toBeDisabled();
  await page.evaluate(() => ((window as any).cameraTest.actions = []));
  await install.click();
  await expect(panel.getByRole('button', { name: '安装中…', exact: true })).toBeDisabled();
  await expect(autoStart).toBeDisabled();
  await page.evaluate(() => (window as any).cameraTest.finishInstall());
  await expect(start).toBeEnabled();
  await expect(autoStart).toBeEnabled();
  await expect(autoStop).toBeEnabled();
  expect(await actions()).toEqual(['install']);
  await start.click();
  await expect(stop).toBeEnabled();
  await stop.click();
  await expect(start).toBeEnabled();

  await more.click();
  await expect(page.getByRole('menuitem')).toHaveCount(1);
  await page.locator('#controls').screenshot({ path: testInfo.outputPath('camera-controls.png') });
  await page.getByRole('menuitem', { name: '卸载虚拟摄像头', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await confirm.screenshot({ path: testInfo.outputPath('confirm-uninstall.png') });
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(more).toBeFocused();
  expect(await actions()).toEqual(['install', 'start', 'stop']);
  await more.click();
  await page.getByRole('menuitem', { name: '卸载虚拟摄像头', exact: true }).click();
  await confirm.getByRole('button', { name: '确认卸载', exact: true }).click();
  await expect(install).toBeEnabled();
  await expect(more).toBeDisabled();
  expect(await actions()).toEqual(['install', 'start', 'stop', 'uninstall']);
  await expect(autoStart).toBeDisabled();
  await expect(autoStop).toBeDisabled();
  await page
    .locator('#controls')
    .screenshot({ path: testInfo.outputPath('camera-uninstalled.png') });

  await page.evaluate(() => ((window as any).cameraTest.status.supported = false));
  await expect(install).toBeDisabled();
});
