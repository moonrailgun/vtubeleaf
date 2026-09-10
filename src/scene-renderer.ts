import * as PIXI from 'pixi.js';
import { invoke } from '@tauri-apps/api/core';
import { parseGIF, decompressFrames } from 'gifuct-js';
import { builtinBackgrounds, type SceneItem, type Composition } from './scenes';
import type { Settings } from './state';
import type { AvatarStage, ModelInfo } from './renderer';

export type SceneFrame = {
  index?: number;
  parameters?: Record<string, number>;
  parts?: Record<string, number>;
};
export type SceneFrames = Record<string, SceneFrame>;
type Visual = {
  node: PIXI.Container;
  item?: SceneItem;
  width: number;
  height: number;
  update: (dt: number, frame?: SceneFrame) => void;
  capture: () => SceneFrame;
  destroy: () => void;
};

async function imageAsset(id: string): Promise<Visual> {
  const background = builtinBackgrounds.find((b) => b.id === id);
  const bytes = background
    ? await fetch(background.src).then((response) => {
        if (!response.ok) throw new Error(`内置背景「${background.name}」加载失败`);
        return response.arrayBuffer();
      })
    : await invoke<ArrayBuffer>('read_asset', { id });
  let texture: PIXI.Texture;
  let update = (_dt: number, _frame?: SceneFrame) => {};
  let capture = (): SceneFrame => ({});
  let revoke = () => {};
  if (id.endsWith('.gif')) {
    const gif = parseGIF(bytes);
    const { width, height } = gif.lsd;
    const images = gif.frames.filter((f) => 'image' in f);
    if (
      !width ||
      !height ||
      width > 4096 ||
      height > 4096 ||
      images.length > 300 ||
      images.reduce(
        (sum, f) =>
          sum + ('image' in f ? f.image.descriptor.width * f.image.descriptor.height * 4 : 0),
        0,
      ) >
        64 * 1024 * 1024 ||
      images.some(
        (f) =>
          'image' in f &&
          (f.image.descriptor.width <= 0 ||
            f.image.descriptor.height <= 0 ||
            f.image.descriptor.left + f.image.descriptor.width > width ||
            f.image.descriptor.top + f.image.descriptor.height > height),
      )
    )
      throw new Error('GIF 尺寸或帧数过大（最大 4096 像素、300 帧、64 MB 解码数据）');
    const frames = decompressFrames(gif, true);
    if (!frames.length) throw new Error('GIF 没有可显示的图像');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    const patch = document.createElement('canvas');
    const patchContext = patch.getContext('2d')!;
    texture = PIXI.Texture.from(canvas);
    let index = -1,
      elapsed = 0,
      saved: ImageData | undefined;
    const next = () => {
      const previous = frames[index];
      if (previous?.disposalType === 2)
        context.clearRect(
          previous.dims.left,
          previous.dims.top,
          previous.dims.width,
          previous.dims.height,
        );
      if (previous?.disposalType === 3 && saved) context.putImageData(saved, 0, 0);
      index = (index + 1) % frames.length;
      if (index === 0) context.clearRect(0, 0, width, height);
      const frame = frames[index];
      saved = frame.disposalType === 3 ? context.getImageData(0, 0, width, height) : undefined;
      patch.width = frame.dims.width;
      patch.height = frame.dims.height;
      patchContext.putImageData(
        new ImageData(new Uint8ClampedArray(frame.patch), patch.width, patch.height),
        0,
        0,
      );
      context.drawImage(patch, frame.dims.left, frame.dims.top);
      texture.baseTexture.update();
    };
    next();
    capture = () => ({ index });
    update = (dt, source) => {
      if (source) {
        const target = source.index;
        if (Number.isInteger(target) && target! >= 0 && target! < frames.length)
          while (index !== target) next();
        return;
      }
      elapsed += Math.min(dt, 100);
      while (elapsed >= Math.max(20, frames[index].delay)) {
        elapsed -= Math.max(20, frames[index].delay);
        next();
      }
    };
  } else {
    const url = URL.createObjectURL(
      new Blob([bytes], { type: id.endsWith('.png') ? 'image/png' : 'image/jpeg' }),
    );
    revoke = () => URL.revokeObjectURL(url);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (
        image.naturalWidth > 8192 ||
        image.naturalHeight > 8192 ||
        image.naturalWidth * image.naturalHeight > 32 * 1024 * 1024
      )
        throw new Error('图片尺寸过大');
      texture = PIXI.Texture.from(image);
    } catch (error) {
      revoke();
      throw error;
    }
  }
  const node = new PIXI.Sprite(texture);
  node.anchor.set(0.5);
  return {
    node,
    width: texture.width,
    height: texture.height,
    update,
    capture,
    destroy: () => {
      node.destroy({ texture: true, baseTexture: true });
      revoke();
    },
  };
}

