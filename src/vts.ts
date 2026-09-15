import {
  clampMouthMapping,
  type FaceKey,
  type HotkeyOptions,
  type Mapping,
  type ModelProfile,
} from './state.ts';

export type VtsImportResult = {
  profile: Partial<ModelProfile>;
  warnings: string[];
  summary: string;
  legacySmileMappings: Record<string, Mapping>;
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
    if (++nodes > 20000 || depth > 16) throw new Error('VTS 配置过于复杂');
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
        if (!safe(k)) throw new Error('VTS 配置包含危险或过长的字段名');
        validate(value, depth + 1);
      }
      return;
    }
    throw new Error('VTS 配置包含无效值或超出大小限制');
  };
  validate(raw);
  if (
    !record(raw) ||
    raw.Version !== 1 ||
    !Array.isArray(raw.ParameterSettings) ||
    !Array.isArray(raw.Hotkeys)
  )
    throw new Error('不是受支持的 Version 1 .vtube.json 模型配置');
  if (raw.Hotkeys.length > 128) throw new Error('VTS 快捷键超过 128 个');
  const warnings: string[] = [];
  const warn = (s: string) => {
    if (!warnings.includes(s)) warnings.push(s);
  };
  const mappings: Record<string, Mapping> = {};
  const legacySmileMappings: Record<string, Mapping> = {};
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
    const label = `映射 ${i + 1}`;
    if (!record(item) || !safe(item.OutputLive2D)) {
      warn(`${label}：无效输出参数`);
      continue;
    }
    if (
      ['ClampInput', 'ClampOutput', 'UseBlinking', 'UseBreathing'].some(
        (k) => item[k] !== undefined && typeof item[k] !== 'boolean',
      )
    ) {
      warn(`${label}：开关字段类型无效，已跳过`);
      continue;
    }
    const id = item.OutputLive2D;
    const p = model.parameters.find(
      (p) => p.id === id && safe(p.id) && number(p.min) && number(p.max) && p.min <= p.max,
    );
    if (!p) {
      warn(`${label}：当前模型不存在输出参数 ${id}`);
      continue;
    }
    if (item.UseBlinking === true)
      warn(`${id}：VTS 逐参数自动眨眼无法等同于全局自动眨眼，仅导入追踪映射`);
    if (
      item.UseBreathing !== true &&
      (typeof item.Input !== 'string' || !Object.hasOwn(sources, item.Input))
    ) {
      warn(`${id}：不支持输入源 ${String(item.Input).slice(0, 80)}`);
      continue;
    }
    const [source, divisor, offset = 0] =
      item.UseBreathing === true ? ['breath' as const, 1] : sources[item.Input as string];
    if (source === 'gazeX' || source === 'gazeY')
      warn('视线输入：当前追踪使用双眼合并视线，左右眼独立方向按合并信号近似');
    if (source === 'brows' || source === 'browLeft' || source === 'browRight')
      warn('眉毛输入：按当前追踪的眉毛升降归一化，需校准中立姿态，非 VTS 原算法');
    if (source === 'cheekPuff')
      warn('CheekPuff：当前仅 NVIDIA 引擎提供鼓嘴信号；其他引擎可用参数固定值手动控制');
    if (source === 'tongueOut')
      warn('TongueOut：当前追踪引擎未提供吐舌信号；已保留映射，可用参数固定值手动控制');
    if (source === 'breath')
      warn('自动呼吸：忽略原输入源，使用当前运行时的周期曲线，节奏可能与 VTS 不同');
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
      warn(`${id}：无效范围或平滑值`);
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
      warn(`${id}：输入范围超出映射限制，已跳过`);
      continue;
    }
    if (Object.hasOwn(mappings, id)) {
      warn(`${id}：重复输出映射，保留第一项`);
      continue;
    }
    // ponytail: slider proportion only; exact VTS smoothing needs its unpublished algorithm.
    if (item.Smoothing !== 0) warn(`${id}：平滑滑杆按 0–100 → 0–0.5 秒近似，非 VTS 原算法`);
    mappings[id] = clampMouthMapping(
      {
        source,
        inputMin: lo,
        inputMax: hi,
        outputMin: outLo,
        outputMax: outHi,
        smoothing: (item.Smoothing as number) / 200,
        enabled: true,
        ...(item.ClampInput === false && item.ClampOutput === false ? { clamp: false } : {}),
      },
      p,
    );
    if (mappings[id].outputMin !== outLo || mappings[id].outputMax !== outHi)
      warn(
        `${id}：嘴部开合输出端点已限制到模型范围，避免提前达到张嘴上限；可调整输入范围或嘴部灵敏度改变幅度`,
      );
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
        legacySmileMappings[id] = mappings[id];
        mappings[id] = { ...mappings[id], inputMin };
        warn(
          `${id}：微笑输入的中立位置已对齐模型默认值，避免静止时嘴形落到变形端点；非 VTS 原算法`,
        );
      }
    }
  }
  if (Object.keys(mappings).length)
    warn(
      '追踪范围按当前输入源归一化，嘴部开合输出端点限制到模型范围，其余保留作者输出范围及外推设置；最终值受模型本身范围限制，灵敏度、镜像、校准仍生效，需在预览中校准方向和幅度',
    );
  const refs = record(raw.FileReferences) ? raw.FileReferences : {};
  for (const [field, target, label] of [
    ['IdleAnimation', 'idleMotion', '待机动画'],
    ['IdleAnimationWhenTrackingLost', 'lostIdleMotion', '追踪丢失待机动画'],
  ] as const) {
    if (!refs[field]) continue;
    const id = resolve(refs[field], model.motions);
    if (id) profile[target] = id;
    else
      warn(
        `${label}「${String(refs[field]).slice(0, 160)}」：文件缺失或存在同名歧义，未导入。请从原模型包重新导入，并检查同名文件。`,
      );
  }
  if (profile.lostIdleMotion)
    warn('追踪丢失待机动画：使用应用的追踪丢失延迟，VTS 的等待时长未转换');
  if (raw.SavedActiveExpressions !== undefined) {
    const saving = record(raw.GeneralSettings)
      ? raw.GeneralSettings.EnableExpressionSaving
      : undefined;
    if (saving !== undefined && typeof saving !== 'boolean') {
      warn('SavedActiveExpressions：EnableExpressionSaving 开关类型无效，未导入默认表情');
    } else if (saving === false) {
      profile.defaultExpressions = [];
    } else if (Array.isArray(raw.SavedActiveExpressions)) {
      profile.defaultExpressions = [];
      for (const file of raw.SavedActiveExpressions) {
        const id = resolve(file, model.expressions);
        if (id) {
          if (!profile.defaultExpressions.includes(id)) profile.defaultExpressions.push(id);
        } else {
          warn(
            `默认表情「${String(file).slice(0, 160)}」：文件缺失、引用无效或存在同名歧义，未导入。请从原模型包重新导入，并检查同名文件。`,
          );
        }
      }
      if (profile.defaultExpressions.length > 128) {
        profile.defaultExpressions.length = 128;
        warn('默认表情超过 128 个，仅导入前 128 个');
      }
    } else {
      warn('SavedActiveExpressions：应为表情文件列表，未导入默认表情');
    }
  }
  if (record(raw.PhysicsSettings)) {
    if (raw.PhysicsSettings.Use === false) profile.physicsStrength = 0;
    warn('物理设置：仅支持 Use=false 关闭物理；强度滑杆、风、帧率枚举及旧版算法未转换');
  }
  profile.useKeyboardHotkeys = !(
    record(raw.HotkeySettings) && raw.HotkeySettings.UseKeyboardHotkeys === false
  );
  for (const [i, item] of raw.Hotkeys.entries()) {
    const label = `快捷键 ${i + 1}`;
    if (!record(item)) {
      warn(`${label}：无效配置`);
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
      warn(`${label}：开关字段类型无效，已跳过`);
      continue;
    }
    if (item.IsActive === false) {
      warn(`${label}：VTS 已禁用，未导入`);
      continue;
    }
    const gesture = record(item.HandGestureSettings) ? item.HandGestureSettings : {};
    if (gesture.GestureLeft || gesture.GestureRight) warn(`${label}：手势触发不支持`);
    if (record(item.TwitchTriggers) && item.TwitchTriggers.Active)
      warn(`${label}：Twitch 触发不支持`);
    if (gesture.DeactivateExpWhenGestureNotDetected) {
      warn(`${label}：手势停用不支持，整项跳过`);
      continue;
    }
    if (
      item.Action !== 'ToggleExpression' &&
      (item.DeactivateAfterKeyUp || item.DeactivateAfterSeconds)
    ) {
      warn(`${label}：当前仅表情支持松键或定时停用，整项跳过`);
      continue;
    }
    if (
      item.DeactivateAfterSeconds &&
      (!number(item.DeactivateAfterSecondsAmount) ||
        item.DeactivateAfterSecondsAmount <= 0 ||
        item.DeactivateAfterSecondsAmount > 3600)
    ) {
      warn(`${label}：定时停用秒数无效（范围 0–3600，不含 0），整项跳过`);
      continue;
    }
    let action: string | undefined;
    if (item.Action === 'ToggleExpression' || item.Action === 'TriggerAnimation') {
      const expression = item.Action === 'ToggleExpression';
      const id = resolve(item.File, expression ? model.expressions : model.motions);
      if (id) action = `${expression ? 'expression' : 'motion'}:${id}`;
      else {
        warn(
          `${label}${safe(item.Name) ? `「${item.Name.slice(0, 80)}」` : ''}：表情/动作文件「${String(item.File).slice(0, 160)}」缺失或存在同名歧义，未导入。请从原模型包重新导入，并检查同名文件。`,
        );
        continue;
      }
    } else if (item.Action === 'RemoveAllExpressions') action = 'clear-expressions';
    else {
      warn(
        `${label}：不支持动作 ${String(item.Action).slice(0, 80)}（场景/道具缺少对应目标，停止/重置无已验证的 VTS 枚举）`,
      );
      continue;
    }
    const triggers = record(item.Triggers) ? item.Triggers : {};
    if (number(triggers.ScreenButton) && triggers.ScreenButton >= 0)
      warn(`${label}：屏幕按钮触发不支持`);
    const rawKeys = [triggers.Trigger1, triggers.Trigger2, triggers.Trigger3].filter(
      (k) => k !== '' && k !== undefined,
    );
    const converted = rawKeys.map(key);
    if (
      rawKeys.some((k) => typeof k === 'string' && /^(Left|Right)(Control|Shift|Windows)$/.test(k))
    )
      warn(`${label}：左右修饰键合并为 Control/Shift/Super，无法区分按键所在侧`);
    const modifiers = ['Control', 'Alt', 'Shift', 'Super'];
    if (
      !converted.length ||
      converted.some((k) => !k) ||
      converted.filter((k) => !modifiers.includes(k!)).length !== 1
    ) {
      warn(`${label}：按键枚举不支持或不是“修饰键 + 单个按键”，未导入`);
      continue;
    }
    const shortcut = [
      ...modifiers.filter((m) => converted.includes(m)),
      converted.find((k) => !modifiers.includes(k!))!,
    ].join('+');
    if (Object.hasOwn(hotkeys, action) || Object.values(hotkeys).includes(shortcut)) {
      warn(`${label}：动作或按键重复，保留第一项`);
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
      else warn(`${label}：淡入淡出秒数无效（范围 0–10），使用运行时默认值`);
    }
    if (item.Action === 'ToggleExpression') {
      if (item.DeactivateAfterKeyUp) options.release = true;
      if (item.DeactivateAfterSeconds)
        options.seconds = item.DeactivateAfterSecondsAmount as number;
    }
    if (item.Action === 'TriggerAnimation') {
      options.motionMode = item.StopsOnLastFrame ? 'hold' : 'once';
      if (item.StopsOnLastFrame)
        warn(
          `${label}：停留末帧使用当前运行时；再次按键停止，但已映射参数也会保持，和 VTS 的追踪参数回退不同`,
        );
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
        field === 'GeneralSettings'
          ? 'GeneralSettings：仅处理表情保存开关，其他 VTS 专用设置未转换'
          : `${field}：VTS 专用配置未导入`,
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
    if (!known.includes(field)) warn(`${field}：未知 VTS 配置字段，未导入`);
  return {
    profile,
    warnings,
    legacySmileMappings,
    summary: `导入 ${Object.keys(mappings).length} 个映射、${Object.keys(hotkeys).length} 个快捷键${profile.idleMotion ? '、待机动画' : ''}；${warnings.length} 条兼容性提示`,
  };
}

/** Repair only ranges still matching the bundled VTS import, preserving subsequent tuning. */
export function repairVtsSmileMappings(mappings: Record<string, Mapping>, result: VtsImportResult) {
  let changed = false;
  for (const [id, legacy] of Object.entries(result.legacySmileMappings)) {
    const current = Object.hasOwn(mappings, id) ? mappings[id] : undefined;
    if (
      current &&
      (['source', 'inputMin', 'inputMax', 'outputMin', 'outputMax'] as const).every(
        (key) => current[key] === legacy[key],
      )
    ) {
      mappings[id] = { ...current, inputMin: result.profile.mappings![id].inputMin };
      changed = true;
    }
  }
  return changed;
}
