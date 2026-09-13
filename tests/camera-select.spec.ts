import { test, expect, type Page } from '@playwright/test';

async function openCameraSettings(page: Page, deviceId = '', permissionRequired = false) {
  await page.addInitScript(
    ({ selectedDevice, permissionRequired }) => {
      localStorage.setItem(
        'vtubeleaf-preview',
        JSON.stringify({
          deviceId: selectedDevice,
          micDeviceId: 'disconnected-mic',
          modelVisible: true,
          globalHotkeys: { 'toggle-model': 'U' },
        }),
      );
      const devices = [
        { deviceId: 'macbook-camera', label: 'MacBook Pro 相机' },
        { deviceId: 'vtubeleaf-camera', label: 'VTubeLeaf Camera' },
        { deviceId: 'usb-camera', label: 'USB Camera' },
      ];
      let granted = !permissionRequired;
      if (permissionRequired) {
        navigator.mediaDevices.getUserMedia = async () => {
          granted = true;
          localStorage.setItem('camera-probe-requested', 'true');
          return {
            getTracks: () => [{ stop: () => localStorage.setItem('camera-probe-stopped', 'true') }],
          } as unknown as MediaStream;
        };
      }
      navigator.mediaDevices.enumerateDevices = async () =>
        (granted ? devices : [{ deviceId: '', label: '' }]).map((device) => ({
          ...device,
          kind: 'videoinput' as const,
          groupId: device.deviceId,
          toJSON() {
            return this;
          },
        }));
    },
    { selectedDevice: deviceId, permissionRequired },
  );
  await page.goto('/');
  await page.getByRole('button', { name: '面捕', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '摄像头', exact: true })).toBeEnabled();
}

test('camera menu shows physical cameras, disables its output and preserves keyboard selection', async ({
  page,
}, testInfo) => {
  await openCameraSettings(page);
  const camera = page.getByRole('combobox', { name: '摄像头', exact: true });
  await camera.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await expect(page.getByRole('option', { name: 'MacBook Pro 相机', exact: true })).toBeVisible();
  const output = page.getByRole('option', { name: 'VTubeLeaf Camera', exact: false });
  await expect(output).toContainText('仅用于输出（不可跟踪）');
  await expect(output).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath('camera-options.png') });
  await page.getByRole('option', { name: 'MacBook Pro 相机', exact: true }).click();
  await expect(camera).toHaveText('MacBook Pro 相机');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('vtubeleaf-preview')!).deviceId),
    )
    .toBe('macbook-camera');

  await camera.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: 'MacBook Pro 相机', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'USB Camera', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(camera).toHaveText('USB Camera');
  await expect(camera).toBeFocused();
  await camera.press('Enter');
  await expect(page.getByRole('option', { name: 'USB Camera', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.getByRole('option', { name: '自动选择摄像头', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(camera).toHaveText('自动选择摄像头');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('vtubeleaf-preview')!).deviceId),
    )
    .toBe('');
});

test('an unavailable saved camera remains visible but cannot be selected', async ({ page }) => {
  await openCameraSettings(page, 'disconnected-camera');
  const camera = page.getByRole('combobox', { name: '摄像头', exact: true });
  await expect(camera).toHaveText('上次选择的摄像头（当前不可用）');
  await camera.click();
  await expect(page.getByRole('option', { name: '上次选择的摄像头（当前不可用）' })).toBeDisabled();
  await page.getByRole('option', { name: '自动选择摄像头', exact: true }).click();
  await expect(camera).toHaveText('自动选择摄像头');
});

test('typing a camera name does not also trigger a model shortcut', async ({ page }) => {
  await openCameraSettings(page, 'macbook-camera');
  const camera = page.getByRole('combobox', { name: '摄像头', exact: true });
  await camera.press('u');
  await expect(camera).toHaveText('USB Camera');
  await expect(page.locator('#modelVisible')).toHaveAttribute('aria-checked', 'true');

  await camera.click();
  await page.getByRole('option', { name: 'MacBook Pro 相机', exact: true }).click();
  await camera.press('Enter');
  await page.keyboard.press('u');
  await expect(page.getByRole('option', { name: 'USB Camera', exact: true })).toBeFocused();
  await expect(page.locator('#modelVisible')).toHaveAttribute('aria-checked', 'true');
});

test('opening the camera menu reveals devices after permission and releases its probe', async ({
  page,
}) => {
  await openCameraSettings(page, '', true);
  expect(await page.evaluate(() => localStorage.getItem('camera-probe-requested'))).toBeNull();

  await page.getByRole('combobox', { name: '摄像头', exact: true }).click();
  await expect(page.getByRole('option', { name: 'MacBook Pro 相机', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'VTubeLeaf Camera', exact: false })).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('camera-probe-stopped')))
    .toBe('true');
});

test('a saved output camera selection returns to automatic camera selection', async ({ page }) => {
  await openCameraSettings(page, 'vtubeleaf-camera');
  const camera = page.getByRole('combobox', { name: '摄像头', exact: true });
  await expect(camera).toHaveText('自动选择摄像头');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('vtubeleaf-preview')!).deviceId),
    )
    .toBe('');
  await camera.click();
  await expect(page.getByRole('option', { name: 'VTubeLeaf Camera', exact: false })).toBeDisabled();
});

test('custom settings menus preserve numeric values and the default microphone', async ({
  page,
}) => {
  await openCameraSettings(page);
  const renderFps = page.getByRole('combobox', { name: '角色渲染帧率', exact: true });
  await renderFps.click();
  await page.getByRole('option', { name: '60 FPS · 流畅', exact: true }).click();
  await expect(renderFps).toHaveText('60 FPS · 流畅');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('vtubeleaf-preview')!).renderFps),
    )
    .toBe(60);

  await page.getByRole('button', { name: '麦克风口型', exact: true }).click();
  const microphone = page.getByRole('combobox', { name: '麦克风', exact: true });
  await expect(microphone).toHaveText('上次选择的麦克风（当前不可用）');
  await microphone.click();
  await page.getByRole('option', { name: '系统默认麦克风', exact: true }).click();
  await expect(microphone).toHaveText('系统默认麦克风');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('vtubeleaf-preview')!).micDeviceId),
    )
    .toBe('');
});
