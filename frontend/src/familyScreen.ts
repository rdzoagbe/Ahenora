import type { AllowanceConfig, FamilyMember } from './api';
import { isChild } from './homeFamily';

/**
 * What the Family tab says about the household. Pure, so it can be tested
 * without a screen.
 *
 * The final design Roland chose (2026-10-26) opens the tab on the people:
 * everyone as a tile in their own colour, then how the week is going (jobs
 * done, stars earned, pocket money due), then the latest thing that
 * happened. The chores and treats themselves sit behind a second tab.
 */

type TFunc = (key: string, params?: Record<string, string | number>) => string;

/** "4 people" over the title: everyone with a name, whatever their role. */
export function peopleCount(members: FamilyMember[]): number {
  return members.filter((m) => (m.name || '').trim()).length;
}

/** The children's stars since Monday, added up — the household's week. */
export function starsEarnedThisWeek(members: FamilyMember[]): number {
  return members.filter(isChild).reduce((n, m) => n + Math.max(0, m.week_earned || 0), 0);
}

export type AllowanceDue = { amount: number; dueAt: Date; isDue: boolean };

/**
 * The next pocket money to hand over: the soonest due date, and everything
 * payable on that same day added up. Null when nobody has an allowance.
 * One that is already overdue is "due now", whatever its date says.
 */
export function allowanceDue(allowances: AllowanceConfig[], now: Date): AllowanceDue | null {
  const dated = allowances
    .map((a) => ({ a, at: new Date(a.next_due_at) }))
    .filter(({ at }) => Number.isFinite(at.getTime()));
  if (dated.length === 0) return null;
  const overdue = dated.filter(({ a, at }) => a.is_due || at.getTime() <= now.getTime());
  if (overdue.length > 0) {
    return { amount: overdue.reduce((n, { a }) => n + a.amount, 0), dueAt: now, isDue: true };
  }
  dated.sort((x, y) => x.at.getTime() - y.at.getTime());
  const first = dated[0].at;
  const sameDay = dated.filter(({ at }) => at.toDateString() === first.toDateString());
  return { amount: sameDay.reduce((n, { a }) => n + a.amount, 0), dueAt: first, isDue: false };
}

/** "9 years · 54★" under a child's name, or just the stars when no age is set. */
export function childLine(m: FamilyMember, t: TFunc): string {
  const stars = `${Math.max(0, m.stars || 0)}★`;
  return m.age ? `${t('fam_years', { n: m.age })} · ${stars}` : stars;
}
