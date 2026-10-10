import test from 'node:test';
import assert from 'node:assert/strict';
import { duePoseHand } from '../src/tracker.ts';

// Ticks that see a new camera frame, with ±3 ms timer jitter and optionally every seventh lost.
function rates(tickFps: number, poseFps: number, handFps: number, lose = false) {
  const due = { pose: -Infinity, hand: -Infinity, handFirst: false };
  const seconds = 20;
  const runs = { pose: 0, hand: 0, both: 0 };
  for (let i = 0; i < seconds * tickFps; i++) {
    if (lose && i % 7 === 6) continue;
    const now = (i * 1000) / tickFps + 3 * Math.sin(i * 12.9898);
    const { pose, hand } = duePoseHand(due, now, tickFps, poseFps, handFps);
    runs.pose += Number(pose);
    runs.hand += Number(hand);
    runs.both += Number(pose && hand);
  }
  return { pose: runs.pose / seconds, hand: runs.hand / seconds, both: runs.both / seconds };
}

test('a deferred run keeps its cadence from the time it fell due', () => {
  const due = { pose: 100, hand: 100, handFirst: false };
  assert.deepEqual(duePoseHand(due, 100, 30, 10, 10), { pose: true, hand: false });
  assert.deepEqual(duePoseHand(due, 133, 30, 10, 10), { pose: false, hand: true });
  assert.deepEqual(due, { pose: 200, hand: 200, handFirst: true });
  // The next collision lets the hand go first.
  assert.deepEqual(duePoseHand(due, 200, 30, 10, 10), { pose: false, hand: true });
  assert.deepEqual(duePoseHand(due, 233, 30, 10, 10), { pose: true, hand: false });
  // A run a whole interval late restarts its cadence instead of catching up.
  assert.deepEqual(duePoseHand(due, 450, 30, 10, 0), { pose: true, hand: false });
  assert.equal(due.pose, 550);
});

test('pose and hand never share a tick when each leaves every other tick free', () => {
  for (const [tick, pose, hand] of [
    [30, 10, 10],
    [30, 15, 15],
    [30, 5, 15],
    [24, 10, 10],
    [60, 30, 30],
    [60, 10, 15],
  ]) {
    const result = rates(tick, pose, hand);
    assert.equal(result.both, 0, `${tick}/${pose}/${hand}`);
    assert.ok(Math.abs(result.pose - pose) <= 0.1, `${tick}/${pose}/${hand} pose ${result.pose}`);
    assert.ok(Math.abs(result.hand - hand) <= 0.1, `${tick}/${pose}/${hand} hand ${result.hand}`);
  }
  // Lost frames make them collide again; the deferrals still keep the default rates.
  assert.deepEqual(rates(30, 10, 10, true), { pose: 10, hand: 10, both: 0 });
});

test('rates that cannot be separated still run both on one tick', () => {
  for (const [tick, pose, hand] of [
    [15, 10, 10],
    [24, 15, 15],
    [30, 30, 10],
  ]) {
    const result = rates(tick, pose, hand);
    assert.ok(result.both > 0, `${tick}/${pose}/${hand}`);
    assert.ok(Math.abs(result.pose - Math.min(pose, tick)) <= 0.1, `${tick}/${pose}/${hand}`);
    assert.ok(Math.abs(result.hand - Math.min(hand, tick)) <= 0.1, `${tick}/${pose}/${hand}`);
  }
});

test('a reset after pause or stop runs both again on the next two ticks', () => {
  const due = { pose: 900, hand: 933, handFirst: false };
  due.pose = due.hand = -Infinity;
  const first = duePoseHand(due, 1000, 30, 10, 10);
  const second = duePoseHand(due, 1033, 30, 10, 10);
  assert.notEqual(first.pose, first.hand);
  assert.deepEqual(second, { pose: first.hand, hand: first.pose });
});
