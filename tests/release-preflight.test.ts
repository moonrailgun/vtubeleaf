import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('release fetches and rejects missing remote commits before changing the version', () => {
  const config = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const hook = config['release-it'].hooks['after:git:init'];
  assert.ok(hook, 'Release must check remote commits after fetching');
  const root = mkdtempSync(join(tmpdir(), 'vtubeleaf-release-preflight-'));
  const remote = join(root, 'remote.git');
  const local = join(root, 'local');
  const peer = join(root, 'peer');
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const identity = (cwd: string) => {
    git(cwd, 'config', 'user.name', 'Release Test');
    git(cwd, 'config', 'user.email', 'release-test@example.invalid');
    git(cwd, 'config', 'commit.gpgsign', 'false');
  };
  const release = (preview = false) =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../node_modules/release-it/bin/release-it.js', import.meta.url)),
        '--ci',
        '--no-git.push',
        '--no-git.commit',
        '--no-git.tag',
        ...(preview ? ['--release-version'] : []),
      ],
      { cwd: local, encoding: 'utf8' },
    );
  try {
    git(root, 'init', '--bare', '--initial-branch=main', remote);
    git(root, 'clone', remote, local);
    identity(local);
    mkdirSync(join(local, 'scripts'));
    copyFileSync(
      new URL('../scripts/check-release-sync.mjs', import.meta.url),
      join(local, 'scripts/check-release-sync.mjs'),
    );
    const manifest = JSON.stringify({
      name: 'release-preflight-test',
      version: '1.0.0',
      private: true,
      'release-it': { npm: { publish: false }, hooks: { 'after:git:init': hook } },
    });
    writeFileSync(join(local, 'package.json'), manifest);
    git(local, 'add', '.');
    git(local, 'commit', '-m', 'initial');
    git(local, 'push', '-u', 'origin', 'main');
    git(root, 'clone', remote, peer);
    identity(peer);

    const assertAllowed = () => {
      const result = release(true);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /1\.0\.1/);
    };
    const assertBlocked = (message: RegExp) => {
      const head = git(local, 'rev-parse', 'HEAD');
      const result = release();
      assert.notEqual(result.status, 0);
      assert.match(result.stdout + result.stderr, message);
      assert.equal(readFileSync(join(local, 'package.json'), 'utf8'), manifest);
      assert.equal(git(local, 'rev-parse', 'HEAD'), head);
      assert.equal(git(local, 'tag', '--list'), '');
      assert.equal(git(local, 'status', '--porcelain'), '');
    };
    const advanceRemote = () => {
      git(peer, 'commit', '--allow-empty', '-m', 'remote change');
      git(peer, 'push');
    };

    assertAllowed();
    advanceRemote();
    assert.equal(git(local, 'rev-parse', 'HEAD'), git(local, 'rev-parse', '@{upstream}'));
    assertBlocked(/远程.*未同步.*提交/);
    git(local, 'merge', '--ff-only', '@{upstream}');
    assertAllowed();
    git(local, 'commit', '--allow-empty', '-m', 'local change');
    assertAllowed();
    advanceRemote();
    assertBlocked(/远程.*未同步.*提交/);
    git(local, 'remote', 'set-url', 'origin', join(root, 'unavailable.git'));
    assertBlocked(/Unable to fetch/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
