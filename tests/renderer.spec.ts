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
    'eyes.exp3.json': {
      Type: 'Live2D Expression',
      Parameters: [
        { Id: 'ParamEyeLOpen', Value: 0, Blend: 'Overwrite' },
        { Id: 'ParamEyeROpen', Value: 0, Blend: 'Overwrite' },
      ],
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
    { Name: '闭眼', File: 'eyes.exp3.json' },
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

test('transparent OBS render includes the real Cubism avatar without changing its pose', async ({
  page,
}, testInfo) => {
  await loadControls(page);
  const result = await page.evaluate(() => {
    const { stage, settings } = (window as any).rendererControls;
    stage.draw({ ParamAngleX: 12 }, 16);
    const before = JSON.stringify(stage.frame);
    const canvas = stage.transparentCanvas();
    const bytes = canvas.getContext('2d')!.getImageData(0, 0, 1280, 720).data;
    let opaque = 0,
      partial = 0;
    for (let i = 3; i < bytes.length; i += 4) {
      if (bytes[i] === 255) opaque++;
      else if (bytes[i] > 0) partial++;
    }
    const unchanged = before === JSON.stringify(stage.frame);
    // The square stage is letterboxed to x 280..1000. Zoom the avatar past the stage edges:
    // the preview crops it there, so nothing may leak into the side bars.
    settings.zoom = 4;
    stage.display(settings);
    stage.draw({ ParamAngleX: 12 }, 16);
    const zoomed = stage.transparentCanvas();
    const pixels = zoomed.getContext('2d')!.getImageData(0, 0, 1280, 720).data;
    let bars = 0,
      edges = 0;
    for (let y = 0; y < 720; y++)
      for (let x = 0; x < 1280; x++) {
        const alpha = pixels[(y * 1280 + x) * 4 + 3];
        if (x < 280 || x >= 1000) bars += alpha;
        else if (x === 281 || x === 998) edges += alpha;
      }
    return { opaque, partial, border: bytes[3], unchanged, bars, edges, image: zoomed.toDataURL() };
  });
  writeFileSync(
    testInfo.outputPath('letterbox.png'),
    Buffer.from(result.image.split(',')[1], 'base64'),
  );
  expect(result.opaque).toBeGreaterThan(10000);
  expect(result.partial).toBeGreaterThan(100);
  expect(result.border).toBe(0);
  expect(result.unchanged).toBe(true);
  expect(result.edges).toBeGreaterThan(0);
  expect(result.bars).toBe(0);
});

test('virtual camera frames include the scene, fill the letterbox, mirror and keep the pose', async ({
  page,
}, testInfo) => {
  await loadControls(page);
  const result = await page.evaluate(async () => {
    const { stage, settings, info } = (window as any).rendererControls;
    const state = '/src/state.ts';
    const { readSettings } = await import(state);
    const { mockIPC } = await import('/node_modules/@tauri-apps/api/mocks.js');
    const asset = document.createElement('canvas');
    asset.width = asset.height = 64;
    const ctx = asset.getContext('2d')!;
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 0, 64, 64);
    const green = await new Promise<Blob>((resolve) => asset.toBlob((blob) => resolve(blob!)));
    mockIPC(async (cmd: string, args: { resource: string }) => {
      if (cmd === 'read_asset') return green.arrayBuffer();
      if (cmd === 'read_model_resource')
        return (await fetch('/renderer-controls/' + encodeURI(args.resource))).arrayBuffer();
    });
    const s = readSettings({
      ...settings,
      composition: { backgroundImage: '0123456789abcdef0123456789abcdef.png', items: [] },
    });
    await stage.compose(s, [info]);
    stage.draw({ ParamAngleX: 12 }, 16);
    const before = JSON.stringify(stage.frame);
    const at = (bytes: Uint8Array, x: number, y: number) =>
      Array.from(bytes.slice((y * 1280 + x) * 4, (y * 1280 + x) * 4 + 4));
    const frame = stage.cameraPixels(1280, 720, '#123456', false).slice();
    const mirrored = stage.cameraPixels(1280, 720, '#123456', true).slice();
    let opaque = true,
      flipped = 0,
      model = 0;
    for (let y = 0; y < 720; y++)
      for (let x = 0; x < 1280; x++) {
        const i = (y * 1280 + x) * 4,
          j = (y * 1280 + 1279 - x) * 4;
        opaque &&= frame[i + 3] === 255 && mirrored[i + 3] === 255;
        for (let k = 0; k < 3; k++)
          flipped = Math.max(flipped, Math.abs(frame[i + k] - mirrored[j + k]));
        // Inside the square letterbox, anything that is not the green scene is the avatar.
        if (x >= 280 && x < 1000 && (frame[i] > 8 || frame[i + 2] > 8)) model++;
      }
    // A translucent CSS color lands over black, exactly as the former 2D camera canvas filled it.
    const probe = document.createElement('canvas').getContext('2d', { alpha: false })!;
    probe.fillStyle = '#000000';
    probe.fillRect(0, 0, 1, 1);
    probe.fillStyle = 'rgba(255, 128, 0, 0.5)';
    probe.fillRect(0, 0, 1, 1);
    const translucent = at(stage.cameraPixels(1280, 720, 'rgba(255, 128, 0, 0.5)', false), 5, 5);
    const preview = document.createElement('canvas');
    preview.width = 1280;
    preview.height = 720;
    preview
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(frame), 1280, 720), 0, 0);
    return {
      bars: [at(frame, 5, 5), at(frame, 1275, 715)],
      scene: [at(frame, 290, 10), at(frame, 990, 710)],
      opaque,
      flipped,
      model,
      translucent,
      expectedTranslucent: Array.from(probe.getImageData(0, 0, 1, 1).data),
      unchanged: before === JSON.stringify(stage.frame),
      image: preview.toDataURL(),
    };
  });
  writeFileSync(
    testInfo.outputPath('camera.png'),
    Buffer.from(result.image.split(',')[1], 'base64'),
  );
  expect(result.bars).toEqual([
    [18, 52, 86, 255],
    [18, 52, 86, 255],
  ]);
  // Unlike the transparent OBS output, the camera keeps the scene background.
  expect(result.scene).toEqual([
    [0, 255, 0, 255],
    [0, 255, 0, 255],
  ]);
  expect(result.opaque).toBe(true);
  expect(result.flipped).toBe(0);
  expect(result.model).toBeGreaterThan(10000);
  expect(result.translucent).toEqual(result.expectedTranslucent);
  expect(result.unchanged).toBe(true);
});

