import { t } from './i18n.ts';
import { isFace, type Face, type FaceKey } from './state.ts';

export function sampleCalibration(
  samples: { at: number; face: Face }[],
  mode: 'neutral' | 'eyes',
): Face {
  if (samples.length < 12 || samples.at(-1)!.at - samples[0].at < 1000)
    throw new Error(t('calibration.tooFewSamples'));
  if (
    samples.some(
      (s, i) => !isFace(s.face) || !Number.isFinite(s.at) || (i > 0 && s.at <= samples[i - 1].at),
    )
  )
    throw new Error(t('calibration.invalidSamples'));
  for (const key of ['yaw', 'pitch', 'roll'] as const) {
    const angles = samples.map((s) => ((s.face[key] - samples[0].face[key] + 540) % 360) - 180);
    if (Math.max(...angles) - Math.min(...angles) > 6) throw new Error(t('calibration.headMoved'));
  }
  if (
    samples.some(({ face: f }) =>
      mode === 'eyes' ? f.eyeLeft > 0.4 || f.eyeRight > 0.4 : f.eyeLeft < 0.4 || f.eyeRight < 0.4,
    )
  )
    throw new Error(t(mode === 'eyes' ? 'calibration.keepEyesClosed' : 'calibration.keepEyesOpen'));
  const keys = (Object.keys(samples[0].face) as FaceKey[]).filter((key) =>
    samples.every((s) => Number.isFinite(s.face[key])),
  );
  return Object.fromEntries(
    keys.map((key) => {
      const angular = key === 'yaw' || key === 'pitch' || key === 'roll';
      const first = samples[0].face[key]!;
      const mean =
        samples.reduce(
          (sum, s) => sum + (angular ? ((s.face[key]! - first + 540) % 360) - 180 : s.face[key]!),
          0,
        ) / samples.length;
      return [key, angular ? ((first + mean + 540) % 360) - 180 : mean];
    }),
  ) as Face;
}
