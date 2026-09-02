/**
 * The day the calendar is currently showing.
 *
 * The tab-bar "+" prefills an event with `new Date()` — always today. Select
 * the 14th, tap "+", and you get an event on today's date, which is worse than
 * no prefill because it looks deliberate and gets saved.
 *
 * "+" lives in the tab bar, outside the calendar screen, so it cannot read that
 * screen's state. This is the smallest honest bridge: one value, written by the
 * calendar when the selection changes and cleared when it unmounts, read by the
 * capture sheet only while the calendar is the active route.
 *
 * Deliberately not in the store: it is transient view state, not household
 * data, and putting it there would re-render every screen that subscribes.
 */
let selectedDayKey: string | null = null;

/** `YYYY-MM-DD`, or null when no day is selected or the calendar is not open. */
export function setSelectedCalendarDay(key: string | null) {
  selectedDayKey = key;
}

export function getSelectedCalendarDay(): string | null {
  return selectedDayKey;
}

/**
 * Noon on the selected day, or null when there is none.
 *
 * Noon, not midnight: a date built at 00:00 local and sent as UTC can land on
 * the previous day for anyone west of Greenwich, which is how an event added
 * on the 14th shows up on the 13th.
 */
export function selectedCalendarDayAt(hour = 12): Date | null {
  if (!selectedDayKey) return null;
  const date = new Date(`${selectedDayKey}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  date.setHours(hour, 0, 0, 0);
  return date;
}
