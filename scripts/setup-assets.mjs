import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = join(root, 'public/runtime');
const version = '0.10.32';
const models = {
  faceLandmarker: {
    url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    bytes: 3758596,
    sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff',
  },
  poseLandmarker: {
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    bytes: 5777746,
    sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a',
  },
};
const wasm = [
  [
    'vision_wasm_internal.js',
    204816,
    '6f6b86509cf9e163ea1cfec7edc8cf53732699c04781e4c21c557c1ba402310e',
  ],
  [
    'vision_wasm_internal.wasm',
    11453626,
    'cb3ec20026a9aecc2a81a93c25630ceb5389297ddb7a5f0bd61dd09cde606b9b',
  ],
  [
    'vision_wasm_nosimd_internal.js',
    204669,
    '9f8fc960e363f0fb2f42f7937b97ae9cf9a5630490f71031fa90caa9bb121938',
  ],
  [
    'vision_wasm_nosimd_internal.wasm',
    10647962,
    '924274fcd5ac8985f6570a8573e7971b7bd2d580ba1b8f3beb0ba8f95db6347c',
  ],
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const coreLicenses = ['LICENSE.md', 'Core/LICENSE.md', 'Core/RedistributableFiles.txt'];
const coreFiles = [
  [
    'Core/live2dcubismcore.min.js',
    207155,
    '25ae938cb4fe282ce189b357bcc97e603d1e1f7ec78bf04150d401c23cdc792f',
  ],
  ['LICENSE.md', 3017, 'c96e038ac249da5aeab715c043684ff72dd29f3fc333925637a7508f8a013ee3'],
  ['Core/LICENSE.md', 520, 'b81e37048010ef1d336106151201a0323c3309cae44aecdedf57831fe88fa991'],
  [
    'Core/RedistributableFiles.txt',
    205,
    'd16c123688299e1e69a7f5ebc01b3bd75a8d408c024002a7d35b2aae94003f8c',
  ],
];

function verify(bytes, expected, label) {
  if (bytes.length !== expected.bytes || hash(bytes) !== expected.sha256) {
    throw new Error(`${label}: size or SHA-256 mismatch; existing files were not replaced.`);
  }
  return bytes;
}

async function boundedRead(path, max) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > max)
    throw new Error(`${basename(path)}: invalid file size (limit ${max} bytes).`);
  const bytes = await readFile(path);
  if (bytes.length > max) throw new Error(`${basename(path)} grew beyond its size limit.`);
  return bytes;
}

async function atomicWrite(path, bytes) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: 'wx' });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function download(model, label) {
  const response = await fetch(model.url, {
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body)
    throw new Error(`${label} download failed: HTTP ${response.status}.`);
  const declared = response.headers.get('content-length');
  if (declared !== null && Number(declared) !== model.bytes)
    throw new Error(`${label} download has an unexpected size.`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > model.bytes) throw new Error(`${label} download exceeded its size limit.`);
    chunks.push(chunk);
  }
  return verify(Buffer.concat(chunks), model, label);
}

async function prepareCubism(directory, check) {
  // Validate the complete dependency before replacing any runtime files.
  const files = await Promise.all(
    coreFiles.map(async ([name, bytes, sha256]) => {
      const target = coreLicenses.includes(name) ? `licenses/${name}` : basename(name);
      const source = check
        ? join(directory, target)
        : join(root, 'node_modules/@vtubeleaf/cubism-core', name);
      const data = verify(await boundedRead(source, bytes), { bytes, sha256 }, name);
      return { target, data, bytes, sha256 };
    }),
  );
  if (!check) {
    for (const { target, data } of files) await atomicWrite(join(directory, target), data);
  }
  return {
    cubismCore: {
      source: '@vtubeleaf/cubism-core@5.0.0-r.4',
      archiveLabel: 'CubismSdkForWeb-5-r.4',
      bytes: files[0].bytes,
      sha256: files[0].sha256,
    },
    files: Object.fromEntries(
      files.map(({ target, bytes, sha256 }) => [target, { bytes, sha256 }]),
    ),
  };
}

