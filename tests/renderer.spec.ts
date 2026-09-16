import { test, expect, type Page } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Keep the real Cubism model and replace only authorable metadata/action files.
async function loadControls(page: Page) {
  const root = resolve('vendor/models/Haru');
  const model = JSON.parse(readFileSync(resolve(root, 'Haru.model3.json'), 'utf8'));
  const motion = (value: number) => ({
    Version: 3,
    Meta: {
      Duration: 4,
      Fps: 30,
      Loop: false,
      AreBeziersRestricted: true,
      CurveCount: 1,
      TotalSegmentCount: 1,
      TotalPointCount: 2,
      UserDataCount: 0,
      TotalUserDataSize: 0,
    },
    Curves: [
      {
        Target: 'Parameter',
        Id: 'ParamAngleX',
        FadeInTime: 0,
        FadeOutTime: 0,
        Segments: [0, value, 0, 4, value],
      },
    ],
    UserData: [],
  });
  const documents: Record<string, unknown> = {
    'controls.cdi3.json': {
      Version: 3,
      Parameters: [
        { Id: 'ParamAngleX', Name: '头部左右', GroupId: 'head' },
        { Id: 'Absent', Name: '不存在' },
      ],
      ParameterGroups: [
        { Id: 'head', Name: '头部', GroupId: 'body' },
        { Id: 'body', Name: '身体' },
      ],
    },
    'overwrite.exp3.json': {
      Type: 'Live2D Expression',
      FadeInTime: 0.4,
      FadeOutTime: 0.6,
      Parameters: [{ Id: 'ParamAngleX', Value: 20, Blend: 'Overwrite' }],
    },
    'add.exp3.json': {
      Type: 'Live2D Expression',
      FadeInTime: 0,
      FadeOutTime: 0,
      Parameters: [{ Id: 'ParamAngleX', Value: 4, Blend: 'Add' }],
    },
    'multiply.exp3.json': {
      Type: 'Live2D Expression',
      FadeInTime: 0,
      FadeOutTime: 0,
      Parameters: [{ Id: 'ParamAngleX', Value: 0.5, Blend: 'Multiply' }],
    },
    'idle.motion3.json': motion(10),
    'lost.motion3.json': motion(25),
    'manual.motion3.json': motion(20),
  };
  model.FileReferences.DisplayInfo = 'controls.cdi3.json';
  model.FileReferences.Expressions = [
    { Name: '转头', File: 'overwrite.exp3.json' },
    { Name: '偏移', File: 'add.exp3.json' },
    { Name: '缩小', File: 'multiply.exp3.json' },
  ];
  model.FileReferences.Motions = {
    Idle: [{ File: 'idle.motion3.json', FadeInTime: 0, FadeOutTime: 0 }],
    Lost: [{ File: 'lost.motion3.json', FadeInTime: 0, FadeOutTime: 0 }],
    Manual: [{ File: 'manual.motion3.json', FadeInTime: 0, FadeOutTime: 0, Sound: 'sound.wav' }],
  };
  documents['Haru.model3.json'] = model;
  const files = [
    'Haru.model3.json',
    model.FileReferences.Moc,
    ...model.FileReferences.Textures,
    model.FileReferences.Physics,
    model.FileReferences.Pose,
    model.FileReferences.UserData,
    ...Object.keys(documents),
    'sound.wav',
  ].filter(Boolean);
  await page.route('**/renderer-controls/**', (route) => {
    const resource = decodeURIComponent(
      new URL(route.request().url()).pathname.slice('/renderer-controls/'.length),
    );
    if (Object.hasOwn(documents, resource)) return route.fulfill({ json: documents[resource] });
    if (resource === 'sound.wav')
      return route.fulfill({ body: Buffer.from('RIFF mocked audio'), contentType: 'audio/wav' });
    return files.includes(resource)
      ? route.fulfill({ path: resolve(root, resource) })
      : route.abort();
  });
  await page.goto('/?output=1');
  await page.evaluate(
    async (info) => {
      const renderer = '/src/renderer.ts',
        state = '/src/state.ts';
      const { mockIPC } = await import('/node_modules/@tauri-apps/api/mocks.js');
      const { AvatarStage } = await import(renderer);
      const { defaults } = await import(state);
      mockIPC(async (cmd: string, args: { resource: string }) => {
        if (cmd === 'read_model_resource')
          return (await fetch('/renderer-controls/' + encodeURI(args.resource))).arrayBuffer();
      });
      const container = document.createElement('div');
      container.style.cssText = 'position:fixed;inset:0;width:500px;height:500px';
      document.body.append(container);
      const stage = new AvatarStage(container, () => {
        throw new Error('WebGL context lost');
      });
      const settings = structuredClone(defaults);
      settings.autoBlink = false;
      settings.physicsStrength = 0;
      stage.display(settings);
      await stage.load(info);
      stage.draw({ ParamAngleX: 0 }, 16);
      (window as any).rendererControls = { stage, settings, container, info };
    },
    {
      id: 'renderer-controls',
      path: '/managed/Haru.model3.json',
      name: 'Haru',
      entry: 'Haru.model3.json',
      files,
    },
  );
}

