/**
 * Settings is easy to find.
 *
 * Roland, 2026-11-03: "I do not know where the settings button is. We need to
 * have it clear on the app somewhere". Since 2026-10-31 the only door on a
 * phone was the portrait on Home, and a face does not say "settings". Now:
 *
 *  - every page's header names it, with the gear and the word, the way Add is
 *    named beside it;
 *  - not on Settings itself, where it would lead nowhere;
 *  - the portrait on Home still opens it, with a small gear on it.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const kit = read('src', 'components', 'Kit.tsx');
const feed = read('app', '(tabs)', 'feed.tsx');
const settings = read('app', '(tabs)', 'settings.tsx');
const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];

describe('the way to Settings', () => {
  it('sits right under the painting, and nowhere else on a page that has one', () => {
    const top = kit.slice(kit.indexOf('<View style={kit.headerArtCol}>'), kit.indexOf('<View style={kit.headerRow}>'));
    expect(top).toContain('testID="screen-header-art"');
    expect(top.indexOf('{settingsButton}')).toBeGreaterThan(top.indexOf('testID="screen-header-art"'));
    expect(kit).toContain('{art ? null : settingsButton}');
    expect(kit.match(/testID="header-settings"/g)).toHaveLength(1);
  });

  it("is in every page's header, with its name under the gear", () => {
    const button = kit.slice(kit.indexOf('testID="header-settings"'), kit.indexOf('testID="header-settings"') + 500);
    expect(button).toContain('onPress={openSettings}');
    expect(kit).toContain("router.navigate('/(tabs)/settings');");
    expect(button).toContain("accessibilityLabel={t('settings')}");
    expect(button).toMatch(/<Text style=\{\[kit\.hubLabel, \{ color: ui\.muted \}\]\}>\{t\('settings'\)\}<\/Text>/);
    expect(kit).toContain('showSettings = true,');
  });

  it('is not on Settings itself', () => {
    expect(settings).toMatch(/<ScreenHeader[^>]*showSettings=\{false\}/);
  });

  it('is the portrait on Home, now wearing a gear', () => {
    const portrait = feed.slice(feed.indexOf('testID="feed-portrait"'), feed.indexOf('testID="feed-portrait"') + 700);
    expect(portrait).toContain("router.navigate('/(tabs)/settings' as never)");
    expect(portrait).toContain('testID="feed-portrait-gear"');
  });

  it('has its word in every language', () => {
    LANGS.forEach((lang) => {
      expect((TRANSLATIONS[lang] as Record<string, string>).settings || '').not.toBe('');
    });
  });
});
