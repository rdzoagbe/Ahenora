import { api, BASE, tokenStore } from './api';

export interface AuthDiagnosticResult {
  checked_at: string;
  local_token: boolean;
  backend_online: boolean;
  backend_message?: string;
  session_valid: boolean;
  session_email?: string;
  session_is_admin?: boolean;
  error?: string;
}

function shortError(error: any) {
  const message = error?.message || String(error || 'Unknown error');
  return message.length > 180 ? `${message.slice(0, 180)}...` : message;
}

export async function runAuthDiagnostics(): Promise<AuthDiagnosticResult> {
  const result: AuthDiagnosticResult = {
    checked_at: new Date().toISOString(),
    local_token: false,
    backend_online: false,
    session_valid: false,
  };

  try {
    const token = await tokenStore.get();
    result.local_token = Boolean(token);
  } catch (error) {
    result.error = `Token check failed: ${shortError(error)}`;
  }

  // Use the same resolved base URL the rest of the app uses (api.ts), which
  // falls back to the production backend when EXPO_PUBLIC_BACKEND_URL is not
  // inlined into the build. Reading process.env directly here previously caused
  // a false "backend unavailable" report even though the app worked fine.
  const base = BASE;
  if (!process.env.EXPO_PUBLIC_BACKEND_URL) {
    result.backend_message = 'EXPO_PUBLIC_BACKEND_URL not set — using production fallback.';
  }

  try {
    const res = await fetch(base, { method: 'GET' });
    result.backend_online = res.ok;
    const body = await res.json().catch(() => null);
    if (body?.message) result.backend_message = String(body.message);
    if (!res.ok) result.error = `Backend health returned HTTP ${res.status}.`;
  } catch (error) {
    result.error = `Backend health failed: ${shortError(error)}`;
  }

  if (!result.local_token) return result;

  try {
    const me = await api.me();
    result.session_valid = true;
    result.session_email = me.email;
    result.session_is_admin = Boolean(me.is_admin);
  } catch (error) {
    result.session_valid = false;
    result.error = `Session check failed: ${shortError(error)}`;
  }

  return result;
}
