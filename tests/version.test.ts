import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

test('version sync updates only the app and rejects an unrecognized lockfile before writing', () => {
  const root = mkdtempSync(join(tmpdir(), 'vtubeleaf-version-'));
  try {
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'src-tauri'));
    const script = join(root, 'scripts/sync-version.mjs');
    copyFileSync(new URL('../scripts/sync-version.mjs', import.meta.url), script);
    const manifest =
      '[package]\nname = "vtubeleaf"\nversion = "0.1.0"\n\n[dependencies]\nserde = "1"\n';
    const dependency = '[[package]]\nname = "serde"\nversion = "1.0.0"\n\n';
    const lock = dependency + '[[package]]\nname = "vtubeleaf"\nversion = "0.1.0"\n';
    const cargoPath = join(root, 'src-tauri/Cargo.toml');
    const lockPath = join(root, 'src-tauri/Cargo.lock');
    const run = () => spawnSync(process.execPath, [script], { encoding: 'utf8' });
    for (const version of ['0.1.1', '0.2.0', '1.0.0', '1.2.3-beta.1']) {
      writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
      writeFileSync(cargoPath, manifest);
      writeFileSync(lockPath, lock);
      const result = run();
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(cargoPath, 'utf8'), manifest.replace('0.1.0', version));
      assert.equal(readFileSync(lockPath, 'utf8'), lock.replace('0.1.0', version));
    }
    writeFileSync(cargoPath, manifest);
    writeFileSync(lockPath, dependency);
    assert.notEqual(run().status, 0);
    assert.equal(readFileSync(cargoPath, 'utf8'), manifest);
    assert.equal(readFileSync(lockPath, 'utf8'), dependency);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
