/**
 * The week the child's page draws, against the week the server counts.
 *
 * Two numbers describe the same seven days — the meter (the server's
 * week_earned) and the row of day cells (built here from the ledger). Every
 * test below is really the same assertion: they agree.
 */
import { weekDayCells, weekStartUTC, weekTotal } from '../weekStars';

// A Wednesday, so there is a settled Monday and Tuesday behind it and a
// Thursday ahead — the shape most of these rules need.
const WED = new Date('2026-09-02T10:00:00.000Z');
const monday = weekStartUTC(WED);
const dayOfWeek = (i: number, hour = 9) =>
  new Date(monday.getTime() + i * 86400000 + hour * 3600000).toISOString();

const txn = (delta: number, awardedFor: string, givenAt?: string) => ({
  delta,
  awarded_for: awardedFor,
  created_at: givenAt || awardedFor,
});

describe('weekStartUTC', () => {
  it('is the Monday of the week, at UTC midnight', () => {
    // The server rolls the meter at UTC Monday. Local midnight would put the
    // row and the meter on different weeks for a whole timezone offset.
    expect(monday.getUTCDay()).toBe(1);
    expect(monday.getUTCHours()).toBe(0);
    expect(monday.toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });

  it('treats Sunday as the end of the week, not the start', () => {
    const sunday = new Date('2026-09-06T23:00:00.000Z');
    expect(weekStartUTC(sunday).toISOString()).toBe('2026-08-31T00:00:00.000Z');
  });
});

describe('weekDayCells', () => {
  const cells = (entries: any[], now = WED) => weekDayCells(entries, now, 'en-GB');

  it('gives seven cells, Monday first', () => {
    const out = cells([]);
    expect(out).toHaveLength(7);
    expect(out[0].name).toBe('Monday');
    expect(out[6].name).toBe('Sunday');
  });

  it('credits a star to the day it was earned for, not the day it was given', () => {
    // A parent catching up on Wednesday logs Tuesday's job. The meter counts
    // it on Tuesday, so the row has to as well.
    const out = cells([txn(3, dayOfWeek(1), dayOfWeek(2))]);
    expect(out[1].earned).toBe(3);
    expect(out[2].earned).toBe(0);
  });

  it('falls back to when it was given if no day was named', () => {
    const out = cells([{ delta: 4, created_at: dayOfWeek(2) }]);
    expect(out[2].earned).toBe(4);
  });

  it('adds up several awards on the same day', () => {
    const out = cells([txn(2, dayOfWeek(0)), txn(3, dayOfWeek(0, 18))]);
    expect(out[0].earned).toBe(5);
  });

  it('ignores last week entirely', () => {
    const out = cells([txn(9, new Date(monday.getTime() - 86400000).toISOString())]);
    expect(weekTotal(out)).toBe(0);
  });

  // ---- the part that changed: removals count -----------------------------

  it('takes a removal off the week, not just off the bank', () => {
    // 10 awarded, 4 taken back. The meter reads 6; a row still adding to 10
    // would make one of the two a liar.
    const out = cells([txn(10, dayOfWeek(0)), txn(-4, dayOfWeek(2))]);
    expect(weekTotal(out)).toBe(6);
  });

  it('never lets the week go below nothing', () => {
    // The bank can absorb a removal built up over months; this week cannot be
    // worth minus eight. The server clamps at zero and so does this.
    const out = cells([txn(2, dayOfWeek(0)), txn(-10, dayOfWeek(2))]);
    expect(weekTotal(out)).toBe(0);
    out.forEach((c) => expect(c.earned).toBeGreaterThanOrEqual(0));
  });

  it('walks the ledger in the order the stars were given, not the order of the days', () => {
    // Tuesday's removal happened on Tuesday, when the week was empty — there
    // was nothing to take back. Monday's 5 was credited afterwards, on
    // Wednesday. The server saw the same order and clamped the same way, so
    // the week is worth 5, not 2.
    const out = cells([
      txn(-3, dayOfWeek(1), dayOfWeek(1)),
      txn(5, dayOfWeek(0), dayOfWeek(2)),
    ]);
    expect(weekTotal(out)).toBe(5);
  });

  it('takes the newest stars back first', () => {
    // Losing a star should cost you the one you just got, not the one you
    // earned on Monday and have been looking at all week.
    const out = cells([txn(4, dayOfWeek(0)), txn(4, dayOfWeek(1)), txn(-3, dayOfWeek(2))]);
    expect(out[0].earned).toBe(4);
    expect(out[1].earned).toBe(1);
    expect(weekTotal(out)).toBe(5);
  });

  it('empties the whole week when the removal is bigger than all of it', () => {
    const out = cells([txn(4, dayOfWeek(0)), txn(4, dayOfWeek(1)), txn(-99, dayOfWeek(2))]);
    expect(weekTotal(out)).toBe(0);
    expect(out.every((c) => c.earned === 0)).toBe(true);
  });

  it('a removal that cancels an award leaves the week at nothing', () => {
    const out = cells([txn(6, dayOfWeek(0)), txn(-6, dayOfWeek(1))]);
    expect(weekTotal(out)).toBe(0);
  });

  // ---- what the cells are used for ---------------------------------------

  it('marks today, and only today', () => {
    const out = cells([]);
    expect(out.filter((c) => c.isToday)).toHaveLength(1);
    expect(out[2].isToday).toBe(true);
  });

  it('marks the days that have not happened yet', () => {
    const out = cells([]);
    expect(out.map((c) => c.isFuture)).toEqual([false, false, false, true, true, true, true]);
  });

  it('offers each day back to the server at noon, so it lands on the right date', () => {
    // A midnight stamp sent as UTC is the previous day for anyone west of
    // Greenwich — the whole reason this is noon.
    const out = cells([]);
    out.forEach((c) => expect(new Date(c.iso).getUTCHours()).toBe(12));
    expect(out[0].iso.slice(0, 10)).toBe('2026-08-31');
  });

  it('names the days in the reader’s language', () => {
    expect(weekDayCells([], WED, 'fr-FR')[0].name).toBe('lundi');
  });

  // ---- junk in the ledger -------------------------------------------------

  it('survives entries with no usable date', () => {
    const out = cells([
      { delta: 5 },
      { delta: 5, awarded_for: 'not a date', created_at: 'not a date' },
      txn(2, dayOfWeek(0)),
    ]);
    expect(weekTotal(out)).toBe(2);
  });

  it('ignores a zero-delta entry', () => {
    const out = cells([txn(0, dayOfWeek(0))]);
    expect(weekTotal(out)).toBe(0);
  });
});
