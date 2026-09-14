import { readComposition, readScenes, type Composition, type Scene } from './scenes.ts';
import type { VoiceFrame, VoiceTemplates } from './lipsync.ts';
import { handSources, type HandSignals } from './hands.ts';

export type UpperBody = {
  bodyYaw?: number;
  bodyPitch?: number;
  bodyRoll?: number;
  armLeft?: number;
  armRight?: number;
  elbowLeft?: number;
  elbowRight?: number;
};

export type Face = UpperBody &
  Partial<VoiceFrame> &
  HandSignals & {
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
    brows?: number;
    cheekPuff?: number;
    tongueOut?: number;
    breath?: number;
    positionX?: number;
    positionY?: number;
    positionZ?: number;
  };

export type FaceKey = keyof Face;

export const faceSources: Record<FaceKey, string> = {
  ...handSources,
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
  brows: '双眉升降',
  cheekPuff: '鼓嘴（NVIDIA）',
  tongueOut: '吐舌（当前引擎无信号，可手动控制）',
  breath: '自动呼吸',
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
  voiceVolume: '声音音量',
  voiceA: '声音 A',
  voiceI: '声音 I',
  voiceU: '声音 U',
  voiceE: '声音 E',
  voiceO: '声音 O',
};

export type Mapping = {
  source: FaceKey;
  inputMin: number;
  inputMax: number;
  outputMin: number;
  outputMax: number;
  smoothing: number;
  enabled: boolean;
  clamp?: boolean;
};

export type HotkeyOptions = {
  scope: 'global' | 'local';
  release?: boolean;
  seconds?: number;
  motionMode?: 'once' | 'hold';
  fadeSeconds?: number;
};

export type ModelProfile = {
  motionMirror: boolean;
  sensitivity: number;
  eyeSensitivity: number;
  eyeClosedThreshold: number;
  eyeClosedLeft: number | null;
  eyeClosedRight: number | null;
  eyeLink: 'off' | 'always' | 'side';
  eyeLinkAngle: number;
  mouthSensitivity: number;
  headSmooth: number;
  eyeSmooth: number;
  mouthSmooth: number;
  lostDelay: number;
  lostMode: 'neutral' | 'hold';
  lipSyncMode: 'off' | 'volume' | 'vowels';
  lipSyncBlend: number;
  voiceTemplates: VoiceTemplates;
  physicsStrength: number;
  physicsWind: number;
  physicsFps: 0 | 30 | 60;
  physicsGroups: Record<string, number>;
  rotation: number;
  modelVisible: boolean;
  zoom: number;
  x: number;
  y: number;
  neutral: Face | null;
  mappings: Record<string, Mapping>;
  autoBlink: boolean;
  idleMotion: string;
  lostIdleMotion: string;
  motionSound: boolean;
  parameterOverrides: Record<string, number>;
  defaultParameterOverrides: Record<string, number>;
  defaultExpressions: string[];
  useKeyboardHotkeys: boolean;
  hotkeys: Record<string, string>;
  hotkeyOptions: Record<string, HotkeyOptions>;
  vtsImportReport: string[];
};

