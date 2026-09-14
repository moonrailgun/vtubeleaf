import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, readSettings, FaceMapper, NEUTRAL, fromMediaPipe } from '../src/state.ts';
import * as state from '../src/state.ts';

test('update preferences default safely and remain global across model changes and reloads', () => {
  assert.equal(readSettings({}).autoCheckUpdates, true);
  assert.equal(
    readSettings({ autoCheckUpdates: 'false', skippedUpdateVersion: 1 }).skippedUpdateVersion,
    '',
  );
  const settings = readSettings({
    autoCheckUpdates: false,
    skippedUpdateVersion: '0.2.0',
    modelPath: '/a',
  });
  const restored = readSettings(JSON.parse(JSON.stringify(state.switchProfile(settings, '/b'))));
  assert.equal(restored.autoCheckUpdates, false);
  assert.equal(restored.skippedUpdateVersion, '0.2.0');
});

test('hand sources mirror positions and sides without subtracting finger calibration', () => {
  const input = {
    handLeftFound: 1,
    handLeftX: 0.4,
    handLeftY: -0.3,
    handLeftAngle: 0.2,
    handLeftOpen: 0.9,
    handLeftIndex: 0.8,
    handRightFound: 0,
  };
  const s = readSettings({ motionMirror: true, neutral: { ...NEUTRAL, handLeftOpen: 0.7 } });
  const mirrored = state.normalizedFace(input, s);
  assert.equal(mirrored.handRightFound, 1);
  assert.equal(mirrored.handLeftFound, 0);
  assert.equal(mirrored.handRightX, -0.4);
  assert.equal(mirrored.handRightY, -0.3);
  assert.equal(mirrored.handRightAngle, -0.2);
  assert.equal(mirrored.handRightOpen, 0.9);
  assert.equal(mirrored.handRightIndex, 0.8);
  assert.equal(mirrored.yaw, undefined);
  assert.equal(state.normalizedFace(input, { ...s, motionMirror: false }).handLeftX, 0.4);
});

test('lost tracking hold keeps a missing source but still accepts the body fallback', () => {
  const mapper = new FaceMapper();
  const s = readSettings({ lostMode: 'hold', motionMirror: false, headSmooth: 0 });
  const params = [{ id: 'ParamBodyAngleX', min: -30, max: 30, default: 0 }];
  mapper.map({ bodyYaw: 30 }, params, s, 0.1);
  const fallback = mapper.map({ yaw: 30 }, params, s, 0.1).ParamBodyAngleX;
  assert.ok(fallback < 30 && fallback > 9);
  assert.equal(mapper.map({ mouthOpen: 0 }, params, s, 0.1).ParamBodyAngleX, fallback);
});

test('calibrated blink reaches closed and open endpoints at every sensitivity within model limits', () => {
  const parameters = [
    { id: 'ParamEyeLOpen', min: -0.5, max: 1.5, default: 1 },
    { id: 'ParamEyeROpen', min: 0, max: 2, default: 1 },
    { id: 'ParamMouthOpenY', min: 0, max: 2, default: 0 },
  ];
  for (const eyeSensitivity of [0.3, 1, 2]) {
    const s = readSettings({
      eyeSensitivity,
      eyeSmooth: 0,
      mouthSmooth: 0,
      eyeClosedThreshold: 0.25,
      neutral: { ...NEUTRAL, eyeLeft: 0.8, eyeRight: 0.8 },
    });
    const blink = fromMediaPipe(
      [
        { categoryName: 'eyeBlinkLeft', score: 0.81 },
        { categoryName: 'eyeBlinkRight', score: 0.2 },
        { categoryName: 'jawOpen', score: 1 },
      ],
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    );
    assert.deepEqual(new FaceMapper().map(blink, parameters, s, 1 / 30), {
      ParamEyeLOpen: 0,
      ParamEyeROpen: 1,
      ParamMouthOpenY: 1,
    });
  }
  const settings = readSettings({ eyeClosedThreshold: 8 });
  assert.equal(settings.eyeClosedThreshold, 0.6);
});

test('camera preview is private by default and only restores an explicit boolean choice', () => {
  assert.equal(defaults.previewCamera, false);
  for (const value of [null, {}, { previewCamera: 'true' }, { previewMode: 'overlay' }])
    assert.equal(readSettings(value).previewCamera, false);
  assert.equal(readSettings({ previewCamera: true }).previewCamera, true);
  assert.equal(readSettings({ previewCamera: false }).previewCamera, false);
});

