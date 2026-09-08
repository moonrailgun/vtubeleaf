export type PhysicsGroup = { id: string; name: string };

type PhysicsControls = {
  physicsStrength: number;
  physicsWind: number;
  physicsFps: number;
  physicsGroups: Record<string, number>;
};

const particleVectorKeys = [
  'position',
  'lastPosition',
  'lastGravity',
  'force',
  'velocity',
] as const;

type PhysicsParticle = Record<(typeof particleVectorKeys)[number], { x: number; y: number }>;

type PhysicsEvaluator<Model = unknown> = {
  evaluate(model: Model, deltaTimeSeconds: number): void;
  getOption(): { wind: { x: number; y: number } };
  _physicsRig: {
    settings: { baseOutputIndex: number; outputCount: number }[];
    outputs: {
      weight: number;
      translationScale: { x: number; y: number };
      angleScale: number;
    }[];
    particles: PhysicsParticle[];
  };
};

const clamp = (value: number, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

export function physicsGroupsFromJson(json: unknown): PhysicsGroup[] {
  if (!json || typeof json !== 'object') return [];
  const document = json as {
    Meta?: { PhysicsDictionary?: { Id?: unknown; Name?: unknown }[] };
    PhysicsSettings?: { Id?: unknown }[];
  };
  const names = new Map(
    (document.Meta?.PhysicsDictionary ?? [])
      .filter((entry) => typeof entry.Id === 'string')
      .map((entry) => [entry.Id as string, entry.Name] as const),
  );
  return (document.PhysicsSettings ?? []).flatMap((setting) => {
    if (typeof setting.Id !== 'string') return [];
    const name = names.get(setting.Id);
    return [{ id: setting.Id, name: typeof name === 'string' && name ? name : setting.Id }];
  });
}

export function wrapPhysics<Model>(
  physics: PhysicsEvaluator<Model>,
  groupIds: string[],
  readControls: () => PhysicsControls | undefined,
) {
  const evaluate = physics.evaluate.bind(physics);
  let accumulator = 0;
  let previousFps = 0;

  physics.evaluate = (model, deltaTimeSeconds) => {
    const controls = readControls();
    const strength = clamp(controls?.physicsStrength ?? 1, 0, 2, 1);
    const fps =
      controls?.physicsFps === 30 || controls?.physicsFps === 60 ? controls.physicsFps : 0;
    const outputs = physics._physicsRig.outputs.map((output) => ({
      weight: output.weight,
      translationX: output.translationScale.x,
      translationY: output.translationScale.y,
      angle: output.angleScale,
    }));
    const options = physics.getOption();
    const wind = options.wind.x;

    for (let index = 0; index < physics._physicsRig.settings.length; index++) {
      const setting = physics._physicsRig.settings[index];
      const groupStrength = clamp(controls?.physicsGroups[groupIds[index]] ?? 1, 0, 2, 1);
      for (let outputIndex = 0; outputIndex < setting.outputCount; outputIndex++) {
        const output = physics._physicsRig.outputs[setting.baseOutputIndex + outputIndex];
        const scaledWeight = output.weight * strength * groupStrength;
        const outputScale = Math.max(1, scaledWeight / 100);
        output.weight = Math.min(100, scaledWeight);
        output.translationScale.x *= outputScale;
        output.translationScale.y *= outputScale;
        output.angleScale *= outputScale;
      }
    }
    options.wind.x = clamp(controls?.physicsWind ?? 0, -2, 2, 0);

    try {
      const delta = clamp(deltaTimeSeconds, 0, 0.1, 0);
      if (!fps) {
        accumulator = 0;
        previousFps = 0;
        evaluate(model, delta);
        return;
      }
      if (fps !== previousFps) accumulator = 0;
      previousFps = fps;
      const step = 1 / fps;
      accumulator = Math.min(accumulator + delta, step * 4);
      const steps = Math.min(4, Math.floor((accumulator + 1e-9) / step));
      for (let index = 0; index < steps; index++) evaluate(model, step);
      if (!steps) {
        const particles = physics._physicsRig.particles.map((particle) => ({
          particle,
          vectors: particleVectorKeys.map((key) => ({
            key,
            value: particle[key],
            x: particle[key].x,
            y: particle[key].y,
          })),
        }));
        try {
          evaluate(model, 0);
        } finally {
          for (const state of particles) {
            for (const vector of state.vectors) {
              vector.value.x = vector.x;
              vector.value.y = vector.y;
              state.particle[vector.key] = vector.value;
            }
          }
        }
      }
      accumulator -= steps * step;
    } finally {
      physics._physicsRig.outputs.forEach((output, index) => {
        output.weight = outputs[index].weight;
        output.translationScale.x = outputs[index].translationX;
        output.translationScale.y = outputs[index].translationY;
        output.angleScale = outputs[index].angle;
      });
      options.wind.x = wind;
    }
  };
}
