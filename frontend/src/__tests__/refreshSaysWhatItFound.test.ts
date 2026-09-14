/**
 * A refresh has to say what it found.
 *
 * Roland, on the Calendar: "when I pull down I do not get the popup that says
 * what's been imported — that's why I think it's not working."
 *
 * The gesture worked. The spinner turned, everything reloaded, and the screen
 * said nothing — so on a day when nothing had changed, a refresh that ran was
 * indistinguishable from a gesture that never fired. He concluded the feature
 * was broken, which is a fair reading of the evidence he had, and no test in
 * the repository disagreed: the existing one compares what `handleRefresh`
 * RELOADS against the focus effect, and would pass with the control
 * unmounted entirely.
 *
 * The principle was already written down one layer up, in that test:
 *
 *   "A spinner that runs, finishes, and leaves the screen saying the same
 *    thing is worse than no spinner. It is an answer, and the answer is wrong."
 *
 * That was about the data. This is the same sentence about the person.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { refreshOutcome } from '../refreshOutcome';

const CALENDAR = readFileSync(
  join(__dirname, '..', '..', 'app', '(tabs)', 'calendar.tsx'), 'utf8');
const I18N = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');

const inEveryLanguage = (key: string) => I18N.split('\n')
  .filter((l) => new RegExp(`^\\s*["']?${key}["']?:`).test(l)).length;

describe('what a refresh says', () => {
  it('says so when nothing changed, rather than nothing at all', () => {
    // The whole bug. Silence here is what reads as a broken gesture.
    expect(refreshOutcome({ items: 4 }, { items: 4 })).toEqual(
      { key: 'refresh_up_to_date' });
  });

  it('counts what arrived', () => {
    expect(refreshOutcome({ items: 4 }, { items: 5 })).toEqual(
      { key: 'refresh_one_new' });
    expect(refreshOutcome({ items: 4 }, { items: 7 })).toEqual(
      { key: 'refresh_many_new', params: { n: '3' } });
  });

  it('puts something awaiting a decision ahead of something merely new', () => {
    // Events proposed by a sync need the person; new events only inform them.
    expect(refreshOutcome({ items: 4, waiting: 0 }, { items: 9, waiting: 2 })).toEqual(
      { key: 'refresh_waiting', params: { n: '2' } });
  });

  it('reports a drop as up to date rather than as a loss', () => {
    // A co-parent ticking things off is not news, and "3 fewer" would read as
    // though this device had lost something.
    expect(refreshOutcome({ items: 7 }, { items: 4 })).toEqual(
      { key: 'refresh_up_to_date' });
    expect(refreshOutcome({ items: 4, waiting: 3 }, { items: 4, waiting: 1 })).toEqual(
      { key: 'refresh_up_to_date' });
  });

  it('treats a screen with no waiting-list as having nothing waiting', () => {
    expect(refreshOutcome({ items: 1 }, { items: 1 })).toEqual(
      { key: 'refresh_up_to_date' });
  });

  it('has its words in every language the app ships', () => {
    for (const key of ['refresh_up_to_date', 'refresh_one_new',
                       'refresh_many_new', 'refresh_waiting']) {
      expect(inEveryLanguage(key)).toBe(4);
    }
  });
});

describe('the Calendar actually says it', () => {
  it('takes a before snapshot and speaks afterwards', () => {
    expect(CALENDAR).toContain('const before = { items: cardsRef.current.length, waiting: pendingRef.current };');
    expect(CALENDAR).toContain('const said = refreshOutcome(before, { items, waiting });');
    expect(CALENDAR).toContain('showToast(t(said.key, said.params)');
  });

  it('reads the new counts from what the loaders returned', () => {
    // Not from state: a caller in the same tick sees the OLD count, which is
    // how a refresh comes to report that nothing arrived when something did.
    expect(CALENDAR).toContain('const [cardsOut, pendingOut] = await Promise.allSettled([');
    expect(CALENDAR).toMatch(/cardsOut\.status === 'fulfilled' && cardsOut\.value !== null/);
    expect(CALENDAR).toMatch(/pendingOut\.status === 'fulfilled' && pendingOut\.value !== null/);
  });

  it('keeps the before-value when a loader could not answer', () => {
    // A failed count must not be read as zero — that would announce that a
    // queue had emptied when the truth is that nobody asked.
    expect(CALENDAR).toContain('? cardsOut.value : before.items;');
    expect(CALENDAR).toContain('? pendingOut.value : before.waiting;');
    expect(CALENDAR).toContain('      // null, not 0:');
  });

  it('still reloads everything opening the tab would', () => {
    // The earlier fix. Saying what happened must not cost what happens.
    for (const call of ['load()', 'refreshPending()', 'refreshSubscription?.()']) {
      expect(CALENDAR).toContain(call);
    }
  });
});