export type Settings = ModelProfile & {
  autoCheckUpdates: boolean;
  skippedUpdateVersion: string;
  engine: 'mediapipe' | 'openseeface' | 'nvidia';
  deviceId: string;
  previewMirror: boolean;
  previewCamera: boolean;
  upperBody: boolean;
  handTracking: boolean;
  cameraResolution: '360p' | '720p' | '1080p';
  trackingFps: 15 | 24 | 30 | 60;
  bodyFps: 5 | 10 | 15 | 30;
  handFps: 5 | 10 | 15 | 30;
  renderFps: 30 | 60;
  micDeviceId: string;
  micGain: number;
  micNoiseGate: number;
  composition: Composition;
  scenes: Scene[];
  globalHotkeys: Record<string, string>;
  background: string;
  modelPath: string;
  recentModels: { name: string; path: string }[];
  port: number;
  camera: number;
  pythonPath: string;
  scriptPath: string;
  nvidiaPath: string;
  nvidiaModelDir: string;
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
  autoCheckUpdates: true,
  skippedUpdateVersion: '',
  engine: 'mediapipe',
  deviceId: '',
  previewMirror: true,
  previewCamera: false,
  upperBody: true,
  handTracking: false,
  cameraResolution: '720p',
  trackingFps: 30,
  bodyFps: 10,
  handFps: 10,
  renderFps: 30,
  micDeviceId: '',
  micGain: 4,
  micNoiseGate: 0.02,
  motionMirror: true,
  sensitivity: 1,
  eyeSensitivity: 1,
  eyeClosedThreshold: 0.25,
  eyeClosedLeft: null,
  eyeClosedRight: null,
  eyeLink: 'side',
  eyeLinkAngle: 25,
  mouthSensitivity: 1.4,
  headSmooth: 0.12,
  eyeSmooth: 0.035,
  mouthSmooth: 0.06,
  lostDelay: 0.5,
  lostMode: 'neutral',
  lipSyncMode: 'off',
  lipSyncBlend: 1,
  voiceTemplates: {},
  physicsStrength: 1,
  physicsWind: 0,
  physicsFps: 0,
  physicsGroups: {},
  rotation: 0,
  modelVisible: true,
  zoom: 1,
  x: 0,
  y: 0,
  composition: { backgroundImage: '', items: [] },
  scenes: [],
  globalHotkeys: {},
  background: '#e5ebdd',
  modelPath: '',
  recentModels: [],
  port: 11573,
  camera: 0,
  pythonPath: '',
  scriptPath: '',
  nvidiaPath: '',
  nvidiaModelDir: '',
  neutral: null,
  mappings: {},
  profiles: {},
  autoBlink: false,
  idleMotion: '',
  lostIdleMotion: '',
  motionSound: true,
  parameterOverrides: {},
  defaultParameterOverrides: {},
  defaultExpressions: [],
  useKeyboardHotkeys: true,
  hotkeys: {},
  hotkeyOptions: {},
  vtsImportReport: [],
};

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

const safeKey = (key: string) => !!key && !['__proto__', 'prototype', 'constructor'].includes(key);

const faceKeys = Object.keys(faceSources) as FaceKey[];

const profileRanges = {
  sensitivity: [0.2, 3],
  eyeSensitivity: [0.3, 2],
  eyeClosedThreshold: [0, 0.6],
  eyeLinkAngle: [10, 60],
  lipSyncBlend: [0, 1],
  physicsStrength: [0, 2],
  physicsWind: [-2, 2],
  mouthSensitivity: [0.2, 3],
  headSmooth: [0, 0.5],
  eyeSmooth: [0, 0.3],
  mouthSmooth: [0, 0.4],
  lostDelay: [0.1, 2],
  rotation: [-180, 180],
  zoom: [0.25, 10],
  x: [-0.8, 0.8],
  y: [-3, 3],
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
    ...(m.clamp === false ? { clamp: false } : {}),
  };
}

