import test from 'node:test';
import assert from 'node:assert/strict';
import { changelogNotes, checkUnreleased, releaseChangelog } from '../scripts/changelog.mjs';
import { parseChangelog, releasesSince } from '../src/changelog.ts';

const draft =
  '# 更新记录\n\n## 未发布\n\n### 修复\n\n- 修好了。\n\n## v1.0.0 · 2026-09-19\n\n- 第一版。\n';

test('release turns the unreleased notes into the version section', () => {
  const released = releaseChangelog(draft, 'v1.0.1', '2026-10-07');
  assert.equal(
    released,
    '# 更新记录\n\n## 未发布\n\n## v1.0.1 · 2026-10-07\n\n### 修复\n\n- 修好了。\n\n## v1.0.0 · 2026-09-19\n\n- 第一版。\n',
  );
  assert.equal(changelogNotes(released, 'v1.0.1'), '### 修复\n\n- 修好了。');
  assert.equal(changelogNotes(released, 'v1.0.0'), '- 第一版。');
});

test('release refuses empty, missing or duplicate notes', () => {
  assert.throws(
    () => releaseChangelog(releaseChangelog(draft, 'v1.0.1', 'd'), 'v1.0.2', 'd'),
    /为空/,
  );
  assert.throws(() => releaseChangelog('# 更新记录\n', 'v1.0.1', 'd'), /缺少/);
  assert.throws(() => releaseChangelog(draft, 'v1.0.0', 'd'), /已有 v1\.0\.0/);
  assert.throws(() => changelogNotes(draft, 'v9.9.9'), /缺少 v9\.9\.9/);
  assert.doesNotThrow(() => checkUnreleased(draft));
});

test('the app reads released sections and picks the ones installed since last launch', () => {
  const released = releaseChangelog(
    releaseChangelog(draft, 'v1.0.1', '2026-10-07').replace(
      '## 未发布\n',
      '## 未发布\n\n介绍\n- 新功能\n',
    ),
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
