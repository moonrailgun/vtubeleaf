import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeAudioFrame,
  AudioLipSync,
  mfcc,
  vowels,
  type VoiceTemplates,
} from '../src/lipsync.ts';
import { setLang } from '../src/i18n.ts';

setLang('zh');

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

test('built-in vowels work without calibration across common microphone sample rates', () => {
  // Independent harmonic spectra with shifted formants, rather than the smooth default envelopes.
  const peaks = {
    A: [
      [680, 0],
      [1120, -6],
      [2700, -7],
      [2940, -8],
      [3320, -22],
    ],
    I: [
      [300, 0],
      [1900, -15],
      [2820, -18],
      [3290, -20],
      [3600, -30],
    ],
    U: [
      [340, 0],
      [620, -20],
      [2710, -17],
      [2950, -14],
      [3350, -26],
    ],
    E: [
      [420, 0],
      [1730, -14],
      [2630, -12],
      [3240, -14],
      [3600, -20],
    ],
    O: [
      [410, 0],
      [820, -10],
      [2650, -12],
      [2840, -12],
      [3080, -26],
    ],
  };
  for (const rate of [16_000, 44_100, 48_000]) {
    for (const pitch of [100, 140, 180, 220, 260]) {
      for (const vowel of vowels) {
        const input = Float32Array.from({ length: 1024 }, (_, bin) => {
          const hz = (bin * rate) / 2048;
          const envelope = Math.max(
            ...peaks[vowel].map(([center, db], index) => {
              const width = index === 0 ? (vowel === 'I' || vowel === 'U' ? 20 : 40) : 50;
              return -20 + db - 20 * Math.log10(1 + Math.abs(hz - center) / width);
            }),
          );
          const harmonicDistance = hz - Math.round(hz / pitch) * pitch;
          return Math.max(-110, envelope - 2 * (harmonicDistance / (rate / 2048)) ** 2);
        });
        const frame = analyzeAudioFrame(voiced(), input, rate, 1, 0.01, {});
        const weights = vowels.map((candidate) => frame[`voice${candidate}`]);
        assert.equal(
          vowels[weights.indexOf(Math.max(...weights))],
          vowel,
          `${rate} Hz, ${pitch} Hz, ${vowel}`,
        );
        assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-6);
      }
    }
  }
});

test('personal vowel calibration overrides defaults one vowel at a time and can be replaced', () => {
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

  const personal = { A: templates.I!, O: [NaN] };
  const saved = structuredClone(personal);
  const customized = analyzeAudioFrame(voiced(), spectra.I, sampleRate, 1, 0.01, personal);
  assert.ok(customized.voiceA > 0.99);
  assert.deepEqual(personal, saved);

  const recalibrated = analyzeAudioFrame(voiced(), spectra.U, sampleRate, 1, 0.01, {
    A: templates.U!,
  });
  assert.ok(recalibrated.voiceA > 0.99);
  const defaults = analyzeAudioFrame(voiced(), spectra.I, sampleRate, 1, 0.01, {});
  assert.deepEqual(
    analyzeAudioFrame(voiced(), spectra.I, sampleRate, 1, 0.01, { O: [NaN] }),
    defaults,
  );
  assert.notEqual(defaults.voiceA, customized.voiceA);
});