function readProfile(v: unknown): ModelProfile {
  const p: ModelProfile = {
    motionMirror: defaults.motionMirror,
    sensitivity: defaults.sensitivity,
    eyeSensitivity: defaults.eyeSensitivity,
    eyeClosedThreshold: defaults.eyeClosedThreshold,
    eyeClosedLeft: null,
    eyeClosedRight: null,
    eyeLink: defaults.eyeLink,
    eyeLinkAngle: defaults.eyeLinkAngle,
    mouthSensitivity: defaults.mouthSensitivity,
    headSmooth: defaults.headSmooth,
    eyeSmooth: defaults.eyeSmooth,
    mouthSmooth: defaults.mouthSmooth,
    lostDelay: defaults.lostDelay,
    lostMode: defaults.lostMode,
    lipSyncMode: defaults.lipSyncMode,
    lipSyncBlend: defaults.lipSyncBlend,
    voiceTemplates: {},
    physicsStrength: defaults.physicsStrength,
    physicsWind: defaults.physicsWind,
    physicsFps: defaults.physicsFps,
    physicsGroups: {},
    rotation: defaults.rotation,
    modelVisible: defaults.modelVisible,
    zoom: defaults.zoom,
    x: defaults.x,
    y: defaults.y,
    neutral: null,
    mappings: {},
    autoBlink: defaults.autoBlink,
    idleMotion: '',
    lostIdleMotion: '',
    motionSound: true,
    parameterOverrides: {},
    defaultParameterOverrides: {},
    defaultExpressions: [],
    useKeyboardHotkeys: true,
    hotkeys: {},
    hotkeyOptions: {},
    vtsImportReport: [],
  };

  if (!record(v)) return p;

  if (Array.isArray(v.vtsImportReport))
    p.vtsImportReport = v.vtsImportReport
      .filter((item): item is string => typeof item === 'string')
      .slice(0, 1024)
      .map((item) => item.slice(0, 600));

  if (v.eyeLink === 'off' || v.eyeLink === 'always' || v.eyeLink === 'side') p.eyeLink = v.eyeLink;
  if (v.lostMode === 'hold') p.lostMode = v.lostMode;
  if (v.lipSyncMode === 'volume' || v.lipSyncMode === 'vowels') p.lipSyncMode = v.lipSyncMode;
  if (v.physicsFps === 30 || v.physicsFps === 60) p.physicsFps = v.physicsFps;
  for (const key of ['eyeClosedLeft', 'eyeClosedRight'] as const)
    if (typeof v[key] === 'number' && Number.isFinite(v[key])) p[key] = clamp(v[key], 0, 0.6);
  if (record(v.physicsGroups))
    for (const [id, weight] of Object.entries(v.physicsGroups).slice(0, 128))
      if (safeKey(id) && id.length <= 512 && typeof weight === 'number' && Number.isFinite(weight))
        p.physicsGroups[id] = clamp(weight, 0, 2);
  if (record(v.voiceTemplates))
    for (const vowel of ['A', 'I', 'U', 'E', 'O'] as const) {
      const template = v.voiceTemplates[vowel];
      if (
        Array.isArray(template) &&
        template.length === 13 &&
        template.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 1e6)
      )
        p.voiceTemplates[vowel] = [...template];
    }

  for (const key of [
    'motionMirror',
    'autoBlink',
    'modelVisible',
    'motionSound',
    'useKeyboardHotkeys',
  ] as const)
    if (typeof v[key] === 'boolean') p[key] = v[key];
  for (const key of Object.keys(profileRanges) as (keyof typeof profileRanges)[])
    if (typeof v[key] === 'number' && Number.isFinite(v[key]))
      p[key] = clamp(v[key], profileRanges[key][0], profileRanges[key][1]);

  if (isFace(v.neutral))
    p.neutral = Object.fromEntries(
      faceKeys.filter((k) => Object.hasOwn(v.neutral!, k)).map((k) => [k, (v.neutral as Face)[k]]),
    ) as Face;
  for (const key of ['idleMotion', 'lostIdleMotion'] as const)
    if (typeof v[key] === 'string' && v[key].length <= 512) p[key] = v[key];
  for (const key of ['parameterOverrides', 'defaultParameterOverrides'] as const)
    if (record(v[key]))
      for (const [id, value] of Object.entries(v[key]).slice(0, 512))
        if (
          safeKey(id) &&
          id.length <= 512 &&
          typeof value === 'number' &&
          Number.isFinite(value) &&
          Math.abs(value) <= 1e6
        )
          p[key][id] = value;
  if (Array.isArray(v.defaultExpressions))
    p.defaultExpressions = [
      ...new Set(
        v.defaultExpressions.filter(
          (id): id is string => typeof id === 'string' && safeKey(id) && id.length <= 512,
        ),
      ),
    ].slice(0, 128);

  if (record(v.mappings))
    for (const [id, raw] of Object.entries(v.mappings).slice(0, 512)) {
      const mapping = readMapping(raw);
      if (safeKey(id) && id.length <= 512 && mapping) p.mappings[id] = mapping;
    }

  if (record(v.hotkeys))
    for (const [id, shortcut] of Object.entries(v.hotkeys).slice(0, 128))
      if (safeKey(id) && id.length <= 512 && typeof shortcut === 'string' && shortcut.length <= 128)
        p.hotkeys[id] = shortcut;

  if (record(v.hotkeyOptions))
    for (const id of Object.keys(v.hotkeyOptions)
      .filter((id) => safeKey(id) && id.length <= 512)
      .slice(0, 128)) {
      const value = v.hotkeyOptions[id];
      if (!id.startsWith('expression:') && !id.startsWith('motion:') && id !== 'clear-expressions')
        continue;
      if (!record(value) || !['local', 'global'].includes(value.scope as string)) continue;
      const option: HotkeyOptions = { scope: 'local' };
      if (
        typeof value.fadeSeconds === 'number' &&
        Number.isFinite(value.fadeSeconds) &&
        value.fadeSeconds >= 0 &&
        value.fadeSeconds <= 10
      )
        option.fadeSeconds = value.fadeSeconds;
      if (id.startsWith('expression:')) {
        if (value.release === true) option.release = true;
        if (
          typeof value.seconds === 'number' &&
          Number.isFinite(value.seconds) &&
          value.seconds > 0 &&
          value.seconds <= 3600
        )
          option.seconds = value.seconds;
      }
      if (id.startsWith('motion:') && (value.motionMode === 'once' || value.motionMode === 'hold'))
        option.motionMode = value.motionMode;
      p.hotkeyOptions[id] = option;
    }
  return p;
}

