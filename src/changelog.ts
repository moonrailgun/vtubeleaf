export type NoteGroup = { title: string; text: string[]; items: string[] };
export type Release = { version: string; date: string; groups: NoteGroup[] };

// Reads the subset of Markdown that CHANGELOG.md uses: "### group", "- item" and plain lines.
export function parseNotes(notes: string) {
  const groups: NoteGroup[] = [];
  for (const line of notes.split(/\r?\n/).map((line) => line.trim())) {
    if (!line) continue;
    const heading = line.startsWith('### ');
    if (heading || !groups.length)
      groups.push({ title: heading ? line.slice(4) : '', text: [], items: [] });
    if (heading) continue;
    const group = groups[groups.length - 1];
    if (line.startsWith('- ')) group.items.push(line.slice(2));
    else group.text.push(line);
  }
  return groups;
}

// Update notes are the English notes, a "---" line, then the Chinese ones (scripts/changelog.mjs).
// Chinese reads its half and every other language reads English; single-language notes show as is.
export function localNotes(notes: string, lang: string) {
  const [en, zh = en] = notes.split(/^---\r?$/m);
  return lang === 'zh' ? zh : en;
}

// Newest first; an empty unreleased section is dropped.
export function parseChangelog(text: string): Release[] {
  return text
    .split(/^(?=## )/m)
    .slice(1)
    .map((section) => {
      const [heading, ...body] = section.split(/\r?\n/);
      const [version, date = ''] = heading.slice(3).split(' · ');
      return { version: version.trim(), date: date.trim(), groups: parseNotes(body.join('\n')) };
    })
    .filter((release) => release.groups.length);
}

// The releases installed since the user last saw the app, newest first. When the last seen
// version is not in the changelog (an unpublished or development build), only the current one.
export function releasesSince(releases: Release[], current: string, lastSeen: string) {
  const start = releases.findIndex((release) => release.version === `v${current}`);
  if (start < 0 || lastSeen === current) return [];
  const end = releases.findIndex((release) => release.version === `v${lastSeen}`);
  return releases.slice(start, end < 0 ? start + 1 : end);
}