test('body-only tracking drives standard arms and lets lost face channels return to neutral', () => {
  const parameters = [
    { id: 'ParamAngleX', min: -30, max: 30, default: 0 },
    { id: 'ParamEyeLOpen', min: 0, max: 1, default: 1 },
    { id: 'ParamBodyAngleX', min: -30, max: 30, default: 0 },
    ...['ParamArmLA', 'ParamArmRA', 'ParamArmLB', 'ParamArmRB'].map((id) => ({
      id,
      min: -30,
      max: 30,
      default: 0,
    })),
  ];
  const s = readSettings({ motionMirror: false, headSmooth: 0, eyeSmooth: 0 });
  const mapper = new FaceMapper();
  mapper.map({ ...NEUTRAL, yaw: 30, eyeLeft: 0 }, parameters, s, 1 / 30);
  const body = { bodyYaw: -15, armLeft: 1, armRight: 0, elbowLeft: 0.5, elbowRight: 0 };
  assert.equal(state.isFace(body), false);
  assert.equal(state.normalizedFace(body, s).yaw, undefined);
  const frame = mapper.map(body, parameters, s, 1 / 30);
  assert.equal(frame.ParamBodyAngleX, -15);
  assert.equal(frame.ParamArmLA, 30);
  assert.equal(frame.ParamArmRA, 0);
  assert.equal(frame.ParamArmLB, 15);
  assert.ok(frame.ParamAngleX > 0 && frame.ParamAngleX < 30);
  assert.ok(frame.ParamEyeLOpen > 0 && frame.ParamEyeLOpen < 1);
  assert.equal(new FaceMapper().map(body, parameters, s, 1 / 30).ParamAngleX, undefined);
  assert.equal(
    mapper.map(body, parameters, { ...s, autoBlink: true }, 1 / 30).ParamEyeLOpen,
    undefined,
  );
  const mirrored = new FaceMapper().map(body, parameters, { ...s, motionMirror: true }, 1 / 30);
  assert.equal(mirrored.ParamArmRA, 30);
  assert.equal(mirrored.ParamArmLA, 0);
});

test('upper body requires visible shoulders, uses independent limbs and rejects clipped joints', () => {
  assert.equal(typeof state.fromPose, 'function');
  const image = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  const world = structuredClone(image);
  for (const [id, x, y] of [
    [11, 0.7, 0.3],
    [12, 0.3, 0.3],
    [13, 0.8, 0.3],
    [14, 0.3, 0.5],
    [15, 0.8, 0.1],
    [16, 0.3, 0.7],
    [23, 0.65, 0.7],
    [24, 0.35, 0.7],
  ]) {
    image[id] = { x, y, z: 0, visibility: 0.99 };
    world[id] = { ...image[id] };
  }
  const body = state.fromPose(image, world);
  assert.ok(Math.abs(body.bodyYaw) < 1e-6);
  assert.ok(Math.abs(body.bodyPitch) < 1e-6);
  assert.ok(Math.abs(body.bodyRoll) < 1e-6);
  assert.ok(Math.abs(body.armLeft - 0.5) < 1e-6);
  assert.ok(Math.abs(body.elbowLeft - 0.5) < 1e-6);
  assert.equal(body.armRight, 0);
  assert.equal(body.elbowRight, 0);
  world[11].z = -0.2;
  assert.ok(state.fromPose(image, world).bodyYaw > 20);
  image[23].y = 1.1;
  image[13].visibility = 0.2;
  const partial = state.fromPose(image, world);
  assert.equal(partial.bodyPitch, undefined);
  assert.equal(partial.armLeft, undefined);
  assert.equal(partial.elbowLeft, undefined);
  assert.equal(partial.armRight, 0);
  image[11].y = 1.1;
  assert.deepEqual(state.fromPose(image, world), {});
  assert.deepEqual(state.fromPose([], []), {});
  image[11].y = 0.3;
  world[11].x = NaN;
  assert.deepEqual(state.fromPose(image, world), {});
});

