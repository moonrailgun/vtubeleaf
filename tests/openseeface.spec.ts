import { test, expect } from '@playwright/test';

test('OpenSeeFace receives independently by default and keeps custom Python in advanced settings', async ({
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
    args: { mode: 'external', camera: 0, port: 11573 },
  });
  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('尚未开始');
  expect(await page.evaluate(() => (window as any).trackerCalls.at(-1).cmd)).toBe(
    'stop_openseeface',
  );
  await page.locator('#osf-options summary').click();
  await page.locator('#openseeface-mode').click();
  await page.getByRole('option', { name: '自定义 Python', exact: true }).click();
  await page.locator('#pythonPath').fill('/python');
  await page.locator('#scriptPath').fill('/tracker.py');
  await expect(page.locator('#camera')).toBeEnabled();
  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('正在跟踪');
  expect(await page.evaluate(() => (window as any).trackerCalls.at(-1))).toMatchObject({
    cmd: 'start_openseeface',
    args: { mode: 'custom', pythonPath: '/python', scriptPath: '/tracker.py' },
  });
});
