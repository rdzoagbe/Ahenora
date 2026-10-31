/**
 * One door, no More.
 *
 * Roland, 2026-10-31, from the review of More and Settings: portrait on Home
 * only. The Home portrait opens Settings, as the design canvas draws it; the
 * More button beside the bar and its drawer are gone; the sidebar on a wide
 * screen has a Settings row instead. Everything the drawer held has a door:
 * your account on Settings' first card, support and feedback under Help and
 * support, and the hand-over with the household on Settings and on each
 * child's own page. This pins:
 *
 *  - the portrait's destination and the sidebar row;
 *  - the drawer's absence from the layout, the store and the components;
 *  - the hand-over's two doors, both withheld from a helper and while the
 *    children's sections are put away;
 *  - the child's line in every language.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const layout = read('app', '(tabs)', '_layout.tsx');
const feed = read('app', '(tabs)', 'feed.tsx');
const settings = read('app', '(tabs)', 'settings.tsx');
const member = read('app', 'member.tsx');
const store = read('src', 'store.tsx');
const geometry = read('src', 'navGeometry.ts');

describe('one door', () => {
  it('is your portrait on Home, and it opens Settings', () => {
    const portrait = feed.slice(feed.indexOf('testID="feed-portrait"'), feed.indexOf('testID="feed-portrait"') + 400);
    expect(portrait).toContain("router.navigate('/(tabs)/settings' as never)");
    expect(portrait).toContain("accessibilityLabel={t('settings')}");
  });

  it('is a Settings row in the sidebar on a wide screen', () => {
    expect(layout).toContain('testID="sidebar-settings"');
    expect(layout).toContain("router.navigate('/(tabs)/settings' as any)");
    expect(layout).toContain("const settingsActive = pathname.endsWith('settings') || pathname.endsWith('account');");
  });
});

describe('no More', () => {
  it('has no button beside the bar and no drawer', () => {
    expect(layout).not.toContain('tab-more');
    expect(layout).not.toContain('sidebar-more');
    expect(layout).not.toContain('MoreSheet');
    expect(fs.existsSync(path.join(__dirname, '..', 'components', 'MoreSheet.tsx'))).toBe(false);
    expect(store).not.toContain('householdMenuOpen');
  });

  it('gives the bar’s whole width to the pill', () => {
    expect(geometry).toContain('return screenWidth - BAR_INSET * 2;');
    expect(geometry).not.toContain('MORE_WIDTH');
    expect(layout).not.toContain('MORE_WIDTH');
  });
});

describe('the hand-over', () => {
  it('sits with the household on Settings', () => {
    expect(settings).toContain('testID="settings-hand-over"');
    expect(settings).toContain('const canHandOver = canSetCustody;');
    expect(settings).toContain('<HandOverSheet visible={showHandOver} onClose={() => setShowHandOver(false)} />');
  });

  it('sits on the child’s own page, naming the child', () => {
    expect(member).toContain('testID="member-hand-over"');
    expect(member).toContain("t('member_hand_over', { name: displayName })");
    expect(member).toContain("kind === 'kid' && !user?.is_helper && !kidsHidden");
    expect(member).toContain('<HandOverSheet visible={handOver} onClose={() => setHandOver(false)} />');
  });

  it('names the child in every language', () => {
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      expect([lang, typeof table.member_hand_over]).toEqual([lang, 'string']);
      expect(table.member_hand_over).toContain('{name}');
    }
  });
});
