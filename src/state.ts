export type UpperBody = {
  bodyYaw?: number;
  bodyPitch?: number;
  bodyRoll?: number;
  armLeft?: number;
  armRight?: number;
  elbowLeft?: number;
  elbowRight?: number;
};

export type Face = UpperBody & {
  yaw: number;
  pitch: number;
  roll: number;
  eyeLeft: number;
  eyeRight: number;
  mouthOpen: number;
  mouthSmile: number;
  gazeX?: number;
  gazeY?: number;
  browLeft?: number;
  browRight?: number;
  mouthX?: number;
  positionX?: number;
  positionY?: number;
  positionZ?: number;
};

export type FaceKey = keyof Face;

export const faceSources: Record<FaceKey, string> = {
  yaw: '左右转头',
  pitch: '上下点头',
  roll: '头部倾斜',
  eyeLeft: '左眼开合',
  eyeRight: '右眼开合',
  mouthOpen: '嘴部开合',
  mouthSmile: '微笑',
  gazeX: '视线左右',
  gazeY: '视线上下',
  browLeft: '左眉升降',
  browRight: '右眉升降',
  mouthX: '嘴部左右',
  positionX: '头部左右位移',
  positionY: '头部上下位移',
  positionZ: '头部前后位移',
  bodyYaw: '身体左右转动',
  bodyPitch: '身体前后倾斜',
  bodyRoll: '身体左右倾斜',
  armLeft: '左上臂抬起',
  armRight: '右上臂抬起',
  elbowLeft: '左肘弯曲',
  elbowRight: '右肘弯曲',
};

export type Mapping = {
  source: FaceKey;
  inputMin: number;
  inputMax: number;
  outputMin: number;
  outputMax: number;
  smoothing: number;
  enabled: boolean;
};

export type ModelProfile = {
  motionMirror: boolean;
  sensitivity: number;
  eyeSensitivity: number;
  mouthSensitivity: number;
  headSmooth: number;
  eyeSmooth: number;
  mouthSmooth: number;
  lostDelay: number;
  zoom: number;
  x: number;
  y: number;
  neutral: Face | null;
  mappings: Record<string, Mapping>;
  autoBlink: boolean;
  idleMotion: string;
  hotkeys: Record<string, string>;
};

export type Settings = ModelProfile & {
  engine: 'mediapipe' | 'openseeface';
  deviceId: string;
  previewMirror: boolean;
  upperBody: boolean;
  background: string;
  modelPath: string;
  recentModels: { name: string; path: string }[];
  port: number;
  camera: number;
  pythonPath: string;
  scriptPath: string;
  profiles: Record<string, ModelProfile>;
};

export const NEUTRAL: Face = {
  yaw: 0,
  pitch: 0,
  roll: 0,
  eyeLeft: 1,
  eyeRight: 1,
  mouthOpen: 0,
  mouthSmile: 0,
};

export const defaults: Settings = {
  engine: 'mediapipe',
  deviceId: '',
  previewMirror: true,
  upperBody: true,
  motionMirror: true,
  sensitivity: 1,
  eyeSensitivity: 1,
  mouthSensitivity: 1.4,
  headSmooth: 0.12,
  eyeSmooth: 0.035,
  mouthSmooth: 0.06,
  lostDelay: 0.5,
  zoom: 1,
  x: 0,
  y: 0,
  background: '#e5ebdd',
  modelPath: '',
  recentModels: [],
  port: 11573,
  camera: 0,
  pythonPath: '',
  scriptPath: '',
  neutral: null,
  mappings: {},
  profiles: {},
  autoBlink: false,
  idleMotion: '',
  hotkeys: {},
};

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const safeKey = (key: string) => !!key && !['__proto__', 'prototype', 'constructor'].includes(key);

const faceKeys = Object.keys(faceSources) as FaceKey[];

const profileRanges = {
  sensitivity: [0.2, 3],
  eyeSensitivity: [0.3, 2],
  mouthSensitivity: [0.2, 3],
  headSmooth: [0, 0.5],
  eyeSmooth: [0, 0.3],
  mouthSmooth: [0, 0.4],
  lostDelay: [0.1, 2],
  zoom: [0.25, 2.5],
  x: [-0.8, 0.8],
  y: [-0.8, 0.8],
} as const;

