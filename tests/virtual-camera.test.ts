import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import { VirtualCamera } from '../src/virtual-camera.ts';

test('browser construction remains unsupported without native API', async () => {
  const camera = new VirtualCamera(() => {});
  await camera.start();
  assert.equal(camera.status.supported, false);
  camera.destroy();
});

test('idle camera skips pixel readback and resumes when a source client connects', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originals = ['window', 'document', 'isTauri'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const state = {
    supported: true,
    installed: true,
    active: true,
    consumers: false,
    message: 'test',
  };
  let draws = 0;
  let reads = 0;
  let submissions = 0;
  Object.defineProperty(globalThis, 'isTauri', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke(command: string) {
          if (command.endsWith('|submit')) {
            submissions++;
            return Promise.resolve();
          }
          return Promise.resolve({ ...state });
        },
      },
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement: () => ({
        getContext: () => ({
          setTransform() {},
          fillRect() {},
          drawImage() {
            draws++;
          },
          getImageData() {
            reads++;
            return { data: new Uint8ClampedArray(1280 * 720 * 4) };
          },
        }),
      }),
    },
  });
  const camera = new VirtualCamera(() => {});
  t.after(async () => {
    camera.destroy();
    t.mock.timers.reset();
    await nextTurn();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const canvas = { width: 1280, height: 720 } as HTMLCanvasElement;
  await camera.refresh();
  camera.submit(canvas, '#000000');
  assert.deepEqual([draws, reads, submissions], [0, 0, 0]);
  assert.equal(camera.status.active, true, 'idle output remains enabled');
  state.consumers = true;
  t.mock.timers.tick(500);
  await nextTurn();
  assert.equal(camera.status.consumers, true, 'polling resumes demand without rendered frames');
  camera.submit(canvas, '#000000');
  assert.deepEqual([draws, reads, submissions], [1, 1, 1]);
  state.consumers = false;
  await camera.refresh();
  await delay(40);
  camera.submit(canvas, '#000000');
  assert.deepEqual([draws, reads, submissions], [1, 1, 1]);
});

test('serializes status and controls, letterboxes frames, and waits for transport before stopping', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalTauri = Object.getOwnPropertyDescriptor(globalThis, 'isTauri');
  const calls: string[] = [];
  const draws: unknown[][] = [];
  let finish: (() => void) | undefined;
  let finishStatus: (() => void) | undefined;
  let delayStatus = false;
  let invalidStatus = false;
  let failStop = false;
  const state = { supported: true, installed: true, active: false, message: 'test' };
  const context = {
    fillStyle: '',
    fillRect() {},
    setTransform() {},
    drawImage(...args: unknown[]) {
      draws.push(args);
    },
    getImageData() {
      return { data: new Uint8ClampedArray(1280 * 720 * 4) };
    },
  };
  Object.defineProperty(globalThis, 'isTauri', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke(command: string, data: unknown) {
          calls.push(command);
          if (failStop && command.endsWith('|stop'))
            return Promise.reject(new Error('stop failed'));
          if (invalidStatus && command.endsWith('|status')) return Promise.resolve(null);
          if (delayStatus && command.endsWith('|status')) {
            const snapshot = { ...state };
            return new Promise((resolve) => {
              finishStatus = () => resolve(snapshot);
            });
          }
          if (command.endsWith('|submit')) {
            assert.ok(data instanceof ArrayBuffer);
            assert.equal(data.byteLength, 1280 * 720 * 4);
            return new Promise<void>((resolve) => {
              finish = resolve;
            });
          }
          if (command.endsWith('|start')) state.active = true;
          if (command.endsWith('|stop')) state.active = false;
          return Promise.resolve({ ...state });
        },
      },
    },
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag: string) {
        assert.equal(tag, 'canvas');
        return { getContext: () => context };
      },
    },
  });
  const camera = new VirtualCamera(() => {});
  try {
    invalidStatus = true;
    await camera.refresh();
    assert.equal(camera.status.active, false);
    assert.match(camera.status.message, /摄像头状态/);
    invalidStatus = false;
    delayStatus = true;
    const refresh = camera.refresh();
    // Hold a pre-start snapshot until the start command has had time to run.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const start = camera.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    delayStatus = false;
    finishStatus!();
    await Promise.all([refresh, start]);
    assert.equal(camera.status.active, true, 'a stale refresh must not overwrite a later start');
    const stage = { width: 500, height: 1000 } as HTMLCanvasElement;
    camera.submit(stage, '#123456');
    camera.submit(stage, '#123456');
    assert.equal(calls.filter((x) => x.endsWith('|submit')).length, 1);
    assert.deepEqual(draws[0], [stage, 460, 0, 360, 720]);
    const stop = camera.stop();
    await Promise.resolve();
    assert.equal(calls.filter((x) => x.endsWith('|stop')).length, 0);
    finish!();
    await stop;
    assert.equal(camera.status.active, false);
    camera.submit(stage, '#123456');
    assert.equal(calls.filter((x) => x.endsWith('|submit')).length, 1);
    failStop = true;
    await assert.rejects(camera.stop(true), /stop failed/);
    failStop = false;
    await camera.stop(true);
  } finally {
    camera.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
    else Reflect.deleteProperty(globalThis, 'window');
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
    if (originalTauri) Object.defineProperty(globalThis, 'isTauri', originalTauri);
    else Reflect.deleteProperty(globalThis, 'isTauri');
  }
});
