import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
// npm version validates and increments the version before invoking this hook.
const updates = ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'].map((path) => {
  const file = new URL(path, root);
  const text = readFileSync(file, 'utf8');
  const pattern = /^(name = "vtubeleaf"\r?\nversion = ")[^"\r\n]+(")/gm;
  assert.equal([...text.matchAll(pattern)].length, 1, `Expected one app version in ${path}`);
  return [file, text.replace(pattern, (_, prefix, suffix) => `${prefix}${version}${suffix}`)];
});
for (const [file, text] of updates) writeFileSync(file, text);
console.log(`Rust package and lockfile synchronized to ${version}.`);