test('virtual camera skips frames while the stage has no size or the GPU context is lost', async ({
  page,
}) => {
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const renderer = '/src/renderer.ts';
    const { AvatarStage } = await import(renderer);
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;inset:0;width:320px;height:180px';
    document.body.append(container);
    const stage = new AvatarStage(container, () => {});
    try {
      const ready = stage.cameraPixels(1280, 720, '#000000', false)?.length;
      stage.app.renderer.resize(0, 0);
      const empty = stage.cameraPixels(1280, 720, '#000000', false);
      stage.app.renderer.resize(320, 180);
      stage.app.renderer.gl.getExtension('WEBGL_lose_context').loseContext();
      const lost = stage.cameraPixels(1280, 720, '#000000', false);
      let obs = '';
      try {
        stage.transparentPixels(1920, 1080);
      } catch (error) {
        obs = String(error);
      }
      return { ready, empty: empty === undefined, lost: lost === undefined, obs };
    } finally {
      stage.destroy();
      container.remove();
    }
  });
  expect(result).toEqual({
    ready: 1280 * 720 * 4,
    empty: true,
    lost: true,
    obs: 'Error: 显卡上下文已丢失',
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

test('Live2D prop opacity fades the prop', async ({ page }) => {
  await loadControls(page);
  const [opaque, half, hidden] = await page.evaluate(async () => {
    const { stage, settings, info } = (window as any).rendererControls;
    const state = '/src/state.ts';
    const { readSettings } = await import(state);
    const alpha = async (opacity: number) => {
      const s = readSettings({
        ...settings,
        modelVisible: false,
        composition: {
          items: [{ id: 'prop', kind: 'live2d', source: info.path, scale: 0.5, opacity }],
        },
      });
      await stage.compose(s, [info]);
      stage.draw({}, 16, {});
      const pixels = stage.app.renderer.extract.pixels(stage.app.stage);
      let sum = 0,
        max = 0;
      for (let i = 3; i < pixels.length; i += 4) {
        sum += pixels[i];
        max = Math.max(max, pixels[i]);
      }
      return { sum, max };
    };
    return [await alpha(1), await alpha(0.5), await alpha(0)];
  });
  expect(opaque.max).toBe(255);
  expect(half.sum / opaque.sum).toBeGreaterThan(0.4);
  expect(half.sum / opaque.sum).toBeLessThan(0.6);
  // The prop fades as one image: overlapping meshes must not show through each other.
  expect(half.max).toBeLessThanOrEqual(130);
  expect(hidden.sum).toBe(0);
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

test('a scripted session produces the same parameter and part snapshots as the original renderer', async ({
  page,
}) => {
  await loadControls(page);
  const digests = await page.evaluate(async () => {
    const { stage, settings, container, info } = (window as any).rendererControls;
    const renderer = '/src/renderer.ts';
    const { AvatarStage } = await import(renderer);
    // Small canvases keep the software-rendered frames quick.
    container.style.width = container.style.height = '120px';
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Seeded blinks and a zeroed model clock make every value reproducible.
    const random = Math.random;
    let seed = 7;
    Math.random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    stage.model.elapsedTime = 0;
    Object.assign(settings, {
      autoBlink: true,
      motionSound: false,
      physicsStrength: 1,
      defaultHeldParameters: { ParamAngleZ: 12, ParamBodyAngleX: 5 },
      defaultExpressions: [],
    });
    stage.display(settings);
    stage.restoreDefaultAppearance(settings);
    // Tracking leaves breath and eye parameters to the other sources, but competes with the held
    // ParamAngleZ, which must win.
    const skip = [
      'ParamAngleX',
      'ParamAngleY',
      'ParamBodyAngleX',
      'ParamBreath',
      'ParamEyeLOpen',
      'ParamEyeROpen',
    ];
    const tracked = stage.parameters
      .map((p: { id: string }) => p.id)
      .filter((id: string) => !skip.includes(id))
      .slice(0, 14);
    const sum = (record: Record<string, number>) =>
      Object.values(record).reduce((total, value) => total + value, 0);
    const values: Record<string, number> = {};
    const digests: unknown[][] = [];
    const frames: [Record<string, number>, Record<string, number>][] = [];
    try {
      for (let i = 0; i < 200; i++) {
        tracked.forEach((id: string, k: number) => (values[id] = Math.sin(i / (4 + k))));
        if (i === 5) stage.setExpression('0', true);
        // Fades out and drops its layer, so ParamAngleX breathes again.
        if (i === 25) stage.setExpression('0', false);
        // Closed eyes keep blinks away until the expression is dropped.
        if (i === 45) stage.setExpression('3', true, undefined, 0);
        if (i === 70) stage.setExpression('3', false, undefined, 0);
        // Replaces the held appearance and holds ParamAngleX once the 4 s motion ends.
        if (i === 75) stage.toggleHeldMotion('Manual:0');
        if (i === 100) Object.assign(settings, { physicsStrength: 1.6, physicsWind: 0.7 });
        if (i === 130) Object.assign(settings, { physicsStrength: 1, physicsWind: 0 });
        if (i === 165) {
          stage.stopMotion();
          Object.assign(settings, { idleMotion: 'Idle:0', lostIdleMotion: 'Lost:0' });
        }
        if (i === 175) stage.trackingLost = true;
        if (i === 185) stage.trackingLost = false;
        if (i === 188) settings.parameterOverrides = { ParamAngleY: 99 };
        if (i === 192) settings.parameterOverrides = {};
        if (i === 195) stage.restoreExpressions(['2', '1']);
        stage.display(settings);
        stage.draw(values, 50);
        frames.push([stage.frame, stage.parts]);
        const { ParamAngleX, ParamAngleZ, ParamBodyAngleX, ParamEyeLOpen } = stage.frame;
        if (i % 20 === 19)
          digests.push([
            sum(stage.frame),
            ParamAngleX,
            ParamAngleZ,
            ParamBodyAngleX,
            ParamEyeLOpen,
            sum(stage.parts),
            stage.currentMotion,
            [...stage.activeExpressions].join(),
          ]);
      }
    } finally {
      Math.random = random;
    }
    // Replay into an output-window stage afterwards: Cubism rebuilds its shared shaders whenever
    // the WebGL context changes, which would make alternating stages slow here.
    const outputContainer = container.cloneNode() as HTMLElement;
    document.body.append(outputContainer);
    const output = new AvatarStage(outputContainer, () => {}, true);
    try {
      await output.load(info);
      output.display(settings);
      frames.forEach(([frame, parts], i) => {
        output.draw(frame, 16, parts);
        if (i % 20 === 19) digests[(i - 19) / 20].push(sum(output.frame), sum(output.parts));
      });
    } finally {
      output.destroy();
      outputContainer.remove();
    }
    return digests;
  });
  // Recorded from the renderer before its per-frame hooks and snapshots were optimized:
  // [Σ parameters, ParamAngleX, ParamAngleZ, ParamBodyAngleX, ParamEyeLOpen, Σ part opacities,
  // motion, expressions, then both sums as seen by the output window].
  type Digest = [number, number, number, number, number, number, string, string, number, number];
  const original: Digest[] = [
    [53.032162, 20, 12, 5, 1, 17, '', '0', 53.032162, 17],
    [27.197808, 6.998763, 12, 5, 1, 17, '', '', 27.197808, 17],
    [14.096019, 1.794347, 12, 5, 0, 17, '', '3', 14.096019, 17],
    [28.246197, 20, 0.783603, 1.997134, 1, 17, 'Manual:0', '', 28.246197, 17],
    [29.508127, 20, -0.373465, 1.793872, 1, 17, 'Manual:0', '', 29.508127, 17],
    [20.656095, 20, -0.995479, 1.301124, 1, 17, 'Manual:0', '', 20.656095, 17],
    [24.74961, 20, -0.191294, 0.598407, 1, 17, 'Manual:0', '', 24.74961, 17],
    [27.779094, 20, 0.886953, -0.200877, 1, 17, '', '', 27.779094, 17],
    [27.104373, 25, 0.694484, -0.967745, 1, 17, 'Lost:0', '', 27.104373, 17],
    [8.874187, 9, -0.492955, -1.578444, 1, 17, 'Idle:0', '2,1', 8.874187, 17],
  ];
  expect(digests.length).toBe(original.length);
  digests.forEach((digest, index) => {
    const actual = digest as Digest;
    const expected = original[index];
    for (const k of [0, 1, 2, 3, 4, 5, 8, 9])
      expect(actual[k], `value ${k} at checkpoint ${index}`).toBeCloseTo(expected[k] as number, 4);
    expect(actual.slice(6, 8), `motion and expressions at checkpoint ${index}`).toEqual(
      expected.slice(6, 8),
    );
  });
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