test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    const controls = (window as any).rendererControls;
    controls?.stage.destroy();
    controls?.container.remove();
  });
});

test('depth scales the avatar and attached props and matches passive output', async ({
  page,
}, testInfo) => {
  await loadControls(page);
  const result = await page.evaluate(async () => {
    const { stage, settings, container, info } = (window as any).rendererControls;
    const module = '/src/renderer.ts';
    const { AvatarStage } = await import(module);
    const state = '/src/state.ts';
    const { readSettings } = await import(state);
    const s = readSettings({
      ...settings,
      zoom: 0.7,
      composition: {
        items: [
          {
            id: 'attached',
            kind: 'live2d',
            source: info.path,
            x: 0.2,
            scale: 0.15,
            attach: 'model',
          },
          {
            id: 'fixed',
            kind: 'live2d',
            source: info.path,
            x: -0.3,
            scale: 0.15,
            attach: 'canvas',
          },
        ],
      },
    });
    await stage.compose(s, [info]);
    const outputContainer = container.cloneNode() as HTMLElement;
    outputContainer.style.left = '520px';
    document.body.append(outputContainer);
    const output = new AvatarStage(outputContainer, () => {}, true);
    try {
      await output.load(info);
      await output.compose(s, [info]);
      const sample = (depth: number) => {
        stage.draw({}, 16, {}, undefined, depth);
        const [attached, fixed] = stage.layers.visuals;
        return {
          scale: stage.content.children[0].scale.x,
          attachedScale: attached.node.scale.x,
          attachedOffset: attached.node.x - 250,
          fixedScale: fixed.node.scale.x,
          fixedX: fixed.node.x,
          image: stage.canvas.toDataURL(),
        };
      };
      const neutral = sample(1),
        near = sample(1.25),
        far = sample(0.8);
      sample(1.25);
      output.draw(stage.frame, 16, stage.parts, stage.sceneFrames, stage.depthScale);
      const pixels = (s: any) => Array.from(s.app.renderer.extract.pixels(s.app.stage));
      const a = pixels(stage),
        b = pixels(output);
      const parity = {
        different: a.filter((value, i) => value !== b[i]).length,
        lengths: [a.length, b.length],
        mainBounds: stage.content.getBounds().toString(),
        outputBounds: output.content.getBounds().toString(),
        mainParams: stage.frame,
        outputParams: output.frame,
        mainParts: stage.parts,
        outputParts: output.parts,
      };
      stage.display(s);
      const afterLayout = stage.content.children[0].scale.x;
      const images = [stage.canvas.toDataURL(), output.canvas.toDataURL()];
      stage.draw({}, 0, {}, undefined, NaN);
      return { neutral, near, far, parity, afterLayout, invalid: stage.depthScale, images };
    } finally {
      output.destroy();
      outputContainer.remove();
    }
  });
  for (const [frame, ratio] of [
    [result.near, 1.25],
    [result.far, 0.8],
  ] as const) {
    expect(frame.scale / result.neutral.scale).toBeCloseTo(ratio);
    expect(frame.attachedScale / result.neutral.attachedScale).toBeCloseTo(ratio);
    expect(frame.attachedOffset / result.neutral.attachedOffset).toBeCloseTo(ratio);
    expect(frame.fixedScale).toBe(result.neutral.fixedScale);
    expect(frame.fixedX).toBe(result.neutral.fixedX);
  }
  expect(result.afterLayout).toBe(result.near.scale);
  expect(result.invalid).toBe(1);
  for (const [name, data] of [
    ['neutral', result.neutral.image],
    ['near', result.near.image],
    ['far', result.far.image],
    ['preview', result.images[0]],
    ['output', result.images[1]],
  ]) {
    const path = testInfo.outputPath(`depth-${name}.png`);
    writeFileSync(path, Buffer.from(data.split(',')[1], 'base64'));
    await testInfo.attach(`depth-${name}`, { path, contentType: 'image/png' });
  }
  expect(result.parity.different, JSON.stringify(result.parity)).toBe(0);
});

