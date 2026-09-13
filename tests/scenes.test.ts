import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readComposition, readScenes, snapshotScene } from '../src/scenes.ts';
import { readSettings } from '../src/state.ts';

test('built-in backgrounds survive settings and scene reloads without allowing arbitrary sources', () => {
  for (const backgroundImage of [
    'builtin:beach',
    'builtin:meeting-room',
    'builtin:office',
    'builtin:home',
    'builtin:bedroom',
    'builtin:cafe',
    'builtin:gaming-room',
    'a'.repeat(32) + '.png',
  ]) {
    const composition = { backgroundImage, items: [] };
    const scene = snapshotScene(
      'room',
      'Room',
      '',
      '#123456',
      { x: 0, y: 0, zoom: 1, rotation: 0, modelVisible: true },
      composition,
    );
    const restored = readSettings(JSON.parse(JSON.stringify({ composition, scenes: [scene] })));
    assert.equal(restored.composition.backgroundImage, backgroundImage);
    assert.equal(restored.scenes[0].composition.backgroundImage, backgroundImage);
  }
  for (const backgroundImage of [
    'builtin:unknown',
    'builtin:../beach',
    '/backgrounds/beach.jpg',
    'https://example.com/beach.jpg',
    '../../beach.jpg',
    null,
  ]) {
    assert.equal(readComposition({ backgroundImage }).backgroundImage, '');
  }
  assert.equal(
    readComposition({ items: [{ id: 'item', kind: 'image', source: 'builtin:beach' }] }).items
      .length,
    0,
  );
});

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
    { x: 0, y: 1, zoom: 5, rotation: 0, modelVisible: false },
    composition,
  );
  composition.items[0].visible = false;
  assert.equal(scene.composition.items[0].visible, true);
  assert.equal(readScenes([scene, scene]).length, 1);
  assert.equal(readScenes([scene])[0].placement.modelVisible, false);
  assert.equal(readScenes([scene])[0].placement.zoom, 5);
  assert.equal(readScenes([scene])[0].placement.y, 1);
  assert.equal(readScenes([{ ...scene, placement: { y: -1 } }])[0].placement.y, -1);
  assert.equal(readScenes([{ ...scene, placement: {} }])[0].placement.modelVisible, true);
});