async function selfTest() {
  const bytes = Buffer.from('verified asset');
  const expected = { bytes: bytes.length, sha256: hash(bytes) };
  assert.equal(verify(bytes, expected, 'test'), bytes);
  assert.throws(() => verify(Buffer.from('tampered asset'), expected, 'test'), /mismatch/);
  const directory = await mkdtemp(join(tmpdir(), 'vtubeleaf-assets-'));
  try {
    const path = join(directory, 'asset');
    await atomicWrite(path, bytes);
    assert.deepEqual(await boundedRead(path, bytes.length), bytes);
    await assert.rejects(boundedRead(path, 1), /size/);
    await atomicWrite(path, Buffer.from('replacement'));
    assert.equal(await readFile(path, 'utf8'), 'replacement');
    const cubism = await prepareCubism(directory, false);
    assert.deepEqual(await prepareCubism(directory, true), cubism);
    await writeFile(join(directory, 'licenses/Core/LICENSE.md'), 'tampered');
    await assert.rejects(prepareCubism(directory, true), /mismatch/);
    await prepareCubism(directory, false);
    await rm(join(directory, 'live2dcubismcore.min.js'));
    await assert.rejects(prepareCubism(directory, true), /ENOENT/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  console.log('Asset setup self-check passed.');
}

async function main() {
  const { values } = parseArgs({
    options: {
      check: { type: 'boolean' },
      'mediapipe-only': { type: 'boolean' },
      'self-test': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'node scripts/setup-assets.mjs\n  Prepare pinned Cubism Core from npm dependencies and local tracking resources\n  --mediapipe-only  Prepare/check tracking resources without Cubism Core\n  --check           Verify existing resources without downloads or writes\n  --self-test       Run local integrity/atomic-write checks',
    );
    return;
  }
  if (values['self-test']) return selfTest();
  const packageRoot = join(root, 'node_modules/@mediapipe/tasks-vision');
  const installed = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  if (installed.version !== version)
    throw new Error(
      `Expected @mediapipe/tasks-vision ${version}; run npm ci or update the pinned checksums deliberately.`,
    );
  const manifest = {
    schema: 1,
    mediaPipeVersion: version,
    files: {},
  };
  for (const [name, bytes, sha256] of wasm) {
    const target = `mediapipe/wasm/${name}`;
    const source = values.check ? join(runtime, target) : join(packageRoot, 'wasm', name);
    const data = verify(await boundedRead(source, bytes), { bytes, sha256 }, name);
    if (!values.check) await atomicWrite(join(runtime, target), data);
    manifest.files[target] = { bytes, sha256 };
  }
  for (const [label, model] of Object.entries(models)) {
    const target = `mediapipe/${basename(new URL(model.url).pathname)}`;
    const modelPath = join(runtime, target);
    let modelData;
    try {
      modelData = verify(await boundedRead(modelPath, model.bytes), model, label);
    } catch (error) {
      if (values.check) throw error;
      modelData = await download(model, label);
      await atomicWrite(modelPath, modelData);
    }
    manifest[label] = { version: 'float16/1', ...model };
    manifest.files[target] = { bytes: modelData.length, sha256: hash(modelData) };
  }

  const corePath = join(runtime, 'live2dcubismcore.min.js');
  if (!values['mediapipe-only']) {
    const cubism = await prepareCubism(runtime, values.check);
    manifest.cubismCore = cubism.cubismCore;
    Object.assign(manifest.files, cubism.files);
  } else if (!values.check) {
    // Keep a previously supplied Core inventory when refreshing only MediaPipe.
    try {
      const previous = JSON.parse(await readFile(join(runtime, 'manifest.json'), 'utf8'));
      const core = await boundedRead(corePath, 16 * 1024 * 1024);
      verify(core, previous.cubismCore, 'Cubism Core');
      for (const name of coreLicenses) {
        const target = `licenses/${name}`;
        verify(
          await boundedRead(join(runtime, target), 128 * 1024),
          previous.files[target],
          target,
        );
        manifest.files[target] = previous.files[target];
      }
      manifest.cubismCore = previous.cubismCore;
      manifest.files['live2dcubismcore.min.js'] = { bytes: core.length, sha256: hash(core) };
    } catch {
      /* Core is optional in this explicit mode. */
    }
  }
  if (!values.check)
    await atomicWrite(join(runtime, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `${values.check ? 'Verified' : 'Prepared'} local MediaPipe ${version}${manifest.cubismCore ? ' and pinned Cubism Core R4' : ''}. Generated runtime resources remain ignored by Git.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
