/**
 * A star lands on the day it was earned, where the family is.
 *
 * The arithmetic is tested in weekStars.test.ts; this is the wiring: the zone
 * travels with a parent's star, and the row reads today off the reader's
 * calendar (the server's half is tests/test_a_star_lands_on_the_day_it_was_earned.py).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');

describe('the parent’s zone goes with the star', () => {
  it('is sent on every adjustment', () => {
    expect(read('api.ts')).toContain("body: { ...data, timezone: deviceTimeZone() },");
  });
});

describe('the row reads today off the reader’s calendar', () => {
  it('defaults to the device’s local day', () => {
    const src = read('weekStars.ts');
    expect(src).toContain('localToday: string = localDayIso(now)');
    expect(src).toContain('isToday: day === localToday,');
    expect(src).toContain('isFuture: day > localToday,');
  });
});
