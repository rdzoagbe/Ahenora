/**
 * The day a receipt is from. Pure, so it can be tested without a screen.
 *
 * A scan can read a date wrong, and a wrong YEAR is the quiet kind (Roland,
 * 2026-11-27): the receipt sat in the list as "Nov 27", looked like that
 * day's shop, and was counted in a November nobody was looking at, so the
 * month's total was short and nothing said why. Three things answer that:
 * the review says so when a date is far from today, a row shows its year
 * when it is not this one, and a saved date can be corrected.
 */

/** Today on this phone's calendar, YYYY-MM-DD. Sent explicitly: left out,
 *  the server would use ITS today (UTC), which is tomorrow in the evening
 *  west of Greenwich and yesterday in the small hours east of it. */
export function todayISO(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** How old a receipt's date may be before the review asks "is that right?". */
export const OLD_RECEIPT_DAYS = 45;

/** A real calendar day written YYYY-MM-DD, as a local date; else null. */
export function parseDay(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((iso || '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  // 2026-02-31 is not a day: Date would quietly call it the 3rd of March.
  return date.getFullYear() === y && date.getMonth() === mo - 1 && date.getDate() === d ? date : null;
}

/** Whole days from `day` to `today` (positive: in the past). */
export function daysAgo(day: Date, today: Date): number {
  const a = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const b = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return Math.round((b - a) / 86400000);
}

/**
 * Whether a receipt's date deserves a second look before it is saved: more
 * than OLD_RECEIPT_DAYS old, or after today. Nothing typed, or not yet a
 * whole date, is not suspect: it is simply not finished.
 */
export function dateIsSuspect(iso: string | null | undefined, today: Date): boolean {
  const day = parseDay(iso);
  if (!day) return false;
  const ago = daysAgo(day, today);
  return ago > OLD_RECEIPT_DAYS || ago < 0;
}

/**
 * Whether a saved receipt is dated long before the day it was added: the
 * mark of a misread date. Only that way round. A date a day AHEAD of when it
 * was added is the server keeping days in UTC for a family west of it, not a
 * mistake.
 */
export function datedLongBefore(spentOn: string | null | undefined, createdAt: string | null | undefined): boolean {
  const day = parseDay((spentOn || '').slice(0, 10));
  const added = createdAt ? new Date(createdAt) : null;
  if (!day || !added || Number.isNaN(added.getTime())) return false;
  return daysAgo(day, added) > OLD_RECEIPT_DAYS;
}

/** "27 Nov", and "27 Nov 2025" when the year is not this one. */
export function receiptDayLabel(iso: string, locale: string, today: Date): string {
  const day = parseDay((iso || '').slice(0, 10)) || new Date(`${iso}T00:00:00`);
  const otherYear = day.getFullYear() !== today.getFullYear();
  return day.toLocaleDateString(locale, otherYear
    ? { day: 'numeric', month: 'short', year: 'numeric' }
    : { day: 'numeric', month: 'short' });
}

/** The date in full, for the question on the review: "27 November 2025". */
export function receiptDayLong(iso: string, locale: string): string {
  const day = parseDay(iso);
  return day ? day.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) : iso;
}
