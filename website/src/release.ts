export function parseRelease(value: unknown) {
  const release = value as Record<string, unknown> | null;
  if (!release || typeof release.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(release.version)) {
    throw new Error('Expected a stable release version');
  }
  const { version } = release;
  const base = 'https://github.com/moonrailgun/vtubeleaf/releases';
  const expected = {
    version,
    url: `${base}/tag/v${version}`,
    windows: `${base}/download/v${version}/VTubeLeaf_${version}_x64-setup.exe`,
    mac: `${base}/download/v${version}/VTubeLeaf-${version}-macos-universal.dmg`,
  };
  for (const [key, url] of Object.entries(expected)) {
    if (release[key] !== url) throw new Error(`Invalid release manifest field: ${key}`);
  }
  return expected;
}

export async function loadLatestRelease(signal = AbortSignal.timeout(15_000)) {
  const response = await fetch(
    'https://raw.githubusercontent.com/moonrailgun/vtubeleaf/main/website/public/release.json',
    { signal },
  );
  if (!response.ok) throw new Error(`Cannot load release manifest: HTTP ${response.status}`);
  return parseRelease(await response.json());
}