export class SceneLayers {
  readonly root = new PIXI.Container();
  private visuals: Visual[] = [];
  private signature = '';
  private generation = 0;
  constructor(private createModel: () => AvatarStage) {
    this.root.sortableChildren = true;
  }

  async load(composition: Composition, models: ModelInfo[]) {
    const signature = JSON.stringify([
      composition.backgroundImage,
      composition.items.map(({ id, kind, source }) => [id, kind, source]),
    ]);
    const generation = ++this.generation;
    if (this.signature === signature) return;
    const visuals: Visual[] = [];
    try {
      if (composition.backgroundImage) visuals.push(await imageAsset(composition.backgroundImage));
      for (const item of composition.items) {
        if (item.kind === 'image') visuals.push({ ...(await imageAsset(item.source)), item });
        else {
          const info = models.find((model) => model.path === item.source);
          if (!info) throw new Error(`Live2D 道具「${item.name}」不在角色库中，请重新导入`);
          const stage = this.createModel();
          try {
            await stage.load(info);
            stage.centeredItem();
            if (stage.motions[0]) stage.playMotion(stage.motions[0].id, 'loop', true);
            const bounds = stage.content.getLocalBounds();
            visuals.push({
              item,
              node: stage.content,
              width: bounds.width,
              height: bounds.height,
              update: (dt, frame) => stage.draw(frame?.parameters ?? {}, dt, frame?.parts),
              capture: () => ({ parameters: stage.frame, parts: stage.parts }),
              destroy: () => stage.destroy(),
            });
          } catch (error) {
            stage.destroy();
            throw error;
          }
        }
      }
      if (generation !== this.generation) {
        visuals.forEach((v) => v.destroy());
        return;
      }
      this.visuals.forEach((v) => v.destroy());
      this.visuals = visuals;
      this.signature = signature;
      for (const visual of visuals) this.root.addChild(visual.node);
    } catch (error) {
      visuals.forEach((v) => v.destroy());
      throw error;
    }
  }

  get frames(): SceneFrames {
    return Object.fromEntries(
      this.visuals.map((visual) => [visual.item?.id ?? 'background', visual.capture()]),
    );
  }

  draw(s: Settings, width: number, height: number, dt: number, frames?: SceneFrames) {
    for (const visual of this.visuals) {
      const item = visual.item && s.composition.items.find((i) => i.id === visual.item!.id);
      const node = visual.node;
      if (visual.item && !item) {
        node.visible = false;
        continue;
      }
      if (!item) {
        node.zIndex = -1000;
        node.scale.set(Math.max(width / visual.width, height / visual.height));
        node.position.set(width / 2, height / 2);
      } else {
        node.visible = item.visible;
        node.alpha = item.opacity;
        node.zIndex = (item.behind ? -500 : 1) + s.composition.items.indexOf(item);
        const attached = item.attach === 'model';
        const angle = attached ? (s.rotation * Math.PI) / 180 : 0;
        const zoom = attached ? s.zoom : 1;
        const x = item.x * width * zoom,
          y = item.y * height * zoom;
        node.position.set(
          width * (0.5 + (attached ? s.x : 0)) + x * Math.cos(angle) - y * Math.sin(angle),
          height * (0.5 + (attached ? s.y : 0)) + x * Math.sin(angle) + y * Math.cos(angle),
        );
        node.scale.set(Math.min(width / visual.width, height / visual.height) * item.scale * zoom);
        node.rotation = (item.rotation * Math.PI) / 180 + angle;
      }
      if (node.visible)
        visual.update(dt, frames && (frames[visual.item?.id ?? 'background'] ?? {}));
    }
  }

  destroy() {
    this.generation++;
    this.visuals.forEach((v) => v.destroy());
    this.visuals = [];
    this.root.destroy();
  }
}
