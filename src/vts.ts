import { type FaceKey, type HotkeyOptions, type Mapping, type ModelProfile } from './state.ts';
import { t } from './i18n.ts';

export type VtsImportResult = {
  profile: Partial<ModelProfile>;
  warnings: string[];
  summary: string;
  legacyMappings: Record<string, Mapping>;
};
type Model = {
  parameters: { id: string; min: number; max: number; default?: number }[];
  expressions: { id: string; file: string }[];
  motions: { id: string; file: string }[];
};
const record = (v: unknown): v is Record<string, unknown> =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(v));
const safe = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= 512 &&
  !['__proto__', 'constructor', 'prototype'].includes(v) &&
  !/[\x00-\x1f]/.test(v);
const number = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6;
function path(v: unknown): string | undefined {
  if (!safe(v)) return;
  const normalized = v.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '');
  if (
    /^\/|:/.test(normalized) ||
    normalized.split('/').some((part) => !part || part === '..' || part === '.')
  )
    return;
  return normalized;
}

// These inputs have a documented counterpart. Tracking calibration still differs between apps.
const sources: Record<string, [FaceKey, number, number?]> = {
  FaceAngleX: ['yaw', 30],
  FaceAngleY: ['pitch', 30],
  FaceAngleZ: ['roll', 30],
  EyeOpenLeft: ['eyeLeft', 1],
  EyeOpenRight: ['eyeRight', 1],
  MouthOpen: ['mouthOpen', 1],
  MouthSmile: ['mouthSmile', 1],
  EyeLeftX: ['gazeX', 1],
  EyeRightX: ['gazeX', 1],
  EyeLeftY: ['gazeY', 1],
  EyeRightY: ['gazeY', 1],
  Brows: ['brows', 1],
  BrowLeftY: ['browLeft', 0.5, 0.5],
  BrowRightY: ['browRight', 0.5, 0.5],
  MouthX: ['mouthX', 1],
  CheekPuff: ['cheekPuff', 1],
  TongueOut: ['tongueOut', 1],
};
const keys: Record<string, string> = {
  LeftControl: 'Control',
  RightControl: 'Control',
  LeftShift: 'Shift',
  RightShift: 'Shift',
  Alt: 'Alt',
  LeftWindows: 'Super',
  RightWindows: 'Super',
  Tab: 'Tab',
  Escape: 'Escape',
  Space: 'Space',
  Delete: 'Delete',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Multiply: 'NumpadMultiply',
  Add: 'NumpadAdd',
  Subtract: 'NumpadSubtract',
  Decimal: 'NumpadDecimal',
  Divide: 'NumpadDivide',
};
function key(v: unknown): string | undefined {
  if (typeof v !== 'string') return;
  if (Object.hasOwn(keys, v)) return keys[v];
  if (/^[A-Z]$/.test(v)) return `Key${v}`;
  if (/^N[0-9]$/.test(v)) return `Digit${v[1]}`;
  if (/^Numpad[0-9]$|^F([1-9]|1[0-9]|2[0-4])$/.test(v)) return v;
}

