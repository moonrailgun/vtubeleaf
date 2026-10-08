import { test, expect } from '@playwright/test';

test('inactive rendering pauses frames and resumes for work or visibility', async ({ page }) => {
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const module = '/src/frame-loop.ts';
    const { startFrameLoop } = await import(module);
    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    let active = true;
    let frames = 0;
    const stop = startFrameLoop(
      () => frames++,
      () => 30,
      () => active,
      true,
      () => active,
    );
    try {
      await wait(400);
      const running = frames;
      active = false;
      await wait(100);
      frames = 0;
      await wait(400);
      const idle = frames;
      active = true;
      await wait(500);
      const working = frames;
      active = false;
      await wait(100);
      frames = 0;
      active = true;
      document.dispatchEvent(new Event('visibilitychange'));
      await wait(100);
      const visible = frames;
      stop();
      frames = 0;
      document.dispatchEvent(new Event('visibilitychange'));
      await wait(300);
      return { running, idle, working, visible, stopped: frames };
    } finally {
      stop();
    }
  });
  expect(result.running).toBeGreaterThanOrEqual(5);
  expect(result.idle).toBe(0);
  expect(result.working).toBeGreaterThanOrEqual(4);
  expect(result.visible).toBeGreaterThanOrEqual(1);
  expect(result.stopped).toBe(0);
});

test('hidden studio pauses while idle and keeps tracking and output windows running', async ({
  page,
}) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      import { Tracker } from '/src/tracker.ts';
      import { AvatarStage } from '/src/renderer.ts';
      import { NEUTRAL } from '/src/state.ts';
      // Exercise the render lifecycle without opening a camera or loading inference models.
      Tracker.prototype.start = async function () {
        window.sendFace = face => this.receive(face);
        return true;
      };
      const draw = AvatarStage.prototype.draw;
      AvatarStage.prototype.draw = function (...args) {
        draw.apply(this, args);
        if (this.passive) window.outputDepth = this.depthScale;
        else {
          window.mainDepth = this.depthScale;
          window.mainFrames = (window.mainFrames || 0) + 1;
        }
      };
      window.isTauri = true; mockWindows('output');
      mockIPC(cmd => {
        if (cmd === 'load_settings') return { neutral: { ...NEUTRAL, positionZ: -4 }, headSmooth: 0, lostMode: 'hold' };
        if (cmd === 'list_models') return { models: [], directory: '/test/models', errors: [] };
      }, { shouldMockEvents: true });
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (cmd, args, options) =>
        invoke(cmd === 'plugin:event|emit_to' ? 'plugin:event|emit' : cmd, args, options);\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/?output=1');
  await page.evaluate(async () => {
    const module = '/src/studio.ts';
    const { createStudio } = await import(module);
    const container = document.createElement('div');
    document.body.append(container);
    const state = ((window as any).frameTest = { view: null });
    state.studio = createStudio(
      container,
      document.createElement('video'),
      (view: unknown) => (state.view = view),
    );
  });
  await expect.poll(() => page.evaluate(() => (window as any).frameTest.view?.ready)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).mainFrames)).toBeGreaterThan(0);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(100);
  const idle = await page.evaluate(() => (window as any).mainFrames);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).mainFrames)).toBe(idle);
  await expect.poll(() => page.workers().length).toBe(0);
  await page.evaluate(async () => {
    const module = '/node_modules/@tauri-apps/api/event.js';
    const { emit } = await import(module);
    await emit('output-ready');
  });
  await expect.poll(() => page.workers().length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).mainFrames)).toBeGreaterThan(idle);
  await expect
    .poll(() => page.evaluate(() => (window as any).frameTest.view.renderStatus))
    .toContain('FPS');
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => (window as any).frameTest.studio.actions.start());
    await expect.poll(() => page.workers().length).toBe(2);
    await page.evaluate(() => {
      (window as any).frameTest.studio.actions.setSetting('headSmooth', 0);
      (window as any).sendFace({ positionZ: -4 });
    });
    await expect.poll(() => page.evaluate(() => (window as any).mainDepth)).toBe(1);
    await page.evaluate(() => (window as any).sendFace({ positionZ: -3.2 }));
    await expect.poll(() => page.evaluate(() => (window as any).mainDepth)).toBe(1.075);
    await expect.poll(() => page.evaluate(() => (window as any).outputDepth)).toBe(1.075);
    await page.evaluate(() => (window as any).frameTest.studio.actions.stop());
    await expect.poll(() => page.workers().length).toBe(1);
    await expect.poll(() => page.evaluate(() => (window as any).outputDepth)).toBeLessThan(1.01);
  }
  await page.evaluate(async () => {
    const module = '/node_modules/@tauri-apps/api/event.js';
    const { emit } = await import(module);
    await emit('output-closed');
  });
  await expect.poll(() => page.workers().length).toBe(0);
  const closed = await page.evaluate(() => (window as any).mainFrames);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as any).mainFrames)).toBe(closed);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => page.evaluate(() => (window as any).mainFrames)).toBeGreaterThan(closed);
  await page.evaluate(() => (window as any).frameTest.studio.destroy());
});

