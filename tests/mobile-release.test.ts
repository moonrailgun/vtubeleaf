import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { checkAndroidVersionCode } from '../scripts/check-mobile-version.mjs';
import {
  createMobileReleaseManifest,
  latestMobileRelease,
} from '../scripts/update-website-release.mjs';
import { parseMobileRelease } from '../website/src/mobile-release.ts';

test('Android upgrade codes are positive integers within the publishing limit', () => {
  assert.equal(checkAndroidVersionCode(1), 1);
  assert.equal(checkAndroidVersionCode(2_100_000_000), 2_100_000_000);
  for (const code of [undefined, null, '1', 0, -1, 1.5, NaN, Infinity, 2_100_000_001]) {
    assert.throws(() => checkAndroidVersionCode(code));
  }
});

const version = '0.2.3';
const url = `https://github.com/moonrailgun/vtubeleaf/releases/download/mobile-v${version}/VTubeLeaf-Phone-${version}-android.apk`;
const published = {
  tag_name: `mobile-v${version}`,
  draft: false,
  prerelease: false,
  assets: [
    { name: url.split('/').at(-1), browser_download_url: url, state: 'uploaded', size: 100 },
  ],
};

test('mobile downloads require a published stable release and its uploaded APK', () => {
  const manifest = createMobileReleaseManifest(published);
  assert.equal(manifest.android, url);
  assert.deepEqual(parseMobileRelease(manifest), manifest);
  assert.equal(parseMobileRelease(null), null);
  for (const changed of [
    { draft: true },
    { prerelease: true },
    { tag_name: 'v1.0.0' },
    { assets: [] },
    { assets: [{ ...published.assets[0], size: 0 }] },
  ]) {
    assert.throws(() => createMobileReleaseManifest({ ...published, ...changed }));
  }
  for (const changed of [
    { android: 'https://example.com/app.apk' },
    { version: '0.2.3-beta.1' },
    { url: 'https://example.com' },
  ]) {
    assert.throws(() => parseMobileRelease({ ...manifest, ...changed }));
  }
  assert.equal(
    latestMobileRelease([
      { ...published, tag_name: 'v99.0.0' },
      { ...published, tag_name: 'mobile-v0.2.10', draft: true },
      { ...published, tag_name: 'mobile-v0.2.10' },
      published,
      { ...published, tag_name: 'mobile-v0.2.9' },
    ]).tag_name,
    'mobile-v0.2.10',
  );
  assert.throws(() => latestMobileRelease([]));
  assert.equal(
    latestMobileRelease([
      { ...published, tag_name: 'mobile-v1.0.1000' },
      { ...published, tag_name: 'mobile-v1.0.999' },
      { ...published, tag_name: 'mobile-v0.999.999' },
    ]).tag_name,
    'mobile-v1.0.1000',
  );
});

