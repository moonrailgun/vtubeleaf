import { test, expect } from '@playwright/test';

test('built-in vowels recognize harmonic speech through the Web Audio analyser without calibration', async ({
  page,
}) => {
  await page.goto('/?output=1');
  const results = await page.evaluate(async () => {
    const { analyzeAudioFrame, vowels } = await import('/src/lipsync.ts');
    // Synthetic voiced sounds: shifted formants, several pitches, and a real browser FFT.
    const formants = {
      A: [
        [680, 1120, 2700, 2940, 3320],
        [80, 90, 120, 130, 140],
        [0, -6, -7, -8, -22],
      ],
      I: [
        [300, 1900, 2820, 3290, 3600],
        [40, 90, 100, 120, 120],
        [0, -15, -18, -20, -30],
      ],
      U: [
        [340, 620, 2710, 2950, 3350],
        [40, 60, 100, 120, 120],
        [0, -20, -17, -14, -26],
      ],
      E: [
        [420, 1730, 2630, 3240, 3600],
        [70, 80, 100, 120, 120],
        [0, -14, -12, -14, -20],
      ],
      O: [
        [410, 820, 2650, 2840, 3080],
        [70, 80, 100, 130, 135],
        [0, -10, -12, -12, -26],
      ],
    };
    const results = [];
    for (const sampleRate of [16_000, 48_000]) {
      for (const pitch of [110, 180, 187, 220, 223, 270]) {
        for (const vowel of vowels) {
          // Offline rendering exercises the browser DSP without a physical audio output clock.
          const context = new OfflineAudioContext(1, sampleRate / 2, sampleRate);
          const [frequencies, widths, levels] = formants[vowel];
          const harmonics = new Float32Array(Math.floor(sampleRate / 2 / pitch));
          for (let n = 1; n < harmonics.length; n++) {
            harmonics[n] = Math.sqrt(
              frequencies.reduce(
                (sum, frequency, i) =>
                  sum +
                  10 ** (levels[i] / 10) / (1 + ((n * pitch - frequency) / (widths[i] / 2)) ** 2),
                0,
              ),
            );
          }
          const oscillator = context.createOscillator();
          oscillator.setPeriodicWave(
            context.createPeriodicWave(new Float32Array(harmonics.length), harmonics),
          );
          oscillator.frequency.value = pitch;
          const analyser = context.createAnalyser();
          analyser.fftSize = 2048;
          analyser.smoothingTimeConstant = 0.5;
          oscillator.connect(analyser).connect(context.destination);
          oscillator.start();
          const paused = context.suspend(0.25);
          const rendered = context.startRendering();
          await paused;
          const samples = new Float32Array(analyser.fftSize);
          const spectrum = new Float32Array(analyser.frequencyBinCount);
          analyser.getFloatTimeDomainData(samples);
          analyser.getFloatFrequencyData(spectrum);
          const frame = analyzeAudioFrame(samples, spectrum, sampleRate, 1, 0.01, {});
          const weights = vowels.map((candidate) => frame[`voice${candidate}`]);
          results.push({
            sampleRate,
            pitch,
            vowel,
            detected: vowels[weights.indexOf(Math.max(...weights))],
          });
          await context.resume();
          await rendered;
        }
      }
    }
    return results;
  });
  expect(results.filter(({ vowel, detected }) => vowel !== detected)).toEqual([]);
});