test('body mapping overrides head imitation, calibrates, mirrors and falls back smoothly', () => {
  const s = readSettings({ motionMirror: false, headSmooth: 0 });
  const p = [{ id: 'ParamBodyAngleX', min: -30, max: 30, default: 0 }];
  const mapper = new FaceMapper();
  assert.equal(state.defaultMapping(p[0], s).source, 'bodyYaw');
  assert.equal(
    mapper.map({ ...NEUTRAL, yaw: 30, bodyYaw: -15 }, p, s, 1 / 30).ParamBodyAngleX,
    -15,
  );
  const fallback = mapper.map({ ...NEUTRAL, yaw: 30 }, p, s, 1 / 30).ParamBodyAngleX;
  assert.ok(fallback > -15 && fallback < 9);
  let settled;
  for (let i = 0; i < 90; i++) settled = mapper.map({ ...NEUTRAL, yaw: 30 }, p, s, 1 / 30);
  assert.ok(Math.abs(settled.ParamBodyAngleX - 9) < 0.001);
  const calibrated = state.normalizedFace(
    { ...NEUTRAL, bodyYaw: 25, armLeft: 0.8, armRight: 0.1 },
    readSettings({
      motionMirror: true,
      neutral: { ...NEUTRAL, bodyYaw: 10, armLeft: 0.2, armRight: 0.1 },
    }),
  );
  assert.equal(calibrated.bodyYaw, -0.5);
  assert.ok(Math.abs(calibrated.armRight - 0.6) < 1e-6);
  assert.equal(calibrated.armLeft, 0);
  assert.equal(state.isFace({ ...NEUTRAL, bodyYaw: Infinity }), false);
  assert.equal(readSettings({ upperBody: false }).upperBody, false);
  assert.equal(readSettings({}).upperBody, true);

  s.mappings.Arm = {
    source: 'armLeft',
    inputMin: 0,
    inputMax: 1,
    outputMin: 0,
    outputMax: 90,
    smoothing: 0,
    enabled: true,
  };
  const arm = [{ id: 'Arm', min: 0, max: 90, default: 0 }];
  assert.equal(mapper.map({ ...NEUTRAL, armLeft: 1 }, arm, s, 1 / 30).Arm, 90);
  const lost = mapper.map(NEUTRAL, arm, s, 1 / 30).Arm;
  assert.ok(lost > 0 && lost < 90);
  assert.equal(new FaceMapper().map(NEUTRAL, arm, s, 1 / 30).Arm, undefined);
});

test('untrusted settings recover and clamp without carrying unknown fields', () => {
  const s = readSettings({
    zoom: 100,
    y: 100,
    sensitivity: NaN,
    engine: 'remote',
    port: -1,
    background: 'url(x)',
    recentModels: [null, { name: 'A', path: '/a' }],
    neutral: { yaw: Infinity },
    evil: true,
  });
  assert.equal(s.zoom, 10);
  assert.equal(s.y, 3);
  assert.equal(s.port, 1024);
  assert.equal(s.sensitivity, 1);
  assert.equal(s.engine, 'mediapipe');
  assert.equal(s.background, defaults.background);
  assert.equal(s.neutral, null);
  assert.equal(s.recentModels.length, 1);
  assert.equal('evil' in s, false);
});
test('mapping respects model limits, missing parameters, calibration and lost face', () => {
  const mapper = new FaceMapper();
  const p = [
    { id: 'ParamAngleX', min: -12, max: 24, default: 2 },
    { id: 'ParamEyeLOpen', min: 0, max: 1, default: 1 },
    { id: 'Custom', min: 0, max: 1, default: 0 },
    { id: 'constructor', min: 0, max: 1, default: 0 },
  ];
  const s = {
    ...defaults,
    motionMirror: false,
    headSmooth: 0,
    eyeSmooth: 0,
    neutral: { ...NEUTRAL, yaw: 15 },
    eyeLink: 'off' as const,
  };
  assert.deepEqual(mapper.map({ ...NEUTRAL, yaw: 15 }, p, s, 1 / 30), {
    ParamAngleX: 2,
    ParamEyeLOpen: 1,
  });
  const atLimit = mapper.map({ ...NEUTRAL, yaw: 160, eyeLeft: 0 }, p, s, 1 / 30);
  assert.equal(atLimit.ParamAngleX, 24);
  assert.equal(atLimit.ParamEyeLOpen, 0);
  let lost = atLimit;
  for (let i = 0; i < 90; i++) lost = mapper.map(null, p, s, 1 / 30);
  assert.ok(Math.abs(lost.ParamAngleX - 2) < 0.001);
  assert.ok(lost.ParamEyeLOpen > 0.999);
  assert.equal(
    mapper.map({ ...NEUTRAL, yaw: 45 }, p, { ...s, motionMirror: true }, 1 / 30).ParamAngleX,
    -12,
  );
});
test('smoothing is time based and eyes respond independently', () => {
  const p = [
    { id: 'ParamAngleX', min: -30, max: 30, default: 0 },
    { id: 'ParamEyeLOpen', min: 0, max: 1, default: 1 },
  ];
  const face = { ...NEUTRAL, yaw: 30, eyeLeft: 0 };
  const a = new FaceMapper(),
    b = new FaceMapper();
  let av = {},
    bv = {};
  for (let i = 0; i < 30; i++) av = a.map(face, p, defaults, 1 / 30);
  for (let i = 0; i < 60; i++) bv = b.map(face, p, defaults, 1 / 60);
  assert.ok(Math.abs(av.ParamAngleX - bv.ParamAngleX) < 1e-8);
  const first = new FaceMapper().map(face, p, defaults, 1 / 30);
  assert.ok(1 - first.ParamEyeLOpen > Math.abs(first.ParamAngleX) / 30);
});
test('MediaPipe neutral matrix and blendshapes produce finite common frame', () => {
  const f = fromMediaPipe(
    [
      { categoryName: 'eyeBlinkLeft', score: 1 },
      { categoryName: 'jawOpen', score: 0.4 },
    ],
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  );
  assert.ok(f);
  assert.equal(f.eyeLeft, 0);
  assert.equal(f.eyeRight, 1);
  assert.equal(f.mouthOpen, 0.4);
  assert.equal(fromMediaPipe([], []), null);
});

