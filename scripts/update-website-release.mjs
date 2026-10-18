import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function latestMobileRelease(releases) {
  const candidates = releases.filter(
    (release) =>
      release.draft === false &&
      release.prerelease === false &&
      /^mobile-v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(release.tag_name),
  );
  candidates.sort((a, b) => b.tag_name.localeCompare(a.tag_name, 'en', { numeric: true }));
  assert.ok(candidates.length, 'No published stable mobile release');
  return candidates[0];
}

export function createMobileReleaseManifest(latest) {
  latestMobileRelease([latest]);
  const version = latest.tag_name.slice(8);
  const base = 'https://github.com/moonrailgun/vtubeleaf/releases';
  const android = `${base}/download/mobile-v${version}/VTubeLeaf-Phone-${version}-android.apk`;
  assert.ok(
    latest.assets?.some(
      (asset) =>
        asset.name === android.split('/').at(-1) &&
        asset.browser_download_url === android &&
        asset.state === 'uploaded' &&
        typeof asset.size === 'number' &&
        asset.size > 0,
    ),
    'Missing uploaded Android APK',
  );
  return { version, url: `${base}/tag/mobile-v${version}`, android };
}

export function createReleaseManifest(latest) {
  assert.ok(
    latest &&
      latest.draft === false &&
      latest.prerelease === false &&
      /^v\d+\.\d+\.\d+$/.test(latest.tag_name),
    'Expected a published stable release',
  );
  const version = latest.tag_name.slice(1);
  const base = 'https://github.com/moonrailgun/vtubeleaf/releases';
  const manifest = {
    version,
    url: `${base}/tag/v${version}`,
    windows: `${base}/download/v${version}/VTubeLeaf_${version}_x64-setup.exe`,
    mac: `${base}/download/v${version}/VTubeLeaf-${version}-macos-universal.dmg`,
    linux: {
      appimage: `${base}/download/v${version}/VTubeLeaf_${version}_amd64.AppImage`,
      deb: `${base}/download/v${version}/VTubeLeaf_${version}_amd64.deb`,
    },
    openseeface: {
      'windows-x86_64': `${base}/download/v${version}/VTubeLeaf-OpenSeeFace-${version}-windows-x64.zip`,
      'darwin-aarch64': `${base}/download/v${version}/VTubeLeaf-OpenSeeFace-${version}-macos-aarch64.dmg`,
      'darwin-x86_64': `${base}/download/v${version}/VTubeLeaf-OpenSeeFace-${version}-macos-x86_64.dmg`,
      'linux-x86_64': `${base}/download/v${version}/VTubeLeaf-OpenSeeFace-${version}-linux-x86_64.tar.gz`,
    },
  };
  assert.ok(Array.isArray(latest.assets), 'Expected uploaded release assets');
  // Releases published before Linux support must still refresh the website.
  const linuxDownloads = [...Object.values(manifest.linux), manifest.openseeface['linux-x86_64']];
  if (
    !latest.assets.some((asset) =>
      linuxDownloads.some((url) => asset?.name === url.split('/').at(-1)),
    )
  ) {
    delete manifest.linux;
    delete manifest.openseeface['linux-x86_64'];
  }
  for (const url of [
    manifest.windows,
    manifest.mac,
    ...Object.values(manifest.linux || {}),
    ...Object.values(manifest.openseeface),
  ]) {
    assert.ok(
      latest.assets.some(
        (asset) =>
          asset &&
          asset.name === url.split('/').at(-1) &&
          asset.browser_download_url === url &&
          asset.state === 'uploaded' &&
          typeof asset.size === 'number' &&
          asset.size > 0,
      ),
      `Missing uploaded installer: ${url}`,
    );
  }
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const api = (path, body, paginate = false) =>
    JSON.parse(
      execFileSync(
        'gh',
        [
          'api',
          `repos/moonrailgun/vtubeleaf/${path}`,
          ...(paginate ? ['--paginate', '--slurp'] : []),
          ...(body ? ['--method', 'PUT', '--input', '-'] : []),
        ],
        { encoding: 'utf8', input: body && JSON.stringify(body) },
      ),
    );
  // Read GitHub's current latest release, so rerunning an older tag cannot roll back the website.
  const mobile = process.argv.includes('--mobile');
  const manifest = mobile
    ? createMobileReleaseManifest(
        latestMobileRelease(api('releases?per_page=100', undefined, true).flat()),
      )
    : createReleaseManifest(api('releases/latest'));
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  if (process.argv.includes('--dry-run')) {
    process.stdout.write(content);
  } else {
    const path = `contents/website/public/${mobile ? 'mobile-release' : 'release'}.json`;
    const file = api(`${path}?ref=main`);
    if (Buffer.from(file.content, 'base64').toString('utf8') !== content) {
      api(path, {
        branch: 'main',
        sha: file.sha,
        message: `chore(website): update ${mobile ? 'mobile ' : ''}downloads to v${manifest.version}`,
        content: Buffer.from(content).toString('base64'),
      });
    }
  }
}
