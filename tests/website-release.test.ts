import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReleaseManifest } from '../scripts/update-website-release.mjs';

test('website manifest infers verified stable release downloads and rejects incomplete releases', () => {
  const base = 'https://github.com/moonrailgun/vtubeleaf/releases';
  const release = {
    tag_name: 'v1.2.3',
    draft: false,
    prerelease: false,
    assets: ['VTubeLeaf_1.2.3_x64-setup.exe', 'VTubeLeaf-1.2.3-macos-universal.dmg'].map(
      (name) => ({
        name,
        state: 'uploaded',
        size: 1024,
        browser_download_url: `${base}/download/v1.2.3/${name}`,
      }),
    ),
  };
  assert.deepEqual(createReleaseManifest(release), {
    version: '1.2.3',
    url: `${base}/tag/v1.2.3`,
    windows: `${base}/download/v1.2.3/VTubeLeaf_1.2.3_x64-setup.exe`,
    mac: `${base}/download/v1.2.3/VTubeLeaf-1.2.3-macos-universal.dmg`,
  });
  for (const invalid of [
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, tag_name: 'v1.2.3-beta.1' },
    { ...release, assets: release.assets.slice(0, 1) },
    { ...release, assets: release.assets.map((asset) => ({ ...asset, size: 0 })) },
    {
      ...release,
      assets: release.assets.map((asset) => ({
        ...asset,
        browser_download_url: 'https://example.com/download',
      })),
    },
  ])
    assert.throws(() => createReleaseManifest(invalid));
});
