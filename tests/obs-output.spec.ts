import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('transparent output preserves prop alpha, excludes backgrounds, and clears old pixels', async ({
  page,
}) => {
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const { AvatarStage } = await import('/src/renderer.ts');
    const { defaults } = await import('/src/state.ts');
    const { mockIPC } = await import('/node_modules/@tauri-apps/api/mocks.js');
    const asset = document.createElement('canvas');
    asset.width = 640;
    asset.height = 360;
    const ctx = asset.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 640, 360);
    const background = await new Promise<Blob>((resolve) => asset.toBlob((blob) => resolve(blob!)));
    ctx.clearRect(0, 0, 640, 360);
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 320, 180);
    ctx.fillStyle = 'rgba(0,255,0,0.5)';
    ctx.fillRect(0, 180, 320, 180);
    const prop = await new Promise<Blob>((resolve) => asset.toBlob((blob) => resolve(blob!)));
    mockIPC((_cmd: string, args: { id: string }) =>
      (args.id === 'background.png' ? background : prop).arrayBuffer(),
    );
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;inset:0;width:640px;height:360px';
    document.body.append(container);
    const stage = new AvatarStage(container, () => {});
    const settings = structuredClone(defaults);
    settings.background = '#123456';
    settings.composition = {
      backgroundImage: 'background.png',
      items: [
        {
          id: 'prop',
          name: 'prop',
          kind: 'image',
          source: 'prop.png',
          x: 0,
          y: 0,
          scale: 0.5,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          behind: false,
          attach: 'stage',
        },
      ],
    };
    await stage.compose(settings, []);
    stage.draw({}, 16);
    const pixels = (canvas: HTMLCanvasElement) => {
      const copy = document.createElement('canvas');
      copy.width = 1280;
      copy.height = 720;
      const context = copy.getContext('2d')!;
      context.drawImage(canvas, 0, 0, 1280, 720);
      return [
        [10, 10],
        [330, 190],
        [330, 370],
        [970, 190],
      ].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data));
    };
    const previewBefore = pixels(stage.canvas);
    const output = pixels(stage.transparentCanvas());
    const raw = stage.transparentPixels(1920, 1080);
    const native = [
      [15, 15],
      [495, 285],
      [495, 555],
      [1455, 285],
    ].map(([x, y]) => Array.from(raw.slice((y * 1920 + x) * 4, (y * 1920 + x) * 4 + 4)));
    stage.draw({}, 16);
    const previewAfter = pixels(stage.canvas);
    settings.composition.items[0].visible = false;
    stage.draw({}, 16);
    const cleared = pixels(stage.transparentCanvas());
    const cssBackground = container.style.backgroundColor;
    stage.destroy();
    container.remove();
    return { output, native, previewBefore, previewAfter, cleared, cssBackground };
  });
  expect(result.output).toEqual([
    [0, 0, 0, 0],
    [255, 0, 0, 255],
    [0, 255, 0, 128],
    [0, 0, 0, 0],
  ]);
  // Native output is top-down and premultiplied, as Syphon and Spout2 expect.
  expect(result.native).toEqual([
    [0, 0, 0, 0],
    [255, 0, 0, 255],
    [0, 128, 0, 128],
    [0, 0, 0, 0],
  ]);
  expect(result.previewBefore).toEqual(result.previewAfter);
  expect(result.previewAfter[0]).toEqual([255, 255, 255, 255]);
  expect(result.cleared.every((pixel) => pixel[3] === 0)).toBe(true);
  expect(result.cssBackground).toBe('rgb(18, 52, 86)');
});

test('OBS browser source clears stopped and disconnected frames and resumes with alpha', async ({
  page,
}) => {
  await page.goto('/?output=1');
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext('2d')!;
    context.fillStyle = 'rgba(255,0,0,0.5)';
    context.fillRect(100, 100, 100, 100);
    return canvas.toDataURL().split(',')[1];
  });
  let state: 'frame' | 'stopped' | 'disconnected' = 'frame';
  await page.route('http://127.0.0.1:18765/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/')
      return route.fulfill({
        contentType: 'text/html',
        headers: {
          'Content-Security-Policy':
            "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'",
        },
        body: readFileSync('src-tauri/src/obs-source.html'),
      });
    if (path === '/source.js')
      return route.fulfill({
        contentType: 'text/javascript',
        body: readFileSync('src-tauri/src/obs-source.js'),
      });
    if (state === 'disconnected') return route.abort();
    return route.fulfill(
      state === 'stopped'
        ? { status: 204, body: '' }
        : { contentType: 'image/png', body: Buffer.from(data, 'base64') },
    );
  });
  await page.goto('http://127.0.0.1:18765/');
  const pixel = () =>
    page
      .locator('canvas')
      .evaluate((canvas: HTMLCanvasElement) =>
        Array.from(canvas.getContext('2d')!.getImageData(150, 150, 1, 1).data),
      );
  await expect.poll(pixel).toEqual([255, 0, 0, 128]);
  state = 'stopped';
  await expect.poll(pixel).toEqual([0, 0, 0, 0]);
  state = 'frame';
  await expect.poll(pixel).toEqual([255, 0, 0, 128]);
  state = 'disconnected';
  await expect.poll(pixel).toEqual([0, 0, 0, 0]);
  state = 'frame';
  await expect.poll(pixel).toEqual([255, 0, 0, 128]);
});

