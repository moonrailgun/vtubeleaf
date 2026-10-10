import en from '../CHANGELOG.md?raw';
import zh from '../CHANGELOG.zh-CN.md?raw';
import { parseChangelog, type NoteGroup, type Release } from './changelog';
import { lang, t } from './i18n.ts';

// main.tsx sets the language before importing the windows that use this.
export const releases = parseChangelog(lang === 'zh' ? zh : en);

const inline = (text: string) =>
  text.split('`').map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));

export function Notes({ groups }: { groups: NoteGroup[] }) {
  return groups.map((group, i) => (
    <div key={i} className="mt-2 first:mt-0">
      {group.title && <h4 className="font-semibold text-foreground">{group.title}</h4>}
      {group.text.map((line, j) => (
        <p key={j}>{inline(line)}</p>
      ))}
      {!!group.items.length && (
        <ul className="list-disc pl-5">
          {group.items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </ul>
      )}
    </div>
  ));
}

export function ReleaseList({ list, current }: { list: Release[]; current?: string }) {
  return list.map((release) => (
    <article key={release.version} className="mt-4 first:mt-0">
      <h3 className="flex items-baseline gap-2 font-semibold text-foreground">
        {release.version}
        {release.date && <span className="font-normal text-muted-foreground">{release.date}</span>}
        {current && release.version === `v${current}` && (
          <span className="font-normal text-primary">{t('release.currentVersion')}</span>
        )}
      </h3>
      <div className="mt-1 break-words text-muted-foreground">
        <Notes groups={release.groups} />
      </div>
    </article>
  ));
}
