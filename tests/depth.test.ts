import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaceMapper, NEUTRAL, readSettings, switchProfile } from '../src/state.ts';

test('depth moves closer/larger and farther/smaller independently of tracker units and mirror', () => {
  for (const unit of [1, 100, -1]) {
    for (const motionMirror of [true, false]) {
      const s = readSettings({
        neutral: { ...NEUTRAL, positionZ: -4 * unit },
        headSmooth: 0,
        motionMirror,
        zoom: 2,
      });
      const mapper = new FaceMapper();
      for (const [distance, expected] of [
        [-4, 1],
        [-3.2, 1.25],
        [-5, 0.8],
      ]) {
        mapper.map({ positionZ: distance * unit }, [], s, 0.1);
        assert.ok(Math.abs(mapper.depthScale - expected) < 1e-8);
      }
      assert.equal(s.zoom, 2);
    }
  }
});

test('uncalibrated depth uses the first valid frame and resets for a new session or profile', () => {
  const s = readSettings({ headSmooth: 0 });
  const mapper = new FaceMapper();
  mapper.map({ positionZ: -4 }, [], s, 0.1);
  assert.equal(mapper.depthScale, 1);
  mapper.map({ positionZ: -3.2 }, [], s, 0.1);
  assert.equal(mapper.depthScale, 1.25);
  mapper.reset();
  mapper.map({ positionZ: -6 }, [], s, 0.1);
  assert.equal(mapper.depthScale, 1);
});

test('depth is bounded, ignores invalid distances, and can be disabled', () => {
  const s = readSettings({ neutral: { ...NEUTRAL, positionZ: -4 }, headSmooth: 0 });
  const mapper = new FaceMapper();
  for (const [distance, expected] of [
    [-0.01, 1.5],
    [-1000, 0.5],
  ]) {
    mapper.map({ positionZ: distance }, [], s, 0.1);
    assert.equal(mapper.depthScale, expected);
  }
  for (const positionZ of [0, NaN, Infinity, 4, undefined]) {
    mapper.reset();
    mapper.map({ positionZ }, [], s, 0.1);
    assert.equal(mapper.depthScale, 1);
  }
  s.depthSensitivity = 0;
  mapper.map({ positionZ: -2 }, [], s, 0.1);
  assert.equal(mapper.depthScale, 1);
});

test('depth smoothing is frame-rate independent and missing tracking follows recovery mode', () => {
  const s = readSettings({ neutral: { ...NEUTRAL, positionZ: -4 }, headSmooth: 0.2 });
  const at30 = new FaceMapper(),
    at60 = new FaceMapper();
  for (let i = 0; i < 30; i++) at30.map({ positionZ: -3.2 }, [], s, 1 / 30);
  for (let i = 0; i < 60; i++) at60.map({ positionZ: -3.2 }, [], s, 1 / 60);
  assert.ok(at30.depthScale > 1 && at30.depthScale < 1.25);
  assert.ok(Math.abs(at30.depthScale - at60.depthScale) < 1e-8);
  const held = at30.depthScale;
  s.lostMode = 'hold';
  at30.map({ mouthOpen: 0.5 }, [], s, 0.1);
  assert.equal(at30.depthScale, held);
  at30.map(null, [], s, 0.1);
  assert.ok(at30.depthScale < held && at30.depthScale > 1);
  const recovering = at30.depthScale;
  at30.map({ mouthOpen: 0.5 }, [], s, 0.1, null);
  assert.ok(
    at30.depthScale < recovering,
    'microphone-only frames must not hold camera depth after stop',
  );
  s.lostMode = 'neutral';
  at60.map({}, [], s, 0.1);
  assert.ok(at60.depthScale < held && at60.depthScale > 1);
});

test('depth strength is validated and remembered separately for each model', () => {
  const a = readSettings({ modelPath: '/a', depthSensitivity: 0.4 });
  const b = switchProfile(a, '/b');
  b.depthSensitivity = 0;
  assert.equal(switchProfile(b, '/a').depthSensitivity, 0.4);
  assert.equal(readSettings({ depthSensitivity: -1 }).depthSensitivity, 0);
  assert.equal(readSettings({ depthSensitivity: 100 }).depthSensitivity, 2);
  assert.equal(readSettings({ depthSensitivity: NaN }).depthSensitivity, 1);
});
