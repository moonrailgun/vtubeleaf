import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

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
  };
  assert.ok(Array.isArray(latest.assets), 'Expected uploaded release assets');
  for (const url of [manifest.windows, manifest.mac]) {
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
  const api = (path, body) =>
    JSON.parse(
      execFileSync(
        'gh',
        [
          'api',
          `repos/moonrailgun/vtubeleaf/${path}`,
          ...(body ? ['--method', 'PUT', '--input', '-'] : []),
        ],
        { encoding: 'utf8', input: body && JSON.stringify(body) },
      ),
    );
  // Read GitHub's current latest release, so rerunning an older tag cannot roll back the website.
  const manifest = createReleaseManifest(api('releases/latest'));
  const content = `${JSON.stringify(manifest, null, 2)}\n`;
  if (process.argv.includes('--dry-run')) {
    process.stdout.write(content);
  } else {
    const path = 'contents/website/public/release.json';
    const file = api(`${path}?ref=main`);
    if (Buffer.from(file.content, 'base64').toString('utf8') !== content) {
      api(path, {
        branch: 'main',
        sha: file.sha,
        message: `chore(website): update downloads to v${manifest.version}`,
        content: Buffer.from(content).toString('base64'),
      });
    }
  }
}
