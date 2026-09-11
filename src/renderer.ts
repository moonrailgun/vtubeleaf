import * as PIXI from 'pixi.js';
import { install } from '@pixi/unsafe-eval';
import { invoke } from '@tauri-apps/api/core';
import type { Live2DModel, Cubism4InternalModel } from 'pixi-live2d-display/cubism4';
import { type Parameter, type Settings } from './state';
import { SceneLayers, type SceneFrames } from './scene-renderer';
import { physicsGroupsFromJson, wrapPhysics, type PhysicsGroup } from './physics';
import { layoutMasks, maskBufferSize } from './masks';

install(PIXI);

export type ModelInfo = { id: string; path: string; name: string; entry: string; files: string[] };

export type MotionMode = 'once' | 'loop' | 'hold';

type MotionData = { Curves?: { Target: string; Id: string }[]; [key: string]: unknown };

type ExpressionData = {
  Parameters?: { Id: string; Value: number; Blend?: string }[];
  [key: string]: unknown;
};

export type Motion = { id: string; name: string; group: string; data: MotionData; file: string };

export type Expression = { id: string; name: string; data: ExpressionData; file: string };

let coreReady: Promise<void> | undefined;

async function runtime() {
  coreReady ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/runtime/live2dcubismcore.min.js';
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      coreReady = undefined;
      reject(new Error('缺少 Live2D Core。请按构建说明安装官方 Cubism SDK 运行资源。'));
    };
    document.head.append(script);
  });
  await coreReady;
  const lib = await import('pixi-live2d-display/cubism4');
  lib.config.logLevel = lib.config.LOG_LEVEL_NONE;
  lib.config.sound = false;
  type ClippingContext = {
    _layoutChannelNo: number;
    _layoutBounds: { x: number; y: number; width: number; height: number };
  };
  // Runtime export omitted from pixi-live2d-display's declarations.
  const { CubismClippingManager_WebGL } = lib as unknown as {
    CubismClippingManager_WebGL: {
      prototype: {
        _clippingContextListForMask: ClippingContext[];
        setupLayoutBounds(usingClipCount: number): void;
      };
    };
  };
  const manager = CubismClippingManager_WebGL.prototype;
  manager.setupLayoutBounds = function (usingClipCount: number) {
    layoutMasks(usingClipCount).forEach((cell, index) => {
      const context = this._clippingContextListForMask[index];
      context._layoutChannelNo = cell.channel;
      context._layoutBounds.x = cell.x;
      context._layoutBounds.y = cell.y;
      context._layoutBounds.width = cell.width;
      context._layoutBounds.height = cell.height;
    });
  };
  return lib;
}

