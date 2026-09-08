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

export function mfcc(spectrum: ArrayLike<number>, sampleRate: number): number[] {
  if (!spectrum.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return [];
  const power = Array.from({ length: spectrum.length }, (_, bin) => {
    const decibels = spectrum[bin];
    return Number.isFinite(decibels) ? 10 ** (Math.min(20, Math.max(-160, decibels)) / 10) : 0;
  });
  const total = power.reduce((sum, value) => sum + value, 0);
  if (!total) return [];
  const toMel = (frequency: number) => 2595 * Math.log10(1 + frequency / 700);
  const fromMel = (mel: number) => 700 * (10 ** (mel / 2595) - 1);
  const maxMel = toMel(sampleRate / 2);
  const edges = Array.from({ length: filterCount + 2 }, (_, index) =>
    fromMel((index * maxMel) / (filterCount + 1)),
  );
  const energies = Array.from({ length: filterCount }, (_, filter) => {
    const low = edges[filter],
      center = edges[filter + 1],
      high = edges[filter + 2];
    let energy = 0;
    for (let bin = 0; bin < power.length; bin++) {
      const frequency = (bin * sampleRate) / (2 * power.length);
      const weight =
        frequency <= low || frequency >= high
          ? 0
          : frequency < center
            ? (frequency - low) / (center - low)
            : (high - frequency) / (high - center);
      energy += (power[bin] / total) * weight;
    }
    return Math.log(Math.max(energy, 1e-12));
  });
  const coefficients = Array.from({ length: coefficientCount }, (_, coefficient) =>
    energies.reduce(
      (sum, energy, filter) =>
        sum + energy * Math.cos((Math.PI * coefficient * (filter + 0.5)) / filterCount),
      0,
    ),
  );
  const mean = coefficients.reduce((sum, value) => sum + value, 0) / coefficients.length;
  const scale = Math.hypot(...coefficients.map((value) => value - mean)) || 1;
  return coefficients.map((value) => (value - mean) / scale);
}

function vowelWeights(coefficients: number[], templates: VoiceTemplates) {
  const zero = Object.fromEntries(vowels.map((vowel) => [vowel, 0])) as Record<Vowel, number>;
  if (
    coefficients.length !== coefficientCount ||
    !coefficients.every(Number.isFinite) ||
    !vowels.every(
      (vowel) =>
        Array.isArray(templates[vowel]) &&
        templates[vowel].length === coefficientCount &&
        templates[vowel].every(Number.isFinite),
    )
  )
    return zero;
  const scores = vowels.map((vowel) => {
    const template = templates[vowel]!;
    const distance = Math.hypot(...coefficients.map((value, index) => value - template[index]));
    return 1 / (distance + 1e-6);
  });
  const total = scores.reduce((sum, score) => sum + score, 0);
  return Object.fromEntries(
    vowels.map((vowel, index) => [vowel, clamp(scores[index] / total)]),
  ) as Record<Vowel, number>;
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
  const weights = vowelWeights(mfcc(spectrum, sampleRate), templates);
  for (const vowel of vowels) frame[`voice${vowel}`] = weights[vowel];
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

  async start(deviceId: string): Promise<void> {
    const stopped = this.stop();
    const generation = this.generation;
    await stopped;
    if (generation !== this.generation) return;
    this.paused = false;
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error('此运行环境没有麦克风接口。请使用桌面应用，并检查系统权限。');
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
      this.deviceLabel = stream.getAudioTracks()[0]?.label || '麦克风名称不可用';
      if (typeof AudioContext === 'undefined') throw new Error('此运行环境没有音频分析接口。');
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
        this.fail('麦克风已断开。请重新连接或选择其他设备后开始。');
      });
      await this.context.resume();
      if (generation !== this.generation) return;
    } catch (error) {
      if (generation !== this.generation) return;
      await this.stop();
      const name = error instanceof Error ? error.name : '';
      const messages: Record<string, string> = {
        NotAllowedError:
          '麦克风权限被拒绝。请在系统隐私设置中允许 VTubeLeaf 使用麦克风，然后重试。',
        NotFoundError: '未找到麦克风。请连接设备并刷新列表。',
        NotReadableError: '无法打开麦克风。请关闭正在占用它的应用后重试。',
        OverconstrainedError: '所选麦克风已不可用。请刷新列表并重新选择。',
      };
      if (error instanceof Error && error.message.startsWith('此运行环境')) throw error;
      throw new Error(messages[name] ?? '麦克风启动失败。请检查设备与系统权限。');
    }
  }

  async stop(): Promise<void> {
    ++this.generation;
    const calibration = this.calibration;
    this.calibration = undefined;
    if (calibration) {
      window.clearInterval(calibration.interval);
      window.clearTimeout(calibration.timeout);
      calibration.reject(new Error('麦克风已停止，校准已取消。'));
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
    calibration.reject(new Error('麦克风已暂停，校准已取消。'));
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
    if (!this.analyser || !this.context) return Promise.reject(new Error('请先启动麦克风。'));
    if (this.paused) return Promise.reject(new Error('暂停时无法校准麦克风。'));
    if (this.calibration) return Promise.reject(new Error('麦克风正在校准。'));
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
          reject(new Error('没有检测到声音。请靠近麦克风并清晰发音。'));
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