/** Reads data only: references are matched against metadata, never opened. */
export function importVtsConfig(raw: unknown, model: Model): VtsImportResult {
  let nodes = 0;
  const validate = (v: unknown, depth = 0): void => {
    if (++nodes > 20000 || depth > 16) throw new Error(t('vts.tooComplex'));
    if (
      (typeof v === 'string' && v.length <= 2048) ||
      typeof v === 'boolean' ||
      v === null ||
      number(v)
    )
      return;
    if (Array.isArray(v) && v.length <= 512) {
      v.forEach((x) => validate(x, depth + 1));
      return;
    }
    if (record(v) && Object.keys(v).length <= 256) {
      for (const [k, value] of Object.entries(v)) {
        if (!safe(k)) throw new Error(t('vts.unsafeField'));
        validate(value, depth + 1);
      }
      return;
    }
    throw new Error(t('vts.invalidValue'));
  };
  validate(raw);
  if (
    !record(raw) ||
    raw.Version !== 1 ||
    !Array.isArray(raw.ParameterSettings) ||
    !Array.isArray(raw.Hotkeys)
  )
    throw new Error(t('vts.unsupportedVersion'));
  if (raw.Hotkeys.length > 128) throw new Error(t('vts.tooManyHotkeys'));
  const warnings: string[] = [];
  const warn = (s: string) => {
    if (!warnings.includes(s)) warnings.push(s);
  };
  const mappings: Record<string, Mapping> = {};
  const legacyMappings: Record<string, Mapping> = {};
  const hotkeys: Record<string, string> = {};
  const hotkeyOptions: Record<string, HotkeyOptions> = {};
  const profile: Partial<ModelProfile> = { mappings, hotkeys, hotkeyOptions };
  const resolve = (file: unknown, entries: Model['motions']): string | undefined => {
    const normalized = path(file);
    if (!normalized) return;
    const valid = entries.flatMap((e) => {
      const file = path(e.file);
      return safe(e.id) && e.id.length < 490 && file ? [{ id: e.id, file }] : [];
    });
    const exact = valid.filter((e) => e.file === normalized);
    const matches = exact.length
      ? exact
      : normalized.includes('/')
        ? []
        : valid.filter((e) => e.file.split('/').at(-1) === normalized);
    return matches.length === 1 ? matches[0].id : undefined;
  };
  for (const [i, item] of raw.ParameterSettings.entries()) {
    const label = t('vts.mappingLabel', { index: i + 1 });
    if (!record(item) || !safe(item.OutputLive2D)) {
      warn(t('vts.invalidOutput', { label }));
      continue;
    }
    if (
      ['ClampInput', 'ClampOutput', 'UseBlinking', 'UseBreathing'].some(
        (k) => item[k] !== undefined && typeof item[k] !== 'boolean',
      )
    ) {
      warn(t('vts.invalidSwitch', { label }));
      continue;
    }
    const id = item.OutputLive2D;
    const p = model.parameters.find(
      (p) => p.id === id && safe(p.id) && number(p.min) && number(p.max) && p.min <= p.max,
    );
    if (!p) {
      warn(t('vts.missingOutput', { label, id }));
      continue;
    }
    if (item.UseBlinking === true) warn(t('vts.blinking', { id }));
    if (
      item.UseBreathing !== true &&
      (typeof item.Input !== 'string' || !Object.hasOwn(sources, item.Input))
    ) {
      warn(t('vts.unsupportedInput', { id, input: String(item.Input).slice(0, 80) }));
      continue;
    }
    const [source, divisor, offset = 0] =
      item.UseBreathing === true ? ['breath' as const, 1] : sources[item.Input as string];
    if (source === 'gazeX' || source === 'gazeY') warn(t('vts.gaze'));
    if (source === 'brows' || source === 'browLeft' || source === 'browRight') warn(t('vts.brows'));
    if (source === 'cheekPuff') warn(t('vts.cheekPuff'));
    if (source === 'tongueOut') warn(t('vts.tongueOut'));
    if (source === 'breath') warn(t('vts.breath'));
    const inputLo = source === 'breath' ? 0 : item.InputRangeLower;
    const inputHi = source === 'breath' ? 1 : item.InputRangeUpper;
    if (
      ![inputLo, inputHi, item.OutputRangeLower, item.OutputRangeUpper, item.Smoothing].every(
        number,
      ) ||
      inputLo === inputHi ||
      (item.Smoothing as number) < 0 ||
      (item.Smoothing as number) > 100
    ) {
      warn(t('vts.invalidRange', { id }));
      continue;
    }
    let lo = ((inputLo as number) - offset) / divisor,
      hi = ((inputHi as number) - offset) / divisor;
    let outLo = item.OutputRangeLower as number,
      outHi = item.OutputRangeUpper as number;
    if (lo > hi) {
      [lo, hi] = [hi, lo];
      [outLo, outHi] = [outHi, outLo];
    }
    if (Math.abs(lo) > 1000 || Math.abs(hi) > 1000) {
      warn(t('vts.inputOutOfRange', { id }));
      continue;
    }
    if (Object.hasOwn(mappings, id)) {
      warn(t('vts.duplicateOutput', { id }));
      continue;
    }
    // ponytail: slider proportion only; exact VTS smoothing needs its unpublished algorithm.
    if (item.Smoothing !== 0) warn(t('vts.smoothing', { id }));
    mappings[id] = {
      source,
      inputMin: lo,
      inputMax: hi,
      outputMin: outLo,
      outputMax: outHi,
      smoothing: (item.Smoothing as number) / 200,
      enabled: true,
      ...(item.ClampInput === false && item.ClampOutput === false ? { clamp: false } : {}),
    };
    if (source === 'mouthOpen') {
      const outputMin = Math.max(p.min, Math.min(p.max, outLo));
      const outputMax = Math.max(p.min, Math.min(p.max, outHi));
      if (outputMin !== outLo || outputMax !== outHi)
        legacyMappings[id] = { ...mappings[id], outputMin, outputMax };
    }
    // ponytail: adapt full-range smile inputs only; custom VTS calibration stays manual.
    if (
      source === 'mouthSmile' &&
      lo === 0 &&
      hi === 1 &&
      number(p.default) &&
      p.default > Math.min(outLo, outHi) &&
      p.default < Math.max(outLo, outHi)
    ) {
      // Our smile signal rests at zero. Keep the smile endpoint and align zero to model neutral.
      const inputMin = (outLo - p.default) / (outHi - p.default);
      if (inputMin >= -1000) {
        legacyMappings[id] = mappings[id];
        mappings[id] = { ...mappings[id], inputMin };
        warn(t('vts.smileNeutral', { id }));
      }
    }
  }
  if (Object.keys(mappings).length) warn(t('vts.rangeNote'));
  const refs = record(raw.FileReferences) ? raw.FileReferences : {};
  for (const [field, target, label] of [
    ['IdleAnimation', 'idleMotion', 'vts.idleMotion'],
    ['IdleAnimationWhenTrackingLost', 'lostIdleMotion', 'vts.lostIdleMotion'],
  ] as const) {
    if (!refs[field]) continue;
    const id = resolve(refs[field], model.motions);
    if (id) profile[target] = id;
    else
      warn(
        t('vts.missingMotionFile', { label: t(label), file: String(refs[field]).slice(0, 160) }),
      );
  }
  if (profile.lostIdleMotion) warn(t('vts.lostIdleDelay'));
  if (raw.SavedActiveExpressions !== undefined) {
    const saving = record(raw.GeneralSettings)
      ? raw.GeneralSettings.EnableExpressionSaving
      : undefined;
    if (saving !== undefined && typeof saving !== 'boolean') {
      warn(t('vts.expressionSavingInvalid'));
    } else if (saving === false) {
      profile.defaultExpressions = [];
    } else if (Array.isArray(raw.SavedActiveExpressions)) {
      profile.defaultExpressions = [];
      for (const file of raw.SavedActiveExpressions) {
        const id = resolve(file, model.expressions);
        if (id) {
          if (!profile.defaultExpressions.includes(id)) profile.defaultExpressions.push(id);
        } else {
          warn(t('vts.missingDefaultExpression', { file: String(file).slice(0, 160) }));
        }
      }
      if (profile.defaultExpressions.length > 128) {
        profile.defaultExpressions.length = 128;
        warn(t('vts.tooManyDefaultExpressions'));
      }
    } else {
      warn(t('vts.savedExpressionsInvalid'));
    }
  }
  if (record(raw.PhysicsSettings)) {
    if (raw.PhysicsSettings.Use === false) profile.physicsStrength = 0;
    warn(t('vts.physics'));
  }
  profile.useKeyboardHotkeys = !(
    record(raw.HotkeySettings) && raw.HotkeySettings.UseKeyboardHotkeys === false
  );
  for (const [i, item] of raw.Hotkeys.entries()) {
    const label = t('vts.hotkeyLabel', { index: i + 1 });
    if (!record(item)) {
      warn(t('vts.invalidHotkey', { label }));
      continue;
    }
    if (
      [
        'IsActive',
        'IsGlobal',
        'StopsOnLastFrame',
        'DeactivateAfterKeyUp',
        'DeactivateAfterSeconds',
      ].some((k) => item[k] !== undefined && typeof item[k] !== 'boolean')
    ) {
      warn(t('vts.invalidSwitch', { label }));
      continue;
    }
    if (item.IsActive === false) {
      warn(t('vts.hotkeyDisabled', { label }));
      continue;
    }
    const gesture = record(item.HandGestureSettings) ? item.HandGestureSettings : {};
    if (gesture.GestureLeft || gesture.GestureRight) warn(t('vts.gesture', { label }));
    if (record(item.TwitchTriggers) && item.TwitchTriggers.Active) warn(t('vts.twitch', { label }));
    if (gesture.DeactivateExpWhenGestureNotDetected) {
      warn(t('vts.gestureDeactivate', { label }));
      continue;
    }
    if (
      item.Action !== 'ToggleExpression' &&
      (item.DeactivateAfterKeyUp || item.DeactivateAfterSeconds)
    ) {
      warn(t('vts.deactivateExpressionOnly', { label }));
      continue;
    }
    if (
      item.DeactivateAfterSeconds &&
      (!number(item.DeactivateAfterSecondsAmount) ||
        item.DeactivateAfterSecondsAmount <= 0 ||
        item.DeactivateAfterSecondsAmount > 3600)
    ) {
      warn(t('vts.invalidDeactivateSeconds', { label }));
      continue;
    }
    let action: string | undefined;
    if (item.Action === 'ToggleExpression' || item.Action === 'TriggerAnimation') {
      const expression = item.Action === 'ToggleExpression';
      const id = resolve(item.File, expression ? model.expressions : model.motions);
      if (id) action = `${expression ? 'expression' : 'motion'}:${id}`;
      else {
        warn(
          t('vts.missingHotkeyFile', {
            label: safe(item.Name)
              ? t('vts.namedHotkey', { label, name: item.Name.slice(0, 80) })
              : label,
            file: String(item.File).slice(0, 160),
          }),
        );
        continue;
      }
    } else if (item.Action === 'RemoveAllExpressions') action = 'clear-expressions';
    else {
      warn(t('vts.unsupportedAction', { label, action: String(item.Action).slice(0, 80) }));
      continue;
    }
    const triggers = record(item.Triggers) ? item.Triggers : {};
    if (number(triggers.ScreenButton) && triggers.ScreenButton >= 0)
      warn(t('vts.screenButton', { label }));
    const rawKeys = [triggers.Trigger1, triggers.Trigger2, triggers.Trigger3].filter(
      (k) => k !== '' && k !== undefined,
    );
    const converted = rawKeys.map(key);
    if (
      rawKeys.some((k) => typeof k === 'string' && /^(Left|Right)(Control|Shift|Windows)$/.test(k))
    )
      warn(t('vts.sideModifiers', { label }));
    const modifiers = ['Control', 'Alt', 'Shift', 'Super'];
    if (
      !converted.length ||
      converted.some((k) => !k) ||
      converted.filter((k) => !modifiers.includes(k!)).length !== 1
    ) {
      warn(t('vts.unsupportedKeys', { label }));
      continue;
    }
    const shortcut = [
      ...modifiers.filter((m) => converted.includes(m)),
      converted.find((k) => !modifiers.includes(k!))!,
    ].join('+');
    if (Object.hasOwn(hotkeys, action) || Object.values(hotkeys).includes(shortcut)) {
      warn(t('vts.duplicateHotkey', { label }));
      continue;
    }
    hotkeys[action] = shortcut;
    const options: HotkeyOptions = { scope: 'local' };
    if (item.FadeSecondsAmount !== undefined) {
      if (
        number(item.FadeSecondsAmount) &&
        item.FadeSecondsAmount >= 0 &&
        item.FadeSecondsAmount <= 10
      )
        options.fadeSeconds = item.FadeSecondsAmount;
      else warn(t('vts.invalidFade', { label }));
    }
    if (item.Action === 'ToggleExpression') {
      if (item.DeactivateAfterKeyUp) options.release = true;
      if (item.DeactivateAfterSeconds)
        options.seconds = item.DeactivateAfterSecondsAmount as number;
    }
    if (item.Action === 'TriggerAnimation') {
      options.motionMode = item.StopsOnLastFrame ? 'hold' : 'once';
      if (item.StopsOnLastFrame) warn(t('vts.holdLastFrame', { label }));
    }
    hotkeyOptions[action] = options;
  }
  for (const field of [
    'SavedModelPosition',
    'ModelPositionMovement',
    'ItemSettings',
    'GeneralSettings',
    'ArtMeshDetails',
    'PhysicsCustomizationSettings',
    'ParameterCustomization',
  ])
    if (raw[field] !== undefined)
      warn(
        field === 'GeneralSettings' ? t('vts.generalSettings') : t('vts.vtsOnlyField', { field }),
      );
  const known = [
    'Version',
    'Name',
    'ModelID',
    'ModelSaveMetadata',
    'FileReferences',
    'ParameterSettings',
    'Hotkeys',
    'HotkeySettings',
    'PhysicsSettings',
    'FolderInfo',
    'SavedModelPosition',
    'ModelPositionMovement',
    'ItemSettings',
    'GeneralSettings',
    'ArtMeshDetails',
    'PhysicsCustomizationSettings',
    'ParameterCustomization',
    'SavedActiveExpressions',
  ];
  for (const field of Object.keys(raw))
    if (!known.includes(field)) warn(t('vts.unknownField', { field }));
  return {
    profile,
    warnings,
    legacyMappings,
    summary: t(profile.idleMotion ? 'vts.summaryWithIdle' : 'vts.summary', {
      mappings: Object.keys(mappings).length,
      hotkeys: Object.keys(hotkeys).length,
      warnings: warnings.length,
    }),
  };
}

