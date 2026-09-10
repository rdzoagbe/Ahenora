/**
 * The bar promoted the vault to a seat and deleted the More drawer. Two things
 * have to stay true after that, and neither is visible in a screenshot of one
 * phone in one language:
 *
 *  1. Everything the drawer held is still reachable — for a parent AND for a
 *     helper, who never had the vault and cannot hand the device to a child.
 *     A drawer you delete takes its contents with it unless someone checks.
 *  2. Five labels still fit. The old bar had four seats in 278pt; the new one
 *     has five in 338pt, which works out — but only just, and only because the
 *     seat gave back most of its padding. A later nudge to a padding is
 *     exactly the sort of edit that silently ellipsises "Kalender".
 *
 * Source-level for (1) because what matters is that no destination is left
 * without a door anywhere in the app, which is a property of the files.
 * Arithmetic for (2) from the same constants the StyleSheet uses, so the two
 * cannot drift; the browser harness measures the real rendered labels.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import {
  MEASURED_LABEL_PT, NARROWEST_PHONE_PT, PILL_PADDING, SEAT_MIN_WIDTH,
  barFits, contentWidth, pillWidth, seatWidth, slackAt,
} from '../navGeometry';

const APP = join(__dirname, '..', '..', 'app');
const read = (...p: string[]) => readFileSync(join(APP, ...p), 'utf8');

const LAYOUT = read('(tabs)', '_layout.tsx');
const MORE_SHEET = readFileSync(join(APP, '..', 'src', 'components', 'MoreSheet.tsx'), 'utf8');
const FEED = read('(tabs)', 'feed.tsx');

describe('the bar holds the five places, and More holds the rest', () => {
  it('seats exactly Feed, Calendar, Family, Kitchen and Vault, in that order', () => {
    const names = [...LAYOUT.matchAll(/\{ name: '(\w+)',\s+Icon:/g)].map((m) => m[1]);
    expect(names).toEqual(['feed', 'calendar', 'kids', 'kitchen', 'vault']);
  });

  it('keeps More beside the pill, as a button and not a seat', () => {
    // It is not a destination — it holds settings, your account and the
    // hand-over, which are a tool, a record and an action.
    expect(LAYOUT).toContain('testID="tab-more"');
    expect(LAYOUT).toContain('MoreSheet');
  });

  it('gives More no label, because that is where the fifth seat came from', () => {
    // A 10pt word reading "More" under a grid icon said what the icon says
    // and cost 14pt of width. If it comes back, the bar stops fitting.
    const more = LAYOUT.slice(LAYOUT.indexOf('testID="tab-more"'),
                              LAYOUT.indexOf('</TouchableOpacity>', LAYOUT.indexOf('testID="tab-more"')));
    expect(more).not.toMatch(/<Text/);
  });

  it('withholds the vault seat from a helper, whose vault calls are all 403s', () => {
    // Both the seat and the route: a seat we hid but left routable is still
    // reachable by deep link, and the screen behind it cannot load.
    expect(LAYOUT).toMatch(/fullMemberOnly/);
    expect(LAYOUT).toMatch(/name="vault" options=\{\{ href: user\?\.is_helper \? null : undefined \}\}/);
  });
});

describe('everything More holds still has a door', () => {
  it('opens the same drawer from the phone bar and the sidebar', () => {
    expect(LAYOUT).toContain('testID="sidebar-more"');
    expect((LAYOUT.match(/openHouseholdMenu/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('no longer lists the vault, which is a seat now', () => {
    // A place in the bar AND in the drawer is the duplication this sheet's
    // own comments argue against — two taps either way, one list longer.
    expect(MORE_SHEET).not.toMatch(/key: 'vault'/);
    expect(MORE_SHEET).toMatch(/key: 'settings'/);
    expect(MORE_SHEET).toMatch(/key: 'account'/);
    expect(MORE_SHEET).toMatch(/key: 'kid'/);
  });

  it('offers a helper settings but not the hand-over', () => {
    // A helper cannot leave kid mode: that needs a parent's PIN they do not
    // hold, so the row would be a door onto a dead end.
    expect(MORE_SHEET).toMatch(/user\?\.is_helper && it\.key === 'kid'/);
  });

  it('still reaches your account from the Feed portrait', () => {
    expect(FEED).toContain("router.navigate('/(tabs)/account'");
  });
});

describe('five seats and More fit together', () => {
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

  it('would not hold with equal-width seats', () => {
    // The reason the seats size to their words. Equal shares spend as much on
    // "Feed" as on "Calendar", so the bar has to fit five copies of its
    // longest label. In English and German — the two widest, and therefore
    // the two that decide whether the bar fits at all — that overflows the
    // narrowest phone. French and Spanish would squeak in, which is not a
    // reason to ship a bar that breaks in half the languages.
    const overflows = (lang: string) => {
      const widest = Math.max(...MEASURED_LABEL_PT[lang]);
      return seatWidth(widest) * 5 > pillWidth(NARROWEST_PHONE_PT) - PILL_PADDING * 2;
    };
    expect({ en: overflows('en'), de: overflows('de') }).toEqual({ en: true, de: true });
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
    // the total. Raising it back to 46 overflowed a 320pt phone while every
    // label still fitted its own box — which is why the floor is a measured
    // number and not a taste.
    const en = MEASURED_LABEL_PT.en;
    expect(en.filter((l) => l + 4 < SEAT_MIN_WIDTH).length).toBeGreaterThanOrEqual(3);
    const atFortySix = en.reduce((t, l) => t + Math.max(46, l + 4), 0);
    expect(atFortySix).toBeGreaterThan(pillWidth(NARROWEST_PHONE_PT) - PILL_PADDING * 2);
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
