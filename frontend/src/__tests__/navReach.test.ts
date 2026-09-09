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
  COMFORTABLE_PHONE_PT, NARROWEST_PHONE_PT, WIDEST_LABEL_PT,
  labelsFit, seatLabelWidth, seatsFit,
} from '../navGeometry';

const APP = join(__dirname, '..', '..', 'app');
const read = (...p: string[]) => readFileSync(join(APP, ...p), 'utf8');

const LAYOUT = read('(tabs)', '_layout.tsx');
const ACCOUNT = read('(tabs)', 'account.tsx');
const FEED = read('(tabs)', 'feed.tsx');

describe('the bar holds the five places', () => {
  it('seats exactly Feed, Calendar, Family, Kitchen and Vault, in that order', () => {
    const names = [...LAYOUT.matchAll(/\{ name: '(\w+)',\s+Icon:/g)].map((m) => m[1]);
    expect(names).toEqual(['feed', 'calendar', 'kids', 'kitchen', 'vault']);
  });

  it('has no More button left in it', () => {
    expect(LAYOUT).not.toContain('tab-more');
    expect(LAYOUT).not.toContain('MoreSheet');
  });

  it('withholds the vault seat from a helper, whose vault calls are all 403s', () => {
    // Both the seat and the route: a seat we hid but left routable is still
    // reachable by deep link, and the screen behind it cannot load.
    expect(LAYOUT).toMatch(/fullMemberOnly/);
    expect(LAYOUT).toMatch(/name="vault" options=\{\{ href: user\?\.is_helper \? null : undefined \}\}/);
  });
});

describe('everything the More drawer held still has a door', () => {
  it('reaches your account from the Feed portrait and the sidebar', () => {
    expect(FEED).toContain("router.navigate('/(tabs)/account'");
    expect(LAYOUT).toContain("router.navigate('/(tabs)/account'");
  });

  it('reaches settings and the hand-over from the account screen', () => {
    expect(ACCOUNT).toContain("router.navigate('/(tabs)/settings')");
    expect(ACCOUNT).toContain('HandOverSheet');
  });

  it('offers a helper settings but not the hand-over', () => {
    // A helper cannot leave kid mode: that needs a parent's PIN they do not
    // hold, so the row would be a door onto a dead end.
    const rows = ACCOUNT.slice(ACCOUNT.indexOf('const householdRows'), ACCOUNT.indexOf('];', ACCOUNT.indexOf('const householdRows')));
    expect(rows).toMatch(/key: 'settings'/);
    expect(rows).toMatch(/user\?\.is_helper \? \[\] : \[\{ key: 'hand-over'/);
  });
});

describe('five seats fit', () => {
  const WIDTHS = [NARROWEST_PHONE_PT, 360, 375, 390, 412, 430];

  it('never overflows the pill on any phone we support', () => {
    for (const width of WIDTHS) {
      expect({ width, seats: seatsFit(width, 5) }).toEqual({ width, seats: true });
    }
  });

  it('fits every label at full size on a normal phone, with room to spare', () => {
    // Outright, not "after adjustsFontSizeToFit": that prop is native-only, so
    // on the web build nothing shrinks. And with slack, because "it fits at
    // exactly zero" is one font-metric revision away from being wrong.
    for (const width of WIDTHS.filter((w) => w >= COMFORTABLE_PHONE_PT)) {
      expect({ width, labels: labelsFit(width, 5) }).toEqual({ width, labels: true });
      expect(seatLabelWidth(width, 5) - WIDEST_LABEL_PT).toBeGreaterThan(1);
    }
  });

  it('degrades rather than overlaps on the narrowest phone', () => {
    // 320pt is the one width where the longest German label runs out of room.
    // It then shrinks (native) or ellipsises (web) — both fine. What is not
    // fine is a seat drawing over its neighbour, which nothing in the bar
    // clips, so the cap has to be structural.
    expect(labelsFit(NARROWEST_PHONE_PT, 5)).toBe(false);
    expect(LAYOUT).toMatch(/maxWidth: '100%'/);
    expect(LAYOUT).toContain('adjustsFontSizeToFit');
  });

  it('would not fit a sixth seat on the phone most people hold', () => {
    // Guards the arithmetic itself: if this ever passes, the formula has
    // stopped describing the bar and the checks above prove nothing. Five is
    // not a comfortable number of seats, it is the last one that works on a
    // 390pt phone — a 430pt one would take six, which is not a reason to add
    // one, because the bar has to hold on the small phone too.
    expect(labelsFit(390, 6)).toBe(false);
  });
});
