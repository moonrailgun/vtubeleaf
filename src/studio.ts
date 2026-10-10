import { invoke, isTauri } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, type BackgroundThrottlingPolicy } from '@tauri-apps/api/window';
import { AvatarStage, type ModelInfo, type MotionMode } from './renderer';
import { Tracker } from './tracker';
import { startFrameLoop } from './frame-loop';
import { enumerateCaptureDevices, isVTubeLeafCamera } from './camera-devices';
import {
  defaults,
  readSettings,
  readRange,
  FaceMapper,
  faceSources,
  rememberProfile,
  switchProfile,
  normalizedFace,
  isFace,
  type Mapping,
  type HotkeyOptions,
  clamp,
  type Face,
  type Settings,
  type ModelProfile,
} from './state';
import { Hotkeys, validateHotkey } from './hotkeys';
import { MotionRecording } from './recording';
import { sampleCalibration } from './calibration';
import { AudioLipSync, type Vowel } from './lipsync';
import { VirtualCamera, type CameraStatus } from './virtual-camera';
import { ObsOutput } from './obs-output';
import { importVtsConfig, repairVtsMappings } from './vts';
import { readComposition, snapshotScene, type Composition, type SceneItem } from './scenes';
import type { OutputFrame, OutputState } from './output';
import { AppUpdater } from './updater';
import { version } from '../package.json';
import { lang, t } from './i18n';

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
    message: t('studio.cameraNeedsMac'),
  };
  const previews: Record<string, string> = {};
  let previewStage: AvatarStage | undefined;
  let previewTask: Promise<void> | undefined;
  let previewReads: Promise<unknown> | undefined;
  let lastFace: Partial<Face> | null = null;
  let lastFaceAt = 0;
  let lastDetectedFaceAt = 0;
  let tracking: 'stopped' | 'starting' | 'running' | 'paused' = 'stopped';
  let trackingOperation = 0;
  let modelOperation = 0;
  let modelRevision = 0;
  let profileRevision = 0;
  let modelLoading = false;
  let outputOpen = false;
  let outputStale = false;
  let frameSending = false;
  let saveTimer = 0;
  let gestureTimer = 0;
  let saveQueue = Promise.resolve();
  let cameraDevices: MediaDeviceInfo[] = [];
  let micDevices: MediaDeviceInfo[] = [];
  let micStarting = false;
  let micLevel = 0;
  const micListeners = new Set<() => void>();
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
  let renderStatus = t('studio.renderPreview');
  let faceStatus = t('studio.faceIdle');
  let faceInput: Partial<Face> = {};
  let notice = { message: t('studio.privacyNotice'), error: false };
  const events: string[] = [];
  const unlisteners: UnlistenFn[] = [];
  const mapper = new FaceMapper();
  const recording = new MotionRecording();
  let savedRecordingRevision = -1;
  let updateTimer = 0;
  let updateInterval = 0;
  const updater = new AppUpdater(
    () => {
      publish();
      sendUpdateState();
    },
    async () => {
      if (recording.active) throw new Error(t('studio.updateRecording'));
      if (recording.duration > 0 && savedRecordingRevision !== recording.revision)
        throw new Error(t('studio.updateUnsavedRecording'));
      if (modelLoading || sceneBusy) throw new Error(t('studio.updateBusy'));
      await save(true);
      await virtualCamera.stop(true);
      await obsOutput.setEnabled(false);
      await stop();
      await (await WebviewWindow.getByLabel('output'))?.close();
    },
  );
  function sendUpdateState() {
    if (native && !disposed)
      void emitTo('about', 'update-state', {
        ...updater.state,
        autoCheckUpdates: settings.autoCheckUpdates,
      }).catch(() => {});
  }
  const snapshot = () => ({
    ready,
    updater: updater.state,
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
    obsOutput: { ...obsOutput.state },
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
  let publishQueued = false;
  const flush = () => {
    if (!publishQueued || disposed) return;
    publishQueued = false;
    update(snapshot());
  };
  // One React update per frame; hidden pages get no frames, so they flush in a microtask.
  // WebKit can also hold frames for seconds while the page still reports visible, so a timer
  // backs the frame up.
  // User input still updates synchronously, or React restores a controlled field's previous
  // value and the next key or move compares against a stale one (slider Home then ArrowRight;
  // WKWebView delivers several slider pointermoves per frame). Stage drags publish from a timer.
  const discrete = [
    'input',
    'change',
    'click',
    'keydown',
    'keyup',
    'pointerdown',
    'pointermove',
    'pointerup',
  ];
  const publish = () => {
    if (disposed) return;
    const queued = publishQueued;
    publishQueued = true;
    if (discrete.includes(window.event?.type ?? '')) flush();
    else if (document.hidden) queueMicrotask(flush);
    else if (!queued) {
      requestAnimationFrame(flush);
      setTimeout(flush, 100);
    }
  };
  function notify(message: string, error = false) {
    if (disposed) return;
    notice = { message, error };
    if (error) {
      events.unshift(`${new Date().toLocaleTimeString(lang)} · ${message}`);
      events.length = Math.min(events.length, 8);
      if (native) void emitTo('about', 'about-events', [...events]).catch(() => {});
    }
    publish();
  }
  const report = (error: unknown) =>
    notify(
      typeof error === 'string'
        ? error
        : error instanceof Error
          ? error.message
          : t('studio.failed'),
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
    if (disposed || updater.state.status === 'installing') return;
    try {
      await fn();
    } catch (error) {
      report(error);
    }
  };
  function save(requireSuccess = false) {
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
          const message = t('studio.saveFailed');
          notify(message, true);
          if (requireSuccess) throw new Error(message);
        }
      });
    return saveQueue;
  }
  async function syncOutput() {
    outputStale = false;
    if (native && outputOpen && !disposed)
      await emitTo('output', 'output-state', {
        model,
        models: library,
        settings,
        revision: modelRevision,
      } satisfies OutputState);
  }
  // Window transparency is fixed at creation, so an open output window is recreated.
  // Serialized so fast toggles never create two windows under one label.
  let outputReopen = Promise.resolve();
  function reopenOutput() {
    outputReopen = outputReopen.then(() =>
      run(async () => {
        const existing = await WebviewWindow.getByLabel('output');
        if (!existing) return;
        await existing.close();
        // The label stays taken until the old window is destroyed.
        for (let i = 0; i < 40 && (await WebviewWindow.getByLabel('output')); i++)
          await new Promise((resolve) => setTimeout(resolve, 50));
        await actions.openOutput();
      }),
    );
  }
  function changed(gesture = false) {
    stage?.display(settings);
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), 250);
    // The next render tick sends the output window the latest settings, at most once per frame.
    outputStale = true;
    if (!gesture) publish();
    // Stage drags and wheel zooms redraw on every event but refresh the panels ~10 times a second.
    else
      gestureTimer ||= window.setTimeout(() => {
        gestureTimer = 0;
        publish();
      }, 100);
  }
  async function devices(requestPermission = false) {
    const next = await enumerateCaptureDevices(requestPermission, () => disposed);
    if (disposed) return;
    cameraDevices = next.filter((d) => d.kind === 'videoinput' && d.deviceId);
    micDevices = next.filter((d) => d.kind === 'audioinput' && d.deviceId);
    if (
      cameraDevices.some(
        (device) => device.deviceId === settings.deviceId && isVTubeLeafCamera(device),
      )
    )
      actions.setSetting('deviceId', '');
    else publish();
  }
  function modelAction(id: string, mode: MotionMode = 'once') {
    if (!stage || !model || disposed) return;
    const options = settings.hotkeyOptions[id];
    if (id.startsWith('expression:'))
      stage.toggleExpression(id.slice(11), options?.seconds, options?.fadeSeconds);
    else if (id.startsWith('motion:')) stage.playMotion(id.slice(7), mode);
    else if (id === 'stop-motion') stage.stopMotion();
    else if (id === 'clear-expressions') stage.clearExpressions(options?.fadeSeconds);
    publish();
  }
  const virtualCamera = new VirtualCamera((status) => {
    cameraStatus = status;
    if (ready) publish();
  });
  const obsOutput = new ObsOutput(
    () => {
      if (ready) publish();
    },
    (message) => notify(message, true),
  );
  const outputPressed = new Set<string>();
  function releaseOutputHotkeys() {
    for (const id of outputPressed) void run(() => shortcutAction(id, false));
    outputPressed.clear();
  }
  const bindHotkeys = async () => {
    releaseOutputHotkeys();
    await hotkeys.set(
      settings.useKeyboardHotkeys ? { ...settings.globalHotkeys, ...settings.hotkeys } : {},
    );
    await syncOutput().catch(() => {
      outputOpen = false;
    });
  };
  const heldExpressions = new Set<string>();
  async function shortcutAction(id: string, pressed: boolean) {
    if (updater.state.status === 'installing') return;
    const options = settings.hotkeyOptions[id];
    if (!pressed) {
      if (heldExpressions.delete(id)) {
        stage?.setExpression(id.slice(11), false, undefined, options?.fadeSeconds);
        publish();
      }
      return;
    }
    if (!settings.useKeyboardHotkeys) return;
    if (options && id.startsWith('expression:')) {
      if (options.release) {
        heldExpressions.add(id);
        stage?.setExpression(id.slice(11), true, options.seconds, options.fadeSeconds);
      } else stage?.toggleExpression(id.slice(11), options.seconds, options.fadeSeconds);
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
        if (isFace(face)) lastDetectedFaceAt = lastFaceAt;
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
    faceStatus = t('studio.trackingStopped');
    faceInput = {};
    cancelCalibration();
    micStarting = false;
    voiceCalibration = null;
    publish();
    await Promise.all([
      tracker.stop(),
      stopAudio(),
      settings.autoStopVirtualCamera ? virtualCamera.stop() : undefined,
    ]);
    publish();
  }
  async function refreshLibrary() {
    const result = await invoke<{ models: ModelInfo[]; directory: string; errors: string[] }>(
      'list_models',
    );
    if (disposed) return;
    library = result.models;
    libraryDirectory = result.directory;
    if (result.errors.length)
      notify(
        t('studio.someModelsUnavailable', {
          errors: result.errors.join(t('studio.errorSeparator')),
        }),
        true,
      );
    publish();
    // Icons decode in the background, a few at a time, so they never delay restoring the model.
    const queue = [...library];
    const read = async () => {
      for (let entry; !disposed && (entry = queue.shift());) await readPreview(entry);
    };
    previewReads = Promise.all([read(), read(), read()]);
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
      if (disposed || previews[entry.path] || !library.some((item) => item.path === entry.path))
        return;
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
        (blob) => (blob ? resolve(blob) : reject(new Error(t('studio.previewFailed')))),
        'image/png',
      ),
    );
    if (disposed || previews[entry.path] || !library.some((item) => item.path === entry.path))
      return;
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
  function updateLibrary(next: ModelInfo) {
    library = library.some((entry) => entry.path === next.path)
      ? library.map((entry) => (entry.path === next.path ? next : entry))
      : [next, ...library];
  }
  async function readModelVts(
    next: ModelInfo,
    target: AvatarStage,
    existingProfile?: ModelProfile,
  ) {
    const operation = modelOperation;
    let vts: ReturnType<typeof importVtsConfig> | undefined;
    let vtsError = '';
    const needsSmileRepair =
      existingProfile?.vtsImportReport.length &&
      target.parameters.some((p) => {
        const m = existingProfile.mappings[p.id];
        return (
          m?.source === 'mouthSmile' &&
          m.inputMin === 0 &&
          m.inputMax === 1 &&
          p.default > Math.min(m.outputMin, m.outputMax) &&
          p.default < Math.max(m.outputMin, m.outputMax)
        );
      });
    // Legacy report lines were persisted by Chinese-only releases; match them verbatim.
    const needsMouthRepair = existingProfile?.vtsImportReport.some(
      (line) =>
        line.includes('范围超出当前模型或映射限制，已跳过') ||
        line.includes('嘴部开合输出端点已限制'),
    );
    // Read the original only for known legacy imports; repairs retain subsequent tuning.
    if (native && (!existingProfile || needsSmileRepair || needsMouthRepair)) {
      try {
        const raw = await invoke<unknown>('read_model_vts_config', { id: next.id });
        if (!disposed && operation === modelOperation && raw != null)
          vts = importVtsConfig(raw, target);
      } catch (error) {
        vtsError = t(existingProfile ? 'studio.vtsRepairSkipped' : 'studio.vtsImportSkipped', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return { vts, vtsError };
  }
  async function useModel(next: ModelInfo, operation: number) {
    if (disposed || operation !== modelOperation) return;
    if (!stage) throw new Error(t('studio.webglUnavailable'));
    cancelCalibration();
    await stopAudio();
    voiceCalibration = null;
    notify(t('studio.loadingModel'));
    updateLibrary(next);
    publish();
    // The icon loads alongside the model; it only decides below whether to save a thumbnail.
    const preview = readPreview(next);
    if (disposed || operation !== modelOperation) return;
    if (!(await stage.load(next)) || disposed || operation !== modelOperation) return;
    const existingProfile =
      next.path === settings.modelPath
        ? settings
        : Object.hasOwn(settings.profiles, next.path)
          ? settings.profiles[next.path]
          : undefined;
    const { vts, vtsError } = await readModelVts(next, stage, existingProfile);
    let vtsSummary = '';
    if (disposed || operation !== modelOperation) return;
    recording.stop();
    model = next;
    modelRevision++;
    profileRevision++;
    mapper.reset();
    settings = switchProfile(settings, next.path);
    if (vts && !existingProfile) {
      applyVts(vts);
      vtsSummary = vts.summary;
    } else if (vts && repairVtsMappings(settings.mappings, vts, settings.vtsImportReport)) {
      vtsSummary = t('studio.vtsRepaired');
      settings.vtsImportReport.push(vtsSummary);
    } else if (vtsError && !existingProfile) settings.vtsImportReport = [vtsError];
    settings.parameterOverrides = { ...settings.defaultParameterOverrides };
    // Held keys belong to the model that received the press.
    heldExpressions.clear();
    settings.recentModels = [
      { name: next.name, path: next.path },
      ...settings.recentModels.filter((m) => m.path !== next.path),
    ].slice(0, 5);
    stage.display(settings);
    stage.restoreDefaultAppearance(settings);
    publish();
    await bindHotkeys();
    if (disposed || operation !== modelOperation) return;
    await save();
    await preview;
    if (!previews[next.path]) {
      try {
        await savePreview(next, stage.thumbnail());
      } catch {
        notify(t('studio.previewSaveFailed'), true);
        return;
      }
    }
    if (operation === modelOperation)
      notify(
        t('studio.modelReady', {
          detail: vtsError || vtsSummary || t('studio.modelReadyHint'),
        }),
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
    openAbout: () => (native ? invoke('open_about') : window.open('/?about=1', '_blank')),
    motionMode: 'once' as MotionMode,
    async importVts(source: 'file' | 'model' = 'file') {
      if (!native || !model || !stage || modelLoading || sceneBusy) return;
      const revision = profileRevision;
      const raw = await (source === 'model'
        ? invoke<unknown>('read_model_vts_config', { id: model.id })
        : invoke<unknown>('choose_vts_config'));
      if (disposed || revision !== profileRevision || modelLoading || sceneBusy) return;
      if (raw == null) {
        if (source === 'model') throw new Error(t('studio.noModelVts'));
        return;
      }
      const result = importVtsConfig(raw, stage);
      applyVts(result);
      stage?.restoreExpressions(settings.defaultExpressions);
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
    setObsOutput(enabled: boolean) {
      // The frame loop submits nothing while rendering is broken, so OBS would stay blank.
      if (enabled && (!stage || failedRevision === modelRevision))
        throw new Error(t('studio.obsRenderFailed'));
      return obsOutput.setEnabled(enabled, settings.obsOutput);
    },
    async copyObsUrl() {
      await navigator.clipboard.writeText(obsOutput.state.url);
      notify(t('studio.obsUrlCopied'));
    },
    selectItem(id: string) {
      selectedItem = id;
      publish();
    },
    updateItem(id: string, patch: Partial<SceneItem>, gesture = false) {
      if (sceneBusy) return;
      settings.composition = readComposition({
        ...settings.composition,
        items: settings.composition.items.map((item) =>
          item.id === id
            ? { ...item, ...patch, id: item.id, source: item.source, kind: item.kind }
            : item,
        ),
      });
      changed(gesture);
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
      if (!native) return notify(t('studio.assetNeedsDesktop'));
      if (sceneBusy) return;
      if (!background && settings.composition.items.length >= 32)
        throw new Error(t('studio.tooManyItems'));
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
        throw new Error(t('studio.tooManyLive2dItems'));
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
      if (!id && settings.scenes.length >= 32) throw new Error(t('studio.tooManyScenes'));
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
        if (!stage) throw new Error(t('studio.webglUnavailableShort'));
        let nextModel = model;
        if (scene.modelPath && scene.modelPath !== model?.path) {
          if (!native) throw new Error(t('studio.sceneModelNeedsDesktop'));
          nextModel = await invoke<ModelInfo>('load_model', { path: scene.modelPath });
        } else if (!scene.modelPath) nextModel = null;
        if (disposed || operation !== modelOperation) return;
        const sceneSettings = () => {
          const profile = switchProfile(settings, scene.modelPath);
          return readSettings({
            ...profile,
            parameterOverrides: profile.defaultParameterOverrides,
            ...scene.placement,
            background: scene.background,
            composition: scene.composition,
          });
        };
        candidate = await stage.prepare(nextModel, sceneSettings(), library);
        if (disposed || operation !== modelOperation) return;
        const { vts, vtsError } = nextModel
          ? await readModelVts(nextModel, candidate, sceneSettings())
          : { vts: undefined, vtsError: '' };
        if (disposed || operation !== modelOperation) return;
        if (nextModel?.path !== model?.path) {
          cancelCalibration();
          await stopAudio();
        }
        if (disposed || operation !== modelOperation) return;
        settings = sceneSettings();
        let vtsSummary = '';
        if (vts && repairVtsMappings(settings.mappings, vts, settings.vtsImportReport)) {
          vtsSummary = t('studio.vtsRepaired');
          settings.vtsImportReport.push(vtsSummary);
        }
        heldExpressions.clear();
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
          updateLibrary(model);
          settings.recentModels = [
            { name: model.name, path: model.path },
            ...settings.recentModels.filter((m) => m.path !== model!.path),
          ].slice(0, 5);
        }
        selectedItem = '';
        changed();
        await bindHotkeys();
        notify(
          t('studio.sceneRecalled', { name: scene.name, detail: vtsError || vtsSummary }),
          !!vtsError,
        );
      } finally {
        candidate?.destroy();
        sceneBusy = false;
        publish();
      }
    },
    setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
      settings = readSettings({ ...settings, [key]: value });
      if (key === 'mouthSmooth') {
        for (const mapping of Object.values(settings.mappings))
          if (mapping.source.startsWith('mouth')) mapping.smoothing = settings.mouthSmooth;
        profileRevision++;
      }
      if (key === 'useKeyboardHotkeys') void run(bindHotkeys);
      if (key === 'outputTransparent' && native) reopenOutput();
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
      mapper.reset();
      lastDetectedFaceAt = performance.now();
      publish();
      try {
        const started = await tracker.start(structuredClone(settings));
        if (!started || disposed || operation !== trackingOperation) return;
        tracking = 'running';
        if (
          settings.autoStartVirtualCamera &&
          cameraStatus.supported &&
          cameraStatus.installed &&
          !cameraStatus.active
        )
          void virtualCamera.start();
        if (settings.autoStartMic && !audio.active && !micStarting) void actions.toggleMic();
        publish();
        await devices();
        notify(
          settings.engine === 'openseeface'
            ? settings.openseefaceMode === 'external'
              ? t('studio.osfExternalWaiting')
              : t('studio.osfStarted')
            : settings.engine === 'nvidia'
              ? t('studio.nvidiaStarting')
              : t('studio.trackingStarted'),
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
        settings.engine === 'openseeface' && settings.openseefaceMode === 'external'
          ? t('studio.osfStopped')
          : t('studio.cameraReleased'),
      );
    },
    pause() {
      if (!['running', 'paused'].includes(tracking)) return;
      tracking = tracking === 'paused' ? 'running' : 'paused';
      tracker.pause(tracking === 'paused');
      audio.pause(tracking === 'paused');
      cancelCalibration();
      lastFace = null;
      notify(tracking === 'paused' ? t('studio.paused') : t('studio.resumed'));
    },
    calibrate(mode: 'neutral' | 'eyes' = 'neutral') {
      if (tracking !== 'running' || calibration) return;
      if (!isFace(lastFace) || performance.now() - lastFaceAt > 250)
        return notify(t('studio.noFace'));
      if (mode === 'eyes' && !settings.neutral) return notify(t('studio.calibrateNeutralFirst'));
      const current = (calibration = { mode, after: performance.now() + 1000, samples: [] });
      notify(mode === 'eyes' ? t('studio.calibratingEyes') : t('studio.calibratingNeutral'));
      calibrationTimer = window.setTimeout(
        () =>
          void run(async () => {
            if (calibration !== current) return;
            calibration = null;
            notify('');
            const result = sampleCalibration(current.samples, mode);
            if (mode === 'eyes') {
              if (
                settings.neutral!.eyeLeft - result.eyeLeft < 0.15 ||
                settings.neutral!.eyeRight - result.eyeRight < 0.15
              )
                throw new Error(t('studio.eyeGapTooSmall'));
              settings.eyeClosedLeft = result.eyeLeft;
              settings.eyeClosedRight = result.eyeRight;
            } else {
              settings.neutral = result;
              settings.eyeClosedLeft = settings.eyeClosedRight = null;
            }
            mapper.reset();
            await save();
          }),
        2600,
      );
    },
    async toggleMic() {
      if (audio.active || micStarting) {
        await stopAudio();
        return notify(t('studio.micOff'));
      }
      micStarting = true;
      const operation = ++micOperation;
      publish();
      try {
        await audio.start(settings.micDeviceId);
        if (!disposed && operation === micOperation && audio.active) {
          audio.pause(tracking === 'paused');
          await devices();
          notify(t('studio.micOn'));
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
      notify(t('studio.voiceCalibrating', { vowel }));
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
        notify(t('studio.voiceCalibrated', { vowel }));
      } finally {
        if (operation === voiceOperation) {
          voiceCalibration = null;
          publish();
        }
      }
    },
    async importModel(kind: 'directory' | 'file') {
      if (sceneBusy) return;
      if (!native) return notify(t('studio.importNeedsDesktop'));
      await loadModel(() => invoke<ModelInfo | null>('choose_model', { kind }));
    },
    async openLibrary() {
      if (!native) return notify(t('studio.libraryNeedsDesktop'));
      await invoke('open_models_directory');
    },
    async recentModel(path: string) {
      if (!sceneBusy && path && path !== model?.path && native)
        await loadModel(() => invoke<ModelInfo>('load_model', { path }));
    },
    async removeModel(id: string) {
      if (!native || !ready || disposed || modelLoading || sceneBusy) return;
      const entry = library.find((item) => item.id === id);
      if (!entry || entry.builtin) return;
      sceneBusy = true;
      publish();
      try {
        await invoke('remove_model', { id });
        if (disposed) return;
        const active = model?.path === entry.path;
        if (active) {
          cancelCalibration();
          stage?.clear();
          model = null;
          modelRevision++;
          profileRevision++;
          recording.stop();
          mapper.reset();
          heldExpressions.clear();
        }
        if (settings.modelPath === entry.path) settings = switchProfile(settings, '');
        delete settings.profiles[entry.path];
        settings.recentModels = settings.recentModels.filter((item) => item.path !== entry.path);
        settings.pinnedModels = settings.pinnedModels.filter((path) => path !== entry.path);
        const withoutModel = (composition: Composition): Composition => ({
          ...composition,
          items: composition.items.filter((item) => {
            if (item.kind !== 'live2d' || item.source !== entry.path) return true;
            delete settings.globalHotkeys[`item:${item.id}`];
            return false;
          }),
        });
        settings.composition = withoutModel(settings.composition);
        settings.scenes = settings.scenes.map((scene) => ({
          ...scene,
          modelPath: scene.modelPath === entry.path ? '' : scene.modelPath,
          composition: withoutModel(scene.composition),
        }));
        if (!settings.composition.items.some((item) => item.id === selectedItem)) selectedItem = '';
        library = library.filter((item) => item.id !== id);
        if (previews[entry.path]) URL.revokeObjectURL(previews[entry.path]);
        delete previews[entry.path];
        changed();
        if (active) await stopAudio();
        await save(true);
        await stage?.compose(settings, library);
        await bindHotkeys();
        notify(t('studio.modelRemoved', { name: entry.name }));
      } finally {
        sceneBusy = false;
        publish();
      }
    },
    async importPaths(paths: string[]) {
      if (!native || disposed) return;
      if (!ready || modelLoading || sceneBusy) return notify(t('studio.dropBusy'));
      if (!paths.length || paths.length > 32) return notify(t('studio.dropLimit'), true);
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
            if (warning) errors.push(t('studio.namedError', { name: next.name, error: warning }));
          } catch (error) {
            errors.push(
              t('studio.namedError', {
                name: path.split(/[\\/]/).pop() ?? path,
                error: error instanceof Error ? error.message : String(error),
              }),
            );
          }
        }
        if (operation === modelOperation)
          notify(
            t('studio.modelsImported', {
              count: imported,
              detail: errors.length
                ? errors.join(t('studio.errorSeparator'))
                : t('studio.modelsImportedHint'),
            }),
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
          const zoom = settings.zoom * (stage?.depthScale ?? 1);
          dx = (x * Math.cos(angle) + y * Math.sin(angle)) / (width * zoom);
          dy = (-x * Math.sin(angle) + y * Math.cos(angle)) / (height * zoom);
        }
        if (!item.locked) actions.updateItem(item.id, { x: item.x + dx, y: item.y + dy }, true);
        return;
      }
      if (!model) return;
      settings.x = readRange('x', settings.x + dx);
      settings.y = readRange('y', settings.y + dy);
      changed(true);
    },
    zoom(factor: number, anchorX: number, anchorY: number) {
      if (sceneBusy || modelLoading || disposed) return;
      const item = settings.composition.items.find((i) => i.id === selectedItem);
      if (item) {
        if (!item.locked) actions.updateItem(item.id, { scale: item.scale * factor }, true);
        return;
      }
      if (!model) return;
      const zoom = readRange('zoom', settings.zoom * factor);
      const ratio = zoom / settings.zoom;
      settings.x = readRange('x', anchorX - (anchorX - settings.x) * ratio);
      settings.y = readRange('y', anchorY - (anchorY - settings.y) * ratio);
      settings.zoom = zoom;
      changed(true);
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
        'depthSensitivity',
        'eyeSensitivity',
        'eyeClosedThreshold',
        'eyeClosedLeft',
        'eyeClosedRight',
        'eyeLink',
        'eyeLinkAngle',
        'mouthSensitivity',
        'headSmooth',
        'eyeSmooth',
        'lostDelay',
        'lostMode',
        'motionMirror',
        'neutral',
      ] as const)
        Object.assign(settings, { [key]: defaults[key] });
      mapper.reset();
      actions.setSetting('mouthSmooth', defaults.mouthSmooth);
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
        [mapping.outputMin, mapping.outputMax].some((v) => Math.abs(v) > 1e6)
      )
        throw new Error(t('studio.invalidMapping'));
      settings.mappings[id] = mapping;
      profileRevision++;
      mapper.reset();
      changed();
      notify(t('studio.mappingSaved'));
    },
    resetMapping(id: string) {
      delete settings.mappings[id];
      profileRevision++;
      mapper.reset();
      changed();
    },
    setParameterOverride(id: string, value: number | null) {
      const parameter = stage?.parameters.find((p) => p.id === id);
      if (!parameter) return;
      if (value === null) delete settings.parameterOverrides[id];
      else {
        if (!Number.isFinite(value)) throw new Error(t('studio.invalidParameterValue'));
        settings.parameterOverrides[id] = clamp(value, parameter.min, parameter.max);
      }
      changed();
    },
    async saveDefaultAppearance() {
      if (!stage || !model) return;
      settings.defaultHeldParameters = stage.captureHeldParameters();
      settings.defaultExpressions = [...stage.activeExpressions];
      settings.defaultParameterOverrides = { ...settings.parameterOverrides };
      await save(true);
      notify(t('studio.defaultAppearanceSaved'));
    },
    restoreDefaultAppearance() {
      settings.parameterOverrides = { ...settings.defaultParameterOverrides };
      stage?.restoreDefaultAppearance(settings);
      profileRevision++;
      changed();
    },
    async applyHotkeyOptions(id: string, options: HotkeyOptions) {
      if (!model) return;
      if (
        (options.seconds !== undefined &&
          (!Number.isFinite(options.seconds) || options.seconds < 0 || options.seconds > 3600)) ||
        (options.fadeSeconds !== undefined &&
          (!Number.isFinite(options.fadeSeconds) ||
            options.fadeSeconds < 0 ||
            options.fadeSeconds > 10))
      )
        throw new Error(t('studio.invalidHotkeyOptions'));
      const next = readSettings({
        ...settings,
        hotkeyOptions: { ...settings.hotkeyOptions, [id]: options },
      });
      settings.hotkeyOptions = next.hotkeyOptions;
      await bindHotkeys();
      changed();
    },
    modelAction,
    async applyHotkey(id: string, binding: string) {
      const global = !['expression:', 'motion:', 'stop-motion', 'clear-expressions'].some(
        (prefix) => id.startsWith(prefix),
      );
      if (!global && !model) return;
      const bindings = global ? settings.globalHotkeys : settings.hotkeys;
      validateHotkey(id, binding, { ...settings.globalHotkeys, ...settings.hotkeys });
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
      notify(t('studio.profileReset'));
    },
    toggleRecording() {
      if (recording.active) recording.stop();
      else if (model) recording.start();
      publish();
    },
    async saveRecording() {
      const motion = recording.export();
      if (!motion) return;
      const revision = recording.revision;
      if (native) {
        if (await invoke<boolean>('save_motion', { motion })) {
          if (!recording.active && revision === recording.revision)
            savedRecordingRevision = revision;
          notify(t('studio.motionSaved'));
        }
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
      if (native) await obsOutput.setEnabled(false);
      modelOperation++;
      modelLoading = false;
      stage?.clear();
      await stop();
      if (disposed) return;
      settings = { ...structuredClone(defaults), lastSeenVersion: settings.lastSeenVersion };
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
      notify(t('studio.settingsReset'));
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
        transparent: settings.outputTransparent,
        backgroundColor: settings.outputTransparent ? undefined : settings.background,
        backgroundThrottling: 'disabled' as BackgroundThrottlingPolicy,
      });
      await own(outputWindow.once('tauri://error', () => notify(t('studio.outputFailed'), true)));
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
      // Fresh installs and settings from before release notes start from the running version.
      if (!settings.lastSeenVersion) {
        settings.lastSeenVersion = version;
        void save();
      }
    } catch {
      notify(t('studio.settingsUnreadable'), true);
    }
    if (disposed) return;
    try {
      stage = new AvatarStage(container, () => notify(t('studio.contextLost'), true));
      stage.onWarning = (message) => notify(message, true);
      stage.display(settings);
    } catch {
      notify(t('studio.webglInitFailed'), true);
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
        listen('about-ready', () => {
          void emitTo('about', 'about-events', [...events]).catch(() => {});
          sendUpdateState();
        }),
      );
      await own(
        listen<unknown>('update-action', ({ payload }) => {
          if (payload === 'check') void updater.check();
          else if (payload === 'download') void updater.download();
          else if (payload === 'install') void updater.install();
          else if (payload === 'later')
            void WebviewWindow.getByLabel('about')
              .then((window) => window?.close())
              .catch(report);
          else if (payload === 'ignore' && updater.state.status === 'available') {
            actions.setSetting('skippedUpdateVersion', updater.state.version);
            updater.dismiss();
          } else if (typeof payload === 'boolean' && updater.state.status !== 'installing') {
            actions.setSetting('autoCheckUpdates', payload);
            sendUpdateState();
          }
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
          releaseOutputHotkeys();
        }),
      );
      if (disposed) return;
      await own(
        listen<{ action: string; pressed: boolean }>('output-hotkey', ({ payload }) => {
          if (
            !payload ||
            typeof payload.action !== 'string' ||
            typeof payload.pressed !== 'boolean'
          )
            return;
          const { action, pressed } = payload;
          if (pressed) {
            if (
              !outputOpen ||
              outputPressed.has(action) ||
              (!Object.hasOwn(settings.globalHotkeys, action) &&
                !Object.hasOwn(settings.hotkeys, action))
            )
              return;
            outputPressed.add(action);
          } else if (!outputPressed.delete(action)) return;
          void run(() => shortcutAction(action, pressed));
        }),
      );
      if (disposed) return;
      await own(listen<string>('output-error', (event) => notify(event.payload, true)));
      if (disposed) return;
      await own(
        getCurrentWindow().onCloseRequested(async (event) => {
          event.preventDefault();
          if (updater.state.status === 'installing') return;
          try {
            await virtualCamera.stop();
            await obsOutput.setEnabled(false);
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
    await devices().catch(() => notify(t('studio.devicesUnavailable')));
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
          t('studio.restoreFailed', {
            error: error instanceof Error ? error.message : String(error),
          }),
          true,
        );
      }
    }
    // Rendering missing avatars would compete with the restore, so it waits for it and the icons.
    void previewReads?.then(generatePreviews);
    await run(() => stage?.compose(settings, library));
    await bindHotkeys();
    ready = true;
    if (native && !disposed) {
      const checkAutomatically = () => {
        if (settings.autoCheckUpdates) void updater.check(settings.skippedUpdateVersion, true);
      };
      updateTimer = window.setTimeout(checkAutomatically, 5000);
      updateInterval = window.setInterval(checkAutomatically, 24 * 60 * 60 * 1000);
    }
    publish();
  }
  void initialize().catch((error) => {
    ready = true;
    report(error);
  });
  let before = performance.now(),
    frames = 0,
    since = before,
    lastMicSample = before;
  let failedRevision = -1;
  function tick() {
    if (disposed) return;
    if (outputStale)
      void syncOutput().catch(() => {
        outputOpen = false;
      });
    const now = performance.now(),
      dt = now - before;
    before = now;
    let face =
      tracking === 'running' &&
      (now - lastFaceAt < settings.lostDelay * 1000 || settings.lostMode === 'hold')
        ? lastFace
        : null;
    // Microphone-only frames must not hold camera depth after tracking stops.
    const trackingFace = face;
    if (audio.active && tracking !== 'paused')
      face = {
        ...face,
        ...audio.read(settings.micGain, settings.micNoiseGate, settings.voiceTemplates),
      };
    if (stage && failedRevision !== modelRevision) {
      try {
        stage.trackingLost =
          tracking === 'running' && now - lastDetectedFaceAt >= settings.lostDelay * 1000;
        stage.draw(
          mapper.map(face, stage.parameters, settings, dt / 1000, trackingFace),
          dt,
          {},
          undefined,
          mapper.depthScale,
        );
      } catch (error) {
        failedRevision = modelRevision;
        if (obsOutput.state.active) void obsOutput.setEnabled(false).catch(report);
        report(error instanceof Error ? t('studio.renderFailed', { error: error.message }) : error);
      }
    }
    // Camera frames re-render the stage, so a failed model would also fail and stop the camera.
    if (stage && failedRevision !== modelRevision) {
      virtualCamera.submit(stage, settings.background, settings.virtualCameraMirror);
      obsOutput.submit(stage);
    }
    if (recording.active) recording.capture(stage?.frame ?? {}, now);
    if (native && outputOpen && !frameSending) {
      frameSending = true;
      void emitTo('output', 'output-frame', {
        revision: modelRevision,
        tracking: tracking === 'running' || tracking === 'paused',
        parameters: stage?.frame ?? {},
        parts: stage?.parts ?? {},
        sceneFrames: stage?.sceneFrames ?? {},
        depthScale: stage?.depthScale ?? 1,
      } satisfies OutputFrame)
        .catch(() => {
          outputOpen = false;
        })
        .finally(() => {
          frameSending = false;
        });
    }
    frames++;
    if (now - since > 1000) {
      renderStatus = t('studio.renderStatus', {
        render: Math.round((frames * 1000) / (now - since)),
        input: Math.round((inputFrames * 1000) / (now - since)),
        inference: tracker.inferenceMs.toFixed(0),
      });
      faceStatus =
        tracking === 'running'
          ? now - lastFaceAt < settings.lostDelay * 1000 && isFace(lastFace)
            ? t('studio.faceDetected')
            : settings.lostMode === 'hold'
              ? t('studio.faceLostHold')
              : t('studio.faceLostNeutral')
          : tracking === 'paused'
            ? t('studio.facePaused')
            : t('studio.faceIdle');
      faceInput = face ? normalizedFace(face, settings) : {};
      frames = 0;
      inputFrames = 0;
      since = now;
      publish();
    }
    // The meter subscribes to this level itself, so it moves without re-rendering the panels.
    if (now - lastMicSample >= 100) {
      lastMicSample = now;
      const level = audio.inputVolume(settings.micGain);
      if (level !== micLevel) {
        micLevel = level;
        micListeners.forEach((listener) => listener());
      }
    }
  }
  const needsFrames = () =>
    tracking !== 'stopped' ||
    audio.active ||
    recording.active ||
    obsOutput.state.active ||
    outputOpen ||
    (cameraStatus.active && cameraStatus.consumers !== false);
  const stopRendering = startFrameLoop(
    tick,
    () => settings.renderFps,
    needsFrames,
    true,
    () => !document.hidden || needsFrames(),
  );
  return {
    actions,
    snapshot,
    micLevel: {
      get: () => micLevel,
      subscribe(listener: () => void) {
        micListeners.add(listener);
        return () => void micListeners.delete(listener);
      },
    },
    // Wheel events check this instead of cloning the settings through snapshot().
    canMove: () => !!(model || selectedItem) && !modelLoading && !sceneBusy,
    destroy() {
      disposed = true;
      window.clearTimeout(updateTimer);
      window.clearInterval(updateInterval);
      updater.dispose();
      modelOperation++;
      trackingOperation++;
      stopRendering();
      cancelCalibration();
      if (saveTimer) void save();
      unlisteners.forEach((unlisten) => unlisten());
      navigator.mediaDevices?.removeEventListener('devicechange', devicechange);
      void tracker.stop().catch(() => {});
      void stopAudio().catch(() => {});
      void hotkeys.destroy();
      virtualCamera.destroy();
      obsOutput.destroy();
      stage?.destroy();
      previewStage?.clear();
      Object.values(previews).forEach(URL.revokeObjectURL);
    },
  };
}
export type Studio = ReturnType<typeof createStudio>;
export type StudioView = ReturnType<Studio['snapshot']>;
