import assert from 'node:assert/strict';
import { test } from 'node:test';
import { VirtualCamera } from '../src/virtual-camera.ts';

test('browser construction remains unsupported without native API', async () => {
  const camera = new VirtualCamera(() => {});
  await camera.start();
  assert.equal(camera.status.supported, false);
  camera.destroy();
});

test('letterboxes stage only, sends one binary frame, and waits for transport before stopping', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const originalTauri = Object.getOwnPropertyDescriptor(globalThis, 'isTauri');
  const calls: string[] = [];
  const draws: unknown[][] = [];
  let finish: (() => void) | undefined;
  let invalidStatus = false;
  const state = { supported: true, installed: true, active: false, message: 'test' };
  const context = {
    fillStyle: '',
    fillRect() {},
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
          if (invalidStatus && command.endsWith('|status')) return Promise.resolve(null);
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
    await camera.start();
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
