import * as PIXI from 'pixi.js';
import { install } from '@pixi/unsafe-eval';
import { invoke } from '@tauri-apps/api/core';
import type { Live2DModel, Cubism4InternalModel } from 'pixi-live2d-display/cubism4';
import { clamp, describeParameters, type Parameter, type Settings } from './state';
import { SceneLayers, type SceneFrames } from './scene-renderer';
import { physicsGroupsFromJson, wrapPhysics, type PhysicsGroup } from './physics';
import { layoutMasks, maskBufferSize } from './masks';

install(PIXI);
// Deformed meshes minify unevenly; without this the mip level follows the blurrier axis.
PIXI.settings.ANISOTROPIC_LEVEL = 16;
// Nothing on the stage is hit-tested (a parent element handles drags) or exposed to screen
// readers, yet these plugins hit-test every pointer move on the page, keep a ticker waking every
// display frame and walk the scene after each render. Remove them before any renderer exists.
PIXI.extensions.remove(PIXI.InteractionManager, PIXI.AccessibilityManager);

export type ModelInfo = {
  id: string;
  path: string;
  name: string;
  entry: string;
  files: string[];
  builtin?: boolean;
  vtsResources?: {
    expressions: { name: string; file: string }[];
    motions: { name: string; file: string }[];
    warnings: string[];
  };
};

export type MotionMode = 'once' | 'loop' | 'hold';

type MotionData = { Curves?: { Target: string; Id: string }[]; [key: string]: unknown };

type ExpressionData = {
  Parameters?: { Id: string; Value: number; Blend?: string }[];
  [key: string]: unknown;
};

type MotionDefinition = { File: string; FadeInTime?: number; FadeOutTime?: number; Sound?: string };
export type Motion = {
  id: string;
  name: string;
  group: string;
  data: MotionData;
  file: string;
  definition?: MotionDefinition;
  sound?: string;
};
type ExpressionLayer = {
  motion: ReturnType<
    NonNullable<Cubism4InternalModel['motionManager']['expressionManager']>['createExpression']
  >;
  from: number;
  weight: number;
  target: number;
  elapsed: number;
  duration: number;
};

export type Expression = { id: string; name: string; data: ExpressionData; file: string };

// Render targets of one off-screen output (OBS or the virtual camera).
type OutputTarget = {
  texture?: PIXI.RenderTexture;
  stage?: PIXI.RenderTexture;
  output?: PIXI.RenderTexture;
  sprite?: PIXI.Sprite;
  pixels?: Uint8Array;
};

// Values copied at every model update; the records are built only when someone reads them.
type Snapshot = { ids: string[]; values: Float32Array };

