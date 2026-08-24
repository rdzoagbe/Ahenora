/**
 * Alternating custody (garde alternée): which home the children are in for a
 * given week is decided by the ISO-week parity a parent set as theirs. A French
 * judgment is written as semaines paires / impaires, so parity IS the schedule.
 */
import { custodyIsOurs, isoWeek } from '../utils/date';

describe('custodyIsOurs', () => {
  it('is ours on even weeks when we hold the even weeks', () => {
    // 2026-01-05 is a Monday in ISO week 2 (even).
    const monday = new Date(2026, 0, 5);
    expect(isoWeek(monday).even).toBe(true);
    expect(custodyIsOurs(monday, 'even')).toBe(true);
    expect(custodyIsOurs(monday, 'odd')).toBe(false);
  });

  it('is ours on odd weeks when we hold the odd weeks', () => {
    // 2026-01-12 is a Monday in ISO week 3 (odd).
    const monday = new Date(2026, 0, 12);
    expect(isoWeek(monday).even).toBe(false);
    expect(custodyIsOurs(monday, 'odd')).toBe(true);
    expect(custodyIsOurs(monday, 'even')).toBe(false);
  });

  it('holds across every day of the same ISO week', () => {
    // The whole of ISO week 3, 2026 (Mon 12th – Sun 18th) is one custody block.
    for (let d = 12; d <= 18; d += 1) {
      expect(custodyIsOurs(new Date(2026, 0, d), 'odd')).toBe(true);
    }
  });

  it('alternates from one week to the next', () => {
    const wk2 = new Date(2026, 0, 5);   // even
    const wk3 = new Date(2026, 0, 12);  // odd
    expect(custodyIsOurs(wk2, 'even')).toBe(true);
    expect(custodyIsOurs(wk3, 'even')).toBe(false);
  });
});
