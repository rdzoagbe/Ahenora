import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

// Shared by the landing screen (signed-out flow) and the in-app join prompt
// (signed-in flow) so both read invite links the same way.
export function extractInviteToken(rawUrl?: string | null) {
  if (!rawUrl) return null;

  try {
    const parsed = Linking.parse(rawUrl);
    const token = parsed.queryParams?.invite;
    if (typeof token === 'string' && token.trim()) return token.trim();
  } catch {
    // Fall back to URL parsing below.
  }

  try {
    const url = new URL(rawUrl.replace('#', '?'));
    const token = url.searchParams.get('invite');
    return token?.trim() || null;
  } catch {
    const match = rawUrl.match(/[?#&]invite=([^&#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }
}

/**
 * Where a tapped invite waits while its recipient signs in.
 *
 * It used to wait in two places, and neither of them held.
 *
 * On web it lived in sessionStorage, which is scoped to one tab. An invite
 * arrives by email, so the tap opens a NEW tab — often in the mail app's
 * in-app browser, which then hands off to the real browser for Google
 * sign-in. Every one of those handoffs is a fresh session storage.
 *
 * On native it lived nowhere at all: the token sat in React state, and the
 * only fallback to storage was guarded by `Platform.OS === 'web'`. Android
 * can destroy and recreate the activity while Google's sign-in sheet is in
 * front of it. Come back, and the token is simply gone.
 *
 * Both failures look identical to the person holding the phone: they tapped
 * the link, they signed in, and they are in their own empty household
 * wondering why they cannot see the children. That is exactly what a
 * co-parent reported — "the invite you sent didn't work".
 *
 * So it lives in AsyncStorage now, which is localStorage on web and real
 * device storage on native: one path, and it survives a tab, an app restart
 * and a re-created activity.
 */
const KEY = 'pending_invite';

export async function rememberInvite(token: string | null | undefined) {
  if (!token) return;
  // Written synchronously on web first. Google sign-in leaves via
  // window.location.assign, and a navigation does not wait for a promise.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try { window.localStorage.setItem(KEY, token); } catch { /* ignore */ }
  }
  try {
    await AsyncStorage.setItem(KEY, token);
  } catch {
    // Storage can be unavailable (private mode, full disk). An invite that is
    // not remembered is the old behaviour, not a crash.
  }
}

export async function readStoredInvite(): Promise<string | null> {
  try {
    const stored = await AsyncStorage.getItem(KEY);
    if (stored) return stored;
  } catch {
    // Fall through to the web reads below.
  }
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try {
      // sessionStorage is where this used to live. Read once so anyone who
      // tapped a link before this shipped still lands in the right household.
      return window.localStorage.getItem(KEY) || window.sessionStorage.getItem(KEY);
    } catch { /* ignore */ }
  }
  return null;
}

export async function clearStoredInvite() {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
    try { window.sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  }
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Ignore storage failure.
  }
}

/**
 * Run a sign-in with the pending invite, and never let a bad invite stop it.
 *
 * This became necessary the moment the token was made durable. Every auth
 * route — Google, Apple, register, login — refuses outright when the invite is
 * unknown (404), expired (410), or already taken by somebody else (409). While
 * the token died with the browser tab that was survivable; a token that
 * persists would be re-sent on every attempt, and one stale invite would lock
 * a phone out of signing in at all, with no way back short of reinstalling.
 *
 * An invite is a nice-to-have on top of signing in — and there is a server-side
 * safety net for it anyway (invites-for-me, which finds a waiting invite from
 * the email alone). So a rejected invite is dropped and the sign-in goes
 * through without it.
 */
// 404 unknown, 410 expired. 409 is "already accepted by somebody else" on the
// Google and Apple routes, where nothing else answers 409 — but on email
// register it is ALSO "an account with this email already exists", and
// dropping a perfectly good invite because somebody typed a known address
// would trade one bug for another. So the caller says which apply.
const INVITE_REJECTED = [404, 410];
const INVITE_REJECTED_UNAMBIGUOUS = [404, 409, 410];

export const INVITE_REJECTED_ON_EMAIL = INVITE_REJECTED;

export async function signInWithPendingInvite<T>(
  known: string | null | undefined,
  run: (token?: string) => Promise<T>,
  rejectedStatuses: number[] = INVITE_REJECTED_UNAMBIGUOUS,
): Promise<T> {
  const token = known || (await readStoredInvite()) || undefined;
  if (!token) return run(undefined);
  try {
    const result = await run(token);
    // Consumed. Leaving it behind means re-sending it on the next sign-in,
    // where it now reads as "already accepted".
    await clearStoredInvite();
    return result;
  } catch (e: any) {
    if (!rejectedStatuses.includes(e?.status)) throw e;
    await clearStoredInvite();
    return run(undefined);
  }
}
