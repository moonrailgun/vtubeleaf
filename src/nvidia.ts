import { clamp, type Face } from './state.ts';

// NVIDIA AR SDK 1.1 FaceExpressions: 53 coefficients and an x/y/z/w quaternion.
// Keep the protocol strict: a changed SDK layout must not silently drive the wrong parameter.
export function fromNvidia(value: unknown): Face | null {
  if (!value || typeof value !== 'object') return null;
  const { detected, rotation, expressions } = value as Record<string, unknown>;
  if (
    detected !== true ||
    !Array.isArray(rotation) ||
    rotation.length !== 4 ||
    !rotation.every(Number.isFinite) ||
    !Array.isArray(expressions) ||
    expressions.length !== 53 ||
    !expressions.every(Number.isFinite)
  )
    return null;
  const norm = Math.hypot(...rotation);
  if (norm < 0.5 || norm > 1.5) return null;
  const [x, y, z, w] = rotation.map((v: number) => v / norm);
  const score = (i: number) => clamp(expressions[i], 0, 1);
  const degrees = 180 / Math.PI;
  return {
    yaw: Math.asin(clamp(2 * (w * y - z * x), -1, 1)) * degrees,
    pitch: -Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)) * degrees,
    roll: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)) * degrees,
    eyeLeft: 1 - score(10),
    eyeRight: 1 - score(11),
    mouthOpen: score(26),
    mouthSmile: (score(45) + score(46)) / 2,
    gazeX: (score(16) - score(14) + score(15) - score(17)) / 2,
    gazeY: (score(18) + score(19) - score(12) - score(13)) / 2,
    browLeft: clamp(score(2) + score(4) - score(0), -1, 1),
    browRight: clamp(score(3) + score(5) - score(1), -1, 1),
    mouthX: score(40) - score(34),
    cheekPuff: (score(6) + score(7)) / 2,
  };
}
