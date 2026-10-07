import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const unreleased = '## 未发布';
// Each chunk is one "## " section; the first chunk is the file title.
const sections = (text) => text.split(/^(?=## )/m);
const heading = (section) => section.match(/^.*/)[0].trim();
const body = (section) => section.replace(/^.*/, '');

// Runs before the version bump, so it can only check that notes were written.
export function checkUnreleased(text) {
  const all = sections(text);
  const index = all.findIndex((section) => heading(section) === unreleased);
  assert.ok(index > 0, `CHANGELOG.md 缺少「${unreleased}」一节`);
  assert.ok(
    body(all[index]).trim(),
    `CHANGELOG.md 的「${unreleased}」为空，请先写好更新说明再发版`,
  );
  return { all, index };
}

// Turns the unreleased section into the tag's section and opens a new empty one above it.
export function releaseChangelog(text, tag, date) {
  const { all, index } = checkUnreleased(text);
  assert.ok(
    !all.some((section) => heading(section).split(' ')[1] === tag),
    `CHANGELOG.md 已有 ${tag}`,
  );
  all[index] = `${unreleased}\n\n## ${tag} · ${date}${body(all[index])}`;
  return all.join('');
}

export function changelogNotes(text, tag) {
  const section = sections(text).find((section) => heading(section).split(' ')[1] === tag);
  const notes = section && body(section).trim();
  assert.ok(notes, `CHANGELOG.md 缺少 ${tag} 的更新说明`);
  return notes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = new URL('../CHANGELOG.md', import.meta.url);
  const [command, tag] = process.argv.slice(2);
  try {
    const text = readFileSync(file, 'utf8');
    if (command === 'notes') {
      process.stdout.write(`${changelogNotes(text, tag)}\n`);
    } else if (command === 'check') {
      checkUnreleased(text);
    } else {
      assert.equal(command, 'release', '用法：changelog.mjs check|release|notes <tag>');
      const { version } = JSON.parse(
        readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
      );
      const now = new Date();
      const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map((part) => String(part).padStart(2, '0'))
        .join('-');
      writeFileSync(file, releaseChangelog(text, `v${version}`, date));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