export function isFace(v: unknown): v is Face {
  return (
    record(v) &&
    Object.keys(NEUTRAL).every((k) => Object.hasOwn(v, k) && Number.isFinite(v[k])) &&
    faceKeys.every((k) => !Object.hasOwn(v, k) || Number.isFinite(v[k]))
  );
}

function readMapping(v: unknown): Mapping | undefined {
  if (
    !record(v) ||
    typeof v.source !== 'string' ||
    !Object.hasOwn(faceSources, v.source) ||
    typeof v.enabled !== 'boolean'
  )
    return;

  const { inputMin, inputMax, outputMin, outputMax, smoothing } = v;
  if (
    ![inputMin, inputMax, outputMin, outputMax, smoothing].every(
      (n) => typeof n === 'number' && Number.isFinite(n),
    )
  )
    return;

  const m = v as unknown as Mapping;
  if (
    m.inputMin >= m.inputMax ||
    Math.abs(m.inputMin) > 1000 ||
    Math.abs(m.inputMax) > 1000 ||
    Math.abs(m.outputMin) > 1e6 ||
    Math.abs(m.outputMax) > 1e6
  )
    return;

  return {
    source: m.source,
    inputMin: m.inputMin,
    inputMax: m.inputMax,
    outputMin: m.outputMin,
    outputMax: m.outputMax,
    smoothing: clamp(m.smoothing, 0, 0.5),
    enabled: m.enabled,
  };
}

function readProfile(v: unknown): ModelProfile {
  const p: ModelProfile = {
    motionMirror: defaults.motionMirror,
    sensitivity: defaults.sensitivity,
    eyeSensitivity: defaults.eyeSensitivity,
    mouthSensitivity: defaults.mouthSensitivity,
    headSmooth: defaults.headSmooth,
    eyeSmooth: defaults.eyeSmooth,
    mouthSmooth: defaults.mouthSmooth,
    lostDelay: defaults.lostDelay,
    zoom: defaults.zoom,
    x: defaults.x,
    y: defaults.y,
    neutral: null,
    mappings: {},
    autoBlink: defaults.autoBlink,
    idleMotion: '',
    hotkeys: {},
  };

  if (!record(v)) return p;

  for (const key of ['motionMirror', 'autoBlink'] as const)
    if (typeof v[key] === 'boolean') p[key] = v[key];
  for (const key of Object.keys(profileRanges) as (keyof typeof profileRanges)[])
    if (typeof v[key] === 'number' && Number.isFinite(v[key]))
      p[key] = clamp(v[key], profileRanges[key][0], profileRanges[key][1]);

  if (isFace(v.neutral))
    p.neutral = Object.fromEntries(
      faceKeys.filter((k) => Object.hasOwn(v.neutral!, k)).map((k) => [k, (v.neutral as Face)[k]]),
    ) as Face;
  if (typeof v.idleMotion === 'string' && v.idleMotion.length <= 512) p.idleMotion = v.idleMotion;

  if (record(v.mappings))
    for (const [id, raw] of Object.entries(v.mappings).slice(0, 512)) {
      const mapping = readMapping(raw);
      if (safeKey(id) && id.length <= 512 && mapping) p.mappings[id] = mapping;
    }

  if (record(v.hotkeys))
    for (const [id, shortcut] of Object.entries(v.hotkeys).slice(0, 128))
      if (safeKey(id) && id.length <= 512 && typeof shortcut === 'string' && shortcut.length <= 128)
        p.hotkeys[id] = shortcut;

  return p;
}

