/**
 * Settings is easy to find, in one place.
 *
 * Roland, 2026-11-03: "I do not know where the settings button is. We need to
 * have it clear on the app somewhere". Then, on a first try that named it on
 * every page: "it should sit right under the image at the top but that's it",
 * and "we do not need it on every page do we now? That's not how the app
 * should work". So:
 *
 *  - the one door stays your portrait on Home, now with the word under it
 *    and a small gear on it;
 *  - no other page's header carries a Settings button.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const kit = read('src', 'components', 'Kit.tsx');
const feed = read('app', '(tabs)', 'feed.tsx');
const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];

describe('the way to Settings', () => {
  it('is the portrait on Home, with the word right under the picture', () => {
    const at = feed.indexOf('testID="feed-portrait"');
    const portrait = feed.slice(at, at + 900);
    expect(portrait).toContain("router.navigate('/(tabs)/settings' as never)");
    expect(portrait).toContain('testID="feed-portrait-gear"');
    const picture = portrait.indexOf('<PersonAvatar');
    const word = portrait.indexOf('testID="feed-portrait-label"');
    expect(picture).toBeGreaterThan(-1);
    expect(word).toBeGreaterThan(picture);
    expect(portrait).toMatch(/\{t\('settings'\)\}<\/Text>/);
  });

  it('is not repeated on every page', () => {
    expect(kit).not.toContain('header-settings');
    expect(kit).not.toContain('showSettings');
  });

  it('has its word in every language', () => {
    LANGS.forEach((lang) => {
      expect((TRANSLATIONS[lang] as Record<string, string>).settings || '').not.toBe('');
    });
  });
});
