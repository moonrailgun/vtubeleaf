import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockIPC } from '@tauri-apps/api/mocks';
import { Hotkeys } from '../src/hotkeys.ts';
import { importVtsConfig } from '../src/vts.ts';
import { readSettings } from '../src/state.ts';

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
    (action, pressed) => {
      if (pressed) actions.push(action);
    },
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

test('desktop shortcuts stay inside the focused app, including legacy global and imported Space bindings', async (t) => {
  const env = environment(t, true);
  const nativeCalls: string[] = [],
    errors: string[] = [];
  const actions: [string, boolean][] = [];
  mockIPC((command) => {
    nativeCalls.push(command);
  });
  const hotkeys = new Hotkeys(
    (action, pressed) => actions.push([action, pressed]),
    (error) => errors.push(error),
  );
  const saved = readSettings({
    hotkeys: { 'clear-expressions': 'Space' },
    hotkeyOptions: { 'clear-expressions': { scope: 'global' } },
    globalHotkeys: { 'toggle-model': 'Shift+A' },
  });
  await hotkeys.set({ ...saved.globalHotkeys, ...saved.hotkeys });
  const key = (type: string, properties = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { code: 'Space' }, properties);
    env.window.dispatchEvent(event);
    return event;
  };
  assert.equal(key('keydown').defaultPrevented, true);
  key('keydown');
  key('keydown', { repeat: true });
  assert.deepEqual(actions, [['clear-expressions', true]]);
  env.document.hasFocus = () => false;
  env.window.dispatchEvent(new Event('blur'));
  assert.deepEqual(actions.at(-1), ['clear-expressions', false]);
  assert.equal(key('keydown').defaultPrevented, false);
  key('keydown', { code: 'KeyA', shiftKey: true });
  assert.equal(actions.length, 2);
  env.document.hasFocus = () => true;
  env.document.hidden = true;
  assert.equal(key('keydown').defaultPrevented, false);
  env.document.hidden = false;
  assert.equal(key('keydown', { isComposing: true }).defaultPrevented, false);
  const editable = new Event('keydown', { cancelable: true });
  Object.assign(editable, { code: 'Space' });
  Object.defineProperty(editable, 'target', { value: new env.Element() });
  env.window.dispatchEvent(editable);
  assert.equal(editable.defaultPrevented, false);
  assert.equal(actions.length, 2);

  key('keydown', { code: 'KeyA', shiftKey: true });
  key('keyup', { code: 'ShiftLeft', shiftKey: false });
  assert.deepEqual(actions.slice(-2), [
    ['toggle-model', true],
    ['toggle-model', false],
  ]);
  key('keydown');
  const { profile } = importVtsConfig(
    {
      Version: 1,
      ParameterSettings: [],
      Hotkeys: [
        {
          Action: 'RemoveAllExpressions',
          IsActive: true,
          IsGlobal: true,
          Triggers: { Trigger1: 'Space', Trigger2: '', Trigger3: '' },
        },
      ],
    },
    { parameters: [], expressions: [], motions: [] },
  );
  await hotkeys.set(profile.hotkeys!);
  assert.deepEqual(actions.at(-1), ['clear-expressions', false]);
  key('keydown');
  key('keyup');
  assert.deepEqual(actions.slice(-2), [
    ['clear-expressions', true],
    ['clear-expressions', false],
  ]);
  key('keydown');
  await hotkeys.destroy();
  assert.deepEqual(actions.at(-1), ['clear-expressions', false]);
  assert.equal(key('keydown').defaultPrevented, false);
  await hotkeys.set({ destroyed: 'Space' });
  assert.equal(key('keydown').defaultPrevented, false);
  assert.deepEqual(nativeCalls, []);
  assert.deepEqual(errors, []);
});
