import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLang } from '../src/i18n.ts';
import en from '../src/locales/en.ts';
import zh from '../src/locales/zh.ts';
import ja from '../src/locales/ja.ts';
import es from '../src/locales/es.ts';
import fr from '../src/locales/fr.ts';

test('system language picks the first supported language, else English', () => {
  assert.equal(detectLang(['zh-CN', 'en-US']), 'zh');
  assert.equal(detectLang(['zh-Hant-TW']), 'zh');
  assert.equal(detectLang(['de-DE', 'ja-JP']), 'ja');
  assert.equal(detectLang(['es-419']), 'es');
  assert.equal(detectLang(['fr_CA']), 'fr');
  assert.equal(detectLang(['de-DE', 'ko-KR']), 'en');
  assert.equal(detectLang([]), 'en');
});

test('every locale has the same keys and placeholders as English', () => {
  const vars = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [name, locale] of Object.entries({ zh, ja, es, fr })) {
    assert.deepEqual(Object.keys(locale).sort(), Object.keys(en).sort(), name);
    for (const [key, text] of Object.entries(en))
      assert.deepEqual(vars((locale as Record<string, string>)[key]), vars(text), `${name} ${key}`);
  }
});
