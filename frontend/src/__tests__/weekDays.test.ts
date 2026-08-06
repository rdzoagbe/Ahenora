/**
 * The week row on the kids page, and the day a parent is actually crediting.
 *
 * Two things here are easy to get wrong and impossible to notice: which day a
 * back-dated star lands on, and whether the row agrees with the meter above it.
 * Both are date arithmetic, so both get tested here rather than by eye.
 *
 * Mirrors the `weekDayCells` derivation in app/(tabs)/kids.tsx.
 */

type Txn = { created_at: string; delta: number; awarded_for?: string | null };

function weekDayCells(historyItems: Txn[], now: Date) {
  const monday = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(),
    now.getUTCDate() - ((now.getUTCDay() + 6) % 7),
  ));
  const dayKey = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  const earnedByDay: Record<string, number> = {};
  historyItems.forEach((txn) => {
    const stamp = txn.awarded_for || txn.created_at;
    if (!stamp || txn.delta <= 0) return;
    const when = new Date(stamp);
    if (Number.isNaN(when.getTime()) || when < monday) return;
    const k = dayKey(when);
    earnedByDay[k] = (earnedByDay[k] || 0) + txn.delta;
  });
  const todayKey = dayKey(now);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const k = dayKey(d);
    return {
      key: k,
      iso: new Date(d.getTime() + 12 * 3600 * 1000).toISOString(),
      earned: earnedByDay[k] || 0,
      isToday: k === todayKey,
      isFuture: d.getTime() > now.getTime(),
    };
  });
}

// A Thursday, mid-afternoon UTC.
const THU = new Date('2026-08-06T15:00:00.000Z');

describe('the week row', () => {
  it('starts on Monday, the same day the server rolls the week', () => {
    const cells = weekDayCells([], THU);
    expect(cells).toHaveLength(7);
    expect(cells[0].iso.slice(0, 10)).toBe('2026-08-03'); // Monday
    expect(cells[6].iso.slice(0, 10)).toBe('2026-08-09'); // Sunday
  });

  it('marks exactly one day as today', () => {
    const cells = weekDayCells([], THU);
    expect(cells.filter((c) => c.isToday).map((c) => c.iso.slice(0, 10))).toEqual(['2026-08-06']);
  });

  it('treats days after today as future, and today as not', () => {
    const cells = weekDayCells([], THU);
    expect(cells.map((c) => c.isFuture)).toEqual([false, false, false, false, true, true, true]);
  });

  it('sums a day and ignores corrections that take stars away', () => {
    const cells = weekDayCells([
      { created_at: '2026-08-04T09:00:00.000Z', delta: 2 },
      { created_at: '2026-08-04T19:00:00.000Z', delta: 3 },
      { created_at: '2026-08-04T20:00:00.000Z', delta: -5 },
    ], THU);
    // A removal is not a day's effort undone; the row is not a punishment.
    expect(cells[1].earned).toBe(5);
  });

  it('does not carry last week into this one', () => {
    const cells = weekDayCells([{ created_at: '2026-08-02T09:00:00.000Z', delta: 9 }], THU);
    expect(cells.reduce((s, c) => s + c.earned, 0)).toBe(0);
  });

  it('buckets a back-dated star on the day it was for, not the day it was given', () => {
    // The bug this guards: a parent filling in Tuesday on Thursday saw the
    // star appear on Thursday while the weekly meter counted it on Tuesday.
    const cells = weekDayCells([
      { created_at: '2026-08-06T15:00:00.000Z', awarded_for: '2026-08-04T12:00:00.000Z', delta: 7 },
    ], THU);
    expect(cells[1].earned).toBe(7); // Tuesday
    expect(cells[3].earned).toBe(0); // Thursday
  });

  it('stamps back-dated awards at midday, so they cannot slip a day', () => {
    // Midnight UTC is the previous evening anywhere west of UTC, which would
    // credit Monday's star to Sunday — a day outside the week entirely.
    const cells = weekDayCells([], THU);
    cells.forEach((c) => expect(c.iso).toContain('T12:00:00'));
  });
});