test('frames continue under window timer throttling and stop without queued work', async ({
  page,
}) => {
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const module = '/src/frame-loop.ts';
    const { startFrameLoop } = await import(module);
    const timeout = window.setTimeout.bind(window);
    const wait = (ms: number) => new Promise<void>((resolve) => timeout(resolve, ms));
    // Reproduce WebKit's occluded-page timer floor without changing Worker timers.
    window.setTimeout = ((callback: TimerHandler, delay = 0, ...args: unknown[]) =>
      timeout(callback, Math.max(1000, delay), ...args)) as typeof window.setTimeout;
    let frames = 0;
    let fps = 30;
    const stop = startFrameLoop(
      () => frames++,
      () => fps,
    );
    try {
      await wait(1000);
      const fast = frames;
      frames = 0;
      fps = 10;
      await wait(1000);
      const slow = frames;
      stop();
      frames = 0;
      await wait(200);
      return { fast, slow, afterStop: frames };
    } finally {
      stop();
      window.setTimeout = timeout;
    }
  });
  expect(result.fast).toBeGreaterThanOrEqual(15);
  expect(result.slow).toBeGreaterThanOrEqual(5);
  expect(result.slow).toBeLessThanOrEqual(13);
  expect(result.afterStop).toBe(0);
});

test('a frame can stop its own loop', async ({ page }) => {
  await page.goto('/?output=1');
  const frames = await page.evaluate(async () => {
    const module = '/src/frame-loop.ts';
    const { startFrameLoop } = await import(module);
    let frames = 0;
    const stop = startFrameLoop(
      () => {
        if (++frames === 3) stop();
      },
      () => 60,
    );
    await new Promise((resolve) => setTimeout(resolve, 500));
    stop();
    return frames;
  });
  expect(frames).toBe(3);
});

test('visible frames follow vsync and survive a stalled animation frame', async ({ page }) => {
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const module = '/src/frame-loop.ts';
    const { startFrameLoop } = await import(module);
    const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const animationFrame = window.requestAnimationFrame.bind(window);
    let painting = false;
    let stalled = false;
    window.requestAnimationFrame = (callback) =>
      stalled
        ? 0
        : animationFrame((time) => {
            painting = true;
            try {
              callback(time);
            } finally {
              painting = false;
            }
          });
    let frames = 0;
    let vsynced = 0;
    const stop = startFrameLoop(
      () => {
        frames++;
        if (painting) vsynced++;
      },
      () => 30,
      () => true,
      true,
    );
    try {
      await wait(1000);
      const visible = { frames, vsynced };
      stalled = true;
      await wait(200);
      frames = 0;
      await wait(1000);
      return { visible, stalled: frames };
    } finally {
      stop();
      window.requestAnimationFrame = animationFrame;
    }
  });
  expect(result.visible.frames).toBeGreaterThanOrEqual(20);
  expect(result.visible.frames).toBeLessThanOrEqual(36);
  expect(result.visible.vsynced).toBeGreaterThanOrEqual(result.visible.frames * 0.8);
  // An occluded page stops painting; the timer must then hold the full rate.
  expect(result.stalled).toBeGreaterThanOrEqual(20);
  expect(result.stalled).toBeLessThanOrEqual(36);
});

test('a throwing frame keeps its cadence instead of retrying on every refresh', async ({
  page,
}) => {
  await page.goto('/?output=1');
  const frames = await page.evaluate(async () => {
    const module = '/src/frame-loop.ts';
    const { startFrameLoop } = await import(module);
    let frames = 0;
    const ignore = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener('error', ignore);
    const stop = startFrameLoop(
      () => {
        frames++;
        throw new Error('frame failed');
      },
      () => 30,
      () => true,
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    stop();
    window.removeEventListener('error', ignore);
    return frames;
  });
  expect(frames).toBeGreaterThanOrEqual(20);
  expect(frames).toBeLessThanOrEqual(36);
});