test('mfcc and frame analysis keep the reference outputs', () => {
  // mulberry32 and exact arithmetic only, so every platform builds the same inputs.
  let seed = 1;
  const random = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
  const odd = [NaN, Infinity, -Infinity];
  const noise = (bins: number) =>
    Float32Array.from({ length: bins }, () =>
      random() < 0.03 ? odd[Math.floor(random() * 3)] : random() * 200 - 170,
    );
  const voice = (rate: number, bins: number) => {
    const pitch = 80 + random() * 240;
    const formants = [250 + random() * 650, 600 + random() * 1900, 2000 + random() * 1500];
    return Float32Array.from({ length: bins }, (_, bin) => {
      const hz = (bin * rate) / (2 * bins);
      const harmonic = Math.abs(hz - Math.round(hz / pitch) * pitch) / pitch;
      const envelope = Math.max(
        ...formants.map((formant, index) => -20 - 8 * index - Math.abs(hz - formant) / 40),
      );
      return Math.max(-110, envelope - 40 * harmonic) + random();
    });
  };
  // Expected values are the original implementation's (13fe4df) exact output on arm64. V8's
  // pow/log/cos/sin differ by an ulp between arm64 and x64, so bit equality can't hold in CI.
  const matches = (actual: number[], expected: number[]) => {
    assert.equal(actual.length, expected.length);
    actual.forEach((value, index) =>
      assert.ok(Math.abs(value - expected[index]) <= 1e-12, `${index}: ${value}`),
    );
  };

  for (const rate of [0, -1, NaN, Infinity])
    assert.deepEqual(mfcc(voice(sampleRate, 64), rate), []);
  assert.deepEqual(mfcc([], sampleRate), []);
  assert.deepEqual(mfcc(silence(), sampleRate), []);
  const coefficients = [
    mfcc(voice(48_000, 1024), 48_000),
    mfcc(voice(44_100, 1024), 44_100),
    mfcc(voice(48_000, 2048), 48_000),
    mfcc(noise(256), 16_000),
    mfcc(noise(17), 22_050),
    mfcc(noise(1), 8_000),
  ].flat();
  matches(
    coefficients,
    [
      -0.8726183242727432, 0.4542915140057759, 0.06752440125289978, -0.06416931876470446,
      0.055344648932814364, 0.07363352966750271, 0.006837967992854822, 0.007620560674438192,
      0.05717146844361277, 0.06332963990572825, 0.05129126649921282, 0.05147830865190358,
      0.04826433701070438, -0.8642670184094539, 0.4706825614813686, 0.009456426764249957,
      -0.019302286864897718, 0.11307368704417756, 0.020383007988107528, -0.030841584948392876,
      0.05688489391992139, 0.08205586723082842, 0.03329399054222234, 0.02940703958088449,
      0.045973373590996396, 0.05320004207998788, -0.8597825932005891, 0.4753203937005183,
      0.016288226777819367, -0.06813856693705805, 0.09805350159922394, 0.07981330673372253,
      -0.010467127626583892, 0.007664732507235683, 0.0541744230907421, 0.05016090284049094,
      0.05355605482703877, 0.059512254189516965, 0.04384449149792249, -0.8937098511216337,
      -0.16618868934712333, 0.0829190214203105, 0.2150737627089099, 0.21530689044368315,
      0.14010646868418553, 0.07891333804317918, 0.09618538184289853, 0.010947517538333394,
      -0.03609956922854948, -0.0015755612445629732, 0.08254665741526594, 0.1755746328451031,
      -0.887199355745826, -0.056107405257126486, 0.12591821762345895, -0.15376404330941038,
      0.09119712054154575, 0.23985563952222796, -0.03348855421340165, 0.09123186477205629,
      0.06367311391377917, 0.20346970726821825, 0.20944319570775505, 0.049438077647136265,
      0.05633242152958648, -0.9607689228305228, 0.08006407690254352, 0.08006407690254368,
      0.08006407690254357, 0.08006407690254369, 0.08006407690254365, 0.0800640769025438,
      0.08006407690254355, 0.08006407690254372, 0.08006407690254334, 0.08006407690254357,
      0.0800640769025432, 0.08006407690254355,
    ],
  );

  // Six values per frame: volume, then A I U E O.
  const frames: number[] = [];
  const analyze = (...args: Parameters<typeof analyzeAudioFrame>) =>
    frames.push(...Object.values(analyzeAudioFrame(...args)));
  for (const [rate, bins] of [
    [48_000, 1024],
    [16_000, 256],
  ]) {
    const personal = Object.fromEntries(
      vowels.map((vowel) => [vowel, mfcc(voice(rate, bins), rate)]),
    ) as VoiceTemplates;
    const input = voice(rate, bins);
    const samples = Float32Array.from({ length: 2 * bins }, () => (random() - 0.5) * 0.6);
    analyze(samples, input, rate, 1, 0.01, {});
    analyze(samples, noise(bins), rate, 1, NaN, {});
    // The second size only re-checks the built-ins after the per-size caches switch.
    if (bins === 256) continue;
    analyze(samples, input, rate, 1, 0.01, personal);
    analyze(samples, input, rate, 1, 0.01, { I: personal.I, O: [NaN] });
    analyze(samples, input, rate, 1, 0.01, { A: mfcc(input, rate) });
    analyze(samples, new Float32Array(bins).fill(-Infinity), rate, 4, 0, personal);
    analyze(samples, input, rate, 1, 0.5, personal);
  }
  matches(
    frames,
    [
      0.1719275441699392, 0.201125044389088, 0.1959755619379062, 0.18124482322299254,
      0.21445481399102248, 0.2071997564589907, 0.1719275441699392, 0.19045158621635547,
      0.21791108780463125, 0.20558677707218315, 0.1944300620156475, 0.19162048689118252,
      0.1719275441699392, 0.1687314588557648, 0.23775774486539547, 0.18688603266167628,
      0.2181045985487226, 0.18852016506844074, 0.1719275441699392, 0.1529205572532313,
      0.3886794879914903, 0.1378051124896465, 0.1630555247893558, 0.15753931747627614,
      0.1719275441699392, 0.9999788332160976, 5.19251772830973e-6, 4.8022158908157116e-6,
      5.6821392042880095e-6, 5.489911079094939e-6, 0.6877101766797568, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      0, 0.17535107842179898, 0.20713030874609725, 0.18966019078735935, 0.1816536126391291,
      0.20063562874019844, 0.2209202590872158, 0.17535107842179898, 0.20879358609616408,
      0.1945667499484529, 0.19809512131672755, 0.20287873940469875, 0.19566580323395666,
    ],
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
    assert.equal(lipSync.read(1, 0.2, {}).voiceVolume, 0);
    assert.ok(Math.abs(lipSync.inputVolume(1) - 0.1) < 1e-6);
    assert.ok(Math.abs(lipSync.inputVolume(4) - 0.4) < 1e-6);
    assert.equal(lipSync.inputVolume(20), 1);
    const calibration = lipSync.calibrate();
    lipSync.pause(true);
    await assert.rejects(calibration, /暂停.*取消/);
    assert.equal(lipSync.read(1, 0, {}).voiceVolume, 0);
    assert.equal(lipSync.inputVolume(4), 0);

    await lipSync.stop();
    await lipSync.start('test-device');
    assert.ok(lipSync.read(1, 0, {}).voiceVolume > 0);
    await lipSync.stop();
    assert.equal(lipSync.inputVolume(4), 0);
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
