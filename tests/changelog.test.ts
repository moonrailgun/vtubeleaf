import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bilingualNotes,
  changelogNotes,
  checkUnreleased,
  releaseChangelog,
} from '../scripts/changelog.mjs';
import { localNotes, parseChangelog, releasesSince } from '../src/changelog.ts';

const unreleased = '## 未发布';
const draft =
  '# 更新记录\n\n## 未发布\n\n### 修复\n\n- 修好了。\n\n## v1.0.0 · 2026-09-19\n\n- 第一版。\n';

test('release turns the unreleased notes into the version section', () => {
  const released = releaseChangelog(draft, unreleased, 'v1.0.1', '2026-10-07');
  assert.equal(
    released,
    '# 更新记录\n\n## 未发布\n\n## v1.0.1 · 2026-10-07\n\n### 修复\n\n- 修好了。\n\n## v1.0.0 · 2026-09-19\n\n- 第一版。\n',
  );
  assert.equal(changelogNotes(released, 'v1.0.1'), '### 修复\n\n- 修好了。');
  assert.equal(changelogNotes(released, 'v1.0.0'), '- 第一版。');
});

test('empty unreleased sections become localized maintenance notes without losing history', () => {
  for (const [heading, note] of [
    ['## Unreleased', '- Maintenance release.'],
    ['## 未发布', '- 维护更新。'],
  ]) {
    const history = '## v1.0.0 · 2026-09-19\n\n- Previous release.\n';
    const empty = `# Changelog\n\n${heading}\n \t\n${history}`;
    assert.doesNotThrow(() => checkUnreleased(empty, heading));
    const released = releaseChangelog(empty, heading, 'v1.0.1', '2026-10-07');
    assert.equal(
      released,
      `# Changelog\n\n${heading}\n\n## v1.0.1 · 2026-10-07\n\n${note}\n\n${history}`,
    );
    assert.equal(changelogNotes(released, 'v1.0.1'), note);
    assert.equal(parseChangelog(released)[0].version, 'v1.0.1');
  }
});

test('release refuses missing sections and duplicate versions', () => {
  assert.throws(() => releaseChangelog('# 更新记录\n', unreleased, 'v1.0.1', 'd'), /缺少/);
  assert.throws(() => releaseChangelog(draft, unreleased, 'v1.0.0', 'd'), /已有 v1\.0\.0/);
  assert.throws(() => changelogNotes(draft, 'v9.9.9'), /缺少 v9\.9\.9/);
  assert.doesNotThrow(() => checkUnreleased(draft, unreleased));
  assert.throws(() => checkUnreleased(draft, '## Unreleased'), /缺少/);
});

test('CLI allows both changelogs to be empty but rejects a missing translation before writing', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'vtubeleaf-changelog-')));
  const files = [join(root, 'CHANGELOG.md'), join(root, 'CHANGELOG.zh-CN.md')];
  const command = (...args: string[]) =>
    spawnSync(process.execPath, [join(root, 'scripts/changelog.mjs'), ...args], {
      cwd: root,
      encoding: 'utf8',
    });
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(
      new URL('../scripts/changelog.mjs', import.meta.url),
      join(root, 'scripts/changelog.mjs'),
    );
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '1.0.1' }));
    for (const [en, zh] of [
      ['', ''],
      ['- Fixed it.', ''],
      ['', '- 修好了。'],
      ['- Fixed it.', '- 修好了。'],
    ]) {
      const originals = [
        `# Changelog\n\n## Unreleased\n\n${en}\n`,
        `# 更新记录\n\n## 未发布\n\n${zh}\n`,
      ];
      files.forEach((file, index) => writeFileSync(file, originals[index]));
      const mismatch = Boolean(en) !== Boolean(zh);
      for (const step of ['check', 'release']) {
        const result = command(step);
        assert.equal(result.status, mismatch ? 1 : 0, result.stderr);
        if (mismatch) assert.match(result.stderr, /同时填写或同时留空/);
        if (mismatch || step === 'check')
          assert.deepEqual(
            files.map((file) => readFileSync(file, 'utf8')),
            originals,
          );
      }
      if (!mismatch) {
        const notes = command('notes', 'v1.0.1');
        assert.equal(notes.status, 0, notes.stderr);
        assert.equal(
          notes.stdout,
          `${en || '- Maintenance release.'}\n\n---\n\n${zh || '- 维护更新。'}\n`,
        );
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the app reads released sections and picks the ones installed since last launch', () => {
  const released = releaseChangelog(
    releaseChangelog(draft, unreleased, 'v1.0.1', '2026-10-07').replace(
      '## 未发布\n',
      '## 未发布\n\n介绍\n- 新功能\n',
    ),
    unreleased,
    'v1.0.2',
    '2026-10-08',
  );
  const releases = parseChangelog(released);
  assert.deepEqual(
    releases.map((release) => release.version),
    ['v1.0.2', 'v1.0.1', 'v1.0.0'],
  );
  assert.deepEqual(releases[0], {
    version: 'v1.0.2',
    date: '2026-10-08',
    groups: [{ title: '', text: ['介绍'], items: ['新功能'] }],
  });
  assert.deepEqual(releases[1].groups, [{ title: '修复', text: [], items: ['修好了。'] }]);
  const since = (current: string, lastSeen: string) =>
    releasesSince(releases, current, lastSeen).map((release) => release.version);
  assert.deepEqual(since('1.0.2', '1.0.0'), ['v1.0.2', 'v1.0.1']);
  assert.deepEqual(since('1.0.2', '1.0.2'), []);
  assert.deepEqual(since('1.0.2', '0.9.9'), ['v1.0.2']);
  assert.deepEqual(since('1.0.0', '1.0.2'), []);
  assert.deepEqual(since('1.0.3', '1.0.0'), []);
});

test('update notes carry both languages and the app shows its own half', () => {
  const notes = bilingualNotes('### Fixed\n\n- Fixed it.', '### 修复\n\n- 修好了。');
  assert.equal(localNotes(notes, 'zh').trim(), '### 修复\n\n- 修好了。');
  assert.equal(localNotes(notes, 'en').trim(), '### Fixed\n\n- Fixed it.');
  assert.equal(localNotes(notes, 'ja').trim(), '### Fixed\n\n- Fixed it.');
  assert.equal(localNotes('- 旧版只有中文。', 'en'), '- 旧版只有中文。');
});
