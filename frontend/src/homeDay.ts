import type { Card } from './api';

/**
 * The day on Home, as Roland chose it on 2026-11-01 ("Go with A with B's
 * touches"): the week ahead as a strip, the next thing as a card of its own, then
 * the rest of the day in time order with a line where "now" is and what is
 * already finished crossed out.
 *
 * Plain functions over cards and a clock, so every rule here is tested
 * without a screen (src/__tests__/homeNextUp.test.ts).
 */

function dueMs(card: Card): number | null {
  if (!card.due_date) return null;
  const t = new Date(card.due_date).getTime();
  return Number.isFinite(t) ? t : null;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "2026-10-31" in the device's own time zone, the key Calendar opens on. */
export function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/**
 * Today and the six days after it, each at local midnight. Ahead rather than
 * Monday to Sunday: on a Sunday the calendar week is six days already gone,
 * and what a family needs from the strip is what is coming.
 */
export function weekAhead(now: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + i));
}

/**
 * Whether a card is at a moment rather than on a day. The server says so in
 * `time_set`; a card from before the flag counts as timed unless it sits at
 * local midnight, the same rule the list's time column uses.
 */
export function isTimed(card: Card): boolean {
  const t = dueMs(card);
  if (t === null || card.time_set === false) return false;
  if (card.time_set === true) return true;
  const d = new Date(t);
  return !(d.getHours() === 0 && d.getMinutes() === 0);
}

/** The next timed thing today that has not started yet, or null. */
export function nextUp(open: Card[], now: Date): Card | null {
  const at = now.getTime();
  const upcoming = open
    .filter((c) => c.status === 'OPEN' && isTimed(c))
    .filter((c) => {
      const t = dueMs(c) as number;
      return t > at && sameDay(new Date(t), now);
    })
    .sort((a, b) => (dueMs(a) as number) - (dueMs(b) as number));
  return upcoming[0] ?? null;
}

/** What was due today and is already finished, to show crossed out. */
export function doneToday(cards: Card[], now: Date): Card[] {
  return cards.filter((c) => {
    const t = dueMs(c);
    return c.status === 'DONE' && t !== null && sameDay(new Date(t), now);
  });
}

export type DayRow = { card: Card; done: boolean };

/**
 * The rest of the day as one list: timed things in time order, finished ones
 * among them crossed out, then everything with a day but no time, then what
 * has no date at all. `skip` is the card already shown as "Next up".
 */
export function dayRows(open: Card[], done: Card[], skip: string | null): DayRow[] {
  const rows: DayRow[] = [
    ...open.filter((c) => c.card_id !== skip).map((card) => ({ card, done: false })),
    ...done.filter((c) => c.card_id !== skip).map((card) => ({ card, done: true })),
  ];
  const seen = new Set<string>();
  const unique = rows.filter((r) => (seen.has(r.card.card_id) ? false : (seen.add(r.card.card_id), true)));
  const rank = (r: DayRow) => (isTimed(r.card) ? 0 : dueMs(r.card) !== null ? 1 : 2);
  return unique.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return (dueMs(a.card) ?? Number.MAX_SAFE_INTEGER) - (dueMs(b.card) ?? Number.MAX_SAFE_INTEGER);
  });
}

/**
 * Where the "Now" line goes: before the first timed row still to come, or
 * after the last timed row when they are all past. -1 when the list has no
 * timed rows, so a day of untimed jobs carries no line at all.
 */
export function nowLineAt(rows: DayRow[], now: Date): number {
  const timed = rows.map((r, i) => ({ r, i })).filter(({ r }) => isTimed(r.card));
  if (timed.length === 0) return -1;
  const next = timed.find(({ r }) => (dueMs(r.card) as number) > now.getTime());
  return next ? next.i : timed[timed.length - 1].i + 1;
}

/**
 * Who has something on each day of the week: up to three names per day key,
 * one dot each on the strip. A card for nobody in particular counts as "".
 */
export function weekPlans(open: Card[], week: Date[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  week.forEach((d) => { out[dayKey(d)] = []; });
  open.forEach((c) => {
    const t = dueMs(c);
    if (t === null || c.status !== 'OPEN') return;
    const key = dayKey(new Date(t));
    const list = out[key];
    if (!list) return;
    const who = (c.assignee || '').trim();
    if (list.length < 3 && !list.includes(who)) list.push(who);
  });
  return out;
}
