import { test, expect, type Page } from '@playwright/test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

// Exercise the shipped bundle under the desktop CSP; Vite's React refresh preamble is dev-only.
async function serveProduction(page: Page, entry: string) {
  const csp = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).app.security.csp;
  await page.route('**/assets/*', (route) =>
    route.fulfill({
      path: resolve('dist/assets', basename(new URL(route.request().url()).pathname)),
    }),
  );
  await page.route(entry, (route) =>
    route.fulfill({
      body: readFileSync('dist/index.html', 'utf8'),
      contentType: 'text/html',
      headers: { 'content-security-policy': csp },
    }),
  );
}

// Pause has no button; bind it to a local hotkey, return to the capture tab, and return a press helper.
async function bindPauseHotkey(page: Page) {
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await page.getByRole('button', { name: '应用快捷键', exact: true }).click();
  await page.locator('#hotkey-action').selectOption('pause-tracking');
  await page.locator('#hotkey-binding').fill('Control+Shift+P');
  await page.locator('#save-hotkey').click();
  await page.getByRole('button', { name: '面捕', exact: true }).click();
  return () => page.keyboard.press('Control+Shift+P');
}

test('bundled Haru, Hiyori and Mao render previews and can be selected from the empty stage', async ({
  page,
}, testInfo) => {
  const resources = new Map<string, string>();
  const models = ['Haru', 'Hiyori', 'Mao'].map((name) => {
    const root = resolve('vendor/models', name);
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const path = resolve(entry.parentPath, entry.name);
        const resource = path.slice(root.length + 1).replaceAll('\\', '/');
        resources.set(`${name}/${resource}`, path);
        return resource;
      });
    return {
      id: name,
      name,
      path: `${root}/${name}.model3.json`,
      entry: `${name}.model3.json`,
      files,
    };
  });
  await page.route('**/builtin-fixture/**', (route) => {
    const resource = decodeURIComponent(
      new URL(route.request().url()).pathname.slice('/builtin-fixture/'.length),
    );
    const path = resources.get(resource);
    return path ? route.fulfill({ path }) : route.abort();
  });
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main');
      const models = ${JSON.stringify(models)};
      const imported = { ...models[2], name: 'Imported Mao', path: '/managed/models/imported/Mao.model3.json' };
      const previews = {};
      mockIPC(async (cmd, args) => {
        if (cmd === 'load_settings') return JSON.parse(localStorage.getItem('test-settings') ?? 'null');
        if (cmd === 'save_settings') { localStorage.setItem('test-settings', JSON.stringify(args.settings)); return; }
        if (cmd === 'read_model_vts_config') return null;
        if (cmd === 'list_models') return { models: localStorage.getItem('test-imported') ? [imported, ...models] : models, directory: '/managed/models', errors: [] };
        if (cmd === 'load_model') {
          if (args.path === '/dropped/Mao.zip') { localStorage.setItem('test-imported', 'true'); return imported; }
          return [imported, ...models].find((model) => model.path === args.path);
        }
        if (cmd === 'read_model_preview') return new Uint8Array(previews[args.id] ?? []).buffer;
        if (cmd === 'save_model_preview') { previews[args.id] = args.png; return; }
        if (cmd === 'read_model_resource') return (await fetch('/builtin-fixture/' + args.id + '/' + encodeURI(args.resource))).arrayBuffer();
      }, { shouldMockEvents: true });\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '选择内置或已有角色', exact: true }).click();
  await expect(page.locator('.model-card img')).toHaveCount(3);
  for (const model of models) {
    await page.getByRole('button', { name: `切换到 ${model.name}`, exact: true }).click();
    await expect(page.locator('#model-name')).toHaveText(model.name);
    await expect(page.locator('#notice')).not.toHaveClass(/error/);
    await expect(page.locator('.model-card-name')).toHaveText(['Haru', 'Hiyori', 'Mao']);
    await page.screenshot({ path: testInfo.outputPath(`builtin-${model.name}.png`) });
  }
  await page.evaluate(async () => {
    const { emit } = await import('/node_modules/@tauri-apps/api/event.js');
    await emit('tauri://drag-drop', { paths: ['/dropped/Mao.zip'], position: { x: 300, y: 300 } });
  });
  await expect(page.locator('#notice')).toContainText('已加入 1 个角色');
  const order = ['Imported Mao', 'Haru', 'Hiyori', 'Mao'];
  await expect(page.locator('.model-card-name')).toHaveText(order);
  await page.getByRole('button', { name: '切换到 Haru', exact: true }).click();
  await expect(page.locator('#model-name')).toHaveText('Haru');
  await expect(page.locator('.model-card-name')).toHaveText(order);
  await page.reload();
  await expect(page.locator('#model-name')).toHaveText('Haru');
  await page.getByRole('button', { name: '角色库', exact: true }).click();
  await expect(page.locator('.model-card-name')).toHaveText(order);
});

test('official Cubism Core renders a supplied model and applies head, body, eye, and mouth parameters', async ({
  page,
}, testInfo) => {
  const fixture = process.env.VTUBELEAF_MODEL_FIXTURE;
  test.skip(!fixture, 'Set VTUBELEAF_MODEL_FIXTURE to a licensed local model3.json.');
  const modelPath = resolve(fixture!),
    root = dirname(modelPath);
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      resolve(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .replaceAll('\\', '/'),
    );
  await page.route('**/test-model/**', (route) => {
    const resource = decodeURIComponent(
      new URL(route.request().url()).pathname.slice('/test-model/'.length),
    );
    return files.includes(resource)
      ? route.fulfill({ path: resolve(root, resource) })
      : route.abort();
  });
  await serveProduction(page, '**/?output=1');
  await page.goto('/?output=1');
  const parameters = await page.evaluate(
    async (info) => {
      const mocks = '/node_modules/@tauri-apps/api/mocks.js',
        renderer = '/src/renderer.ts',
        state = '/src/state.ts';
      const { mockIPC } = await import(mocks),
        { AvatarStage } = await import(renderer),
        { defaults } = await import(state);
      mockIPC(async (cmd: string, args: { resource: string }) => {
        if (cmd === 'read_model_resource')
          return (await fetch(`/test-model/${encodeURI(args.resource)}`)).arrayBuffer();
      });
      const container = document.createElement('div');
      container.id = 'model-test';
      container.style.cssText = 'position:fixed;inset:0;width:800px;height:800px;z-index:10';
      document.body.append(container);
      const stage = ((window as any).modelStage = new AvatarStage(container, () => {
        throw new Error('WebGL context lost');
      }));
      stage.display({ ...defaults, background: '#00ff00' });
      (window as any).modelInfo = info;
      await stage.load(info);
      stage.draw({}, 16);
      if (!stage.expressions?.length || !stage.motions?.length)
        throw new Error('model expression and motion controls missing');
      return stage.parameters.map((parameter: { id: string }) => parameter.id);
    },
    { id: 'test-model', path: modelPath, name: basename(root), entry: basename(modelPath), files },
  );
  expect(parameters).toEqual(
    expect.arrayContaining([
      'ParamAngleX',
      'ParamBodyAngleX',
      'ParamEyeLOpen',
      'ParamEyeROpen',
      'ParamMouthOpenY',
    ]),
  );
  const importedActions = await page.evaluate(async () => {
    const stage = (window as any).modelStage;
    const id = stage.expressions[0].id;
    stage.setExpression(id, true, 0.01);
    const activated = stage.activeExpressions.has(id);
    await new Promise((resolve) => setTimeout(resolve, 30));
    stage.draw({}, 16);
    const expired = !stage.activeExpressions.has(id);
    stage.setExpression(id, true);
    stage.setExpression(id, false);
    const released = !stage.activeExpressions.has(id);
    const motion = stage.motions[0].id;
    stage.toggleHeldMotion(motion);
    const holding = stage.playing?.mode === 'hold';
    stage.toggleHeldMotion(motion);
    const stopped = !stage.playing && Object.keys(stage.held).length === 0;
    stage.toggleHeldMotion(motion);
    await stage.load((window as any).modelInfo);
    stage.toggleHeldMotion(motion);
    const reloaded = stage.playing?.mode === 'hold';
    stage.stopMotion();
    stage.draw({}, 16);
    return { activated, expired, released, holding, stopped, reloaded };
  });
  expect(importedActions).toEqual({
    activated: true,
    expired: true,
    released: true,
    holding: true,
    stopped: true,
    reloaded: true,
  });
  const neutral = await page
    .locator('#model-test canvas')
    .screenshot({ path: testInfo.outputPath('model-neutral.png') });
  const values = await page.evaluate(() => {
    const stage = (window as any).modelStage;
    const target = {
      ParamAngleX: 25,
      ParamBodyAngleX: -8,
      ParamEyeLOpen: 0,
      ParamEyeROpen: 0,
      ParamMouthOpenY: 1,
    };
    for (let frame = 0; frame < 20; frame++) stage.draw(target, 16);
    const core = stage.model.internalModel.coreModel;
    return Object.fromEntries(
      Object.keys(target).map((id) => [id, core.getParameterValueById(id)]),
    );
  });
  expect(values).toEqual({
    ParamAngleX: 25,
    ParamBodyAngleX: -8,
    ParamEyeLOpen: 0,
    ParamEyeROpen: 0,
    ParamMouthOpenY: 1,
  });
  const tracked = await page
    .locator('#model-test canvas')
    .screenshot({ path: testInfo.outputPath('model-tracked.png') });
  expect(tracked.equals(neutral)).toBe(false);
  const mapped = await page.evaluate(async () => {
    const { readSettings, FaceMapper, fromMediaPipe } = await import('/src/state.ts');
    const stage = (window as any).modelStage;
    const settings = readSettings({
      motionMirror: false,
      eyeClosedThreshold: 0.25,
      idleMotion: 'Idle:0',
      neutral: {
        yaw: 0,
        pitch: 0,
        roll: 0,
        eyeLeft: 0.8,
        eyeRight: 0.8,
        mouthOpen: 0,
        mouthSmile: 0,
      },
    });
    stage.display(settings);
    const face = fromMediaPipe(
      [
        { categoryName: 'eyeBlinkLeft', score: 0.85 },
        { categoryName: 'eyeBlinkRight', score: 0.85 },
      ],
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    );
    const mapper = new FaceMapper();
    for (let frame = 0; frame < 90; frame++)
      stage.draw(
        mapper.map(
          { ...face, bodyYaw: -15, armLeft: 1, armRight: 0 },
          stage.parameters,
          settings,
          1 / 30,
        ),
        1000 / 30,
      );
    return { ...stage.frame };
  });
  expect(mapped.ParamEyeLOpen).toBeLessThan(0.001);
  expect(mapped.ParamEyeROpen).toBeLessThan(0.001);
  expect(mapped.ParamBodyAngleX).toBeLessThan(-1);
  expect(mapped.ParamArmLA).toBeCloseTo(1, 2);
  expect(mapped.ParamArmRA).toBeCloseTo(0, 2);
  await page
    .locator('#model-test canvas')
    .screenshot({ path: testInfo.outputPath('model-mapped-blink-arms.png') });
  const physics = await page.evaluate(async () => {
    const stage = (window as any).modelStage;
    const info = (window as any).modelInfo;
    const { readSettings } = await import('/src/state.ts');
    const model = await (await fetch(`/test-model/${encodeURI(info.entry)}`)).json();
    const data = await (
      await fetch(`/test-model/${encodeURI(model.FileReferences.Physics)}`)
    ).json();
    const ids = [
      ...new Set(
        data.PhysicsSettings.flatMap((group: any) =>
          group.Output.map((o: any) => o.Destination.Id),
        ),
      ),
    ] as string[];
    const run = async (
      strength: number,
      groups: Record<string, number> = {},
      fps = 60,
      frameMs = 1000 / 30,
    ) => {
      await stage.load(info);
      stage.display(
        readSettings({
          physicsStrength: strength,
          physicsWind: 0.4,
          physicsFps: fps,
          physicsGroups: groups,
        }),
      );
      for (let i = 0; i < 90; i++)
        stage.draw(
          { ParamAngleX: Math.sin(i / 9) * 25, ParamAngleZ: Math.cos(i / 13) * 12 },
          frameMs,
        );
      return ids.map((id) => stage.frame[id]);
    };
    const groups = stage.physicsGroups.map((group: any) => group.id);
    const disabled = await run(0);
    const enabled = await run(1);
    const amplified = await run(2);
    const mutedGroups = await run(1, Object.fromEntries(groups.map((id: string) => [id, 0])));
    await run(1, {}, 30, 1000 / 60);
    const particles = () => JSON.stringify(stage.model.internalModel.physics._physicsRig.particles);
    const beforeInterstitial = particles();
    let afterInterstitial = '';
    let afterStep = '';
    const slowFrames: number[][] = [];
    for (let i = 0; i < 6; i++) {
      stage.draw({ ParamAngleX: 20, ParamAngleZ: 10 }, 1000 / 60);
      slowFrames.push(ids.map((id) => stage.frame[id]));
      if (i === 0) afterInterstitial = particles();
      if (i === 1) afterStep = particles();
    }
    const { mockIPC } = await import('/node_modules/@tauri-apps/api/mocks.js');
    mockIPC(async (cmd: string, args: { id: string; resource: string }) => {
      if (cmd !== 'read_model_resource') return;
      if (args.id === 'no-physics' && args.resource === info.entry) {
        const withoutPhysics = structuredClone(model);
        delete withoutPhysics.FileReferences.Physics;
        return new TextEncoder().encode(JSON.stringify(withoutPhysics)).buffer;
      }
      return (await fetch(`/test-model/${encodeURI(args.resource)}`)).arrayBuffer();
    });
    stage.draw({ ParamAngleX: -20 }, 1000 / 60);
    const previousModel = stage.model;
    const previousEvaluator = previousModel.internalModel.physics.evaluate;
    await stage.load({ ...info, id: 'no-physics' });
    const cleared =
      stage.physicsGroups.length === 0 &&
      !stage.model.internalModel.physics &&
      !previousModel.internalModel.coreModel;
    stage.draw({ ParamAngleX: 20 }, 1000 / 60);
    await stage.load(info);
    const freshParticles = particles();
    stage.draw({ ParamAngleX: 20 }, 1000 / 60);
    const freshState =
      stage.model.internalModel.physics.evaluate !== previousEvaluator &&
      particles() === freshParticles;
    return {
      groups,
      disabled,
      enabled,
      amplified,
      mutedGroups,
      slowFrames,
      interstitialStable: afterInterstitial === beforeInterstitial,
      stepAdvanced: afterStep !== beforeInterstitial,
      cleared,
      freshState,
      reloaded: stage.physicsGroups.map((group: any) => group.id),
    };
  });
  expect(physics.groups.length).toBeGreaterThan(0);
  expect(physics.reloaded).toEqual(physics.groups);
  expect(physics.interstitialStable).toBe(true);
  expect(physics.stepAdvanced).toBe(true);
  expect(physics.cleared).toBe(true);
  expect(physics.freshState).toBe(true);
  expect(physics.enabled.every(Number.isFinite)).toBe(true);
  expect(physics.enabled.some((value, i) => Math.abs(value - physics.disabled[i]) > 0.001)).toBe(
    true,
  );
  expect(physics.mutedGroups).toEqual(physics.disabled);
  expect(physics.amplified.some((value, i) => Math.abs(value - physics.enabled[i]) > 0.001)).toBe(
    true,
  );
  expect(
    physics.slowFrames.every((frame) =>
      frame.some((value, i) => Math.abs(value - physics.disabled[i]) > 0.001),
    ),
  ).toBe(true);
  const controls = await page.evaluate(async () => {
    const stage = (window as any).modelStage;
    const { defaults } = await import('/src/state.ts');
    const { AvatarStage } = await import('/src/renderer.ts');
    stage.display({ ...defaults, background: '#00ff00' });
    const tick = (n = 60) => {
      for (let i = 0; i < n; i++) stage.draw({ ParamAngleX: 5, ParamMouthOpenY: 0 }, 16);
    };
    stage.expressions.push(
      {
        id: 'test-a',
        name: 'a',
        data: { Parameters: [{ Id: 'ParamAngleX', Value: 12, Blend: 'Overwrite' }] },
      },
      {
        id: 'test-b',
        name: 'b',
        data: { Parameters: [{ Id: 'ParamMouthOpenY', Value: 0.7, Blend: 'Overwrite' }] },
      },
    );
    stage.toggleExpression('test-a');
    stage.toggleExpression('test-b');
    tick();
    const mixed = { angle: stage.frame.ParamAngleX, mouth: stage.frame.ParamMouthOpenY };
    stage.toggleExpression('test-a');
    tick();
    const toggled = { angle: stage.frame.ParamAngleX, mouth: stage.frame.ParamMouthOpenY };
    stage.clearExpressions();
    tick();
    stage.motions.push({
      id: 'test',
      group: 'test',
      name: 'test',
      data: {
        Version: 3,
        Meta: {
          Duration: 0.2,
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
            Segments: [0, 25, 0, 0.2, 25],
          },
        ],
        UserData: [],
      },
    });
    stage.playMotion('test', 'once');
    tick();
    const once = stage.frame.ParamAngleX;
    stage.playMotion('test', 'loop');
    tick();
    const loop = stage.frame.ParamAngleX;
    stage.playMotion('test', 'hold');
    tick();
    const hold = stage.frame.ParamAngleX;
    const heldFrame = { ...stage.frame },
      heldParts = { ...stage.parts };
    stage.stopMotion();
    tick();
    const stopped = stage.frame.ParamAngleX;
    stage.display({ ...defaults, autoBlink: true, background: '#00ff00' });
    stage.expressions.push({
      id: 'test-eye',
      name: 'eye',
      data: { Parameters: [{ Id: 'ParamEyeLOpen', Value: 0, Blend: 'Overwrite' }] },
    });
    stage.toggleExpression('test-eye');
    tick();
    const expressionEye = stage.frame.ParamEyeLOpen;
    stage.clearExpressions();
    tick();
    const eyeMotion = structuredClone(
      stage.motions.find((motion: { id: string }) => motion.id === 'test'),
    );
    eyeMotion.id = 'test-eye';
    eyeMotion.data.Curves[0].Id = 'ParamEyeLOpen';
    eyeMotion.data.Curves[0].Segments = [0, 0, 0, 0.2, 0];
    stage.motions.push(eyeMotion);
    stage.playMotion('test-eye', 'hold');
    tick();
    const heldEye = stage.frame.ParamEyeLOpen;
    stage.stopMotion();
    const output = document.createElement('div');
    output.id = 'passive-test';
    output.style.cssText = 'position:fixed;inset:0;width:800px;height:800px;z-index:20';
    document.body.append(output);
    const passive = ((window as any).passiveStage = new AvatarStage(output, () => {}, true));
    passive.display({ ...defaults, background: '#00ff00' });
    await passive.load((window as any).modelInfo);
    passive.draw(heldFrame, 16, heldParts);
    const synchronized =
      JSON.stringify(passive.frame) === JSON.stringify(heldFrame) &&
      JSON.stringify(passive.parts) === JSON.stringify(heldParts);
    return {
      mixed,
      toggled,
      once,
      loop,
      hold,
      stopped,
      expressionEye,
      heldEye,
      synchronized,
      finite: Object.values(heldFrame).every(Number.isFinite),
      parts: Object.keys(heldParts).length,
    };
  });
  expect(controls.mixed.angle).toBeCloseTo(12, 3);
  expect(controls.mixed.mouth).toBeCloseTo(0.7, 3);
  expect(controls.toggled.angle).toBeCloseTo(5, 3);
  expect(controls.toggled.mouth).toBeCloseTo(0.7, 3);
  expect(controls.once).toBeCloseTo(5, 3);
  expect(controls.loop).toBeCloseTo(25, 3);
  expect(controls.hold).toBeCloseTo(25, 3);
  expect(controls.stopped).toBeCloseTo(5, 3);
  expect(controls.expressionEye).toBeCloseTo(0, 3);
  expect(controls.heldEye).toBeCloseTo(0, 3);
  expect(controls.synchronized).toBe(true);
  await page
    .locator('#passive-test canvas')
    .screenshot({ path: testInfo.outputPath('model-output-motion.png') });
  await page.evaluate(() => (window as any).passiveStage.destroy());
  expect(controls.finite).toBe(true);
  expect(controls.parts).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).modelStage.destroy());
  await expect(page.locator('#model-test canvas')).toHaveCount(0);
});

