import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createReleaseManifest } from '../scripts/update-website-release.mjs';
import { parseRelease } from '../website/src/release.ts';

test('website manifest infers verified stable release downloads and rejects incomplete releases', () => {
  const base = 'https://github.com/moonrailgun/vtubeleaf/releases';
  const release = {
    tag_name: 'v1.2.3',
    draft: false,
    prerelease: false,
    assets: [
      'VTubeLeaf_1.2.3_x64-setup.exe',
      'VTubeLeaf-1.2.3-macos-universal.dmg',
      'VTubeLeaf-OpenSeeFace-1.2.3-windows-x64.zip',
      'VTubeLeaf-OpenSeeFace-1.2.3-macos-aarch64.dmg',
      'VTubeLeaf-OpenSeeFace-1.2.3-macos-x86_64.dmg',
    ].map((name) => ({
      name,
      state: 'uploaded',
      size: 1024,
      browser_download_url: `${base}/download/v1.2.3/${name}`,
    })),
  };
  const expected = {
    version: '1.2.3',
    url: `${base}/tag/v1.2.3`,
    windows: `${base}/download/v1.2.3/VTubeLeaf_1.2.3_x64-setup.exe`,
    mac: `${base}/download/v1.2.3/VTubeLeaf-1.2.3-macos-universal.dmg`,
    openseeface: {
      'windows-x86_64': `${base}/download/v1.2.3/VTubeLeaf-OpenSeeFace-1.2.3-windows-x64.zip`,
      'darwin-aarch64': `${base}/download/v1.2.3/VTubeLeaf-OpenSeeFace-1.2.3-macos-aarch64.dmg`,
      'darwin-x86_64': `${base}/download/v1.2.3/VTubeLeaf-OpenSeeFace-1.2.3-macos-x86_64.dmg`,
    },
  };
  assert.deepEqual(createReleaseManifest(release), expected);
  assert.deepEqual(parseRelease(expected), expected);
  const { openseeface, ...legacy } = expected;
  assert.deepEqual(parseRelease(legacy), legacy);
  for (const invalid of [
    null,
    {},
    { ...openseeface, 'darwin-aarch64': 'https://example.com/download' },
    { ...openseeface, 'windows-x86_64': expected.windows },
    { ...openseeface, 'darwin-x86_64': openseeface['darwin-x86_64'].replaceAll('1.2.3', '1.2.2') },
  ])
    assert.throws(() => parseRelease({ ...expected, openseeface: invalid }));
  for (const invalid of [
    { ...release, draft: true },
    { ...release, prerelease: true },
    { ...release, tag_name: 'v1.2.3-beta.1' },
    { ...release, assets: release.assets.slice(0, 1) },
    ...release.assets.map((_, index) => ({
      ...release,
      assets: release.assets.filter((_, assetIndex) => assetIndex !== index),
    })),
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
