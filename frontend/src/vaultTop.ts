import type { ExpiryAlert, VaultDoc } from './api';

/**
 * What the top of the Vault says. Pure, so it can be tested without a
 * screen.
 *
 * The final design Roland chose (2026-10-26) opens the Vault on a search
 * box, the drawers as chips, the one document that needs attention first,
 * and every document as a row that says whose it is and when it runs out.
 */

type TFunc = (key: string, params?: Record<string, string | number>) => string;

const DAY = 24 * 60 * 60 * 1000;

/** "3 days", "2 weeks", "4 months": the way a person says how far off a date is. */
export function whenLabel(days: number, t: TFunc): string {
  const n = Math.max(0, Math.round(Math.abs(days)));
  if (n < 14) return n === 1 ? t('vault_one_day') : t('vault_n_days', { n });
  if (n < 60) {
    const weeks = Math.round(n / 7);
    return weeks === 1 ? t('vault_one_week') : t('vault_n_weeks', { n: weeks });
  }
  const months = Math.max(2, Math.round(n / 30));
  return t('vault_n_months', { n: months });
}

/** Days from now until a date, rounded; negative when it has passed. Null when there is no readable date. */
export function daysUntil(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const when = new Date(iso).getTime();
  if (!Number.isFinite(when)) return null;
  return Math.round((when - now.getTime()) / DAY);
}

/** "Expires in 4 months", "Expired 3 days ago", or null when it does not run out. */
export function expiryPhrase(doc: Pick<VaultDoc, 'expiry_date'>, now: Date, t: TFunc): string | null {
  const days = daysUntil(doc.expiry_date, now);
  if (days === null) return null;
  return days < 0 ? t('vault_expired_ago', { when: whenLabel(days, t) }) : t('vault_expires_in', { when: whenLabel(days, t) });
}

/**
 * The one document to put first: the soonest to run out, with ones already
 * run out before everything. Null when nothing is close.
 */
export function headlineAlert(alerts: ExpiryAlert[]): ExpiryAlert | null {
  if (alerts.length === 0) return null;
  return [...alerts].sort((a, b) => a.days_left - b.days_left)[0];
}

/** Whether a document answers a search: its title, its drawer, or whose it is. */
export function matchesQuery(doc: Pick<VaultDoc, 'title' | 'category' | 'owner_name'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [doc.title, doc.category, doc.owner_name || ''].some((s) => (s || '').toLowerCase().includes(q));
}

/** "You" for your own document, else the name of whoever put it in; null when nobody is recorded. */
export function ownerLine(doc: Pick<VaultDoc, 'owner_user_id' | 'owner_name'>, meUserId: string | null | undefined, t: TFunc): string | null {
  if (meUserId && doc.owner_user_id === meUserId) return t('hub_you');
  return (doc.owner_name || '').trim() || null;
}