export class AvatarStage {
  private app: PIXI.Application;
  readonly content = new PIXI.Container();
  private layers?: SceneLayers;
  private model?: Live2DModel;
  private urls: string[] = [];
  private generation = 0;
  private compositionGeneration = 0;
  private values: Record<string, number> = {};
  private settings?: Settings;
  private observer?: ResizeObserver;
  parameters: Parameter[] = [];
  motions: Motion[] = [];
  expressions: Expression[] = [];
  physicsGroups: PhysicsGroup[] = [];
  activeExpressions = new Set<string>();
  private expressionExpiry = new Map<string, number>();
  private heldMotion = '';
  frame: Record<string, number> = {};
  parts: Record<string, number> = {};
  private incomingParts: Record<string, number> = {};
  private playing?: {
    id: string;
    mode: MotionMode;
    ids: Set<string>;
    finished: boolean;
    idle: boolean;
  };
  private held: Record<string, number> = {};
  private expressionIds = new Set<string>();
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.onContextLost();
  };

  get currentMotion() {
    return this.playing?.id ?? '';
  }

  constructor(
    private container: HTMLElement,
    private onContextLost: () => void,
    private passive = false,
    private sharedApp?: PIXI.Application,
  ) {
    this.app =
      sharedApp ??
      new PIXI.Application({
        backgroundAlpha: 0,
        antialias: true,
        autoStart: false,
        resolution: Math.min(devicePixelRatio, 2),
        autoDensity: true,
      });
    if (sharedApp) return;
    this.layers = new SceneLayers(
      () => new AvatarStage(this.container, onContextLost, this.passive, this.app),
    );
    this.app.stage.addChild(this.layers.root);
    this.layers.root.addChild(this.content);
    container.append(this.app.view);
    this.app.view.addEventListener('webglcontextlost', this.contextLost);
    this.observer = new ResizeObserver(() => this.layout());
    this.observer.observe(container);
  }

  async load(info: ModelInfo) {
    const generation = ++this.generation;
    const urls: string[] = [];
    let candidate: Live2DModel | undefined;
    try {
      const lib = await runtime();
      const { Live2DModel, Live2DFactory, Cubism4ModelSettings, MotionPreloadStrategy } = lib;
      // Runtime export omitted from pixi-live2d-display's declarations.
      const { CubismShader_WebGL } = lib as unknown as {
        CubismShader_WebGL: {
          getInstance(): {
            gl: WebGLRenderingContext;
            release(): void;
            _shaderSets: unknown[];
            setGl(gl: WebGLRenderingContext): void;
          };
        };
      };
      const bytes = await invoke<ArrayBuffer>('read_model_resource', {
        id: info.id,
        resource: info.entry,
      });
      const json = JSON.parse(new TextDecoder().decode(bytes));
      const motionDefinitions = Object.entries(json.FileReferences.Motions ?? {}).flatMap(
        ([group, entries]) =>
          (entries as { File: string }[]).map((entry, index) => ({
            id: `${group}:${index}`,
            name: `${group} · ${index + 1}`,
            group,
            file: entry.File,
          })),
      );
      const expressionDefinitions = (json.FileReferences.Expressions ?? []).map(
        (entry: { Name: string; File: string }, index: number) => ({
          id: String(index),
          name: entry.Name || `表情 ${index + 1}`,
          file: entry.File,
        }),
      );
      const documents = new Map<string, MotionData & ExpressionData>();
      let physicsDocument: unknown;
      const physicsFile = json.FileReferences.Physics as string | undefined;
      json.url = `/${info.entry}`;
      const settings = new Cubism4ModelSettings(json);
      const paths = new Set<string>();
      settings.replaceFiles((path) => {
        paths.add(path);
        return path;
      });
      const resolved = new Map<string, string>();
      for (const path of paths) {
        const resource = path.replace(/^\.\//, '');
        if (!info.files.includes(resource)) throw new Error('模型包含未经验证的资源引用。');
        const data = await invoke<ArrayBuffer>('read_model_resource', { id: info.id, resource });
        if (/\.(motion3|exp3)\.json$/i.test(path))
          documents.set(path, JSON.parse(new TextDecoder().decode(data)));
        else if (path === physicsFile) physicsDocument = JSON.parse(new TextDecoder().decode(data));
        const type = /\.png$/i.test(path)
          ? 'image/png'
          : /\.jpe?g$/i.test(path)
            ? 'image/jpeg'
            : /\.json$/i.test(path)
              ? 'application/json'
              : 'application/octet-stream';
        const url = URL.createObjectURL(new Blob([data], { type }));
        urls.push(url);
        resolved.set(path, url);
      }
      settings.replaceFiles((path) => resolved.get(path)!);
      settings.resolveURL = (path) => path;
      const textures = await Promise.allSettled(
        settings.textures.map((path) => PIXI.Texture.fromURL(path)),
      );
      if (textures.some((result) => result.status === 'rejected')) throw new Error('纹理加载失败');
      const options = {
        autoUpdate: false,
        autoInteract: false,
        motionPreload: MotionPreloadStrategy.NONE,
        idleMotionGroup: '__vtubeleaf_disabled__',
      };
      candidate = new Live2DModel(options);
      await Live2DFactory.setupLive2DModel(candidate, settings, options);
      if (generation !== this.generation) {
        candidate.destroy({ children: true, texture: true, baseTexture: true });
        urls.forEach(URL.revokeObjectURL);
        return false;
      }
      const internal = candidate.internalModel as Cubism4InternalModel;
      const core = internal.coreModel.getModel();
      if (!core.drawables.renderOrders)
        throw new Error(
          'Cubism Core 版本不兼容：当前渲染库请使用官方 Cubism 5 SDK for Web R4 的 Core。',
        );
      const renderer = internal.renderer as unknown as {
        _clippingManager: { _clippingContextListForMask: unknown[] };
        setClippingMaskBufferSize(size: number): void;
      };
      const masks = renderer._clippingManager._clippingContextListForMask.length;
      if (maskBufferSize(masks) !== 256) renderer.setClippingMaskBufferSize(maskBufferSize(masks));
      this.model?.destroy({ children: true, texture: true, baseTexture: true });
      this.urls.forEach(URL.revokeObjectURL);
      this.urls = urls;
      this.model = candidate;
      this.values = {};
      internal.motionManager.stopAllMotions();
      this.playing = undefined;
      this.held = {};
      this.heldMotion = '';
      this.activeExpressions.clear();
      this.expressionExpiry.clear();
      this.expressionIds.clear();
      this.frame = {};
      this.parts = {};
      this.physicsGroups = this.passive ? [] : physicsGroupsFromJson(physicsDocument);
      this.motions = motionDefinitions
        .filter((def) => documents.has(def.file))
        .map((def) => ({ ...def, data: documents.get(def.file)! }));
      this.expressions = expressionDefinitions
        .filter((def: { file: string }) => documents.has(def.file))
        .map((def: { id: string; name: string; file: string }) => ({
          ...def,
          data: documents.get(def.file)!,
        }));
      const raw = core.parameters;
      this.parameters = Array.from(raw.ids, (id, i) => ({
        id,
        min: raw.minimumValues[i],
        max: raw.maximumValues[i],
        default: raw.defaultValues[i],
      }));
      // Cubism 4 shares one shader singleton across WebGL contexts (including thumbnails).
      // ponytail: rebuild only on a context switch; cache per context if thumbnail throughput matters.
      const draw = internal.draw.bind(internal);
      internal.draw = (gl) => {
        const shader = CubismShader_WebGL.getInstance();
        if (shader.gl !== gl) {
          shader.release();
          shader._shaderSets = [];
          shader.setGl(gl);
        }
        draw(gl);
      };
      const blink = internal.eyeBlink;
      const blinkIds = [...internal.motionManager.eyeBlinkIds];
      if (this.passive) {
        internal.physics = undefined;
        internal.pose = undefined;
        internal.eyeBlink = undefined;
      } else if (internal.physics) {
        wrapPhysics(
          internal.physics,
          this.physicsGroups.map((group) => group.id),
          () => this.settings,
        );
      }
      internal.on('beforeMotionUpdate', () => {
        for (const p of this.parameters) internal.coreModel.setParameterValueById(p.id, p.default);
        if (!this.passive) {
          internal.eyeBlink = this.settings?.autoBlink ? blink : undefined;
          blink?.setParameterIds(
            blinkIds.filter(
              (id) =>
                !Object.hasOwn(this.values, id) &&
                !this.playing?.ids.has(id) &&
                !this.expressionIds.has(id) &&
                !Object.hasOwn(this.held, id),
            ),
          );
        }
      });
      internal.on('afterMotionUpdate', () => {
        if (this.passive) return;
        for (const [id, value] of Object.entries(this.held))
          internal.coreModel.setParameterValueById(id, value);
        for (const [id, value] of Object.entries(this.values)) {
          if (
            (!this.playing || this.playing.idle || !this.playing.ids.has(id)) &&
            !Object.hasOwn(this.held, id)
          )
            internal.coreModel.setParameterValueById(id, value);
        }
        if (this.playing?.finished) {
          if (this.playing.mode === 'hold') {
            for (const id of this.playing.ids)
              this.held[id] = internal.coreModel.getParameterValueById(id);
          }
          this.playing = undefined;
        }
      });
      const natural = internal.updateNaturalMovements.bind(internal);
      internal.updateNaturalMovements = (dt, now) => {
        if (this.passive) return;
        const ids = new Set([
          ...Object.keys(this.values),
          ...Object.keys(this.held),
          ...this.expressionIds,
          ...(this.playing?.ids ?? []),
        ]);
        const saved = [...ids].map(
          (id) => [id, internal.coreModel.getParameterValueById(id)] as const,
        );
        natural(dt, now);
        for (const [id, value] of saved) internal.coreModel.setParameterValueById(id, value);
      };
      internal.on('beforeModelUpdate', () => {
        if (this.passive) {
          for (const [id, value] of Object.entries(this.values))
            internal.coreModel.setParameterValueById(id, value);
          for (const [id, value] of Object.entries(this.incomingParts))
            internal.coreModel.setPartOpacityById(id, value);
        }
        this.frame = Object.fromEntries(Array.from(raw.ids, (id, i) => [id, raw.values[i]]));
        this.parts = Object.fromEntries(
          Array.from(core.parts.ids, (id, i) => [id, core.parts.opacities[i]]),
        );
      });
      this.content.addChild(candidate);
      this.layout();
      return true;
    } catch (error) {
      if (candidate?.internalModel)
        candidate.destroy({ children: true, texture: true, baseTexture: true });
      else if (candidate) PIXI.Container.prototype.destroy.call(candidate, { children: true });
      for (const url of urls) {
        PIXI.utils.TextureCache[url]?.destroy(true);
        URL.revokeObjectURL(url);
      }
      if (
        error instanceof Error &&
        /^(缺少 Live2D Core|Cubism Core 版本不兼容)/.test(error.message)
      )
        throw error;
      throw new Error('模型渲染失败：请检查 moc3 版本、纹理和官方 Cubism Core 是否兼容。');
    }
  }

  display(settings: Settings) {
    this.settings = settings;
    if (!this.sharedApp) this.container.style.backgroundColor = settings.background;
    this.layout();
  }

  async compose(settings: Settings, models: ModelInfo[]) {
    const generation = ++this.compositionGeneration;
    await this.layers?.load(settings.composition, models);
    if (generation === this.compositionGeneration) this.display(settings);
  }

  async prepare(info: ModelInfo | null, settings: Settings, models: ModelInfo[]) {
    // ponytail: one temporary WebGL context per scene switch; share staged resources if memory becomes a limit.
    const candidate = new AvatarStage(
      document.createElement('div'),
      this.onContextLost,
      this.passive,
    );
    try {
      if (info) await candidate.load(info);
      await candidate.compose(settings, models);
      return candidate;
    } catch (error) {
      candidate.destroy();
      throw error;
    }
  }

  mount(container: HTMLElement) {
    this.observer?.disconnect();
    this.container = container;
    container.append(this.canvas);
    this.observer?.observe(container);
    if (this.settings) this.display(this.settings);
    this.draw({}, 0);
  }

  get canvas() {
    return this.app.view;
  }

  centeredItem() {
    if (!this.model) return;
    this.model.anchor.set(0.5);
    this.model.position.set(0);
    this.model.scale.set(1);
  }

  thumbnail() {
    if (!this.model) throw new Error('角色尚未加载');
    const model = this.model;
    const scale = model.scale.clone(),
      position = model.position.clone(),
      anchor = model.anchor.clone();
    const { width, height } = this.app.screen;
    const hidden = this.layers?.root.children.filter((c) => c !== this.content && c.visible) ?? [];
    hidden.forEach((c) => {
      c.visible = false;
    });
    const rotation = model.rotation;
    const visible = model.visible;
    model.visible = true;
    model.rotation = 0;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    try {
      this.app.renderer.resize(512, 512);
      model.anchor.set(0.5);
      model.scale.set(
        Math.min(512 / model.internalModel.width, 512 / model.internalModel.height) * 0.92,
      );
      model.position.set(256, 256);
      model.update(16);
      this.app.render();
      const frame = document.createElement('canvas');
      frame.width = frame.height = 512;
      const context = frame.getContext('2d')!;
      context.drawImage(this.app.view, 0, 0, 512, 512);
      const pixels = context.getImageData(0, 0, 512, 512).data;
      let left = 512,
        top = 512,
        right = 0,
        bottom = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] < 32) continue;
        const x = ((i - 3) / 4) % 512,
          y = Math.floor((i - 3) / 4 / 512);
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      if (right <= left || bottom <= top) throw new Error('角色预览为空');
      // ponytail: without a head hit area, frame the upper visible body; use a supplied icon for unusual poses.
      let side = Math.min(bottom - top, Math.max(right - left, (bottom - top) * 0.45));
      let x = (left + right - side) / 2,
        y = top;
      const internal = model.internalModel;
      const head = Object.values(internal.hitAreas).find((area) => /head|face/i.test(area.name));
      if (head) {
        const bounds = internal.getDrawableBounds(head.index);
        const sx = (model.scale.x * internal.width) / internal.originalWidth;
        const sy = (model.scale.y * internal.height) / internal.originalHeight;
        if (bounds.width > 0 && bounds.height > 0) {
          side = Math.max(bounds.width * sx, bounds.height * sy) * 1.8;
          x = 256 + (bounds.x + bounds.width / 2 - internal.originalWidth / 2) * sx - side / 2;
          y = 256 + (bounds.y + bounds.height / 2 - internal.originalHeight / 2) * sy - side / 2;
        }
      }
      y = Math.max(y, top - side * 0.06);
      canvas.getContext('2d')!.drawImage(frame, x, y, side, side, 0, 0, 256, 256);
      return canvas;
    } finally {
      this.app.renderer.resize(width, height);
      model.scale.copyFrom(scale);
      model.position.copyFrom(position);
      model.anchor.copyFrom(anchor);
      model.rotation = rotation;
      model.visible = visible;
      hidden.forEach((c) => {
        c.visible = true;
      });
      this.app.render();
    }
  }

  private layout() {
    if (this.sharedApp) return;
    const { width, height } = this.container.getBoundingClientRect();
    if (width < 1 || height < 1) return;
    this.app.renderer.resize(width, height);
    if (!this.model || !this.settings) return;
    const model = this.model,
      s = this.settings;
    model.visible = s.modelVisible;
    const fit =
      Math.min(width / model.internalModel.width, height / model.internalModel.height) *
      0.92 *
      s.zoom;
    model.anchor.set(0.5);
    model.rotation = (s.rotation * Math.PI) / 180;
    model.scale.set(fit);
    model.position.set(width * (0.5 + s.x), height * (0.5 + s.y));
  }

  playMotion(id: string, mode: MotionMode = 'once', idle = false) {
    const entry = this.motions.find((m) => m.id === id);
    const internal = this.model?.internalModel as Cubism4InternalModel | undefined;
    if (!entry || !internal || this.passive) return;
    this.stopMotion();
    const motion = internal.motionManager.createMotion(entry.data, entry.group, { File: '' });
    motion.setIsLoop(mode === 'loop');
    const ids = new Set(
      (entry.data.Curves ?? [])
        .filter((curve) => curve.Target === 'Parameter')
        .map((curve) => curve.Id),
    );
    for (const curve of entry.data.Curves ?? []) {
      if (curve.Target === 'Model' && curve.Id === 'EyeBlink')
        internal.motionManager.eyeBlinkIds.forEach((id) => ids.add(id));
      if (curve.Target === 'Model' && curve.Id === 'LipSync')
        internal.motionManager.lipSyncIds.forEach((id) => ids.add(id));
    }
    if (mode === 'hold') {
      motion.setFadeOutTime(0);
      ids.forEach((id) => motion.setParameterFadeOutTime(id, 0));
    }
    const playing = { id, mode, ids, finished: false, idle };
    this.playing = playing;
    motion.setFinishedMotionHandler(() => {
      playing.finished = true;
    });
    internal.motionManager.queueManager.startMotion(motion, false, 0);
  }

  stopMotion() {
    (this.model?.internalModel as Cubism4InternalModel | undefined)?.motionManager.stopAllMotions();
    this.playing = undefined;
    this.held = {};
    this.heldMotion = '';
  }

  toggleHeldMotion(id: string) {
    if (this.heldMotion === id) this.stopMotion();
    else {
      this.playMotion(id, 'hold');
      this.heldMotion = id;
    }
  }

  toggleExpression(id: string, seconds?: number) {
    if (!this.expressions.some((e) => e.id === id)) return;
    this.setExpression(id, !this.activeExpressions.has(id), seconds);
  }

  setExpression(id: string, active: boolean, seconds?: number) {
    if (!this.expressions.some((e) => e.id === id)) return;
    this.expressionExpiry.delete(id);
    if (active) {
      this.activeExpressions.add(id);
      if (seconds) this.expressionExpiry.set(id, performance.now() + seconds * 1000);
    } else this.activeExpressions.delete(id);
    this.applyExpressions();
  }

  clearExpressions() {
    this.activeExpressions.clear();
    this.expressionExpiry.clear();
    this.applyExpressions();
  }

  private applyExpressions() {
    const manager = (this.model?.internalModel as Cubism4InternalModel | undefined)?.motionManager
      .expressionManager;
    if (!manager || this.passive) return;
    const parameters = [...this.activeExpressions].flatMap(
      (id) => this.expressions.find((e) => e.id === id)?.data.Parameters ?? [],
    );
    this.expressionIds = new Set(parameters.map((p) => p.Id));
    const expression = manager.createExpression(
      { Type: 'Live2D Expression', FadeInTime: 0.15, FadeOutTime: 0.15, Parameters: parameters },
      { Name: 'Combined', File: '' },
    );
    manager.queueManager.startMotion(expression, false, 0);
  }

  get sceneFrames(): SceneFrames {
    return this.layers?.frames ?? {};
  }

  draw(
    values: Record<string, number>,
    dt: number,
    parts: Record<string, number> = {},
    sceneFrames?: SceneFrames,
  ) {
    for (const [id, expiry] of this.expressionExpiry)
      if (performance.now() >= expiry) this.setExpression(id, false);
    this.values = values;
    this.incomingParts = parts;
    if (!this.passive && !this.sharedApp) {
      if (this.playing?.idle && this.playing.id !== this.settings?.idleMotion) this.stopMotion();
      if (!this.playing && !Object.keys(this.held).length && this.settings?.idleMotion)
        this.playMotion(this.settings.idleMotion, 'loop', true);
    }
    this.model?.update(Math.min(dt, 100));
    if (this.settings)
      this.layers?.draw(
        this.settings,
        this.app.screen.width,
        this.app.screen.height,
        dt,
        sceneFrames,
      );
    if (!this.sharedApp) this.app.render();
  }

  clear() {
    this.generation++;
    this.model?.destroy({ children: true, texture: true, baseTexture: true });
    this.model = undefined;
    this.urls.forEach(URL.revokeObjectURL);
    this.urls = [];
    this.parameters = [];
    this.values = {};
    this.motions = [];
    this.expressions = [];
    this.physicsGroups = [];
    this.activeExpressions.clear();
    this.expressionExpiry.clear();
    this.playing = undefined;
    this.held = {};
    this.heldMotion = '';
    this.frame = {};
    this.parts = {};
    this.app.render();
  }

  destroy() {
    if (!this.sharedApp) this.app.view.removeEventListener('webglcontextlost', this.contextLost);
    this.compositionGeneration++;
    this.clear();
    this.observer?.disconnect();
    this.layers?.destroy();
    if (this.sharedApp) this.content.destroy();
    else this.app.destroy(true);
  }
}