test('MediaPipe head-up and head-down drive Live2D AngleY in the same direction with either mirror setting', () => {
  const parameters = [{ id: 'ParamAngleY', min: -30, max: 30, default: 0 }];
  const c = Math.sqrt(3) / 2;
  for (const [s, expected] of [
    [0.5, 30],
    [-0.5, -30],
  ]) {
    // Column-major: rotate the face's +Z forward vector toward +Y to look up.
    const face = fromMediaPipe([], [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]);
    assert.ok(face);
    for (const motionMirror of [false, true]) {
      const settings = readSettings({ motionMirror, headSmooth: 0 });
      const output = new FaceMapper().map(face, parameters, settings, 1 / 30);
      assert.ok(
        Math.abs(output.ParamAngleY - expected) < 1e-8,
        `Expected AngleY ${expected}, got ${output.ParamAngleY} (mirror=${motionMirror})`,
      );
    }
  }
});

test('custom mappings use normalized source endpoints and clamp to the model range', () => {
  const s = readSettings({
    motionMirror: false,
    mappings: {
      Custom: {
        source: 'yaw',
        inputMin: -0.5,
        inputMax: 0.5,
        outputMin: 10,
        outputMax: -10,
        smoothing: 0,
        enabled: true,
      },
      ParamEyeLOpen: {
        source: 'eyeLeft',
        inputMin: 0,
        inputMax: 1,
        outputMin: 0,
        outputMax: 1,
        smoothing: 0,
        enabled: false,
      },
    },
  });
  const p = [
    { id: 'Custom', min: -8, max: 8, default: 1 },
    { id: 'ParamEyeLOpen', min: 0, max: 1, default: 1 },
  ];
  const mapper = new FaceMapper();
  assert.deepEqual(mapper.map({ ...NEUTRAL, yaw: 7.5 }, p, s, 1 / 30), { Custom: -5 });
  assert.equal(mapper.map({ ...NEUTRAL, yaw: 30 }, p, s, 1 / 30).Custom, -8);
  let lost;
  for (let i = 0; i < 90; i++) lost = mapper.map(null, p, s, 1 / 30);
  assert.ok(Math.abs(lost.Custom - 1) < 0.001);
});

test('custom position ranges retain calibrated movement beyond the default unit interval', () => {
  const s = readSettings({
    motionMirror: false,
    neutral: { ...NEUTRAL, positionX: 0.5 },
    mappings: {
      Custom: {
        source: 'positionX',
        inputMin: -2,
        inputMax: 2,
        outputMin: -20,
        outputMax: 20,
        smoothing: 0,
        enabled: true,
      },
    },
  });
  const result = new FaceMapper().map(
    { ...NEUTRAL, positionX: 2 },
    [{ id: 'Custom', min: -30, max: 30, default: 0 }],
    s,
    1 / 30,
  );
  assert.equal(result.Custom, 15);
});

