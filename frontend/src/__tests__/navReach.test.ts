/**
 * The bar is the five places, and nothing else. The More button beside the
 * pill went on 2026-10-31 (Roland, from the review of More and Settings:
 * portrait on Home only); everything it held is on Settings, which your
 * portrait on Home opens. Two things have to stay true, and neither is
 * visible in a screenshot of one phone in one language:
 *
 *  1. Everything the drawer held is still reachable — for a parent AND for a
 *     helper, who never had the vault and cannot hand the device to a child.
 *     A drawer you delete takes its contents with it unless someone checks.
 *  2. Five labels still fit. They fitted beside More on the narrowest phone
 *     with 9pt to spare; without More the pill spans the bar, and a later
 *     nudge to a padding is still the sort of edit that silently ellipsises
 *     "Kalender".
 *
 * Source-level for (1) because what matters is that no destination is left
 * without a door anywhere in the app, which is a property of the files.
 * Arithmetic for (2) from the same constants the StyleSheet uses, so the two
 * cannot drift; the browser harness measures the real rendered labels.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

import {
  MEASURED_LABEL_PT, NARROWEST_PHONE_PT, PILL_PADDING, SEAT_MIN_WIDTH,
  barFits, contentWidth, pillWidth, seatWidth, slackAt,
} from '../navGeometry';

const APP = join(__dirname, '..', '..', 'app');
const read = (...p: string[]) => readFileSync(join(APP, ...p), 'utf8');

const LAYOUT = read('(tabs)', '_layout.tsx');
const FEED = read('(tabs)', 'feed.tsx');
const SETTINGS = read('(tabs)', 'settings.tsx');
const MEMBER = read('member.tsx');
const MORE_SHEET_PATH = join(APP, '..', 'src', 'components', 'MoreSheet.tsx');

describe('the bar holds the five places, and nothing else', () => {
  it('seats exactly Feed, Calendar, Family, Kitchen and Vault, in that order', () => {
    const names = [...LAYOUT.matchAll(/\{ name: '(\w+)',\s+Icon:/g)].map((m) => m[1]);
    expect(names).toEqual(['feed', 'calendar', 'kids', 'kitchen', 'vault']);
  });

  it('has no More button and no drawer', () => {
    // What More held is on Settings; the width it took went to the seats.
    expect(LAYOUT).not.toContain('tab-more');
    expect(LAYOUT).not.toContain('MoreSheet');
    expect(LAYOUT).not.toContain('openHouseholdMenu');
    expect(existsSync(MORE_SHEET_PATH)).toBe(false);
  });
  it('withholds the vault seat from a helper, whose vault calls are all 403s', () => {
    // Both the seat and the route: a seat we hid but left routable is still
    // reachable by deep link, and the screen behind it cannot load.
    expect(LAYOUT).toMatch(/fullMemberOnly/);
    expect(LAYOUT).toMatch(/name="vault" options=\{\{ href: user\?\.is_helper \? null : undefined \}\}/);
  });
});

describe('everything the drawer held still has a door', () => {
  it('opens Settings from your portrait on Home, and from the sidebar on a wide screen', () => {
    expect(FEED).toContain("router.navigate('/(tabs)/settings'");
    expect(LAYOUT).toContain('testID="sidebar-settings"');
    expect(LAYOUT).not.toContain('sidebar-more');
  });
  it('reaches your account from the first card on Settings', () => {
    expect(SETTINGS).toContain('testID="settings-open-account"');
  });
  it('offers the hand-over with the household on Settings and on the child’s own page', () => {
    expect(SETTINGS).toContain('testID="settings-hand-over"');
    expect(SETTINGS).toContain('<HandOverSheet visible={showHandOver}');
    expect(MEMBER).toContain('testID="member-hand-over"');
    expect(MEMBER).toContain('<HandOverSheet visible={handOver}');
  });
  it('offers a helper settings but not the hand-over', () => {
    // A helper cannot leave kid mode: that needs a parent's PIN they do not
    // hold, so the row would be a door onto a dead end.
    expect(SETTINGS).toContain('const canHandOver = canSetCustody;');
    expect(SETTINGS).toMatch(/const canSetCustody = !!user && !user\.is_helper/);
    expect(MEMBER).toContain("kind === 'kid' && !user?.is_helper && !kidsHidden");
  });
  it('offers feedback and support under Help and support on Settings', () => {
    expect(SETTINGS).toContain('testID="settings-send-feedback"');
    expect(SETTINGS).toContain('testID="settings-contact-support"');
  });
});
describe('five seats fit the bar', () => {
  const WIDTHS = [NARROWEST_PHONE_PT, 360, 375, 390, 412, 430];
  const LANGS = Object.keys(MEASURED_LABEL_PT);

  it('holds on every phone we support, in every language we ship', () => {
    for (const width of WIDTHS) {
      expect({ width, fits: barFits(width) }).toEqual({ width, fits: true });
    }
  });

  it('keeps real room to spare even at its tightest', () => {
    // "It fits at exactly zero" is one font-metric revision from being wrong,
    // and the numbers here are browser measurements that can move.
    for (const lang of LANGS) {
      expect({ lang, slack: slackAt(NARROWEST_PHONE_PT, lang) >= 8 })
        .toEqual({ lang, slack: true });
    }
  });

  it('would hold even with equal-width seats, now that More is gone', () => {
    // Beside More, equal shares overflowed the narrowest phone in English and
    // German, which was the reason the seats size to their words. The pill
    // now spans the bar, so the seats are sized to content for their look,
    // not to fit — worth knowing before anyone reaches for that lever again.
    const overflows = (lang: string) => {
      const widest = Math.max(...MEASURED_LABEL_PT[lang]);
      return seatWidth(widest) * 5 > pillWidth(NARROWEST_PHONE_PT) - PILL_PADDING * 2;
    };
    expect({ en: overflows('en'), de: overflows('de') }).toEqual({ en: false, de: false });
  });
  it('buys back real width in every language by sizing to content', () => {
    for (const lang of LANGS) {
      const widest = Math.max(...MEASURED_LABEL_PT[lang]);
      const saved = seatWidth(widest) * 5 - contentWidth(MEASURED_LABEL_PT[lang]);
      expect({ lang, saved: saved > 5 }).toEqual({ lang, saved: true });
    }
  });

  it('is held back by the seat floor, not by the words', () => {
    // Four of the five labels are shorter than the floor, so minWidth decides
    // the total. At 46 the five seats spent 235pt; beside More that overflowed
    // a 320pt phone while every label still fitted its own box, which is why
    // the floor is a measured number and not a taste. The pill has the whole
    // bar now, so 46 would fit again — and the floor stays 40 all the same.
    const en = MEASURED_LABEL_PT.en;
    expect(en.filter((l) => l + 4 < SEAT_MIN_WIDTH).length).toBeGreaterThanOrEqual(3);
    const atFortySix = en.reduce((t, l) => t + Math.max(46, l + 4), 0);
    expect(atFortySix).toBe(235);
    expect(atFortySix).toBeLessThanOrEqual(pillWidth(NARROWEST_PHONE_PT) - PILL_PADDING * 2);
  });

  it('English is the widest set, not German', () => {
    // Pinned because the opposite was assumed all session, and two rounds of
    // arithmetic were built on it. If a label changes and this flips, the
    // table above needs re-measuring, not the assumption re-asserting.
    const totals = Object.fromEntries(
      LANGS.map((l) => [l, contentWidth(MEASURED_LABEL_PT[l])]));
    expect(Math.max(...Object.values(totals))).toEqual(totals.en);
    expect(totals.en).toBeGreaterThan(totals.de);
  });
});
