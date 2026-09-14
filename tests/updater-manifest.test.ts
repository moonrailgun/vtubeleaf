import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdaterManifest } from '../scripts/create-updater-manifest.mjs';

test('updater manifest requires both signed platforms and uses version-specific URLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vtubeleaf-updates-'));
  try {
    const names = ['VTubeLeaf_1.2.3_x64-setup.exe', 'VTubeLeaf-1.2.3-macos-universal.app.tar.gz'];
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
      'windows-x86_64',
    ]);
    assert.equal(result.platforms['darwin-aarch64'].url, result.platforms['darwin-x86_64'].url);
    assert.equal(
      result.platforms['windows-x86_64'].url,
      `https://github.com/moonrailgun/vtubeleaf/releases/download/v1.2.3/${names[0]}`,
    );
    await assert.rejects(createUpdaterManifest(dir, '../bad', ''));
    await writeFile(join(dir, `${names[0]}.sig`), '');
    await assert.rejects(createUpdaterManifest(dir, 'v1.2.3', ''));
    await rm(join(dir, names[1]));
    await assert.rejects(createUpdaterManifest(dir, 'v1.2.3', ''));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
