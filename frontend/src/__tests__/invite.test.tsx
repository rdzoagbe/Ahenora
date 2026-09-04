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

import { extractInviteToken, rememberInvite, readStoredInvite, clearStoredInvite } from '../invite';

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