test('alternate model renders with missing standard parameters and accepts a custom mapping', async ({
  page,
}, testInfo) => {
  const fixture = process.env.VTUBELEAF_ALT_MODEL_FIXTURE;
  test.skip(!fixture, 'Set VTUBELEAF_ALT_MODEL_FIXTURE to the SDK Wanko model3.json.');
  const modelPath = resolve(fixture!),
    root = dirname(modelPath);
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      resolve(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .replaceAll('\\', '/'),
    );
  await page.route('**/test-model/**', (route) => {
    const resource = decodeURIComponent(
      new URL(route.request().url()).pathname.slice('/test-model/'.length),
    );
    return files.includes(resource)
      ? route.fulfill({ path: resolve(root, resource) })
      : route.abort();
  });
  await page.goto('/?output=1');
  const result = await page.evaluate(
    async (info) => {
      const { mockIPC } = await import('/node_modules/@tauri-apps/api/mocks.js');
      const { AvatarStage } = await import('/src/renderer.ts');
      const { defaults, FaceMapper, NEUTRAL } = await import('/src/state.ts');
      mockIPC(async (cmd: string, args: { resource: string }) => {
        if (cmd === 'read_model_resource')
          return (await fetch(`/test-model/${encodeURI(args.resource)}`)).arrayBuffer();
      });
      const container = document.createElement('div');
      container.id = 'alternate-model';
      container.style.cssText = 'position:fixed;inset:0;width:800px;height:800px;z-index:10';
      document.body.append(container);
      const stage = ((window as any).alternateStage = new AvatarStage(container, () => {
        throw new Error('WebGL context lost');
      }));
      stage.display({ ...defaults, autoBlink: true, background: '#00ff00' });
      await stage.load(info);
      const mapper = new FaceMapper(),
        face = { ...NEUTRAL, yaw: 30 };
      const automatic = mapper.map(face, stage.parameters, defaults, 0.1);
      const parameter = stage.parameters.find((p: { id: string }) => p.id === 'PARAM_ANGLE_X');
      if (!parameter) throw new Error('Wanko head parameter missing');
      const settings = {
        ...defaults,
        motionMirror: false,
        mappings: {
          [parameter.id]: {
            source: 'yaw',
            inputMin: -1,
            inputMax: 1,
            outputMin: parameter.min,
            outputMax: parameter.max,
            smoothing: 0,
            enabled: true,
          },
        },
      };
      for (let i = 0; i < 60; i++)
        stage.draw(mapper.map(face, stage.parameters, settings, 0.016), 16);
      const custom = stage.frame[parameter.id];
      stage.playMotion(stage.motions[0].id, 'loop');
      for (let i = 0; i < 60; i++) stage.draw({}, 16);
      stage.stopMotion();
      stage.draw({}, 16);
      return {
        standard: stage.parameters.some((p: { id: string }) => p.id === 'ParamAngleX'),
        automatic,
        custom,
        max: parameter.max,
        expressions: stage.expressions.length,
        finite: Object.values(stage.frame).every(Number.isFinite),
      };
    },
    { id: 'alternate', path: modelPath, name: basename(root), entry: basename(modelPath), files },
  );
  expect(result.standard).toBe(false);
  expect(result.automatic).toEqual({});
  expect(result.custom).toBeCloseTo(result.max, 3);
  expect(result.expressions).toBe(0);
  expect(result.finite).toBe(true);
  await page
    .locator('#alternate-model canvas')
    .screenshot({ path: testInfo.outputPath('model-wanko.png') });
  await page.evaluate(() => (window as any).alternateStage.destroy());
});

test('studio panels reopen with the keyboard and fit the minimum desktop window', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#stage canvas')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('studio-empty.png') });
  const { minWidth: width, minHeight: height } = JSON.parse(
    readFileSync('src-tauri/tauri.conf.json', 'utf8'),
  ).app.windows[0];
  await page.setViewportSize({ width, height });
  const expanded = { x: 0, y: 0, width, height };
  await expect.poll(() => page.locator('#stage').boundingBox()).toEqual(expanded);
  await page.getByRole('button', { name: '收起设置面板' }).click();
  await expect(page.locator('#controls')).toBeHidden();
  const capture = page.getByRole('button', { name: '面捕', exact: true });
  await expect(capture).toBeFocused();
  await expect(capture).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => page.locator('#stage').boundingBox()).toEqual(expanded);
  await page.keyboard.press('Enter');
  await expect(page.locator('#capture')).toBeVisible();
  await expect(capture).toHaveAttribute('aria-pressed', 'true');
  for (const [name, title] of [
    ['角色', '角色控制'],
    ['画面', '画面设置'],
    ['接入', '会议接入'],
    ['面捕', '面部捕捉'],
  ]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('#panel-title')).toHaveText(title);
    await expect(page.locator('.panel:visible')).toHaveCount(1);
  }
  for (const selector of ['#stage', '#controls', '.session-bar', '#start', '#notice']) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  await page.screenshot({ path: testInfo.outputPath('studio-compact.png') });
});

test('live mode hides every overlay without replacing the full-window stage', async ({ page }) => {
  await serveProduction(page, '**/');
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  const canvas = await page.locator('#stage canvas').elementHandle();
  const fullWindow = { x: 0, y: 0, width: 1200, height: 800 };
  await expect.poll(() => page.locator('#stage canvas').boundingBox()).toEqual(fullWindow);
  await page.getByRole('button', { name: '画面', exact: true }).click();
  await page.getByRole('button', { name: '色键绿', exact: true }).click();
  await page.locator('#live-mode').click();
  await expect(page.locator('body')).toHaveText('', { useInnerText: true });
  await expect(
    page.locator('button:visible,input:visible,select:visible,video:visible'),
  ).toHaveCount(0);
  await expect(page.locator('#stage')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('.studio-overlay :focus')).toHaveCount(0);
  await expect.poll(() => page.locator('#stage canvas').boundingBox()).toEqual(fullWindow);
  expect(await canvas!.evaluate((node) => node === document.querySelector('#stage canvas'))).toBe(
    true,
  );
  await expect(page.locator('#stage')).toHaveCSS('background-color', 'rgb(0, 255, 0)');
  await page.keyboard.press('Escape');
  await expect(page.locator('#live-mode')).toBeFocused();
  await expect(page.locator('#appearance')).toBeVisible();
  await page.getByRole('button', { name: '收起设置面板' }).click();
  await page.locator('#live-mode').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#controls')).toBeHidden();
  await page.locator('#live-mode').click();
  await page.reload();
  await expect(page.locator('#live-mode')).toBeVisible();
});

test('studio renders under production CSP, saves settings, and never auto-captures', async ({
  page,
}) => {
  await serveProduction(page, '**/');
  await page.addInitScript(() => {
    (window as any).captureCalls = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      (window as any).captureCalls++;
      throw new DOMException('denied', 'NotAllowedError');
    };
  });
  await page.goto('/');
  await expect(page.locator('#stage canvas')).toBeVisible();
  await expect(page.locator('#notice')).not.toHaveClass(/error/);
  await page.getByRole('button', { name: '画面', exact: true }).click();
  await page.getByRole('button', { name: '色键绿', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('vtubeleaf-preview') || '{}').background),
    )
    .toBe('#00ff00');
  await page.reload();
  expect(await page.evaluate(() => (window as any).captureCalls)).toBe(0);
  await page.getByRole('button', { name: '画面', exact: true }).click();
  await expect(page.locator('#background')).toHaveValue('#00ff00');
  await page.getByRole('button', { name: '面捕', exact: true }).click();
  await page.getByRole('button', { name: '开始跟踪', exact: true }).click();
  await expect(page.locator('#notice')).toContainText('摄像头权限被拒绝');
  await expect(page.locator('#start')).toBeEnabled();
  await expect(page.locator('#start')).toHaveText('开始跟踪');
});

