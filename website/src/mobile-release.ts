export function parseMobileRelease(value: unknown) {
  if (value === null) return null;
  const release = value as Record<string, unknown> | undefined;
  if (!release || typeof release.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(release.version)) {
    throw new Error('Expected a stable mobile release version');
  }
  const { version } = release;
  const base = 'https://github.com/moonrailgun/vtubeleaf/releases';
  const expected = {
    version,
    url: `${base}/tag/mobile-v${version}`,
    android: `${base}/download/mobile-v${version}/VTubeLeaf-Phone-${version}-android.apk`,
  };
  for (const [key, url] of Object.entries(expected)) {
    if (release[key] !== url) throw new Error(`Invalid mobile release manifest field: ${key}`);
  }
  return expected;
}

export async function loadLatestMobileRelease(signal = AbortSignal.timeout(15_000)) {
  const response = await fetch(
    'https://raw.githubusercontent.com/moonrailgun/vtubeleaf/main/website/public/mobile-release.json',
    { signal, cache: 'no-store' },
  );
  if (!response.ok) throw new Error(`Cannot load mobile release manifest: HTTP ${response.status}`);
  return parseMobileRelease(await response.json());
}
