import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAudioFrame,
  AudioLipSync,
  mfcc,
  vowels,
  type VoiceTemplates,
} from '../src/lipsync.ts';

const sampleRate = 16_000;
const silence = () => new Float32Array(256).fill(-Infinity);
const voiced = () => Float32Array.from({ length: 128 }, (_, i) => (i % 2 ? -0.2 : 0.2));
const spectrum = (formants: number[]) =>
  Float32Array.from({ length: 256 }, (_, bin) =>
    Math.max(-100, ...formants.map((formant) => -18 - Math.abs(bin - formant) * 2)),
  );

test('audio analysis gates silence and keeps every output finite and clamped', () => {
  assert.deepEqual(analyzeAudioFrame(new Float32Array(128), silence(), sampleRate, 2, 0.01, {}), {
    voiceVolume: 0,
    voiceA: 0,
    voiceI: 0,
    voiceU: 0,
    voiceE: 0,
    voiceO: 0,
  });

  const frame = analyzeAudioFrame(
    Float32Array.of(Infinity, NaN, 2, -2),
    Float32Array.of(NaN, Infinity, -Infinity, -20),
    sampleRate,
    100,
    -1,
    {},
  );
  for (const value of Object.values(frame)) {
    assert.equal(Number.isFinite(value), true);
    assert.ok(value >= 0 && value <= 1);
  }
  assert.equal(frame.voiceVolume, 1);

  assert.deepEqual(
    analyzeAudioFrame(
      Float32Array.of(0.005, -0.005),
      spectrum([24, 48, 78]),
      sampleRate,
      1,
      0.01,
      {},
    ),
    {
      voiceVolume: 0,
      voiceA: 0,
      voiceI: 0,
      voiceU: 0,
      voiceE: 0,
      voiceO: 0,
    },
  );
});

test('MFCC templates distinguish matching vowel spectra and reject malformed calibration', () => {
  const spectra = {
    A: spectrum([24, 48, 78]),
    I: spectrum([12, 58, 92]),
    U: spectrum([10, 28, 50]),
    E: spectrum([18, 62, 86]),
    O: spectrum([16, 36, 60]),
  };
  const templates = Object.fromEntries(
    vowels.map((vowel) => [vowel, mfcc(spectra[vowel], sampleRate)]),
  ) as VoiceTemplates;
  assert.deepEqual(
    vowels.map((vowel) => templates[vowel]?.length),
    [13, 13, 13, 13, 13],
  );
  assert.equal(new Set(vowels.map((vowel) => templates[vowel]?.join(','))).size, 5);

  for (const vowel of vowels) {
    const frame = analyzeAudioFrame(voiced(), spectra[vowel], sampleRate, 1, 0.01, templates);
    const weights = vowels.map((candidate) => frame[`voice${candidate}`]);
    assert.equal(vowels[weights.indexOf(Math.max(...weights))], vowel);
  }

  const malformed = { ...templates, O: [...templates.O!, NaN] };
  const rejected = analyzeAudioFrame(voiced(), spectra.A, sampleRate, 1, 0.01, malformed);
  assert.deepEqual(
    vowels.map((vowel) => rejected[`voice${vowel}`]),
    [0, 0, 0, 0, 0],
  );
});

test('pausing cancels calibration and starting again resumes audio reads', async () => {
  class FakeTrack extends EventTarget {
    label = 'Test microphone';
    stop() {}
  }

  class FakeNode {
    connect<T>(destination: T): T {
      return destination;
    }
    disconnect() {}
  }

  class FakeAnalyser extends FakeNode {
    fftSize = 2048;
    smoothingTimeConstant = 0;
    get frequencyBinCount() {
      return this.fftSize / 2;
    }
    getFloatTimeDomainData(data: Float32Array) {
      data.fill(0.1);
    }
    getFloatFrequencyData(data: Float32Array) {
      data.fill(-20);
    }
  }

  const track = new FakeTrack();
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  };
  const contexts: Array<{ state: string }> = [];
  class FakeAudioContext {
    state = 'running';
    sampleRate = sampleRate;
    destination = new FakeNode();
    constructor() {
      contexts.push(this);
    }
    createMediaStreamSource() {
      return new FakeNode();
    }
    createAnalyser() {
      return new FakeAnalyser();
    }
    createGain() {
      return Object.assign(new FakeNode(), { gain: { value: 1 } });
    }
    async resume() {}
    async close() {
      this.state = 'closed';
    }
  }

  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const audioContextDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'AudioContext');
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => stream } },
  });
  Object.defineProperty(globalThis, 'AudioContext', {
    configurable: true,
    value: FakeAudioContext,
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: globalThis });

  try {
    const lipSync = new AudioLipSync();
    await lipSync.start('test-device');
    const calibration = lipSync.calibrate();
    lipSync.pause(true);
    await assert.rejects(calibration, /暂停.*取消/);
    assert.equal(lipSync.read(1, 0, {}).voiceVolume, 0);

    await lipSync.stop();
    await lipSync.start('test-device');
    assert.ok(lipSync.read(1, 0, {}).voiceVolume > 0);
    await lipSync.stop();
    assert.equal(
      contexts.every((context) => context.state === 'closed'),
      true,
    );
  } finally {
    for (const [name, descriptor] of [
      ['navigator', navigatorDescriptor],
      ['AudioContext', audioContextDescriptor],
      ['window', windowDescriptor],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  }
});
