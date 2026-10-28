import type { FamilyMember, Redemption, Reward } from './api';

/**
 * What the top of a child's page says. Pure, so it can be tested without a
 * screen.
 *
 * The final design Roland chose (2026-10-26) opens a child's page on the
 * child: their face, their stars, what they are saving for, and anything they
 * have earned and not yet been given. The chores and rewards themselves are
 * still edited on the Family tab; this page is for the parent standing next to
 * the child, saying well done.
 */

export type SavingFor =
  /** The cheapest treat they cannot yet afford: "6 more stars to the zoo". */
  | { kind: 'reward'; title: string; icon: string | null; have: number; need: number }
  /** Every treat is within reach (or there are none): this week's meter. */
  | { kind: 'week'; have: number; need: number };

/**
 * The goal to draw a bar for, or null when there is nothing true to show.
 *
 * A treat first: "6 more stars to the zoo" is the sentence a child repeats,
 * and the one Home uses. Every household has a weekly target (the server
 * gives one to a child who was never set one), so if the week came first the
 * treat would never be seen. The week is the goal only when no treat is out
 * of reach, and only while it has not been cashed in — a claimed week would
 * sit as a full bar under a treat already handed over.
 */
export function savingFor(member: FamilyMember, rewards: Reward[]): SavingFor | null {
  const stars = member.stars ?? 0;
  const next = rewards
    .filter((r) => r.cost_stars > stars)
    .sort((a, b) => a.cost_stars - b.cost_stars)[0];
  if (next) return { kind: 'reward', title: next.title, icon: next.icon ?? null, have: stars, need: next.cost_stars };
  const target = member.weekly_target ?? 0;
  if (target > 0 && !member.week_claimed) {
    return { kind: 'week', have: Math.max(0, member.week_earned ?? 0), need: target };
  }
  return null;
}

/** Rewards paid for and not yet handed over, oldest first, for this child only. */
export function earnedAndReady(owed: Redemption[], memberId: string): Redemption[] {
  return owed
    .filter((r) => r.member_id === memberId && r.status === 'pending')
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
}
