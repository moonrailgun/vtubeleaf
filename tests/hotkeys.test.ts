import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockIPC } from '@tauri-apps/api/mocks';
import { Hotkeys } from '../src/hotkeys.ts';

function environment(t, native = false) {
  const window = Object.assign(new EventTarget(), { crypto: globalThis.crypto });
  const document = { hidden: false, activeElement: null, hasFocus: () => true };
  class Element {
    isContentEditable = false;
    matches() {
      return true;
    }
  }
  for (const [key, value] of Object.entries({
    window,
    document,
    Element,
    navigator: { platform: 'MacIntel' },
    isTauri: native,
  })) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() =>
      before ? Object.defineProperty(globalThis, key, before) : delete globalThis[key],
    );
  }
  return { window, document, Element };
}

test('browser shortcuts normalize conflicts and ignore editing, repeat, inactive pages and destroyed handlers', async (t) => {
  const env = environment(t),
    actions: string[] = [],
    errors: string[] = [];
  const hotkeys = new Hotkeys(
    (action) => actions.push(action),
    (error) => errors.push(error),
  );
  await hotkeys.set({
    first: 'CommandOrControl+Shift+A',
    duplicate: 'meta+shift+KeyA',
    invalid: 'Control+???',
    second: 'Control+B',
  });
  const press = (properties = {}) => {
    const event = new Event('keydown', { cancelable: true });
    Object.assign(
      event,
      { code: 'KeyA', metaKey: true, shiftKey: true, ctrlKey: false, altKey: false, repeat: false },
      properties,
    );
    env.window.dispatchEvent(event);
  };
  press();
  press({ repeat: true });
  env.document.hasFocus = () => false;
  press();
  env.document.hasFocus = () => true;
  env.document.hidden = true;
  press();
  env.document.hidden = false;
  const editable = new Event('keydown');
  Object.assign(editable, { code: 'KeyA', metaKey: true, shiftKey: true });
  Object.defineProperty(editable, 'target', { value: new env.Element() });
  env.window.dispatchEvent(editable);
  press({ code: 'KeyB', ctrlKey: true, metaKey: false, shiftKey: false });
  assert.deepEqual(actions, ['first', 'second']);
  assert.equal(errors.length, 2);
  await hotkeys.destroy();
  press();
  assert.equal(actions.length, 2);
});

test('native updates serialize, isolate failed bindings, suppress repeated Pressed and unregister only owned shortcuts', async (t) => {
  const env = environment(t, true),
    calls: string[] = [],
    actions: string[] = [],
    errors: string[] = [];
  const handlers = new Map();
  let releaseFirst: () => void;
  mockIPC(async (command, payload) => {
    const shortcut = payload.shortcuts[0];
    calls.push(`${command}:${shortcut}`);
    if (command.endsWith('|register')) {
      if (shortcut === 'Control+KeyX') throw new Error('occupied');
      handlers.set(shortcut, payload.handler.onmessage);
      if (shortcut === 'Control+KeyA')
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
    }
  });
  const hotkeys = new Hotkeys(
    (action) => actions.push(action),
    (error) => errors.push(error),
  );
  const first = hotkeys.set({ old: 'Ctrl+A' });
  await new Promise((resolve) => setImmediate(resolve));
  const second = hotkeys.set({ occupied: 'Ctrl+X', new: 'Ctrl+B' });
  assert.equal(calls.length, 1);
  releaseFirst!();
  await Promise.all([first, second]);
  assert.deepEqual(
    calls.map((call) => call.split('|')[1]),
    [
      'register:Control+KeyA',
      'unregister:Control+KeyA',
      'register:Control+KeyX',
      'register:Control+KeyB',
    ],
  );
  const handler = handlers.get('Control+KeyB');
  handler({ state: 'Pressed' });
  handler({ state: 'Pressed' });
  handler({ state: 'Released' });
  env.document.activeElement = new env.Element();
  handler({ state: 'Pressed' });
  handler({ state: 'Released' });
  env.document.hasFocus = () => false;
  handler({ state: 'Pressed' });
  assert.deepEqual(actions, ['new', 'new']);
  assert.equal(errors.length, 1);
  const pending = hotkeys.set({ pending: 'Ctrl+C' });
  await hotkeys.destroy();
  await pending;
  handler({ state: 'Released' });
  handler({ state: 'Pressed' });
  assert.equal(actions.length, 2);
  assert.ok(calls.at(-1)?.endsWith('unregister:Control+KeyB'));
  assert.ok(
    !calls.some(
      (call) =>
        call.includes('unregister_all') ||
        call.includes('unregister:Control+KeyX') ||
        call.includes('KeyC'),
    ),
  );
});
