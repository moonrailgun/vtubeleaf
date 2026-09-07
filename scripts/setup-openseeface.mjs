import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = join(root, '.local');
const directory = join(local, 'openseeface');
const environment = join(local, 'openseeface-venv');
const repository = 'https://github.com/emilianavt/OpenSeeFace.git';
const commit = '85aa70fc67582d046e771ea73625182a0d8f7475';
// OpenCV 4.12+ requires NumPy 2 on Python 3.10; the pinned tracker requires NumPy 1.
const requirements = [
  'numpy>=1.21.3,<2',
  'opencv-python>=4.5.4,<4.12',
  'Pillow>=8.4,<9',
  'onnxruntime>=1.9,<2',
];
const pythonPath = join(
  environment,
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);
const run = (command, args, cwd = root, capture = false) =>
  execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    timeout: 20 * 60_000,
    windowsHide: true,
  });

function checkPython(version) {
  if (!/^3\.10\./.test(version.trim()))
    throw new Error(
      `Use Python 3.10 for this pinned OpenSeeFace setup; received ${version.trim()}. Upstream declares Python <3.11.`,
    );
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      python: { type: 'string', default: process.platform === 'win32' ? 'python' : 'python3.10' },
      check: { type: 'boolean' },
      'self-test': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) {
    console.log(
      'node scripts/setup-openseeface.mjs [--python /path/to/python3.10]\n  Downloads pinned official OpenSeeFace and installs its dependencies in .local/openseeface-venv.\n  --check      Verify the existing checkout and Python imports without installing\n  --self-test  Check installer validation without downloading or installing',
    );
    return;
  }
  if (values['self-test']) {
    checkPython('3.10.14');
    assert.throws(() => checkPython('3.11.0'), /Python 3.10/);
    assert.throws(() => checkPython('2.7.18'), /Python 3.10/);
    assert.match(commit, /^[a-f0-9]{40}$/);
    assert.equal(new URL(repository).hostname, 'github.com');
    console.log('OpenSeeFace setup self-check passed.');
    return;
  }
  if (!values.check) {
    checkPython(
      run(values.python, ['-c', 'import platform; print(platform.python_version())'], root, true),
    );
    await mkdir(local, { recursive: true });
    if (!(await exists(directory))) {
      const temporary = await mkdtemp(join(local, 'openseeface-download-'));
      try {
        run('git', ['init', temporary]);
        run('git', ['remote', 'add', 'origin', repository], temporary);
        run('git', ['fetch', '--depth', '1', 'origin', commit], temporary);
        run('git', ['checkout', '--detach', 'FETCH_HEAD'], temporary);
        assert.equal(run('git', ['rev-parse', 'HEAD'], temporary, true).trim(), commit);
        await rename(temporary, directory);
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    }
  }
  const actualCommit = run('git', ['rev-parse', 'HEAD'], directory, true).trim();
  if (actualCommit !== commit)
    throw new Error(
      `Existing OpenSeeFace checkout is ${actualCommit}, expected ${commit}. It was left unchanged; move it aside before reinstalling.`,
    );
  const origin = run('git', ['remote', 'get-url', 'origin'], directory, true).trim();
  if (origin !== repository)
    throw new Error(
      'Existing OpenSeeFace origin is not the pinned official repository; left unchanged.',
    );
  if (run('git', ['status', '--porcelain', '--untracked-files=no'], directory, true).trim())
    throw new Error('OpenSeeFace has local modifications; left unchanged.');
  const source = await readFile(join(directory, 'facetracker.py'), 'utf8');
  for (const flag of ['--ip', '--port', '--capture', '--faces', '--visualize', '--silent']) {
    if (!source.includes(`"${flag}"`))
      throw new Error(`Pinned OpenSeeFace is missing expected CLI argument ${flag}.`);
  }
  if (!values.check) {
    if (!(await exists(pythonPath))) run(values.python, ['-m', 'venv', environment]);
    checkPython(
      run(pythonPath, ['-c', 'import platform; print(platform.python_version())'], root, true),
    );
    const requirementsPath = join(local, 'openseeface-requirements.txt');
    await writeFile(requirementsPath, `${requirements.join('\n')}\n`);
    run(pythonPath, [
      '-m',
      'pip',
      'install',
      '--disable-pip-version-check',
      '-r',
      requirementsPath,
    ]);
    await writeFile(
      join(local, 'openseeface-resolved.txt'),
      run(pythonPath, ['-m', 'pip', 'freeze'], root, true),
    );
  }
  checkPython(
    run(pythonPath, ['-c', 'import platform; print(platform.python_version())'], root, true),
  );
  run(pythonPath, [
    '-c',
    'import cv2, numpy, PIL, onnxruntime; print("OpenSeeFace imports passed")',
  ]);
  console.log(
    `OpenSeeFace ${commit} is ready. This check does not open the camera.\nPython: ${pythonPath}\nScript: ${join(root, 'scripts/run-openseeface.py')}\nThe supplied launcher uses the CPU provider. Use localhost 127.0.0.1, port 11573, one face. Leave both paths blank in VTubeLeaf to receive an externally started tracker.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