test('built-in backgrounds switch, persist, recall, and clear under production CSP', async ({
  page,
}, testInfo) => {
  await serveProduction(page, '**/');
  await page.route('**/backgrounds/*', (route) =>
    route.fulfill({
      path: resolve('dist/backgrounds', basename(new URL(route.request().url()).pathname)),
    }),
  );
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await page.getByRole('button', { name: '画面', exact: true }).click();
  for (const [name, id] of [
    ['海滩', 'beach'],
    ['会议室', 'meeting-room'],
    ['办公室', 'office'],
    ['家居', 'home'],
    ['卧室', 'bedroom'],
    ['咖啡馆', 'cafe'],
    ['游戏房', 'gaming-room'],
  ]) {
    const button = page.getByRole('button', { name, exact: true });
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(() => button.locator('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('vtubeleaf-preview') || '{}').composition
              ?.backgroundImage,
        ),
      )
      .toBe(`builtin:${id}`);
    await expect(page.locator('#notice')).not.toHaveClass(/error/);
  }
  await page.screenshot({ path: testInfo.outputPath('built-in-backgrounds.png') });
  await page.locator('#scene-name').fill('游戏直播');
  await page.getByRole('button', { name: '保存为新场景', exact: true }).click();
  await page.getByRole('button', { name: '海滩', exact: true }).click();
  await expect(page.getByRole('button', { name: '海滩', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.locator('#saved-scene').selectOption({ label: '游戏直播' });
  await page.getByRole('button', { name: '切换场景', exact: true }).click();
  await expect(page.getByRole('button', { name: '游戏房', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('vtubeleaf-preview') || '{}').composition
            ?.backgroundImage,
      ),
    )
    .toBe('builtin:gaming-room');
  await page.reload();
  await page.getByRole('button', { name: '画面', exact: true }).click();
  await expect(page.getByRole('button', { name: '游戏房', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '移除背景图', exact: true }).click();
  await expect(page.getByRole('button', { name: '游戏房', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('vtubeleaf-preview') || '{}').composition
            ?.backgroundImage,
      ),
    )
    .toBe('');
});

test('React controls preserve keyboard edits across status updates and reload', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const mirror = page.getByRole('switch', { name: '镜像角色转头方向', exact: true });
  await expect(mirror).toBeChecked();
  await mirror.focus();
  await page.keyboard.press('Space');
  await expect(mirror).not.toBeChecked();
  const sensitivity = page.getByRole('slider', { name: '头部灵敏度', exact: true });
  await sensitivity.focus();
  await page.keyboard.press('ArrowRight');
  await expect(sensitivity).toHaveAttribute('aria-valuenow', '1.1');
  await expect(page.locator('#render-status')).toContainText('FPS');
  await expect(sensitivity).toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('vtubeleaf-preview') || '{}').sensitivity,
      ),
    )
    .toBe(1.1);
  await page.reload();
  await expect(mirror).not.toBeChecked();
  await expect(sensitivity).toHaveAttribute('aria-valuenow', '1.1');
  expect(errors).toEqual([]);
});

test('React unmount flushes settings and releases a camera permission granted later', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?output=1');
  await page.evaluate(async () => {
    const react = '/node_modules/.vite/deps/react.js';
    const client = '/node_modules/.vite/deps/react-dom_client.js';
    const app = '/src/App.tsx';
    const { createElement, StrictMode } = (await import(react)).default;
    const { createRoot } = (await import(client)).default;
    const { App } = await import(app);
    const host = document.createElement('div');
    document.body.append(host);
    const root = ((window as any).testRoot = createRoot(host));
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        (window as any).grantCamera = resolve;
      });
    root.render(createElement(StrictMode, null, createElement(App)));
  });
  await expect(page.locator('#start')).toBeEnabled();
  await page.locator('#start').click({ force: true });
  await expect.poll(() => page.evaluate(() => typeof (window as any).grantCamera)).toBe('function');
  await page.evaluate(() => {
    document.getElementById('motionMirror')!.click();
    (window as any).testRoot.unmount();
    (window as any).cameraStops = 0;
    (window as any).grantCamera({
      getTracks: () => [{ stop: () => (window as any).cameraStops++ }],
    });
  });
  await expect.poll(() => page.evaluate(() => (window as any).cameraStops)).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('vtubeleaf-preview') || '{}').motionMirror,
      ),
    )
    .toBe(false);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('video')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('output contains only the canvas and no video or controls', async ({ page }) => {
  await page.goto('/?output=1');
  await expect(page.locator('canvas')).toBeVisible();
  await expect(page.locator('button,input,select,video,header,aside')).toHaveCount(0);
  expect(await page.locator('body').innerText()).toBe('');
});

test('local MediaPipe runs with a synthetic camera and stop releases every track', async ({
  page,
}) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:1420/'))
      external.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: '开始跟踪', exact: true }).click();
  await expect(page.locator('#tracking-status')).toHaveText('正在跟踪', { timeout: 20000 });
  await expect(page.locator('#face-status')).toHaveText('未识别人脸 · 等待 / 回中立');
  const label = await page
    .locator('#camera-video')
    .evaluate(
      (video: HTMLVideoElement) => (video.srcObject as MediaStream).getVideoTracks()[0].label,
    );
  await expect(page.getByText(`正在使用：${label}`, { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: /^显示面捕预览/ }).click();
  await expect(page.locator('#camera-video')).toBeVisible();
  await page.evaluate(() => {
    (window as any).testStream = (
      document.getElementById('camera-video') as HTMLVideoElement
    ).srcObject;
  });
  const videoTime = await page
    .locator('#camera-video')
    .evaluate((video: HTMLVideoElement) => video.currentTime);
  await page.locator('#live-mode').click();
  await expect(page.locator('#camera-video')).toBeHidden();
  await expect
    .poll(() =>
      page.locator('#camera-video').evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(videoTime);
  expect(
    await page
      .locator('#camera-video')
      .evaluate((video: HTMLVideoElement) => video.srcObject === (window as any).testStream),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#tracking-status')).toHaveText('正在跟踪');
  await expect(page.locator('#camera-video')).toBeVisible();
  const pressPause = await bindPauseHotkey(page);
  await pressPause();
  await expect(page.locator('#tracking-status')).toHaveText('已暂停');
  expect(
    await page.evaluate(() =>
      (window as any).testStream
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'live'),
    ),
  ).toBe(true);
  await page.getByRole('button', { name: '停止跟踪', exact: true }).click();
  await expect(page.locator('#tracking-status')).toHaveText('尚未开始');
  expect(
    await page.evaluate(() =>
      (window as any).testStream
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
    ),
  ).toBe(true);
  expect(
    await page.locator('#camera-video').evaluate((video: HTMLVideoElement) => video.srcObject),
  ).toBeNull();
  expect(external).toEqual([]);
});

test('upper body uses real local pose inference and clears cropped joints before returning to face tracking', async ({
  page,
}, testInfo) => {
  const fixture = process.env.VTUBELEAF_POSE_FIXTURE;
  const faceFixture = process.env.VTUBELEAF_FACE_FIXTURE;
  test.skip(
    !fixture || !faceFixture,
    'Set VTUBELEAF_POSE_FIXTURE to the official pose.jpg and VTUBELEAF_FACE_FIXTURE to face_landmark.png.',
  );
  test.setTimeout(60000);
  await page.route('**/test-pose.jpg', (route) => route.fulfill({ path: resolve(fixture!) }));
  await page.route('**/test-face.png', (route) => route.fulfill({ path: resolve(faceFixture!) }));
  await page.goto('/?output=1');
  const full = await page.evaluate(async () => {
    const { Tracker } = await import('/src/tracker.ts');
    const { defaults } = await import('/src/state.ts');
    const picture = new Image();
    picture.src = '/test-pose.jpg';
    await picture.decode();
    const source = document.createElement('canvas');
    source.width = picture.width;
    source.height = picture.height;
    const ctx = source.getContext('2d')!;
    const state = ((window as any).poseTest = {
      picture,
      source,
      ctx,
      crop: [0, 0, picture.width, picture.height],
      frames: [] as any[],
      errors: [] as string[],
    });
    const paint = () =>
      ctx.drawImage(
        state.picture,
        ...(state.crop as [number, number, number, number]),
        0,
        0,
        source.width,
        source.height,
      );
    paint();
    const stream = source.captureStream(24);
    (state as any).stream = stream;
    (state as any).drawing = setInterval(paint, 1000 / 24);
    navigator.mediaDevices.getUserMedia = async () => stream;
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;inset:0;background:#102019;z-index:20';
    const video = document.createElement('video');
    const preview = document.createElement('canvas');
    video.style.cssText = preview.style.cssText =
      'position:absolute;width:100%;height:100%;object-fit:contain';
    container.append(video, preview);
    document.body.append(container);
    const tracker = new Tracker(
      video,
      (face: any) => state.frames.push(face),
      (error: string) => state.errors.push(error),
      preview,
    );
    (state as any).tracker = tracker;
    (state as any).preview = preview;
    await tracker.start(defaults);
    const deadline = performance.now() + 15000;
    while (tracker.bodyStatus !== '已识别上半身' && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    // The small profile face is not detected; body data must still reach the consumer.
    return { body: state.frames.at(-1), errors: state.errors, status: tracker.bodyStatus };
  });
  expect(full.errors).toEqual([]);
  expect(full.status).toBe('已识别上半身');
  expect(full.body.yaw).toBeUndefined();
  expect(Number.isFinite(full.body.bodyYaw)).toBe(true);
  expect(Number.isFinite(full.body.bodyPitch)).toBe(true);
  expect(full.body.armLeft).toBeGreaterThan(0.35);
  expect(full.body.armRight).toBeGreaterThan(0.35);
  await page.screenshot({ path: testInfo.outputPath('upper-body-landmarks.png') });
  // The official MediaPipe pose.jpg fixture has its head at (435,235) and shoulders at y=320.
  const crop = async (rect: number[]) =>
    page.evaluate((rect) => {
      const t = (window as any).poseTest;
      t.crop = rect;
      t.source.width = rect[2];
      t.source.height = rect[3];
      t.frames.length = 0;
    }, rect);
  await crop([220, 210, 570, 215]);
  await expect
    .poll(() => page.evaluate(() => (window as any).poseTest.tracker.bodyStatus), {
      timeout: 15000,
    })
    .toBe('已识别肩膀 · 躯干未完整入镜');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const body = (window as any).poseTest.tracker.body;
        return Number.isFinite(body.bodyYaw) && body.bodyPitch === undefined;
      }),
    )
    .toBe(true);
  await page.evaluate(async () => {
    const picture = new Image();
    picture.src = '/test-face.png';
    await picture.decode();
    (window as any).poseTest.picture = picture;
  });
  await crop([0, 0, 425, 375]);
  await expect
    .poll(() => page.evaluate(() => (window as any).poseTest.tracker.bodyStatus), {
      timeout: 15000,
    })
    .toBe('未看到双肩 · 身体随头部轻动');
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const frames = (window as any).poseTest.frames;
          return (
            frames.length >= 3 &&
            frames.slice(-3).every((f: any) => f.bodyYaw === undefined && Number.isFinite(f.yaw))
          );
        }),
      { timeout: 15000 },
    )
    .toBe(true);
  const stopped = await page.evaluate(async () => {
    const t = (window as any).poseTest;
    clearInterval(t.drawing);
    await t.tracker.stop();
    return {
      released: t.stream
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
      errors: t.errors,
    };
  });
  expect(stopped).toEqual({ released: true, errors: [] });
});

test('hand signals remain stable between slower inference ticks and clear on absence or failure', async ({
  page,
}) => {
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const { Tracker } = await import('/src/tracker.ts');
    const video = document.createElement('video');
    let now = 1000;
    Object.defineProperties(video, {
      readyState: { value: 4 },
      currentTime: { get: () => now / 1000 },
    });
    const frames: any[] = [];
    const errors: string[] = [];
    const tracker: any = new Tracker(
      video,
      (frame: any) => frames.push(frame),
      (error: string) => errors.push(error),
    );
    tracker.trackingFps = 30;
    tracker.landmarker = {
      detectForVideo: () => ({
        facialTransformationMatrixes: [{ data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }],
        faceBlendshapes: [{ categories: [] }],
        faceLandmarks: [],
      }),
      close() {},
    };
    const points = Array.from({ length: 21 }, (_, i) => ({ x: 0.5, y: 0.8 - i * 0.02, z: 0 }));
    let mode = 'present';
    let handCalls = 0;
    tracker.hand = {
      detectForVideo: () => {
        handCalls++;
        if (mode === 'error') throw new Error('synthetic hand inference failure');
        return mode === 'present'
          ? {
              landmarks: [points],
              worldLandmarks: [points],
              handedness: [[{ categoryName: 'Left', score: 1 }]],
            }
          : { landmarks: [], worldLandmarks: [], handedness: [] };
      },
      close() {},
    };
    const realNow = performance.now.bind(performance);
    performance.now = () => now;
    const tick = (time: number) => {
      now = time;
      tracker.tick(tracker.generation);
      clearTimeout(tracker.timer);
    };
    try {
      [1000, 1033, 1066, 1101].forEach(tick);
      const steady = frames.splice(0);
      const samples = handCalls;
      mode = 'absent';
      [1202, 1235].forEach(tick);
      const absent = frames.splice(0);
      mode = 'present';
      tick(1303);
      mode = 'error';
      [1404, 1437].forEach(tick);
      const failed = frames.slice(-2);
      return { steady, samples, absent, failed, errors };
    } finally {
      performance.now = realNow;
      await tracker.stop();
    }
  });
  expect(result.samples).toBe(2);
  expect(result.steady).toHaveLength(4);
  for (const frame of result.steady) {
    expect(Number.isFinite(frame.yaw)).toBe(true);
    expect(frame.handLeftFound).toBe(1);
    expect(frame.handLeftIndex).toBeCloseTo(1);
  }
  for (const frame of [...result.absent, ...result.failed]) {
    expect(frame.handLeftFound).toBe(0);
    expect(frame.handLeftIndex).toBeUndefined();
    expect(Number.isFinite(frame.yaw)).toBe(true);
  }
  expect(result.errors).toEqual([]);
});

