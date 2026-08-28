import type { Card } from './api';

/**
 * Which of the work handed to you belongs on today's Feed.
 *
 * Pure and dependency-free on purpose, so the rule below can be tested without
 * the Feed screen around it.
 *
 * Two rules pull in opposite directions here, and both are real:
 *
 *  - Work handed to you must not vanish. An assigned task due next week once
 *    showed nowhere on the Feed and only on the Calendar, which was a reported
 *    failure — so a future-dated task handed to you keeps its place.
 *
 *  - Finishing something must feel finished. Completing a RECURRING chore
 *    creates its next occurrence immediately, and that new card carries the
 *    same title with a new id. Listed straight away it reads exactly like the
 *    thing you just ticked off refusing to go: "I mark it as done and it keeps
 *    coming back."
 *
 * The distinction that satisfies both is what the card IS, not when it is due.
 * A recurring chore is a rhythm — the next turn is not your problem until it
 * comes round. A one-off handed to you is news, and news does not wait.
 */
export function isHandedWorkForToday(card: Card, now: Date = new Date()): boolean {
  if (card.status !== 'OPEN') return false;

  const recurs = Boolean(card.recurrence) && card.recurrence !== 'none';
  if (!recurs) return true;

  // Undated recurring work has no "next turn" to wait for.
  if (!card.due_date) return true;

  const due = new Date(card.due_date).getTime();
  if (Number.isNaN(due)) return true;

  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  return due <= endOfToday.getTime();
}

/** The handed-to-you list for today, in the order it is given. */
export function handedWorkForToday(cards: Card[], now: Date = new Date()): Card[] {
  return cards.filter((c) => isHandedWorkForToday(c, now));
}
