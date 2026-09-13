/**
 * The days a carpool runs on, and what counts as a pickup time.
 *
 * Split out of the Calendar screen so the rules can be tested without
 * rendering it, and so the screen and the server agree on the same two
 * shapes: a day from a fixed set, and a zero-padded 24-hour clock time.
 * The server refuses anything else — a row reading "friday-ish at half
 * eight" is worse than no row, because the parent reading the schedule at
 * 8am believes it.
 */

export const CARPOOL_DAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
] as const;

export type CarpoolDay = typeof CARPOOL_DAYS[number];

/**
 * "8:5" and "08:05" are the same school run.
 *
 * Returns the zero-padded form, or null when it is not a time at all. Typing
 * is forgiving on purpose — somebody entering a pickup at the school gate
 * should not have to count their leading zeros — but the stored value is
 * always one shape, so the schedule sorts and reads the same however it
 * was typed.
 */
export function normaliseCarpoolTime(raw: string): string | null {
  const text = (raw || '').trim();
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * Whether the sheet has enough to save.
 *
 * A driver is deliberately NOT required. Plenty of runs are set up before
 * anybody has agreed to drive them, and refusing to save until a name is
 * typed means the schedule never gets written down at all.
 */
export function carpoolReady(
  title: string, day: string, time: string,
): boolean {
  if (!(title || '').trim()) return false;
  if (!(CARPOOL_DAYS as readonly string[]).includes(day)) return false;
  return normaliseCarpoolTime(time) !== null;
}

/**
 * Monday first, then by the clock.
 *
 * The list arrives newest-first from the server, which is the order things
 * were typed rather than the order they happen — so a Friday run entered
 * last Tuesday sits above Monday's, and the schedule reads as a pile rather
 * than a week.
 */
export function sortCarpools<T extends { day_of_week: string; time: string }>(
  rows: readonly T[],
): T[] {
  const dayIndex = (d: string) => {
    const i = (CARPOOL_DAYS as readonly string[]).indexOf((d || '').toLowerCase());
    // A row from before the day was validated sorts to the end rather than
    // to Monday, where it would claim a place it has not earned.
    return i === -1 ? CARPOOL_DAYS.length : i;
  };
  return [...rows].sort((a, b) => {
    const byDay = dayIndex(a.day_of_week) - dayIndex(b.day_of_week);
    if (byDay !== 0) return byDay;
    return (a.time || '').localeCompare(b.time || '');
  });
}
