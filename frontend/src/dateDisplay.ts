/**
 * Reading back a date this app wrote for a human to look at.
 *
 * The Secret Santa deadline is stored as the string the reader sees — "24 Dec
 * 2026", "24 déc. 2026" — because that is what the reveal shows and what the
 * backend has always held. Re-opening the picker therefore has to turn that
 * back into a date, and `new Date(text)` only manages it in English: in French,
 * Spanish and German it returns Invalid Date, so the picker opened on today and
 * the deadline the organiser had already chosen was lost from the dialog.
 *
 * We wrote the string, so we can read it: the same locale that produced the
 * month name will produce it again for comparison. Pure and dependency-free so
 * it can be tested for every language the app ships.
 */
export function parseDisplayDate(text: string, locale: string): Date | null {
  const raw = (text || '').trim();
  if (!raw) return null;

  // An ISO date (or anything English) still parses directly; prefer it.
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime()) && /\d{4}/.test(raw)) return direct;

  const lower = raw.toLowerCase();
  const year = lower.match(/\d{4}/);
  if (!year) return null;

  // Take the year out before hunting for the day, or "2026" donates its digits.
  const withoutYear = lower.replace(year[0], ' ');
  const day = withoutYear.match(/\d{1,2}/);
  if (!day) return null;

  const months = Array.from({ length: 12 }, (_, m) =>
    new Date(2000, m, 1)
      .toLocaleDateString(locale, { month: 'short' })
      .toLowerCase()
      .replace(/\./g, ''));
  const month = months.findIndex((name) => name && withoutYear.includes(name));
  if (month < 0) return null;

  const parsed = new Date(Number(year[0]), month, Number(day[0]));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