export function readSettings(value: unknown): Settings {
  const s = structuredClone(defaults);
  if (!record(value)) return s;

  const v = value;
  Object.assign(s, readProfile(v));
  for (const key of ['deviceId', 'modelPath', 'pythonPath', 'scriptPath'] as const)
    if (typeof v[key] === 'string' && v[key].length < 4096) s[key] = v[key];
  if (typeof v.previewMirror === 'boolean') s.previewMirror = v.previewMirror;
  if (typeof v.upperBody === 'boolean') s.upperBody = v.upperBody;
  if (v.engine === 'openseeface') s.engine = v.engine;
  if (typeof v.port === 'number' && Number.isFinite(v.port))
    s.port = Math.round(clamp(v.port, 1024, 65535));
  if (typeof v.camera === 'number' && Number.isFinite(v.camera))
    s.camera = Math.round(clamp(v.camera, 0, 32));
  if (typeof v.background === 'string' && /^#[0-9a-f]{6}$/i.test(v.background))
    s.background = v.background;

  if (Array.isArray(v.recentModels))
    s.recentModels = v.recentModels
      .filter(
        (m): m is { name: string; path: string } =>
          record(m) &&
          typeof m.name === 'string' &&
          m.name.length < 200 &&
          typeof m.path === 'string' &&
          m.path.length < 4096,
      )
      .slice(0, 5)
      .map((m) => ({ name: m.name, path: m.path }));

  if (record(v.profiles))
    for (const [path, profile] of Object.entries(v.profiles).slice(-64))
      if (safeKey(path) && path.length < 4096 && record(profile))
        s.profiles[path] = readProfile(profile);

  return s;
}

export function rememberProfile(s: Settings): void {
  if (!safeKey(s.modelPath) || s.modelPath.length >= 4096) return;

  // Keep a bounded, recent set; active edits are copied instead of shared across models.
  s.profiles = Object.fromEntries(
    Object.entries(s.profiles)
      .filter(([path]) => path !== s.modelPath && safeKey(path))
      .slice(-63),
  );
  s.profiles[s.modelPath] = readProfile(s);
}

export function switchProfile(settings: Settings, path: string): Settings {
  const s = readSettings(settings);
  if (path === s.modelPath || path.length >= 4096 || (path && !safeKey(path))) return s;

  rememberProfile(s);
  s.modelPath = path;
  Object.assign(s, readProfile(Object.hasOwn(s.profiles, path) ? s.profiles[path] : null));

  return s;
}

export type Parameter = { id: string; min: number; max: number; default: number };

const parameterSources: Record<string, FaceKey> = {
  ParamAngleX: 'yaw',
  ParamAngleY: 'pitch',
  ParamAngleZ: 'roll',
  ParamEyeLOpen: 'eyeLeft',
  ParamEyeROpen: 'eyeRight',
  ParamMouthOpenY: 'mouthOpen',
  ParamMouthForm: 'mouthSmile',
  ParamEyeBallX: 'gazeX',
  ParamEyeBallY: 'gazeY',
  ParamBrowLY: 'browLeft',
  ParamBrowRY: 'browRight',
  ParamMouthX: 'mouthX',
  ParamBodyAngleX: 'bodyYaw',
  ParamBodyAngleY: 'bodyPitch',
  ParamBodyAngleZ: 'bodyRoll',
};

export const parameterNames: Record<string, string> = Object.fromEntries(
  Object.entries(parameterSources).map(([id, source]) => [id, faceSources[source]]),
);

const bodyFallback = { bodyYaw: 'yaw', bodyPitch: 'pitch', bodyRoll: 'roll' } as const;
const isBodySource = (source: FaceKey) =>
  source.startsWith('body') || source.startsWith('arm') || source.startsWith('elbow');

const unipolar = (source: FaceKey) =>
  source === 'eyeLeft' || source === 'eyeRight' || source === 'mouthOpen';

const sourceSmoothing = (source: FaceKey, s: Settings) =>
  source.startsWith('eye') || source.startsWith('gaze')
    ? s.eyeSmooth
    : source.startsWith('mouth')
      ? s.mouthSmooth
      : s.headSmooth;

const validParameter = (p: Parameter) =>
  safeKey(p.id) && [p.min, p.max, p.default].every(Number.isFinite) && p.min <= p.max;

export function defaultMapping(p: Parameter, s: Settings): Mapping | undefined {
  if (!validParameter(p) || !Object.hasOwn(parameterSources, p.id)) return;

  const source = parameterSources[p.id];

  return {
    source,
    inputMin: unipolar(source) ? 0 : -1,
    inputMax: 1,
    outputMin: p.min,
    outputMax: p.max,
    smoothing: sourceSmoothing(source, s),
    enabled: true,
  };
}

export function normalizedFace(face: Face, s: Settings): Partial<Record<FaceKey, number>> {
  const neutral = s.neutral ?? NEUTRAL,
    mirror = s.motionMirror ? -1 : 1;

  const angle = (v: number, n: number) =>
    clamp(((((((v - n + 540) % 360) + 360) % 360) - 180) / 30) * s.sensitivity, -1, 1);
  const open = (v: number, n: number) =>
    clamp(1 - (1 - clamp(v / Math.max(0.2, n), 0, 1)) * s.eyeSensitivity, 0, 1);

  const values: Partial<Record<FaceKey, number>> = {
    yaw: angle(face.yaw, neutral.yaw) * mirror,
    pitch: angle(face.pitch, neutral.pitch),
    roll: angle(face.roll, neutral.roll) * mirror,
    eyeLeft: open(face.eyeLeft, neutral.eyeLeft),
    eyeRight: open(face.eyeRight, neutral.eyeRight),
    mouthOpen: clamp((face.mouthOpen - neutral.mouthOpen) * s.mouthSensitivity, 0, 1),
    mouthSmile: clamp(face.mouthSmile - neutral.mouthSmile, -1, 1),
  };

  for (const key of ['bodyYaw', 'bodyPitch', 'bodyRoll'] as const)
    if (Number.isFinite(face[key]))
      values[key] = angle(face[key]!, neutral[key] ?? 0) * (key === 'bodyPitch' ? 1 : mirror);
  for (const [left, right] of [
    ['armLeft', 'armRight'],
    ['elbowLeft', 'elbowRight'],
  ] as const) {
    if (Number.isFinite(face[left]))
      values[s.motionMirror ? right : left] = clamp(face[left]! - (neutral[left] ?? 0), -1, 1);
    if (Number.isFinite(face[right]))
      values[s.motionMirror ? left : right] = clamp(face[right]! - (neutral[right] ?? 0), -1, 1);
  }

  for (const key of [
    'gazeX',
    'gazeY',
    'browLeft',
    'browRight',
    'mouthX',
    'positionX',
    'positionY',
    'positionZ',
  ] as const) {
    if (!Number.isFinite(face[key])) continue;
    const value = (face[key]! - (neutral[key] ?? 0)) * (key.endsWith('X') ? mirror : 1);
    values[key] = key.startsWith('position') ? value : clamp(value, -1, 1);
  }

  return values;
}

export class FaceMapper {
  private current: Record<string, number> = {};

  reset() {
    this.current = {};
  }

  map(face: Face | null, parameters: Parameter[], s: Settings, dt: number): Record<string, number> {
    const values = face ? normalizedFace(face, s) : null;
    const next: Record<string, number> = {};

    for (const p of parameters) {
      if (!validParameter(p)) continue;

      const custom = Object.hasOwn(s.mappings, p.id) ? s.mappings[p.id] : undefined;
      const mapping = custom ?? defaultMapping(p, s);
      if (!mapping?.enabled) continue;

      let value = values?.[mapping.source];
      const missingBody = isBodySource(mapping.source) && value === undefined;
      if (missingBody && values && !custom && Object.hasOwn(bodyFallback, mapping.source))
        value = values[bodyFallback[mapping.source as keyof typeof bodyFallback]]! * 0.3;
      if (
        values &&
        (value === undefined || !Number.isFinite(value)) &&
        !(missingBody && Object.hasOwn(this.current, p.id))
      )
        continue;
      if (!face && !Object.hasOwn(NEUTRAL, mapping.source) && !Object.hasOwn(this.current, p.id))
        continue;
      if (!face && s.autoBlink && (mapping.source === 'eyeLeft' || mapping.source === 'eyeRight'))
        continue;

      let target = p.default;
      if (value !== undefined) {
        if (!custom && !unipolar(mapping.source))
          target =
            p.default +
            value * (value >= 0 ? mapping.outputMax - p.default : p.default - mapping.outputMin);
        else
          target =
            mapping.outputMin +
            clamp((value - mapping.inputMin) / (mapping.inputMax - mapping.inputMin), 0, 1) *
              (mapping.outputMax - mapping.outputMin);
      }

      const tau = !face || missingBody ? Math.max(mapping.smoothing, 0.12) : mapping.smoothing;
      const alpha = tau <= 0 ? 1 : 1 - Math.exp(-clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1) / tau);
      const old = this.current[p.id] ?? clamp(p.default, p.min, p.max);
      next[p.id] = clamp(old + (clamp(target, p.min, p.max) - old) * alpha, p.min, p.max);
    }

    this.current = next;
    return next;
  }
}

