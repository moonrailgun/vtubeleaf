import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readComposition, readScenes, snapshotScene } from '../src/scenes.ts';

test('scene documents bound untrusted values and snapshots do not share items', () => {
  const composition = readComposition({
    items: [
      {
        id: 'one',
        name: 'Hat',
        kind: 'image',
        source: 'a'.repeat(32) + '.png',
        x: Infinity,
        scale: -4,
        opacity: 2,
      },
      { id: 'one', kind: 'image', source: '../../bad.png' },
      { id: 'bad', kind: 'image', source: '../../bad.png' },
      { id: 'unknown', kind: 'audio', source: 'a'.repeat(32) + '.png' },
    ],
  });
  assert.equal(composition.items.length, 1);
  assert.equal(composition.items[0].x, 0);
  assert.equal(composition.items[0].scale, 0.05);
  assert.equal(composition.items[0].opacity, 1);
  const scene = snapshotScene(
    'scene',
    'Desk',
    '/model',
    '#123456',
    { x: 0, y: 0, zoom: 1, rotation: 0, modelVisible: false },
    composition,
  );
  composition.items[0].visible = false;
  assert.equal(scene.composition.items[0].visible, true);
  assert.equal(readScenes([scene, scene]).length, 1);
  assert.equal(readScenes([scene])[0].placement.modelVisible, false);
  assert.equal(readScenes([{ ...scene, placement: {} }])[0].placement.modelVisible, true);
});