test('local hands survive a hidden face and clear when hands leave the frame', async ({
  page,
}, testInfo) => {
  const fixture = process.env.VTUBELEAF_HAND_FIXTURE;
  test.skip(!fixture, 'Set VTUBELEAF_HAND_FIXTURE to a local hand image you may use for testing.');
  test.setTimeout(60000);
  await page.route('**/test-hands.jpg', (route) => route.fulfill({ path: resolve(fixture!) }));
  await page.goto('/?output=1');
  const started = await page.evaluate(async () => {
    const { Tracker } = await import('/src/tracker.ts');
    const { defaults } = await import('/src/state.ts');
    const picture = new Image();
    picture.src = '/test-hands.jpg';
    await picture.decode();
    const source = document.createElement('canvas');
    source.width = picture.width;
    source.height = picture.height;
    const ctx = source.getContext('2d')!;
    const state = ((window as any).handTest = {
      frames: [] as any[],
      errors: [] as string[],
      blank: false,
      hideFace: false,
    });
    const paint = () => {
      ctx.drawImage(picture, 0, 0);
      ctx.fillStyle = '#202020';
      if (state.blank) ctx.fillRect(0, 0, source.width, source.height);
      else if (state.hideFace) ctx.fillRect(0, 450, source.width, 160);
    };
    paint();
    const stream = source.captureStream(24);
    (state as any).stream = stream;
    (state as any).drawing = setInterval(paint, 1000 / 24);
    let constraints: MediaStreamConstraints | undefined;
    navigator.mediaDevices.getUserMedia = async (value) => {
      constraints = value;
      return stream;
    };
    const container = document.createElement('div');
    container.style.cssText = 'position:fixed;inset:0;background:#102019;z-index:20';
    const video = document.createElement('video');
    const preview = document.createElement('canvas');
    video.style.cssText = preview.style.cssText =
      'position:absolute;width:100%;height:100%;object-fit:contain';
    container.append(video, preview);
    document.body.append(container);
    const tracker = new Tracker(
      video,
      (face: any) => state.frames.push(face),
      (error: string) => state.errors.push(error),
      preview,
    );
    (state as any).tracker = tracker;
    await tracker.start({
      ...defaults,
      upperBody: false,
      handTracking: true,
      cameraResolution: '1080p',
      trackingFps: 24,
      handFps: 10,
    });
    return { constraints, settings: tracker.cameraSettings };
  });
  expect(started.constraints).toMatchObject({
    audio: false,
    video: { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 24 } },
  });
  expect(started.settings).toContain('640');
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const f = (window as any).handTest.frames.at(-1);
          return f?.handLeftFound === 1 && f?.handRightFound === 1;
        }),
      { timeout: 15000 },
    )
    .toBe(true);
  await page.screenshot({ path: testInfo.outputPath('hand-landmarks.png') });
  await page.evaluate(() => {
    const t = (window as any).handTest;
    t.hideFace = true;
    t.frames.length = 0;
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const frames = (window as any).handTest.frames;
          return (
            frames.length >= 3 &&
            frames
              .slice(-3)
              .every(
                (f: any) => f.yaw === undefined && f.handLeftFound === 1 && f.handRightFound === 1,
              )
          );
        }),
      { timeout: 15000 },
    )
    .toBe(true);
  await page.evaluate(() => {
    const t = (window as any).handTest;
    t.blank = true;
    t.frames.length = 0;
  });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const frames = (window as any).handTest.frames;
          return (
            frames.length >= 3 &&
            frames
              .slice(-3)
              .every(
                (f: any) =>
                  f.handLeftFound === 0 &&
                  f.handRightFound === 0 &&
                  f.handLeftIndex === undefined &&
                  f.handRightIndex === undefined,
              )
          );
        }),
      { timeout: 15000 },
    )
    .toBe(true);
  expect(
    await page.evaluate(async () => {
      const t = (window as any).handTest;
      clearInterval(t.drawing);
      await t.tracker.stop();
      return {
        errors: t.errors,
        released: t.stream
          .getTracks()
          .every((track: MediaStreamTrack) => track.readyState === 'ended'),
      };
    }),
  ).toEqual({ errors: [], released: true });
});

for (const upperBody of ['enabled', 'disabled', 'unavailable'] as const) {
  test(`local MediaPipe recognizes a supplied face image with upper body ${upperBody}`, async ({
    page,
  }) => {
    const fixture = process.env.VTUBELEAF_FACE_FIXTURE;
    test.skip(
      !fixture,
      'Set VTUBELEAF_FACE_FIXTURE to a local face image you may use for testing.',
    );
    let poseRequests = 0;
    let handRequests = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/pose_landmarker_lite.task')) poseRequests++;
      if (request.url().endsWith('/hand_landmarker.task')) handRequests++;
    });
    if (upperBody === 'unavailable') {
      await page.route('**/pose_landmarker_lite.task', (route) =>
        route.fulfill({ status: 404, body: '' }),
      );
      await page.route('**/hand_landmarker.task', (route) =>
        route.fulfill({ status: 404, body: '' }),
      );
    }
    await page.route('**/test-face.png', (route) =>
      route.fulfill({ path: resolve(fixture!), contentType: 'image/png' }),
    );
    await page.goto('/?output=1');
    const result = await page.evaluate(async (upperBody) => {
      const trackerModule = '/src/tracker.ts',
        stateModule = '/src/state.ts';
      const { Tracker } = await import(trackerModule),
        { defaults } = await import(stateModule);
      const picture = new Image();
      picture.src = '/test-face.png';
      await picture.decode();
      const canvas = document.createElement('canvas');
      canvas.width = picture.width;
      canvas.height = picture.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(picture, 0, 0);
      const stream = canvas.captureStream(24);
      const drawing = setInterval(() => context.drawImage(picture, 0, 0), 1000 / 24);
      navigator.mediaDevices.getUserMedia = async () => stream;
      let faces = 0;
      const errors: string[] = [];
      const tracker = new Tracker(
        document.createElement('video'),
        (face: unknown) => {
          if (face) faces++;
        },
        (error: string) => errors.push(error),
      );
      try {
        const started = await tracker.start({
          ...defaults,
          upperBody: upperBody !== 'disabled',
          handTracking: upperBody === 'unavailable',
        });
        const deadline = performance.now() + 15000;
        while (faces < 3 && performance.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 100));
        const bodyStatus = tracker.bodyStatus;
        const handStatus = tracker.handStatus;
        await tracker.stop();
        return {
          started,
          faces,
          errors,
          bodyStatus,
          handStatus,
          released: stream.getTracks().every((track) => track.readyState === 'ended'),
        };
      } finally {
        clearInterval(drawing);
        await tracker.stop();
      }
    }, upperBody);
    expect(result.started).toBe(true);
    expect(result.faces).toBeGreaterThanOrEqual(3);
    expect(result.errors).toEqual([]);
    expect(result.released).toBe(true);
    expect(poseRequests).toBe(upperBody === 'disabled' ? 0 : 1);
    expect(handRequests).toBe(upperBody === 'unavailable' ? 1 : 0);
    if (upperBody === 'disabled') expect(result.bodyStatus).toBe('上半身识别已关闭');
    if (upperBody === 'unavailable') expect(result.bodyStatus).toContain('上半身资源加载失败');
    if (upperBody === 'unavailable') expect(result.handStatus).toContain('手部资源加载失败');
  });
}

test('face preview hides the camera by default, toggles it independently and clears lost landmarks', async ({
  page,
}, testInfo) => {
  const fixture = process.env.VTUBELEAF_FACE_FIXTURE;
  test.skip(!fixture, 'Set VTUBELEAF_FACE_FIXTURE to a local face image you may use for testing.');
  await page.route('**/test-face.png', (route) =>
    route.fulfill({ path: resolve(fixture!), contentType: 'image/png' }),
  );
  await page.goto('/');
  await page.evaluate(async () => {
    const picture = new Image();
    picture.src = '/test-face.png';
    await picture.decode();
    const source = document.createElement('canvas');
    source.width = picture.width;
    source.height = picture.height;
    const ctx = source.getContext('2d')!;
    ctx.drawImage(picture, 0, 0);
    const stream = source.captureStream(24);
    (window as any).faceSource = { ctx, picture, source };
    (window as any).faceDrawing = setInterval(() => ctx.drawImage(picture, 0, 0), 1000 / 24);
    navigator.mediaDevices.getUserMedia = async () => stream;
  });
  const showCamera = page.getByRole('switch', { name: /^显示真人画面/ });
  await expect(showCamera).not.toBeChecked();
  await page.getByRole('switch', { name: /^显示面捕预览/ }).click();
  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('正在跟踪', { timeout: 20000 });
  const mesh = page.locator('#face-mesh');
  const drawnPixels = () =>
    mesh.evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 3; i < pixels.length; i += 4) if (pixels[i]) count++;
      return count;
    });
  await expect.poll(drawnPixels).toBeGreaterThan(1000);
  expect(
    await mesh.evaluate((canvas: HTMLCanvasElement) => {
      const video = document.querySelector('video')!;
      return (
        canvas.width === video.videoWidth &&
        canvas.height === video.videoHeight &&
        getComputedStyle(canvas).objectFit === getComputedStyle(video).objectFit &&
        getComputedStyle(canvas).transform === getComputedStyle(video).transform
      );
    }),
  ).toBe(true);
  await expect(page.locator('#camera-video')).toHaveCSS('opacity', '0');
  const videoTime = await page
    .locator('#camera-video')
    .evaluate((video: HTMLVideoElement) => video.currentTime);
  await expect(mesh).toBeVisible();
  await expect.poll(drawnPixels).toBeGreaterThan(1000);
  await expect
    .poll(() =>
      page.locator('#camera-video').evaluate((video: HTMLVideoElement) => video.currentTime),
    )
    .toBeGreaterThan(videoTime);
  await page.screenshot({ path: testInfo.outputPath('face-landmarks-only.png') });
  await showCamera.click();
  await expect(showCamera).toBeChecked();
  await expect(page.locator('#camera-video')).toHaveCSS('opacity', '1');
  await expect(mesh).toBeVisible();
  await expect.poll(drawnPixels).toBeGreaterThan(1000);
  await page.screenshot({ path: testInfo.outputPath('face-mesh-preview.png') });
  await showCamera.click();
  await expect(showCamera).not.toBeChecked();
  await expect(page.locator('#camera-video')).toHaveCSS('opacity', '0');
  await expect.poll(drawnPixels).toBeGreaterThan(1000);
  await page.getByRole('switch', { name: '镜像摄像头预览', exact: true }).click();
  expect(await mesh.evaluate((canvas) => getComputedStyle(canvas).transform)).toBe('none');
  const pressPause = await bindPauseHotkey(page);
  await pressPause();
  await expect.poll(drawnPixels).toBe(0);
  await pressPause();
  await expect.poll(drawnPixels).toBeGreaterThan(1000);
  await page.evaluate(() => {
    clearInterval((window as any).faceDrawing);
    const { ctx, source } = (window as any).faceSource;
    (window as any).faceDrawing = setInterval(() => {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, source.width, source.height);
    }, 1000 / 24);
  });
  await expect.poll(drawnPixels).toBe(0);
  await page.locator('#start').click();
  await expect(mesh).toBeHidden();
  await expect.poll(drawnPixels).toBe(0);
  await page.evaluate(() => clearInterval((window as any).faceDrawing));
  await page.reload();
  await expect(showCamera).not.toBeChecked();
});

test('camera permission completing after stop releases the late stream', async ({ page }) => {
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const trackerModule = '/src/tracker.ts',
      stateModule = '/src/state.ts';
    const { Tracker } = await import(trackerModule),
      { defaults } = await import(stateModule);
    let grant!: (stream: unknown) => void,
      entered!: () => void,
      stops = 0;
    const requested = new Promise<void>((resolve) => {
      entered = resolve;
    });
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        grant = resolve;
        entered();
      });
    const video = document.createElement('video');
    const tracker = new Tracker(
      video,
      () => {},
      () => {},
    );
    const started = tracker.start(defaults);
    await requested;
    await tracker.stop();
    grant({ getTracks: () => [{ stop: () => stops++ }] });
    return { started: await started, stops, detached: video.srcObject === null };
  });
  expect(result).toEqual({ started: false, stops: 1, detached: true });
});

test('stopping during OSF subscription prevents the old start and cleans listeners', async ({
  page,
}) => {
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const mocks = '/node_modules/@tauri-apps/api/mocks.js',
      trackerModule = '/src/tracker.ts',
      stateModule = '/src/state.ts';
    const { mockIPC } = await import(mocks),
      { Tracker } = await import(trackerModule),
      { defaults } = await import(stateModule);
    let resume!: (id: number) => void, entered!: () => void;
    const subscribing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const calls: string[] = [];
    mockIPC((cmd: string) => {
      calls.push(cmd);
      if (cmd === 'plugin:event|listen')
        return new Promise((resolve) => {
          resume = resolve;
          entered();
        });
    });
    const tracker = new Tracker(
      document.createElement('video'),
      () => {},
      () => {},
    );
    const started = tracker.start({ ...defaults, engine: 'openseeface' });
    await subscribing;
    await tracker.stop();
    resume(1);
    return { started: await started, calls };
  });
  expect(result.started).toBe(false);
  expect(result.calls).not.toContain('start_openseeface');
  expect(result.calls).toContain('stop_openseeface');
  expect(result.calls).toContain('plugin:event|unlisten');
});

test('NVIDIA experimental settings are visible on Windows and survive reload', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'platform', { value: 'Win32' }));
  await page.goto('/');
  await page.locator('#engine').selectOption('nvidia');
  await expect(page.locator('#engine option:checked')).toHaveText('NVIDIA RTX · 实验中');
  const options = page.locator('#nvidia-options');
  await expect(options).toBeVisible();
  await expect(options).toContainText('尚未完成实机验证');
  await page.locator('#nvidia-path').fill('C:\\ARSDK\\bin\\VTubeLeafNvidia.exe');
  await page.locator('#nvidia-model-dir').fill('C:\\ARSDK\\bin\\models');
  await page.locator('#nvidia-camera').fill('2');
  await page.locator('#nvidia-fps').selectOption('24');
  await page.locator('#nvidia-resolution').selectOption('720p');
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('vtubeleaf-preview') || '{}').cameraResolution,
      ),
    )
    .toBe('720p');
  await page.reload();
  await expect(page.locator('#engine')).toHaveValue('nvidia');
  await expect(page.locator('#nvidia-path')).toHaveValue('C:\\ARSDK\\bin\\VTubeLeafNvidia.exe');
  await expect(page.locator('#nvidia-model-dir')).toHaveValue('C:\\ARSDK\\bin\\models');
  await expect(page.locator('#nvidia-camera')).toHaveValue('2');
  await expect(page.locator('#nvidia-fps')).toHaveValue('24');
  await expect(page.locator('#nvidia-resolution')).toHaveValue('720p');
  await options.screenshot({ path: testInfo.outputPath('nvidia-settings.png') });
  await page.screenshot({ path: testInfo.outputPath('nvidia-windows.png') });
});

test('NVIDIA is hidden on macOS but a restored setting explains the unsupported platform', async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'platform', { value: 'MacIntel' }),
  );
  await page.goto('/');
  await expect(page.locator('#engine')).toHaveValue('mediapipe');
  await expect(page.locator('#engine option[value="nvidia"]')).toHaveCount(0);
  await page.evaluate(() =>
    localStorage.setItem('vtubeleaf-preview', JSON.stringify({ engine: 'nvidia' })),
  );
  await page.reload();
  await expect(page.locator('#engine option[value="nvidia"]')).toBeDisabled();
  await expect(page.locator('#nvidia-options')).toContainText('此平台不支持');
  await page.locator('#engine').selectOption('mediapipe');
  await expect(page.locator('#nvidia-options')).toBeHidden();
});

