import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { importVtsConfig } from '../src/vts.ts';

const fixture = () =>
  JSON.parse(
    readFileSync(new URL('./fixtures/vts/representative.vtube.json', import.meta.url), 'utf8'),
  );
const model = {
  parameters: [
    { id: 'ParamAngleX', min: -30, max: 30 },
    { id: 'ParamEyeLOpen', min: 0, max: 1 },
  ],
  expressions: [{ id: 'smile', file: 'expressions/smile.exp3.json' }],
  motions: [{ id: 'Idle:0', file: 'motions/idle.motion3.json' }],
};
test('real-layout fixture imports normalized ranges, filenames and VTS key enums without mutation', () => {
  const raw = fixture(),
    before = structuredClone(raw),
    metadata = structuredClone(model);
  raw.Hotkeys[0].Triggers.Trigger2 = 'LeftControl';
  const result = importVtsConfig(raw, model);
  assert.deepEqual(result.profile.mappings?.ParamAngleX, {
    source: 'yaw',
    inputMin: -1,
    inputMax: 1,
    outputMin: -30,
    outputMax: 30,
    smoothing: 0.075,
    enabled: true,
  });
  assert.equal(result.profile.hotkeys?.['expression:smile'], 'Control+Digit1');
  assert.equal(result.profile.idleMotion, 'Idle:0');
  assert.ok(result.warnings.some((w) => w.includes('平滑')));
  assert.ok(result.warnings.some((w) => w.includes('外推')));
  assert.deepEqual(model, metadata);
  before.Hotkeys[0].Triggers.Trigger2 = 'LeftControl';
  assert.deepEqual(raw, before);
  assert.equal('engine' in result.profile, false);
  assert.equal('lipSyncMode' in result.profile, false);
});
test('reversed input endpoints preserve direction; eye units remain 0..1', () => {
  const raw = fixture();
  Object.assign(raw.ParameterSettings[0], {
    InputRangeLower: 30,
    InputRangeUpper: -30,
    OutputRangeLower: -20,
    OutputRangeUpper: 25,
  });
  raw.ParameterSettings.push({
    ...raw.ParameterSettings[0],
    Input: 'EyeOpenLeft',
    OutputLive2D: 'ParamEyeLOpen',
    InputRangeLower: 0,
    InputRangeUpper: 1,
    OutputRangeLower: 1,
    OutputRangeUpper: 0,
  });
  const { profile } = importVtsConfig(raw, model);
  assert.equal(profile.mappings?.ParamAngleX.outputMin, 25);
  assert.equal(profile.mappings?.ParamAngleX.outputMax, -20);
  assert.equal(profile.mappings?.ParamEyeLOpen.inputMax, 1);
  assert.equal(profile.mappings?.ParamEyeLOpen.outputMax, 0);
});
test('unsupported sources, breathing, gesture deactivation and unknown actions warn instead of changing semantics', () => {
  const raw = fixture();
  raw.ParameterSettings[0].Input = 'VoiceVolume';
  raw.ParameterSettings.push({
    ...raw.ParameterSettings[0],
    Input: 'MouthOpen',
    UseBreathing: true,
  });
  raw.Hotkeys = [
    { ...raw.Hotkeys[0], HandGestureSettings: { DeactivateExpWhenGestureNotDetected: true } },
    { ...raw.Hotkeys[0], Action: 'ToggleTracker' },
    { ...raw.Hotkeys[0], Action: 'ToggleItemScene' },
  ];
  const { profile, warnings } = importVtsConfig(raw, model);
  assert.deepEqual(profile.mappings, {});
  assert.deepEqual(profile.hotkeys, {});
  for (const token of ['VoiceVolume', '自动呼吸', '手势停用', 'ToggleTracker', 'ToggleItemScene'])
    assert.ok(
      warnings.some((w) => w.includes(token)),
      token,
    );
  assert.equal(profile.autoBlink, undefined);
});
test('invalid roots, dangerous keys, numbers and excessive structures are rejected', () => {
  for (const raw of [
    null,
    [],
    {},
    { ...fixture(), Version: 2 },
    JSON.parse('{"__proto__":{}}'),
    { ...fixture(), Name: 'x'.repeat(2049) },
    { ...fixture(), Hotkeys: Array(129).fill({}) },
    { ...fixture(), bad: NaN },
  ])
    assert.throws(() => importVtsConfig(raw, model));
  const raw = fixture();
  raw.ParameterSettings[0].OutputLive2D = '__proto__';
  assert.deepEqual(importVtsConfig(raw, model).profile.mappings, {});
  raw.ParameterSettings[0].OutputLive2D = 'ParamAngleX';
  raw.ParameterSettings[0].InputRangeUpper = raw.ParameterSettings[0].InputRangeLower;
  assert.deepEqual(importVtsConfig(raw, model).profile.mappings, {});
});
test('ambiguous or unsafe references and unsupported key enums are skipped', () => {
  const raw = fixture();
  const ambiguous = {
    ...model,
    expressions: [...model.expressions, { id: 'other', file: 'other/smile.exp3.json' }],
  };
  assert.deepEqual(importVtsConfig(raw, ambiguous).profile.hotkeys, {});
  raw.Hotkeys[0].File = '../expressions/smile.exp3.json';
  assert.deepEqual(importVtsConfig(raw, model).profile.hotkeys, {});
  raw.Hotkeys[0].File = 'smile.exp3.json';
  for (const trigger of ['LeftMouseButton', 'constructor', '1', 49]) {
    raw.Hotkeys[0].Triggers.Trigger1 = trigger;
    assert.deepEqual(importVtsConfig(raw, model).profile.hotkeys, {});
  }
});
test('resolved motions and clear expressions import; disabled keyboard actions do not', () => {
  const raw = fixture();
  raw.Hotkeys[0].Action = 'TriggerAnimation';
  raw.Hotkeys[0].File = 'idle.motion3.json';
  raw.Hotkeys.push({
    ...raw.Hotkeys[0],
    Action: 'RemoveAllExpressions',
    Triggers: { Trigger1: 'F2', Trigger2: '', Trigger3: '', ScreenButton: -1 },
  });
  assert.deepEqual(importVtsConfig(raw, model).profile.hotkeys, {
    'motion:Idle:0': 'Digit1',
    'clear-expressions': 'F2',
  });
  raw.HotkeySettings.UseKeyboardHotkeys = false;
  assert.deepEqual(importVtsConfig(raw, model).profile.hotkeys, {});
  raw.PhysicsSettings = { Use: false };
  assert.equal(importVtsConfig(raw, model).profile.physicsStrength, 0);
});
test('malformed flags skip entries and unknown settings remain visible', () => {
  const raw = fixture();
  raw.ParameterSettings[0].UseBreathing = 'false';
  raw.Hotkeys[0].DeactivateAfterKeyUp = 'false';
  raw.UnknownFutureSettings = { Enabled: true };
  const { profile, warnings } = importVtsConfig(raw, model);
  assert.deepEqual(profile.mappings, {});
  assert.deepEqual(profile.hotkeys, {});
  assert.ok(warnings.filter((w) => w.includes('开关字段类型无效')).length === 2);
  assert.ok(warnings.some((w) => w.includes('UnknownFutureSettings')));
});

test('imports scope, expression release/timer and motion playback independently of studio defaults', () => {
  const raw = fixture();
  Object.assign(raw.Hotkeys[0], {
    IsGlobal: false,
    DeactivateAfterKeyUp: true,
    DeactivateAfterSeconds: true,
    DeactivateAfterSecondsAmount: 2.5,
  });
  raw.Hotkeys.push({
    ...raw.Hotkeys[0],
    Action: 'TriggerAnimation',
    File: 'idle.motion3.json',
    IsGlobal: true,
    DeactivateAfterKeyUp: false,
    DeactivateAfterSeconds: false,
    StopsOnLastFrame: true,
    Triggers: { Trigger1: 'F2' },
  });
  const { profile } = importVtsConfig(raw, model);
  assert.deepEqual(profile.hotkeyOptions, {
    'expression:smile': { scope: 'local', release: true, seconds: 2.5 },
    'motion:Idle:0': { scope: 'global', motionMode: 'hold' },
  });
  raw.Hotkeys[0].DeactivateAfterSecondsAmount = -1;
  assert.equal(importVtsConfig(raw, model).profile.hotkeys?.['expression:smile'], undefined);
});
