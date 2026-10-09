import type { Card } from './api';

/**
 * Which rows the Family pulse draws, in order, and how many more sit behind
 * "+N". Pure, so the fold can be tested without a screen.
 *
 * Overdue work folds into ONE row once there is a pile of it. Three overdue
 * rows, one of them from April, took the top of the screen on 8 October and
 * said the same thing three times; "3 overdue · oldest 24 Apr" says it once
 * and opens the list. One or two overdue items still get a row each, because
 * at that size the names ARE the summary.
 */

/** From this many overdue cards up, they share one row. */
export const OVERDUE_FOLD = 3;
export const MAX_PULSE_ROWS = 4;

export type PulseRow =
  | { kind: 'overdue'; card: Card }
  | { kind: 'handed'; card: Card }
  | { kind: 'overdue_group'; cards: Card[] };

export function planPulseRows(
  overdue: Card[],
  handed: Card[],
  dueTime: (c: Card) => number | null,
): { rows: PulseRow[]; more: number; needing: number } {
  // A card that is both overdue and handed to you is listed once, as handed:
  // who gave it to you is the more useful fact, and it is already late in
  // the pulse's own words ("Overdue · …" would say so twice).
  const handedIds = new Set(handed.map((c) => c.card_id));
  const overdueOnly = overdue.filter((c) => !handedIds.has(c.card_id));
  const overdueRows: PulseRow[] = overdueOnly.length >= OVERDUE_FOLD
    ? [{ kind: 'overdue_group', cards: [...overdueOnly].sort((a, b) => (dueTime(a) ?? 0) - (dueTime(b) ?? 0)) }]
    : overdueOnly.map((card) => ({ kind: 'overdue' as const, card }));
  const all: PulseRow[] = [...overdueRows, ...handed.map((card) => ({ kind: 'handed' as const, card }))];
  const rows = all.slice(0, MAX_PULSE_ROWS);
  return { rows, more: all.length - rows.length, needing: overdueOnly.length + handed.length };
}