test('CDI names and groups load while manual overrides take final priority and can be released', async ({
  page,
}) => {
  await loadControls(page);
  const result = await page.evaluate(() => {
    const { stage, settings } = (window as any).rendererControls;
    const parameter = stage.parameters.find((p: { id: string }) => p.id === 'ParamAngleX');
    stage.playMotion('Manual:0', 'loop');
    stage.setExpression('0', true, undefined, 0);
    settings.parameterOverrides = { ParamAngleX: -12 };
    stage.display(settings);
    stage.draw({ ParamAngleX: 5 }, 16);
    const overridden = stage.frame.ParamAngleX;
    delete settings.parameterOverrides.ParamAngleX;
    stage.draw({ ParamAngleX: 5 }, 16);
    const expression = stage.frame.ParamAngleX;
    stage.clearExpressions(0);
    stage.stopMotion();
    stage.draw({ ParamAngleX: 5 }, 16);
    return {
      parameter,
      overridden,
      expression,
      released: stage.frame.ParamAngleX,
      missing: stage.parameters.some((p: { id: string }) => p.id === 'Absent'),
    };
  });
  expect(result.parameter).toMatchObject({
    id: 'ParamAngleX',
    name: '头部左右',
    group: '身体 / 头部',
  });
  expect(result.missing).toBe(false);
  expect(result.overridden).toBeCloseTo(-12);
  expect(result.expression).toBeCloseTo(20);
  expect(result.released).toBeCloseTo(5);
});

test('expressions honor authored fades, reverse smoothly, mix blends and restore defaults immediately', async ({
  page,
}) => {
  await loadControls(page);
  const result = await page.evaluate(() => {
    const { stage } = (window as any).rendererControls;
    const tick = (count: number) => {
      for (let i = 0; i < count; i++) stage.draw({ ParamAngleX: 0 }, 50);
      return stage.frame.ParamAngleX;
    };
    stage.setExpression('0', true);
    const halfIn = tick(4);
    stage.setExpression('0', false);
    const reversed = tick(1);
    const halfOut = tick(5);
    const off = tick(7);
    stage.setExpression('0', true, undefined, 0);
    const instant = tick(1);
    stage.setExpression('1', true);
    const added = tick(1);
    stage.setExpression('2', true);
    const multiplied = tick(1);
    stage.restoreExpressions(['0', 'does-not-exist']);
    const restored = tick(1);
    const active = [...stage.activeExpressions];
    stage.clearExpressions(0);
    const cleared = tick(1);
    stage.setExpression('0', true, undefined, 0);
    tick(1);
    stage.setExpression('0', false, undefined, 5);
    const fading = tick(1);
    stage.clearExpressions(0);
    const fadingCleared = tick(1);

    stage.setExpression('0', true, undefined, 0);
    stage.setExpression('1', true);
    const beforeReopen = tick(1);
    stage.setExpression('0', false, undefined, 1);
    tick(1);
    stage.setExpression('0', true, undefined, 0);
    const reopened = tick(1);
    const savedOrder = [...stage.activeExpressions];
    stage.restoreExpressions(savedOrder);
    const savedRestored = tick(1);
    return {
      halfIn,
      reversed,
      halfOut,
      off,
      instant,
      added,
      multiplied,
      restored,
      active,
      cleared,
      fading,
      fadingCleared,
      beforeReopen,
      reopened,
      savedOrder,
      savedRestored,
    };
  });
  expect(result.halfIn).toBeCloseTo(10);
  expect(result.reversed).toBeLessThan(result.halfIn);
  expect(result.reversed).toBeGreaterThan(9);
  expect(result.halfOut).toBeCloseTo(5);
  expect(result.off).toBeCloseTo(0);
  expect(result.instant).toBeCloseTo(20);
  expect(result.added).toBeCloseTo(24);
  expect(result.multiplied).toBeCloseTo(12);
  expect(result.restored).toBeCloseTo(20);
  expect(result.active).toEqual(['0']);
  expect(result.cleared).toBeCloseTo(0);
  expect(result.fading).toBeGreaterThan(19);
  expect(result.fadingCleared).toBeCloseTo(0);
  expect(result.beforeReopen).toBeCloseTo(24);
  expect(result.reopened).toBeCloseTo(20);
  expect(result.savedOrder).toEqual(['1', '0']);
  expect(result.savedRestored).toBeCloseTo(result.reopened);
});

