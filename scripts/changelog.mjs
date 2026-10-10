import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// English is the default changelog; the Chinese one carries the same sections.
export const changelogs = [
  ['CHANGELOG.md', '## Unreleased'],
  ['CHANGELOG.zh-CN.md', '## 未发布'],
];
// Each chunk is one "## " section; the first chunk is the file title.
const sections = (text) => text.split(/^(?=## )/m);
const heading = (section) => section.match(/^.*/)[0].trim();
const body = (section) => section.replace(/^.*/, '');

// Runs before the version bump, so it can only check that notes were written.
export function checkUnreleased(text, unreleased) {
  const all = sections(text);
  const index = all.findIndex((section) => heading(section) === unreleased);
  assert.ok(index > 0, `缺少「${unreleased}」一节`);
  assert.ok(body(all[index]).trim(), `「${unreleased}」为空，请先写好更新说明再发版`);
  return { all, index };
}

// Turns the unreleased section into the tag's section and opens a new empty one above it.
export function releaseChangelog(text, unreleased, tag, date) {
  const { all, index } = checkUnreleased(text, unreleased);
  assert.ok(!all.some((section) => heading(section).split(' ')[1] === tag), `已有 ${tag}`);
  all[index] = `${unreleased}\n\n## ${tag} · ${date}${body(all[index])}`;
  return all.join('');
}

export function changelogNotes(text, tag) {
  const section = sections(text).find((section) => heading(section).split(' ')[1] === tag);
  const notes = section && body(section).trim();
  assert.ok(notes, `缺少 ${tag} 的更新说明`);
  return notes;
}

// GitHub Release and in-app update notes; the app shows one half by language (src/changelog.ts).
export const bilingualNotes = (en, zh) => `${en}\n\n---\n\n${zh}`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, tag] = process.argv.slice(2);
  try {
    assert.ok(
      ['check', 'release', 'notes'].includes(command),
      '用法：changelog.mjs check|release|notes <tag>',
    );
    const { version } = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    );
    const now = new Date();
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((part) => String(part).padStart(2, '0'))
      .join('-');
    const results = changelogs.map(([name, unreleased]) => {
      const file = new URL(`../${name}`, import.meta.url);
      try {
        const text = readFileSync(file, 'utf8');
        if (command === 'check') return checkUnreleased(text, unreleased);
        if (command === 'notes') return changelogNotes(text, tag);
        return [file, releaseChangelog(text, unreleased, `v${version}`, date)];
      } catch (error) {
        throw new Error(`${name}：${error instanceof Error ? error.message : error}`);
      }
    });
    if (command === 'notes') process.stdout.write(`${bilingualNotes(...results)}\n`);
    // Written only after both pass, so a failure never releases just one of them.
    if (command === 'release') for (const [file, text] of results) writeFileSync(file, text);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
