import type { CustodyConfig, FamilyMember } from './api';
import { firstNameOf } from './calendarPeople';

/**
 * What the rows of Settings say on their right. Pure, so it can be tested
 * without a screen.
 *
 * The final design Roland chose (2026-10-26) makes Settings a short list
 * again: a profile card, then Family, App, and Help and privacy as three
 * panels of rows, each row showing its value before you open it.
 */

type TFunc = (key: string, params?: Record<string, string | number>) => string;

/** "Odd weeks", "Even weeks", or "Off" when alternating custody is not set up. */
export function custodyValue(custody: CustodyConfig | null | undefined, t: TFunc): string {
  if (!custody?.enabled) return t('set_off');
  return custody.our_weeks === 'odd' ? t('custody_odd_weeks') : t('custody_even_weeks');
}

/**
 * The other parent's name beside "Household and co-parents": "Sam", or
 * "Sam & Alex" if there are more. Null when nobody else parents here, so the
 * row falls back to the household summary.
 */
export function coParentLine(coParents: FamilyMember[]): string | null {
  const others = coParents.filter((m) => !m.is_me).map((m) => firstNameOf(m.name)).filter(Boolean);
  if (coParents.length < 2 || others.length === 0) return null;
  return others.join(' & ');
}
