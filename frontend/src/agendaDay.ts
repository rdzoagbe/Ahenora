/**
 * The Agenda's day, as Roland chose it on 2026-11-22.
 *
 * The page opens on this week and on today: a strip of seven days, then
 * today's events with the time leading each one, a line where the day has got
 * to, and one card for what comes next. The month is one tap away.
 *
 * What is decided here, away from the screen so it can be tested:
 *
 *  - how the week says its dates ("16 – 22 November");
 *  - where the "Now" line goes among today's events;
 *  - which event is "next" once the shown day is done;
 *  - how a time reads in a language that counts to 24.
 */

type Dated = { due_date?: string | null; time_set?: boolean | null };

/** An event with a clock time: an all-day one has a day and no moment. */
export function hasClock(card: Dated): boolean {
  if (!card.due_date || card.time_set === false) return false;
  return !Number.isNaN(new Date(card.due_date).getTime());
}

/** A timed event whose time has gone by. An all-day event is never "past":
 *  the day is not over, and nothing here decides a thing was done. */
export function isEarlier(card: Dated, now: Date): boolean {
  return hasClock(card) && new Date(card.due_date as string).getTime() < now.getTime();
}

/**
 * Where the "Now" line sits in today's list: before the first timed event
 * still to come. With none left it goes after the last one; with nothing on
 * the day there is no line (-1).
 */
export function nowIndex(items: Dated[], now: Date): number {
  if (items.length === 0) return -1;
  const at = items.findIndex((c) => hasClock(c) && !isEarlier(c, now));
  return at === -1 ? items.length : at;
}

/** Whole minutes until a timed event, or null when it has no time or has gone. */
export function minutesUntil(card: Dated, now: Date): number | null {
  if (!hasClock(card)) return null;
  const ms = new Date(card.due_date as string).getTime() - now.getTime();
  if (ms <= 0) return null;
  return Math.max(1, Math.round(ms / 60000));
}

/** "in 45 min" or "in 1 h 20": worth saying only for the same day. */
export function untilParts(minutes: number | null): { h: number; m: number } | null {
  if (minutes === null || minutes > 12 * 60) return null;
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

/**
 * The next event after the shown day, soonest first, never from the past.
 * `keyOf` is the screen's own day key for a card, so "the day" means here
 * exactly what it means in the list above.
 */
export function nextAfter<T extends Dated>(
  cards: T[],
  shownDay: string,
  todayKey: string,
  keyOf: (card: T) => string,
): T | null {
  let best: T | null = null;
  let bestAt = Infinity;
  for (const card of cards) {
    const key = keyOf(card);
    // After the shown day, and not before today: looking back at last
    // Thursday, what comes next is today's, not last Friday's.
    if (!key || key <= shownDay || key < todayKey) continue;
    const at = new Date(card.due_date || '').getTime();
    if (Number.isNaN(at)) continue;
    if (at < bestAt) { best = card; bestAt = at; }
  }
  return best;
}

/** "3:30" + "PM" becomes "15:30": French, Spanish and German count to 24. */
export function to24(time: string, ampm: string): string {
  const [hRaw, m] = time.split(':');
  let h = parseInt(hRaw, 10);
  if (Number.isNaN(h) || m === undefined) return time;
  if (ampm === 'PM' && h !== 12) h += 12;
  if (ampm === 'AM' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${m}`;
}

/**
 * The week in words: "16 – 22 November", or "30 Nov – 6 Dec" across two
 * months. The month name comes from the locale; the order (day, then month)
 * holds in the four languages the app speaks.
 */
export function weekRangeLabel(days: Date[], locale: string): string {
  if (days.length === 0) return '';
  const first = days[0];
  const last = days[days.length - 1];
  if (first.getMonth() === last.getMonth()) {
    const month = last.toLocaleDateString(locale, { month: 'long' });
    return `${first.getDate()} – ${last.getDate()} ${month}`;
  }
  const short = (d: Date) => `${d.getDate()} ${d.toLocaleDateString(locale, { month: 'short' })}`;
  return `${short(first)} – ${short(last)}`;
}