export function fromMediaPipe(
  shapes: { categoryName: string; score: number }[],
  m: number[],
): Face | null {
  if (m.length !== 16 || !m.every(Number.isFinite)) return null;

  const b = Object.fromEntries(shapes.map((s) => [s.categoryName, s.score]));
  const score = (name: string) => clamp(Number.isFinite(b[name]) ? b[name] : 0, 0, 1);
  const degrees = 180 / Math.PI;

  return {
    yaw: Math.asin(clamp(-m[2], -1, 1)) * degrees,
    // Live2D AngleY is positive when looking up; MediaPipe's X rotation is the opposite.
    pitch: -Math.atan2(m[6], m[10]) * degrees,
    roll: Math.atan2(m[1], m[0]) * degrees,
    eyeLeft: 1 - score('eyeBlinkLeft'),
    eyeRight: 1 - score('eyeBlinkRight'),
    mouthOpen: score('jawOpen'),
    mouthSmile: (score('mouthSmileLeft') + score('mouthSmileRight')) / 2,
    gazeX:
      (score('eyeLookOutLeft') -
        score('eyeLookInLeft') +
        score('eyeLookInRight') -
        score('eyeLookOutRight')) /
      2,
    gazeY:
      (score('eyeLookUpLeft') +
        score('eyeLookUpRight') -
        score('eyeLookDownLeft') -
        score('eyeLookDownRight')) /
      2,
    browLeft: clamp(score('browInnerUp') + score('browOuterUpLeft') - score('browDownLeft'), -1, 1),
    browRight: clamp(
      score('browInnerUp') + score('browOuterUpRight') - score('browDownRight'),
      -1,
      1,
    ),
    mouthX: score('mouthRight') - score('mouthLeft'),
    // MediaPipe uses centimeters; OpenSeeFace uses template units. Calibrate after changing engines.
    positionX: m[12] / 10,
    positionY: m[13] / 10,
    positionZ: m[14] / 10,
  };
}

