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

export function clearStoredInvite() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem('pending_invite');
  } catch {
    // Ignore storage failure.
  }
}
