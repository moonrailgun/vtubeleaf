import { test, expect } from '@playwright/test';

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
  const actions = () => page.evaluate(() => (window as any).cameraTest.actions);

  await expect(panel.getByRole('button')).toHaveCount(2);
  await expect(install).toBeEnabled();
  await expect(more).toBeDisabled();
  await page.evaluate(() => ((window as any).cameraTest.actions = []));
  await install.click();
  await expect(panel.getByRole('button', { name: '安装中…', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).cameraTest.finishInstall());
  await expect(start).toBeEnabled();
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

  await page.evaluate(() => ((window as any).cameraTest.status.supported = false));
  await expect(install).toBeDisabled();
});
