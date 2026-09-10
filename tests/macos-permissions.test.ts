import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test(
  'macOS signing allows camera and microphone capture',
  { skip: process.platform !== 'darwin' },
  () => {
    const config = JSON.parse(
      readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
    );
    assert.equal(typeof config.bundle.macOS.entitlements, 'string');
    const path = new URL(`../src-tauri/${config.bundle.macOS.entitlements}`, import.meta.url);
    const entitlements = JSON.parse(
      execFileSync('plutil', ['-convert', 'json', '-o', '-', fileURLToPath(path)], {
        encoding: 'utf8',
      }),
    );
    assert.equal(entitlements['com.apple.security.device.camera'], true);
    assert.equal(entitlements['com.apple.security.device.audio-input'], true);
  },
);