test('stored mouth opening mappings use reachable endpoints without early saturation', () => {
  const mapping = {
    source: 'mouthOpen',
    inputMin: 0,
    inputMax: 1,
    outputMin: 0,
    outputMax: 2.1,
    smoothing: 0,
    enabled: true,
  };
  // Old imports have no provenance/version flag and may use a nonstandard parameter ID.
  const settings = readSettings(JSON.parse(JSON.stringify({ mappings: { Mouth: mapping } })));
  const parameters = [{ id: 'Mouth', min: 0, max: 1, default: 0 }];
  for (const [mouthOpen, expected] of [
    [0, 0],
    [0.3, 0.42],
    [0.5, 0.7],
    [1, 1],
  ]) {
    const result = new FaceMapper().map({ mouthOpen }, parameters, settings, 0.1);
    assert.ok(Math.abs(result.Mouth - expected) < 1e-8, `${mouthOpen}: ${result.Mouth}`);
  }
  const voice = new FaceMapper().map(
    { voiceVolume: 0.5 },
    parameters,
    { ...settings, lipSyncMode: 'volume' },
    0.1,
  );
  assert.equal(voice.Mouth, 0.5);
  // Reversed endpoints and models with genuinely wider ranges remain supported.
  settings.mappings.Mouth.outputMin = 2.1;
  settings.mappings.Mouth.outputMax = 0;
  assert.equal(new FaceMapper().map({ mouthOpen: 0 }, parameters, settings, 0.1).Mouth, 1);
  assert.ok(
    Math.abs(new FaceMapper().map({ mouthOpen: 0.5 }, parameters, settings, 0.1).Mouth - 0.3) <
      1e-8,
  );
  settings.mappings.Mouth.outputMin = 0;
  settings.mappings.Mouth.outputMax = 2.1;
  parameters[0].max = 3;
  assert.ok(
    Math.abs(new FaceMapper().map({ mouthOpen: 0.5 }, parameters, settings, 0.1).Mouth - 1.47) <
      1e-8,
  );
});

test('optional face channels are validated and remain absent when unavailable', () => {
  assert.equal(state.isFace(NEUTRAL), true);
  assert.equal(state.isFace({ ...NEUTRAL, gazeX: Infinity }), false);
  assert.equal(state.isFace({ ...NEUTRAL, positionY: undefined }), false);
  assert.equal(state.isFace({ ...NEUTRAL, gazeX: 0.5 }), true);
  const p = [
    { id: 'ParamEyeBallX', min: -1, max: 1, default: 0 },
    { id: 'ParamBrowLY', min: -1, max: 1, default: 0 },
    { id: 'ParamMouthX', min: -1, max: 1, default: 0 },
  ];
  const s = readSettings({ motionMirror: false, headSmooth: 0, eyeSmooth: 0, mouthSmooth: 0 });
  assert.deepEqual(new FaceMapper().map(NEUTRAL, p, s, 1 / 30), {});
  assert.deepEqual(new FaceMapper().map(null, p, s, 1 / 30), {});
  assert.deepEqual(
    new FaceMapper().map({ ...NEUTRAL, gazeX: 0.5, browLeft: -0.25, mouthX: 0.4 }, p, s, 1 / 30),
    { ParamEyeBallX: 0.5, ParamBrowLY: -0.25, ParamMouthX: 0.4 },
  );
  assert.equal(state.normalizedFace(NEUTRAL, s).gazeX, undefined);
  assert.equal(
    state.normalizedFace(
      { ...NEUTRAL, positionX: 0.75 },
      { ...s, neutral: { ...NEUTRAL, positionX: 0.25 } },
    ).positionX,
    0.5,
  );
});

test('auto blink owns lost eyes while live eye tracking still wins', () => {
  const p = [{ id: 'ParamEyeLOpen', min: 0, max: 1, default: 1 }];
  const s = readSettings({ autoBlink: true, eyeSmooth: 0 });
  const mapper = new FaceMapper();
  assert.deepEqual(mapper.map({ ...NEUTRAL, eyeLeft: 0 }, p, s, 1 / 30), { ParamEyeLOpen: 0 });
  assert.deepEqual(mapper.map(null, p, s, 1 / 30), {});
});

test('per-model profiles restore independent calibration, mappings and display without changing globals', () => {
  let s = readSettings({
    modelPath: '/a',
    deviceId: 'camera-a',
    background: '#112233',
    neutral: { ...NEUTRAL, yaw: 12 },
    zoom: 1.8,
    x: 0.2,
    autoBlink: true,
    idleMotion: 'Idle:0',
    hotkeys: { 'expression:smile': 'Alt+KeyS' },
    mappings: {
      Custom: {
        source: 'gazeX',
        inputMin: -1,
        inputMax: 1,
        outputMin: -2,
        outputMax: 3,
        smoothing: 0,
        enabled: true,
      },
    },
  });
  assert.equal(typeof state.switchProfile, 'function');
  assert.equal(state.switchProfile(s, '/a').neutral.yaw, 12);
  s = state.switchProfile(s, '/b');
  assert.equal(s.modelPath, '/b');
  assert.equal(s.neutral, null);
  assert.equal(s.zoom, 1);
  assert.deepEqual(s.mappings, {});
  assert.equal(s.deviceId, 'camera-a');
  assert.equal(s.background, '#112233');
  s.zoom = 0.6;
  s.neutral = { ...NEUTRAL, yaw: -10 };
  state.rememberProfile(s);
  s = state.switchProfile(s, '/a');
  assert.equal(s.zoom, 1.8);
  assert.equal(s.x, 0.2);
  assert.equal(s.neutral.yaw, 12);
  assert.equal(s.autoBlink, true);
  assert.equal(s.idleMotion, 'Idle:0');
  assert.equal(s.hotkeys['expression:smile'], 'Alt+KeyS');
  assert.equal(s.mappings.Custom.source, 'gazeX');
  s.mappings.Custom.outputMin = -1;
  assert.equal(s.profiles['/a'].mappings.Custom.outputMin, -2);
  s = state.switchProfile(s, '/b');
  assert.equal(s.zoom, 0.6);
  assert.equal(s.neutral.yaw, -10);
});

