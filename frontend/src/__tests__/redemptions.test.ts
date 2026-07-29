import {
  isAlreadySettled,
  mergeRedemptions,
  restoreRedemption,
  sortByNewest,
} from '../redemptions';
import type { Redemption } from '../api';

/**
 * The Kids screen reloads on focus without awaiting the fetch, so a parent can
 * act on the list while a slightly older copy of it is still in the air. Every
 * test here is a real sequence a parent can produce with one tap at the wrong
 * moment.
 */

const row = (id: string, at: string, over: Partial<Redemption> = {}): Redemption => ({
  redemption_id: id,
  family_id: 'fam1',
  member_id: 'kid1',
  reward_id: `rw_${id}`,
  reward_title: `Reward ${id}`,
  cost_stars: 60,
  status: 'pending',
  created_at: at,
  ...over,
});

const A = row('a', '2026-01-01T10:00:00Z');
const B = row('b', '2026-01-02T10:00:00Z');
const C = row('c', '2026-01-03T10:00:00Z');

const ids = (rows: Redemption[]) => rows.map((r) => r.redemption_id);

describe('mergeRedemptions', () => {
  it('takes the server list when nothing has happened locally', () => {
    expect(ids(mergeRedemptions([], [A, B], new Set(), new Set()))).toEqual(['b', 'a']);
  });

  it('does not resurrect a reward that was just marked given', () => {
    // Tap Given on A, then the focus fetch — issued before the tap — lands
    // still listing A as pending. A must stay gone.
    const settled = new Set(['a']);
    const merged = mergeRedemptions([B], [A, B], settled, new Set());
    expect(ids(merged)).toEqual(['b']);
  });

  it('does not drop a reward that was just redeemed', () => {
    // The mirror case: C was redeemed after the fetch went out, so the server
    // list predates it. Sixty stars have already left the child's balance —
    // losing the row would leave nothing to show for them.
    const added = new Set(['c']);
    const merged = mergeRedemptions([C, A, B], [A, B], new Set(), added);
    expect(ids(merged)).toEqual(['c', 'b', 'a']);
  });

  it('hands a locally added reward back to the server once it appears there', () => {
    // Otherwise the id would be held locally forever and a later fulfilment by
    // another parent could never remove it.
    const added = new Set(['c']);
    mergeRedemptions([C], [A, C], new Set(), added);
    expect(added.has('c')).toBe(false);
  });

  it('drops a locally added reward once the server has seen and settled it', () => {
    const added = new Set(['c']);
    mergeRedemptions([C], [C], new Set(), added); // server confirms it
    const after = mergeRedemptions([C], [], new Set(), added); // other parent settles it
    expect(ids(after)).toEqual([]);
  });

  it('keeps both corrections straight at once', () => {
    const merged = mergeRedemptions([C, B], [A, B], new Set(['a']), new Set(['c']));
    expect(ids(merged)).toEqual(['c', 'b']);
  });

  it('returns newest first', () => {
    expect(ids(mergeRedemptions([], [A, C, B], new Set(), new Set()))).toEqual(['c', 'b', 'a']);
  });
});

describe('restoreRedemption', () => {
  it('puts a row back after a failed settle without losing what arrived meanwhile', () => {
    // The bug this replaced restored a whole snapshot taken before the request,
    // which threw away any reward that landed while it was in flight.
    const afterFetch = [B, C];
    expect(ids(restoreRedemption(afterFetch, A))).toEqual(['c', 'b', 'a']);
  });

  it('does not duplicate a row that is already back', () => {
    expect(ids(restoreRedemption([A, B], A))).toEqual(['a', 'b']);
  });
});

describe('isAlreadySettled', () => {
  it('recognises the 404 that means another parent got there first', () => {
    expect(isAlreadySettled(Object.assign(new Error('nope'), { status: 404 }))).toBe(true);
    expect(isAlreadySettled(new Error('404: Redemption not found or already settled'))).toBe(true);
  });

  it('does not mistake an ordinary failure for a settled reward', () => {
    // These must still restore the row and offer a retry.
    expect(isAlreadySettled(Object.assign(new Error('boom'), { status: 500 }))).toBe(false);
    expect(isAlreadySettled(new Error('Network request failed'))).toBe(false);
    expect(isAlreadySettled(new Error('400: 404 is not the status here'))).toBe(false);
    expect(isAlreadySettled(undefined)).toBe(false);
  });
});

describe('sortByNewest', () => {
  it('does not mutate its input', () => {
    const input = [A, C, B];
    sortByNewest(input);
    expect(ids(input)).toEqual(['a', 'c', 'b']);
  });
});
