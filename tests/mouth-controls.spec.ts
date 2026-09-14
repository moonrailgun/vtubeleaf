import { test, expect } from '@playwright/test';

test('mouth smoothing slider and reset keep saved mappings and response consistent after reload', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('vtubeleaf-preview')) return;
    const mapping = {
      inputMin: 0,
      inputMax: 1,
      outputMin: 0,
      outputMax: 1,
      smoothing: 0,
      enabled: true,
    };
    localStorage.setItem(
      'vtubeleaf-preview',
      JSON.stringify({
        modelPath: '/mouth.model3.json',
        mappings: {
          Open: { ...mapping, source: 'mouthOpen' },
          Form: { ...mapping, source: 'mouthSmile' },
          Shift: { ...mapping, source: 'mouthX', enabled: false },
          Eye: { ...mapping, source: 'eyeLeft', smoothing: 0.05 },
        },
      }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: '面捕', exact: true }).click();
  await page.getByText('眼睛、嘴部与丢脸恢复', { exact: true }).click();
  const slider = page.locator('#mouthSmooth').getByRole('slider');
  await slider.focus();
  await slider.press('End');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('vtubeleaf-preview')!));
  await expect.poll(async () => (await saved()).mappings.Open.smoothing).toBe(0.4);
  const settings = await saved();
  expect(settings.mappings.Form.smoothing).toBe(0.4);
  expect(settings.mappings.Shift.smoothing).toBe(0.4);
  expect(settings.mappings.Shift.enabled).toBe(false);
  expect(settings.mappings.Eye.smoothing).toBe(0.05);
  expect(settings.profiles['/mouth.model3.json'].mappings.Open.smoothing).toBe(0.4);
  await page.reload();
  const response = () =>
    page.evaluate(async () => {
      const module = '/src/state.ts';
      const { FaceMapper, readSettings } = await import(module);
      const s = readSettings(JSON.parse(localStorage.getItem('vtubeleaf-preview')!));
      return new FaceMapper().map(
        { mouthOpen: 1, mouthSmile: 1 },
        ['Open', 'Form'].map((id) => ({ id, min: 0, max: 1, default: 0 })),
        s,
        0.1,
      );
    });
  const smoothed = await response();
  expect(smoothed.Open).toBeGreaterThan(0);
  expect(smoothed.Open).toBeLessThan(0.3);
  expect(smoothed.Form).toBeCloseTo(smoothed.Open);
  await page.getByRole('button', { name: '面捕', exact: true }).click();
  await page.getByText('眼睛、嘴部与丢脸恢复', { exact: true }).click();
  await page.locator('#reset-tracking').click();
  await expect(slider).toHaveAttribute('aria-valuenow', '0.06');
  await expect.poll(async () => (await saved()).mouthSmooth).toBe(0.06);
  const reset = await saved();
  expect(reset.mappings.Open.smoothing).toBe(0.06);
  expect(reset.mappings.Form.smoothing).toBe(0.06);
  expect(reset.mappings.Shift.smoothing).toBe(0.06);
  expect(reset.mappings.Shift.enabled).toBe(false);
  expect(reset.mappings.Eye.smoothing).toBe(0.05);
  expect(reset.profiles['/mouth.model3.json'].mappings.Open.smoothing).toBe(0.06);
  await page.reload();
  const restored = await response();
  expect(restored.Open).toBeCloseTo(0.8111, 4);
  expect(restored.Form).toBeCloseTo(restored.Open);
  await page.getByRole('button', { name: '面捕', exact: true }).click();
  await page.getByText('眼睛、嘴部与丢脸恢复', { exact: true }).click();
  await expect(slider).toHaveAttribute('aria-valuenow', '0.06');
  await slider.focus();
  await slider.press('Home');
  await expect.poll(async () => (await saved()).mappings.Open.smoothing).toBe(0);
  expect(await response()).toEqual({ Open: 1, Form: 1 });
});
