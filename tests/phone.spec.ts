import { test, expect, type Page } from '@playwright/test';

const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main');
      window.trackerCalls = [];
      mockIPC((cmd, args) => {
        if (cmd === 'load_settings') return { engine: 'phone', autoCheckUpdates: false };
        if (cmd === 'list_models') return { models: [], directory: '/test/models', errors: [] };
        if (cmd === 'start_phone' || cmd === 'stop_phone') window.trackerCalls.push({ cmd, args });
      }, { shouldMockEvents: true });\n`;

const status = (overrides: Record<string, unknown>) => ({
  state: 'listening',
  device: '',
  engine: '',
  name: 'Studio Mac',
  addresses: ['192.168.1.20'],
  port: 51234,
  qr: '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#fff"/></svg>',
  ...overrides,
});

const emit = (page: Page, event: string, payload: unknown) =>
  page.evaluate(
    async ([event, payload]) => {
      const { emit } = await import('/node_modules/@tauri-apps/api/event.js');
      await emit(event as string, payload);
    },
    [event, payload] as const,
  );

test.beforeEach(async ({ page }) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
});

test('phone companion shows a pairing code, the paired phone, recalibration and disconnect', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: '面捕', exact: true }).click();
  const options = page.locator('#phone-options');
  await expect(options).toContainText('摄像头画面不会离开手机');
  await expect(options).toContainText('点「开始跟踪」后会显示配对二维码。');
  await expect(page.locator('#camera-status')).toHaveText('手机未连接');

  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('正在跟踪');
  expect(await page.evaluate(() => (window as any).trackerCalls.at(-1).cmd)).toBe('start_phone');
  await expect(page.locator('#notice')).toContainText('等待手机连接');

  await emit(page, 'phone-status', status({}));
  await expect(page.locator('#phone-qr')).toHaveAttribute('alt', 'VTubeLeaf 手机伴侣配对二维码');
  await expect(page.locator('#phone-qr')).toHaveAttribute('src', /^data:image\/svg\+xml/);
  await expect(options).toContainText('「Studio Mac」');
  await expect(options).toContainText('192.168.1.20 · 端口 51234');
  await expect(page.locator('#phone-state')).toHaveText('等待手机扫码');
  await expect(page.locator('#camera-status')).toHaveText('等待手机连接');
  await expect(page.locator('#phone-disconnect')).toHaveCount(0);

  await emit(
    page,
    'phone-status',
    status({ state: 'connected', device: 'iPhone', engine: 'arkit', qr: '', rttMs: 12 }),
  );
  await expect(page.locator('#phone-qr')).toHaveCount(0);
  await expect(page.locator('#phone-device')).toHaveText('iPhone');
  await expect(page.locator('#phone-state')).toHaveText('已连接 · 接收中');
  await expect(options).toContainText('ARKit');
  await expect(options).toContainText('12 ms');
  await expect(page.locator('#camera-status')).toHaveText('正在接收 iPhone');
  await expect(page.locator('#notice')).toContainText('iPhone 已连接');

  // Frames keep arriving as from a phone; the face status refreshes once a second.
  await page.evaluate(async () => {
    const { emit } = await import('/node_modules/@tauri-apps/api/event.js');
    const face = {
      yaw: 5,
      pitch: 0,
      roll: 0,
      eyeLeft: 1,
      eyeRight: 1,
      mouthOpen: 0.2,
      mouthSmile: 0,
    };
    (window as any).frameTimer = setInterval(() => void emit('phone-frame', face), 100);
  });
  await expect(page.locator('#face-status')).toHaveText('已识别人脸');
  await page.evaluate(() => clearInterval((window as any).frameTimer));

  await emit(page, 'phone-status', status({ state: 'paused', device: 'iPhone', engine: 'arkit' }));
  await expect(page.locator('#camera-status')).toHaveText('iPhone 已暂停');

  await emit(
    page,
    'phone-status',
    status({ state: 'reconnecting', device: 'iPhone', engine: 'arkit' }),
  );
  await expect(page.locator('#notice')).toContainText('与 iPhone 的连接已中断');
  await expect(page.locator('#phone-qr')).toBeVisible();
  await expect(options).toContainText('正在等待手机重新连接');
  await expect(page.locator('#camera-status')).toHaveText('等待 iPhone 重连');

  // Another phone (or engine) has its own neutral values, so a new calibration is requested.
  await emit(
    page,
    'phone-status',
    status({ state: 'connected', device: 'Pixel', engine: 'mediapipe', qr: '' }),
  );
  await expect(page.locator('#notice')).toContainText('请重新校准中立姿态');
  await expect(options).toContainText('MediaPipe');

  await page.locator('#phone-disconnect').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).trackerCalls.map((c: any) => c.cmd)))
    .toEqual(['start_phone', 'start_phone']);
  await emit(page, 'phone-status', status({}));
  await expect(page.locator('#notice')).toContainText('手机已断开连接');

  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('尚未开始');
  expect(await page.evaluate(() => (window as any).trackerCalls.at(-1).cmd)).toBe('stop_phone');
  await expect(page.locator('#notice')).toContainText('已停止接收手机数据');
  await expect(options).toContainText('点「开始跟踪」后会显示配对二维码。');
});
