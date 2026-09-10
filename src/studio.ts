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
import { sampleCalibration } from './calibration';
import { AudioLipSync, type Vowel } from './lipsync';
import { VirtualCamera, type CameraStatus } from './virtual-camera';
import { importVtsConfig } from './vts';
import { readComposition, snapshotScene, type Composition, type SceneItem } from './scenes';
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
  let selectedItem = '';
  let sceneBusy = false;
  let cameraStatus: CameraStatus = {
    supported: false,
    installed: false,
    active: false,
    message: '原生虚拟摄像头需要 macOS 桌面应用',
  };
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
  let micDevices: MediaDeviceInfo[] = [];
  let micStarting = false;
  let micOperation = 0;
  let voiceOperation = 0;
  let voiceCalibration: Vowel | null = null;
  let calibration: {
    mode: 'neutral' | 'eyes';
    after: number;
    samples: { at: number; face: Face }[];
  } | null = null;
  let calibrationTimer = 0;
  let inputFrames = 0;
  let renderStatus = '画面预览';
  let faceStatus = '点击开始后才会采集';
  let faceInput: Partial<Face> = {};
  let notice = { message: '画面与跟踪数据仅在本机处理；麦克风需单独开启。', error: false };
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
    selectedItem,
    sceneBusy,
    virtualCamera: cameraStatus,
    cameraDevices,
    micDevices,
    micActive: audio.active,
    micStarting,
    micLabel: audio.deviceLabel,
    voiceCalibration,
    calibrating: calibration?.mode ?? null,
    cameraLabel: tracker.cameraLabel,
    cameraSettings: tracker.cameraSettings,
    renderStatus,
    faceStatus,
    bodyStatus: tracker.bodyStatus,
    handStatus: tracker.handStatus,
    faceInput,
    notice,
    events: [...events],
    parameters: stage?.parameters ?? [],
    expressions: stage?.expressions ?? [],
    motions: stage?.motions ?? [],
    physicsGroups: stage?.physicsGroups ?? [],
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
  const audio = new AudioLipSync((message) => {
    micOperation++;
    voiceOperation++;
    micStarting = false;
    voiceCalibration = null;
    notify(message, true);
  });
  async function stopAudio() {
    micOperation++;
    voiceOperation++;
    micStarting = false;
    voiceCalibration = null;
    await audio.stop();
  }
  function cancelCalibration() {
    window.clearTimeout(calibrationTimer);
    calibration = null;
  }
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
        models: library,
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
    micDevices = next.filter((d) => d.kind === 'audioinput' && d.deviceId);
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
  const virtualCamera = new VirtualCamera((status) => {
    cameraStatus = status;
    if (ready) publish();
  });
  const bindHotkeys = () =>
    hotkeys.set({ ...settings.globalHotkeys, ...settings.hotkeys }, settings.hotkeyOptions);
  const heldExpressions = new Set<string>();
  async function shortcutAction(id: string, pressed: boolean) {
    const options = settings.hotkeyOptions[id];
    if (!pressed) {
      if (heldExpressions.delete(id)) {
        stage?.setExpression(id.slice(11), false);
        publish();
      }
      return;
    }
    if (options && id.startsWith('expression:')) {
      if (options.release) {
        heldExpressions.add(id);
        stage?.setExpression(id.slice(11), true, options.seconds);
      } else stage?.toggleExpression(id.slice(11), options.seconds);
      publish();
      return;
    }
    if (options?.motionMode === 'hold' && id.startsWith('motion:')) {
      stage?.toggleHeldMotion(id.slice(7));
      publish();
      return;
    }
    if (id === 'toggle-tracking') await (tracking === 'stopped' ? actions.start() : actions.stop());
    else if (id === 'calibrate') actions.calibrate();
    else if (id === 'toggle-mic') await actions.toggleMic();
    else if (id === 'toggle-model') actions.setSetting('modelVisible', !settings.modelVisible);
    else if (id === 'toggle-camera')
      await (cameraStatus.active ? virtualCamera.stop() : virtualCamera.start());
    else if (id === 'pause-tracking') actions.pause();
    else if (id === 'stop-tracking') await actions.stop();
    else if (id === 'reset-display') actions.resetDisplay();
    else if (id === 'open-output') await actions.openOutput();
    else if (id.startsWith('scene:')) await actions.recallScene(id.slice(6));
    else if (id.startsWith('item:')) {
      const item = settings.composition.items.find((item) => item.id === id.slice(5));
      if (item) actions.updateItem(item.id, { visible: !item.visible });
    } else modelAction(id, options?.motionMode ?? actions.motionMode);
  }
  const hotkeys = new Hotkeys((id, pressed) => run(() => shortcutAction(id, pressed)), report);
  async function setComposition(composition: Composition) {
    const wasBusy = sceneBusy;
    sceneBusy = true;
    publish();
    try {
      const next = readSettings({ ...settings, composition });
      await stage?.compose(next, library);
      if (disposed) return;
      settings.composition = next.composition;
      changed();
    } finally {
      sceneBusy = wasBusy;
      publish();
    }
  }
  const tracker = new Tracker(
    video,
    (face) => {
      if (!disposed) {
        lastFace = face;
        lastFaceAt = performance.now();
        inputFrames++;
        if (calibration && lastFaceAt >= calibration.after && isFace(face))
          calibration.samples.push({ at: lastFaceAt, face: { ...face } });
      }
    },
    (error) => {
      trackingOperation++;
      tracking = 'stopped';
      lastFace = null;
      cancelCalibration();
      notify(error, true);
    },
    preview,
  );
  async function stop() {
    trackingOperation++;
    tracking = 'stopped';
    lastFace = null;
    faceStatus = '跟踪已停止';
    faceInput = {};
    cancelCalibration();
    micStarting = false;
    voiceCalibration = null;
    publish();
    await Promise.all([tracker.stop(), stopAudio()]);
    publish();
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
  function applyVts(result: ReturnType<typeof importVtsConfig>) {
    settings = readSettings({
      ...settings,
      ...result.profile,
      mappings: { ...settings.mappings, ...result.profile.mappings },
      hotkeys: { ...settings.hotkeys, ...result.profile.hotkeys },
      hotkeyOptions: { ...settings.hotkeyOptions, ...result.profile.hotkeyOptions },
      vtsImportReport: [result.summary, ...result.warnings],
    });
  }
  async function useModel(next: ModelInfo, operation: number) {
    if (disposed || operation !== modelOperation) return;
    if (!stage) throw new Error('WebGL 渲染不可用。请检查显卡驱动或重新启动应用。');
    cancelCalibration();
    await stopAudio();
    voiceCalibration = null;
    notify('正在加载角色资源…');
    library = [...library.filter((entry) => entry.path !== next.path), next];
    publish();
    await readPreview(next);
    if (disposed || operation !== modelOperation) return;
    if (!(await stage.load(next)) || disposed || operation !== modelOperation) return;
    let vts: ReturnType<typeof importVtsConfig> | undefined;
    let vtsError = '';
    // Existing profiles own subsequent tuning, including restoration after restarting.
    if (
      native &&
      next.path !== settings.modelPath &&
      !Object.hasOwn(settings.profiles, next.path)
    ) {
      try {
        const raw = await invoke<unknown>('read_model_vts_config', { id: next.id });
        if (disposed || operation !== modelOperation) return;
        if (raw != null) vts = importVtsConfig(raw, stage);
      } catch (error) {
        vtsError = `VTS 自动导入已跳过：${error instanceof Error ? error.message : String(error)}。可通过“导入 VTube Studio 配置”重试。`;
      }
    }
    if (disposed || operation !== modelOperation) return;
    recording.stop();
    model = next;
    modelRevision++;
    profileRevision++;
    mapper.reset();
    settings = switchProfile(settings, next.path);
    if (vts) applyVts(vts);
    else if (vtsError) settings.vtsImportReport = [vtsError];
    settings.recentModels = [
      { name: next.name, path: next.path },
      ...settings.recentModels.filter((m) => m.path !== next.path),
    ].slice(0, 5);
    stage.display(settings);
    publish();
    await bindHotkeys();
    if (disposed || operation !== modelOperation) return;
    await save();
    await syncOutput().catch(() => {
      outputOpen = false;
    });
    if (!previews[next.path]) {
      try {
        await savePreview(next, stage.thumbnail());
      } catch {
        notify('角色已加载，但预览保存失败。请检查磁盘空间和目录权限。', true);
        return;
      }
    }
    if (operation === modelOperation)
      notify(
        `角色已就位。${vtsError || vts?.summary || '开始跟踪后，保持自然姿态并校准。'}`,
        !!vtsError,
      );
    return vtsError;
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
    async importVts() {
      if (!native || !model || !stage || modelLoading || sceneBusy) return;
      const revision = profileRevision;
      const raw = await invoke<unknown>('choose_vts_config');
      if (raw == null || disposed || revision !== profileRevision || modelLoading || sceneBusy)
        return;
      const result = importVtsConfig(raw, stage);
      applyVts(result);
      profileRevision++;
      mapper.reset();
      await bindHotkeys();
      changed();
      notify(result.summary);
    },
    installCamera: () => virtualCamera.install(),
    uninstallCamera: () => virtualCamera.uninstall(),
    startCamera: () => virtualCamera.start(),
    stopCamera: () => virtualCamera.stop(),
    refreshCamera: () => virtualCamera.refresh(),
    selectItem(id: string) {
      selectedItem = id;
      publish();
    },
    updateItem(id: string, patch: Partial<SceneItem>) {
      if (sceneBusy) return;
      settings.composition = readComposition({
        ...settings.composition,
        items: settings.composition.items.map((item) =>
          item.id === id
            ? { ...item, ...patch, id: item.id, source: item.source, kind: item.kind }
            : item,
        ),
      });
      changed();
    },
    async removeItem(id: string) {
      if (sceneBusy) return;
      await setComposition({
        ...settings.composition,
        items: settings.composition.items.filter((item) => item.id !== id),
      });
      delete settings.globalHotkeys[`item:${id}`];
      if (selectedItem === id) selectedItem = '';
      await bindHotkeys();
      changed();
    },
    async importAsset(background = false) {
      if (!native) return notify('素材导入需要桌面应用。');
      if (sceneBusy) return;
      if (!background && settings.composition.items.length >= 32)
        throw new Error('每个场景最多 32 个道具');
      sceneBusy = true;
      publish();
      try {
        const asset = await invoke<{ id: string; name: string } | null>('choose_asset');
        if (!asset || disposed) return;
        if (background)
          await setComposition({ ...settings.composition, backgroundImage: asset.id });
        else {
          const id = crypto.randomUUID();
          const next = readComposition({
            ...settings.composition,
            items: [
              ...settings.composition.items,
              { id, kind: 'image', source: asset.id, name: asset.name },
            ],
          });
          await setComposition(next);
          selectedItem = id;
        }
      } finally {
        sceneBusy = false;
        publish();
      }
    },
    async setBackground(backgroundImage = '') {
      if (!sceneBusy) await setComposition({ ...settings.composition, backgroundImage });
    },
    async addLive2DItem(path: string) {
      if (sceneBusy || !path) return;
      if (
        settings.composition.items.length >= 32 ||
        settings.composition.items.filter((i) => i.kind === 'live2d').length >= 4
      )
        throw new Error('每个场景最多 32 个道具，其中最多 4 个 Live2D 道具');
      const entry = library.find((m) => m.path === path);
      if (!entry) return;
      sceneBusy = true;
      publish();
      try {
        const id = crypto.randomUUID();
        await setComposition(
          readComposition({
            ...settings.composition,
            items: [
              ...settings.composition.items,
              { id, name: entry.name, kind: 'live2d', source: path },
            ],
          }),
        );
        selectedItem = id;
      } finally {
        sceneBusy = false;
        publish();
      }
    },
    reorderItem(id: string, offset: number) {
      if (sceneBusy) return;
      const items = [...settings.composition.items];
      const index = items.findIndex((i) => i.id === id),
        target = index + offset;
      if (index < 0 || target < 0 || target >= items.length) return;
      [items[index], items[target]] = [items[target], items[index]];
      settings.composition.items = items;
      changed();
    },
    saveScene(name: string, id = '') {
      if (sceneBusy || !name.trim()) return;
      if (!id && settings.scenes.length >= 32) throw new Error('最多保存 32 个场景');
      const scene = snapshotScene(
        id || crypto.randomUUID(),
        name.trim(),
        settings.modelPath,
        settings.background,
        {
          x: settings.x,
          y: settings.y,
          zoom: settings.zoom,
          rotation: settings.rotation,
          modelVisible: settings.modelVisible,
        },
        settings.composition,
      );
      settings.scenes = [...settings.scenes.filter((s) => s.id !== scene.id), scene];
      changed();
    },
    renameScene(id: string, name: string) {
      if (sceneBusy) return;
      if (name.trim()) {
        settings.scenes = settings.scenes.map((s) =>
          s.id === id ? { ...s, name: name.trim().slice(0, 100) } : s,
        );
        changed();
      }
    },
    async deleteScene(id: string) {
      if (sceneBusy) return;
      settings.scenes = settings.scenes.filter((s) => s.id !== id);
      delete settings.globalHotkeys[`scene:${id}`];
      await bindHotkeys();
      changed();
    },
    async recallScene(id: string) {
      if (sceneBusy || modelLoading) return;
      const scene = settings.scenes.find((s) => s.id === id);
      if (!scene) return;
      sceneBusy = true;
      publish();
      const operation = ++modelOperation;
      let candidate: AvatarStage | undefined;
      try {
        if (!stage) throw new Error('WebGL 渲染不可用');
        let nextModel = model;
        if (scene.modelPath && scene.modelPath !== model?.path) {
          if (!native) throw new Error('切换场景角色需要桌面应用');
          nextModel = await invoke<ModelInfo>('load_model', { path: scene.modelPath });
        } else if (!scene.modelPath) nextModel = null;
        if (disposed || operation !== modelOperation) return;
        const sceneSettings = () =>
          readSettings({
            ...switchProfile(settings, scene.modelPath),
            ...scene.placement,
            background: scene.background,
            composition: scene.composition,
          });
        candidate = await stage.prepare(nextModel, sceneSettings(), library);
        if (disposed || operation !== modelOperation) return;
        if (nextModel?.path !== model?.path) {
          cancelCalibration();
          await stopAudio();
        }
        if (disposed || operation !== modelOperation) return;
        settings = sceneSettings();
        candidate.display(settings);
        candidate.mount(container);
        stage.destroy();
        stage = candidate;
        candidate = undefined;
        model = nextModel;
        modelRevision++;
        profileRevision++;
        recording.stop();
        mapper.reset();
        if (model) {
          library = [...library.filter((entry) => entry.path !== model!.path), model];
          settings.recentModels = [
            { name: model.name, path: model.path },
            ...settings.recentModels.filter((m) => m.path !== model!.path),
          ].slice(0, 5);
        }
        selectedItem = '';
        changed();
        await bindHotkeys();
        notify(`已切换到场景「${scene.name}」。`);
      } finally {
        candidate?.destroy();
        sceneBusy = false;
        publish();
      }
    },
    setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
      settings = readSettings({ ...settings, [key]: value });
      if (key === 'engine' || key === 'deviceId') {
        cancelCalibration();
        settings.neutral = null;
        settings.eyeClosedLeft = settings.eyeClosedRight = null;
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
            : settings.engine === 'nvidia'
              ? 'NVIDIA RTX（实验中）正在加载模型，首次启动可能需要两分钟。识别到面部后请校准。'
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
      audio.pause(tracking === 'paused');
      cancelCalibration();
      lastFace = null;
      notify(
        tracking === 'paused'
          ? '已暂停跟踪，角色回到中立姿态。点击停止可释放摄像头。'
          : '已继续跟踪。',
      );
    },
    calibrate(mode: 'neutral' | 'eyes' = 'neutral') {
      if (tracking !== 'running' || calibration) return;
      if (!isFace(lastFace) || performance.now() - lastFaceAt > 250)
        return notify('还没有稳定识别到人脸，请面向摄像头后重试。');
      if (mode === 'eyes' && !settings.neutral) return notify('请先校准自然睁眼的中立姿态。');
      const current = (calibration = { mode, after: performance.now() + 1000, samples: [] });
      notify(
        mode === 'eyes'
          ? '请闭合双眼并保持不动，3 秒后完成。'
          : '请正视镜头、自然睁眼闭嘴并保持不动，3 秒后完成。',
      );
      calibrationTimer = window.setTimeout(
        () =>
          void run(async () => {
            if (calibration !== current) return;
            calibration = null;
            publish();
            const result = sampleCalibration(current.samples, mode);
            if (mode === 'eyes') {
              if (
                settings.neutral!.eyeLeft - result.eyeLeft < 0.15 ||
                settings.neutral!.eyeRight - result.eyeRight < 0.15
              )
                throw new Error('睁眼与闭眼的差距不足，请调整光线后重新校准。');
              settings.eyeClosedLeft = result.eyeLeft;
              settings.eyeClosedRight = result.eyeRight;
            } else {
              settings.neutral = result;
              settings.eyeClosedLeft = settings.eyeClosedRight = null;
            }
            mapper.reset();
            await save();
            notify(
              mode === 'eyes'
                ? '双眼闭合位置已校准。'
                : '中立姿态已校准，可以自然转头、眨眼和说话。',
            );
          }),
        2600,
      );
    },
    async toggleMic() {
      if (audio.active || micStarting) {
        await stopAudio();
        return notify('麦克风已关闭并释放。');
      }
      micStarting = true;
      const operation = ++micOperation;
      publish();
      try {
        await audio.start(settings.micDeviceId);
        if (!disposed && operation === micOperation && audio.active) {
          audio.pause(tracking === 'paused');
          await devices();
          notify('麦克风已开启；声音只在本机用于口型，不录音。');
        }
      } finally {
        if (operation === micOperation) {
          micStarting = false;
          publish();
        }
      }
    },
    async calibrateVoice(vowel: Vowel) {
      if (!audio.active || voiceCalibration) return;
      const revision = profileRevision;
      const operation = ++voiceOperation;
      voiceCalibration = vowel;
      notify(`请持续发 ${vowel} 音约一秒。`);
      try {
        const template = await audio.calibrate();
        if (
          disposed ||
          operation !== voiceOperation ||
          revision !== profileRevision ||
          voiceCalibration !== vowel
        )
          return;
        settings.voiceTemplates = { ...settings.voiceTemplates, [vowel]: template };
        await save();
        notify(`${vowel} 音已校准。`);
      } finally {
        if (operation === voiceOperation) {
          voiceCalibration = null;
          publish();
        }
      }
    },
    async importModel(kind: 'directory' | 'file') {
      if (sceneBusy) return;
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
      if (!sceneBusy && path && path !== model?.path && native)
        await loadModel(() => invoke<ModelInfo>('load_model', { path }));
    },
    async importPaths(paths: string[]) {
      if (!native || disposed) return;
      if (!ready || modelLoading || sceneBusy) return notify('角色或场景正在加载，请稍后再拖入。');
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
            const warning = await useModel(next, operation);
            if (warning) errors.push(`${next.name}：${warning}`);
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
      if (sceneBusy || modelLoading || disposed) return;
      const item = settings.composition.items.find((i) => i.id === selectedItem);
      if (item) {
        if (item.attach === 'model') {
          const { width, height } = container.getBoundingClientRect();
          if (!width || !height) return;
          const angle = (settings.rotation * Math.PI) / 180;
          const x = dx * width,
            y = dy * height;
          dx = (x * Math.cos(angle) + y * Math.sin(angle)) / (width * settings.zoom);
          dy = (-x * Math.sin(angle) + y * Math.cos(angle)) / (height * settings.zoom);
        }
        if (!item.locked) actions.updateItem(item.id, { x: item.x + dx, y: item.y + dy });
        return;
      }
      if (!model) return;
      settings = readSettings({ ...settings, x: settings.x + dx, y: settings.y + dy });
      changed();
    },
    zoom(factor: number, anchorX: number, anchorY: number) {
      if (sceneBusy || modelLoading || disposed) return;
      const item = settings.composition.items.find((i) => i.id === selectedItem);
      if (item) {
        if (!item.locked) actions.updateItem(item.id, { scale: item.scale * factor });
        return;
      }
      if (!model) return;
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
      Object.assign(settings, {
        rotation: 0,
        zoom: 1,
        x: 0,
        y: 0,
        background: defaults.background,
      });
      changed();
    },
    resetTracking() {
      cancelCalibration();
      for (const key of [
        'sensitivity',
        'eyeSensitivity',
        'eyeClosedThreshold',
        'eyeClosedLeft',
        'eyeClosedRight',
        'eyeLink',
        'eyeLinkAngle',
        'mouthSensitivity',
        'headSmooth',
        'eyeSmooth',
        'mouthSmooth',
        'lostDelay',
        'lostMode',
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
      const global = !['expression:', 'motion:', 'stop-motion', 'clear-expressions'].some(
        (prefix) => id.startsWith(prefix),
      );
      if (!global && !model) return;
      const bindings = global ? settings.globalHotkeys : settings.hotkeys;
      if (!global) delete settings.hotkeyOptions[id];
      if (binding.trim()) bindings[id] = binding.trim();
      else delete bindings[id];
      publish();
      await bindHotkeys();
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
      await bindHotkeys();
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
      await stage?.compose(settings, library);
      selectedItem = '';
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
            await virtualCamera.stop();
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
    await run(() => stage?.compose(settings, library));
    await bindHotkeys();
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
  let timer = 0;
  function tick() {
    if (disposed) return;
    const now = performance.now(),
      dt = now - before;
    before = now;
    let face =
      tracking === 'running' &&
      (now - lastFaceAt < settings.lostDelay * 1000 || settings.lostMode === 'hold')
        ? lastFace
        : null;
    if (audio.active && tracking !== 'paused')
      face = {
        ...face,
        ...audio.read(settings.micGain, settings.micNoiseGate, settings.voiceTemplates),
      };
    stage?.draw(mapper.map(face, stage?.parameters ?? [], settings, dt / 1000), dt);
    if (stage) virtualCamera.submit(stage.canvas, settings.background);
    recording.capture(stage?.frame ?? {}, now);
    if (native && outputOpen && !frameSending) {
      frameSending = true;
      void emitTo('output', 'output-frame', {
        revision: modelRevision,
        parameters: stage?.frame ?? {},
        parts: stage?.parts ?? {},
        sceneFrames: stage?.sceneFrames ?? {},
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
      renderStatus = `${Math.round((frames * 1000) / (now - since))} FPS 渲染 · ${Math.round((inputFrames * 1000) / (now - since))} FPS 输入 · ${tracker.inferenceMs.toFixed(0)} ms 推理`;
      faceStatus =
        tracking === 'running'
          ? now - lastFaceAt < settings.lostDelay * 1000 && isFace(lastFace)
            ? '已识别人脸'
            : settings.lostMode === 'hold'
              ? '未识别人脸 · 保持姿态'
              : '未识别人脸 · 等待 / 回中立'
          : tracking === 'paused'
            ? '采集仍在使用，停止可释放'
            : '点击开始后才会采集';
      faceInput = face ? normalizedFace(face, settings) : {};
      frames = 0;
      inputFrames = 0;
      since = now;
      publish();
    }
    timer = window.setTimeout(
      tick,
      Math.max(0, 1000 / settings.renderFps - (performance.now() - now)),
    );
  }
  timer = window.setTimeout(tick, 1000 / settings.renderFps);
  return {
    actions,
    snapshot,
    destroy() {
      disposed = true;
      modelOperation++;
      trackingOperation++;
      window.clearTimeout(timer);
      cancelCalibration();
      if (saveTimer) void save();
      unlisteners.forEach((unlisten) => unlisten());
      navigator.mediaDevices?.removeEventListener('devicechange', devicechange);
      void tracker.stop().catch(() => {});
      void stopAudio().catch(() => {});
      void hotkeys.destroy();
      virtualCamera.destroy();
      stage?.destroy();
      previewStage?.clear();
      Object.values(previews).forEach(URL.revokeObjectURL);
    },
  };
}
export type Studio = ReturnType<typeof createStudio>;
export type StudioView = ReturnType<Studio['snapshot']>;
