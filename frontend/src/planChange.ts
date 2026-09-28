/**
 * The order of plans, and what a household gives up moving down it. Kept
 * free of React so the Plans page, the sheet and the tests share one answer.
 */
import type { Plan } from './api';

export const PLAN_RANK: Record<Plan, number> = {
  village: 0,
  duo: 1,
  executive: 2,
  household: 3,
  family_office: 3,
};

/** What a household gives up moving from one plan to a lower one. */
export function lossesFor(from: Plan, to: Plan, hasChildren: boolean): string[] {
  const out: string[] = [];
  const fromRank = PLAN_RANK[from] ?? 0;
  if (fromRank >= PLAN_RANK.household && PLAN_RANK[to] < PLAN_RANK.household) {
    out.push('chg_lose_helpers', 'chg_lose_vault');
    if (to !== 'duo') out.push('chg_lose_people');
    out.push('chg_lose_priority');
  }
  if (to === 'duo' && fromRank > PLAN_RANK.duo) {
    if (hasChildren) {
      out.push('chg_lose_kids', 'chg_lose_chores', 'chg_lose_money', 'chg_lose_custody', 'chg_lose_carpool');
    }
    out.push('chg_lose_add_child');
  }
  return out;
}
