import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import { VirtualCamera } from '../src/virtual-camera.ts';
import { setLang } from '../src/i18n.ts';

setLang('zh');

test('browser construction remains unsupported without native API', async () => {
  const camera = new VirtualCamera(() => {});
  await camera.start();
  assert.equal(camera.status.supported, false);
  camera.destroy();
});

test('idle camera skips pixel readback and resumes when a source client connects', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originals = ['window', 'isTauri'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const state = {
    supported: true,
    installed: true,
    active: true,
    consumers: false,
    message: 'test',
  };
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
  const source = {
    cameraPixels() {
      reads++;
      return new Uint8Array(1280 * 720 * 4);
    },
  };
  await camera.refresh();
  camera.submit(source, '#000000');
  assert.deepEqual([reads, submissions], [0, 0]);
  assert.equal(camera.status.active, true, 'idle output remains enabled');
  state.consumers = true;
  t.mock.timers.tick(500);
  await nextTurn();
  assert.equal(camera.status.consumers, true, 'polling resumes demand without rendered frames');
  camera.submit(source, '#000000');
  assert.deepEqual([reads, submissions], [1, 1]);
  state.consumers = false;
  await camera.refresh();
  await delay(40);
  camera.submit(source, '#000000');
  assert.deepEqual([reads, submissions], [1, 1]);
});

test('status polls notify only when the status changes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const originals = ['window', 'isTauri'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const state: Record<string, unknown> = {
    supported: true,
    installed: true,
    active: true,
    consumers: false,
    message: 'test',
  };
  let fail = false;
  Object.defineProperty(globalThis, 'isTauri', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: () => (fail ? Promise.reject(new Error('gone')) : Promise.resolve({ ...state })),
      },
    },
  });
  const seen: unknown[] = [];
  const camera = new VirtualCamera((status) => seen.push({ ...status }));
  t.after(async () => {
    camera.destroy();
    t.mock.timers.reset();
    await nextTurn();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  await camera.refresh();
  assert.equal(seen.length, 2, 'initial placeholder, then the first real status');
  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(2000);
    await nextTurn();
    await camera.refresh();
  }
  assert.equal(seen.length, 2, 'repeated identical polls do not notify');
  for (const [key, value] of [
    ['consumers', true],
    ['consumers', undefined],
    ['message', 'changed'],
    ['installed', false],
    ['active', false],
    ['supported', false],
  ] as const) {
    // The native side omits `consumers` when it cannot tell.
    if (value === undefined) delete state[key];
    else state[key] = value;
    await camera.refresh();
    await camera.refresh();
  }
  assert.equal(seen.length, 8, 'each changed field notifies exactly once');
  assert.deepEqual(seen.at(-1), {
    supported: false,
    installed: false,
    active: false,
    message: 'changed',
  });
  fail = true;
  await camera.refresh();
  await camera.refresh();
  assert.equal(seen.length, 9, 'a failure still notifies once');
  assert.match(camera.status.message, /gone/);
});

test('submits the source frame without copying and skips frames the source cannot render', async () => {
  const originals = ['window', 'isTauri'].map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  const state = { supported: true, installed: true, active: true, message: 'test' };
  const submitted: unknown[] = [];
  const stops: string[] = [];
  Object.defineProperty(globalThis, 'isTauri', { configurable: true, value: true });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke(command: string, data: unknown) {
          if (command.endsWith('|submit')) {
            submitted.push(data);
            return Promise.resolve();
          }
          if (command.endsWith('|stop')) {
            stops.push(command);
            state.active = false;
          }
          return Promise.resolve({ ...state });
        },
      },
    },
  });
  const camera = new VirtualCamera(() => {});
  try {
    await camera.refresh();
    const frame = new Uint8Array(1280 * 720 * 4);
    const requests: unknown[][] = [];
    let available = false;
    const source = {
      cameraPixels(...args: unknown[]) {
        requests.push(args);
        return available ? frame : undefined;
      },
    };
    // A lost context or a zero-size stage has no frame: keep the output running and retry.
    camera.submit(source, '#123456', true);
    assert.deepEqual(submitted, []);
    assert.equal(camera.status.active, true);
    available = true;
    camera.submit(source, '#123456', true);
    assert.deepEqual(requests, [
      [1280, 720, '#123456', true],
      [1280, 720, '#123456', true],
    ]);
    assert.equal(submitted[0], frame, 'the reused buffer is handed to the IPC body as is');
    await new Promise((resolve) => setTimeout(resolve, 40));
    // A source that throws still fails and stops the output.
    camera.submit(
      {
        cameraPixels() {
          throw new Error('render failed');
        },
      },
      '#123456',
    );
    await camera.refresh();
    assert.equal(camera.status.active, false);
    assert.equal(stops.length, 1);
  } finally {
    camera.destroy();
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('serializes status and controls and waits for transport before stopping', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalTauri = Object.getOwnPropertyDescriptor(globalThis, 'isTauri');
  const calls: string[] = [];
  const draws: unknown[][] = [];
  let finish: (() => void) | undefined;
  let finishStatus: (() => void) | undefined;
  let delayStatus = false;
  let invalidStatus = false;
  let failStop = false;
  const state = { supported: true, installed: true, active: false, message: 'test' };
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
            assert.ok(data instanceof Uint8Array);
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
    const frame = new Uint8Array(1280 * 720 * 4);
    const stage = {
      cameraPixels(...args: unknown[]) {
        draws.push(args);
        return frame;
      },
    };
    camera.submit(stage, '#123456');
    camera.submit(stage, '#123456');
    assert.equal(calls.filter((x) => x.endsWith('|submit')).length, 1);
    assert.deepEqual(draws, [[1280, 720, '#123456', false]], 'one frame while one is in flight');
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
    if (originalTauri) Object.defineProperty(globalThis, 'isTauri', originalTauri);
    else Reflect.deleteProperty(globalThis, 'isTauri');
  }
});