test('NVIDIA frames respect pause, errors and native engine switching', async ({ page }) => {
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const mocks = '/node_modules/@tauri-apps/api/mocks.js',
      events = '/node_modules/@tauri-apps/api/event.js';
    const tracking = '/src/tracker.ts',
      state = '/src/state.ts';
    const { mockIPC } = await import(mocks),
      { emit } = await import(events);
    const { Tracker } = await import(tracking),
      { defaults } = await import(state);
    const calls: { cmd: string; args: unknown }[] = [],
      frames: { eyeLeft: number }[] = [],
      errors: string[] = [];
    let cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      cameraRequests++;
      throw new Error('Native tracker must own the camera');
    };
    mockIPC(
      (cmd: string, args: unknown) => {
        calls.push({ cmd, args });
      },
      { shouldMockEvents: true },
    );
    const tracker = new Tracker(
      document.createElement('video'),
      (frame: { eyeLeft: number }) => frames.push(frame),
      (error: string) => errors.push(error),
    );
    const settings = {
      ...defaults,
      engine: 'nvidia',
      nvidiaPath: 'C:\\SDK\\VTubeLeafNvidia.exe',
      nvidiaModelDir: 'C:\\SDK\\models',
      camera: 2,
      trackingFps: 24,
      cameraResolution: '720p',
    };
    const started = await tracker.start(settings);
    const packet = { detected: true, rotation: [0, 0, 0, 1], expressions: Array(53).fill(0) };
    packet.expressions[10] = 0.75;
    await emit('nvidia-frame', packet);
    tracker.pause(true);
    await emit('nvidia-frame', packet);
    tracker.pause(false);
    await emit('nvidia-frame', { ...packet, expressions: [] });
    await emit('nvidia-frame', { detected: false });
    await tracker.start({ ...defaults, engine: 'openseeface' });
    await emit('nvidia-frame', packet);
    await emit('nvidia-error', 'stale error');
    await tracker.start(settings);
    await emit('nvidia-error', 'SDK load failed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await emit('nvidia-frame', packet);
    await tracker.stop();
    return {
      started,
      calls: calls.filter(({ cmd }) => !cmd.startsWith('plugin:')),
      frames,
      errors,
      cameraRequests,
    };
  });
  expect(result.started).toBe(true);
  expect(result.cameraRequests).toBe(0);
  expect(result.frames).toHaveLength(1);
  expect(result.frames[0].eyeLeft).toBe(0.25);
  expect(result.errors).toEqual(['NVIDIA RTX（实验中）：SDK load failed']);
  expect(result.calls.map(({ cmd }) => cmd)).toEqual([
    'start_nvidia',
    'stop_nvidia',
    'start_openseeface',
    'stop_openseeface',
    'start_nvidia',
    'stop_nvidia',
  ]);
  expect(result.calls[0].args).toEqual({
    executable: 'C:\\SDK\\VTubeLeafNvidia.exe',
    modelDir: 'C:\\SDK\\models',
    camera: 2,
    fps: 24,
    resolution: '720p',
  });
});

test('OSF process errors stop reception and return a retryable failure', async ({ page }) => {
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const mocks = '/node_modules/@tauri-apps/api/mocks.js',
      eventModule = '/node_modules/@tauri-apps/api/event.js';
    const trackerModule = '/src/tracker.ts',
      stateModule = '/src/state.ts';
    const { mockIPC } = await import(mocks),
      { emit } = await import(eventModule);
    const { Tracker } = await import(trackerModule),
      { defaults } = await import(stateModule);
    const calls: string[] = [],
      errors: string[] = [];
    mockIPC(
      (cmd: string) => {
        calls.push(cmd);
      },
      { shouldMockEvents: true },
    );
    const tracker = new Tracker(
      document.createElement('video'),
      () => {},
      (error: string) => errors.push(error),
    );
    const started = await tracker.start({ ...defaults, engine: 'openseeface' });
    await emit('openseeface-error', 'OpenSeeFace 跟踪进程已退出。请检查依赖与摄像头后重试。');
    await new Promise((resolve) => setTimeout(resolve, 0));
    return { started, calls, errors };
  });
  expect(result.started).toBe(true);
  expect(result.calls.filter((cmd) => cmd === 'stop_openseeface')).toHaveLength(1);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain('OpenSeeFace');
});

test('model controls save profiles, expressions, shortcuts and a manual motion recording through IPC', async ({
  page,
}, testInfo) => {
  const fixture = process.env.VTUBELEAF_MODEL_FIXTURE;
  test.skip(!fixture, 'Set VTUBELEAF_MODEL_FIXTURE to a local model with expressions and motions.');
  const modelPath = resolve(fixture!),
    root = dirname(modelPath);
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      resolve(entry.parentPath, entry.name)
        .slice(root.length + 1)
        .replaceAll('\\', '/'),
    );
  const info = { id: 'controls', path: modelPath, name: 'Haru', entry: basename(modelPath), files };
  await page.route('**/test-model/**', (route) => {
    const resource = decodeURIComponent(
      new URL(route.request().url()).pathname.slice('/test-model/'.length),
    );
    return files.includes(resource)
      ? route.fulfill({ path: resolve(root, resource) })
      : route.abort();
  });
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main'); let chosen = 0;
      const fixtureInfo = ${JSON.stringify(info)};
      mockIPC(async (cmd, args) => {
        if (cmd === 'load_settings') return null;
        if (cmd === 'list_models') return { models: [], directory: '/test/models', errors: [] };
        if (cmd === 'save_settings') { window.savedSettings = args.settings; return; }
        if (cmd === 'choose_model') { window.chosenKind = args.kind; return { ...fixtureInfo, path: chosen++ ? fixtureInfo.path + '-second' : fixtureInfo.path }; }
        if (cmd === 'open_models_directory') { if (window.openedLibrary) throw new Error('无法打开角色文件夹'); window.openedLibrary = true; return; }
        if (cmd === 'load_model') return { ...fixtureInfo, path: args.path };
        if (cmd === 'read_model_resource') return (await fetch('/test-model/' + encodeURI(args.resource))).arrayBuffer();
        if (cmd === 'save_motion') { window.savedMotion = args.motion; return true; }
        if (cmd === 'read_model_vts_config') {
          window.autoVtsReads = (window.autoVtsReads || 0) + 1;
          if (chosen > 1) return { Version: 99 };
          return { Version: 1, ParameterSettings: [
            { OutputLive2D: 'ParamAngleX', Input: 'FaceAngleX', InputRangeLower: -18, InputRangeUpper: 18,
              OutputRangeLower: -20, OutputRangeUpper: 20, Smoothing: 0, ClampInput: true, ClampOutput: true }
          ], Hotkeys: [] };
        }
        if (cmd === 'choose_vts_config') {
          if (window.vtsImported) return { Version: 99 };
          window.vtsImported = true;
          return { Version: 1, ParameterSettings: [
            { OutputLive2D: 'ParamAngleY', Input: 'FaceAngleY', InputRangeLower: -30, InputRangeUpper: 30,
              OutputRangeLower: -20, OutputRangeUpper: 20, Smoothing: 20, ClampInput: true, ClampOutput: true },
            { OutputLive2D: 'ParamAngleZ', Input: 'UnsupportedInput' }
          ], Hotkeys: [{ Action: 'RemoveAllExpressions', Triggers: { Trigger1: 'LeftShift', Trigger2: 'N9', Trigger3: '' }, IsActive: true, IsGlobal: true }] };
        }
        if (cmd.startsWith('plugin:global-shortcut|')) { window.systemShortcutCalls = [...(window.systemShortcutCalls || []), cmd]; }
      }, { shouldMockEvents: true });\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/');
  await page.locator('#import-empty').click();
  await expect(page.locator('#model-name')).toHaveText('Haru');
  await expect(page.locator('#import-model')).toBeEnabled();
  await expect
    .poll(() => page.evaluate(() => (window as any).savedSettings?.mappings.ParamAngleX?.inputMin))
    .toBe(-0.6);
  expect(
    await page.evaluate(
      () =>
        (window as any).savedSettings.profiles[(window as any).savedSettings.modelPath].mappings
          .ParamAngleX.inputMin,
    ),
  ).toBe(-0.6);
  const stageArea = (await page.locator('#stage').boundingBox())!;
  const center = { x: stageArea.x + stageArea.width / 2, y: stageArea.y + stageArea.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + stageArea.width / 10, center.y + stageArea.height / 10, {
    steps: 5,
  });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => (window as any).savedSettings?.x))
    .toBeCloseTo(0.1, 2);
  expect(await page.evaluate(() => (window as any).savedSettings.y)).toBeCloseTo(0.1, 2);
  await page.mouse.wheel(0, -300);
  await expect
    .poll(() => page.evaluate(() => (window as any).savedSettings?.zoom))
    .toBeGreaterThan(1);
  await page.screenshot({ path: testInfo.outputPath('studio-drag-zoom.png') });
  await page.getByRole('button', { name: '画面', exact: true }).click();
  await page.locator('#reset-display').click();
  await expect.poll(() => page.evaluate(() => (window as any).savedSettings?.zoom)).toBe(1);
  expect(
    await page.evaluate(() => [(window as any).savedSettings.x, (window as any).savedSettings.y]),
  ).toEqual([0, 0]);
  await page.screenshot({ path: testInfo.outputPath('studio-main.png') });
  const initialStage = await page.locator('#stage').boundingBox();
  await page.getByRole('button', { name: '收起设置面板' }).click();
  await expect.poll(() => page.locator('#stage canvas').boundingBox()).toEqual(initialStage);
  await page.locator('#live-mode').click();
  await expect(page.locator('body')).toHaveText('', { useInnerText: true });
  await page.screenshot({ path: testInfo.outputPath('studio-live.png') });
  await page.keyboard.press('Escape');
  await expect(page.locator('#render-status')).toContainText('FPS');
  await page.screenshot({ path: testInfo.outputPath('studio-stage.png') });
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await page.locator('#mapping-parameter').selectOption('ParamAngleX');
  await page.locator('#mapping-inputMin').fill('-0.5');
  await page.locator('#save-mapping').click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as any).savedSettings?.profiles[(window as any).savedSettings?.modelPath]
            ?.mappings.ParamAngleX?.inputMin,
      ),
    )
    .toBe(-0.5);
  await page.getByRole('button', { name: '物理效果', exact: true }).click();
  await page.getByRole('slider', { name: '整体强度', exact: true }).focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  await page.locator('#physics-fps').selectOption('60');
  const physicsGroup = page.locator('[id^="physics-group-"] [role="slider"]').first();
  await expect(physicsGroup).toBeVisible();
  await physicsGroup.focus();
  await page.keyboard.press('Home');
  await expect.poll(() => page.evaluate(() => (window as any).savedSettings?.physicsFps)).toBe(60);
  expect(await page.evaluate(() => (window as any).savedSettings.physicsStrength)).toBe(0.05);
  expect(
    Object.values(await page.evaluate(() => (window as any).savedSettings.physicsGroups)),
  ).toContain(0);
  await page.screenshot({ path: testInfo.outputPath('studio-physics-controls.png') });
  const expression = page.locator('#expression-buttons button').first();
  await expression.click();
  await expect(expression).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#clear-expressions').click();
  await expect(expression).toHaveAttribute('aria-pressed', 'false');
  await page.getByRole('button', { name: '应用快捷键' }).click();
  await page.locator('#hotkey-action').selectOption('clear-expressions');
  await page.locator('#hotkey-binding').fill('Control+Shift+1');
  await page.locator('#save-hotkey').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).savedSettings?.hotkeys['clear-expressions']))
    .toBe('Control+Shift+1');
  expect(await page.evaluate(() => (window as any).systemShortcutCalls ?? [])).toEqual([]);
  await expression.click();
  await expect(expression).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+Shift+1');
  await expect(expression).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#record-toggle').click();
  await expect(page.locator('#record-status')).not.toHaveText('0.0 s');
  await page.locator('#record-toggle').click();
  await page.locator('#record-save').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).savedMotion?.Meta?.CurveCount ?? 0))
    .toBeGreaterThan(0);
  await page.screenshot({ path: testInfo.outputPath('studio-model-controls.png') });
  await page.getByRole('button', { name: '角色库', exact: true }).click();
  await page.locator('.library-actions').getByRole('button', { name: '打开角色文件夹' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).openedLibrary)).toBe(true);
  await page.getByRole('button', { name: '添加角色', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '选择模型文件夹' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('library-add-menu.png') });
  await page.getByRole('menuitem', { name: '选择文件（model3.json / ZIP）' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).chosenKind)).toBe('file');
  await expect
    .poll(() => page.evaluate(() => (window as any).savedSettings?.modelPath))
    .toBe(modelPath + '-second');
  expect(await page.evaluate(() => (window as any).savedSettings.mappings)).toEqual({});
  expect(
    await page.evaluate(() => (window as any).savedSettings.vtsImportReport.join(' ')),
  ).toContain('不是受支持的');
  await expect(page.locator('#notice')).toContainText('VTS');
  expect(await page.evaluate(() => (window as any).savedSettings.physicsStrength)).toBe(1);
  expect(await page.evaluate(() => (window as any).savedSettings.physicsGroups)).toEqual({});
  await page.getByTitle(modelPath, { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).savedSettings?.modelPath))
    .toBe(modelPath);
  expect(
    await page.evaluate(() => (window as any).savedSettings.mappings.ParamAngleX.inputMin),
  ).toBe(-0.5);
  expect(await page.evaluate(() => (window as any).savedSettings.physicsStrength)).toBe(0.05);
  expect(
    Object.values(await page.evaluate(() => (window as any).savedSettings.physicsGroups)),
  ).toContain(0);
  await expect(page.locator('#notice')).not.toHaveClass(/error/);
  expect(await page.evaluate(() => (window as any).autoVtsReads)).toBe(2);
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await page.locator('#import-vts').click();
  await expect
    .poll(() => page.evaluate(() => (window as any).savedSettings?.mappings.ParamAngleY?.inputMin))
    .toBe(-1);
  const imported = await page.evaluate(() => (window as any).savedSettings);
  expect(imported.mappings.ParamAngleX.inputMin).toBe(-0.5);
  expect(imported.hotkeys['clear-expressions']).toBe('Shift+Digit9');
  expect(imported.profiles[modelPath].vtsImportReport).toEqual(imported.vtsImportReport);
  await page.getByRole('button', { name: 'VTS 导入结果', exact: true }).click();
  await expect(page.getByText(/不支持输入源 UnsupportedInput/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('vts-import.png') });
  await page.locator('#import-vts').click();
  await expect(page.locator('#notice')).toContainText('不是受支持的');
  expect(await page.evaluate(() => (window as any).savedSettings.mappings)).toEqual(
    imported.mappings,
  );
  await page.getByRole('button', { name: '角色库', exact: true }).click();
  await page.locator('#library .fold').getByRole('button', { name: '打开角色文件夹' }).click();
  await expect(page.locator('#notice')).toContainText('无法打开角色文件夹');
  await expect(page.locator('#notice')).toHaveClass(/error/);
});

