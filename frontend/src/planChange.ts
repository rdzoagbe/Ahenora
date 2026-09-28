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

export type Living = 'solo' | 'couple' | 'family' | 'two_homes';

/**
 * The plan a household of this shape is pointed at during setup. Mirrors
 * recommended_plan() on the server, which decides the trial: Duo for one or
 * two people, Family for children in one or two homes, Household beyond the
 * five children Family holds.
 */
export function recommendPlan(living: Living, children: number): Plan {
  if (living === 'solo' || living === 'couple') return 'duo';
  return children > 5 ? 'household' : 'executive';
}

/** The first lines of each paid plan's card, for the setup step. */
export const PLAN_HIGHLIGHTS: Partial<Record<Plan, string[]>> = {
  duo: ['pf_duo_2', 'pf_duo_3', 'pf_duo_4', 'pf_duo_5'],
  executive: ['pf_prem_1', 'pf_prem_2', 'pf_prem_3', 'pf_prem_5'],
  household: ['pf_house_2', 'pf_house_3', 'pf_house_4', 'pf_house_5'],
};

export const PLAN_PRICE: Partial<Record<Plan, { monthly: string; yearly: string }>> = {
  duo: { monthly: '€1.99', yearly: '€19.99' },
  executive: { monthly: '€6.99', yearly: '€49.99' },
  household: { monthly: '€14.99', yearly: '€149.99' },
};
