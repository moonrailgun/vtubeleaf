import assert from 'node:assert/strict';
import test from 'node:test';
import { FaceMapper, readSettings } from '../src/state.ts';
import { fromNvidia } from '../src/nvidia.ts';

test('NVIDIA settings survive reload while invalid paths are discarded', () => {
  const settings = readSettings({
    engine: 'nvidia',
    nvidiaPath: 'C:\\VTubeLeaf\\VTubeLeafNvidia.exe',
    nvidiaModelDir: 'C:\\ARSDK\\bin\\models',
  });
  assert.equal(settings.engine, 'nvidia');
  assert.equal(Reflect.get(settings, 'nvidiaPath'), 'C:\\VTubeLeaf\\VTubeLeafNvidia.exe');
  assert.equal(Reflect.get(settings, 'nvidiaModelDir'), 'C:\\ARSDK\\bin\\models');
  const invalid = readSettings({ nvidiaPath: {}, nvidiaModelDir: 'a'.repeat(4096) });
  assert.equal(Reflect.get(invalid, 'nvidiaPath'), '');
  assert.equal(Reflect.get(invalid, 'nvidiaModelDir'), '');
  assert.equal(readSettings(null).engine, 'mediapipe');
});

test('NVIDIA expressions, independent brows and quaternion use the existing face conventions', () => {
  const expressions = Array(53).fill(0);
  for (const [index, value] of [
    [10, 1],
    [11, 0.25],
    [26, 0.8],
    [45, 0.6],
    [46, 0.4],
    [2, 0.7],
    [6, 0.8],
    [7, 0.4],
    [1, 0.2],
    [16, 0.8],
    [40, 0.6],
  ])
    expressions[index] = value;
  const packet = { detected: true, rotation: [0, 0, 0, 1], expressions };
  const face = fromNvidia(packet)!;
  assert.equal(face.eyeLeft, 0);
  assert.equal(face.eyeRight, 0.75);
  assert.equal(face.mouthOpen, 0.8);
  assert.equal(face.mouthSmile, 0.5);
  assert.equal(face.browLeft, 0.7);
  assert.equal(face.browRight, -0.2);
  assert.equal(face.gazeX, 0.4);
  assert.equal(face.mouthX, 0.6);
  assert.ok(Math.abs(face.cheekPuff! - 0.6) < 1e-6);
  assert.equal(face.tongueOut, undefined);
  const sine = Math.sin(Math.PI / 12),
    cosine = Math.cos(Math.PI / 12);
  for (const [rotation, key, expected] of [
    [[sine, 0, 0, cosine], 'pitch', -30],
    [[0, sine, 0, cosine], 'yaw', 30],
    [[0, 0, sine, cosine], 'roll', -30],
  ] as const)
    assert.ok(Math.abs(fromNvidia({ ...packet, rotation })![key] - expected) < 0.001);
  for (const bad of [
    null,
    {},
    { ...packet, detected: false },
    { ...packet, rotation: [0, 0, 0, 0] },
    { ...packet, expressions: [] },
    { ...packet, expressions: expressions.with(10, NaN) },
    { ...packet, rotation: [0, 0, 0, Infinity] },
  ])
    assert.equal(fromNvidia(bad), null);
});

test('NVIDIA camera-space tilts drive Live2D AngleZ in the preview direction', () => {
  const parameters = [{ id: 'ParamAngleZ', min: -30, max: 30, default: 0 }];
  for (const [angle, expected] of [
    [30, -30],
    [-30, 30],
  ]) {
    // In NVIDIA's +Y-up camera frame, positive Z rotation tilts the head screen-left.
    const radians = (angle * Math.PI) / 180;
    const face = fromNvidia({
      detected: true,
      rotation: [0, 0, Math.sin(radians / 2), Math.cos(radians / 2)],
      expressions: Array(53).fill(0),
    });
    assert.ok(face);
    for (const motionMirror of [false, true]) {
      const settings = readSettings({ motionMirror, headSmooth: 0 });
      const output = new FaceMapper().map(face, parameters, settings, 1 / 30);
      assert.ok(Math.abs(output.ParamAngleZ - (motionMirror ? -expected : expected)) < 1e-8);
    }
  }
});