test('character library shows square icons and opens its folder without loading model resources', async ({
  page,
}, testInfo) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main'); window.resourceReads = 0; window.folderOpens = 0;
      const canvas = document.createElement('canvas'); canvas.width = 48; canvas.height = 24;
      const context = canvas.getContext('2d'); context.fillStyle = '#39794b'; context.fillRect(0, 0, 48, 24);
      const icon = await (await fetch(canvas.toDataURL('image/jpeg'))).arrayBuffer();
      mockIPC(async (cmd) => {
        if (cmd === 'load_settings') return null;
        if (cmd === 'list_models') return { models: [{ id: 'icon', path: '/icon/model.model3.json', name: 'Icon', entry: 'model.model3.json', files: [] }], directory: '/icon', errors: [] };
        if (cmd === 'read_model_preview') return icon;
        if (cmd === 'open_models_directory') { if (window.folderOpens++) throw new Error('无法打开角色文件夹'); return; }
        if (cmd === 'read_model_resource' || cmd === 'save_model_preview') { window.resourceReads++; throw new Error('icon must not render a model'); }
      }, { shouldMockEvents: true });\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await page.getByRole('button', { name: '角色库', exact: true }).click();
  const icon = page.getByRole('img', { name: 'Icon 角色预览' });
  await expect(icon).toBeVisible();
  const dimensions = await icon.evaluate((image: HTMLImageElement) => ({
    width: image.clientWidth,
    height: image.clientHeight,
    naturalWidth: image.naturalWidth,
  }));
  expect(dimensions.width).toBe(dimensions.height);
  expect(dimensions.naturalWidth).toBe(48);
  expect(await page.evaluate(() => (window as any).resourceReads)).toBe(0);
  const folderToggle = page.getByRole('button', { name: '角色文件夹', exact: true });
  const openFolder = page.locator('#library .fold').getByRole('button', { name: '打开角色文件夹' });
  await expect(folderToggle).toHaveAttribute('aria-expanded', 'false');
  await openFolder.click();
  await expect.poll(() => page.evaluate(() => (window as any).folderOpens)).toBe(1);
  await expect(folderToggle).toHaveAttribute('aria-expanded', 'false');
  await folderToggle.click();
  await expect(page.locator('.library-path')).toHaveText('/icon');
  await openFolder.press('Enter');
  await expect(page.locator('#notice')).toContainText('无法打开角色文件夹');
  await expect(page.locator('#notice')).toHaveClass(/error/);
  await expect(folderToggle).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: testInfo.outputPath('library-folder-button.png') });
});

test('character library generates avatars before selection, imports drops and restores previews', async ({
  page,
}, testInfo) => {
  const fixtures = [process.env.VTUBELEAF_MODEL_FIXTURE, process.env.VTUBELEAF_ALT_MODEL_FIXTURE];
  test.skip(
    fixtures.some((fixture) => !fixture),
    'Set both licensed model fixtures.',
  );
  const models = fixtures.map((fixture, index) => {
    const path = resolve(fixture!),
      root = dirname(path);
    const files = readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) =>
        resolve(entry.parentPath, entry.name)
          .slice(root.length + 1)
          .replaceAll('\\', '/'),
      );
    return {
      id: `library-${index}`,
      path: `/managed/models/${index}/${basename(path)}`,
      name: basename(root),
      entry: basename(path),
      files,
    };
  });
  await page.route('**/library-fixture/**', (route) => {
    const [id, ...parts] = decodeURIComponent(
      new URL(route.request().url()).pathname.slice('/library-fixture/'.length),
    ).split('/');
    const index = models.findIndex((entry) => entry.id === id),
      resource = parts.join('/');
    return index >= 0 && models[index].files.includes(resource)
      ? route.fulfill({ path: resolve(dirname(resolve(fixtures[index]!)), resource) })
      : route.abort();
  });
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main');
      const models = ${JSON.stringify(models)};
      const library = JSON.parse(localStorage.getItem('test-library') ?? JSON.stringify(models));
      const previews = JSON.parse(localStorage.getItem('test-previews') ?? '{}');
      mockIPC(async (cmd, args) => {
        if (cmd === 'load_settings') return JSON.parse(localStorage.getItem('test-settings') ?? 'null');
        if (cmd === 'save_settings') { localStorage.setItem('test-settings', JSON.stringify(args.settings)); return; }
        if (cmd === 'list_models') return { models: library, directory: '/managed/models', errors: [] };
        if (cmd === 'load_model') {
          if (args.path === '/dropped/broken.zip') throw new Error('模型资源缺失');
          const model = models.find((model) => model.path === args.path) ?? models[args.path === '/dropped/second.zip' ? 1 : 0];
          if (!library.some((item) => item.path === model.path)) library.push(model);
          localStorage.setItem('test-library', JSON.stringify(library));
          return model;
        }
        if (cmd === 'read_model_preview') return new Uint8Array(previews[args.id] ?? []).buffer;
        if (cmd === 'save_model_preview') { previews[args.id] = args.png; localStorage.setItem('test-previews', JSON.stringify(previews)); return; }
        if (cmd === 'read_model_resource') return (await fetch('/library-fixture/' + args.id + '/' + encodeURI(args.resource))).arrayBuffer();
        if (cmd === 'read_model_vts_config') {
          localStorage.setItem('test-vts-reads', String(Number(localStorage.getItem('test-vts-reads') ?? 0) + 1));
          if (args.id === models[0].id) throw new Error('发现多个 VTS 配置，请手动选择需要的配置');
          return { Version: 1, ParameterSettings: [
            { OutputLive2D: 'PARAM_ANGLE_X', Input: 'FaceAngleX', InputRangeLower: -18, InputRangeUpper: 18,
              OutputRangeLower: -20, OutputRangeUpper: 20, Smoothing: 0, ClampInput: true, ClampOutput: true }
          ], Hotkeys: [] };
        }
      }, { shouldMockEvents: true });\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/');
  await expect(page.locator('#start')).toBeEnabled();
  await page.getByRole('button', { name: '角色库', exact: true }).click();
  await expect(page.locator('.model-card img')).toHaveCount(2);
  await expect(page.locator('.model-card[aria-pressed="true"]')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('library-before-selection.png') });
  const drop = async (event: string, paths: string[] = []) =>
    page.evaluate(
      async ({ event, paths }) => {
        const { emit } = await import('/node_modules/@tauri-apps/api/event.js');
        await emit(event, { paths, position: { x: 300, y: 300 } });
      },
      { event, paths },
    );
  await drop('tauri://drag-enter', ['/dropped/first']);
  await expect(page.locator('.model-drop-overlay')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('library-drop.png') });
  await drop('tauri://drag-leave');
  await expect(page.locator('.model-drop-overlay')).toBeHidden();
  await drop('tauri://drag-drop', ['/dropped/first', '/dropped/broken.zip', '/dropped/second.zip']);
  await expect(page.locator('.model-card')).toHaveCount(2);
  await expect(page.locator('#notice')).toContainText('已加入 2 个角色');
  await expect(page.locator('#notice')).toContainText('broken.zip');
  await expect(page.locator('#notice')).toContainText('多个 VTS 配置');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('test-settings')!));
  expect(saved.profiles[models[0].path].vtsImportReport.join(' ')).toContain('多个 VTS 配置');
  expect(saved.mappings.PARAM_ANGLE_X.inputMin).toBe(-0.6);
  await expect(page.locator('.model-card img')).toHaveCount(2);
  for (const entry of models) {
    await expect(page.getByRole('img', { name: `${entry.name} 角色预览` })).toBeVisible();
  }
  const previewPixels = await page.locator('.model-card img').evaluateAll(async (images) =>
    Promise.all(
      images.map(async (image) => {
        await (image as HTMLImageElement).decode();
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const context = canvas.getContext('2d')!;
        context.drawImage(image as HTMLImageElement, 0, 0);
        const data = context.getImageData(0, 0, 256, 256).data;
        let visible = 0,
          top = 256;
        for (let i = 3; i < data.length; i += 4) {
          if (data[i] < 32) continue;
          visible++;
          top = Math.min(top, Math.floor(i / 4 / 256));
        }
        return { visible, top };
      }),
    ),
  );
  await page.screenshot({ path: testInfo.outputPath('library-two-characters.png') });
  for (const [index, pixels] of previewPixels.entries()) {
    expect(pixels.visible, models[index].name).toBeGreaterThan(1000);
    expect(pixels.top, `${models[index].name} avatar top margin`).toBeLessThan(52);
  }
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await page.locator('#mapping-parameter').selectOption('PARAM_ANGLE_X');
  await page.locator('#mapping-inputMin').fill('-0.4');
  await page.locator('#save-mapping').click();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('test-settings')!).mappings.PARAM_ANGLE_X.inputMin,
      ),
    )
    .toBe(-0.4);
  await page.getByRole('button', { name: 'VTS 导入结果', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('vts-auto-import.png') });
  await page.getByRole('button', { name: '角色库', exact: true }).click();
  await page.getByRole('button', { name: `切换到 ${models[0].name}`, exact: true }).click();
  await expect(page.locator('#model-name')).toHaveText(models[0].name);
  await expect(
    page.getByRole('button', { name: `切换到 ${models[0].name}`, exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.locator('#model-name')).toHaveText(models[0].name);
  await page.getByRole('button', { name: '角色库', exact: true }).click();
  await expect(page.locator('.model-card img')).toHaveCount(2);
  await page.getByRole('button', { name: `切换到 ${models[1].name}`, exact: true }).click();
  await expect(page.locator('#model-name')).toHaveText(models[1].name);
  await expect(page.locator('#notice')).not.toHaveClass(/error/);
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('test-settings')!).mappings.PARAM_ANGLE_X.inputMin,
      ),
    )
    .toBe(-0.4);
  expect(await page.evaluate(() => localStorage.getItem('test-vts-reads'))).toBe('2');
  await page.setViewportSize({ width: 900, height: 650 });
  await page.screenshot({ path: testInfo.outputPath('library-compact.png') });
});

test('quality settings preserve privacy and calibration samples cancel on stop', async ({
  page,
}, testInfo) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC } from '/node_modules/@tauri-apps/api/mocks.js';
      import { emit } from '/node_modules/@tauri-apps/api/event.js';
      mockIPC(() => {}, { shouldMockEvents: true });
      window.qualityEmit = emit;
      localStorage.setItem('vtubeleaf-preview', JSON.stringify({engine:'openseeface'}));\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/');
  await expect(page.locator('#render-fps')).toBeVisible();
  await page.locator('#render-fps').selectOption('60');
  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('正在跟踪');
  await page.evaluate(() => {
    let n = 0;
    (window as any).qualityTimer = setInterval(
      () =>
        (window as any).qualityEmit('openseeface-frame', {
          yaw: 8 + (n++ % 2 ? 0.5 : -0.5),
          pitch: 0,
          roll: 0,
          eyeLeft: 0.8,
          eyeRight: 0.9,
          mouthOpen: 0,
          mouthSmile: 0,
        }),
      35,
    );
  });
  await expect(page.locator('#face-status')).toHaveText('已识别人脸');
  await page.locator('#calibrate').click();
  await expect(page.locator('#calibrate')).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('vtubeleaf-preview') || '{}').neutral?.yaw,
      ),
    )
    .toBeGreaterThan(7.4);
  const neutral = await page.evaluate(
    () => JSON.parse(localStorage.getItem('vtubeleaf-preview')!).neutral,
  );
  expect(neutral.yaw).toBeLessThan(8.6);
  await page.locator('#calibrate').click();
  await page.locator('#start').click();
  await expect(page.locator('#tracking-status')).toHaveText('尚未开始');
  await page.evaluate(() => clearInterval((window as any).qualityTimer));
  await page.getByText('眼睛、嘴部与丢脸恢复', { exact: true }).click();
  await page.locator('#eye-link').selectOption('always');
  await page.locator('#lost-mode').selectOption('hold');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('vtubeleaf-preview') || '{}').lostMode),
    )
    .toBe('hold');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('vtubeleaf-preview')!));
  expect(saved.neutral).toEqual(neutral);
  expect(saved.renderFps).toBe(60);
  expect(saved.previewCamera).toBe(false);
  expect(saved.lipSyncMode).toBe('off');
  expect(saved.handTracking).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('quality-controls.png') });
  await page.locator('#engine').selectOption('mediapipe');
  await page.getByText('采集质量与帧率', { exact: true }).click();
  await page.locator('#camera-resolution').selectOption('1080p');
  await page.locator('#tracking-fps').selectOption('24');
  await page.locator('#hand-tracking').click();
  await page.locator('#camera-resolution').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('capture-quality-controls.png') });
  await page.getByText('麦克风口型', { exact: true }).click();
  await page.locator('#lip-sync-mode').selectOption('vowels');
  await expect(page.locator('#calibrate-voice-A')).toBeDisabled();
  await expect(page.locator('#mic-toggle')).toHaveText('开启麦克风');
  await page.locator('#mic-toggle').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('microphone-controls.png') });
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vtubeleaf-preview') || '{}')))
    .toMatchObject({
      cameraResolution: '1080p',
      trackingFps: 24,
      handTracking: true,
      lipSyncMode: 'vowels',
    });
});

test('local Web Audio drives the mouth without a camera and stops all microphone tracks', async ({
  page,
}) => {
  await page.goto('/?output=1');
  await page.mouse.click(10, 10);
  await page.evaluate(async () => {
    const { createStudio } = await import('/src/studio.ts');
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    oscillator.frequency.value = 440;
    const destination = context.createMediaStreamDestination();
    oscillator.connect(destination);
    oscillator.start();
    await context.resume();
    const state = ((window as any).audioTest = {
      context,
      oscillator,
      stream: destination.stream,
      requests: [],
      view: null,
    });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      state.requests.push(constraints);
      return destination.stream;
    };
    const container = document.createElement('div');
    document.body.append(container);
    state.studio = createStudio(
      container,
      document.createElement('video'),
      (view) => (state.view = view),
    );
  });
  await expect.poll(() => page.evaluate(() => (window as any).audioTest.view?.ready)).toBe(true);
  expect(await page.evaluate(() => (window as any).audioTest.requests)).toEqual([]);
  await page.evaluate(async () => {
    const actions = (window as any).audioTest.studio.actions;
    actions.setSetting('lipSyncMode', 'volume');
    actions.setSetting('micGain', 1);
    await actions.toggleMic();
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).audioTest.view.faceInput.mouthOpen))
    .toBeGreaterThan(0.2);
  expect(await page.evaluate(() => (window as any).audioTest.view.faceInput.yaw)).toBeUndefined();
  expect(await page.evaluate(() => (window as any).audioTest.requests)).toEqual([
    { audio: true, video: false },
  ]);
  await page.evaluate(async () => {
    const state = (window as any).audioTest;
    const calibration = state.studio.actions.calibrateVoice('A').catch(() => {});
    await state.studio.actions.toggleMic();
    await calibration;
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).audioTest.view.micActive))
    .toBe(false);
  expect(
    await page.evaluate(() =>
      (window as any).audioTest.stream
        .getTracks()
        .every((track: MediaStreamTrack) => track.readyState === 'ended'),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => (window as any).audioTest.view.settings.voiceTemplates)).toEqual(
    {},
  );
  await page.evaluate(async () => {
    const state = (window as any).audioTest;
    state.studio.destroy();
    state.oscillator.stop();
    await state.context.close();
  });
});

