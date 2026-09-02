/**
 * Alternating custody (garde alternée): which home the children are in for a
 * given week is decided by the ISO-week parity a parent set as theirs. A French
 * judgment is written as semaines paires / impaires, so parity IS the schedule.
 */
import { buildMonthDays, custodyIsOurs, isoWeek } from '../utils/date';

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

describe('buildMonthDays — the grid a custody schedule is read off', () => {
  // The month grid used to start on Sunday. That is the US convention, France
  // reads L M M J V S D, and — the part that actually breaks something — an ISO
  // week starts on Monday, so a Sunday-first row spanned TWO custody weeks and
  // changed colour halfway along. Correct per day; unreadable as a schedule.

  it('starts every row on a Monday', () => {
    for (const month of [new Date(2026, 0, 15), new Date(2026, 1, 1), new Date(2026, 10, 30)]) {
      const days = buildMonthDays(month);
      for (let i = 0; i < days.length; i += 7) {
        expect(days[i].date.getDay()).toBe(1);
      }
    }
  });

  it('ends every row on a Sunday', () => {
    const days = buildMonthDays(new Date(2026, 6, 10));
    for (let i = 6; i < days.length; i += 7) {
      expect(days[i].date.getDay()).toBe(0);
    }
  });

  it('always returns whole weeks', () => {
    for (let m = 0; m < 12; m += 1) {
      expect(buildMonthDays(new Date(2026, m, 1)).length % 7).toBe(0);
    }
  });

  it('covers every day of the month exactly once, and marks the padding', () => {
    const days = buildMonthDays(new Date(2026, 6, 1));   // July 2026, 31 days
    const inMonth = days.filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth[0].date.getDate()).toBe(1);
    expect(inMonth[30].date.getDate()).toBe(31);
    expect(new Set(inMonth.map((d) => d.date.getDate())).size).toBe(31);
    days.filter((d) => !d.inMonth).forEach((d) => expect(d.date.getMonth()).not.toBe(6));
  });

  it('gives a whole row the same ISO week, so one number describes it', () => {
    // The reason for all of the above: a row is a custody week. If two days in
    // one row disagreed about the week, the number in the gutter would be a lie
    // and the colour would change mid-row.
    const days = buildMonthDays(new Date(2026, 6, 1));
    for (let i = 0; i < days.length; i += 7) {
      const week = isoWeek(days[i].date).week;
      for (let j = 0; j < 7; j += 1) {
        expect(isoWeek(days[i + j].date).week).toBe(week);
      }
    }
  });

  it('gives a whole row the same custody parity', () => {
    const days = buildMonthDays(new Date(2026, 6, 1));
    for (let i = 0; i < days.length; i += 7) {
      const ours = custodyIsOurs(days[i].date, 'even');
      for (let j = 0; j < 7; j += 1) {
        expect(custodyIsOurs(days[i + j].date, 'even')).toBe(ours);
      }
    }
  });

  it('handles a month that begins on a Sunday without an empty leading row', () => {
    // 1 November 2026 is a Sunday — the worst case for a Monday-first grid.
    const days = buildMonthDays(new Date(2026, 10, 1));
    expect(days[0].date.getDay()).toBe(1);
    expect(days.filter((d) => d.inMonth)).toHaveLength(30);
    expect(days[6].date.getDate()).toBe(1);   // Sunday the 1st closes the first row
  });
});
