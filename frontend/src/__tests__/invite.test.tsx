/**
 * Where a tapped invite waits while its recipient signs in.
 *
 * This is the bug a co-parent hit in the real world: she tapped the invite,
 * signed in with Google, and landed in an empty household of her own. The
 * token was never sent with the sign-in, because nothing had kept it.
 *
 * Two separate holes made the same hole. On web it was stored in
 * sessionStorage, which an email link's new tab does not share. On native it
 * was stored nowhere at all — it lived in React state, and the only fallback
 * to storage was written `Platform.OS === 'web'`.
 *
 * So these tests assert the two things that actually failed: that native
 * persists at all, and that web persists somewhere a second tab can read.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  extractInviteToken, rememberInvite, readStoredInvite, clearStoredInvite,
  signInWithPendingInvite, INVITE_REJECTED_ON_EMAIL,
} from '../invite';

// expo-linking reaches into expo-modules-core, which needs a native runtime
// that does not exist here. Its parse() is stubbed to find nothing, so every
// case below falls through to the URL and regex parsing in the same function —
// which is the path that actually has to hold for fragment and custom-scheme
// links anyway.
jest.mock('expo-linking', () => ({ parse: () => ({}) }));

const store = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

const asMock = AsyncStorage as unknown as {
  getItem: jest.Mock; setItem: jest.Mock; removeItem: jest.Mock;
};

beforeEach(() => {
  store.clear();
  asMock.getItem.mockImplementation(async (k: string) => store.get(k) ?? null);
  asMock.setItem.mockImplementation(async (k: string, v: string) => { store.set(k, v); });
  asMock.removeItem.mockImplementation(async (k: string) => { store.delete(k); });
});

describe('reading a token out of a link', () => {
  it('finds it in a query string', () => {
    expect(extractInviteToken('https://ahenora.com/app/?invite=abc123')).toBe('abc123');
  });

  it('finds it in a fragment, which is where the web app puts it', () => {
    expect(extractInviteToken('https://ahenora.com/app/#invite=abc123')).toBe('abc123');
  });

  it('finds it behind a custom scheme', () => {
    expect(extractInviteToken('householdcoo:///?invite=abc123')).toBe('abc123');
  });

  it('is not fooled by a link with no invite on it', () => {
    expect(extractInviteToken('https://ahenora.com/app/')).toBeNull();
    expect(extractInviteToken(null)).toBeNull();
    expect(extractInviteToken('')).toBeNull();
  });
});

describe('keeping the token across a sign-in', () => {
  it('survives on native, where it used to survive nowhere', async () => {
    // The whole bug. Android can destroy and re-create the activity behind
    // Google's sign-in sheet; before this, the token was only in component
    // state and came back gone.
    expect(Platform.OS).not.toBe('web');
    await rememberInvite('tok-native');
    expect(await readStoredInvite()).toBe('tok-native');
  });

  it('is given up when the join is done', async () => {
    await rememberInvite('tok-native');
    await clearStoredInvite();
    expect(await readStoredInvite()).toBeNull();
  });

  it('does not store an absent token over a real one', async () => {
    await rememberInvite('tok-native');
    await rememberInvite(null);
    await rememberInvite(undefined);
    expect(await readStoredInvite()).toBe('tok-native');
  });

  it('does not crash when storage refuses', async () => {
    // Private browsing and a full disk both throw here. An invite that is not
    // remembered is the old behaviour; a crash on the landing screen is not.
    asMock.setItem.mockRejectedValue(new Error('QuotaExceeded'));
    asMock.getItem.mockRejectedValue(new Error('SecurityError'));
    await expect(rememberInvite('tok')).resolves.toBeUndefined();
    await expect(readStoredInvite()).resolves.toBeNull();
  });
});

describe('a bad invite must never be why somebody cannot sign in', () => {
  // This risk is created by the fix above. While the token died with the
  // browser tab a stale one was self-correcting; a token that persists gets
  // re-sent on every attempt, and every auth route on the server refuses
  // outright when the invite is unknown (404), expired (410) or already taken
  // (409). One stale invite would lock a phone out of signing in entirely,
  // with no way back short of reinstalling the app.
  const rejected = (status: number) =>
    Object.assign(new Error(`${status}: {"detail":"nope"}`), { status });

  it('signs in anyway when the invite has expired', async () => {
    await rememberInvite('stale');
    const run = jest.fn()
      .mockRejectedValueOnce(rejected(410))
      .mockResolvedValueOnce({ user: 'me' });

    await expect(signInWithPendingInvite(null, run)).resolves.toEqual({ user: 'me' });
    expect(run).toHaveBeenNthCalledWith(1, 'stale');
    expect(run).toHaveBeenNthCalledWith(2, undefined);
  });

  it('forgets the invite it just proved to be dead', async () => {
    // Otherwise the next sign-in re-sends it and fails the same way — which is
    // the lockout, one attempt later.
    await rememberInvite('stale');
    await signInWithPendingInvite(null, jest.fn()
      .mockRejectedValueOnce(rejected(404))
      .mockResolvedValueOnce({}));
    expect(await readStoredInvite()).toBeNull();
  });

  it('does not swallow a real sign-in failure', async () => {
    // A wrong password is 401 and must reach the person as a wrong password.
    await rememberInvite('good');
    const run = jest.fn().mockRejectedValue(rejected(401));
    await expect(signInWithPendingInvite(null, run)).rejects.toThrow('401');
    expect(run).toHaveBeenCalledTimes(1);
    expect(await readStoredInvite()).toBe('good');
  });

  it('spends the invite on success so it is not replayed', async () => {
    await rememberInvite('good');
    await signInWithPendingInvite(null, async () => ({}));
    expect(await readStoredInvite()).toBeNull();
  });

  it('prefers the token in hand over the stored one', async () => {
    await rememberInvite('older');
    const run = jest.fn().mockResolvedValue({});
    await signInWithPendingInvite('from-the-link', run);
    expect(run).toHaveBeenCalledWith('from-the-link');
  });

  it('keeps the invite when 409 means the EMAIL is taken, not the invite', async () => {
    // Register answers 409 for a duplicate account as well as for a spent
    // invite. Dropping a good invite because somebody typed a known address
    // would trade this bug for another one: they log in instead, and the join
    // they were sent the link for is gone.
    await rememberInvite('good');
    const run = jest.fn().mockRejectedValue(rejected(409));
    await expect(
      signInWithPendingInvite(null, run, INVITE_REJECTED_ON_EMAIL),
    ).rejects.toThrow('409');
    expect(await readStoredInvite()).toBe('good');
  });

  it('runs once, with nothing, when there is no invite at all', async () => {
    const run = jest.fn().mockResolvedValue({});
    await signInWithPendingInvite(null, run);
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(undefined);
  });
});