test('scene layers render GIF and Live2D items, preserve failures and match passive output', async ({
  page,
}, testInfo) => {
  const fixture = process.env.VTUBELEAF_MODEL_FIXTURE;
  test.skip(!fixture, 'Set VTUBELEAF_MODEL_FIXTURE to a licensed local model.');
  const modelPath = resolve(fixture!),
    root = dirname(modelPath);
  const files = readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) =>
      resolve(e.parentPath, e.name)
        .slice(root.length + 1)
        .replaceAll('\\', '/'),
    );
  await page.route('**/scene-model/**', (route) => {
    const resource = decodeURIComponent(
      new URL(route.request().url()).pathname.slice('/scene-model/'.length),
    );
    return files.includes(resource)
      ? route.fulfill({ path: resolve(root, resource) })
      : route.abort();
  });
  await page.goto('/?output=1');
  const result = await page.evaluate(
    async (info) => {
      const { AvatarStage } = await import('/src/renderer.ts');
      const { readSettings } = await import('/src/state.ts');
      const { mockIPC } = await import('/node_modules/@tauri-apps/api/mocks.js');
      const gif = Uint8Array.from(
        '47494638396101000100800000ff00000000ff21f90400050000002c000000000100010000020244010021f90400050000002c00000000010001000002024c01003b'.match(
          /../g,
        )!,
        (h) => parseInt(h, 16),
      ).buffer;
      let releaseAsset!: () => void;
      let assetRequested!: () => void;
      const assetGate = new Promise<void>((resolve) => {
        releaseAsset = resolve;
      });
      const requested = new Promise<void>((resolve) => {
        assetRequested = resolve;
      });
      mockIPC(async (command: string, args: any) => {
        if (command === 'read_model_resource')
          return (await fetch('/scene-model/' + encodeURI(args.resource))).arrayBuffer();
        if (command === 'read_asset') {
          if (args.id.startsWith('f')) throw new Error('missing asset');
          if (args.id.startsWith('b')) {
            assetRequested();
            await assetGate;
          }
          return gif;
        }
      });
      const make = (left: number, passive: boolean) => {
        const container = document.createElement('div');
        container.style.cssText = `position:fixed;top:100px;left:${left}px;width:360px;height:360px`;
        document.body.append(container);
        return new AvatarStage(container, () => {}, passive);
      };
      const main = make(100, false),
        output = make(500, true);
      const settings = readSettings({
        background: '#ffffff',
        composition: {
          items: [
            {
              id: 'gif',
              kind: 'image',
              source: 'a'.repeat(32) + '.gif',
              name: 'Animated',
              x: -0.3,
              y: -0.25,
              scale: 0.18,
            },
            {
              id: 'model-item',
              kind: 'live2d',
              source: info.path,
              name: 'Live2D',
              x: 0.3,
              scale: 0.35,
              attach: 'model',
            },
          ],
        },
      });
      await main.load(info);
      await output.load(info);
      await main.compose(settings, [info]);
      await output.compose(settings, [info]);
      const first = (main as any).layers.frames.gif.index;
      for (let frame = 0; frame < 4; frame++) main.draw({ ParamAngleX: 20 }, 16);
      const next = main.sceneFrames.gif.index;
      output.draw(main.frame, 16, main.parts, main.sceneFrames);
      const matches = JSON.stringify(main.sceneFrames) === JSON.stringify(output.sceneFrames);
      const pixels = (stage: any) =>
        Array.from(stage.app.renderer.extract.pixels(stage.app.stage) as Uint8Array);
      const a = pixels(main),
        b = pixels(output);
      const images = [main.canvas.toDataURL(), output.canvas.toDataURL()];
      const parity = a.length === b.length && a.every((value, index) => value === b[index]);
      const diagnostics = {
        lengthA: a.length,
        lengthB: b.length,
        different: a.filter((v, i) => v !== b[i]).length,
        mainParams: JSON.stringify(main.frame) === JSON.stringify(output.frame),
        mainParts: JSON.stringify(main.parts) === JSON.stringify(output.parts),
        mainBounds: main.content.getBounds().toString(),
        outputBounds: output.content.getBounds().toString(),
      };
      const visuals = (main as any).layers.visuals;
      const original = visuals[0].node;
      let failed = false;
      try {
        await main.compose(
          readSettings({
            ...settings,
            composition: {
              items: [{ ...settings.composition.items[0], source: 'f'.repeat(32) + '.gif' }],
            },
          }),
          [info],
        );
      } catch {
        failed = true;
      }
      const preserved = (main as any).layers.visuals[0].node === original;
      settings.x = 0.1;
      settings.zoom = 1.5;
      settings.rotation = 30;
      settings.composition.items[1].behind = true;
      main.display(settings);
      main.draw({}, 16);
      const attached =
        visuals[1].node.x !== 360 * 0.8 &&
        visuals[1].node.rotation > 0 &&
        visuals[1].node.zIndex < 0;
      settings.composition.items[0].visible = false;
      main.draw({}, 16);
      const hidden = !original.visible;
      settings.modelVisible = false;
      main.display(settings);
      main.draw({}, 16);
      const mainHiddenOnly = !(main as any).model.visible && visuals[1].node.visible;
      const emptyScene = readSettings({ background: '#ff0000' });
      await main.compose(emptyScene, []);
      const slowScene = main.compose(
        readSettings({
          background: '#0000ff',
          composition: {
            items: [{ id: 'late', kind: 'image', source: 'b'.repeat(32) + '.gif' }],
          },
        }),
        [],
      );
      await requested;
      await main.compose(emptyScene, []);
      releaseAsset();
      await slowScene;
      const latestSceneWins =
        (main as any).settings.background === '#ff0000' &&
        Object.keys(main.sceneFrames).length === 0;
      settings.modelVisible = true;
      const prepared = await main.prepare(info, settings, [info]);
      prepared.mount(main.canvas.parentElement!);
      main.destroy();
      prepared.draw({}, 16);
      const preparedVisible = pixels(prepared).some((value, index) => index % 4 === 3 && value > 0);
      (window as any).sceneStages = [prepared, output];
      return {
        first,
        next,
        matches,
        parity,
        diagnostics,
        images,
        failed,
        preserved,
        attached,
        hidden,
        mainHiddenOnly,
        latestSceneWins,
        preparedVisible,
        canvases: document.querySelectorAll('canvas').length,
      };
    },
    { id: 'scene-model', path: modelPath, name: 'Haru', entry: basename(modelPath), files },
  );
  result.images.forEach((data, i) =>
    writeFileSync(
      testInfo.outputPath(`parity-${i}.png`),
      Buffer.from(data.split(',')[1], 'base64'),
    ),
  );
  await page.screenshot({ path: testInfo.outputPath('scene-output.png') });
  expect(result).toMatchObject({
    first: 0,
    next: 1,
    matches: true,
    parity: true,
    failed: true,
    preserved: true,
    attached: true,
    hidden: true,
    mainHiddenOnly: true,
    latestSceneWins: true,
    preparedVisible: true,
    canvases: 3,
  });
  await page.evaluate(() => (window as any).sceneStages.forEach((stage: any) => stage.destroy()));
});

test('output coalesces state changes while one scene is loading', async ({ page }) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      import { AvatarStage } from '/src/renderer.ts';
      window.isTauri = true; mockWindows('output');
      const gate = new Promise(resolve => { window.releaseOutputAsset = resolve; });
      const bytes = Uint8Array.from('47494638396101000100800000ff00000000ff21f90400050000002c00000000010001000002024401003b'.match(/../g), h => parseInt(h, 16)).buffer;
      window.prepareCalls = 0;
      const prepare = AvatarStage.prototype.prepare;
      AvatarStage.prototype.prepare = async function (...args) {
        window.prepareCalls++;
        const candidate = await prepare.apply(this, args);
        window.outputCandidate = candidate;
        return candidate;
      };
      mockIPC(async cmd => {
        if (cmd === 'read_asset') { window.assetRequested = true; await gate; return bytes; }
      }, { shouldMockEvents: true });
      const invoke = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = (cmd, args, options) => {
        if (cmd === 'plugin:event|emit_to' && args.event === 'output-ready') window.outputReady = true;
        return invoke(cmd, args, options);
      };\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/?output=1');
  await expect.poll(() => page.evaluate(() => (window as any).outputReady)).toBe(true);
  const update = async (count: number) =>
    page.evaluate(async (count) => {
      const { emit } = await import('/node_modules/@tauri-apps/api/event.js');
      for (let i = 0; i < count; i++)
        await emit('output-state', {
          model: null,
          models: [],
          revision: 1,
          settings: {
            x: i / 100,
            background: i === count - 1 ? '#ff0000' : '#0000ff',
            composition: {
              items: [{ id: 'flag', kind: 'image', source: 'a'.repeat(32) + '.gif' }],
            },
          },
        });
    }, count);
  await update(1);
  await expect.poll(() => page.evaluate(() => (window as any).assetRequested)).toBe(true);
  await update(20);
  expect(await page.evaluate(() => (window as any).prepareCalls)).toBe(1);
  await page.evaluate(() => (window as any).releaseOutputAsset());
  await expect(page.locator('#stage')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
  await expect
    .poll(() => page.evaluate(() => (window as any).outputCandidate?.settings.x))
    .toBe(0.19);
  expect(await page.evaluate(() => (window as any).prepareCalls)).toBeLessThanOrEqual(2);
  await expect(page.locator('canvas')).toHaveCount(1);
});

test('props-only scenes support dragging, saving, recall, visibility shortcuts and reload', async ({
  page,
}, testInfo) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    const bootstrap = `import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
      window.isTauri = true; mockWindows('main');
      const asset = 'a'.repeat(32) + '.gif';
      let cameraActive = false;
      const bytes = Uint8Array.from('47494638396101000100800000ff00000000ff21f90400050000002c000000000100010000020244010021f90400050000002c00000000010001000002024c01003b'.match(/../g), h => parseInt(h, 16)).buffer;
      mockIPC(async (cmd, args) => {
        if (cmd === 'load_settings') return JSON.parse(localStorage.getItem('scene-test-settings') || 'null');
        if (cmd === 'save_settings') { window.savedSettings = args.settings; localStorage.setItem('scene-test-settings', JSON.stringify(args.settings)); return; }
        if (cmd === 'list_models') return { models: [], directory: '/test/models', errors: [] };
        if (cmd === 'choose_asset') return { id: asset, name: 'Color flag' };
        if (cmd === 'read_asset') return bytes;
        if (cmd === 'plugin:virtual-camera|start' || cmd === 'plugin:virtual-camera|stop') {
          cameraActive = cmd.endsWith('|start');
          window.cameraActions = [...(window.cameraActions || []), cameraActive ? 'start' : 'stop'];
        }
        if (cmd.startsWith('plugin:virtual-camera|')) return { supported: true, installed: true, active: cameraActive, message: 'Test' };
        if (cmd.startsWith('plugin:global-shortcut|')) { window.systemShortcutCalls = [...(window.systemShortcutCalls || []), cmd]; }
      }, { shouldMockEvents: true });\n`;
    await route.fulfill({ response, body: bootstrap + (await response.text()) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '画面', exact: true }).click();
  await page.getByRole('button', { name: '添加图片 / GIF', exact: true }).click();
  await expect(page.locator('#item-name')).toHaveValue('Color flag');
  await expect(page.locator('#empty-state')).toBeHidden();
  await page.mouse.move(480, 360);
  await page.mouse.down();
  await page.mouse.move(600, 440, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => (window as any).savedSettings?.composition.items[0].x))
    .toBeCloseTo(0.1, 2);
  await page.locator('#scene-name').fill('旗帜场景');
  await page.getByRole('button', { name: '保存为新场景', exact: true }).click();
  await expect(page.locator('#saved-scene option')).toHaveCount(2);
  const sceneId = await page.locator('#saved-scene option').last().getAttribute('value');
  await page.locator('#saved-scene').selectOption(sceneId!);
  await page.locator('#item-name').fill('Changed');
  await page.getByRole('button', { name: '切换场景', exact: true }).click();
  await page.locator('#selected-item').selectOption({ label: '1 · Color flag' });
  await expect(page.locator('#item-name')).toHaveValue('Color flag');
  await page.getByRole('checkbox', { name: '显示', exact: true }).uncheck();
  await expect
    .poll(() => page.evaluate(() => (window as any).savedSettings?.composition.items[0].visible))
    .toBe(false);
  await page.getByRole('button', { name: '角色', exact: true }).click();
  await page.getByRole('button', { name: '应用快捷键', exact: true }).click();
  const action = await page
    .locator('#hotkey-action option')
    .evaluateAll(
      (options) =>
        (options as HTMLOptionElement[]).find((option) => option.value.startsWith('item:'))!.value,
    );
  await page.locator('#hotkey-action').selectOption(action);
  await page.locator('#hotkey-binding').fill('Control+Shift+9');
  await page.locator('#save-hotkey').click();
  await page.keyboard.press('Control+Shift+9');
  await expect
    .poll(() => page.evaluate(() => (window as any).savedSettings?.composition.items[0].visible))
    .toBe(true);
  for (const action of [
    'toggle-tracking',
    'calibrate',
    'toggle-mic',
    'toggle-model',
    'toggle-camera',
  ]) {
    await expect(page.locator(`#hotkey-action option[value="${action}"]`)).toHaveCount(1);
  }
  expect(await page.evaluate(() => (window as any).cameraActions ?? [])).not.toContain('start');
  await page.locator('#hotkey-action').selectOption('toggle-model');
  await page.locator('#hotkey-binding').fill('Control+Shift+8');
  await page.locator('#save-hotkey').click();
  await page.keyboard.press('Control+Shift+8');
  await expect
    .poll(() => page.evaluate(() => (window as any).savedSettings?.modelVisible))
    .toBe(false);
  await page.locator('#hotkey-action').selectOption('toggle-camera');
  await page.locator('#hotkey-binding').fill('Control+Shift+7');
  await page.locator('#save-hotkey').click();
  expect(await page.evaluate(() => (window as any).systemShortcutCalls ?? [])).toEqual([]);
  for (const action of ['start', 'stop']) {
    await page.keyboard.press('Control+Shift+7');
    await expect
      .poll(() => page.evaluate(() => (window as any).cameraActions?.at(-1)))
      .toBe(action);
  }
  await page.getByRole('button', { name: '画面', exact: true }).click();
  const overflow = await page
    .locator('.scene-controls')
    .evaluate((panel) => panel.scrollWidth > panel.clientWidth + 1);
  expect(overflow).toBe(false);
  await expect(
    page.getByText('显卡上下文已丢失。请重新加载角色；反复失败时重启应用。', { exact: true }),
  ).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('scene-controls.png') });
  await page.getByRole('button', { name: '接入', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('virtual-camera-controls.png') });
  await page.reload();
  await page.getByRole('button', { name: '画面', exact: true }).click();
  await expect(page.locator('#saved-scene option')).toHaveCount(2);
  await expect(page.locator('#selected-item option')).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).savedSettings?.modelPath ?? '')).toBe('');
});

