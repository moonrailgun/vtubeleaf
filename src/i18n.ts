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

/** Follows the OS language Rust reports, matching native menus and errors; browsers keep navigator.languages. */
export async function initLang() {
  setLang((isTauri() && (await invoke<Lang>('system_language').catch(() => undefined))) || lang);
}

/** Translates `key`, replacing `{name}` placeholders with `vars.name`. */
export function t(key: Key, vars?: Record<string, string | number>) {
  return messages[lang][key].replace(/\{(\w+)\}/g, (match, name: string) =>
    vars && name in vars ? String(vars[name]) : match,
  );
}
