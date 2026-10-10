import { test, expect } from '@playwright/test';

test('tracking skips VTubeLeaf Camera when it is the system default', async ({ page }) => {
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const trackerModule = '/src/tracker.ts';
    const stateModule = '/src/state.ts';
    const { Tracker } = await import(trackerModule);
    const { defaults } = await import(stateModule);
    const devices = [
      { deviceId: 'output-camera', label: 'VTubeLeaf Camera' },
      { deviceId: 'built-in-camera', label: 'MacBook Pro 相机' },
    ].map((device) => ({
      ...device,
      groupId: '',
      kind: 'videoinput',
      toJSON() {
        return this;
      },
    }));
    const requests: MediaStreamConstraints[] = [];
    const canvas = document.createElement('canvas');
    const stream = canvas.captureStream(1);
    let didOpen!: () => void;
    const opened = new Promise<void>((resolve) => {
      didOpen = resolve;
    });
    Object.defineProperties(navigator.mediaDevices, {
      enumerateDevices: { value: async () => devices, configurable: true },
      getUserMedia: {
        configurable: true,
        value: async (constraints: MediaStreamConstraints) => {
          requests.push(constraints);
          didOpen();
          return stream;
        },
      },
    });
    const video = document.createElement('video');
    let releasePlay!: () => void;
    video.play = () =>
      new Promise<void>((resolve) => {
        releasePlay = resolve;
      });
    const tracker = new Tracker(
      video,
      () => {},
      () => {},
    );
    const started = tracker.start({ ...defaults, upperBody: false });
    await opened;
    await tracker.stop();
    releasePlay?.();
    await started;
    return { requests, stopped: stream.getTracks().every((track) => track.readyState === 'ended') };
  });
  expect(result.requests[0]?.video).toMatchObject({ deviceId: { exact: 'built-in-camera' } });
  expect(result.stopped).toBe(true);
});

// Each landmarker request waits for the test; created ones report when they are closed.
const pendingMediaPipe = `
const mp = window.mp;
const model = (name) => ({
  createFromOptions: () =>
    new Promise((resolve, reject) => {
      mp.created.push(name);
      mp.pending[name] = {
        resolve: () => resolve({ close: () => mp.closed.push(name) }),
        reject: () => reject(new Error(name + ' failed')),
      };
    }),
});
export const FilesetResolver = { forVisionTasks: async () => ({}) };
export const FaceLandmarker = model('face');
export const PoseLandmarker = model('pose');
export const HandLandmarker = model('hand');
`;

test('MediaPipe loads while the camera opens and a stop during start closes late landmarkers', async ({
  page,
}) => {
  await page.route('**/@mediapipe_tasks-vision.js*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: pendingMediaPipe }),
  );
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const { Tracker } = await import('/src/tracker.ts');
    const { defaults } = await import('/src/state.ts');
    const mp = ((window as any).mp = { created: [], closed: [], pending: {} } as any);
    const stream = document.createElement('canvas').captureStream(1);
    let grant!: () => void;
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((resolve) => {
        grant = () => resolve(stream);
      });
    const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
    const tracker = new Tracker(
      document.createElement('video'),
      () => {},
      () => {},
    );
    const started = tracker.start({ ...defaults, upperBody: true, handTracking: true });
    const deadline = performance.now() + 5000;
    while ((mp.created.length < 3 || !grant) && performance.now() < deadline) await wait();
    const createdBeforeCamera = [...mp.created].sort();
    mp.pending.face.resolve();
    mp.pending.pose.resolve();
    await wait();
    await tracker.stop();
    const closedAtStop = [...mp.closed].sort();
    mp.pending.hand.resolve();
    await wait();
    grant();
    return {
      createdBeforeCamera,
      closedAtStop,
      closed: [...mp.closed].sort(),
      started: await started,
      released: stream.getTracks().every((track) => track.readyState === 'ended'),
    };
  });
  expect(result.createdBeforeCamera).toEqual(['face', 'hand', 'pose']);
  expect(result.closedAtStop).toEqual(['face', 'pose']);
  expect(result.closed).toEqual(['face', 'hand', 'pose']);
  expect(result.started).toBe(false);
  expect(result.released).toBe(true);
});

test('a camera failure outranks a model failure and closes landmarkers from before and after it', async ({
  page,
}) => {
  await page.route('**/@mediapipe_tasks-vision.js*', (route) =>
    route.fulfill({ contentType: 'application/javascript', body: pendingMediaPipe }),
  );
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const { Tracker } = await import('/src/tracker.ts');
    const { defaults } = await import('/src/state.ts');
    const mp = ((window as any).mp = { created: [], closed: [], pending: {} } as any);
    let deny!: () => void;
    navigator.mediaDevices.getUserMedia = () =>
      new Promise((_, reject) => {
        deny = () => reject(new DOMException('denied', 'NotAllowedError'));
      });
    const wait = () => new Promise((resolve) => setTimeout(resolve, 10));
    const tracker = new Tracker(
      document.createElement('video'),
      () => {},
      () => {},
    );
    const started = tracker
      .start({ ...defaults, upperBody: true, handTracking: true })
      .then(String, (error: Error) => error.message);
    const deadline = performance.now() + 5000;
    while ((mp.created.length < 3 || !deny) && performance.now() < deadline) await wait();
    mp.pending.face.reject();
    mp.pending.pose.resolve();
    await wait();
    deny();
    const message = await started;
    const closedAfterFailure = [...mp.closed];
    mp.pending.hand.resolve();
    await wait();
    return { message, closedAfterFailure, closed: mp.closed };
  });
  expect(result.message).toContain('摄像头权限被拒绝');
  expect(result.closedAfterFailure).toEqual(['pose']);
  expect(result.closed).toEqual(['pose', 'hand']);
});

