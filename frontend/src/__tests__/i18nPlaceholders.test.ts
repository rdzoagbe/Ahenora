/**
 * Placeholders that actually get replaced.
 *
 * `translate()` builds `RegExp('\\{' + key + '\\}')` — so the syntax is a
 * SINGLE brace, `{n}`. A doubled `{{n}}` is not simply ignored: the inner
 * `{n}` matches, and the leftover brace ships. "7 a day" becomes "{7} a day".
 *
 * That is a hard mistake to catch by eye — it looks right in the source, and
 * in three of the four languages nobody reading the diff can spot it. It got
 * as far as a browser harness before anything noticed, so it is pinned here
 * where it costs nothing to check.
 */

import { TRANSLATIONS, translate } from '../i18n';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];

describe('interpolation', () => {
  it('substitutes a single-brace placeholder', () => {
    expect(translate('en', 'kids_stars_to_go', { n: 7 })).toBe('7 more');
  });

  it('leaves no stray brace behind, in any language', () => {
    LANGS.forEach((lang) => {
      Object.entries(TRANSLATIONS[lang]).forEach(([key, value]) => {
        expect(`${lang}.${key}: ${value}`).not.toMatch(/\{\{|\}\}/);
      });
    });
  });

  it('uses placeholder names the code can actually fill', () => {
    // A typo'd name is the same failure wearing a different hat: the brace
    // survives because nothing ever matches it.
    LANGS.forEach((lang) => {
      Object.entries(TRANSLATIONS[lang]).forEach(([key, value]) => {
        const names = [...String(value).matchAll(/\{([^}]*)\}/g)].map((m) => m[1]);
        names.forEach((name) => {
          expect(`${lang}.${key} -> {${name}}`).toMatch(/\{[a-z][a-zA-Z0-9_]*\}/);
        });
      });
    });
  });

  it('keeps the same placeholders in every translation of a key', () => {
    // A French string missing {n} silently drops the number.
    const placeholders = (v: string) =>
      [...String(v).matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort().join(',');
    Object.entries(TRANSLATIONS.en).forEach(([key, en]) => {
      LANGS.forEach((lang) => {
        const other = TRANSLATIONS[lang][key];
        if (other === undefined) return;
        expect(`${lang}.${key}`).toBe(
          placeholders(other) === placeholders(en) ? `${lang}.${key}` : `MISMATCH ${lang}.${key}`,
        );
      });
    });
  });
});