test('attached dragging follows the pointer and scene recall preserves the live frame while loading fails', async ({
  page,
}) => {
  await page.goto('/?output=1');
  await page.evaluate(async () => {
    const { createStudio } = await import('/src/studio.ts');
    const { mockIPC, mockWindows } = await import('/node_modules/@tauri-apps/api/mocks.js');
    (window as any).isTauri = true;
    mockWindows('main');
    const asset = 'a'.repeat(32) + '.gif';
    const bytes = Uint8Array.from(
      '47494638396101000100800000ff00000000ff21f90400050000002c00000000010001000002024401003b'.match(
        /../g,
      )!,
      (h) => parseInt(h, 16),
    ).buffer;
    const state = ((window as any).sceneTransaction = { requested: false });
    mockIPC(
      async (cmd: string) => {
        if (cmd === 'list_models') return { models: [], directory: '/models', errors: [] };
        if (cmd === 'load_settings')
          return {
            background: '#ff0000',
            zoom: 2,
            rotation: 90,
            composition: { items: [{ id: 'flag', kind: 'image', source: asset, attach: 'model' }] },
            scenes: [
              {
                id: 'broken',
                name: 'Broken',
                modelPath: '/missing/model.model3.json',
                background: '#0000ff',
                placement: { x: 0, y: 0, zoom: 1, rotation: 0 },
                composition: { items: [] },
              },
            ],
          };
        if (cmd === 'read_asset') return bytes;
        if (cmd === 'load_model') {
          state.requested = true;
          await new Promise<void>((resolve) => {
            state.release = resolve;
          });
          throw new Error('missing scene model');
        }
        if (cmd.startsWith('plugin:virtual-camera|'))
          return { supported: false, installed: false, active: false, message: 'Test' };
      },
      { shouldMockEvents: true },
    );
    state.container = document.createElement('div');
    state.container.style.cssText = 'position:fixed;width:600px;height:300px;left:0;top:0';
    document.body.append(state.container);
    state.studio = createStudio(state.container, document.createElement('video'), (view) => {
      state.view = view;
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).sceneTransaction.view?.ready))
    .toBe(true);
  const delta = await page.evaluate(() => {
    const state = (window as any).sceneTransaction;
    state.studio.actions.selectItem('flag');
    state.studio.actions.pan(0.1, 0);
    const item = state.studio.snapshot().settings.composition.items[0];
    return { x: item.x, y: item.y };
  });
  expect(delta.x).toBeCloseTo(0, 5);
  expect(delta.y).toBeCloseTo(-0.1, 5);
  await page.evaluate(() => {
    const state = (window as any).sceneTransaction;
    state.canvas = state.container.querySelector('canvas');
    state.pending = state.studio.actions.recallScene('broken').catch((error: Error) => {
      state.error = error.message;
    });
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).sceneTransaction.requested))
    .toBe(true);
  expect(
    await page.evaluate(() => {
      const state = (window as any).sceneTransaction;
      return {
        background: state.container.style.backgroundColor,
        sameCanvas: state.canvas === state.container.querySelector('canvas'),
        items: state.view.settings.composition.items.length,
      };
    }),
  ).toEqual({ background: 'rgb(255, 0, 0)', sameCanvas: true, items: 1 });
  await page.evaluate(async () => {
    const state = (window as any).sceneTransaction;
    state.release();
    await state.pending;
  });
  expect(
    await page.evaluate(() => {
      const state = (window as any).sceneTransaction;
      return {
        error: state.error,
        background: state.container.style.backgroundColor,
        busy: state.view.sceneBusy,
        sameCanvas: state.canvas === state.container.querySelector('canvas'),
      };
    }),
  ).toEqual({
    error: 'missing scene model',
    background: 'rgb(255, 0, 0)',
    busy: false,
    sameCanvas: true,
  });
  await page.evaluate(() => (window as any).sceneTransaction.studio.destroy());
});

test('application shortcuts preserve native controls and release on blur', async ({ page }) => {
  await page.goto('/?output=1');
  await page.evaluate(async () => {
    const { mockIPC } = await import('/node_modules/@tauri-apps/api/mocks.js');
    const { Hotkeys } = await import('/src/hotkeys.ts');
    (window as any).isTauri = true;
    const calls: [string, boolean][] = [];
    const nativeCalls: string[] = [];
    mockIPC((cmd: string) => {
      if (cmd.startsWith('plugin:global-shortcut|')) nativeCalls.push(cmd);
    });
    const hotkeys = new Hotkeys(
      (id: string, pressed: boolean) => calls.push([id, pressed]),
      (error: string) => {
        throw new Error(error);
      },
    );
    await hotkeys.set({ space: 'Space', shifted: 'Shift+A' });
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:white;z-index:100';
    host.innerHTML =
      '<button id="native-button">Native button</button><input id="native-input"><div id="editable" contenteditable="true">edit</div><div id="blank" style="height:100px">stage</div>';
    host.querySelector('button')!.addEventListener('click', () => {
      (window as any).buttonClicks = ((window as any).buttonClicks ?? 0) + 1;
    });
    document.body.append(host);
    Object.assign(window, { hotkeyTest: { hotkeys, calls, nativeCalls } });
  });
  await page.locator('#blank').click();
  await page.keyboard.down('Space');
  await page.keyboard.down('Space');
  await expect
    .poll(() => page.evaluate(() => (window as any).hotkeyTest.calls))
    .toEqual([['space', true]]);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect
    .poll(() => page.evaluate(() => (window as any).hotkeyTest.calls))
    .toEqual([
      ['space', true],
      ['space', false],
    ]);
  await page.keyboard.up('Space');
  await page.locator('#native-input').fill('hello');
  await page.keyboard.press('Space');
  await expect(page.locator('#native-input')).toHaveValue('hello ');
  await page.locator('#editable').fill('edit');
  await page.keyboard.press('Space');
  await expect(page.locator('#editable')).toHaveText('edit ');
  await page.locator('#native-button').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => (window as any).buttonClicks)).toBe(1);
  expect(await page.evaluate(() => (window as any).hotkeyTest.calls)).toHaveLength(2);
  await page.locator('#blank').click();
  await page.keyboard.press('Shift+A');
  expect(await page.evaluate(() => (window as any).hotkeyTest.calls.slice(-2))).toEqual([
    ['shifted', true],
    ['shifted', false],
  ]);
  expect(await page.evaluate(() => (window as any).hotkeyTest.nativeCalls)).toEqual([]);
  await page.evaluate(() => (window as any).hotkeyTest.hotkeys.destroy());
});

test('bundled licenses are readable under desktop CSP without leaving the stage', async ({
  page,
}, testInfo) => {
  await serveProduction(page, '**/');
  await page.goto('/');
  await page.getByRole('button', { name: '接入', exact: true }).click();
  await page.getByRole('button', { name: '开源与第三方许可', exact: true }).click();
  const text = page.getByLabel('许可正文');
  await expect(text).toContainText('VTubeLeaf resource and bundled-code notices');
  await page.getByLabel('许可文件').selectOption('/licenses/npm.txt');
  await expect(text).toContainText('Permission is hereby granted');
  await page.getByLabel('许可文件').selectOption('/licenses/rust.html');
  await expect(text).toContainText('Mozilla Public License');
  await expect(text).toContainText('2.0');
  await expect(text).toContainText('https://crates.io/crates/');
  await page.getByLabel('许可文件').selectOption('/licenses/vtubeleaf.txt');
  await expect(text).toContainText('MIT License');
  await expect(text).toContainText('Copyright (c) 2026 moonrailgun');
  await expect(text).toContainText('Permission is hereby granted');
  await expect(page.locator('#stage canvas')).toBeVisible();
  await text.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('licenses.png') });
  await page.route('**/runtime/licenses/Core/LICENSE.md', (route) =>
    route.fulfill({ status: 404, body: 'missing' }),
  );
  await page.getByLabel('许可文件').selectOption('/runtime/licenses/Core/LICENSE.md');
  await expect(text).toHaveText('许可文件未包含在当前构建中。');
});

test('focused output forwards application shortcuts and releases held actions without rebinding for display changes', async ({
  page,
}) => {
  await page.route('**/src/main.tsx*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `import React from '/node_modules/.vite/deps/react.js';
        import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
        import { mockIPC, mockWindows } from '/node_modules/@tauri-apps/api/mocks.js';
        import { Output } from '/src/output.tsx';
        import '/src/style.css';
        window.isTauri = true; mockWindows('output');
        const state = window.outputKeys = { events: [] };
        mockIPC(() => {}, { shouldMockEvents: true });
        const invoke = window.__TAURI_INTERNALS__.invoke;
        window.__TAURI_INTERNALS__.invoke = async (cmd, args, options) => {
          if (cmd === 'plugin:event|emit_to') {
            if (args.event === 'output-ready') state.ready = true;
            if (args.event === 'output-hotkey') {
              if (state.blockPress && args.payload.pressed) {
                state.blockPress = false;
                await new Promise(resolve => { state.release = resolve; });
              }
              state.events.push(args.payload);
            }
          }
          return invoke(cmd, args, options);
        };
        state.root = ReactDOM.createRoot(document.getElementById('app'));
        state.root.render(React.createElement(Output));`,
    });
  });
  await page.goto('/?output=1');
  await expect.poll(() => page.evaluate(() => (window as any).outputKeys?.ready)).toBe(true);
  const update = (binding: string, background = '#000000') =>
    page.evaluate(
      async ({ binding, background }) => {
        const { emit } = await import('/node_modules/@tauri-apps/api/event.js');
        await emit('output-state', {
          model: null,
          models: [],
          revision: 0,
          settings: { background, hotkeys: { 'clear-expressions': binding } },
        });
      },
      { binding, background },
    );
  const expected: { action: string; pressed: boolean }[] = [];
  const expectEvents = async (...presses: boolean[]) => {
    expected.push(...presses.map((pressed) => ({ action: 'clear-expressions', pressed })));
    await expect
      .poll(() => page.evaluate(() => (window as any).outputKeys.events))
      .toEqual(expected);
  };
  await update('Space');
  await page.evaluate(() => {
    (window as any).outputKeys.blockPress = true;
  });
  await page.keyboard.press('Space');
  await expect
    .poll(() => page.evaluate(() => typeof (window as any).outputKeys.release))
    .toBe('function');
  await expectEvents();
  await page.evaluate(() => (window as any).outputKeys.release());
  await expectEvents(true, false);
  await page.keyboard.down('Space');
  await expectEvents(true);
  await update('Space', '#ff0000');
  await expect(page.locator('#stage')).toHaveCSS('background-color', 'rgb(255, 0, 0)');
  await expectEvents();
  await page.keyboard.up('Space');
  await expectEvents(false);
  await page.keyboard.down('Space');
  await expectEvents(true);
  await update('KeyA');
  await expectEvents(false);
  await page.keyboard.up('Space');
  await page.keyboard.press('Space');
  await expectEvents();
  await page.keyboard.down('a');
  await expectEvents(true);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expectEvents(false);
  await page.keyboard.up('a');
  await page.keyboard.down('a');
  await expectEvents(true);
  await page.evaluate(() => (window as any).outputKeys.root.unmount());
  await expectEvents(false);
  await page.keyboard.up('a');

  await page.evaluate(async () => {
    const { mockIPC, mockWindows } = await import('/node_modules/@tauri-apps/api/mocks.js');
    const { createStudio } = await import('/src/studio.ts');
    mockWindows('main');
    const state = (window as any).outputKeys;
    mockIPC(
      (cmd: string) => {
        if (cmd === 'load_settings') return { globalHotkeys: { 'toggle-model': 'Space' } };
        if (cmd === 'list_models') return { models: [], directory: '/models', errors: [] };
        if (cmd.startsWith('plugin:virtual-camera|'))
          return { supported: false, installed: false, active: false, message: 'Test' };
      },
      { shouldMockEvents: true },
    );
    const invoke = (window as any).__TAURI_INTERNALS__.invoke;
    (window as any).__TAURI_INTERNALS__.invoke = (cmd: string, args: any, options: any) => {
      if (cmd === 'plugin:event|emit_to' && args.event === 'output-state')
        state.synced = structuredClone(args.payload.settings);
      return invoke(cmd, args, options);
    };
    const container = document.getElementById('app')!;
    state.studio = createStudio(container, document.createElement('video'), (view) => {
      state.view = view;
    });
  });
  await expect.poll(() => page.evaluate(() => (window as any).outputKeys.view?.ready)).toBe(true);
  await page.evaluate(async () => {
    const { emit } = await import('/node_modules/@tauri-apps/api/event.js');
    const state = (window as any).outputKeys;
    await emit('output-ready');
    await state.studio.actions.applyHotkey('toggle-model', 'KeyK');
    await emit('output-hotkey', { action: 'toggle-model', pressed: true });
    await emit('output-hotkey', { action: 'toggle-model', pressed: true });
    await emit('output-hotkey', { action: 'toggle-model', pressed: 'false' });
    await emit('output-hotkey', { action: 'toggle-mic', pressed: true });
  });
  expect(await page.evaluate(() => (window as any).outputKeys.synced.globalHotkeys)).toEqual({
    'toggle-model': 'KeyK',
  });
  expect(await page.evaluate(() => (window as any).outputKeys.view.settings.modelVisible)).toBe(
    false,
  );
  expect(await page.evaluate(() => (window as any).outputKeys.view.micActive)).toBe(false);
  await page.evaluate(async () => {
    const { emit } = await import('/node_modules/@tauri-apps/api/event.js');
    await emit('output-hotkey', { action: 'toggle-model', pressed: false });
    await emit('output-hotkey', { action: 'toggle-model', pressed: true });
    await emit('output-closed');
    await emit('output-hotkey', { action: 'toggle-model', pressed: true });
  });
  expect(await page.evaluate(() => (window as any).outputKeys.view.settings.modelVisible)).toBe(
    true,
  );
  await page.evaluate(() => (window as any).outputKeys.studio.destroy());
});