test('settings reject malformed mappings and prototype keys, and sanitize stored profiles', () => {
  const mapping = {
    source: 'yaw',
    inputMin: -1,
    inputMax: 1,
    outputMin: -30,
    outputMax: 30,
    smoothing: 0.1,
    enabled: true,
  };
  const s = readSettings(
    JSON.parse(
      JSON.stringify({
        mappings: {
          good: mapping,
          badSource: { ...mapping, source: 'constructor' },
          zeroRange: { ...mapping, inputMax: -1 },
          badOutput: { ...mapping, outputMax: 1e20 },
        },
        profiles: {
          '/a': {
            zoom: 20,
            y: -20,
            neutral: { ...NEUTRAL, gazeX: 'bad' },
            mappings: { good: mapping },
            background: '#abcdef',
          },
        },
        hotkeys: { 'expression:smile': 'Alt+KeyS', bad: 42 },
      }),
    ),
  );
  assert.deepEqual(Object.keys(s.mappings), ['good']);
  assert.equal(s.profiles['/a'].zoom, 10);
  assert.equal(s.profiles['/a'].y, -3);
  assert.equal(s.profiles['/a'].neutral, null);
  assert.equal('background' in s.profiles['/a'], false);
  assert.deepEqual(s.hotkeys, { 'expression:smile': 'Alt+KeyS' });
  const poisoned = readSettings(
    JSON.parse(
      '{"mappings":{"__proto__":{},"constructor":{}},"profiles":{"__proto__":{},"constructor":{}},"hotkeys":{"__proto__":"KeyX"}}',
    ),
  );
  assert.equal(Object.hasOwn(poisoned.mappings, '__proto__'), false);
  assert.equal(Object.hasOwn(poisoned.profiles, 'constructor'), false);
  assert.equal(Object.getPrototypeOf(poisoned.hotkeys), Object.prototype);
});

test('MediaPipe adds gaze, brows, mouth shift and normalized translation', () => {
  const f = fromMediaPipe(
    [
      { categoryName: 'eyeLookOutLeft', score: 0.8 },
      { categoryName: 'eyeLookInRight', score: 0.4 },
      { categoryName: 'eyeLookUpLeft', score: 0.6 },
      { categoryName: 'eyeLookUpRight', score: 0.2 },
      { categoryName: 'browInnerUp', score: 0.2 },
      { categoryName: 'browOuterUpLeft', score: 0.5 },
      { categoryName: 'browDownRight', score: 0.4 },
      { categoryName: 'mouthRight', score: 0.6 },
      { categoryName: 'mouthLeft', score: 0.1 },
    ],
    [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, -2, -40, 1],
  );
  assert.ok(f);
  assert.ok(Math.abs(f.gazeX - 0.6) < 1e-10);
  assert.equal(f.gazeY, 0.4);
  assert.equal(f.browLeft, 0.7);
  assert.equal(f.browRight, -0.2);
  assert.equal(f.mouthX, 0.5);
  assert.equal(f.positionX, 0.5);
  assert.equal(f.positionY, -0.2);
  assert.equal(f.positionZ, -4);
});

test('linked eyes preserve front winks and use measured endpoints before side linking', () => {
  const s = readSettings({
    motionMirror: false,
    eyeLink: 'side',
    eyeLinkAngle: 25,
    eyeClosedLeft: 0.1,
    eyeClosedRight: 0.2,
    neutral: { ...NEUTRAL, eyeLeft: 0.8, eyeRight: 0.9 },
  });
  const wink = { ...NEUTRAL, eyeLeft: 0.1, eyeRight: 0.9 };
  assert.equal(state.normalizedFace(wink, s).eyeLeft, 0);
  assert.equal(state.normalizedFace(wink, s).eyeRight, 1);
  const linked = state.normalizedFace({ ...wink, yaw: 40 }, s);
  assert.equal(linked.eyeLeft, linked.eyeRight);
  const average = state.normalizedFace(wink, { ...s, eyeLink: 'always' });
  assert.equal(average.eyeLeft, 0.5);
  assert.equal(average.eyeRight, 0.5);
});

