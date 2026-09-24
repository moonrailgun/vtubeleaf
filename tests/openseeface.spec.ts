import { test, expect } from '@playwright/test';

test('OpenSeeFace starts bundled by default and only waits for an external app when selected', async ({
  page,
}) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main');
      window.trackerCalls = [];
      mockIPC((cmd, args) => {
        if (cmd === 'load_settings') return { engine: 'openseeface', autoCheckUpdates: false };
        if (cmd === 'list_models') return { models: [], directory: '/test/models', errors: [] };
        if (cmd === 'start_openseeface' || cmd === 'stop_openseeface') window.trackerCalls.push({ cmd, args });
      }, { shouldMockEvents: true });\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '面捕', exact: true }).click();
  await expect(page.locator('#pythonPath')).toHaveCount(0);
  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('正在跟踪');
  expect(await page.evaluate(() => (window as any).trackerCalls.at(-1))).toMatchObject({
    cmd: 'start_openseeface',
    args: { mode: 'bundled', camera: 0, port: 11573 },
  });
  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('尚未开始');
  expect(await page.evaluate(() => (window as any).trackerCalls.at(-1).cmd)).toBe(
    'stop_openseeface',
  );
  await page.locator('#osf-options summary').click();
  await page.locator('#openseeface-mode').click();
  await page.getByRole('option', { name: '接收外部程序', exact: true }).click();
  await expect(page.locator('#camera')).toBeDisabled();
  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('正在跟踪');
  expect(await page.evaluate(() => (window as any).trackerCalls.at(-1))).toMatchObject({
    cmd: 'start_openseeface',
    args: { mode: 'external' },
  });
});
