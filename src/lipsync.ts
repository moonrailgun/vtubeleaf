import { t } from './i18n.ts';

export const vowels = ['A', 'I', 'U', 'E', 'O'] as const;
export type Vowel = (typeof vowels)[number];
export type VoiceTemplates = Partial<Record<Vowel, number[]>>;
export type VoiceFrame = {
  voiceVolume: number;
  voiceA: number;
  voiceI: number;
  voiceU: number;
  voiceE: number;
  voiceO: number;
};

const coefficientCount = 13;
const filterCount = 26;
// Frequency (Hz), bandwidth (Hz), level (dB); tenor values from:
// https://csound.com/docs/manual/MiscFormants.html
const vowelFormants: Record<Vowel, number[][]> = {
  A: [
    [650, 1080, 2650, 2900, 3250],
    [80, 90, 120, 130, 140],
    [0, -6, -7, -8, -22],
  ],
  I: [
    [290, 1870, 2800, 3250, 3540],
    [40, 90, 100, 120, 120],
    [0, -15, -18, -20, -30],
  ],
  U: [
    [350, 600, 2700, 2900, 3300],
    [40, 60, 100, 120, 120],
    [0, -20, -17, -14, -26],
  ],
  E: [
    [400, 1700, 2600, 3200, 3580],
    [70, 80, 100, 120, 120],
    [0, -14, -12, -14, -20],
  ],
  O: [
    [400, 800, 2600, 2800, 3000],
    [70, 80, 100, 130, 135],
    [0, -10, -12, -12, -26],
  ],
};
let builtinCache:
  { sampleRate: number; bins: number; templates: Record<Vowel, number[][]> } | undefined;
let melCache:
  | {
      sampleRate: number;
      bins: number;
      filters: { indices: number[]; weights: number[] }[];
      power: Float64Array;
    }
  | undefined;
const cosines = Array.from({ length: coefficientCount }, (_, coefficient) =>
  Array.from({ length: filterCount }, (_, filter) =>
    Math.cos((Math.PI * coefficient * (filter + 0.5)) / filterCount),
  ),
);
const silentFrame = (): VoiceFrame => ({
  voiceVolume: 0,
  voiceA: 0,
  voiceI: 0,
  voiceU: 0,
  voiceE: 0,
  voiceO: 0,
});
const clamp = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

export function rms(samples: ArrayLike<number>) {
  let sum = 0,
    count = 0;
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    if (Number.isFinite(sample)) {
      sum += sample * sample;
      count++;
    }
  }
  return count ? Math.sqrt(sum / count) : 0;
}

function melFilters(sampleRate: number, bins: number) {
  if (melCache?.sampleRate === sampleRate && melCache.bins === bins) return melCache;
  const toMel = (frequency: number) => 2595 * Math.log10(1 + frequency / 700);
  const fromMel = (mel: number) => 700 * (10 ** (mel / 2595) - 1);
  const maxMel = toMel(sampleRate / 2);
  const edges = Array.from({ length: filterCount + 2 }, (_, index) =>
    fromMel((index * maxMel) / (filterCount + 1)),
  );
  // Neighbouring triangles overlap, so each bin has at most two non-zero weights; keep only those.
  const filters = Array.from({ length: filterCount }, (_, filter) => {
    const low = edges[filter],
      center = edges[filter + 1],
      high = edges[filter + 2];
    const indices: number[] = [],
      weights: number[] = [];
    for (let bin = 0; bin < bins; bin++) {
      const frequency = (bin * sampleRate) / (2 * bins);
      const weight =
        frequency <= low || frequency >= high
          ? 0
          : frequency < center
            ? (frequency - low) / (center - low)
            : (high - frequency) / (high - center);
      if (weight === 0) continue;
      indices.push(bin);
      weights.push(weight);
    }
    return { indices, weights };
  });
  melCache = { sampleRate, bins, filters, power: new Float64Array(bins) };
  return melCache;
}