export function readSettings(value: unknown): Settings {
  const s = structuredClone(defaults);
  if (!record(value)) return s;

  const v = value;
  s.composition = readComposition(v.composition);
  s.scenes = readScenes(v.scenes);
  s.globalHotkeys = readProfile({ hotkeys: v.globalHotkeys }).hotkeys;
  Object.assign(s, readProfile(v));
  for (const key of [
    'deviceId',
    'micDeviceId',
    'modelPath',
    'pythonPath',
    'scriptPath',
    'nvidiaPath',
    'nvidiaModelDir',
  ] as const)
    if (typeof v[key] === 'string' && v[key].length < 4096) s[key] = v[key];
  if (typeof v.autoCheckUpdates === 'boolean') s.autoCheckUpdates = v.autoCheckUpdates;
  if (typeof v.skippedUpdateVersion === 'string' && v.skippedUpdateVersion.length <= 128)
    s.skippedUpdateVersion = v.skippedUpdateVersion;
  if (typeof v.previewMirror === 'boolean') s.previewMirror = v.previewMirror;
  if (typeof v.previewCamera === 'boolean') s.previewCamera = v.previewCamera;
  if (typeof v.upperBody === 'boolean') s.upperBody = v.upperBody;
  if (typeof v.handTracking === 'boolean') s.handTracking = v.handTracking;
  if (v.cameraResolution === '360p' || v.cameraResolution === '1080p')
    s.cameraResolution = v.cameraResolution;
  if (v.trackingFps === 15 || v.trackingFps === 24 || v.trackingFps === 60)
    s.trackingFps = v.trackingFps;
  for (const key of ['bodyFps', 'handFps'] as const)
    if (v[key] === 5 || v[key] === 15 || v[key] === 30) s[key] = v[key];
  if (v.renderFps === 60) s.renderFps = v.renderFps;
  if (typeof v.micGain === 'number' && Number.isFinite(v.micGain))
    s.micGain = clamp(v.micGain, 0.1, 20);
  if (typeof v.micNoiseGate === 'number' && Number.isFinite(v.micNoiseGate))
    s.micNoiseGate = clamp(v.micNoiseGate, 0, 0.2);
  if (v.engine === 'openseeface' || v.engine === 'nvidia') s.engine = v.engine;
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

export type Parameter = {
  id: string;
  min: number;
  max: number;
  default: number;
  name?: string;
  group?: string;
};

/** Optional Cubism display information never adds parameters absent from the model. */
export function describeParameters(parameters: Parameter[], info: unknown): Parameter[] {
  if (!record(info)) return parameters;
  const entries = new Map(
    (Array.isArray(info.Parameters) ? info.Parameters : [])
      .filter(record)
      .slice(0, 2048)
      .map((p) => [p.Id, p]),
  );
  const groups = new Map(
    (Array.isArray(info.ParameterGroups) ? info.ParameterGroups : [])
      .filter(record)
      .slice(0, 512)
      .map((p) => [p.Id, p]),
  );
  const label = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200).trim() : '');
  return parameters.map((parameter) => {
    const entry = entries.get(parameter.id);
    if (!entry) return parameter;
    const names: string[] = [],
      seen = new Set<unknown>();
    let group = groups.get(entry.GroupId);
    while (group && !seen.has(group.Id) && seen.size < 32) {
      seen.add(group.Id);
      if (label(group.Name)) names.unshift(label(group.Name));
      group = groups.get(group.GroupId);
    }
    return {
      ...parameter,
      ...(label(entry.Name) ? { name: label(entry.Name) } : {}),
      ...(names.length ? { group: names.join(' / ') } : {}),
    };
  });
}

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
  ParamArmLA: 'armLeft',
  ParamArmRA: 'armRight',
  ParamArmLB: 'elbowLeft',
  ParamArmRB: 'elbowRight',
};