test('desktop OBS controls publish PNG frames and stop without late submissions', async ({
  page,
}, testInfo) => {
  // The native mode exists on macOS and Windows only; do not depend on the host running the test.
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel' }),
  );
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body:
        `
      import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main');
      const output = window.obsTest = { active: false, frames: 0, late: 0, header: [], texture: [], wanted: true };
      mockIPC((cmd, args) => {
        if (cmd === 'load_settings') return { autoCheckUpdates: false };
        if (cmd === 'list_models') return { models: [], directory: '/test', errors: [] };
        if (cmd === 'plugin:virtual-camera|status') return { supported: true, installed: false, active: false, message: '' };
        if (cmd.startsWith('texture_')) {
          output.texture.push(cmd === 'texture_submit' ? args.byteLength : cmd);
          return cmd === 'texture_submit' || cmd === 'texture_wanted' ? output.wanted : undefined;
        }
        if (cmd === 'obs_start') { output.active = true; return 'http://127.0.0.1:18765/'; }
        if (cmd === 'obs_stop') { output.active = false; return; }
        if (cmd === 'obs_submit') {
          output.frames++; if (!output.active) output.late++;
          output.header = Array.from(new Uint8Array(args).slice(0, 8));
        }
      }, { shouldMockEvents: true });
    ` + (await response.text()),
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '接入', exact: true }).click();
  await page.getByRole('tab', { name: 'OBS 接入', exact: true }).click();
  // Desktop builds default to sharing raw frames through Syphon (macOS) or Spout2 (Windows).
  const native = page.getByRole('radio', { name: 'Syphon', exact: true });
  await expect(native).toBeChecked();
  await page.getByRole('button', { name: '启动透明输出', exact: true }).click();
  await expect(native).toBeDisabled();
  await expect
    .poll(() => page.evaluate(() => (window as any).obsTest.texture.slice(0, 2)))
    .toEqual(['texture_start', 1920 * 1080 * 4]);
  await expect(page.getByRole('textbox', { name: 'OBS 浏览器源地址' })).toBeHidden();
  await page.locator('#controls').screenshot({ path: testInfo.outputPath('obs-native.png') });
  // Without a receiver the app only polls for one instead of producing frames nobody reads.
  const calls = () => page.evaluate(() => (window as any).obsTest.texture as (string | number)[]);
  await page.evaluate(() => ((window as any).obsTest.wanted = false));
  await expect.poll(async () => (await calls()).at(-1)).toBe('texture_wanted');
  const idle = (await calls()).length;
  await expect.poll(async () => (await calls()).length).toBeGreaterThan(idle);
  expect((await calls()).slice(idle).every((call) => call === 'texture_wanted')).toBe(true);
  await page.evaluate(() => ((window as any).obsTest.wanted = true));
  await expect.poll(async () => (await calls()).at(-1)).toBe(1920 * 1080 * 4);
  await page.getByRole('button', { name: '停止透明输出', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).obsTest.texture.at(-1)))
    .toBe('texture_stop');
  expect(await page.evaluate(() => (window as any).obsTest.frames)).toBe(0);
  await page.getByRole('radio', { name: '浏览器源', exact: true }).click();
  await page.getByRole('button', { name: '启动透明输出', exact: true }).click();
  await page.getByRole('button', { name: '停止透明输出', exact: true }).click();
  // The browser source address belongs to the browser mode only.
  await native.click();
  await expect(page.getByRole('textbox', { name: 'OBS 浏览器源地址' })).toBeHidden();
  await page.getByRole('radio', { name: '浏览器源', exact: true }).click();
  await page.getByRole('button', { name: '启动透明输出', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'OBS 浏览器源地址' })).toHaveValue(
    'http://127.0.0.1:18765/',
  );
  await page.locator('#controls').screenshot({ path: testInfo.outputPath('obs-controls.png') });
  await expect
    .poll(() => page.evaluate(() => (window as any).obsTest.header))
    .toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await page.getByRole('button', { name: '停止透明输出', exact: true }).click();
  await expect(page.getByRole('button', { name: '启动透明输出', exact: true })).toBeEnabled();
  const count = await page.evaluate(() => (window as any).obsTest.frames);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => (window as any).obsTest.frames)).toBe(count);
  expect(await page.evaluate(() => (window as any).obsTest.late)).toBe(0);
  await page.getByRole('button', { name: '启动透明输出', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).obsTest.frames))
    .toBeGreaterThan(count);
});

test('OBS publisher bounds pending frames and ignores failures from a stopped session', async ({
  page,
}) => {
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const { mockIPC } = await import('/node_modules/@tauri-apps/api/mocks.js');
    const { ObsOutput } = await import('/src/obs-output.ts');
    (window as any).isTauri = true;
    const calls: string[] = [];
    const errors: string[] = [];
    let failFrame: (error: Error) => void = () => {};
    mockIPC((cmd: string) => {
      calls.push(cmd);
      if (cmd === 'obs_start') return 'http://127.0.0.1:18765/';
      if (cmd === 'obs_submit') return new Promise((_, reject) => (failFrame = reject));
    });
    const output = new ObsOutput(
      () => {},
      (error) => errors.push(error),
    );
    await output.setEnabled(true);
    let captures = 0;
    const capture = () => {
      captures++;
      const canvas = document.createElement('canvas');
      canvas.toBlob = (callback) => callback(new Blob(['frame']));
      return canvas;
    };
    const source = { transparentCanvas: capture, transparentPixels: () => new Uint8Array() };
    output.submit(source);
    await new Promise((resolve) => setTimeout(resolve, 50));
    output.submit(source);
    const stop = output.setEnabled(false);
    const restart = output.setEnabled(true);
    failFrame(new Error('previous session disconnected'));
    await Promise.all([stop, restart]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const active = output.state.active;
    await output.setEnabled(false);
    return { captures, calls, errors, active };
  });
  expect(result.captures).toBe(1);
  expect(result.active).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.calls).toEqual(['obs_start', 'obs_submit', 'obs_stop', 'obs_start', 'obs_stop']);
});
