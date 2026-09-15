import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

test('saved expressions and held poses survive reopening and can still be changed or restored', async ({
  page,
}, testInfo) => {
  const root = resolve('vendor/models/Haru');
  const json = JSON.parse(readFileSync(resolve(root, 'Haru.model3.json'), 'utf8'));
  delete json.FileReferences.Motions;
  delete json.FileReferences.Expressions;
  const expression = 'expressions/牌子.exp3.json';
  const poses = ['saved', 'other'];
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name).slice(root.length + 1));
  const info = {
    id: 'appearance',
    name: 'Haru',
    path: '/appearance/Haru.model3.json',
    entry: 'Haru.model3.json',
    files: [...files, expression, ...poses.map((id) => `${id}.motion3.json`)],
    vtsResources: {
      expressions: [{ name: '牌子', file: expression }],
      motions: poses.map((id) => ({ name: id, file: `${id}.motion3.json` })),
      warnings: [],
    },
  };
  await page.route('**/appearance-model/**', (route) => {
    const resource = decodeURIComponent(
      new URL(route.request().url()).pathname.slice('/appearance-model/'.length),
    );
    if (resource === info.entry) return route.fulfill({ json });
    if (resource === expression)
      return route.fulfill({
        json: {
          Type: 'Live2D Expression',
          Parameters: [{ Id: 'ParamAngleZ', Value: 10, Blend: 'Add' }],
        },
      });
    if (poses.some((id) => resource === `${id}.motion3.json`)) {
      const value = resource.startsWith('saved') ? 16 : -16;
      return route.fulfill({
        json: {
          Version: 3,
          Meta: {
            Duration: 1.6,
            Fps: 30,
            Loop: false,
            CurveCount: 1,
            TotalSegmentCount: 1,
            TotalPointCount: 2,
          },
          Curves: [
            {
              Target: 'Parameter',
              Id: 'ParamAngleX',
              FadeInTime: 0,
              FadeOutTime: 0,
              Segments: [0, value, 0, 1.6, value],
            },
          ],
        },
      });
    }
    return files.includes(resource)
      ? route.fulfill({ path: resolve(root, resource) })
      : route.abort();
  });
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      import { AvatarStage } from '/src/renderer.ts';
      const load = AvatarStage.prototype.load;
      AvatarStage.prototype.load = async function (...args) {
        const result = await load.apply(this, args);
        if (result && !this.passive) window.appearanceStage = this;
        return result;
      };
      window.isTauri = true;
      mockWindows('main');
      const info = ${JSON.stringify(info)};
      mockIPC(async (cmd, args) => {
        if (cmd === 'load_settings') return JSON.parse(localStorage.getItem('appearance-settings')) ?? {
          modelPath: info.path,
          physicsStrength: 0,
          motionSound: false,
          defaultExpressions: [],
          defaultParameterOverrides: { ParamAngleY: 12 },
          hotkeyOptions: {
            'motion:vts:saved.motion3.json': { scope: 'local', motionMode: 'hold' },
            'motion:vts:other.motion3.json': { scope: 'local', motionMode: 'hold' }
          }
        };
        if (cmd === 'save_settings') {
          if (window.rejectAppearanceSave) throw new Error('disk write failed');
          if (window.delayAppearanceSave)
            await new Promise((resolve) => { window.finishAppearanceSave = resolve; });
          localStorage.setItem('appearance-settings', JSON.stringify(args.settings));
        }
        if (cmd === 'load_model') return info;
        if (cmd === 'list_models') return { models: [], directory: '/models', errors: [] };
        if (cmd === 'read_model_resource')
          return (await fetch('/appearance-model/' + encodeURI(args.resource))).arrayBuffer();
        if (cmd === 'read_model_preview') return new ArrayBuffer(0);
        if (cmd.startsWith('plugin:virtual-camera|'))
          return { supported: false, installed: false, active: false, message: 'Test' };
      }, { shouldMockEvents: true });`;
    await route.fulfill({ response, body: bootstrap + '\n' + (await response.text()) });
  });
  const held = () => page.evaluate(() => (window as any).appearanceStage?.held);
  const frame = () => page.evaluate(() => (window as any).appearanceStage?.frame.ParamAngleX);
  const stored = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('appearance-settings')!));

  await page.goto('/');
  await page.getByRole('button', { name: '角色', exact: true }).click();
  const save = page.locator('#save-default-appearance');
  await expect(save).toBeEnabled();
  const sign = page.getByRole('button', { name: '牌子', exact: true });
  await sign.click();
  await expect(sign).toHaveAttribute('aria-pressed', 'true');
  await save.click();
  await expect(page.locator('#notice')).toContainText('已保存');
  expect((await stored()).defaultExpressions).toEqual([`vts:${expression}`]);
  await page.reload();
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await expect(sign).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).appearanceStage.frame.ParamAngleZ)).toBe(10);
  await page.getByRole('button', { name: 'saved', exact: true }).click();
  await save.click();
  await expect(page.locator('#notice')).toContainText('请等保持动作播放结束');
  await expect.poll(held).toEqual({ ParamAngleX: 16 });
  await page.evaluate(() => ((window as any).delayAppearanceSave = true));
  await save.click();
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).finishAppearanceSave))
    .toBe('function');
  await expect(page.locator('#notice')).not.toContainText('已保存');
  await page.evaluate(() => (window as any).finishAppearanceSave());
  await expect(page.locator('#notice')).toContainText('已保存');
  expect((await stored()).defaultHeldParameters).toEqual({ ParamAngleX: 16 });
  expect((await stored()).defaultParameterOverrides).toEqual({ ParamAngleY: 12 });
  expect((await stored()).defaultExpressions).toEqual([`vts:${expression}`]);

  await page.reload();
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await expect(save).toBeEnabled();
  await expect.poll(frame).toBe(16);
  await expect(sign).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => (window as any).appearanceStage.frame.ParamAngleZ)).toBe(10);
  expect(await page.evaluate(() => (window as any).appearanceStage.frame.ParamAngleY)).toBe(12);
  await save.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('reopened-appearance.png') });
  await page.getByRole('button', { name: 'other', exact: true }).click();
  await expect.poll(held).toEqual({ ParamAngleX: -16 });
  await expect.poll(frame).toBe(-16);
  await page.locator('#restore-default-appearance').click();
  await expect.poll(frame).toBe(16);

  await page.locator('#stop-motion').click();
  await expect.poll(frame).toBe(0);
  await page.evaluate(() => ((window as any).rejectAppearanceSave = true));
  await save.click();
  await expect(page.locator('#notice')).toContainText('设置保存失败');
  await expect(page.locator('#notice')).toHaveClass(/error/);
  expect((await stored()).defaultHeldParameters).toEqual({ ParamAngleX: 16 });
  await page.evaluate(() => ((window as any).rejectAppearanceSave = false));
  await save.click();
  await expect(page.locator('#notice')).toContainText('已保存');
  expect((await stored()).defaultHeldParameters).toEqual({});
  await page.reload();
  await expect.poll(frame).toBe(0);
});