export const parameterNames: Record<string, string> = Object.fromEntries(
  Object.entries(parameterSources).map(([id, source]) => [id, faceSources[source]]),
);

const bodyFallback = { bodyYaw: 'yaw', bodyPitch: 'pitch', bodyRoll: 'roll' } as const;
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
    // Cubism's normal eye/mouth opening is 0..1; wider bounds are for exaggerated expressions.
    outputMin: unipolar(source) ? clamp(0, p.min, p.max) : p.min,
    outputMax: unipolar(source) ? clamp(1, p.min, p.max) : p.max,
    smoothing: sourceSmoothing(source, s),
    enabled: true,
  };
}

export function normalizedFace(face: Partial<Face>, s: Settings): Partial<Record<FaceKey, number>> {
  const neutral = s.neutral ?? NEUTRAL,
    mirror = s.motionMirror ? -1 : 1;

  const angle = (v: number | undefined, n: number) =>
    clamp(((((((v! - n + 540) % 360) + 360) % 360) - 180) / 30) * s.sensitivity, -1, 1);
  const open = (v: number | undefined, n: number, endpoint: number | null) => {
    const high = Math.max(0.2, n),
      low = endpoint ?? high * s.eyeClosedThreshold;
    return clamp((v! - low) / Math.max(0.15, high - low), 0, 1) ** s.eyeSensitivity;
  };

  const values: Partial<Record<FaceKey, number>> = {
    yaw: angle(face.yaw, neutral.yaw) * mirror,
    pitch: angle(face.pitch, neutral.pitch),
    roll: angle(face.roll, neutral.roll) * mirror,
    eyeLeft: open(face.eyeLeft, neutral.eyeLeft, s.eyeClosedLeft),
    eyeRight: open(face.eyeRight, neutral.eyeRight, s.eyeClosedRight),
    mouthOpen: clamp((face.mouthOpen! - neutral.mouthOpen) * s.mouthSensitivity, 0, 1),
    mouthSmile: clamp(face.mouthSmile! - neutral.mouthSmile, -1, 1),
  };

  if (Number.isFinite(values.eyeLeft) && Number.isFinite(values.eyeRight)) {
    const yaw = ((((face.yaw! - neutral.yaw + 540) % 360) + 360) % 360) - 180;
    const blend =
      s.eyeLink === 'always'
        ? 1
        : s.eyeLink === 'side'
          ? clamp((Math.abs(yaw) - s.eyeLinkAngle) / 10, 0, 1)
          : 0;
    // Positive camera-space yaw turns the left eye away; select before motion mirroring.
    const linked =
      s.eyeLink === 'always'
        ? (values.eyeLeft! + values.eyeRight!) / 2
        : yaw >= 0
          ? values.eyeRight!
          : values.eyeLeft!;
    if (Number.isFinite(blend)) {
      values.eyeLeft! += (linked - values.eyeLeft!) * blend;
      values.eyeRight! += (linked - values.eyeRight!) * blend;
    }
  }
  for (const key of [
    'cheekPuff',
    'tongueOut',
    'brows',
    'breath',
    'voiceVolume',
    'voiceA',
    'voiceI',
    'voiceU',
    'voiceE',
    'voiceO',
  ] as const)
    if (Number.isFinite(face[key])) values[key] = clamp(face[key]!, 0, 1);
  if (s.lipSyncMode !== 'off' && values.voiceVolume !== undefined) {
    const calibrated = ['A', 'I', 'U', 'E', 'O'].every((v) => Object.hasOwn(s.voiceTemplates, v));
    const voice =
      s.lipSyncMode === 'vowels' && calibrated
        ? ((values.voiceA ?? 0) +
            (values.voiceI ?? 0) * 0.35 +
            (values.voiceU ?? 0) * 0.4 +
            (values.voiceE ?? 0) * 0.7 +
            (values.voiceO ?? 0) * 0.8) *
          values.voiceVolume
        : values.voiceVolume;
    values.mouthOpen = clamp(
      (Number.isFinite(values.mouthOpen) ? values.mouthOpen! : 0) * (1 - s.lipSyncBlend) +
        voice * s.lipSyncBlend,
      0,
      1,
    );
  }
  for (const side of ['Left', 'Right'] as const) {
    const target = s.motionMirror ? (side === 'Left' ? 'Right' : 'Left') : side;
    for (const part of [
      'Found',
      'X',
      'Y',
      'Z',
      'Angle',
      'Open',
      'Thumb',
      'Index',
      'Middle',
      'Ring',
      'Little',
    ] as const) {
      const value = face[`hand${side}${part}`];
      if (!Number.isFinite(value)) continue;
      const signed = ['X', 'Y', 'Z', 'Angle'].includes(part);
      values[`hand${target}${part}`] = clamp(
        value! * (part === 'X' || part === 'Angle' ? mirror : 1),
        signed ? -1 : 0,
        1,
      );
    }
  }

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

  if (
    values.brows === undefined &&
    (values.browLeft !== undefined || values.browRight !== undefined)
  )
    values.brows = clamp(
      0.5 + ((values.browLeft ?? values.browRight!) + (values.browRight ?? values.browLeft!)) / 4,
      0,
      1,
    );

  return Object.fromEntries(Object.entries(values).filter(([, value]) => Number.isFinite(value)));
}