test('pose and hand inference take separate ticks and both resume right after a pause', async ({
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
    const tracker: any = new Tracker(
      video,
      () => {},
      () => {},
    );
    Object.assign(tracker, { trackingFps: 30, bodyFps: 10, handFps: 10 });
    let ran: string[] = [];
    tracker.landmarker = {
      detectForVideo: () => ({
        facialTransformationMatrixes: [],
        faceBlendshapes: [],
        faceLandmarks: [],
      }),
      close() {},
    };
    tracker.pose = {
      detectForVideo: () => {
        ran.push('pose');
        return { landmarks: [], worldLandmarks: [] };
      },
      close() {},
    };
    tracker.hand = {
      detectForVideo: () => {
        ran.push('hand');
        return { landmarks: [], worldLandmarks: [], handedness: [] };
      },
      close() {},
    };
    const realNow = performance.now.bind(performance);
    performance.now = () => now;
    const ticks: string[][] = [];
    const tick = () => {
      ran = [];
      tracker.tick(tracker.generation);
      ticks.push(ran);
      now += 1000 / 30;
    };
    try {
      for (let i = 0; i < 30; i++) tick();
      const steady = ticks.splice(0);
      tracker.pause(true);
      tracker.pause(false);
      tick();
      tick();
      return { steady, resumed: ticks };
    } finally {
      performance.now = realNow;
      await tracker.stop();
    }
  });
  expect(result.steady.filter((ran) => ran.length > 1)).toEqual([]);
  expect(result.steady.flat().filter((name) => name === 'pose')).toHaveLength(10);
  expect(result.steady.flat().filter((name) => name === 'hand')).toHaveLength(10);
  expect(result.resumed.map((ran) => ran.length)).toEqual([1, 1]);
  expect(result.resumed.flat().sort()).toEqual(['hand', 'pose']);
});

test('face preview strokes each landmark set as one path and skips hidden frames', async ({
  page,
}) => {
  await page.route('**/@mediapipe_tasks-vision.js*', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
      const mesh = Array.from({ length: 400 }, (_, i) => ({ start: i % 100, end: (i + 1) % 100 }));
      export const FilesetResolver = { forVisionTasks: async () => ({}) };
      export const FaceLandmarker = {
        FACE_LANDMARKS_TESSELATION: mesh,
        FACE_LANDMARKS_CONTOURS: mesh.slice(0, 50),
        createFromOptions: async () => ({ detectForVideo() {}, close() {} }),
      };
      export const HandLandmarker = { HAND_CONNECTIONS: [] };
    `,
    }),
  );
  await page.goto('/?output=1');
  const result = await page.evaluate(async () => {
    const { Tracker } = await import('/src/tracker.ts');
    const { defaults } = await import('/src/state.ts');
    const preview = document.createElement('canvas');
    document.body.append(preview);
    const tracker: any = new Tracker(
      document.createElement('video'),
      () => {},
      () => {},
      preview,
    );
    try {
      await tracker.start({ ...defaults, upperBody: false });
      tracker.stopFrames();
      const context = preview.getContext('2d')!;
      const calls = { stroke: 0, clearRect: 0 };
      for (const name of ['stroke', 'clearRect'] as const) {
        const original = context[name].bind(context) as (...args: unknown[]) => void;
        (context as any)[name] = (...args: unknown[]) => {
          calls[name]++;
          original(...args);
        };
      }
      const drawn = () =>
        context
          .getImageData(0, 0, preview.width, preview.height)
          .data.filter((value, index) => index % 4 === 3 && value > 0).length;
      const face = Array.from({ length: 100 }, (_, i) => ({
        x: 0.5 + 0.3 * Math.cos(i / 16),
        y: 0.5 + 0.3 * Math.sin(i / 16),
        z: 0,
        visibility: 1,
      }));
      tracker.drawPreview(face);
      const shown = { ...calls, drawn: drawn() };
      preview.hidden = true;
      for (let i = 0; i < 3; i++) tracker.drawPreview(face);
      const hidden = { ...calls, drawn: drawn() };
      preview.hidden = false;
      tracker.drawPreview(face);
      return { shown, hidden, again: { ...calls, drawn: drawn() } };
    } finally {
      await tracker.stop();
    }
  });
  // Mesh, contours, landmarks and the (empty) body path: one stroke each, not one per line.
  expect(result.shown.stroke).toBeLessThanOrEqual(5);
  expect(result.shown.drawn).toBeGreaterThan(1000);
  expect(result.hidden).toEqual({ stroke: result.shown.stroke, clearRect: 2, drawn: 0 });
  expect(result.again.stroke).toBe(result.shown.stroke * 2);
  expect(result.again.drawn).toBeGreaterThan(1000);
});
