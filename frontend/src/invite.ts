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
