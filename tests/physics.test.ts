import assert from 'node:assert/strict';
import test from 'node:test';
import { physicsGroupsFromJson, wrapPhysics } from '../src/physics.ts';

test('physics wrapper scales groups, restores runtime state and bounds fixed steps', () => {
  const calls: { dt: number; weights: number[]; scales: number[]; wind: number }[] = [];
  const options = { wind: { x: 0, y: 0 } };
  const physics = {
    _physicsRig: {
      settings: [
        { baseOutputIndex: 0, outputCount: 1 },
        { baseOutputIndex: 1, outputCount: 1 },
      ],
      outputs: [
        { weight: 80, translationScale: { x: 2, y: 3 }, angleScale: 4 },
        { weight: 40, translationScale: { x: 5, y: 6 }, angleScale: 7 },
      ],
      particles: [],
    },
    getOption: () => options,
    evaluate(_model: unknown, dt: number) {
      calls.push({
        dt,
        weights: this._physicsRig.outputs.map((output) => output.weight),
        scales: this._physicsRig.outputs.map((output) => output.translationScale.x),
        wind: options.wind.x,
      });
    },
  };
  let controls = {
    physicsStrength: 1.5,
    physicsWind: 2,
    physicsFps: 30,
    physicsGroups: { hair: 0.5, scarf: 0 },
  };

  wrapPhysics(physics, ['hair', 'scarf'], () => controls);
  physics.evaluate({}, 10);

  assert.ok(calls.length > 0 && calls.length <= 4);
  assert.ok(calls.every((call) => Math.abs(call.dt - 1 / 30) < 1e-9));
  assert.deepEqual(calls[0].weights, [60, 0]);
  assert.deepEqual(calls[0].scales, [2, 5]);
  assert.ok(calls.every((call) => call.wind === 2));
  assert.deepEqual(
    physics._physicsRig.outputs.map((output) => output.weight),
    [80, 40],
  );
  assert.deepEqual(physics._physicsRig.outputs[0], {
    weight: 80,
    translationScale: { x: 2, y: 3 },
    angleScale: 4,
  });
  assert.equal(options.wind.x, 0);

  calls.length = 0;
  controls = { ...controls, physicsStrength: 0, physicsFps: 0 };
  physics.evaluate({}, 1 / 60);
  assert.deepEqual(calls[0].weights, [0, 0]);
  assert.deepEqual(
    physics._physicsRig.outputs.map((output) => output.weight),
    [80, 40],
  );
});

test('physics wrapper preserves strength above the evaluator weight ceiling', () => {
  const calls: { weights: number[]; x: number[]; y: number[]; angles: number[] }[] = [];
  const physics = {
    _physicsRig: {
      settings: [{ baseOutputIndex: 0, outputCount: 2 }],
      outputs: [
        { weight: 100, translationScale: { x: 2, y: 3 }, angleScale: 4 },
        { weight: 40, translationScale: { x: 5, y: 6 }, angleScale: 7 },
      ],
      particles: [],
    },
    getOption: () => ({ wind: { x: 0, y: 0 } }),
    evaluate() {
      calls.push({
        weights: this._physicsRig.outputs.map((output) => output.weight),
        x: this._physicsRig.outputs.map((output) => output.translationScale.x),
        y: this._physicsRig.outputs.map((output) => output.translationScale.y),
        angles: this._physicsRig.outputs.map((output) => output.angleScale),
      });
    },
  };

  wrapPhysics(physics, ['hair'], () => ({
    physicsStrength: 2,
    physicsWind: 0,
    physicsFps: 0,
    physicsGroups: { hair: 1 },
  }));
  physics.evaluate({}, 1 / 60);

  assert.deepEqual(calls[0], {
    weights: [100, 80],
    x: [4, 5],
    y: [6, 6],
    angles: [8, 7],
  });
  assert.deepEqual(physics._physicsRig.outputs, [
    { weight: 100, translationScale: { x: 2, y: 3 }, angleScale: 4 },
    { weight: 40, translationScale: { x: 5, y: 6 }, angleScale: 7 },
  ]);
});

test('physics wrapper reapplies output between fixed simulation steps', () => {
  const calls: number[] = [];
  const originalPosition = { x: 1, y: 2 };
  const particle = {
    position: originalPosition,
    lastPosition: { x: 3, y: 4 },
    lastGravity: { x: 5, y: 6 },
    force: { x: 7, y: 8 },
    velocity: { x: 9, y: 10 },
  };
  const physics = {
    _physicsRig: {
      settings: [{ baseOutputIndex: 0, outputCount: 1 }],
      outputs: [{ weight: 100, translationScale: { x: 1, y: 1 }, angleScale: 1 }],
      particles: [particle],
    },
    getOption: () => ({ wind: { x: 0, y: 0 } }),
    evaluate(_model: unknown, dt: number) {
      calls.push(dt);
      for (const key of ['position', 'lastPosition', 'lastGravity', 'force', 'velocity'] as const) {
        const vector = this._physicsRig.particles[0][key];
        this._physicsRig.particles[0][key] = { x: vector.x + 10, y: vector.y + 20 };
      }
    },
  };

  wrapPhysics(physics, ['hair'], () => ({
    physicsStrength: 1,
    physicsWind: 0,
    physicsFps: 30,
    physicsGroups: { hair: 1 },
  }));
  physics.evaluate({}, 1 / 60);

  assert.deepEqual(particle, {
    position: { x: 1, y: 2 },
    lastPosition: { x: 3, y: 4 },
    lastGravity: { x: 5, y: 6 },
    force: { x: 7, y: 8 },
    velocity: { x: 9, y: 10 },
  });
  assert.equal(particle.position, originalPosition);

  physics.evaluate({}, 1 / 60);

  assert.deepEqual(calls, [0, 1 / 30]);
  assert.deepEqual(particle.position, { x: 11, y: 22 });
});

test('physics metadata exposes stable setting ids with dictionary names', () => {
  assert.deepEqual(
    physicsGroupsFromJson({
      Meta: {
        PhysicsDictionary: [
          { Id: 'scarf', Name: 'Scarf' },
          { Id: 'hair', Name: 'Hair' },
        ],
      },
      PhysicsSettings: [{ Id: 'hair' }, { Id: 'scarf' }],
    }),
    [
      { id: 'hair', name: 'Hair' },
      { id: 'scarf', name: 'Scarf' },
    ],
  );
});
