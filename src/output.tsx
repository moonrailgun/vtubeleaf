import { useEffect, useRef } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { AvatarStage, type ModelInfo } from './renderer';
import { defaults, readSettings, type Settings } from './state';
import type { SceneFrames } from './scene-renderer';

export type OutputState = {
  model: ModelInfo | null;
  models: ModelInfo[];
  settings: Settings;
  revision: number;
};
export type OutputFrame = {
  revision: number;
  parameters: Record<string, number>;
  parts: Record<string, number>;
  sceneFrames: SceneFrames;
};

export function Output() {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const native = isTauri();
    const previousTitle = document.title;
    document.title = 'VTubeLeaf Output';
    document.body.classList.add('output');
    let stage: AvatarStage | undefined;
    let model: ModelInfo | null = null;
    let revision = 0;
    let values: Record<string, number> = {};
    let parts: Record<string, number> = {};
    let sceneFrames: SceneFrames = {};
    let received = 0;
    let disposed = false;
    let stateOperation = 0;
    let pendingState: OutputState | undefined;
    let applyingState = false;
    const unlisteners: UnlistenFn[] = [];
    const report = () => {
      if (native && !disposed)
        void emitTo(
          'main',
          'output-error',
          '输出渲染失败。请关闭输出窗口后重试，并检查模型。',
        ).catch(() => {});
    };
    const own = async (subscription: Promise<UnlistenFn>) => {
      const unlisten = await subscription;
      if (disposed) unlisten();
      else unlisteners.push(unlisten);
    };
    try {
      stage = new AvatarStage(container.current!, report, true);
      stage.display(defaults);
    } catch {
      report();
    }
    async function connect() {
      if (!native) return;
      await own(
        listen<OutputState>('output-state', async ({ payload }) => {
          if (disposed) return;
          pendingState = payload;
          ++stateOperation;
          if (applyingState) return;
          applyingState = true;
          try {
            while (pendingState && !disposed) {
              const payload = pendingState;
              pendingState = undefined;
              const operation = stateOperation;
              const settings = readSettings(payload.settings);
              const next = payload.model;
              let candidate: AvatarStage | undefined;
              try {
                if (stage && (payload.revision !== revision || next?.id !== model?.id)) {
                  candidate = await stage.prepare(next, settings, payload.models ?? []);
                  if (disposed || operation !== stateOperation) continue;
                  candidate.mount(container.current!);
                  stage.destroy();
                  stage = candidate;
                  candidate = undefined;
                  model = next;
                  revision = payload.revision;
                  values = {};
                  parts = {};
                  sceneFrames = {};
                } else {
                  await stage?.compose(settings, payload.models ?? []);
                }
              } catch {
                if (!disposed && operation === stateOperation) report();
              } finally {
                candidate?.destroy();
              }
            }
          } finally {
            applyingState = false;
          }
        }),
      );
      if (disposed) return;
      await own(
        listen<OutputFrame>('output-frame', ({ payload }) => {
          if (disposed || payload.revision !== revision) return;
          values = payload.parameters;
          parts = payload.parts;
          sceneFrames = payload.sceneFrames ?? {};
          received = performance.now();
        }),
      );
      if (disposed) return;
      await own(
        getCurrentWindow().onCloseRequested(() => {
          void emitTo('main', 'output-closed').catch(() => {});
        }),
      );
      if (!disposed) await emitTo('main', 'output-ready');
    }
    void connect().catch(report);
    let before = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (now - received > 1000)
        for (const p of stage?.parameters ?? [])
          values[p.id] =
            (values[p.id] ?? p.default) + (p.default - (values[p.id] ?? p.default)) * 0.15;
      stage?.draw(values, now - before, parts, sceneFrames);
      before = now;
    }, 1000 / 30);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      unlisteners.forEach((unlisten) => unlisten());
      stage?.destroy();
      document.body.classList.remove('output');
      document.title = previousTitle;
    };
  }, []);
  return <div id="stage" ref={container} aria-label="角色输出" />;
}
