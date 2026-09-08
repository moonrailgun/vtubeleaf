import { invoke, isTauri } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, type BackgroundThrottlingPolicy } from '@tauri-apps/api/window';
import { AvatarStage, type ModelInfo, type MotionMode } from './renderer';
import { Tracker } from './tracker';
import {
  defaults,
  readSettings,
  FaceMapper,
  faceSources,
  rememberProfile,
  switchProfile,
  normalizedFace,
  isFace,
  type Mapping,
  type Face,
  type Settings,
} from './state';
import { Hotkeys } from './hotkeys';
import { MotionRecording } from './recording';
import type { OutputState } from './output';

export function createStudio(
  container: HTMLElement,
  video: HTMLVideoElement,
  update: (view: StudioView) => void,
  preview?: HTMLCanvasElement,
) {
  const native = isTauri();
  let disposed = false;
  let ready = false;
  let settings = structuredClone(defaults);
  let stage: AvatarStage | undefined;
  let model: ModelInfo | null = null;
  let library: ModelInfo[] = [];
  let libraryDirectory = '';
  let dropActive = false;
  const previews: Record<string, string> = {};
  let previewStage: AvatarStage | undefined;
  let previewTask: Promise<void> | undefined;
  let lastFace: Partial<Face> | null = null;
  let lastFaceAt = 0;
  let tracking: 'stopped' | 'starting' | 'running' | 'paused' = 'stopped';
  let trackingOperation = 0;
  let modelOperation = 0;
  let modelRevision = 0;
  let profileRevision = 0;
  let modelLoading = false;
  let outputOpen = false;
  let frameSending = false;
  let saveTimer = 0;
  let saveQueue = Promise.resolve();
  let cameraDevices: MediaDeviceInfo[] = [];
  let renderStatus = '画面预览';
  let faceStatus = '点击开始后才会采集';
  let faceInput: Partial<Face> = {};
  let notice = { message: '画面与面部数据仅在本机处理，不使用麦克风。', error: false };
  const events: string[] = [];
  const unlisteners: UnlistenFn[] = [];
  const mapper = new FaceMapper();
  const recording = new MotionRecording();
  const snapshot = () => ({
    ready,
    settings: structuredClone(settings),
    model,
    library,
    libraryDirectory,
    dropActive,
    previews: { ...previews },
    modelLoading,
    profileRevision,
    tracking,
    cameraDevices,
    renderStatus,
    faceStatus,
    bodyStatus: tracker.bodyStatus,
    faceInput,
    notice,
    events: [...events],
    parameters: stage?.parameters ?? [],
    expressions: stage?.expressions ?? [],
    motions: stage?.motions ?? [],
    activeExpressions: new Set(stage?.activeExpressions),
    recording: recording.active,
    duration: recording.duration,
    canSaveRecording: !recording.active && recording.duration > 0,
  });
  const publish = () => {
    if (!disposed) update(snapshot());
  };
  function notify(message: string, error = false) {
    if (disposed) return;
    notice = { message, error };
    if (error) {
      events.unshift(`${new Date().toLocaleTimeString('zh-CN')} · ${message}`);
      events.length = Math.min(events.length, 8);
    }
    publish();
  }
  const report = (error: unknown) =>
    notify(
      typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : '操作失败，请重试。',
      true,
    );
  const run = async (fn: () => unknown) => {
    if (disposed) return;
    try {
      await fn();
    } catch (error) {
      report(error);
    }
  };
  function save() {
    window.clearTimeout(saveTimer);
    saveTimer = 0;
    rememberProfile(settings);
    const value = structuredClone(settings);
    saveQueue = saveQueue
      .catch(() => {})
      .then(async () => {
        try {
          if (native) await invoke('save_settings', { settings: value });
          else localStorage.setItem('vtubeleaf-preview', JSON.stringify(value));
        } catch {
          notify('设置保存失败。请检查磁盘空间和应用配置目录权限。', true);
        }
      });
    return saveQueue;
  }
  async function syncOutput() {
    if (native && outputOpen && !disposed)
      await emitTo('output', 'output-state', {
        model,
        settings,
        revision: modelRevision,
      } satisfies OutputState);
  }
  function changed() {
    stage?.display(settings);
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), 250);
    void syncOutput().catch(() => {
      outputOpen = false;
    });
    publish();
  }
  async function devices() {
    const next = (await navigator.mediaDevices?.enumerateDevices()) ?? [];
    if (disposed) return;
    cameraDevices = next.filter((d) => d.kind === 'videoinput' && d.deviceId);
    publish();
  }
  function modelAction(id: string, mode: MotionMode = 'once') {
    if (!stage || !model || disposed) return;
    if (id.startsWith('expression:')) stage.toggleExpression(id.slice(11));
    else if (id.startsWith('motion:')) stage.playMotion(id.slice(7), mode);
    else if (id === 'stop-motion') stage.stopMotion();
    else if (id === 'clear-expressions') stage.clearExpressions();
    publish();
  }
  const hotkeys = new Hotkeys((id) => run(() => modelAction(id, actions.motionMode)), report);
  const tracker = new Tracker(
    video,
    (face) => {
      if (!disposed) {
        lastFace = face;
        lastFaceAt = performance.now();
      }
    },
    (error) => {
      trackingOperation++;
      tracking = 'stopped';
      lastFace = null;
      notify(error, true);
    },
    preview,
  );
  async function stop() {
    trackingOperation++;
    tracking = 'stopped';
    lastFace = null;
    publish();
    await tracker.stop();
  }
  async function refreshLibrary() {
    const result = await invoke<{ models: ModelInfo[]; directory: string; errors: string[] }>(
      'list_models',
    );
    if (disposed) return;
    library = result.models;
    libraryDirectory = result.directory;
    publish();
    for (const entry of library) {
      if (disposed) return;
      await readPreview(entry);
    }
    if (result.errors.length) notify(`部分角色暂不可用：${result.errors.join('；')}`, true);
    publish();
    generatePreviews();
  }
  async function readPreview(entry: ModelInfo) {
    if (previews[entry.path] || disposed) return;
    let url = '';
    try {
      const bytes = await invoke<ArrayBuffer>('read_model_preview', { id: entry.id });
      if (!bytes.byteLength || disposed) return;
      url = URL.createObjectURL(new Blob([bytes]));
      const image = new Image();
      image.src = url;
      await image.decode();
      if (disposed || previews[entry.path]) return;
      previews[entry.path] = url;
      url = '';
      publish();
    } catch {
      /* Missing or invalid icons fall back to a rendered avatar. */
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }
  async function savePreview(entry: ModelInfo, thumbnail: HTMLCanvasElement) {
    const png = await new Promise<Blob>((resolve, reject) =>
      thumbnail.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('角色预览生成失败'))),
        'image/png',
      ),
    );
    if (disposed || previews[entry.path]) return;
    previews[entry.path] = URL.createObjectURL(png);
    publish();
    await invoke('save_model_preview', {
      id: entry.id,
      png: Array.from(new Uint8Array(await png.arrayBuffer())),
    });
  }
  function generatePreviews() {
    if (previewTask || disposed) return;
    previewTask = (async () => {
      const attempted = new Set<string>();
      try {
        while (!disposed) {
          const entry = library.find((item) => !previews[item.path] && !attempted.has(item.path));
          if (!entry) break;
          attempted.add(entry.path);
          try {
            previewStage ??= new AvatarStage(document.createElement('div'), () => {}, true);
            if (await previewStage.load(entry)) {
              if (disposed) break;
              await savePreview(entry, previewStage.thumbnail());
            }
          } catch {
            /* One broken model must not prevent the remaining avatars. */
          }
        }
      } finally {
        previewStage?.destroy();
        previewStage = undefined;
      }
    })().finally(() => {
      previewTask = undefined;
    });
  }
  async function useModel(next: ModelInfo, operation: number) {
    if (disposed || operation !== modelOperation) return;
    if (!stage) throw new Error('WebGL 渲染不可用。请检查显卡驱动或重新启动应用。');
    notify('正在加载角色资源…');
    library = [...library.filter((entry) => entry.path !== next.path), next];
    publish();
    await readPreview(next);
    if (disposed || operation !== modelOperation) return;
    if (!(await stage.load(next)) || disposed || operation !== modelOperation) return;
    recording.stop();
    model = next;
    modelRevision++;
    profileRevision++;
    mapper.reset();
    settings = switchProfile(settings, next.path);
    settings.recentModels = [
      { name: next.name, path: next.path },
      ...settings.recentModels.filter((m) => m.path !== next.path),
    ].slice(0, 5);
    stage.display(settings);
    publish();
    await hotkeys.set(settings.hotkeys);
    if (disposed || operation !== modelOperation) return;
    await save();
    await syncOutput();
    if (!previews[next.path]) {
      try {
        await savePreview(next, stage.thumbnail());
      } catch {
        notify('角色已加载，但预览保存失败。请检查磁盘空间和目录权限。', true);
        return;
      }
    }
    if (operation === modelOperation) notify('角色已就位。开始跟踪后，保持自然姿态并校准。');
  }
  async function loadModel(load: () => Promise<ModelInfo | null>) {
    if (modelLoading || disposed) return;
    modelLoading = true;
    const operation = ++modelOperation;
    publish();
    try {
      const next = await load();
      if (next) await useModel(next, operation);
    } finally {
      if (operation === modelOperation) {
        modelLoading = false;
        publish();
      }
    }
  }
  const own = async (subscription: Promise<UnlistenFn>) => {
    const unlisten = await subscription;
    if (disposed) unlisten();
    else unlisteners.push(unlisten);
  };
  const actions = {
    run,
    motionMode: 'once' as MotionMode,
    setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
      settings = readSettings({ ...settings, [key]: value });
      if (key === 'engine' || key === 'deviceId') {
        settings.neutral = null;
        mapper.reset();
      }
      changed();
    },
    devices,
    async start() {
      if (tracking !== 'stopped') return;
      const operation = ++trackingOperation;
      tracking = 'starting';
      lastFace = null;
      lastFaceAt = 0;
      publish();
      try {
        const started = await tracker.start(structuredClone(settings));
        if (!started || disposed || operation !== trackingOperation) return;
        tracking = 'running';
        publish();
        await devices();
        notify(
          settings.engine === 'openseeface'
            ? '正在等待 OpenSeeFace 数据。外部模式请先启动跟踪程序。'
            : '已开始本地跟踪。建议先校准中立姿态。',
        );
      } catch (error) {
        if (!disposed && operation === trackingOperation) {
          tracking = 'stopped';
          publish();
          throw error;
        }
      }
    },
    async stop() {
      await stop();
      notify(
        settings.engine === 'openseeface' && !settings.pythonPath
          ? '已停止接收。外部 OpenSeeFace 进程需要单独关闭。'
          : '跟踪已停止，摄像头已释放。',
      );
    },
    pause() {
      if (!['running', 'paused'].includes(tracking)) return;
      tracking = tracking === 'paused' ? 'running' : 'paused';
      tracker.pause(tracking === 'paused');
      lastFace = null;
      notify(
        tracking === 'paused'
          ? '已暂停跟踪，角色回到中立姿态。点击停止可释放摄像头。'
          : '已继续跟踪。',
      );
    },
    async calibrate() {
      if (!isFace(lastFace) || performance.now() - lastFaceAt > 250)
        return notify('还没有稳定识别到人脸，请面向摄像头后重试。');
      if (lastFace.eyeLeft < 0.4 || lastFace.eyeRight < 0.4)
        return notify('请自然睁开双眼后再校准。');
      settings.neutral = { ...lastFace };
      mapper.reset();
      await save();
      notify('中立姿态已校准。现在可以自然转头、眨眼和说话。');
    },
    async importModel(kind: 'directory' | 'file') {
      if (!native)
        return notify(
          '模型导入需要桌面应用。当前是界面预览，可通过 npm run tauri dev 启动桌面版。',
        );
      await loadModel(() => invoke<ModelInfo | null>('choose_model', { kind }));
    },
    async openLibrary() {
      if (!native) return notify('请在桌面应用中打开角色文件夹。');
      await invoke('open_models_directory');
    },
    async recentModel(path: string) {
      if (path && path !== model?.path && native)
        await loadModel(() => invoke<ModelInfo>('load_model', { path }));
    },
    async importPaths(paths: string[]) {
      if (!native || disposed) return;
      if (!ready || modelLoading) return notify('角色正在加载，请稍后再拖入。');
      if (!paths.length || paths.length > 32)
        return notify('每次可拖入 1 至 32 个模型目录、入口文件或 ZIP 包。', true);
      modelLoading = true;
      const operation = ++modelOperation;
      const errors: string[] = [];
      let imported = 0;
      publish();
      try {
        for (const path of new Set(paths)) {
          if (disposed || operation !== modelOperation) return;
          try {
            const next = await invoke<ModelInfo>('load_model', { path });
            imported++;
            await useModel(next, operation);
          } catch (error) {
            errors.push(
              `${path.split(/[\\/]/).pop()}：${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
        if (operation === modelOperation)
          notify(
            `已加入 ${imported} 个角色。${errors.length ? errors.join('；') : '角色已复制到角色库，可随时切换。'}`,
            !!errors.length,
          );
      } finally {
        if (operation === modelOperation) {
          modelLoading = false;
          publish();
        }
      }
    },
    pan(dx: number, dy: number) {
      if (!model || modelLoading || disposed) return;
      settings = readSettings({ ...settings, x: settings.x + dx, y: settings.y + dy });
      changed();
    },
    zoom(factor: number, anchorX: number, anchorY: number) {
      if (!model || modelLoading || disposed) return;
      const next = readSettings({ ...settings, zoom: settings.zoom * factor });
      const ratio = next.zoom / settings.zoom;
      settings = readSettings({
        ...next,
        x: anchorX - (anchorX - settings.x) * ratio,
        y: anchorY - (anchorY - settings.y) * ratio,
      });
      changed();
    },
    resetDisplay() {
      Object.assign(settings, { zoom: 1, x: 0, y: 0, background: defaults.background });
      changed();
    },
    resetTracking() {
      for (const key of [
        'sensitivity',
        'eyeSensitivity',
        'mouthSensitivity',
        'headSmooth',
        'eyeSmooth',
        'mouthSmooth',
        'lostDelay',
        'motionMirror',
        'neutral',
      ] as const)
        Object.assign(settings, { [key]: defaults[key] });
      mapper.reset();
      changed();
    },
    saveMapping(id: string, mapping: Mapping) {
      const parameter = stage?.parameters.find((p) => p.id === id);
      if (!parameter) return;
      if (
        !Object.hasOwn(faceSources, mapping.source) ||
        ![
          mapping.inputMin,
          mapping.inputMax,
          mapping.outputMin,
          mapping.outputMax,
          mapping.smoothing,
        ].every(Number.isFinite) ||
        mapping.inputMin >= mapping.inputMax ||
        Math.abs(mapping.inputMin) > 1000 ||
        Math.abs(mapping.inputMax) > 1000 ||
        mapping.smoothing < 0 ||
        mapping.smoothing > 0.5 ||
        [mapping.outputMin, mapping.outputMax].some((v) => v < parameter.min || v > parameter.max)
      )
        throw new Error(
          `请填写有效范围：输入下限小于上限，输出在 ${parameter.min} 至 ${parameter.max} 之间，平滑时间为 0 至 0.5 秒。`,
        );
      settings.mappings[id] = mapping;
      mapper.reset();
      changed();
      notify('映射已应用，并自动保存到当前模型。');
    },
    resetMapping(id: string) {
      delete settings.mappings[id];
      profileRevision++;
      mapper.reset();
      changed();
    },
    modelAction,
    async applyHotkey(id: string, binding: string) {
      if (!model) return;
      if (binding.trim()) settings.hotkeys[id] = binding.trim();
      else delete settings.hotkeys[id];
      publish();
      await hotkeys.set(settings.hotkeys);
      await save();
    },
    async resetProfile() {
      if (!model) return;
      const path = model.path;
      delete settings.profiles[path];
      settings.modelPath = '';
      settings = switchProfile(settings, path);
      stage?.stopMotion();
      stage?.clearExpressions();
      mapper.reset();
      profileRevision++;
      await hotkeys.set(settings.hotkeys);
      changed();
      notify('当前模型的映射、校准、构图、快捷键和待机已重置。');
    },
    toggleRecording() {
      if (recording.active) recording.stop();
      else if (model) recording.start();
      publish();
    },
    async saveRecording() {
      const motion = recording.export();
      if (!motion) return;
      if (native) {
        if (await invoke<boolean>('save_motion', { motion }))
          notify('动作已保存为 .motion3.json。');
      } else {
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(motion)], { type: 'application/json' }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = 'VTubeLeaf.motion3.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    },
    async resetAll() {
      modelOperation++;
      modelLoading = false;
      stage?.clear();
      await stop();
      if (disposed) return;
      settings = structuredClone(defaults);
      model = null;
      modelRevision++;
      profileRevision++;
      recording.stop();
      await hotkeys.set({});
      mapper.reset();
      changed();
      await devices();
      notify('已恢复默认设置。');
    },
    async openOutput() {
      if (!native) {
        window.open('/?output=1', '_blank');
        return;
      }
      const existing = await WebviewWindow.getByLabel('output');
      if (existing) {
        await existing.show();
        await existing.setFocus();
        return;
      }
      const outputWindow = new WebviewWindow('output', {
        title: 'VTubeLeaf Output',
        url: 'index.html?output=1',
        width: 1280,
        height: 720,
        minWidth: 320,
        minHeight: 180,
        backgroundColor: settings.background,
        backgroundThrottling: 'disabled' as BackgroundThrottlingPolicy,
      });
      await own(
        outputWindow.once('tauri://error', () => notify('输出窗口创建失败，请重试。', true)),
      );
    },
  };
  const devicechange = () => {
    void devices().catch(() => {});
  };
  async function initialize() {
    try {
      const stored = native
        ? await invoke('load_settings')
        : JSON.parse(localStorage.getItem('vtubeleaf-preview') ?? 'null');
      if (disposed) return;
      settings = readSettings(stored);
    } catch {
      notify('上次设置无法读取，已使用默认设置。请重新选择模型与摄像头。', true);
    }
    if (disposed) return;
    try {
      stage = new AvatarStage(container, () =>
        notify('显卡上下文已丢失。请重新加载角色；反复失败时重启应用。', true),
      );
      stage.display(settings);
    } catch {
      notify('无法初始化 WebGL。请检查显卡驱动或系统 WebView。', true);
    }
    if (native) {
      await run(refreshLibrary);
      if (disposed) return;
      await own(
        getCurrentWindow().onDragDropEvent(({ payload }) => {
          dropActive = payload.type === 'enter' || payload.type === 'over';
          publish();
          if (payload.type === 'drop') void run(() => actions.importPaths(payload.paths));
        }),
      );
      if (disposed) return;
      await own(
        listen('output-ready', () => {
          outputOpen = true;
          run(syncOutput);
        }),
      );
      if (disposed) return;
      await own(
        listen('output-closed', () => {
          outputOpen = false;
        }),
      );
      if (disposed) return;
      await own(listen<string>('output-error', (event) => notify(event.payload, true)));
      if (disposed) return;
      await own(
        getCurrentWindow().onCloseRequested(async (event) => {
          event.preventDefault();
          try {
            await stop();
            await save();
            await hotkeys.destroy();
            await (await WebviewWindow.getByLabel('output'))?.close();
            await getCurrentWindow().destroy();
          } catch (error) {
            report(error);
          }
        }),
      );
      if (disposed) return;
    }
    await devices().catch(() => notify('暂时无法枚举摄像头。开始时会请求权限。'));
    if (disposed) return;
    navigator.mediaDevices?.addEventListener('devicechange', devicechange);
    if (native && settings.modelPath) {
      try {
        await loadModel(async () => {
          const next = await invoke<ModelInfo>('load_model', { path: settings.modelPath });
          if (next.path !== settings.modelPath) {
            rememberProfile(settings);
            settings.profiles[next.path] = settings.profiles[settings.modelPath];
          }
          return next;
        });
      } catch (error) {
        notify(
          `上次角色未能恢复。${error instanceof Error ? error.message : String(error)} 请重新导入。`,
          true,
        );
      }
    }
    ready = true;
    publish();
  }
  void initialize().catch((error) => {
    ready = true;
    report(error);
  });
  let before = performance.now(),
    frames = 0,
    since = before;
  const timer = window.setInterval(() => {
    const now = performance.now(),
      dt = now - before;
    before = now;
    const face =
      tracking === 'running' && now - lastFaceAt < settings.lostDelay * 1000 ? lastFace : null;
    stage?.draw(mapper.map(face, stage?.parameters ?? [], settings, dt / 1000), dt);
    recording.capture(stage?.frame ?? {}, now);
    if (native && outputOpen && !frameSending) {
      frameSending = true;
      void emitTo('output', 'output-frame', {
        revision: modelRevision,
        parameters: stage?.frame ?? {},
        parts: stage?.parts ?? {},
      })
        .catch(() => {
          outputOpen = false;
        })
        .finally(() => {
          frameSending = false;
        });
    }
    frames++;
    if (now - since > 1000) {
      renderStatus = `${Math.round((frames * 1000) / (now - since))} FPS · ${tracker.inferenceMs.toFixed(0)} ms 推理`;
      faceStatus =
        tracking === 'running'
          ? face
            ? '已识别人脸'
            : '未识别人脸 · 等待 / 回中立'
          : tracking === 'paused'
            ? '采集仍在使用，停止可释放'
            : '点击开始后才会采集';
      faceInput = face ? normalizedFace(face, settings) : {};
      frames = 0;
      since = now;
      publish();
    }
  }, 1000 / 30);
  return {
    actions,
    snapshot,
    destroy() {
      disposed = true;
      modelOperation++;
      trackingOperation++;
      window.clearInterval(timer);
      if (saveTimer) void save();
      unlisteners.forEach((unlisten) => unlisten());
      navigator.mediaDevices?.removeEventListener('devicechange', devicechange);
      void tracker.stop().catch(() => {});
      void hotkeys.destroy();
      stage?.destroy();
      previewStage?.clear();
      Object.values(previews).forEach(URL.revokeObjectURL);
    },
  };
}
export type Studio = ReturnType<typeof createStudio>;
export type StudioView = ReturnType<Studio['snapshot']>;