test('quality profile validation isolates model tuning and preserves capture devices', () => {
  const s = readSettings({
    modelPath: '/a',
    eyeLink: 'always',
    physicsStrength: 3,
    physicsFps: 60,
    physicsGroups: { hair: 0.3 },
    voiceTemplates: { A: [NaN] },
    micDeviceId: 'mic',
    cameraResolution: '1080p',
    trackingFps: 60,
    handTracking: true,
  });
  assert.equal(s.physicsStrength, 2);
  assert.deepEqual(s.voiceTemplates, {});
  const b = state.switchProfile(s, '/b');
  assert.equal(b.eyeLink, defaults.eyeLink);
  assert.deepEqual(b.physicsGroups, {});
  assert.equal(b.cameraResolution, '1080p');
  assert.equal(b.micDeviceId, 'mic');
  const a = state.switchProfile(b, '/a');
  assert.equal(a.eyeLink, 'always');
  assert.equal(a.physicsGroups.hair, 0.3);
  assert.equal(
    readSettings({ trackingFps: 999, renderFps: 1, handTracking: 'true' }).trackingFps,
    defaults.trackingFps,
  );
});

test('audio mouth can drive without a face and blends without inventing head input', () => {
  const voice = { voiceVolume: 0.8, voiceA: 0.8, voiceI: 0, voiceU: 0, voiceE: 0, voiceO: 0 };
  const s = readSettings({ lipSyncMode: 'volume', lipSyncBlend: 1 });
  const values = state.normalizedFace(voice, s);
  assert.equal(values.mouthOpen, 0.8);
  assert.equal(values.yaw, undefined);
  assert.equal(values.voiceA, 0.8);
  assert.equal(state.normalizedFace(voice, { ...s, lipSyncMode: 'off' }).mouthOpen, undefined);
  assert.equal(
    state.normalizedFace({ ...NEUTRAL, ...voice }, { ...s, lipSyncBlend: 0.5 }).mouthOpen,
    0.4,
  );
  const vowelSettings = {
    ...s,
    lipSyncMode: 'vowels' as const,
    voiceTemplates: Object.fromEntries(
      ['A', 'I', 'U', 'E', 'O'].map((v) => [v, Array(13).fill(0)]),
    ),
  };
  assert.equal(
    state.normalizedFace({ ...voice, voiceA: 1, voiceVolume: 0.2 }, vowelSettings).mouthOpen,
    0.2,
  );
  assert.equal(
    state.normalizedFace({ ...voice, voiceA: 1, voiceVolume: 0 }, vowelSettings).mouthOpen,
    0,
  );
});

test('imported hotkey behavior survives model profiles and rejects invalid options', () => {
  const s = readSettings({
    modelPath: '/a',
    hotkeys: { 'expression:smile': 'Alt+A', 'motion:Idle:0': 'Alt+B' },
    hotkeyOptions: {
      'expression:smile': { scope: 'local', release: true, seconds: 2, motionMode: 'hold' },
      'motion:Idle:0': { scope: 'global', motionMode: 'hold', seconds: -1 },
      unbound: { scope: 'global' },
    },
  });
  assert.deepEqual(s.hotkeyOptions, {
    'expression:smile': { scope: 'local', release: true, seconds: 2 },
    'motion:Idle:0': { scope: 'local', motionMode: 'hold' },
  });
  const other = state.switchProfile(s, '/b');
  assert.deepEqual(other.hotkeyOptions, {});
  assert.deepEqual(state.switchProfile(other, '/a').hotkeyOptions, s.hotkeyOptions);
  assert.deepEqual(
    readSettings({
      hotkeys: s.hotkeys,
      hotkeyOptions: { 'expression:smile': { scope: 'local', seconds: Infinity } },
    }).hotkeyOptions,
    { 'expression:smile': { scope: 'local' } },
  );
});

test('keyboard hotkey switch defaults on and persists per model without clearing bindings', () => {
  assert.equal(readSettings(null).useKeyboardHotkeys, true);
  assert.equal(readSettings({ useKeyboardHotkeys: 'false' }).useKeyboardHotkeys, true);
  const settings = readSettings({
    modelPath: '/a',
    useKeyboardHotkeys: false,
    hotkeys: { 'expression:smile': 'KeyF' },
  });
  const other = state.switchProfile(settings, '/b');
  assert.equal(other.useKeyboardHotkeys, true);
  const restored = state.switchProfile(readSettings(JSON.parse(JSON.stringify(other))), '/a');
  assert.equal(restored.useKeyboardHotkeys, false);
  assert.deepEqual(restored.hotkeys, { 'expression:smile': 'KeyF' });
});