export class FaceMapper {
  private current: Record<string, number> = {};
  private elapsed = 0;

  reset() {
    this.current = {};
    this.elapsed = 0;
  }

  map(
    face: Partial<Face> | null,
    parameters: Parameter[],
    s: Settings,
    dt: number,
  ): Record<string, number> {
    this.elapsed += clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
    const values = face ? normalizedFace(face, s) : null;
    const breath = (1 - Math.cos((this.elapsed * Math.PI * 2) / 3.2345)) / 2;
    const next: Record<string, number> = {};

    for (const p of parameters) {
      if (!validParameter(p)) continue;

      const custom = Object.hasOwn(s.mappings, p.id) ? s.mappings[p.id] : undefined;
      const mapping = custom ?? defaultMapping(p, s);
      if (!mapping?.enabled) continue;

      let value = mapping.source === 'breath' ? breath : values?.[mapping.source];
      const missingSource = value === undefined;
      if (value === undefined && values && !custom && Object.hasOwn(bodyFallback, mapping.source)) {
        const head = values[bodyFallback[mapping.source as keyof typeof bodyFallback]];
        if (head !== undefined) value = head * 0.3;
      }
      if (
        values &&
        (value === undefined || !Number.isFinite(value)) &&
        !Object.hasOwn(this.current, p.id)
      )
        continue;
      if (
        !face &&
        mapping.source !== 'breath' &&
        !Object.hasOwn(NEUTRAL, mapping.source) &&
        !Object.hasOwn(this.current, p.id)
      )
        continue;
      if (
        missingSource &&
        s.autoBlink &&
        (mapping.source === 'eyeLeft' || mapping.source === 'eyeRight')
      )
        continue;

      let target = p.default;
      if (
        value === undefined &&
        values &&
        s.lostMode === 'hold' &&
        Object.hasOwn(this.current, p.id)
      ) {
        next[p.id] = this.current[p.id];
        continue;
      }
      if (value !== undefined) {
        if (!custom && !unipolar(mapping.source))
          target =
            p.default +
            value * (value >= 0 ? mapping.outputMax - p.default : p.default - mapping.outputMin);
        else
          target =
            mapping.outputMin +
            (mapping.clamp === false
              ? (value - mapping.inputMin) / (mapping.inputMax - mapping.inputMin)
              : clamp((value - mapping.inputMin) / (mapping.inputMax - mapping.inputMin), 0, 1)) *
              (mapping.outputMax - mapping.outputMin);
      }

      const tau = missingSource ? Math.max(mapping.smoothing, 0.12) : mapping.smoothing;
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
