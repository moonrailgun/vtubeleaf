import assert from 'node:assert/strict';
import test from 'node:test';
import { layoutMasks, maskBufferSize } from '../src/masks.ts';

function assertCovers(count: number) {
  const layout = layoutMasks(count);
  assert.equal(layout.length, count);
  for (const cell of layout) {
    assert.ok(cell.channel >= 0 && cell.channel < 4, `channel ${cell.channel}`);
    assert.ok(cell.x >= 0 && cell.x + cell.width <= 1 + 1e-9, `x ${cell.x} w ${cell.width}`);
    assert.ok(cell.y >= 0 && cell.y + cell.height <= 1 + 1e-9, `y ${cell.y} h ${cell.height}`);
  }
  const keys = new Set(layout.map((cell) => `${cell.channel}:${cell.x}:${cell.y}`));
  assert.equal(keys.size, count, 'every mask gets its own cell');
}

test('small mask counts keep the SDK layout', () => {
  assert.deepEqual(layoutMasks(1), [{ channel: 0, x: 0, y: 0, width: 1, height: 1 }]);
  assert.deepEqual(layoutMasks(2), [
    { channel: 0, x: 0, y: 0, width: 1, height: 1 },
    { channel: 1, x: 0, y: 0, width: 1, height: 1 },
  ]);
  assert.deepEqual(layoutMasks(5).slice(0, 2), [
    { channel: 0, x: 0, y: 0, width: 0.5, height: 1 },
    { channel: 0, x: 0.5, y: 0, width: 0.5, height: 1 },
  ]);
  for (const count of [3, 4, 9, 16, 36, 64]) assertCovers(count);
});

test('mask counts above the SDK limit of 64 still get a unique cell each', () => {
  for (const count of [65, 85, 100, 256]) assertCovers(count);
  const layout = layoutMasks(85);
  assert.equal(layout.filter((cell) => cell.channel === 0).length, 22);
  assert.equal(layout.filter((cell) => cell.channel === 3).length, 21);
  assert.ok(layout.every((cell) => cell.width >= 0.2 - 1e-9 && cell.height >= 0.2 - 1e-9));
});

test('mask buffer grows with the grid so cells keep roughly 256 px', () => {
  assert.equal(maskBufferSize(0), 256);
  assert.equal(maskBufferSize(4), 256);
  assert.equal(maskBufferSize(16), 512);
  assert.equal(maskBufferSize(36), 1024);
  assert.equal(maskBufferSize(85), 2048);
  assert.equal(maskBufferSize(1000), 2048);
});