export function mfcc(spectrum: ArrayLike<number>, sampleRate: number): number[] {
  if (!spectrum.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return [];
  const { filters, power } = melFilters(sampleRate, spectrum.length);
  let total = 0;
  for (let bin = 0; bin < power.length; bin++) {
    const decibels = spectrum[bin];
    power[bin] = Number.isFinite(decibels)
      ? 10 ** (Math.min(20, Math.max(-160, decibels)) / 10)
      : 0;
    total += power[bin];
  }
  if (!total) return [];
  // Zero-weight bins only ever added +0, so skipping them keeps every sum bit-identical.
  const energies = filters.map(({ indices, weights }) => {
    let energy = 0;
    for (let i = 0; i < indices.length; i++) energy += (power[indices[i]] / total) * weights[i];
    return Math.log(Math.max(energy, 1e-12));
  });
  const coefficients = cosines.map((row) =>
    energies.reduce((sum, energy, filter) => sum + energy * row[filter], 0),
  );
  const mean = coefficients.reduce((sum, value) => sum + value, 0) / coefficients.length;
  const scale = Math.hypot(...coefficients.map((value) => value - mean)) || 1;
  return coefficients.map((value) => (value - mean) / scale);
}

function builtinTemplates(sampleRate: number, bins: number): Record<Vowel, number[][]> {
  if (builtinCache?.sampleRate === sampleRate && builtinCache.bins === bins)
    return builtinCache.templates;
  const sinc = (x: number) => (Math.abs(x) < 1e-8 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  // Match the AnalyserNode Blackman window's frequency response around each harmonic.
  // https://www.w3.org/TR/webaudio-1.0/#blackman-window
  const windowPower = (x: number) =>
    (0.42 * sinc(x) + 0.25 * (sinc(x - 1) + sinc(x + 1)) + 0.04 * (sinc(x - 2) + sinc(x + 2))) ** 2;
  // ponytail: a small 80–320 Hz bank; unusual pitches/timbres still need personal calibration.
  const templates = Object.fromEntries(
    vowels.map((vowel) => {
      const [frequencies, bandwidths, levels] = vowelFormants[vowel];
      const bank: number[][] = [];
      for (let pitch = 80; pitch <= 320; pitch += 10) {
        const spectrum = new Float64Array(bins);
        for (let hz = pitch; hz < sampleRate / 2; hz += pitch) {
          const center = (hz * 2 * bins) / sampleRate;
          const power = frequencies.reduce(
            (sum, frequency, index) =>
              sum +
              10 ** (levels[index] / 10) / (1 + ((hz - frequency) / (bandwidths[index] / 2)) ** 2),
            0,
          );
          // Eight bins retain the main lobe and nearby sidelobes without a full synthetic FFT.
          for (
            let bin = Math.max(0, Math.ceil(center - 8));
            bin < Math.min(bins, center + 8);
            bin++
          ) {
            spectrum[bin] += power * windowPower(bin - center);
          }
        }
        bank.push(
          mfcc(
            spectrum.map((power) => 10 * Math.log10(Math.max(power, 1e-12))),
            sampleRate,
          ),
        );
      }
      return [vowel, bank];
    }),
  ) as Record<Vowel, number[][]>;
  builtinCache = { sampleRate, bins, templates };
  return templates;
}

// Fills the frame's vowels; they stay at the silent frame's zeros when the MFCC is unusable.
function vowelWeights(
  coefficients: number[],
  templates: VoiceTemplates,
  sampleRate: number,
  bins: number,
  frame: VoiceFrame,
) {
  if (coefficients.length !== coefficientCount || !coefficients.every(Number.isFinite)) return;
  const defaults = builtinTemplates(sampleRate, bins);
  const difference: number[] = [];
  let total = 0;
  for (const vowel of vowels) {
    const personal = templates[vowel];
    const candidates =
      Array.isArray(personal) &&
      personal.length === coefficientCount &&
      personal.every(Number.isFinite)
        ? [personal]
        : defaults[vowel];
    let distance = Infinity;
    for (const template of candidates) {
      for (let index = 0; index < coefficientCount; index++)
        difference[index] = coefficients[index] - template[index];
      // Math.hypot, not sqrt(sum): engines round it their own way and outputs must stay identical.
      distance = Math.min(distance, Math.hypot(...difference));
    }
    const score = 1 / (distance + 1e-6);
    frame[`voice${vowel}`] = score;
    total += score;
  }
  for (const vowel of vowels) frame[`voice${vowel}`] = clamp(frame[`voice${vowel}`] / total);
}

export function analyzeAudioFrame(
  samples: ArrayLike<number>,
  spectrum: ArrayLike<number>,
  sampleRate: number,
  gain: number,
  noiseGate: number,
  templates: VoiceTemplates,
): VoiceFrame {
  const frame = silentFrame();
  frame.voiceVolume = clamp(rms(samples) * (Number.isFinite(gain) ? Math.max(0, gain) : 0));
  if (frame.voiceVolume <= clamp(noiseGate)) return silentFrame();
  vowelWeights(mfcc(spectrum, sampleRate), templates, sampleRate, spectrum.length, frame);
  return frame;
}

type Calibration = {
  interval: number;
  timeout: number;
  reject: (reason: Error) => void;
};

export class AudioLipSync {
  private fail: (message: string) => void;
  private context?: AudioContext;
  private stream?: MediaStream;
  private source?: MediaStreamAudioSourceNode;
  private analyser?: AnalyserNode;
  private mute?: GainNode;
  private samples = new Float32Array(0);
  private spectrum = new Float32Array(0);
  private generation = 0;
  private paused = false;
  private calibration?: Calibration;
  deviceLabel = '';

  constructor(fail: (message: string) => void = () => {}) {
    this.fail = fail;
  }

  get active() {
    return !!this.analyser;
  }

  inputVolume(gain: number): number {
    return this.paused || !this.active ? 0 : clamp(rms(this.samples) * gain);
  }

  async start(deviceId: string): Promise<void> {
    const stopped = this.stop();
    const generation = this.generation;
    await stopped;
    if (generation !== this.generation) return;
    this.paused = false;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error(t('lipsync.noMicApi'));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
        video: false,
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.stream = stream;
      this.deviceLabel = stream.getAudioTracks()[0]?.label || t('lipsync.micNameUnavailable');
      if (typeof AudioContext === 'undefined') throw new Error(t('lipsync.noAudioApi'));
      this.context = new AudioContext();
      this.source = this.context.createMediaStreamSource(stream);
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.5;
      this.mute = this.context.createGain();
      this.mute.gain.value = 0;
      this.source.connect(this.analyser).connect(this.mute).connect(this.context.destination);
      this.samples = new Float32Array(this.analyser.fftSize);
      this.spectrum = new Float32Array(this.analyser.frequencyBinCount);
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (generation !== this.generation || this.stream !== stream) return;
        void this.stop();
        this.fail(t('lipsync.micDisconnected'));
      });
      await this.context.resume();
      if (generation !== this.generation) return;
    } catch (error) {
      if (generation !== this.generation) return;
      await this.stop();
      const name = error instanceof Error ? error.name : '';
      const messages: Record<string, string> = {
        NotAllowedError: t('lipsync.micDenied'),
        NotFoundError: t('lipsync.micNotFound'),
        NotReadableError: t('lipsync.micBusy'),
        OverconstrainedError: t('lipsync.micGone'),
      };
      if (error instanceof Error && error.message === t('lipsync.noAudioApi')) throw error;
      throw new Error(messages[name] ?? t('lipsync.micFailed'));
    }
  }

  async stop(): Promise<void> {
    ++this.generation;
    const calibration = this.calibration;
    this.calibration = undefined;
    if (calibration) {
      window.clearInterval(calibration.interval);
      window.clearTimeout(calibration.timeout);
      calibration.reject(new Error(t('lipsync.calibrationStopped')));
    }
    const context = this.context;
    this.context = undefined;
    this.source?.disconnect();
    this.source = undefined;
    this.analyser?.disconnect();
    this.analyser = undefined;
    this.mute?.disconnect();
    this.mute = undefined;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = undefined;
    this.samples = new Float32Array(0);
    this.spectrum = new Float32Array(0);
    this.deviceLabel = '';
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }

  pause(paused: boolean): void {
    this.paused = paused;
    if (!paused || !this.calibration) return;
    const calibration = this.calibration;
    this.calibration = undefined;
    window.clearInterval(calibration.interval);
    window.clearTimeout(calibration.timeout);
    calibration.reject(new Error(t('lipsync.calibrationPaused')));
  }

  read(gain: number, noiseGate: number, templates: VoiceTemplates): VoiceFrame {
    if (this.paused || !this.analyser || !this.context) return silentFrame();
    this.analyser.getFloatTimeDomainData(this.samples);
    this.analyser.getFloatFrequencyData(this.spectrum);
    return analyzeAudioFrame(
      this.samples,
      this.spectrum,
      this.context.sampleRate,
      gain,
      noiseGate,
      templates,
    );
  }

  calibrate(): Promise<number[]> {
    if (!this.analyser || !this.context)
      return Promise.reject(new Error(t('lipsync.startMicFirst')));
    if (this.paused) return Promise.reject(new Error(t('lipsync.cannotCalibratePaused')));
    if (this.calibration) return Promise.reject(new Error(t('lipsync.calibrating')));
    const analyser = this.analyser,
      context = this.context,
      frames: number[][] = [];
    return new Promise((resolve, reject) => {
      const sample = () => {
        analyser.getFloatTimeDomainData(this.samples);
        if (rms(this.samples) <= 0.01) return;
        analyser.getFloatFrequencyData(this.spectrum);
        const coefficients = mfcc(this.spectrum, context.sampleRate);
        if (coefficients.length === coefficientCount) frames.push(coefficients);
      };
      const finish = () => {
        if (this.calibration !== calibration) return;
        window.clearInterval(calibration.interval);
        this.calibration = undefined;
        if (!frames.length) {
          reject(new Error(t('lipsync.noSound')));
          return;
        }
        resolve(
          Array.from(
            { length: coefficientCount },
            (_, index) => frames.reduce((sum, frame) => sum + frame[index], 0) / frames.length,
          ),
        );
      };
      const calibration: Calibration = {
        interval: window.setInterval(sample, 50),
        timeout: window.setTimeout(finish, 1000),
        reject,
      };
      this.calibration = calibration;
      sample();
    });
  }
}