type PosePoint = { x: number; y: number; z: number; visibility: number };

export function visiblePosePoint(p: PosePoint | undefined): p is PosePoint {
  return (
    !!p &&
    [p.x, p.y, p.z, p.visibility].every(Number.isFinite) &&
    p.visibility >= 0.65 &&
    p.x >= 0 &&
    p.x <= 1 &&
    p.y >= 0 &&
    p.y <= 1
  );
}

export function fromPose(image: PosePoint[], world: PosePoint[]): UpperBody {
  const valid = (...ids: number[]) =>
    ids.every(
      (id) =>
        visiblePosePoint(image[id]) &&
        world[id] &&
        [world[id].x, world[id].y, world[id].z].every(Number.isFinite),
    );
  if (!valid(11, 12) || Math.hypot(image[11].x - image[12].x, image[11].y - image[12].y) < 0.06)
    return {};
  const left = world[11],
    right = world[12];
  const dx = left.x - right.x,
    dy = left.y - right.y,
    dz = left.z - right.z;
  if (Math.hypot(dx, dy, dz) < 0.05) return {};
  const degrees = 180 / Math.PI;
  const body: UpperBody = {
    bodyYaw: clamp(-Math.atan2(dz, dx) * degrees, -90, 90),
    bodyRoll: clamp(-Math.atan2(dy, dx) * degrees, -90, 90),
  };
  // Hips outside the image are model estimates, not evidence of a visible torso.
  if (valid(23, 24)) {
    const height = (world[23].y + world[24].y - left.y - right.y) / 2;
    const depth = (left.z + right.z - world[23].z - world[24].z) / 2;
    if (height > 0.05) body.bodyPitch = clamp(-Math.atan2(depth, height) * degrees, -90, 90);
  }
  for (const [shoulder, elbow, wrist, armKey, elbowKey] of [
    [11, 13, 15, 'armLeft', 'elbowLeft'],
    [12, 14, 16, 'armRight', 'elbowRight'],
  ] as const) {
    if (!valid(shoulder, elbow)) continue;
    const a = world[shoulder],
      b = world[elbow];
    const x = b.x - a.x,
      y = b.y - a.y,
      z = b.z - a.z;
    const length = Math.hypot(x, y, z);
    if (length < 0.03) continue;
    body[armKey] = Math.acos(clamp(y / length, -1, 1)) / Math.PI;
    if (!valid(wrist)) continue;
    const c = world[wrist];
    const cx = c.x - b.x,
      cy = c.y - b.y,
      cz = c.z - b.z;
    const forearm = Math.hypot(cx, cy, cz);
    if (forearm >= 0.03)
      body[elbowKey] =
        Math.acos(clamp((x * cx + y * cy + z * cz) / (length * forearm), -1, 1)) / Math.PI;
  }
  return body;
}
