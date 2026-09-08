import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const directory = 'public/licenses';
const hash = (data) => createHash('sha256').update(data).digest('hex');
const normalized = (data) => data.toString().replaceAll('\r\n', '\n');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
const overrides = {
  '@mediapipe/tasks-vision@0.10.32': 'mediapipe.txt',
  '@tauri-apps/api@2.11.1': 'tauri-api.txt',
  'react-remove-scroll-bar@2.3.8': 'react-remove-scroll-bar.txt',
};
const sources = [
  'package-lock.json',
  'src-tauri/Cargo.lock',
  'src-tauri/Cargo.toml',
  'src-tauri/about.toml',
  'scripts/licenses.hbs',
  'scripts/licenses.mjs',
  'scripts/setup-assets.mjs',
];
const digests = async (files) =>
  Object.fromEntries(
    await Promise.all(
      files.sort().map(async (path) => [path, hash(normalized(await readFile(path)))]),
    ),
  );
const licenseFiles = async (dir) =>
  (await readdir(dir, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() && /^(licen[cs]e|copying|notice|copyright)([._-]|$)/i.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
async function npmNotices() {
  const lock = await json('package-lock.json');
  const records = [];
  for (const [path, info] of Object.entries(lock.packages).sort(([a], [b]) =>
    a.localeCompare(b, 'en'),
  )) {
    if (!path || info.dev) continue;
    assert.ok(
      path.startsWith('node_modules/') && !path.split('/').includes('..'),
      'Invalid package path',
    );
    const pkg = await json(join(path, 'package.json'));
    assert.equal(pkg.version, info.version, `Run npm ci: ${path}`);
    assert.ok(pkg.license, `Missing license: ${path}`);
    const id = `${pkg.name}@${pkg.version}`;
    const files = await licenseFiles(path);
    const texts = await Promise.all(
      files.map(async (name) => `--- ${name} ---\n${await readFile(join(path, name), 'utf8')}`),
    );
    if (!texts.length && overrides[id])
      texts.push(await readFile(join(directory, overrides[id]), 'utf8'));
    assert.ok(texts.length, `Missing license text: ${id}; add a version-pinned source`);
    const source = info.resolved?.startsWith('file:')
      ? `${info.resolved} (${pkg.homepage})`
      : `https://www.npmjs.com/package/${pkg.name}/v/${pkg.version}`;
    records.push(`${id}\nLicense: ${pkg.license}\nSource: ${source}\n\n${texts.join('\n\n')}`);
  }
  return `VTubeLeaf npm production dependency notices\nIncludes all non-dev lockfile entries, including transitive dependencies. Optional entries may not appear in every bundle.\n\n${records.join('\n\n============================================================\n\n')}\n`;
}

const generate = process.argv.includes('--generate');
// Check prepared runtime files; a clean checkout may not have run setup:assets yet.
let core;
try {
  core = await readFile('public/runtime/live2dcubismcore.min.js');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (core) {
  const runtime = await json('public/runtime/manifest.json');
  for (const name of [
    'live2dcubismcore.min.js',
    'licenses/LICENSE.md',
    'licenses/Core/LICENSE.md',
    'licenses/Core/RedistributableFiles.txt',
  ]) {
    const data = await readFile(join('public/runtime', name));
    assert.deepEqual(
      { bytes: data.length, sha256: hash(data) },
      runtime.files[name],
      `Missing or changed SDK notice: ${name}; rerun npm run setup:assets`,
    );
  }
}
const files = (await readdir(directory))
  .filter((file) => file !== 'manifest.json')
  .map((file) => `${directory}/${file}`);
let projectLicense;
try {
  projectLicense = await readFile('LICENSE', 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (projectLicense) sources.push('LICENSE');
if (generate) {
  const command = process.env.CARGO_ABOUT || '.local/license-tools/bin/cargo-about';
  assert.match(
    execFileSync(command, ['--version'], { encoding: 'utf8' }),
    /cargo-about 0\.9\.2\b/,
    'Use cargo-about 0.9.2',
  );
  execFileSync(
    command,
    [
      'generate',
      '--locked',
      '--manifest-path',
      'src-tauri/Cargo.toml',
      '--config',
      'src-tauri/about.toml',
      'scripts/licenses.hbs',
      '--output-file',
      `${directory}/rust.html`,
    ],
    { stdio: 'inherit' },
  );
  await writeFile(`${directory}/npm.txt`, await npmNotices());
  if (projectLicense) await copyFile('LICENSE', `${directory}/vtubeleaf.txt`);
  const outputs = (await readdir(directory))
    .filter((file) => file !== 'manifest.json')
    .map((file) => `${directory}/${file}`);
  await writeFile(
    `${directory}/manifest.json`,
    JSON.stringify(
      { schema: 1, inputs: await digests(sources), outputs: await digests(outputs) },
      null,
      2,
    ) + '\n',
  );
} else {
  const manifest = await json(`${directory}/manifest.json`);
  assert.deepEqual(
    await digests(sources),
    manifest.inputs,
    'License inputs changed; run npm run licenses:generate',
  );
  assert.deepEqual(
    await digests(files),
    manifest.outputs,
    'License files changed or are missing; run npm run licenses:generate',
  );
  assert.equal(
    normalized(await readFile(`${directory}/npm.txt`, 'utf8')),
    normalized(await npmNotices()),
    'Installed npm notices changed; run npm run licenses:generate',
  );
}
console.log(`Third-party notices ${generate ? 'generated' : 'verified'}.`);
