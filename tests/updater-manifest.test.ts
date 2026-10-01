import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdaterManifest } from '../scripts/create-updater-manifest.mjs';

test('updater manifest requires every signed platform and uses version-specific URLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vtubeleaf-updates-'));
  try {
    const names = [
      'VTubeLeaf_1.2.3_x64-setup.exe',
      'VTubeLeaf-1.2.3-macos-universal.app.tar.gz',
      'VTubeLeaf_1.2.3_amd64.AppImage',
      'VTubeLeaf_1.2.3_amd64.deb',
    ];
    for (const name of names) {
      await writeFile(join(dir, name), 'package');
      await writeFile(join(dir, `${name}.sig`), 'c2lnbmF0dXJl');
    }
    const result = await createUpdaterManifest(dir, 'v1.2.3', '修复问题');
    assert.equal(result.version, '1.2.3');
    assert.equal(result.notes, '修复问题');
    assert.deepEqual(Object.keys(result.platforms).sort(), [
      'darwin-aarch64',
      'darwin-x86_64',
      'linux-x86_64-appimage',
      'linux-x86_64-deb',
      'windows-x86_64',
    ]);
    assert.equal(result.platforms['darwin-aarch64'].url, result.platforms['darwin-x86_64'].url);
    assert.ok(result.platforms['linux-x86_64-appimage'].url.endsWith(names[2]));
    assert.ok(result.platforms['linux-x86_64-deb'].url.endsWith(names[3]));
    assert.equal(
      result.platforms['windows-x86_64'].url,
      `https://github.com/moonrailgun/vtubeleaf/releases/download/v1.2.3/${names[0]}`,
    );
    await assert.rejects(createUpdaterManifest(dir, '../bad', ''));
    for (const name of names) {
      await writeFile(join(dir, `${name}.sig`), '');
      await assert.rejects(createUpdaterManifest(dir, 'v1.2.3', ''));
      await writeFile(join(dir, `${name}.sig`), 'c2lnbmF0dXJl');
      await rm(join(dir, name));
      await assert.rejects(createUpdaterManifest(dir, 'v1.2.3', ''));
      await writeFile(join(dir, name), 'package');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
