import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionRecording } from '../src/recording.ts';

test('manual recording exports timed Cubism curves, rejects invalid frames, and stops at its limit', () => {
  const recording = new MotionRecording();
  recording.capture({ Head: 20 }, 0);
  assert.equal(recording.export(), null);
  recording.start();
  recording.capture({ Head: 1, Eye: 0, Invalid: NaN }, 100);
  recording.capture({ Head: 2, Eye: 1 }, 600);
  recording.capture({ Head: 3, Eye: 0 }, 1100);
  recording.stop();
  const motion = recording.export()!;
  assert.equal(motion.Meta.Duration, 1);
  assert.equal(motion.Meta.CurveCount, 2);
  assert.deepEqual(motion.Curves[0].Segments, [0, 1, 0, 0.5, 2, 0, 1, 3]);
  recording.capture({ Head: 9 }, 2100);
  assert.deepEqual(recording.export(), motion);
  recording.start();
  recording.capture({ Head: 0 }, 0);
  recording.capture({ Head: 1 }, 61000);
  assert.equal(recording.active, false);
  assert.equal(recording.export()!.Meta.Duration, 60);
});
