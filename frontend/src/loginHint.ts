import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A small, non-secret memory of the last successful sign-in, so a returning
 * user is greeted with "Welcome back — continue as r••••@gmail.com" instead of
 * a cold create-account screen. It holds ONLY the email and which method was
 * used — never a password or session token (those live in SecureStore).
 *
 * Deliberately durable: kept across sign-out (re-entry stays one tap) and only
 * cleared when the user taps "Not you?" or deletes their account. Local memory,
 * so a reinstall or "clear data" wipes it — a cold device cannot be recognised,
 * which is inherent, not a bug.
 */
export interface LoginHint {
  email: string;
  method: 'google' | 'email';
}

const KEY = 'coo_last_login_hint';

export async function saveLoginHint(hint: LoginHint): Promise<void> {
  if (!hint.email) return;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(hint));
  } catch {
    /* a hint is a convenience — never let it break sign-in */
  }
}

export async function getLoginHint(): Promise<LoginHint | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.email === 'string'
      && (parsed.method === 'google' || parsed.method === 'email')) {
      return parsed as LoginHint;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearLoginHint(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Mask an email for display on the landing: first character, dots, then the
 * full domain — "rolanddzoagbe@gmail.com" -> "r••••@gmail.com". Enough for the
 * owner to recognise, not enough to hand a bystander the whole address.
 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '••••';
  const local = email.slice(0, at);
  const domain = email.slice(at); // includes "@"
  const head = local.slice(0, 1);
  return `${head}••••${domain}`;
}
