import test from 'node:test';
import assert from 'node:assert/strict';
import { fromHands } from '../src/hands.ts';

type Point = { x: number; y: number; z: number };

function openHand(): Point[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.65, z: 0 }));
  points[0] = { x: 0.5, y: 0.82, z: 0 };
  for (const [ids, x] of [
    [[1, 2, 3, 4], 0.28],
    [[5, 6, 7, 8], 0.38],
    [[9, 10, 11, 12], 0.5],
    [[13, 14, 15, 16], 0.62],
    [[17, 18, 19, 20], 0.72],
  ] as const)
    ids.forEach((id, index) => {
      points[id] = { x, y: 0.62 - index * 0.12, z: -index * 0.01 };
    });
  return points;
}

test('assigns a confident hand and derives bounded open-finger geometry', () => {
  const hand = openHand();
  const signals = fromHands([hand], [hand], [[{ categoryName: 'Left', score: 0.95 }]]);

  assert.equal(signals.handLeftFound, 1);
  assert.equal(signals.handRightFound, 0);
  for (const key of ['handLeftX', 'handLeftY', 'handLeftZ', 'handLeftAngle'] as const)
    assert.ok(signals[key]! >= -1 && signals[key]! <= 1, key);
  for (const key of [
    'handLeftOpen',
    'handLeftThumb',
    'handLeftIndex',
    'handLeftMiddle',
    'handLeftRing',
    'handLeftLittle',
  ] as const)
    assert.ok(signals[key]! > 0.9 && signals[key]! <= 1, key);
});

test('folded finger geometry changes only its finger and aggregate openness', () => {
  const hand = openHand();
  hand[6] = { x: 0.38, y: 0.5, z: 0 };
  hand[7] = { x: 0.48, y: 0.5, z: 0 };
  hand[8] = { x: 0.38, y: 0.58, z: 0 };
  const signals = fromHands([hand], [hand], [[{ categoryName: 'Right', score: 0.9 }]]);

  assert.equal(signals.handRightFound, 1);
  assert.ok(signals.handRightIndex! < 0.25);
  assert.ok(signals.handRightMiddle! > 0.9);
  assert.ok(signals.handRightOpen! < 0.9);
});

test('missing, low-confidence and malformed hands emit explicit absence', () => {
  const malformed = openHand();
  malformed[8] = { x: NaN, y: 0, z: 0 };

  assert.deepEqual(fromHands([], [], []), { handLeftFound: 0, handRightFound: 0 });
  assert.deepEqual(fromHands([openHand()], [], [[{ categoryName: 'Left', score: 0.59 }]]), {
    handLeftFound: 0,
    handRightFound: 0,
  });
  assert.deepEqual(fromHands([malformed], [], [[{ categoryName: 'Right', score: 1 }]]), {
    handLeftFound: 0,
    handRightFound: 0,
  });
});
