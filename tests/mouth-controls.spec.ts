import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('loading an old VTS profile repairs mouth neutral and saves it without reapplying other settings', async ({
  page,
}) => {
  // Haru's mouth default is 1; use its neutral-zero angle parameter to exercise custom smile targets.
  const root = resolve('vendor/models/Haru');
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name).slice(root.length + 1));
  const model = {
    id: 'mouth',
    path: '/mouth/Haru.model3.json',
    name: 'Mouth',
    entry: 'Haru.model3.json',
    files,
  };
  await page.route('**/mouth-fixture/**', (route) => {
    const resource = decodeURIComponent(
      new URL(route.request().url()).pathname.slice('/mouth-fixture/'.length),
    );
    return files.includes(resource)
      ? route.fulfill({ path: resolve(root, resource) })
      : route.abort();
  });
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main');
      const model = ${JSON.stringify(model)};
      mockIPC(async (cmd, args) => {
        if (cmd === 'load_settings') return JSON.parse(localStorage.getItem('mouth-settings'));
        if (cmd === 'save_settings') { localStorage.setItem('mouth-settings', JSON.stringify(args.settings)); return; }
        if (cmd === 'list_models') return { models: [model], directory: '/mouth', errors: [] };
        if (cmd === 'load_model') return model;
        if (cmd === 'read_model_preview') return new ArrayBuffer(0);
        if (cmd === 'read_model_resource') return (await fetch('/mouth-fixture/' + encodeURI(args.resource))).arrayBuffer();
        if (cmd === 'read_model_vts_config') return { Version: 1, Hotkeys: [], ParameterSettings: [{
          Input: 'MouthSmile', OutputLive2D: 'ParamAngleX', InputRangeLower: 0, InputRangeUpper: 1,
          OutputRangeLower: -1, OutputRangeUpper: 1, Smoothing: 0, ClampInput: false, ClampOutput: false
        }], PhysicsSettings: { Use: false } };
      }, { shouldMockEvents: true });\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.addInitScript((modelPath) => {
    if (localStorage.getItem('mouth-settings')) return;
    localStorage.setItem(
      'mouth-settings',
      JSON.stringify({
        modelPath,
        autoCheckUpdates: false,
        physicsStrength: 0.7,
        hotkeys: { 'clear-expressions': 'KeyK' },
        vtsImportReport: ['导入 1 个映射'],
        mappings: {
          ParamAngleX: {
            source: 'mouthSmile',
            inputMin: 0,
            inputMax: 1,
            outputMin: -1,
            outputMax: 1,
            smoothing: 0.2,
            enabled: true,
            clamp: false,
          },
        },
      }),
    );
  }, model.path);
  await page.goto('/');
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('mouth-settings')!));
  await expect.poll(async () => (await saved()).mappings.ParamAngleX.inputMin).toBe(-1);
  const repaired = await saved();
  expect(repaired.mappings.ParamAngleX.smoothing).toBe(0.2);
  expect(repaired.physicsStrength).toBe(0.7);
  expect(repaired.hotkeys).toEqual({ 'clear-expressions': 'KeyK' });
  expect(repaired.profiles[model.path].mappings).toEqual(repaired.mappings);
  await page.reload();
  await expect(page.locator('#model-name')).toHaveText('Mouth');
  expect((await saved()).mappings).toEqual(repaired.mappings);
  const neutral = await page.evaluate(async () => {
    const state = '/src/state.ts';
    const { FaceMapper, readSettings } = await import(state);
    return new FaceMapper().map(
      { mouthSmile: 0 },
      [{ id: 'ParamAngleX', min: -1, max: 1, default: 0 }],
      readSettings(JSON.parse(localStorage.getItem('mouth-settings')!)),
      0.1,
    ).ParamAngleX;
  });
  expect(neutral).toBe(0);
});

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
