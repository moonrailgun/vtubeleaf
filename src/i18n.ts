import { invoke, isTauri } from '@tauri-apps/api/core';
import en from './locales/en.ts';
import zh from './locales/zh.ts';
import ja from './locales/ja.ts';
import es from './locales/es.ts';
import fr from './locales/fr.ts';

export type Key = keyof typeof en;
export type Lang = 'en' | 'zh' | 'ja' | 'es' | 'fr';

// Every locale must define every key; tsc fails on a missing translation.
const messages: Record<Lang, Record<Key, string>> = { en, zh, ja, es, fr };
export const langs = Object.keys(messages) as Lang[];

/** Picks the first supported language from the system preference list, else English. */
export function detectLang(languages: readonly string[]): Lang {
  for (const tag of languages) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (base in messages) return base as Lang;
  }
  return 'en';
}

export let lang: Lang = detectLang(globalThis.navigator?.languages ?? []);

export function setLang(value: Lang) {
  lang = value;
  if (typeof document !== 'undefined') document.documentElement.lang = value;
}

/** Uses the language Rust picked at startup (saved choice, else the OS), matching native menus and errors. */
export async function initLang() {
  if (isTauri()) {
    setLang((await invoke<Lang>('ui_language').catch(() => undefined)) || lang);
    return;
  }
  // Browser preview keeps its settings in localStorage; without a saved choice, navigator.languages wins.
  let saved: unknown;
  try {
    saved = JSON.parse(localStorage.getItem('vtubeleaf-preview') ?? 'null')?.language;
  } catch {}
  setLang(langs.includes(saved as Lang) ? (saved as Lang) : lang);
}

/** Translates `key`, replacing `{name}` placeholders with `vars.name`. */
export function t(key: Key, vars?: Record<string, string | number>) {
  return messages[lang][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    vars && name in vars ? String(vars[name]) : match,
  );
}