test('parameter metadata uses authored names and bounded groups without adding foreign parameters', () => {
  const parameters = [
    { id: 'Param15', min: 0, max: 1, default: 0 },
    { id: 'Bare', min: -1, max: 1, default: 0 },
  ];
  const info = {
    Parameters: [
      { Id: 'Param15', Name: '  牌子  ', GroupId: 'accessories' },
      { Id: 'Unknown', Name: 'unused' },
    ],
    ParameterGroups: [
      { Id: 'accessories', Name: '道具', GroupId: 'root' },
      { Id: 'root', Name: '外观', GroupId: 'accessories' },
    ],
  };
  assert.deepEqual(state.describeParameters(parameters, info), [
    { ...parameters[0], name: '牌子', group: '外观 / 道具' },
    parameters[1],
  ]);
  assert.deepEqual(state.describeParameters(parameters, null), parameters);
});

test('appearance and unbound action behavior survive reload and remain model-specific', () => {
  const settings = readSettings({
    modelPath: '/a',
    parameterOverrides: { Param15: 1, broken: Infinity },
    defaultParameterOverrides: { Param15: 0.5 },
    defaultExpressions: ['vts:sign.exp3.json', 'vts:sign.exp3.json', 42],
    lostIdleMotion: 'Idle:1',
    motionSound: false,
    hotkeyOptions: {
      'expression:sign': { scope: 'local', release: true, seconds: 3, fadeSeconds: 0.5 },
    },
  });
  assert.deepEqual(settings.parameterOverrides, { Param15: 1 });
  assert.deepEqual(settings.defaultExpressions, ['vts:sign.exp3.json']);
  assert.deepEqual(settings.hotkeyOptions['expression:sign'], {
    scope: 'local',
    release: true,
    seconds: 3,
    fadeSeconds: 0.5,
  });
  const other = state.switchProfile(settings, '/b');
  assert.deepEqual(other.parameterOverrides, {});
  assert.deepEqual(other.defaultExpressions, []);
  assert.equal(other.motionSound, true);
  const restored = state.switchProfile(readSettings(JSON.parse(JSON.stringify(other))), '/a');
  for (const key of [
    'parameterOverrides',
    'defaultParameterOverrides',
    'defaultExpressions',
    'hotkeyOptions',
    'lostIdleMotion',
    'motionSound',
  ] as const)
    assert.deepEqual(restored[key], settings[key]);
  restored.parameterOverrides.Param15 = 0;
  assert.equal(restored.defaultParameterOverrides.Param15, 0.5);
});

test('unclamped mappings extrapolate but remain within model limits; automatic breath needs no camera', () => {
  const mapping = {
    source: 'yaw',
    inputMin: -0.5,
    inputMax: 0.5,
    outputMin: -10,
    outputMax: 10,
    smoothing: 0,
    enabled: true,
    clamp: false,
  };
  const settings = readSettings({ motionMirror: false, mappings: { Custom: mapping } });
  const parameter = [{ id: 'Custom', min: -15, max: 15, default: 0 }];
  assert.equal(
    new FaceMapper().map({ ...NEUTRAL, yaw: 22.5 }, parameter, settings, 0.1).Custom,
    15,
  );
  settings.mappings.Custom.clamp = true;
  assert.equal(
    new FaceMapper().map({ ...NEUTRAL, yaw: 22.5 }, parameter, settings, 0.1).Custom,
    10,
  );
  settings.mappings.Custom = {
    ...settings.mappings.Custom,
    source: 'breath',
    inputMin: 0,
    inputMax: 1,
    outputMin: 0,
    outputMax: 1,
  };
  const mapper = new FaceMapper();
  const first = mapper.map(null, parameter, settings, 0.1).Custom;
  let last = first;
  for (let i = 0; i < 10; i++) last = mapper.map(null, parameter, settings, 0.1).Custom;
  assert.ok(first > 0 && last > first && last <= 1);
  mapper.reset();
  assert.equal(mapper.map(null, parameter, settings, 0.1).Custom, first);
  assert.equal(state.normalizedFace({ browLeft: 0.6, browRight: 0.2 }, settings).brows, 0.7);
  assert.equal(state.normalizedFace(NEUTRAL, settings).tongueOut, undefined);
});
