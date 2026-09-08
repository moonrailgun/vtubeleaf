import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleCalibration } from '../src/calibration.ts';
import { NEUTRAL } from '../src/state.ts';

const samples = Array.from({ length: 20 }, (_, i) => ({
  at: i * 60,
  face: { ...NEUTRAL, yaw: 8 + (i % 2 ? 0.5 : -0.5), eyeLeft: 0.8, eyeRight: 0.9 },
}));
test('calibration averages stable observations and rejects short, blinking or moving samples', () => {
  const result = sampleCalibration(samples, 'neutral');
  assert.ok(Math.abs(result.yaw - 8) < 1e-8);
  assert.ok(Math.abs(result.eyeLeft - 0.8) < 1e-8);
  assert.throws(() => sampleCalibration(samples.slice(0, 3), 'neutral'));
  assert.throws(() =>
    sampleCalibration(
      samples.map((s, i) => ({ ...s, face: { ...s.face, yaw: i * 3 } })),
      'neutral',
    ),
  );
  assert.throws(() =>
    sampleCalibration(
      samples.map((s) => ({ ...s, face: { ...s.face, eyeLeft: 0.1 } })),
      'neutral',
    ),
  );
  assert.throws(() =>
    sampleCalibration(
      samples.map((s) => ({ ...s, face: { ...s.face, yaw: NaN } })),
      'neutral',
    ),
  );
});
test('closed-eye calibration retains measured endpoints and rejects open eyes', () => {
  const closed = samples.map((s) => ({ ...s, face: { ...s.face, eyeLeft: 0.12, eyeRight: 0.18 } }));
  const result = sampleCalibration(closed, 'eyes');
  assert.ok(Math.abs(result.eyeRight - 0.18) < 1e-8);
  assert.throws(() => sampleCalibration(samples, 'eyes'));
});