test('mobile release-it bumps and tags only mobile, and rejects invalid versions before editing', () => {
  const root = mkdtempSync(join(tmpdir(), 'vtubeleaf-mobile-release-'));
  const local = join(root, 'local');
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const change = (path: string, subject: string) => {
    mkdirSync(dirname(join(local, path)), { recursive: true });
    writeFileSync(join(local, path), subject);
    git(local, 'add', path);
    git(local, 'commit', '-m', subject);
  };
  const release = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../node_modules/release-it/bin/release-it.js', import.meta.url)),
        '--ci',
        '--no-git.push',
        ...args,
      ],
      { cwd: join(local, 'mobile'), encoding: 'utf8' },
    );
  try {
    git(root, 'init', '--bare', '--initial-branch=main', join(root, 'remote.git'));
    git(root, 'clone', join(root, 'remote.git'), local);
    git(local, 'config', 'user.name', 'Release Test');
    git(local, 'config', 'user.email', 'release-test@example.invalid');
    git(local, 'config', 'commit.gpgsign', 'false');
    mkdirSync(join(local, 'mobile'));
    mkdirSync(join(local, 'scripts'));
    for (const file of [
      'mobile/package.json',
      'scripts/check-mobile-version.mjs',
      'scripts/check-release-sync.mjs',
    ]) {
      copyFileSync(new URL(`../${file}`, import.meta.url), join(local, file));
    }
    const mobilePath = join(local, 'mobile/package.json');
    const mobileConfig = JSON.parse(readFileSync(mobilePath, 'utf8'));
    mobileConfig.version = '0.1.0';
    mobileConfig.versionCode = 1;
    writeFileSync(mobilePath, JSON.stringify(mobileConfig));
    const desktop = '{"version":"9.9.9"}\n';
    writeFileSync(join(local, 'package.json'), desktop);
    git(local, 'add', 'package.json');
    git(local, 'commit', '-m', 'feat(desktop): desktop history');
    git(local, 'tag', 'v9.9.9');
    git(local, 'add', 'mobile', 'scripts');
    git(local, 'commit', '-m', 'build(mobile): configure Android releases');
    change('mobile/android/tracking.kt', 'feat(phone): Android tracking');
    change('mobile/ios/tracking.swift', 'feat(ios): iOS tracking');
    change('src/desktop.ts', 'fix(ui): desktop tracking');
    change('website/index.html', 'feat(website): website downloads');
    git(local, 'push', '-u', 'origin', 'main');
    const before = readFileSync(join(local, 'mobile/package.json'), 'utf8');
    const bad = release('0.2.0-beta.1');
    assert.notEqual(bad.status, 0);
    assert.equal(readFileSync(join(local, 'mobile/package.json'), 'utf8'), before);
    const dry = release('patch', '--dry-run');
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(git(local, 'status', '--porcelain'), '');
    for (const [increment, expected, expectedCode] of [
      ['patch', '0.1.1', 2],
      ['minor', '0.2.0', 3],
      ['major', '1.0.0', 4],
      ['1.2.1000', '1.2.1000', 5],
    ] as const) {
      if (increment === 'minor') {
        change('mobile/android/tracking.kt', 'fix(phone): Android reconnect');
        change('mobile/ios/tracking.swift', 'fix(ios): iOS reconnect');
        change('src/desktop.ts', 'fix(ui): desktop reconnect');
        git(local, 'tag', 'v9.9.10');
        change('.github/workflows/release-mobile.yml', 'ci(android): signed APK release');
        change('mobile/RELEASE_NOTES.md', 'docs(mobile): Android release notes');
      }
      const result = release(increment);
      assert.equal(result.status, 0, result.stdout + result.stderr);
      assert.doesNotMatch(
        result.stdout,
        /desktop history|desktop tracking|iOS tracking|website downloads|desktop reconnect|iOS reconnect/,
      );
      if (increment === 'patch') {
        assert.match(result.stdout, /Android tracking/);
        assert.match(result.stdout, /configure Android releases/);
      } else if (increment === 'minor') {
        assert.match(result.stdout, /Android reconnect/);
        assert.match(result.stdout, /signed APK release/);
        assert.match(result.stdout, /Android release notes/);
        assert.doesNotMatch(result.stdout, /Android tracking|configure Android releases/);
      } else {
        assert.doesNotMatch(
          result.stdout,
          /Android tracking|Android reconnect|signed APK release|Android release notes/,
        );
      }
      assert.equal(
        JSON.parse(readFileSync(join(local, 'mobile/package.json'), 'utf8')).version,
        expected,
      );
      assert.equal(JSON.parse(readFileSync(mobilePath, 'utf8')).versionCode, expectedCode);
      assert.equal(git(local, 'tag', '--points-at', 'HEAD'), `mobile-v${expected}`);
      assert.equal(
        git(local, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'),
        'mobile/package.json',
      );
      assert.equal(readFileSync(join(local, 'package.json'), 'utf8'), desktop);
      assert.equal(git(local, 'status', '--porcelain'), '');
    }
    const current = readFileSync(mobilePath, 'utf8');
    const ciOutput = join(root, 'ci-output');
    for (let run = 0; run < 2; run++) {
      const ci = spawnSync(process.execPath, ['scripts/check-mobile-version.mjs', '--ci'], {
        cwd: local,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_REF: 'refs/tags/mobile-v1.2.1000', GITHUB_OUTPUT: ciOutput },
      });
      assert.equal(ci.status, 0, ci.stderr);
      assert.equal(readFileSync(mobilePath, 'utf8'), current);
    }
    assert.equal(readFileSync(ciOutput, 'utf8'), 'version=1.2.1000\nversion-code=5\n'.repeat(2));
    const exhausted = { ...JSON.parse(current), versionCode: 2_100_000_000 };
    writeFileSync(mobilePath, JSON.stringify(exhausted));
    git(local, 'add', 'mobile/package.json');
    git(local, 'commit', '-m', 'exhaust version codes');
    const exhaustedBefore = readFileSync(mobilePath, 'utf8');
    const overflow = release('patch');
    assert.notEqual(overflow.status, 0);
    assert.match(overflow.stdout + overflow.stderr, /versionCode/);
    assert.equal(readFileSync(mobilePath, 'utf8'), exhaustedBefore);
    assert.equal(git(local, 'status', '--porcelain'), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
