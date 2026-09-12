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