test('lost tracking switches idle curves and recovery leaves manual motions in control', async ({
  page,
}) => {
  await loadControls(page);
  const result = await page.evaluate(async () => {
    const { FaceMapper } = await import('/src/state.ts');
    const { stage, settings } = (window as any).rendererControls;
    settings.idleMotion = 'Idle:0';
    settings.lostIdleMotion = 'Lost:0';
    stage.display(settings);
    stage.draw({ ParamAngleX: 5 }, 16);
    const normal = { id: stage.currentMotion, angle: stage.frame.ParamAngleX };
    stage.trackingLost = true;
    const mapper = new FaceMapper();
    stage.draw(mapper.map(null, stage.parameters, settings, 0.016), 16);
    const lost = { id: stage.currentMotion, angle: stage.frame.ParamAngleX };
    stage.playMotion('Manual:0', 'loop');
    stage.draw({}, 16);
    const manual = stage.currentMotion;
    stage.trackingLost = false;
    stage.draw({ ParamAngleX: 5 }, 16);
    const recovering = { id: stage.currentMotion, angle: stage.frame.ParamAngleX };
    stage.stopMotion();
    stage.draw({ ParamAngleX: 5 }, 16);
    return { normal, lost, manual, recovering, resumed: stage.currentMotion };
  });
  expect(result.normal).toEqual({ id: 'Idle:0', angle: 5 });
  expect(result.lost).toEqual({ id: 'Lost:0', angle: 25 });
  expect(result.manual).toBe('Manual:0');
  expect(result.recovering).toEqual({ id: 'Manual:0', angle: 20 });
  expect(result.resumed).toBe('Idle:0');
});

test('motion sound starts and stops with playback and custom fade overrides authored instant curves', async ({
  page,
}) => {
  await loadControls(page);
  const result = await page.evaluate(async () => {
    const { stage, settings } = (window as any).rendererControls;
    const originalAudio = window.Audio;
    const audio: { src: string; loop: boolean; plays: number; pauses: number }[] = [];
    class MockAudio {
      loop = false;
      plays = 0;
      pauses = 0;
      constructor(public src: string) {
        audio.push(this);
      }
      play() {
        this.plays++;
        return Promise.resolve();
      }
      pause() {
        this.pauses++;
      }
    }
    window.Audio = MockAudio as any;
    try {
      settings.hotkeyOptions['motion:Manual:0'] = { scope: 'local', fadeSeconds: 0.4 };
      stage.display(settings);
      stage.playMotion('Manual:0', 'loop');
      const started = {
        count: audio.length,
        src: audio[0]?.src,
        plays: audio[0]?.plays,
        loop: audio[0]?.loop,
      };
      stage.draw({}, 16);
      for (let i = 0; i < 4; i++) stage.draw({}, 50);
      const half = stage.frame.ParamAngleX;
      for (let i = 0; i < 5; i++) stage.draw({}, 50);
      const full = stage.frame.ParamAngleX;
      stage.stopMotion();
      const stopped = { pauses: audio[0]?.pauses, src: audio[0]?.src };
      settings.hotkeyOptions['motion:Manual:0'].fadeSeconds = 0;
      stage.playMotion('Manual:0', 'once');
      stage.draw({}, 16);
      const instant = stage.frame.ParamAngleX;
      for (let i = 0; i < 85; i++) stage.draw({}, 50);
      const finished = { motion: stage.currentMotion, pauses: audio[1]?.pauses };
      stage.playMotion('Manual:0', 'loop');
      settings.motionSound = false;
      stage.display(settings);
      const muted = audio[2]?.pauses;
      stage.playMotion('Manual:0', 'loop');
      return { started, half, full, stopped, instant, finished, muted, audioCount: audio.length };
    } finally {
      stage.stopMotion();
      window.Audio = originalAudio;
    }
  });
  expect(result.started).toMatchObject({ count: 1, plays: 1, loop: true });
  expect(result.started.src).toMatch(/^blob:/);
  expect(result.half).toBeCloseTo(10);
  expect(result.full).toBeCloseTo(20);
  expect(result.stopped).toEqual({ pauses: 1, src: '' });
  expect(result.instant).toBeCloseTo(20);
  expect(result.finished).toEqual({ motion: '', pauses: 1 });
  expect(result.muted).toBe(1);
  expect(result.audioCount).toBe(3);
});
