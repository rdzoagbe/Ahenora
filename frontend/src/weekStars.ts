/**
 * The week, as the child's page draws it.
 *
 * Two numbers describe a week and they have to agree: the meter, which is the
 * server's `week_earned`, and the row of seven day cells under it, which the
 * app builds from the star ledger it already has. When they disagree the page
 * is telling a parent two different stories about the same seven days, and the
 * one they believe is whichever they read last.
 *
 * Pulled out of the screen so the arithmetic can be tested against the rules it
 * is supposed to mirror, rather than inspected inside a component.
 */

export interface StarLedgerEntry {
  delta: number;
  /** The day the job was done, when a parent filled in a missed day. */
  awarded_for?: string | null;
  /** The moment the star was actually given. */
  created_at?: string | null;
}

export interface WeekDayCell {
  key: string;
  /** What the server wants back when a parent credits this day. */
  iso: string;
  letter: string;
  name: string;
  earned: number;
  isToday: boolean;
  isFuture: boolean;
}

/**
 * Monday 00:00 UTC of the week containing `now`.
 *
 * UTC, not local midnight, because that is where the server rolls the meter
 * (`current_week_start`). Drawing the boxes from local midnight meant that for
 * the whole of a timezone's offset the row and the meter described different
 * weeks — a full row of stars over a bar reading 0.
 */
export function weekStartUTC(now: Date): Date {
  return new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(),
    now.getUTCDate() - ((now.getUTCDay() + 6) % 7),
  ));
}

const dayKey = (d: Date) => `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;

/**
 * Stars per day for the current week, Monday first.
 *
 * Removals count, because the meter counts them: a week where 10 were awarded
 * and 4 taken back reads 6 above, and a row still adding to 10 would make one
 * of the two a liar.
 *
 * An award lands on the day it was FOR (`awarded_for`), so a parent catching up
 * on Sunday credits Tuesday. A removal is not a day — nobody un-does a Tuesday —
 * so it comes off the days that have stars, most recent first, which is how
 * losing one reads: you lose the ones you just got. Transactions are walked in
 * the order they were GIVEN (`created_at`), so a removal can only take back what
 * had already been awarded when it happened.
 *
 * Nothing goes below zero and nothing goes into deficit: a removal bigger than
 * the week empties it and stops. That is what the server does to the meter, so
 * these seven cells always add up to the number shown above them.
 */
export function weekDayCells(
  entries: StarLedgerEntry[],
  now: Date,
  locale: string,
): WeekDayCell[] {
  const monday = weekStartUTC(now);

  const thisWeek = entries
    .map((txn) => {
      const stamp = txn.awarded_for || txn.created_at;
      const when = stamp ? new Date(stamp) : null;
      const given = txn.created_at ? new Date(txn.created_at) : when;
      return { txn, when, given };
    })
    .filter((e): e is { txn: StarLedgerEntry; when: Date; given: Date } =>
      !!e.when && !Number.isNaN(e.when.getTime()) && e.when >= monday
      && !!e.given && !Number.isNaN(e.given.getTime()) && !!e.txn.delta)
    .sort((a, b) => a.given.getTime() - b.given.getTime());

  const earnedByDay: Record<string, number> = {};
  const order: string[] = [];   // days that hold stars, oldest first
  thisWeek.forEach(({ txn, when }) => {
    const k = dayKey(when);
    if (txn.delta > 0) {
      if (!(k in earnedByDay)) { earnedByDay[k] = 0; order.push(k); }
      earnedByDay[k] += txn.delta;
      return;
    }
    // Give back from the newest day with stars in it and work backwards, until
    // the removal is spent or the week is empty.
    let left = -txn.delta;
    for (let i = order.length - 1; i >= 0 && left > 0; i -= 1) {
      const day = order[i];
      const take = Math.min(left, earnedByDay[day]);
      earnedByDay[day] -= take;
      left -= take;
    }
  });

  const todayKey = dayKey(now);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const k = dayKey(d);
    return {
      key: k,
      // Noon UTC, not midnight: the day is the point, and a midnight stamp
      // lands in the previous day for anyone west of Greenwich.
      iso: new Date(d.getTime() + 12 * 3600 * 1000).toISOString(),
      letter: d.toLocaleDateString(locale, { weekday: 'narrow', timeZone: 'UTC' }),
      name: d.toLocaleDateString(locale, { weekday: 'long', timeZone: 'UTC' }),
      earned: earnedByDay[k] || 0,
      isToday: k === todayKey,
      // Sunday's stars cannot be given on Wednesday. The server refuses it;
      // the row should not offer it either.
      isFuture: d.getTime() > now.getTime(),
    };
  });
}

/** What the seven cells add up to — the number the meter above should show. */
export function weekTotal(cells: WeekDayCell[]): number {
  return cells.reduce((sum, c) => sum + c.earned, 0);
}
