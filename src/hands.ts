import type { Key } from './i18n.ts';

export type HandSignals = {
  handLeftFound?: number;
  handLeftX?: number;
  handLeftY?: number;
  handLeftZ?: number;
  handLeftAngle?: number;
  handLeftOpen?: number;
  handLeftThumb?: number;
  handLeftIndex?: number;
  handLeftMiddle?: number;
  handLeftRing?: number;
  handLeftLittle?: number;
  handRightFound?: number;
  handRightX?: number;
  handRightY?: number;
  handRightZ?: number;
  handRightAngle?: number;
  handRightOpen?: number;
  handRightThumb?: number;
  handRightIndex?: number;
  handRightMiddle?: number;
  handRightRing?: number;
  handRightLittle?: number;
};

// Values are i18n keys; render them with t().
export const handSources: Record<keyof HandSignals, Key> = {
  handLeftFound: 'face.handLeftFound',
  handLeftX: 'face.handLeftX',
  handLeftY: 'face.handLeftY',
  handLeftZ: 'face.handLeftZ',
  handLeftAngle: 'face.handLeftAngle',
  handLeftOpen: 'face.handLeftOpen',
  handLeftThumb: 'face.handLeftThumb',
  handLeftIndex: 'face.handLeftIndex',
  handLeftMiddle: 'face.handLeftMiddle',
  handLeftRing: 'face.handLeftRing',
  handLeftLittle: 'face.handLeftLittle',
  handRightFound: 'face.handRightFound',
  handRightX: 'face.handRightX',
  handRightY: 'face.handRightY',
  handRightZ: 'face.handRightZ',
  handRightAngle: 'face.handRightAngle',
  handRightOpen: 'face.handRightOpen',
  handRightThumb: 'face.handRightThumb',
  handRightIndex: 'face.handRightIndex',
  handRightMiddle: 'face.handRightMiddle',
  handRightRing: 'face.handRightRing',
  handRightLittle: 'face.handRightLittle',
};

type Point = { x: number; y: number; z?: number };
type Category = { categoryName?: string; displayName?: string; score?: number };
type Side = 'Left' | 'Right';

const clamp = (value: number, low = 0, high = 1) =>
  Math.min(high, Math.max(low, Number.isFinite(value) ? value : 0));
const validPoint = (point: Point | undefined) =>
  !!point &&
  Number.isFinite(point.x) &&
  Number.isFinite(point.y) &&
  (point.z === undefined || Number.isFinite(point.z));
const validHand = (points: readonly Point[] | undefined) =>
  !!points && points.length >= 21 && points.slice(0, 21).every(validPoint);
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));

function straightness(points: readonly Point[], a: number, b: number, c: number) {
  const ab = distance(points[a], points[b]);
  const bc = distance(points[b], points[c]);
  if (ab < 1e-6 || bc < 1e-6) return 0;
  const dot =
    (points[a].x - points[b].x) * (points[c].x - points[b].x) +
    (points[a].y - points[b].y) * (points[c].y - points[b].y) +
    ((points[a].z ?? 0) - (points[b].z ?? 0)) * ((points[c].z ?? 0) - (points[b].z ?? 0));
  const angle = Math.acos(clamp(dot / (ab * bc), -1, 1));
  return clamp((angle - Math.PI / 2) / (Math.PI / 2));
}

function finger(points: readonly Point[], mcp: number, pip: number, dip: number, tip: number) {
  return (straightness(points, mcp, pip, dip) + straightness(points, pip, dip, tip)) / 2;
}

function sideOf(category: Category | undefined): Side | undefined {
  if (!category || !Number.isFinite(category.score) || category.score! < 0.6) return;
  const name = (category.categoryName || category.displayName || '').toLowerCase();
  if (name === 'left') return 'Left';
  if (name === 'right') return 'Right';
}

function signalsFor(
  side: Side,
  normalized: readonly Point[],
  geometry: readonly Point[],
): HandSignals {
  const palm = [0, 5, 9, 13, 17].map((index) => normalized[index]);
  const centerX = palm.reduce((sum, point) => sum + point.x, 0) / palm.length;
  const centerY = palm.reduce((sum, point) => sum + point.y, 0) / palm.length;
  const wrist = normalized[0];
  const middle = normalized[9];
  const fingers = {
    Thumb: finger(geometry, 1, 2, 3, 4),
    Index: finger(geometry, 5, 6, 7, 8),
    Middle: finger(geometry, 9, 10, 11, 12),
    Ring: finger(geometry, 13, 14, 15, 16),
    Little: finger(geometry, 17, 18, 19, 20),
  };
  const prefix = `hand${side}`;
  return {
    [`${prefix}Found`]: 1,
    [`${prefix}X`]: clamp((centerX - 0.5) * 2, -1, 1),
    [`${prefix}Y`]: clamp((0.5 - centerY) * 2, -1, 1),
    // MediaPipe's hand Z is wrist-relative, so apparent palm size is the usable camera-depth cue.
    [`${prefix}Z`]: clamp((distance(wrist, middle) - 0.2) * 5, -1, 1),
    [`${prefix}Angle`]: clamp(Math.atan2(middle.x - wrist.x, wrist.y - middle.y) / Math.PI, -1, 1),
    [`${prefix}Open`]: Object.values(fingers).reduce((sum, value) => sum + value, 0) / 5,
    ...Object.fromEntries(
      Object.entries(fingers).map(([name, value]) => [`${prefix}${name}`, value]),
    ),
  };
}

export function fromHands(
  landmarks: readonly (readonly Point[])[],
  worldLandmarks: readonly (readonly Point[])[],
  handedness: readonly (readonly Category[])[],
): HandSignals {
  const output: HandSignals = { handLeftFound: 0, handRightFound: 0 };
  const confidence: Partial<Record<Side, number>> = {};
  for (let index = 0; index < landmarks.length; index++) {
    const normalized = landmarks[index];
    const category = handedness[index]?.[0];
    const side = sideOf(category);
    if (!side || !validHand(normalized) || (confidence[side] ?? -1) >= category.score!) continue;
    const world = worldLandmarks[index];
    const geometry = validHand(world) ? world : normalized;
    Object.assign(output, signalsFor(side, normalized, geometry));
    confidence[side] = category.score!;
  }
  return output;
}
