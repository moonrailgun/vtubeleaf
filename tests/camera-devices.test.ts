import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateCaptureDevices, openTrackingCamera } from '../src/camera-devices.ts';

const camera = (deviceId: string, label: string) =>
  ({ deviceId, label, kind: 'videoinput' }) as MediaDeviceInfo;
const output = camera('output', 'VTubeLeaf Camera');
const physical = camera('physical', 'MacBook Pro 相机');
const other = camera('other', 'OBS Virtual Camera');
const hidden = camera('', '');
const active = () => false;
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

function mockNavigator(t: TestContext, value: unknown) {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  t.after(() => {
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else Reflect.deleteProperty(globalThis, 'navigator');
  });
}

function stream(label: string) {
  let stopped = false;
  const track = {
    label,
    stop() {
      stopped = true;
    },
  };
  return {
    value: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
    stopped: () => stopped,
  };
}

test('tracking selects a usable input and recovers saved output IDs without replacing missing explicit inputs', async (t) => {
  const requests: MediaStreamConstraints[] = [];
  mockNavigator(t, {
    mediaDevices: {
      enumerateDevices: async () => [output, physical, other],
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        requests.push(constraints);
        return stream('MacBook Pro 相机').value;
      },
    },
  });
  for (const [selected, expected] of [
    ['', 'physical'],
    ['output', 'physical'],
    ['other', 'other'],
    ['missing', 'missing'],
  ]) {
    await openTrackingCamera(selected, { width: { ideal: 1280 } }, active);
    assert.deepEqual(requests.at(-1), {
      audio: false,
      video: { width: { ideal: 1280 }, deviceId: { exact: expected } },
    });
  }
});

test('permission discovery enumerates before releasing its temporary stream and never captures on startup', async (t) => {
  let permitted = false;
  let captures = 0;
  const probe = stream(output.label);
  mockNavigator(t, {
    mediaDevices: {
      enumerateDevices: async () => {
        if (permitted) assert.equal(probe.stopped(), false);
        return permitted ? [output, physical] : [hidden];
      },
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        assert.deepEqual(constraints, { audio: false, video: true });
        captures++;
        permitted = true;
        return probe.value;
      },
    },
  });
  assert.deepEqual(await enumerateCaptureDevices(), [hidden]);
  assert.equal(captures, 0);
  assert.deepEqual(await enumerateCaptureDevices(true), [output, physical]);
  assert.equal(captures, 1);
  assert.equal(probe.stopped(), true);
});

test('a hidden default output is released before opening the newly discovered physical camera', async (t) => {
  let permitted = false;
  const probe = stream(output.label);
  const input = stream(physical.label);
  mockNavigator(t, {
    mediaDevices: {
      enumerateDevices: async () => {
        if (permitted) assert.equal(probe.stopped(), false);
        return permitted ? [output, physical] : [hidden];
      },
      getUserMedia: async (constraints: MediaStreamConstraints) => {
        if (!permitted) {
          permitted = true;
          return probe.value;
        }
        assert.equal(probe.stopped(), true);
        assert.deepEqual(constraints.video, { deviceId: { exact: physical.deviceId } });
        return input.value;
      },
    },
  });
  assert.equal(await openTrackingCamera('', {}, active), input.value);
  assert.equal(input.stopped(), false);
});

test('an output-only device list fails without opening a camera', async (t) => {
  mockNavigator(t, {
    mediaDevices: {
      enumerateDevices: async () => [output],
      getUserMedia: async () => assert.fail('must not capture the output'),
    },
  });
  await assert.rejects(openTrackingCamera('', {}, active), { name: 'NotFoundError' });
});

test('late capture and failed discovery both release streams', async (t) => {
  let cancelled = false;
  const late = stream(physical.label);
  mockNavigator(t, {
    mediaDevices: {
      enumerateDevices: async () => [physical],
      getUserMedia: async () => {
        cancelled = true;
        return late.value;
      },
    },
  });
  assert.equal(await openTrackingCamera('', {}, () => cancelled), null);
  assert.equal(late.stopped(), true);

  let permitted = false;
  const probe = stream(output.label);
  mockNavigator(t, {
    mediaDevices: {
      enumerateDevices: async () => {
        if (permitted) throw new Error('enumeration failed');
        return [hidden];
      },
      getUserMedia: async () => {
        permitted = true;
        return probe.value;
      },
    },
  });
  await assert.rejects(openTrackingCamera('', {}, active), /enumeration failed/);
  assert.equal(probe.stopped(), true);
});

test('a device change cannot return the output as a tracking stream or loop indefinitely', async (t) => {
  const streams = [stream(output.label), stream(output.label)];
  let captures = 0;
  mockNavigator(t, {
    mediaDevices: {
      enumerateDevices: async () => [physical],
      getUserMedia: async () => streams[captures++].value,
    },
  });
  await assert.rejects(openTrackingCamera('', {}, active), { name: 'NotFoundError' });
  assert.equal(captures, 2);
  assert.ok(streams.every((value) => value.stopped()));
});

test('closing the studio cancels discovery before capture or releases a late permission stream', async (t) => {
  let cancelled = false;
  mockNavigator(t, {
    mediaDevices: {
      enumerateDevices: async () => {
        cancelled = true;
        return [hidden];
      },
      getUserMedia: async () => assert.fail('must not capture after disposal'),
    },
  });
  await enumerateCaptureDevices(true, () => cancelled);

  cancelled = false;
  const probe = stream(physical.label);
  mockNavigator(t, {
    mediaDevices: {
      enumerateDevices: async () => {
        assert.equal(cancelled, false, 'must not enumerate again after disposal');
        return [hidden];
      },
      getUserMedia: async () => {
        cancelled = true;
        return probe.value;
      },
    },
  });
  await enumerateCaptureDevices(true, () => cancelled);
  assert.equal(probe.stopped(), true);
});
