/**
 * When a next-due vaccination date needs a parent to do something.
 *
 * This is the whole reason vaccinations are rows and not a paragraph: a text
 * field can hold "Tetanus 2024-03-11" badly, and cannot answer "is she due?"
 * at all.
 *
 * Its own module rather than living in the screen, because it is a pure rule
 * about dates — nothing here should need a renderer to test.
 */

/** A real day, or null. Parsed from the ISO string the server guarantees. */
function parseDay(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * How a next-due date reads today. This is the whole reason vaccinations are
 * rows and not a paragraph: a text field can hold "Tetanus 2024-03-11" badly,
 * and cannot answer "is she due?" at all.
 *
 * 'soon' is 30 days, which is roughly the notice a parent needs to get an
 * appointment. Compared as whole days so a date does not flip state partway
 * through the afternoon.
 */
export function dueState(nextDue: string, today = new Date()): 'none' | 'soon' | 'due' {
  const due = parseDay(nextDue);
  if (!due) return 'none';
  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((due.getTime() - midnight.getTime()) / 86400000);
  if (days <= 0) return 'due';
  return days <= 30 ? 'soon' : 'none';
}
