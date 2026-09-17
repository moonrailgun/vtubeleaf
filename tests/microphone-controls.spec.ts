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

test('microphone modes show only relevant controls and meter live input before the noise gate', async ({
  page,
}, testInfo) => {
  await page.goto('/');
  await page.getByRole('button', { name: '麦克风口型', exact: true }).click();
  const mode = page.getByRole('combobox', { name: '口型来源', exact: true });
  const meter = page.getByRole('meter', { name: '输入音量', exact: true });
  const gain = page.getByRole('slider', { name: '麦克风增益', exact: true });
  const calibration = page.locator('[id^="calibrate-voice-"]');
  await expect(mode).toHaveText('仅摄像头');
  await expect(gain).toHaveCount(0);
  await expect(page.locator('#lipSyncBlend, #micNoiseGate')).toHaveCount(0);
  await expect(calibration).toHaveCount(0);
  await expect(meter).toHaveCount(0);

  await mode.click();
  await page.getByRole('option', { name: '声音音量', exact: true }).click();
  await expect(gain).toBeVisible();
  await expect(calibration).toHaveCount(0);
  await expect(meter).toHaveAttribute('value', '0');
  const gate = page.getByRole('slider', { name: '噪声门限', exact: true });
  await gate.focus();
  await page.keyboard.press('End');
  await page.evaluate(async () => {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = 0.04;
    const destination = context.createMediaStreamDestination();
    oscillator.connect(gain).connect(destination);
    oscillator.start();
    await context.resume();
    (window as any).micTest = { context, oscillator, gain };
    navigator.mediaDevices.getUserMedia = async () => destination.stream;
  });
  await page.locator('#mic-toggle').click();
  const level = () => meter.evaluate((element: HTMLMeterElement) => element.value);
  // A 0.04 sine wave at the default 4x gain is ~0.113, below the 0.2 noise gate.
  await expect.poll(level).toBeGreaterThan(0.1);
  await expect.poll(level).toBeLessThan(0.13);
  await gain.focus();
  await page.keyboard.press('End');
  await expect.poll(level).toBeGreaterThan(0.5);
  await expect.poll(level).toBeLessThan(0.6);
  await meter.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('microphone-volume.png') });

  await mode.click();
  await page.getByRole('option', { name: '元音识别', exact: true }).click();
  await expect(calibration).toHaveCount(0);
  await expect(page.getByText('已内置通用元音模板', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '个人元音校准（可选）', exact: true }).click();
  await expect(calibration).toHaveCount(5);
  const calibrateA = page.locator('#calibrate-voice-A');
  const resetCalibration = page.getByRole('button', { name: '恢复内置模板', exact: true });
  await expect(calibrateA).toBeEnabled();
  await expect(resetCalibration).toBeDisabled();
  const savedTemplates = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem('vtubeleaf-preview')!).voiceTemplates);
  await calibrateA.click();
  await expect(calibrateA).toHaveText('A ✓');
  await expect(resetCalibration).toBeEnabled();
  const firstCalibration = await savedTemplates();
  expect(Object.keys(firstCalibration)).toEqual(['A']);
  expect(firstCalibration.A).toHaveLength(13);
  await page.evaluate(() => ((window as any).micTest.oscillator.frequency.value = 880));
  await calibrateA.click();
  await expect(calibrateA).toHaveText('A ✓');
  expect((await savedTemplates()).A).not.toEqual(firstCalibration.A);
  await calibrateA.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('microphone-vowels.png') });
  await mode.click();
  await page.getByRole('option', { name: '仅摄像头', exact: true }).click();
  await expect(gain).toHaveCount(0);
  await expect(page.locator('#lipSyncBlend, #micNoiseGate')).toHaveCount(0);
  await expect(calibration).toHaveCount(0);
  await expect(meter).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('microphone-camera.png') });

  await mode.click();
  await page.getByRole('option', { name: '声音音量', exact: true }).click();
  await page.evaluate(() => ((window as any).micTest.gain.gain.value = 0));
  await expect.poll(level).toBe(0);
  await page.evaluate(() => ((window as any).micTest.gain.gain.value = 0.04));
  await expect.poll(level).toBeGreaterThan(0.5);
  await page.locator('#mic-toggle').click();
  await expect(meter).toHaveAttribute('value', '0');
  await page.evaluate(async () => {
    const { oscillator, context } = (window as any).micTest;
    oscillator.stop();
    await context.close();
  });

  await page.reload();
  await page.getByRole('button', { name: '麦克风口型', exact: true }).click();
  await mode.click();
  await page.getByRole('option', { name: '元音识别', exact: true }).click();
  await page.getByRole('button', { name: '个人元音校准（可选）', exact: true }).click();
  await expect(calibrateA).toHaveText('A ✓');
  await resetCalibration.click();
  await expect(calibrateA).toHaveText('A');
  await expect(resetCalibration).toBeDisabled();
  await expect.poll(savedTemplates).toEqual({});
});