/** Repair only ranges still matching the bundled VTS import, preserving subsequent tuning. */
export function repairVtsMappings(
  mappings: Record<string, Mapping>,
  result: VtsImportResult,
  report: string[] = [],
) {
  let changed = false;
  for (const [id, repaired] of Object.entries(result.profile.mappings ?? {})) {
    const legacy = result.legacyMappings[id];
    const current = Object.hasOwn(mappings, id) ? mappings[id] : undefined;
    // Legacy report lines were persisted by Chinese-only releases; match them verbatim.
    const skipped = `${id}：范围超出当前模型或映射限制，已跳过`;
    if (!current && repaired.source === 'mouthOpen' && report.includes(skipped)) {
      mappings[id] = { ...repaired };
      changed = true;
    }
    if (
      current &&
      legacy &&
      (['source', 'inputMin', 'inputMax', 'outputMin', 'outputMax'] as const).every(
        (key) => current[key] === legacy[key],
      )
    ) {
      mappings[id] = {
        ...current,
        inputMin: repaired.inputMin,
        outputMin: repaired.outputMin,
        outputMax: repaired.outputMax,
      };
      changed = true;
    }
    // Consume old failure reports once, including when a user has since supplied a custom map.
    if (repaired.source === 'mouthOpen')
      for (let i = report.length - 1; i >= 0; i--)
        if (report[i] === skipped || report[i].startsWith(`${id}：嘴部开合输出端点已限制`)) {
          report.splice(i, 1);
          changed = true;
        }
  }
  if (changed)
    for (let i = 0; i < report.length; i++)
      report[i] = report[i].replace('嘴部开合输出端点限制到模型范围，其余保留', '保留');
  return changed;
}
