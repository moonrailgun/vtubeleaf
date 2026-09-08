export type SceneItem = {
  id: string;
  name: string;
  kind: 'image' | 'live2d';
  source: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  behind: boolean;
  attach: 'stage' | 'model';
};
export type Composition = { backgroundImage: string; items: SceneItem[] };
export type Placement = {
  x: number;
  y: number;
  zoom: number;
  rotation: number;
  modelVisible: boolean;
};
export type Scene = {
  id: string;
  name: string;
  modelPath: string;
  background: string;
  placement: Placement;
  composition: Composition;
};
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const number = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
const id = (v: unknown): v is string => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(v);
export const assetId = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-f0-9]{32}\.(png|jpg|gif)$/.test(v);

export function readComposition(v: unknown): Composition {
  const result: Composition = { backgroundImage: '', items: [] };
  if (!object(v)) return result;
  if (assetId(v.backgroundImage)) result.backgroundImage = v.backgroundImage;
  if (!Array.isArray(v.items)) return result;
  for (const item of v.items.slice(0, 32)) {
    if (
      !object(item) ||
      !id(item.id) ||
      !['image', 'live2d'].includes(String(item.kind)) ||
      result.items.some((i) => i.id === item.id)
    )
      continue;
    const live = item.kind === 'live2d';
    if (
      live
        ? typeof item.source !== 'string' || !item.source || item.source.length >= 4096
        : !assetId(item.source)
    )
      continue;
    if (live && result.items.filter((i) => i.kind === 'live2d').length >= 4) continue;
    result.items.push({
      id: item.id,
      name: typeof item.name === 'string' ? item.name.slice(0, 100) : '道具',
      kind: live ? 'live2d' : 'image',
      source: item.source as string,
      x: number(item.x, 0, -2, 2),
      y: number(item.y, 0, -2, 2),
      scale: number(item.scale, 0.4, 0.05, 4),
      rotation: number(item.rotation, 0, -180, 180),
      opacity: number(item.opacity, 1, 0, 1),
      visible: item.visible !== false,
      locked: item.locked === true,
      behind: item.behind === true,
      attach: item.attach === 'model' ? 'model' : 'stage',
    });
  }
  return result;
}

export function snapshotScene(
  id: string,
  name: string,
  modelPath: string,
  background: string,
  placement: Placement,
  composition: Composition,
): Scene {
  return {
    id,
    name: name.slice(0, 100),
    modelPath,
    background,
    placement: { ...placement },
    composition: structuredClone(composition),
  };
}

export function readScenes(v: unknown): Scene[] {
  if (!Array.isArray(v)) return [];
  const result: Scene[] = [];
  for (const scene of v.slice(0, 32)) {
    if (!object(scene) || !id(scene.id) || result.some((s) => s.id === scene.id)) continue;
    const p = object(scene.placement) ? scene.placement : {};
    result.push(
      snapshotScene(
        scene.id,
        typeof scene.name === 'string' ? scene.name : '场景',
        typeof scene.modelPath === 'string' && scene.modelPath.length < 4096 ? scene.modelPath : '',
        typeof scene.background === 'string' && /^#[a-f0-9]{6}$/i.test(scene.background)
          ? scene.background
          : '#e5ebdd',
        {
          x: number(p.x, 0, -0.8, 0.8),
          y: number(p.y, 0, -0.8, 0.8),
          zoom: number(p.zoom, 1, 0.25, 2.5),
          rotation: number(p.rotation, 0, -180, 180),
          modelVisible: p.modelVisible !== false,
        },
        readComposition(scene.composition),
      ),
    );
  }
  return result;
}