const record = (snapshot?: Snapshot): Record<string, number> =>
  snapshot ? Object.fromEntries(snapshot.ids.map((id, i) => [id, snapshot.values[i]])) : {};

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
  // Separate targets, so OBS and the camera never reallocate each other's textures.
  private transparent: OutputTarget = {};
  private camera: OutputTarget = {};
  private cameraBackground?: { color: string; rgba: number[] };
  private model?: Live2DModel;
  private urls: string[] = [];
  private generation = 0;
  private compositionGeneration = 0;
  private values: Record<string, number> = {};
  private settings?: Settings;
  private modelScale = 1;
  depthScale = 1;
  private observer?: ResizeObserver;
  parameters: Parameter[] = [];
  motions: Motion[] = [];
  expressions: Expression[] = [];
  physicsGroups: PhysicsGroup[] = [];
  activeExpressions = new Set<string>();
  private expressionExpiry = new Map<string, number>();
  private expressionLayers = new Map<string, ExpressionLayer>();
  private motionAudio?: HTMLAudioElement;
  trackingLost = false;
  onWarning?: (message: string) => void;
  private heldMotion = '';
  private snapshot?: { parameters: Snapshot; parts: Snapshot };
  private frameRecord?: Record<string, number>;
  private partsRecord?: Record<string, number>;
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

  /** Parameter values of the last model update; a new object after each update. */
  get frame(): Record<string, number> {
    return (this.frameRecord ??= record(this.snapshot?.parameters));
  }

  /** Part opacities of the last model update; a new object after each update. */
  get parts(): Record<string, number> {
    return (this.partsRecord ??= record(this.snapshot?.parts));
  }

  private resetSnapshot(snapshot?: AvatarStage['snapshot']) {
    this.snapshot = snapshot;
    this.frameRecord = this.partsRecord = undefined;
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
          (entries as MotionDefinition[]).map((entry, index) => ({
            id: `${group}:${index}`,
            name: `${group} · ${index + 1}`,
            group,
            file: entry.File,
            definition: { ...entry },
          })),
      );
      const expressionDefinitions = (json.FileReferences.Expressions ?? []).map(
        (entry: { Name: string; File: string }, index: number) => ({
          id: String(index),
          name: entry.Name || `表情 ${index + 1}`,
          file: entry.File,
        }),
      );
      // Keep native action IDs intact; VTS-only resources use file-based IDs across reloads.
      for (const entry of info.vtsResources?.expressions ?? []) {
        expressionDefinitions.push({ id: `vts:${entry.file}`, ...entry });
        (json.FileReferences.Expressions ??= []).push({ Name: entry.name, File: entry.file });
      }
      for (const entry of info.vtsResources?.motions ?? [])
        motionDefinitions.push({
          id: `vts:${entry.file}`,
          group: 'VTS',
          ...entry,
          definition: { File: entry.file },
        });
      const documents = new Map<string, MotionData & ExpressionData>();
      let physicsDocument: unknown;
      let displayDocument: unknown;
      const displayFile = json.FileReferences.DisplayInfo as string | undefined;
      const physicsFile = json.FileReferences.Physics as string | undefined;
      json.url = `/${info.entry}`;
      const settings = new Cubism4ModelSettings(json);
      const paths = new Set<string>();
      settings.replaceFiles((path) => {
        paths.add(path);
        return path;
      });
      for (const entry of info.vtsResources?.motions ?? []) paths.add(entry.file);
      if (displayFile) paths.add(displayFile);
      const resolved = new Map<string, string>();
      for (const path of paths) {
        const resource = path.replace(/^\.\//, '');
        if (!info.files.includes(resource)) throw new Error('模型包含未经验证的资源引用。');
        const data = await invoke<ArrayBuffer>('read_model_resource', { id: info.id, resource });
        if (/\.(motion3|exp3)\.json$/i.test(path))
          documents.set(path, JSON.parse(new TextDecoder().decode(data)));
        else if (path === displayFile) displayDocument = JSON.parse(new TextDecoder().decode(data));
        else if (path === physicsFile) physicsDocument = JSON.parse(new TextDecoder().decode(data));
        const type = /\.wav$/i.test(path)
          ? 'audio/wav'
          : /\.mp3$/i.test(path)
            ? 'audio/mpeg'
            : /\.ogg$/i.test(path)
              ? 'audio/ogg'
              : /\.png$/i.test(path)
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
      this.stopMotion();
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
      this.expressionLayers.clear();
      this.trackingLost = false;
      this.expressionIds.clear();
      this.resetSnapshot();
      this.physicsGroups = this.passive ? [] : physicsGroupsFromJson(physicsDocument);
      this.motions = motionDefinitions
        .filter((def) => documents.has(def.file))
        .map((def) => ({
          ...def,
          data: documents.get(def.file)!,
          sound: def.definition.Sound ? resolved.get(def.definition.Sound) : undefined,
        }));
      this.expressions = expressionDefinitions
        .filter((def: { file: string }) => documents.has(def.file))
        .map((def: { id: string; name: string; file: string }) => ({
          ...def,
          data: documents.get(def.file)!,
        }));
      const raw = core.parameters;
      this.parameters = describeParameters(
        Array.from(raw.ids, (id, i) => ({
          id,
          min: raw.minimumValues[i],
          max: raw.maximumValues[i],
          default: raw.defaultValues[i],
        })),
        displayDocument,
      );
      const expressionManager = internal.motionManager.expressionManager;
      let expressionTime: number | undefined;
      if (expressionManager)
        expressionManager.update = (_core, now) => {
          const dt = expressionTime === undefined ? 0 : clamp(now - expressionTime, 0, 0.1);
          expressionTime = now;
          let removed = false;
          for (const [id, layer] of this.expressionLayers) {
            layer.elapsed += dt;
            const progress = layer.duration <= 0 ? 1 : clamp(layer.elapsed / layer.duration, 0, 1);
            layer.weight =
              layer.from + (layer.target - layer.from) * (0.5 - 0.5 * Math.cos(progress * Math.PI));
            if (layer.target === 0 && progress === 1) {
              this.expressionLayers.delete(id);
              removed = true;
              continue;
            }
            // Cubism handles Add/Multiply/Overwrite; expression motions do not use the queue entry.
            layer.motion.doUpdateParameters(internal.coreModel, now, layer.weight, null!);
          }
          // setExpression adds a new layer's IDs itself; only a finished fade-out shrinks the set.
          if (removed)
            this.expressionIds = new Set(
              [...this.expressionLayers.keys()].flatMap(
                (id) =>
                  this.expressions.find((e) => e.id === id)?.data.Parameters?.map((p) => p.Id) ??
                  [],
              ),
            );
          return this.expressionLayers.size > 0;
        };
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
      // Every *ById call (ours and Cubism's motions, expressions, breath, blink and focus) scans
      // all IDs to find the index. Remember each answer for this model; an unknown ID keeps the
      // placeholder index Cubism registers for it on first sight.
      const coreModel = internal.coreModel;
      for (const method of ['getParameterIndex', 'getPartIndex'] as const) {
        const lookup = coreModel[method].bind(coreModel);
        const indices = new Map<string, number>();
        coreModel[method] = (id) => {
          let index = indices.get(id);
          if (index === undefined) indices.set(id, (index = lookup(id)));
          return index;
        };
      }
      const blinking: string[] = [];
      internal.on('beforeMotionUpdate', () => {
        for (const p of this.parameters) internal.coreModel.setParameterValueById(p.id, p.default);
        if (!this.passive) {
          internal.eyeBlink = this.settings?.autoBlink ? blink : undefined;
          blinking.length = 0;
          for (const id of blinkIds)
            if (
              !Object.hasOwn(this.values, id) &&
              !this.playing?.ids.has(id) &&
              !this.expressionIds.has(id) &&
              !Object.hasOwn(this.held, id)
            )
              blinking.push(id);
          blink?.setParameterIds(blinking);
        }
      });
      internal.on('afterMotionUpdate', () => {
        if (this.passive) return;
        for (const id in this.held) internal.coreModel.setParameterValueById(id, this.held[id]);
        for (const id in this.values) {
          if (
            (!this.playing ||
              (this.playing.idle && !this.trackingLost) ||
              !this.playing.ids.has(id)) &&
            !Object.hasOwn(this.held, id)
          )
            internal.coreModel.setParameterValueById(id, this.values[id]);
        }
        if (this.playing?.finished) {
          this.stopMotionAudio();
          if (this.playing.mode === 'hold') {
            for (const id of this.playing.ids)
              this.held[id] = internal.coreModel.getParameterValueById(id);
          }
          this.playing = undefined;
        }
      });
      const natural = internal.updateNaturalMovements.bind(internal);
      // Flat [index, value] pairs; restoring a repeated ID twice writes the same value.
      const saved: number[] = [];
      let count = 0;
      const save = (id: string) => {
        const index = coreModel.getParameterIndex(id);
        saved[count++] = index;
        saved[count++] = coreModel.getParameterValueByIndex(index);
      };
      internal.updateNaturalMovements = (dt, now) => {
        if (this.passive) return;
        count = 0;
        for (const id in this.values) save(id);
        for (const id in this.held) save(id);
        for (const id of this.expressionIds) save(id);
        if (this.playing) for (const id of this.playing.ids) save(id);
        natural(dt, now);
        for (let i = 0; i < count; i += 2)
          coreModel.setParameterValueByIndex(saved[i], saved[i + 1]);
      };
      const snapshot = {
        parameters: { ids: raw.ids, values: new Float32Array(raw.values.length) },
        parts: { ids: core.parts.ids, values: new Float32Array(core.parts.opacities.length) },
      };
      internal.on('beforeModelUpdate', () => {
        if (this.passive) {
          for (const id in this.values)
            internal.coreModel.setParameterValueById(id, this.values[id]);
          for (const id in this.incomingParts)
            internal.coreModel.setPartOpacityById(id, this.incomingParts[id]);
        }
        if (!this.passive)
          for (const p of this.parameters) {
            const value = this.settings?.parameterOverrides[p.id];
            if (Number.isFinite(value))
              internal.coreModel.setParameterValueById(p.id, clamp(value!, p.min, p.max));
          }
        // Cubism restores its saved parameters right after this update, so copy them now.
        snapshot.parameters.values.set(raw.values);
        snapshot.parts.values.set(core.parts.opacities);
        this.resetSnapshot(snapshot);
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
    if (!settings.motionSound) this.stopMotionAudio();
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
    candidate.onWarning = this.onWarning;
    try {
      if (info) await candidate.load(info);
      await candidate.compose(settings, models);
      candidate.restoreDefaultAppearance(settings);
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

  /**
   * Renders the stage letterboxed into a width×height texture, at 2x and box-downsampled when
   * `supersampled`. Without a background the scene's background layer is hidden and the frame
   * stays transparent; with one (premultiplied RGBA), the whole frame is filled with it first and
   * optionally mirrored.
   */
  private renderOutput(
    target: OutputTarget,
    width: number,
    height: number,
    supersampled: boolean,
    background?: number[],
    mirror = false,
  ): PIXI.RenderTexture {
    const renderer = this.app.renderer as PIXI.Renderer;
    // A lost context renders and reads nothing, which would republish the previous frame.
    if (renderer.gl.isContextLost()) throw new Error('显卡上下文已丢失');
    const resolution = supersampled ? 2 : 1;
    if (
      target.texture?.width !== width ||
      target.texture.height !== height ||
      target.texture.resolution !== resolution
    ) {
      target.stage?.destroy();
      target.stage = undefined;
      target.sprite?.destroy();
      target.sprite = undefined;
      target.output?.destroy(true);
      target.output = undefined;
      target.texture?.destroy(true);
      target.texture = PIXI.RenderTexture.create({ width, height, resolution });
    }
    // Render into the letterboxed area only, so its viewport crops overflow like the preview does.
    const screen = this.app.screen;
    const scale = Math.min(width / screen.width, height / screen.height);
    const frame = new PIXI.Rectangle(
      0,
      0,
      Math.round(screen.width * scale),
      Math.round(screen.height * scale),
    );
    frame.x = Math.round((width - frame.width) / 2);
    frame.y = Math.round((height - frame.height) / 2);
    const previous = target.stage?.frame;
    if (
      previous?.x !== frame.x ||
      previous.y !== frame.y ||
      previous.width !== frame.width ||
      previous.height !== frame.height
    ) {
      // The previous letterbox may have covered pixels outside the new one.
      renderer.renderTexture.bind(target.texture);
      renderer.renderTexture.clear();
      target.stage?.destroy();
      target.stage = new PIXI.RenderTexture(
        target.texture.baseTexture as PIXI.BaseRenderTexture,
        frame,
      );
    }
    const transform = new PIXI.Matrix(
      frame.width / screen.width,
      0,
      0,
      frame.height / screen.height,
    );
    const layer = background ? undefined : this.layers?.background;
    const visible = layer?.visible;
    try {
      if (layer) layer.visible = false;
      renderer.render(this.app.stage, { renderTexture: target.stage, transform, clear: true });
    } finally {
      if (layer) layer.visible = visible!;
    }
    if (resolution === 1 && !background) return target.texture;
    // ponytail: linear sampling at exactly half size is a 2x2 box filter; use a Lanczos
    // shader if sharper output is ever needed.
    target.output ??= PIXI.RenderTexture.create({ width, height });
    target.sprite ??= new PIXI.Sprite(target.texture);
    // Compositing over the cleared fill matches drawing the transparent preview over it.
    if (background) (target.output.baseTexture as PIXI.BaseRenderTexture).clearColor = background;
    target.sprite.scale.x = mirror ? -1 : 1;
    target.sprite.x = mirror ? width : 0;
    renderer.render(target.sprite, { renderTexture: target.output, clear: true });
    return target.output;
  }

  private readOutput(target: OutputTarget, texture: PIXI.RenderTexture) {
    const renderer = this.app.renderer as PIXI.Renderer;
    const { width, height } = texture;
    renderer.renderTexture.bind(texture);
    if (target.pixels?.length !== width * height * 4)
      target.pixels = new Uint8Array(width * height * 4);
    const gl = renderer.gl;
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, target.pixels);
    return target.pixels;
  }

  transparentCanvas(): HTMLCanvasElement {
    return this.app.renderer.plugins.extract.canvas(
      this.renderOutput(this.transparent, 1280, 720, !!this.settings?.supersample),
    );
  }

  /** Top-down premultiplied RGBA. The buffer is reused by the next call. */
  transparentPixels(width: number, height: number): Uint8Array {
    return this.readOutput(
      this.transparent,
      this.renderOutput(this.transparent, width, height, !!this.settings?.supersample),
    );
  }

  /**
   * Top-down opaque RGBA of the preview, scene background included, letterboxed over `background`
   * (any CSS color, over black). The buffer is reused by the next call. Undefined while the stage
   * has no size or the WebGL context is lost, so the camera skips those frames.
   */
  cameraPixels(
    width: number,
    height: number,
    background: string,
    mirror: boolean,
  ): Uint8Array | undefined {
    const renderer = this.app.renderer as PIXI.Renderer;
    if (renderer.gl.isContextLost() || !this.app.screen.width || !this.app.screen.height) return;
    if (this.cameraBackground?.color !== background) {
      // The 2D canvas parses any CSS color exactly as the camera used to fill its frame.
      const context = document.createElement('canvas').getContext('2d')!;
      context.fillStyle = '#000000';
      context.fillRect(0, 0, 1, 1);
      context.fillStyle = background;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
      this.cameraBackground = { color: background, rgba: [r / 255, g / 255, b / 255, 1] };
    }
    return this.readOutput(
      this.camera,
      // The camera used to scale down the preview canvas, so match its sharpness on HiDPI screens
      // even without supersampling.
      this.renderOutput(
        this.camera,
        width,
        height,
        !!this.settings?.supersample || renderer.resolution > 1,
        this.cameraBackground.rgba,
        mirror,
      ),
    );
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
    const native = Math.min(devicePixelRatio, 2);
    // Extra samples keep line art and edges sharp where trilinear mipmapping alone blurs them.
    // Cap them at a 4K drawing buffer so a large window cannot exhaust the GPU.
    const resolution = this.settings?.supersample
      ? Math.max(native, Math.min(2, Math.sqrt((3840 * 2160) / (width * height))))
      : native;
    const renderer = this.app.renderer;
    // Layout runs on every settings change, and a resize reallocates the drawing buffer even
    // when nothing changed. Unchanged buffer size and resolution also mean an unchanged screen.
    if (
      renderer.resolution !== resolution ||
      renderer.view.width !== Math.round(width * resolution) ||
      renderer.view.height !== Math.round(height * resolution)
    ) {
      renderer.resolution = resolution;
      renderer.resize(width, height);
    }
    if (!this.model || !this.settings) return;
    const model = this.model,
      s = this.settings;
    model.visible = s.modelVisible;
    this.modelScale =
      Math.min(width / model.internalModel.width, height / model.internalModel.height) *
      0.92 *
      s.zoom;
    model.anchor.set(0.5);
    model.rotation = (s.rotation * Math.PI) / 180;
    model.scale.set(this.modelScale * this.depthScale);
    model.position.set(width * (0.5 + s.x), height * (0.5 + s.y));
  }

  playMotion(id: string, mode: MotionMode = 'once', idle = false) {
    const entry = this.motions.find((m) => m.id === id);
    const internal = this.model?.internalModel as Cubism4InternalModel | undefined;
    if (!entry || !internal || this.passive) return;
    this.stopMotion();
    const motion = internal.motionManager.createMotion(
      entry.data,
      entry.group,
      entry.definition ?? { File: entry.file },
    );
    if (entry.definition?.FadeInTime === 0) motion.setFadeInTime(0);
    if (entry.definition?.FadeOutTime === 0) motion.setFadeOutTime(0);
    const fade = this.settings?.hotkeyOptions[`motion:${id}`]?.fadeSeconds;
    if (fade !== undefined) {
      motion.setFadeInTime(fade);
      motion.setFadeOutTime(fade);
      for (const curve of entry.data.Curves ?? [])
        if (curve.Target === 'Parameter') {
          motion.setParameterFadeInTime(curve.Id, fade);
          motion.setParameterFadeOutTime(curve.Id, fade);
        }
    }
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
    if (entry.sound && this.settings?.motionSound && !this.sharedApp) {
      const audio = new Audio(entry.sound);
      this.motionAudio = audio;
      audio.loop = mode === 'loop';
      void audio.play().catch(() => {
        if (this.motionAudio === audio) {
          this.stopMotionAudio();
          this.onWarning?.('动作音效播放失败。请检查音频文件，或点击动作按钮重试。');
        }
      });
    }
  }

  private stopMotionAudio() {
    this.motionAudio?.pause();
    if (this.motionAudio) this.motionAudio.src = '';
    this.motionAudio = undefined;
  }

  stopMotion() {
    this.stopMotionAudio();
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

  captureHeldParameters() {
    if (this.playing?.mode === 'hold') throw new Error('请等保持动作播放结束后，再保存默认外观。');
    return { ...this.held };
  }

  restoreDefaultAppearance(settings: Settings) {
    this.stopMotion();
    for (const p of this.parameters) {
      const value = settings.defaultHeldParameters[p.id];
      if (Number.isFinite(value)) this.held[p.id] = clamp(value, p.min, p.max);
    }
    this.restoreExpressions(settings.defaultExpressions);
  }

  toggleExpression(id: string, seconds?: number, fadeSeconds?: number) {
    this.setExpression(id, !this.activeExpressions.has(id), seconds, fadeSeconds);
  }

  setExpression(id: string, active: boolean, seconds?: number, fadeSeconds?: number) {
    const entry = this.expressions.find((e) => e.id === id);
    const manager = (this.model?.internalModel as Cubism4InternalModel | undefined)?.motionManager
      .expressionManager;
    if (!entry || !manager || this.passive) return;
    this.expressionExpiry.delete(id);
    if (active) {
      this.activeExpressions.add(id);
      if (seconds) this.expressionExpiry.set(id, performance.now() + seconds * 1000);
    } else this.activeExpressions.delete(id);
    const previous = this.expressionLayers.get(id);
    const motion =
      previous?.motion ??
      manager.createExpression(entry.data, { Name: entry.name, File: entry.file });
    const configured = fadeSeconds ?? this.settings?.hotkeyOptions[`expression:${id}`]?.fadeSeconds;
    const authored = active ? motion.getFadeInTime() : motion.getFadeOutTime();
    const duration = configured ?? (Number.isFinite(authored) && authored >= 0 ? authored : 1);
    if (active && previous?.target === 0) this.expressionLayers.delete(id);
    this.expressionLayers.set(id, {
      motion,
      from: previous?.weight ?? 0,
      weight: previous?.weight ?? 0,
      target: active ? 1 : 0,
      elapsed: 0,
      duration,
    });
    for (const p of entry.data.Parameters ?? []) this.expressionIds.add(p.Id);
  }

  clearExpressions(fadeSeconds?: number) {
    for (const id of this.expressionLayers.keys())
      this.setExpression(id, false, undefined, fadeSeconds);
    this.expressionExpiry.clear();
  }

  restoreExpressions(ids: string[]) {
    this.activeExpressions.clear();
    this.expressionExpiry.clear();
    this.expressionLayers.clear();
    this.expressionIds.clear();
    for (const id of ids) this.setExpression(id, true, undefined, 0);
  }

  get sceneFrames(): SceneFrames {
    return this.layers?.frames ?? {};
  }

  draw(
    values: Record<string, number>,
    dt: number,
    parts: Record<string, number> = {},
    sceneFrames?: SceneFrames,
    depthScale = 1,
  ) {
    this.depthScale = Number.isFinite(depthScale) ? Math.min(1.5, Math.max(0.5, depthScale)) : 1;
    if (!this.sharedApp) this.model?.scale.set(this.modelScale * this.depthScale);
    for (const [id, expiry] of this.expressionExpiry)
      if (performance.now() >= expiry) this.setExpression(id, false);
    this.values = values;
    this.incomingParts = parts;
    if (!this.passive && !this.sharedApp) {
      const idle =
        (this.trackingLost && this.settings?.lostIdleMotion) || this.settings?.idleMotion;
      if (this.playing?.idle && this.playing.id !== idle) this.stopMotion();
      if (!this.playing && !Object.keys(this.held).length && idle)
        this.playMotion(idle, 'loop', true);
    }
    this.model?.update(Math.min(dt, 100));
    if (this.settings)
      this.layers?.draw(
        this.settings,
        this.app.screen.width,
        this.app.screen.height,
        dt,
        sceneFrames,
        this.depthScale,
      );
    if (!this.sharedApp) this.app.render();
  }

  clear() {
    this.generation++;
    this.stopMotion();
    this.expressionLayers.clear();
    this.expressionIds.clear();
    this.trackingLost = false;
    this.depthScale = 1;
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
    this.resetSnapshot();
    this.app.render();
  }

  destroy() {
    if (!this.sharedApp) this.app.view.removeEventListener('webglcontextlost', this.contextLost);
    this.compositionGeneration++;
    this.clear();
    this.observer?.disconnect();
    this.layers?.destroy();
    for (const target of [this.transparent, this.camera]) {
      target.stage?.destroy();
      target.sprite?.destroy();
      target.output?.destroy(true);
      target.texture?.destroy(true);
    }
    if (this.sharedApp) this.content.destroy();
    else this.app.destroy(true);
  }
}
