import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { importVtsConfig, repairVtsMappings } from '../src/vts.ts';
import { FaceMapper, NEUTRAL, readSettings } from '../src/state.ts';

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
    clamp: false,
  });
  assert.equal(result.profile.hotkeys?.['expression:smile'], 'Control+Digit1');
  assert.equal(result.profile.idleMotion, 'Idle:0');
  assert.ok(result.warnings.some((w) => w.includes('平滑')));
  assert.equal(
    result.warnings.some((w) => w.includes('外推行为未保留')),
    false,
  );
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
test('unsupported sources, gesture deactivation and unknown actions warn instead of changing semantics', () => {
  const raw = fixture();
  raw.ParameterSettings[0].Input = 'VoiceVolume';
  raw.Hotkeys = [
    { ...raw.Hotkeys[0], HandGestureSettings: { DeactivateExpWhenGestureNotDetected: true } },
    { ...raw.Hotkeys[0], Action: 'ToggleTracker' },
    { ...raw.Hotkeys[0], Action: 'ToggleItemScene' },
  ];
  const { profile, warnings } = importVtsConfig(raw, model);
  assert.deepEqual(profile.mappings, {});
  assert.deepEqual(profile.hotkeys, {});
  for (const token of ['VoiceVolume', '手势停用', 'ToggleTracker', 'ToggleItemScene'])
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
test('relative prefixes and Windows separators resolve without accepting unsafe paths', () => {
  const raw = fixture();
  const metadata = {
    ...model,
    expressions: [{ id: 'vts:expressions/smile.exp3.json', file: './expressions/smile.exp3.json' }],
    motions: [{ id: 'Idle:0', file: '.\\motions\\idle.motion3.json' }],
  };
  raw.Hotkeys[0].File = '.\\expressions\\smile.exp3.json';
  raw.FileReferences.IdleAnimation = './motions/idle.motion3.json';
  let result = importVtsConfig(raw, metadata);
  assert.equal(result.profile.hotkeys?.['expression:vts:expressions/smile.exp3.json'], 'Digit1');
  assert.equal(result.profile.idleMotion, 'Idle:0');
  for (const file of ['./smile.exp3.json', '././smile.exp3.json', '.\\.\\smile.exp3.json']) {
    raw.Hotkeys[0].File = file;
    assert.equal(
      importVtsConfig(raw, metadata).profile.hotkeys?.[
        'expression:vts:expressions/smile.exp3.json'
      ],
      'Digit1',
    );
  }
  for (const file of [
    '../expressions/smile.exp3.json',
    '.\\..\\expressions\\smile.exp3.json',
    '/expressions/smile.exp3.json',
    '\\\\server\\smile.exp3.json',
    'C:\\expressions\\smile.exp3.json',
    './',
  ]) {
    raw.Hotkeys[0].File = file;
    raw.FileReferences.IdleAnimation = file;
    result = importVtsConfig(raw, metadata);
    assert.deepEqual(result.profile.hotkeys, {}, file);
    assert.equal(result.profile.idleMotion, undefined, file);
  }
  raw.Hotkeys[0].File = 'smile.exp3.json';
  assert.deepEqual(
    importVtsConfig(raw, {
      ...metadata,
      expressions: [{ id: 'unsafe', file: '../smile.exp3.json' }],
    }).profile.hotkeys,
    {},
  );
});
test('missing and ambiguous resources identify the control and source file with recovery guidance', () => {
  const raw = fixture();
  raw.Hotkeys[0].Name = '隐藏牌子';
  raw.Hotkeys[0].File = '牌子.exp3.json';
  for (const expressions of [
    [],
    [
      { id: 'first', file: 'first/牌子.exp3.json' },
      { id: 'second', file: 'second/牌子.exp3.json' },
    ],
  ]) {
    const { warnings } = importVtsConfig(raw, { ...model, expressions, motions: [] });
    assert.ok(
      warnings.some(
        (w) =>
          w.includes('隐藏牌子') && w.includes('牌子.exp3.json') && w.includes('原模型包重新导入'),
      ),
    );
    assert.ok(
      warnings.some(
        (w) =>
          w.includes('待机动画') &&
          w.includes('idle.motion3.json') &&
          w.includes('原模型包重新导入'),
      ),
    );
  }
});
test('keyboard master switch imports without losing bindings; inactive actions stay excluded', () => {
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
  assert.equal(importVtsConfig(raw, model).profile.useKeyboardHotkeys, true);
  raw.HotkeySettings.UseKeyboardHotkeys = false;
  const { profile } = importVtsConfig(raw, model);
  assert.equal(profile.useKeyboardHotkeys, false);
  assert.deepEqual(profile.hotkeys, {
    'motion:Idle:0': 'Digit1',
    'clear-expressions': 'F2',
  });
  raw.Hotkeys[0].IsActive = false;
  assert.deepEqual(importVtsConfig(raw, model).profile.hotkeys, { 'clear-expressions': 'F2' });
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

test('imports application shortcuts, expression release/timer and motion playback independently of studio defaults', () => {
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
    'expression:smile': { scope: 'local', release: true, seconds: 2.5, fadeSeconds: 0.5 },
    'motion:Idle:0': { scope: 'local', motionMode: 'hold', fadeSeconds: 0.5 },
  });
  raw.Hotkeys[0].DeactivateAfterSecondsAmount = -1;
  assert.equal(importVtsConfig(raw, model).profile.hotkeys?.['expression:smile'], undefined);
});

test('author output overshoot is preserved and either range clamp limits extrapolation', () => {
  const raw = fixture();
  Object.assign(raw.ParameterSettings[0], {
    Input: 'EyeOpenLeft',
    OutputLive2D: 'ParamEyeLOpen',
    InputRangeLower: 0,
    InputRangeUpper: 1,
    OutputRangeLower: -0.1,
    OutputRangeUpper: 1.9,
  });
  for (const [ClampInput, ClampOutput] of [
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ]) {
    Object.assign(raw.ParameterSettings[0], { ClampInput, ClampOutput });
    const mapping = importVtsConfig(raw, model).profile.mappings?.ParamEyeLOpen;
    assert.equal(mapping?.outputMin, -0.1);
    assert.equal(mapping?.outputMax, 1.9);
    assert.equal(mapping?.clamp === false, !ClampInput && !ClampOutput);
  }
});

test('mouth opening imports preserve authored gain and direction beyond model endpoints', () => {
  const raw = fixture();
  Object.assign(raw.ParameterSettings[0], {
    Input: 'MouthOpen',
    OutputLive2D: 'Mouth',
    InputRangeLower: 0,
    InputRangeUpper: 1,
    OutputRangeLower: -0.1,
    OutputRangeUpper: 2.1,
  });
  const metadata = { ...model, parameters: [{ id: 'Mouth', min: 0, max: 1 }] };
  const before = structuredClone(raw);
  const result = importVtsConfig(raw, metadata);
  assert.equal(result.profile.mappings.Mouth.outputMin, -0.1);
  assert.equal(result.profile.mappings.Mouth.outputMax, 2.1);
  assert.ok(!result.warnings.some((w) => w.includes('输出端点已限制')));
  assert.deepEqual(raw, before);
  raw.ParameterSettings[0].InputRangeLower = 1;
  raw.ParameterSettings[0].InputRangeUpper = 0;
  const reversed = importVtsConfig(raw, metadata).profile.mappings.Mouth;
  assert.equal(reversed.outputMin, 2.1);
  assert.equal(reversed.outputMax, -0.1);
});

test('VTS smile imports keep neutral and calibrated faces at the model default without activating smile eyes', () => {
  const raw = fixture();
  const parameters = [
    { id: 'ParamMouthForm', min: -1, max: 1, default: 0 },
    { id: 'SmileEye', min: 0, max: 1, default: 0 },
    { id: 'Reversed', min: -1, max: 1, default: 0 },
    { id: 'Asymmetric', min: -1, max: 2, default: 0.5 },
  ];
  raw.ParameterSettings = parameters.map((p) => ({
    ...raw.ParameterSettings[0],
    Input: 'MouthSmile',
    OutputLive2D: p.id,
    InputRangeLower: 0,
    InputRangeUpper: 1,
    OutputRangeLower: p.id === 'Reversed' ? 1 : p.min,
    OutputRangeUpper: p.id === 'Reversed' ? -1 : p.max,
    Smoothing: 0,
  }));
  const before = structuredClone(raw);
  const result = importVtsConfig(raw, { ...model, parameters });
  const settings = readSettings(result.profile);
  const map = (mouthSmile: number) =>
    new FaceMapper().map({ ...NEUTRAL, mouthSmile }, parameters, settings, 0.1);
  assert.deepEqual(map(0), { ParamMouthForm: 0, SmileEye: 0, Reversed: 0, Asymmetric: 0.5 });
  assert.deepEqual(map(0.5), {
    ParamMouthForm: 0.5,
    SmileEye: 0.5,
    Reversed: -0.5,
    Asymmetric: 1.25,
  });
  assert.deepEqual(map(1), { ParamMouthForm: 1, SmileEye: 1, Reversed: -1, Asymmetric: 2 });
  const neutral = map(0);
  settings.neutral = { ...NEUTRAL, mouthSmile: 0.2 };
  assert.deepEqual(map(0.2), neutral);
  assert.equal(map(0.2).ParamMouthForm, 0);
  assert.deepEqual(raw, before);
  assert.ok(result.warnings.some((w) => w.includes('微笑') && w.includes('中立')));
});

test('legacy VTS mouth repair restores skipped and clipped imports without overwriting tuning', () => {
  const raw = fixture();
  Object.assign(raw.ParameterSettings[0], {
    Input: 'MouthOpen',
    OutputLive2D: 'Mouth',
    InputRangeLower: 0,
    InputRangeUpper: 0.85,
    OutputRangeLower: 0,
    OutputRangeUpper: 2.1,
    Smoothing: 0,
  });
  const result = importVtsConfig(raw, { ...model, parameters: [{ id: 'Mouth', min: 0, max: 1 }] });
  const skipped = 'Mouth：范围超出当前模型或映射限制，已跳过';
  const settings = readSettings({
    vtsImportReport: [
      skipped,
      '追踪范围按当前输入源归一化，嘴部开合输出端点限制到模型范围，其余保留作者输出范围及外推设置',
    ],
  });
  assert.equal(repairVtsMappings(settings.mappings, result, settings.vtsImportReport), true);
  assert.equal(settings.mappings.Mouth.outputMax, 2.1);
  assert.deepEqual(settings.vtsImportReport, [
    '追踪范围按当前输入源归一化，保留作者输出范围及外推设置',
  ]);
  delete settings.mappings.Mouth;
  assert.equal(repairVtsMappings(settings.mappings, result, settings.vtsImportReport), false);
  assert.equal(
    settings.mappings.Mouth,
    undefined,
    'do not resurrect a mapping deleted after migration',
  );
  const clipped = {
    ...result.profile.mappings.Mouth,
    outputMax: 1,
    smoothing: 0.2,
    enabled: false,
    clamp: false,
  };
  const saved = readSettings({ mappings: { Mouth: clipped } });
  assert.equal(repairVtsMappings(saved.mappings, result), true);
  assert.deepEqual(saved.mappings.Mouth, { ...clipped, outputMax: 2.1 });
  assert.equal(repairVtsMappings(saved.mappings, result), false);
  for (const edit of [{ inputMax: 0.7 }, { outputMax: 0.8 }, { source: 'mouthSmile' }]) {
    const tuned = readSettings({
      mappings: { Mouth: { ...clipped, ...edit } },
      vtsImportReport: [skipped],
    });
    const before = structuredClone(tuned.mappings);
    repairVtsMappings(tuned.mappings, result, tuned.vtsImportReport);
    assert.deepEqual(tuned.mappings, before);
    assert.ok(!tuned.vtsImportReport.includes(skipped));
  }
});

test('legacy VTS smile repair preserves user tuning and survives saving without repeated conversion', () => {
  const raw = fixture();
  Object.assign(raw.ParameterSettings[0], {
    Input: 'MouthSmile',
    OutputLive2D: 'Mouth',
    InputRangeLower: 0,
    InputRangeUpper: 1,
    OutputRangeLower: -1,
    OutputRangeUpper: 1,
    Smoothing: 0,
  });
  const parameters = [{ id: 'Mouth', min: -1, max: 1, default: 0 }];
  const result = importVtsConfig(raw, { ...model, parameters });
  const legacy = {
    source: 'mouthSmile',
    inputMin: 0,
    inputMax: 1,
    outputMin: -1,
    outputMax: 1,
    smoothing: 0.4,
    enabled: false,
    clamp: false,
  };
  for (const clamp of [undefined, false, true]) {
    const settings = readSettings({ mappings: { Mouth: { ...legacy, clamp } } });
    const before = structuredClone(settings.mappings.Mouth);
    assert.equal(repairVtsMappings(settings.mappings, result), true);
    assert.deepEqual(settings.mappings.Mouth, { ...before, inputMin: -1 });
    const restored = readSettings(JSON.parse(JSON.stringify(settings)));
    assert.equal(repairVtsMappings(restored.mappings, result), false);
    restored.mappings.Mouth.enabled = true;
    assert.equal(new FaceMapper().map(NEUTRAL, parameters, restored, 0.1).Mouth, 0);
  }
  for (const edit of [
    { inputMin: 0.2 },
    { inputMax: 0.8 },
    { outputMin: -0.5 },
    { outputMax: 0.5 },
    { source: 'mouthOpen' },
  ]) {
    const tuned = readSettings({ mappings: { Mouth: { ...legacy, ...edit } } });
    const before = structuredClone(tuned);
    assert.equal(repairVtsMappings(tuned.mappings, result), false);
    assert.deepEqual(tuned, before);
  }
  for (const [lo, hi] of [
    [-1, 1],
    [0.2, 0.8],
  ]) {
    raw.ParameterSettings[0].InputRangeLower = lo;
    raw.ParameterSettings[0].InputRangeUpper = hi;
    const custom = importVtsConfig(raw, { ...model, parameters });
    assert.equal(custom.profile.mappings!.Mouth.inputMin, lo);
    assert.deepEqual(custom.legacyMappings, {});
  }
});

test('gaze, brows, mouth movement and source-limited inputs retain their calibrated ranges', () => {
  const raw = fixture();
  const cases = [
    ['EyeLeftX', 'gazeX', -1, 1, -1, 1],
    ['EyeRightX', 'gazeX', -1, 1, -1, 1],
    ['EyeLeftY', 'gazeY', -1, 1, -1, 1],
    ['EyeRightY', 'gazeY', -1, 1, -1, 1],
    ['Brows', 'brows', 0, 1, 0, 1],
    ['BrowLeftY', 'browLeft', 0, 1, -1, 1],
    ['BrowRightY', 'browRight', 0.25, 0.75, -0.5, 0.5],
    ['MouthX', 'mouthX', -1, 1, -1, 1],
    ['CheekPuff', 'cheekPuff', 0, 1, 0, 1],
    ['TongueOut', 'tongueOut', 0, 1, 0, 1],
  ] as const;
  raw.ParameterSettings = cases.map(([Input, , InputRangeLower, InputRangeUpper], i) => ({
    ...raw.ParameterSettings[0],
    Input,
    InputRangeLower,
    InputRangeUpper,
    OutputLive2D: `P${i}`,
  }));
  const { profile, warnings } = importVtsConfig(raw, {
    ...model,
    parameters: cases.map((_, i) => ({ id: `P${i}`, min: -30, max: 30 })),
  });
  cases.forEach(([, source, , , lo, hi], i) => {
    assert.equal(profile.mappings?.[`P${i}`]?.source, source);
    assert.equal(profile.mappings?.[`P${i}`]?.inputMin, lo);
    assert.equal(profile.mappings?.[`P${i}`]?.inputMax, hi);
  });
  assert.ok(warnings.some((w) => w.includes('视线') && w.includes('合并')));
  assert.ok(warnings.some((w) => w.includes('CheekPuff') && w.includes('NVIDIA')));
  assert.ok(warnings.some((w) => w.includes('TongueOut') && w.includes('手动')));
});

test('automatic breathing ignores the input selector and imports an autonomous source', () => {
  const raw = fixture();
  Object.assign(raw.ParameterSettings[0], {
    Input: '',
    UseBreathing: true,
    InputRangeLower: 0,
    InputRangeUpper: 1,
  });
  assert.equal(importVtsConfig(raw, model).profile.mappings?.ParamAngleX?.source, 'breath');
  raw.ParameterSettings[0].Input = 'UnknownFutureSource';
  assert.equal(importVtsConfig(raw, model).profile.mappings?.ParamAngleX?.source, 'breath');
  for (const [InputRangeLower, InputRangeUpper] of [
    [-30, 30],
    [0, 0],
  ]) {
    Object.assign(raw.ParameterSettings[0], { InputRangeLower, InputRangeUpper });
    const mapping = importVtsConfig(raw, model).profile.mappings?.ParamAngleX;
    assert.equal(mapping?.inputMin, 0);
    assert.equal(mapping?.inputMax, 1);
    assert.equal(mapping?.outputMin, -30);
    assert.equal(mapping?.outputMax, 30);
  }
  delete raw.ParameterSettings[0].InputRangeLower;
  delete raw.ParameterSettings[0].InputRangeUpper;
  assert.equal(importVtsConfig(raw, model).profile.mappings?.ParamAngleX?.source, 'breath');
});

test('custom fade includes instant transitions and rejects invalid durations without dropping shortcuts', () => {
  const raw = fixture();
  for (const fadeSeconds of [0, 0.5, 10]) {
    raw.Hotkeys[0].FadeSecondsAmount = fadeSeconds;
    const { profile, warnings } = importVtsConfig(raw, model);
    assert.equal(profile.hotkeyOptions?.['expression:smile']?.fadeSeconds, fadeSeconds);
    assert.equal(
      warnings.some((w) => w.includes('自定义淡入淡出时间未导入')),
      false,
    );
  }
  for (const value of [-1, 11, '0.5']) {
    raw.Hotkeys[0].FadeSecondsAmount = value;
    const { profile, warnings } = importVtsConfig(raw, model);
    assert.equal(profile.hotkeys?.['expression:smile'], 'Digit1');
    assert.equal(profile.hotkeyOptions?.['expression:smile']?.fadeSeconds, undefined);
    assert.ok(warnings.some((w) => w.includes('淡入淡出') && w.includes('无效')));
  }
});

test('tracking-lost idle resolves independently and missing references explain recovery', () => {
  const raw = fixture();
  raw.FileReferences.IdleAnimationWhenTrackingLost = './motions/lost.motion3.json';
  const metadata = {
    ...model,
    motions: [...model.motions, { id: 'Lost:0', file: 'motions/lost.motion3.json' }],
  };
  const profile = importVtsConfig(raw, metadata).profile;
  assert.equal(profile.idleMotion, 'Idle:0');
  assert.equal(profile.lostIdleMotion, 'Lost:0');
  for (const file of ['missing.motion3.json', '../lost.motion3.json']) {
    raw.FileReferences.IdleAnimationWhenTrackingLost = file;
    const result = importVtsConfig(raw, metadata);
    assert.equal(result.profile.lostIdleMotion, undefined);
    assert.ok(result.warnings.some((w) => w.includes(file) && w.includes('原模型包重新导入')));
  }
});

test('saved expression defaults resolve safe filenames, deduplicate and respect disabled saving', () => {
  const raw = fixture();
  raw.GeneralSettings = { EnableExpressionSaving: true };
  raw.SavedActiveExpressions = [
    'smile.exp3.json',
    './expressions/smile.exp3.json',
    '../smile.exp3.json',
    'missing.exp3.json',
  ];
  const result = importVtsConfig(raw, model);
  assert.deepEqual(result.profile.defaultExpressions, ['smile']);
  assert.ok(
    result.warnings.some((w) => w.includes('missing.exp3.json') && w.includes('原模型包重新导入')),
  );
  raw.GeneralSettings.EnableExpressionSaving = false;
  assert.deepEqual(importVtsConfig(raw, model).profile.defaultExpressions, []);
  raw.GeneralSettings.EnableExpressionSaving = true;
  raw.SavedActiveExpressions = { unexpected: 'smile.exp3.json' };
  assert.equal(importVtsConfig(raw, model).profile.defaultExpressions, undefined);
});
