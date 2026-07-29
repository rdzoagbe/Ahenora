import type { Redemption } from './api';

/**
 * Reconcile a freshly fetched list of outstanding rewards with what this
 * device has already done to the list.
 *
 * The Kids screen reloads on focus and that fetch is deliberately not awaited,
 * so it can land after the parent has already acted. Trusting it wholesale
 * gets both directions wrong: a reward marked given a second earlier pops back
 * onto the list, and one redeemed a second earlier disappears from it — after
 * the child watched sixty stars leave their balance.
 *
 * So the fetch is treated as "everything the server knew a moment ago", and
 * two local sets say what has happened since. An id stops being local as soon
 * as a fetch confirms it, which is what keeps the sets from growing without
 * bound and what lets the server win once it has caught up.
 */
export function mergeRedemptions(
  current: Redemption[],
  fetched: Redemption[],
  settledIds: Set<string>,
  addedIds: Set<string>,
): Redemption[] {
  const server = fetched.filter((r) => !settledIds.has(r.redemption_id));

  // Anything the server now reports is no longer news from this device.
  for (const r of fetched) addedIds.delete(r.redemption_id);

  const seen = new Set(server.map((r) => r.redemption_id));
  const localOnly = current.filter(
    (r) => addedIds.has(r.redemption_id) && !seen.has(r.redemption_id),
  );

  return sortByNewest([...localOnly, ...server]);
}

/** Newest first, matching the order the server sorts by. */
export function sortByNewest(rows: Redemption[]): Redemption[] {
  return [...rows].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/**
 * Put a row back after a failed settle — without discarding rows that arrived
 * while the request was in flight, which restoring a whole snapshot would.
 */
export function restoreRedemption(current: Redemption[], row: Redemption): Redemption[] {
  if (current.some((r) => r.redemption_id === row.redemption_id)) return current;
  return sortByNewest([...current, row]);
}

/**
 * True when the server says the redemption is no longer there to act on.
 *
 * A 404 from fulfil/cancel means somebody else already settled it — usually
 * the other parent, on the other phone. That is not a failure to retry: the
 * row is genuinely gone, so it should stay gone rather than bounce back with
 * "please try again" on a button that can never succeed.
 */
export function isAlreadySettled(error: unknown): boolean {
  const status = (error as { status?: number })?.status;
  if (status === 404) return true;
  return /^404:/.test(String((error as { message?: string })?.message ?? ''));
}
