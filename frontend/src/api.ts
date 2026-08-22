import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { cache } from './cache';
import { detectDeviceLang } from './i18n';
import {
  clearSnapshots, enqueueWrite, flushQueue, isQueueablePath, isSnapshotPath, loadSnapshot,
  queuedCount, saveSnapshot,
} from './offline';

const CACHE_TTL_MS = 30_000;

const PROD_BACKEND = "https://household-coo-production.up.railway.app";
const RAW_BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;
// Guard against a stale/wrong env value baked in at bundle time (CI secrets or
// EAS environment variables carrying the retired "-backend-" Railway subdomain,
// which 404s "Application not found" and breaks every sign-in). Any value that
// doesn't resolve to a usable backend falls back to the known-good URL.
//
// Loopback is allowed over plain http, and that is not a loosening. Requiring
// https meant a developer pointing at their own machine —
// EXPO_PUBLIC_BACKEND_URL=http://localhost:8000 — was silently ignored and the
// app talked to PRODUCTION instead: reading, and writing, real families' data
// while they believed they were local. A test build did exactly that here for
// months. Everything not loopback still has to be https.
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
const trimmedBackend = typeof RAW_BACKEND === "string"
  ? RAW_BACKEND.trim().replace(/\/+$/, "")
  : "";
const backendUsable =
  (trimmedBackend.startsWith("https://") || LOOPBACK.test(trimmedBackend)) &&
  !trimmedBackend.includes("household-coo-backend-production");
export const BASE = backendUsable ? trimmedBackend : PROD_BACKEND;
if (!backendUsable && RAW_BACKEND !== PROD_BACKEND) {
  console.warn(
    `EXPO_PUBLIC_BACKEND_URL ${RAW_BACKEND ? `(${RAW_BACKEND}) is not usable` : "is missing"}`
    + " — falling back to production",
  );
}

const TOKEN_KEY = 'coo_session_token';

export const tokenStore = {
  async get(): Promise<string | null> {
    try {
      const secureToken = await SecureStore.getItemAsync(TOKEN_KEY);
      if (secureToken) return secureToken;

      // One-time migration for users who signed in before SecureStore was enabled.
      const legacyToken = await AsyncStorage.getItem(TOKEN_KEY);
      if (legacyToken) {
        await SecureStore.setItemAsync(TOKEN_KEY, legacyToken);
        await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
        return legacyToken;
      }
      return null;
    } catch {
      // Development/web fallback only. Native builds should use SecureStore.
      try {
        return await AsyncStorage.getItem(TOKEN_KEY);
      } catch {
        return null;
      }
    }
  },
  async set(token: string) {
    try {
      await SecureStore.setItemAsync(TOKEN_KEY, token);
      await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
    } catch {
      if (Platform.OS === 'web') {
        await AsyncStorage.setItem(TOKEN_KEY, token);
      }
      // On native, SecureStore failure is unrecoverable — do not fall back to plaintext storage.
    }
  },
  async clear() {
    await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
    await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
  },
};

/**
 * Kid mode swaps which token this device is using. The parent's token is set
 * aside rather than thrown away, so coming back out is a PIN rather than a
 * fresh sign-in — and it lives in SecureStore alongside the real one, not in
 * memory, so it survives the app being closed while a child is using it.
 */
const PARENT_TOKEN_KEY = 'coo_parent_token';

export const kidMode = {
  async enter(childToken: string): Promise<void> {
    const parent = await tokenStore.get();
    if (parent) {
      try {
        await SecureStore.setItemAsync(PARENT_TOKEN_KEY, parent);
      } catch {
        if (Platform.OS === 'web') await AsyncStorage.setItem(PARENT_TOKEN_KEY, parent);
      }
    }
    await tokenStore.set(childToken);
    cache.clear();
  },
  async storedParentToken(): Promise<string | null> {
    try {
      const t = await SecureStore.getItemAsync(PARENT_TOKEN_KEY);
      if (t) return t;
    } catch { /* fall through to the web path */ }
    try { return await AsyncStorage.getItem(PARENT_TOKEN_KEY); } catch { return null; }
  },
  async isActive(): Promise<boolean> {
    return (await kidMode.storedParentToken()) !== null;
  },
  /** Hand the device back. The PIN check has already happened on the server. */
  async leave(): Promise<boolean> {
    const parent = await kidMode.storedParentToken();
    if (!parent) return false;
    await tokenStore.set(parent);
    await SecureStore.deleteItemAsync(PARENT_TOKEN_KEY).catch(() => undefined);
    await AsyncStorage.removeItem(PARENT_TOKEN_KEY).catch(() => undefined);
    cache.clear();
    return true;
  },
};

const REQUEST_TIMEOUT_MS = 30_000;

const RETRY_MAX = 3;
const RETRY_BASE_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fire-and-forget ping to wake a cold (idle) backend while the user is still
// on the landing screen, so the first real request — usually sign-in — doesn't
// absorb the full cold-start delay and time out.
export function warmupBackend(): void {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20_000);
  fetch(BASE, { method: 'GET', signal: controller.signal }).catch(() => undefined);
}

// Screens show a quiet "showing your last saved copy" line when reads are
// being served from disk, and a "will sync" note while writes are waiting.
export interface OfflineState {
  /** The last read this app served came off the disk, not the server. */
  fromCache: boolean;
  /** Writes made with no signal, still waiting to reach the server. */
  pending: number;
}

let offlineState: OfflineState = { fromCache: false, pending: 0 };
const offlineListeners = new Set<(state: OfflineState) => void>();

export function getOfflineState(): OfflineState {
  return offlineState;
}
export function isServingFromCache(): boolean {
  return offlineState.fromCache;
}
export function onOfflineStateChange(fn: (state: OfflineState) => void): () => void {
  offlineListeners.add(fn);
  return () => offlineListeners.delete(fn);
}
function patchOfflineState(next: Partial<OfflineState>) {
  const merged = { ...offlineState, ...next };
  if (merged.fromCache === offlineState.fromCache && merged.pending === offlineState.pending) return;
  offlineState = merged;
  offlineListeners.forEach((fn) => {
    try { fn(merged); } catch { /* a listener must not break a request */ }
  });
}
function setServingFromCache(value: boolean) {
  patchOfflineState({ fromCache: value });
}
/**
 * Re-read what is waiting and tell anyone listening. Asynchronous on purpose:
 * a screen can call this on mount without changing what it renders first.
 */
export function refreshOfflineState(): void {
  queuedCount()
    .then((pending) => {
      // Force a notification even when nothing moved, so a component that
      // mounted with neutral state learns the truth.
      offlineState = { ...offlineState, pending };
      offlineListeners.forEach((fn) => {
        try { fn(offlineState); } catch { /* a listener must not break a request */ }
      });
    })
    .catch(() => undefined);
}
// At launch the queue may already hold work from a previous, offline session.
refreshOfflineState();
/** Sign-out wipes the disk copies, so the banner must not keep describing them. */
export function resetOfflineState(): void {
  patchOfflineState({ fromCache: false, pending: 0 });
}

// The store registers a handler so an expired session (401) mid-session can
// clear auth state and route back to the landing screen, instead of leaving
// screens silently blank until the app is restarted.
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

// Failed requests phone home (network failures and 5xx only) so breakage on
// a family device is visible to the admin without a screenshot relay. Plain
// fetch — going through request() could recurse; throttled; never throws.
let errorReportTimes: number[] = [];
function reportClientError(path: string, method: string, status: number | undefined, message: string) {
  try {
    if (path.startsWith('/telemetry')) return;
    const now = Date.now();
    errorReportTimes = errorReportTimes.filter((t) => now - t < 60_000);
    if (errorReportTimes.length >= 5) return;
    errorReportTimes.push(now);
    tokenStore
      .get()
      .then((token) => {
        if (!token) return;
        return fetch(`${BASE}/api/telemetry/client-error`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            endpoint: path.split('?')[0],
            method,
            status: status ?? null,
            message: String(message || '').slice(0, 300),
            platform: Platform.OS,
          }),
        });
      })
      .catch(() => undefined);
  } catch {
    // Telemetry must never interfere with the request it describes.
  }
}

// Replaying uses a bare fetch: going back through request() would re-queue a
// failure and loop.
let draining = false;
function drainQueue(): void {
  if (draining) return;
  draining = true;
  flushQueue(async (path, method, body) => {
    const token = await tokenStore.get();
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      // Carry the status so flushQueue can tell a permanent 4xx refusal (drop)
      // from a transient 5xx/429 (keep queued) without parsing the message.
      throw Object.assign(new Error(`${res.status}: ${await res.text()}`), { status: res.status });
    }
    return res.json().catch(() => ({}));
  })
    .then(({ sent, left }) => {
      if (sent > 0) cache.clear();
      patchOfflineState({ pending: left });
    })
    .catch(() => undefined)
    .finally(() => { draining = false; });
}

async function request<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> {
  const token = await tokenStore.get();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    // Which platform this request comes from — the backend counts distinct
    // daily-active users per platform from it, so "web vs app" is answerable
    // (web users can't buy through the store, so the split explains conversion).
    'X-Client-Platform': Platform.OS,
    ...(opts.headers || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    if (attempt > 0) {
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt - 1));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(`${BASE}/api${path}`, {
        method: opts.method || 'GET',
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      // Check the error name directly — `DOMException` is not a defined global
      // on Hermes (release builds), so referencing it here would itself throw.
      const isAbort = (err as { name?: string })?.name === 'AbortError';
      const isGet = !opts.method || opts.method.toUpperCase() === 'GET';
      // A timeout (AbortError) on a GET is safe to retry — this rides out a
      // cold backend start (Railway wake-up). Never retry a non-GET on timeout:
      // the write may have landed, and a retry could duplicate it.
      if (isAbort && !isGet) {
        reportClientError(path, opts.method || 'GET', undefined, `timeout: ${(err as Error)?.message || err}`);
        throw err;
      }
      // Network error or GET timeout — retry if we have attempts left.
      lastError = err;
      if (attempt < RETRY_MAX) continue;
      reportClientError(path, opts.method || 'GET', undefined, `network: ${(err as Error)?.message || err}`);

      // Out of attempts. A shopping list you cannot read in the shop is the
      // one failure a household app cannot afford: serve the last copy.
      if (isGet && isSnapshotPath(path)) {
        const snap = await loadSnapshot<T>(path);
        if (snap) {
          setServingFromCache(true);
          return snap.data;
        }
      }
      // Ticking something off with no signal is remembered, not lost. Only
      // writes that state a final value are queued (see offline.ts).
      if (!isGet && isQueueablePath(path, opts.method || 'GET')) {
        await enqueueWrite(path, opts.method || 'PATCH', opts.body);
        patchOfflineState({ fromCache: true, pending: await queuedCount() });
        return ({ ...(opts.body as object), queued: true } as unknown) as T;
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    // Retry on 5xx — but only GETs. A non-GET may have committed server-side
    // before the error surfaced, so retrying it risks a duplicate write (a
    // second card, a second allowance payment). This is the same rule the
    // timeout path above applies; it was missing here.
    if (res.status >= 500 && res.status < 600) {
      const is5xxGet = !opts.method || opts.method.toUpperCase() === 'GET';
      if (is5xxGet && attempt < RETRY_MAX) {
        lastError = Object.assign(new Error(`${res.status}`), { status: res.status });
        continue;
      }
      // Out of retries, or a write we won't retry. A reachable-but-erroring
      // backend is still an outage from where the user stands, so serve the
      // last good copy of a readable list rather than an error screen — the
      // same fallback the network-error path already gives, previously denied
      // whenever the outage happened to be a 5xx instead of a dropped socket.
      if (is5xxGet && isSnapshotPath(path)) {
        const snap = await loadSnapshot<T>(path);
        if (snap) {
          setServingFromCache(true);
          return snap.data;
        }
      }
    }

    if (!res.ok) {
      const text = await res.text();
      // A 401 on a non-auth endpoint means the session expired or was revoked.
      // Clear the token and let the app return to the landing screen. Auth
      // endpoints (login/register/session) use 401 for bad credentials, so
      // they must not trigger a global sign-out.
      // 401 means two different things. On most endpoints it means the
      // session died and the app should return to the landing screen. On
      // these it means "wrong credentials" — a mistyped password, or a child
      // fumbling their PIN — and signing the household out over a typo would
      // be absurd. A wrong kid PIN used to log the parent out entirely.
      // All /kid/ routes ride the short-lived kid session, and the kid screen
      // owns its lifecycle: on a 401 it calls kidMode.leave() to restore the
      // parent token and returns to the picker. If the GLOBAL handler fired
      // here it would first clear the token, wipe the parent's snapshots, and
      // null the store user — dumping a still-signed-in parent on the landing
      // screen just because an overnight kid session lapsed. So exclude /kid/.
      const CREDENTIAL_PATHS = ['/auth/', '/kid/'];
      const isCredentialCheck = CREDENTIAL_PATHS.some((p) => path.startsWith(p));
      if (res.status === 401 && !isCredentialCheck) {
        await tokenStore.clear().catch(() => undefined);
        cache.clear();
        // A revoked session must not leave a readable copy of the household
        // behind — including the remembered identity that would let a cold
        // offline launch walk straight back in.
        await clearSnapshots().catch(() => undefined);
        resetOfflineState();
        if (unauthorizedHandler) unauthorizedHandler();
      }
      if (res.status === 402) {
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>;
          const detail = (parsed.detail ?? parsed) as Record<string, unknown>;
          const err = Object.assign(
            new Error((detail?.message as string) || 'Plan limit reached'),
            { status: 402, planLimit: detail }
          );
          throw err;
        } catch (e) {
          if ((e as { planLimit?: unknown }).planLimit) throw e;
        }
      }
      throw Object.assign(new Error(`${res.status}: ${text}`), { status: res.status });
    }
    if (res.status === 204) return {} as T;
    const payload = (await res.json()) as T;
    // A good answer means the connection is back: keep the copy, tell the UI,
    // and push out anything that was ticked off while offline.
    setServingFromCache(false);
    if ((!opts.method || opts.method === 'GET') && isSnapshotPath(path)) {
      saveSnapshot(path, payload).catch(() => undefined);
    }
    drainQueue();
    return payload;
  }

  // 5xx retries exhausted.
  reportClientError(
    path,
    opts.method || 'GET',
    (lastError as { status?: number })?.status,
    `server: ${(lastError as Error)?.message || lastError}`,
  );
  throw lastError;
}

export type CardType = 'SIGN_SLIP' | 'RSVP' | 'TASK' | 'BIRTHDAY' | 'SCHOOL' | 'APPOINTMENT' | 'VACATION';
export type CardStatus = 'OPEN' | 'DONE';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export interface Card {
  card_id: string;
  family_id: string;
  type: CardType;
  title: string;
  description?: string;
  assignee?: string;
  due_date?: string | null;
  status: CardStatus;
  source: 'AI' | 'MANUAL' | 'VOICE' | 'CAMERA' | 'CALENDAR';
  image_base64?: string | null;
  recurrence: Recurrence;
  reminder_minutes: number;
  created_at: string;
  completed_at?: string | null;
  completed_by_name?: string | null;
  google_event_id?: string | null;
  google_ical_uid?: string | null;
  external_source?: string | null;
  shared?: boolean;
  created_by_user_id?: string | null;
  // Set only by the shared-visibility view: who shared this item. Used to
  // name the person in the "what you see of them" direction.
  shared_by_name?: string;
}

export interface HandoffNote {
  note_id: string;
  family_id: string;
  member_id?: string;
  member_name?: string;
  text: string;
  author_name: string;
  created_at: string;
}

export interface ShoppingItem {
  item_id: string;
  family_id: string;
  name: string;
  category: string;
  checked: boolean;
  added_by: string;
  created_at: string;
}

export interface Expense {
  expense_id: string;
  family_id: string;
  description: string;
  amount: number;
  category: string;
  child_member_id?: string;
  child_name?: string;
  paid_by_name: string;
  paid_by_user_id?: string;
  created_at: string;
}

export interface ExpenseSummary {
  total: number;
  by_person: Record<string, number>;
  by_category: Record<string, number>;
  days: number;
}

export interface Template {
  template_id: string;
  family_id: string;
  title: string;
  description?: string;
  recurrence: string;
  time_of_day?: string;
  assignee?: string;
  enabled: boolean;
  created_at: string;
}

export interface RoutineStep {
  label: string;
  duration_seconds: number;
}

export interface Routine {
  routine_id: string;
  family_id: string;
  name: string;
  steps: RoutineStep[];
  member_id?: string;
  /** Stars the child earns for completing it. */
  star_reward?: number;
  created_at: string;
}

export interface ShoppingHistoryEntry {
  history_id: string;
  items: string[];
  created_at: string;
}

export interface SavedMealPlan {
  plan_id: string;
  name: string;
  meals: { day: string; title: string; ingredients: string[] }[];
  created_at: string;
}

export interface MealPlan {
  meal_id: string;
  family_id: string;
  day: string;
  meal_type: string;
  title: string;
  ingredients: string[];
  notes?: string;
  /** Set when the meal came from the suggestion library, so its title can be
   *  re-rendered in the current language instead of frozen at creation time. */
  recipe_id?: string | null;
  /** Generated cooking methods, cached per language. */
  ai_recipe?: Record<string, AiRecipe>;
  /** Vegetarian rewrites, cached per language in their own slot so they never
   *  clash with the omnivore version above. */
  ai_recipe_vegetarian?: Record<string, AiRecipe>;
  created_at: string;
}

export interface AiRecipe {
  minutes: number;
  steps: string[];
  servings?: number;
  ingredients?: { name: string; qty: number | null; unit: string }[];
  title?: string;
}

export type Diet = '' | 'vegetarian';

export interface Carpool {
  carpool_id: string;
  family_id: string;
  title: string;
  day_of_week: string;
  time: string;
  driver_name: string;
  pickup_kids: string[];
  notes?: string;
  created_at: string;
}

export interface AllowanceConfig {
  allowance_id: string;
  family_id: string;
  member_id: string;
  amount: number;
  frequency: string;
  created_at: string;
  /** Null until the first payment is recorded. */
  last_paid_at?: string | null;
  /** When the next payment is payable. A new allowance is due immediately. */
  next_due_at: string;
  is_due: boolean;
}

export interface AllowanceTxn {
  txn_id: string;
  family_id: string;
  member_id: string;
  amount: number;
  description: string;
  txn_type: string;
  created_at: string;
}

export interface Announcement {
  announcement_id: string;
  family_id: string;
  text: string;
  author_name: string;
  priority: string;
  created_at: string;
}

export interface ExpiryAlert {
  doc_id: string;
  title: string;
  category: string;
  expiry_date: string;
  days_left: number;
  status: string;
}

export interface WeeklyReport {
  period_start: string;
  period_end: string;
  tasks_completed: number;
  tasks_created: number;
  tasks_overdue: number;
  stars_earned: number;
  total_spent: number;
  expense_by_category: Record<string, number>;
  routines_completed: number;
  upcoming_deadlines: { title: string; due_date: string; type: string; assignee?: string }[];
}

export interface Chore {
  chore_id: string;
  family_id: string;
  title: string;
  frequency: string;
  assigned_members: string[];
  current_assignee?: string;
  rotate: boolean;
  /** Stars the assignee earns for finishing it. */
  star_reward?: number;
  last_rotated?: string;
  created_at: string;
}

export interface User {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  family_id: string;
  language: string;
  is_admin?: boolean;
  onboarding_completed?: boolean;
  /** Password account (asks for the password to delete) vs Google (asks for a
   *  typed confirmation instead). */
  has_password?: boolean;
  /** A restricted 13-17 account — routed to the teen view, not the full app. */
  is_teen?: boolean;
  is_helper?: boolean;
}

export interface TeenCard {
  card_id: string;
  title: string;
  due_date: string | null;
  status?: string | null;
  assignee?: string | null;
}

export interface TeenHome {
  name: string;
  tasks: TeenCard[];
  agenda: TeenCard[];
  stars: number;
  week_earned: number;
}

export interface ChatMessage {
  message_id: string;
  thread: string;
  sender_kind: 'parent' | 'teen';
  sender_name: string;
  text: string;
  created_at: string;
  mine: boolean;
  read: boolean;
}

export interface ChatThreadSummary {
  thread: string;
  title: string | null;
  is_adults: boolean;
  unread: number;
  last_text: string;
  last_at: string | null;
}

/** True when a normal endpoint refused a teen token (require_user's 403). The
 *  signal to switch the app into the restricted teen view. */
export function isTeenModeError(e: any): boolean {
  return e?.status === 403 && String(e?.message || '').includes('teen_mode');
}

export interface FamilyMember {
  member_id: string;
  family_id: string;
  name: string;
  role: string;
  avatar?: string | null;
  stars: number;
  /** Stars earned since Monday — the meter that gates weekend treats and drives
   *  the weekly ring. The `stars` field above is the untouched saved bank. */
  week_earned?: number;
  /** The target this week is measured against, and whether it has already been
   *  cashed in. Both come from the server so the app never keeps its own copy
   *  of a rule the server enforces. */
  weekly_target?: number;
  week_claimed?: boolean;
  weekend_goal_reward_id?: string | null;
  has_pin?: boolean;
  has_account?: boolean;
  /** Set by GET /family/members: whether this row is the signed-in user, and
   *  whether they are the household founder (the only parent nobody can remove). */
  is_me?: boolean;
  is_founder?: boolean;
  /** A teen's own user_id — the key of their private chat thread. Null for a
   *  managed child (no account). Lets the app open the right thread by id. */
  user_id?: string | null;
}

export interface Reward {
  reward_id: string;
  family_id: string;
  title: string;
  cost_stars: number;
  icon?: string | null;
  /** A weekend treat is paid from this week's earnings, not just the bank. */
  weekend?: boolean;
  created_at: string;
}

export interface Redemption {
  redemption_id: string;
  family_id: string;
  member_id: string;
  reward_id?: string | null;
  /** Copied at redeem time, so renaming or deleting a reward never rewrites
   *  what a child was promised. */
  reward_title: string;
  reward_icon?: string | null;
  cost_stars: number;
  /** Claimed with a full week rather than paid for out of the saved balance. */
  weekly?: boolean;
  status: 'pending' | 'fulfilled' | 'cancelled';
  created_at: string;
  fulfilled_at?: string | null;
  cancelled_at?: string | null;
}

export interface StarTransaction {
  transaction_id: string;
  family_id: string;
  member_id: string;
  delta: number;
  reason?: string | null;
  created_by_user_id?: string | null;
  created_by_name?: string | null;
  created_at?: string | null;
  /** The day the star was for — set when a parent fills in a missed day. */
  awarded_for?: string | null;
}

export interface MetricRow {
  date: string;
  name: string;
  count: number;
}

export interface FunnelSummary {
  window_days: number;
  total_users: number;
  signups: number;
  onboarded: number;
  invites_sent: number;
  invites_accepted: number;
  multi_member_households: number;
  sharing_households: number;
  active_1d: number;
  active_7d: number;
}

export interface AiHealth {
  key_configured: boolean;
  library_loaded: boolean;
  client_ready: boolean;
  sdk: string;
  model_env: string | null;
  model_resolved: string | null;
  model_candidates: string[];
  last_error: string | null;
  model_errors: Record<string, string>;
  features: string[];
}

export interface VersionAdoption {
  current_runtime: string;
  store_version: string;
  users_on_current_runtime: number;
  total_users_with_a_device: number;
  pct_on_current_runtime: number;
  by_runtime: Record<string, number>;
  by_app_version: Record<string, number>;
  devices_seen: number;
  devices_reporting_version: number;
}

export interface PlanAdoption {
  billing_live: boolean;
  total_families: number;
  by_stored_plan: Record<string, number>;
  paying_families: number;
  tester_households: number;
  free_premium_families: number;
  active_families_with_device: number;
  active_paying_families: number;
  pct_active_paying: number;
  active_free_premium_families: number;
}

export interface FamilyInvite {
  invite_id: string;
  family_id: string;
  email?: string | null;
  relationship?: string | null;
  label?: string | null;
  status: 'pending' | 'accepted' | 'expired';
  token?: string;
  invite_url?: string;
  created_at?: string | null;
  expires_at?: string | null;
  accepted_at?: string | null;
  accepted_by_email?: string | null;
  created_by_name?: string | null;
}

export interface CalendarContact {
  email: string;
  name?: string | null;
  event_count: number;
  first_seen_at?: string | null;
  last_seen_at?: string | null;
  last_event_title?: string | null;
}

export interface NotificationSettings {
  card_reminders: boolean;
  new_card_alerts: boolean;
  updated_at?: string | null;
}
export interface CalendarImportResult {
  ok: boolean;
  imported: number;
  // A rescheduled meeting moves its card; a cancelled one removes it.
  updated?: number;
  removed?: number;
  skipped: number;
  events_seen: number;
  contacts_found: number;
  contacts: CalendarContact[];
  days: number;
}

export type VaultVisibility = 'private' | 'shared';

export interface FamilyProfile {
  member_id: string;
  name: string;
  role: string;
  is_child: boolean;
  has_pin: boolean;
  /** The row belonging to whoever is holding the phone. */
  is_me: boolean;
}

export interface KidChore { card_id: string; title: string; due_date: string | null }

export interface KidHome {
  name: string;
  stars: number;
  week_earned?: number;
  weekend_goal_reward_id?: string | null;
  chores: KidChore[];
  rewards: Reward[];
  owed: Redemption[];
}

export type SearchKind = 'task' | 'event' | 'note' | 'document' | 'shopping' | 'meal';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  subtitle: string;
  when: string;
  status: string;
}

export interface SearchResponse {
  query: string;
  results: SearchHit[];
  truncated: boolean;
}

export interface ActivityEntry {
  activity_id: string;
  actor_name: string;
  actor_user_id?: string | null;
  kind: 'task_created' | 'task_done' | 'task_assigned' | 'stars_awarded'
      | 'member_joined' | 'week_planned' | 'list_cleared' | 'doc_shared';
  subject: string;
  /** Who the event landed on, for the ones that are about a person too. */
  target?: string;
  amount?: number | null;
  /** False for a private line only you see; true for a shared household one. */
  shared?: boolean;
  created_at: string;
}

export interface VaultDoc {
  doc_id: string;
  family_id: string;
  title: string;
  category: string;
  image_base64: string;
  mime_type?: string;
  file_name?: string | null;
  visibility?: VaultVisibility;
  owner_user_id?: string | null;
  owner_name?: string | null;
  created_at: string;
}

export interface CapturedRecipe {
  title: string;
  minutes: number;
  servings: number;
  ingredients: { name: string; qty: number | null; unit: string }[];
  steps: string[];
}

/**
 * What one photograph turned out to be.
 *
 * `understood` is the honest field: false means the scan ran and produced
 * nothing usable, so the app should ask rather than present a guess. An
 * empty `vault_category` means the same thing about the drawer — the old
 * endpoint defaulted to "School", which is how a gas bill ended up filed
 * with the permission slips.
 */
export interface ScanResult {
  kind: 'document' | 'recipe';
  type: CardType;
  title: string;
  description: string;
  assignee: string;
  due_date?: string | null;
  vault_category?: string;
  amount?: string | null;
  save_to_vault?: boolean;
  understood?: boolean;
  recipe?: CapturedRecipe;
}

export type Plan = 'village' | 'executive' | 'family_office';
export type BillingCycle = 'monthly' | 'yearly';

export interface Subscription {
  plan: Plan;
  billing_cycle: BillingCycle;
  grandfathered: boolean;
  testing_window?: boolean;
  // Announced billing cutover date (ISO). When set and in the future, the app
  // shows a countdown instead of the plain free-preview notice.
  billing_starts_at?: string | null;
  children_count?: number;
  young_people_count?: number;
  updated_at: string;
  ai_scans_used: number;
  ai_scans_period_start: string;
  vault_bytes_used: number;
  members_count: number;
  limits: {
    max_members: number;
    ai_scans_per_month: number;
    vault_bytes: number;
    weekly_brief: boolean;
    multi_property: boolean;
    meal_planner: boolean;
    allowance: boolean;
    carpool: boolean;
    weekly_report: boolean;
  };
  price_monthly: number;
  price_yearly: number;
  admin_unlocked?: boolean;
}

export interface Entitlements {
  plan: Plan;
  admin_unlocked?: boolean;
  members_count: number;
  pending_invites: number;
  member_slots_used: number;
  max_members: number;
  can_invite: boolean;
  ai_scans_used: number;
  ai_scans_limit: number;
  vault_bytes_used: number;
  vault_bytes_limit: number;
  weekly_brief: boolean;
  multi_property: boolean;
  features?: {
    meal_planner: boolean;
    allowance: boolean;
    carpool: boolean;
    weekly_report: boolean;
  };
}

export interface PlanLimitError {
  error: 'plan_limit';
  feature: string;
  current_plan?: Plan;
  limit?: number;
  used?: number;
  message: string;
}

// Invalidate the cached plan-usage snapshots so counters (member slots,
// vault storage, AI scans, pending invites) refresh after a mutation that
// changes them, instead of showing stale values for the cache TTL.
function invalidateUsageCaches() {
  cache.invalidate('getEntitlements');
  cache.invalidate('getSubscription');
}

// Fire-and-forget first-party usage counter (count-only, no payloads). Never
// throws and never retries — losing an event is fine, bothering the user isn't.
export function logEvent(name: string): void {
  tokenStore.get().then((token) => {
    if (!token) return;
    fetch(`${BASE}/api/metrics/event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name }),
    }).catch(() => undefined);
  }).catch(() => undefined);
}

export const api = {
  // Auth
  exchangeSession: (session_id: string, invite_token?: string) =>
    request<{ user: User; session_token: string }>('/auth/session', {
      method: 'POST',
      body: { session_id, ...(invite_token ? { invite_token } : {}), language: detectDeviceLang() },
    }),
  registerWithEmail: (data: { name: string; email: string; password: string; invite_token?: string; language?: string }) =>
    request<{ user: User; session_token: string }>('/auth/register', { method: 'POST', body: data }),
  loginWithEmail: (data: { email: string; password: string; invite_token?: string }) =>
    request<{ user: User; session_token: string }>('/auth/login', { method: 'POST', body: data }),
  me: () => request<User>('/auth/me'),
  changePassword: (data: { current_password: string; new_password: string }) =>
    request<{ ok: boolean }>('/auth/change-password', { method: 'POST', body: data }),
  requestPasswordReset: (email: string) =>
    request<{ ok: boolean }>('/auth/request-password-reset', { method: 'POST', body: { email } }),
  resetPassword: (data: { email: string; code: string; new_password: string }) =>
    request<{ user: User; session_token: string }>('/auth/reset-password', { method: 'POST', body: data }),
  logout: () => {
    cache.clear();
    return request('/auth/logout', { method: 'POST' });
  },
  deleteAccount: (data: { password?: string; confirm?: boolean }) => {
    cache.clear();
    return request<{ ok: boolean; deleted_household: boolean }>(
      '/auth/delete-account', { method: 'POST', body: data });
  },
  setLanguage: (language: string) =>
    request('/auth/language', { method: 'PATCH', body: { language } }),
  completeOnboarding: () =>
    request<User>('/auth/complete-onboarding', { method: 'POST' }),
  invite: (email: string, relationship?: string, opts?: { is_teen?: boolean; age?: number; is_helper?: boolean }) => {
    invalidateUsageCaches();
    const body: Record<string, unknown> = { email };
    if (relationship) body.relationship = relationship;
    if (opts?.is_teen) { body.is_teen = true; if (opts.age != null) body.age = opts.age; }
    if (opts?.is_helper) body.is_helper = true;
    return request<{
      ok: boolean;
      sent: boolean;
      status: string;
      message: string;
      invite: FamilyInvite;
      invite_url?: string;
      error?: string;
      email_provider?: string;
      email_error?: string;
    }>('/family/invite', {
      method: 'POST',
      body,
    });
  },
  createInviteLink: (opts?: { relationship?: string; label?: string; is_helper?: boolean }) => {
    invalidateUsageCaches();
    return request<{ ok: boolean; invite: FamilyInvite; invite_url: string }>('/family/invite/link', {
      method: 'POST',
      body: opts && (opts.relationship || opts.label || opts.is_helper) ? opts : {},
    });
  },
  getMetricsSummary: (days = 14) =>
    request<{ days: number; rows: MetricRow[] }>(`/metrics/summary?days=${days}`),
  getMetricsFunnel: (days = 30) =>
    request<FunnelSummary>(`/metrics/funnel?days=${days}`),
  // AI reliability probe (admin). probe=0 is free (reports configured state);
  // probe=1 does one tiny real generation. The Metrics screen uses probe=0.
  getAiHealth: () =>
    request<AiHealth>('/health/ai'),
  getVersionAdoption: () =>
    request<VersionAdoption>('/admin/version-adoption'),
  getPlanAdoption: () =>
    request<PlanAdoption>('/admin/plan-adoption'),
  listInvites: () => request<FamilyInvite[]>('/family/invites'),
  completeInvite: (inviteId: string) => {
    invalidateUsageCaches();
    return request<{ ok: boolean; joined: boolean; member_email: string }>(
      `/family/invites/${inviteId}/complete`,
      { method: 'POST' },
    );
  },
  deleteInvite: (inviteId: string) => {
    invalidateUsageCaches();
    return request<{ ok: boolean }>(`/family/invites/${inviteId}`, { method: 'DELETE' });
  },
  getInvite: (token: string) =>
    request<{
      invite_id: string;
      status: string;
      inviter_name: string;
      relationship?: string | null;
      email?: string;
      expires_at?: string | null;
    }>(`/family/invite/${encodeURIComponent(token)}`),
  listClientErrors: () =>
    request<{
      error_id: string;
      name?: string | null;
      endpoint: string;
      method?: string;
      status?: number | null;
      message?: string;
      platform?: string;
      created_at?: string | null;
    }[]>('/telemetry/client-errors'),
  // Deliberately bland URL: one family device blocks every path containing
  // "invite" or "membership" (keyword filter lists) — discovery and
  // acceptance both live at a name no list targets.
  invitesForMe: () =>
    request<{ token: string; inviter_name: string; relationship?: string | null }[]>(
      '/family/updates',
    ),
  // Deliberately bland path: ad-block filter lists kill URLs containing
  // words like "accept" ("Load failed" on the invitee's iPhone on both
  // Wi-Fi and 5G). "membership" appears on no blocklist.
  acceptInvite: (token: string) => {
    invalidateUsageCaches();
    return request<{ ok: boolean; joined: boolean; user: User }>('/family/membership', {
      method: 'POST',
      body: { token },
    });
  },
  // GET twin used when the POST dies in the network layer (some networks
  // and blockers drop cross-origin POSTs while identical GETs sail through).
  acceptInviteViaGet: (token: string) => {
    invalidateUsageCaches();
    return request<{ ok: boolean; joined: boolean; user: User }>(
      `/family/membership?token=${encodeURIComponent(token)}`,
    );
  },
  // Last-resort accept over the discovery URL itself. The join card only
  // exists because THIS exact request succeeded moments earlier, so this
  // request shape provably passes whatever the device blocks — anyone who
  // can see the offer can take it. The token rides a HEADER, not the query:
  // one field blocker matched query strings too, and content-blocker rules
  // match URLs but cannot see headers — this request is byte-identical in
  // URL and method to the one that populated the card.
  acceptInviteViaDiscovery: (token: string) => {
    invalidateUsageCaches();
    return request<{ ok: boolean; joined: boolean; user: User }>(
      '/family/updates',
      { headers: { 'X-Confirm': token } },
    );
  },
  importGoogleCalendar: (access_token: string, days = 30) =>
    request<CalendarImportResult>('/calendar/import', {
      method: 'POST',
      body: { access_token, days },
    }),
  importMicrosoftCalendar: (access_token: string, days = 30) =>
    request<CalendarImportResult>('/calendar/import-microsoft', {
      method: 'POST',
      body: { access_token, days },
    }),
  listCalendarContacts: () => request<CalendarContact[]>('/calendar/contacts'),
  // Family
  familyMembers: () => {
    const cacheKey = 'familyMembers';
    const cached = cache.get<FamilyMember[]>(cacheKey);
    if (cached) return Promise.resolve(cached);
    return request<FamilyMember[]>('/family/members').then((data) => {
      cache.set(cacheKey, data, CACHE_TTL_MS);
      return data;
    });
  },
  createFamilyMember: (data: { name: string; starting_stars?: number; pin?: string }) => {
    cache.invalidate('familyMembers');
    invalidateUsageCaches();
    return request<FamilyMember>('/family/members', {
      method: 'POST',
      body: data,
    });
  },
  deleteFamilyMember: (member_id: string) => {
    cache.invalidate('familyMembers');
    invalidateUsageCaches();
    return request(`/family/members/${member_id}`, { method: 'DELETE' });
  },
  setWeekendGoal: (member_id: string, reward_id: string | null) => {
    cache.invalidate('familyMembers');
    return request<FamilyMember>(`/family/members/${member_id}/weekend-goal`, {
      method: 'PUT', body: { reward_id },
    });
  },
  /** Claim the week's treat. Costs no stars — the week already paid for it. */
  claimWeeklyTreat: (member_id: string, title: string) => {
    cache.invalidate('familyMembers');
    return request<{ ok: boolean; redemption: Redemption }>(
      `/family/members/${member_id}/weekly-claim`,
      { method: 'POST', body: { title } },
    );
  },
  /** `awarded_for` credits an earlier day of THIS week, for a parent catching
   *  up — without it, Tuesday's job lands on Sunday. */
  adjustMemberStars: (member_id: string, data: { delta: number; reason?: string; awarded_for?: string }) => {
    cache.invalidate('familyMembers');
    return request<{ ok: boolean; member: FamilyMember; transaction: StarTransaction }>(
      `/family/members/${member_id}/stars`,
      {
        method: 'POST',
        body: data,
      }
    );
  },
  memberStarHistory: (member_id: string) =>
    request<StarTransaction[]>(`/family/members/${member_id}/star-history`),
  updateFamilyMember: (member_id: string, data: { name?: string; avatar?: string }) => {
    cache.invalidate('familyMembers');
    return request<FamilyMember>(`/family/members/${member_id}`, { method: 'PATCH', body: data });
  },
  setMemberPin: (member_id: string, pin: string) => {
    cache.invalidate('familyMembers');
    return request<{ ok: boolean; has_pin: boolean }>(`/family/members/${member_id}/pin`, {
      method: 'PUT',
      body: { pin },
    });
  },
  verifyMemberPin: (member_id: string, pin: string) =>
    request<{ ok: boolean; has_pin: boolean }>(`/family/members/${member_id}/verify-pin`, {
      method: 'POST',
      body: { pin },
    }),
  removeMemberPin: (member_id: string) => {
    cache.invalidate('familyMembers');
    return request<{ ok: boolean; has_pin: boolean }>(`/family/members/${member_id}/pin`, {
      method: 'DELETE',
    });
  },
  aiAssign: (title: string, description?: string, type?: string) =>
    request<{ assignee: string }>('/ai/assign', {
      method: 'POST',
      body: { title, description: description || '', type: type || 'TASK' },
    }),
  // Cards
  listCards: (status?: string) => {
    const cacheKey = `listCards:${status ?? ''}`;
    const cached = cache.get<Card[]>(cacheKey);
    if (cached) return Promise.resolve(cached);
    return request<Card[]>(`/cards${status ? `?status=${status}` : ''}`).then((data) => {
      cache.set(cacheKey, data, CACHE_TTL_MS);
      return data;
    });
  },
  createCard: (data: Partial<Card>) => {
    cache.invalidatePrefix('listCards');
    // Invalidate again after the write commits so a read that raced the
    // round-trip can't leave a pre-write snapshot cached for the TTL window.
    return request<Card>('/cards', { method: 'POST', body: data }).then((r) => {
      cache.invalidatePrefix('listCards');
      return r;
    });
  },
  updateCard: (id: string, data: Partial<Pick<Card, 'type' | 'title' | 'description' | 'assignee' | 'due_date' | 'status' | 'recurrence' | 'reminder_minutes' | 'shared'>>) => {
    cache.invalidatePrefix('listCards');
    return request<Card>(`/cards/${id}`, { method: 'PATCH', body: data }).then((r) => {
      cache.invalidatePrefix('listCards');
      return r;
    });
  },
  // Everything you've shared — exactly what your co-parent can see from you.
  /** Revoke sharing. A POST, not a queueable PATCH: a privacy revoke must
   *  never resolve optimistically while the item is still visible. */
  unshareCard: (id: string) =>
    request<Card>(`/cards/${id}/unshare`, { method: 'POST' }),
  /** What this build should compare itself against. Unauthenticated: a client
   *  too old to be updated may also be too old to sign in cleanly. */
  appVersionInfo: () =>
    request<{ min_runtime: string; store_version: string; android_store_url?: string }>('/app/version-info'),
  /** The three counts the sharing panel states, from one source. */
  sharingSummary: () =>
    request<{ shared_out: number; shared_in: number; private: number }>('/cards/sharing-summary'),
  sharedWithCoparent: (direction: 'out' | 'in' = 'out') =>
    request<Card[]>(`/cards/shared?direction=${direction}`),
  // Share a private item with the co-parent (notifies them). Returns the updated card.
  shareCard: (id: string) => {
    cache.invalidatePrefix('listCards');
    return request<Card>(`/cards/${id}/share`, { method: 'POST' }).then((r) => {
      cache.invalidatePrefix('listCards');
      return r;
    });
  },
  deleteCard: (id: string) => {
    cache.invalidatePrefix('listCards');
    return request(`/cards/${id}`, { method: 'DELETE' }).then((r) => {
      cache.invalidatePrefix('listCards');
      return r;
    });
  },
  // Vault
  listActivity: (limit = 12) =>
    request<ActivityEntry[]>(`/activity?limit=${limit}`),
  // Clear one line from the feed. A private line is deleted; a shared one is
  // hidden from your view only (the server decides which). Either way it
  // leaves your feed.
  deleteActivity: (id: string) =>
    request(`/activity/${id}`, { method: 'DELETE' }),
  search: (q: string) =>
    request<SearchResponse>(`/search?q=${encodeURIComponent(q)}`),
  listAssignedToMe: () => request<Card[]>('/cards/mine'),

  // Kid mode. The session a child holds is refused by every other endpoint
  // on the server, so these are the only doors it opens.
  listProfiles: () =>
    request<{ profiles: FamilyProfile[]; kid_mode_ready: boolean }>('/family/profiles'),
  startKidSession: (member_id: string, pin: string) =>
    request<{ session_token: string; member: FamilyMember }>('/kid/session', {
      method: 'POST', body: { member_id, pin },
    }),
  exitKidSession: (pin: string) =>
    request<{ ok: boolean }>('/kid/exit', { method: 'POST', body: { pin } }),
  // Way out when the parent PIN is forgotten: a parent's account credentials,
  // which a child does not have. Clears the forgotten PIN on success.
  exitKidForgotPin: (email: string, password: string) =>
    request<{ ok: boolean }>('/kid/exit-forgot-pin', { method: 'POST', body: { email, password } }),
  // Parent side: teen tasks awaiting a star, and approving/dismissing them.
  getTeenApprovals: () =>
    request<{ approvals: { card_id: string; title: string; teen_name: string; completed_at: string | null }[] }>('/family/teen-approvals'),
  resolveTeenApproval: (cardId: string, approve: boolean, stars = 1) =>
    request<{ ok: boolean; status: string }>(`/family/teen-approvals/${cardId}`, {
      method: 'POST', body: { approve, stars },
    }),

  // Teen mode — the only endpoints a teen account can reach.
  teenMe: () => request<{ user_id: string; name: string; email?: string; family_id: string; language: string; is_teen: true }>('/teen/me'),
  teenHome: () => request<TeenHome>('/teen/home'),
  teenFinishTask: (cardId: string) =>
    request<{ ok: boolean }>(`/teen/tasks/${cardId}/done`, { method: 'POST' }),

  // Family chat. Parents reach the adults thread + one per teen; a teen reaches
  // only their own thread (the server forces it).
  chatThreads: () => request<{ threads: ChatThreadSummary[] }>('/family/chat/threads'),
  chatGet: (thread: string) => request<{ messages: ChatMessage[] }>(`/family/chat/${encodeURIComponent(thread)}`),
  chatSend: (thread: string, text: string) =>
    request<{ ok: boolean; message: ChatMessage }>(`/family/chat/${encodeURIComponent(thread)}`, {
      method: 'POST', body: { text },
    }),
  chatRead: (thread: string) =>
    request<{ ok: boolean }>(`/family/chat/${encodeURIComponent(thread)}/read`, { method: 'POST' }),
  teenChatGet: () => request<{ messages: ChatMessage[] }>('/teen/chat'),
  teenChatSend: (text: string) =>
    request<{ ok: boolean; message: ChatMessage }>('/teen/chat', { method: 'POST', body: { text } }),
  teenChatRead: () => request<{ ok: boolean }>('/teen/chat/read', { method: 'POST' }),

  kidHome: () => request<KidHome>('/kid/home'),
  kidFinishChore: (cardId: string) =>
    request<{ ok: boolean }>(`/kid/chores/${cardId}/done`, { method: 'POST' }),
  kidRequestReward: (rewardId: string) =>
    request<{ ok: boolean; stars: number; redemption: Redemption }>(
      `/kid/rewards/${rewardId}/request`, { method: 'POST' }),
  listVault: () => {
    const cacheKey = 'listVault';
    const cached = cache.get<VaultDoc[]>(cacheKey);
    if (cached) return Promise.resolve(cached);
    return request<VaultDoc[]>('/vault').then((data) => {
      cache.set(cacheKey, data, CACHE_TTL_MS);
      return data;
    });
  },
  setVaultVisibility: (docId: string, visibility: VaultVisibility) => {
    cache.invalidate('listVault');
    return request<VaultDoc>(`/vault/${docId}/visibility`, {
      method: 'PATCH',
      body: { visibility },
    });
  },
  createVaultDoc: (data: { title: string; category: string; image_base64: string; mime_type?: string; file_name?: string; visibility?: VaultVisibility }) => {
    cache.invalidate('listVault');
    invalidateUsageCaches();
    return request<VaultDoc>('/vault', { method: 'POST', body: data });
  },
  renderVaultDoc: (docId: string) =>
    request<{ kind: 'image' | 'pdf' | 'html' | 'unsupported'; html?: string }>(`/vault/${docId}/render`),
  deleteVaultDoc: (id: string) => {
    cache.invalidate('listVault');
    invalidateUsageCaches();
    return request(`/vault/${id}`, { method: 'DELETE' });
  },
  // Rewards
  listRewards: () => {
    const cacheKey = 'listRewards';
    const cached = cache.get<Reward[]>(cacheKey);
    if (cached) return Promise.resolve(cached);
    return request<Reward[]>('/rewards').then((data) => {
      cache.set(cacheKey, data, CACHE_TTL_MS);
      return data;
    });
  },
  createReward: (data: { title: string; cost_stars: number; icon?: string; weekend?: boolean }) => {
    cache.invalidate('listRewards');
    return request<Reward>('/rewards', { method: 'POST', body: data });
  },
  updateReward: (id: string, data: { title?: string; cost_stars?: number; icon?: string; weekend?: boolean }) => {
    cache.invalidate('listRewards');
    return request<Reward>(`/rewards/${id}`, { method: 'PATCH', body: data });
  },
  deleteReward: (id: string) => {
    cache.invalidate('listRewards');
    return request(`/rewards/${id}`, { method: 'DELETE' });
  },
  redeemReward: (id: string, member_id: string) => {
    cache.invalidate('listRewards');
    cache.invalidate('familyMembers');
    return request<{ ok: boolean; member: FamilyMember; redemption?: Redemption }>(
      `/rewards/${id}/redeem`,
      { method: 'POST', body: { member_id } }
    );
  },
  // Redemptions — rewards paid for but not yet handed over
  listRedemptions: (status?: Redemption['status']) =>
    request<Redemption[]>(`/redemptions${status ? `?status=${status}` : ''}`),
  fulfilRedemption: (id: string) => {
    return request<Redemption>(`/redemptions/${id}/fulfil`, { method: 'POST' });
  },
  cancelRedemption: (id: string) => {
    cache.invalidate('familyMembers');
    // `transaction` is null when there was nobody left to credit — the server
    // declines to write a refund to the ledger that no balance received.
    return request<{
      ok: boolean;
      redemption: Redemption;
      member: FamilyMember | null;
      transaction: StarTransaction | null;
    }>(`/redemptions/${id}/cancel`, { method: 'POST' });
  },
  // Conflicts
  conflicts: (due_date: string, exclude_id?: string) =>
    request<Card[]>(
      `/cards/conflicts?due_date=${encodeURIComponent(due_date)}${
        exclude_id ? `&exclude_id=${exclude_id}` : ''
      }`
    ),
  // Vision
  visionExtract: (image_base64: string) => {
    invalidateUsageCaches();
    return request<ScanResult>('/vision/extract', { method: 'POST', body: { image_base64 } });
  },
  // Brief
  weeklyBrief: () =>
    request<{ brief: string; generated_at: string }>('/brief/weekly', { method: 'POST' }),
  // Notifications
  getNotificationSettings: () =>
    request<NotificationSettings>('/notifications/settings'),
  updateNotificationSettings: (data: Partial<NotificationSettings>) =>
    request<NotificationSettings>('/notifications/settings', {
      method: 'PUT',
      body: data,
    }),
  // app_version / runtime_version ride along so the backend can report OTA
  // adoption — which build and runtime each device is actually on — without a
  // separate telemetry call. Both optional; a client that omits them still
  // registers fine.
  registerNotificationToken: (token: string, platform?: string, appVersion?: string, runtimeVersion?: string) =>
    request<{ ok: boolean }>('/notifications/register', {
      method: 'POST',
      body: { token, platform, app_version: appVersion, runtime_version: runtimeVersion },
    }),
  testNotification: () =>
    request<{ ok: boolean; tokens: number; result: unknown }>('/notifications/test', {
      method: 'POST',
    }),
  // Subscription
  getSubscription: () => {
    const cacheKey = 'getSubscription';
    const cached = cache.get<Subscription>(cacheKey);
    if (cached) return Promise.resolve(cached);
    return request<Subscription>('/subscription').then((data) => {
      cache.set(cacheKey, data, CACHE_TTL_MS);
      return data;
    });
  },
  getEntitlements: () => {
    const cacheKey = 'getEntitlements';
    const cached = cache.get<Entitlements>(cacheKey);
    if (cached) return Promise.resolve(cached);
    return request<Entitlements>('/subscription/entitlements').then((data) => {
      cache.set(cacheKey, data, CACHE_TTL_MS);
      return data;
    });
  },
  // Server asks RevenueCat directly and corrects the stored plan — the
  // self-healing path for a missed webhook. Quiet by design.
  reconcileBilling: () => {
    invalidateUsageCaches();
    return request<Subscription>('/billing/reconcile', { method: 'POST' });
  },
  changeSubscription: (plan: Plan, billing_cycle: BillingCycle) => {
    invalidateUsageCaches();
    return request<Subscription>('/subscription/change', {
      method: 'POST',
      body: { plan, billing_cycle },
    });
  },
  // Voice transcribe
  voiceTranscribe: async (
    audio:
      | Blob
      | {
          uri: string;
          name?: string;
          type?: string;
        }
  ): Promise<{
    transcript: string;
    type: CardType;
    title: string;
    description: string;
    assignee: string;
    due_date?: string | null;
  }> => {
    const token = await tokenStore.get();
    const form = new FormData();

    if (typeof Blob !== 'undefined' && audio instanceof Blob) {
      const fileName = audio.type?.includes('ogg') ? 'voice.ogg' : 'voice.webm';

      if (typeof File !== 'undefined') {
        form.append('audio', new File([audio], fileName, { type: audio.type || 'audio/ogg' }));
      } else {
        form.append('audio', audio as any);
      }
    } else {
      const nativeFile = audio as { uri: string; name?: string; type?: string };

      form.append('audio', {
        uri: nativeFile.uri,
        name: nativeFile.name || 'voice.m4a',
        type: nativeFile.type || 'audio/aac',
      } as any);
    }

    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${BASE}/api/voice/transcribe`, {
        method: 'POST',
        headers,
        body: form,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);

    return res.json();
  },

  // Handoff Notes
  listHandoffNotes: () => request<HandoffNote[]>('/handoff-notes'),
  createHandoffNote: (data: { member_id?: string; text: string }) =>
    request<HandoffNote>('/handoff-notes', { method: 'POST', body: data }),
  deleteHandoffNote: (noteId: string) =>
    request<{ ok: boolean }>(`/handoff-notes/${noteId}`, { method: 'DELETE' }),

  // Shopping List
  listShopping: () => request<ShoppingItem[]>('/shopping'),
  addShoppingItem: (data: { name: string; category?: string }) =>
    request<ShoppingItem>('/shopping', { method: 'POST', body: data }),
  updateShoppingItem: (itemId: string, data: { checked?: boolean; name?: string; category?: string }) =>
    request<ShoppingItem>(`/shopping/${itemId}`, { method: 'PATCH', body: data }),
  deleteShoppingItem: (itemId: string) =>
    request<{ ok: boolean }>(`/shopping/${itemId}`, { method: 'DELETE' }),
  clearCheckedShopping: () =>
    request<{ deleted: number }>('/shopping', { method: 'DELETE' }),
  scanShoppingList: (imageBase64: string) =>
    request<{ items: { name: string; unsure: boolean }[] }>('/shopping/scan', {
      method: 'POST',
      body: { image_base64: imageBase64 },
    }),
  bulkAddShopping: (names: string[], categories?: (string | undefined)[]) =>
    request<{ ok: boolean; added: number }>('/shopping/bulk', {
      method: 'POST',
      body: { names, categories: categories?.map((c) => c || 'Other') || [] },
    }),
  // Wipes the whole list (it's archived to history first, so it's recoverable).
  clearAllShopping: () => request<{ deleted: number }>('/shopping/all', { method: 'DELETE' }),
  listShoppingHistory: () => request<ShoppingHistoryEntry[]>('/shopping/history'),
  reuseShoppingHistory: (id: string) =>
    request<{ ok: boolean; added: number }>(`/shopping/history/${id}/reuse`, { method: 'POST' }),
  deleteShoppingHistory: (id: string) =>
    request<{ ok: boolean }>(`/shopping/history/${id}`, { method: 'DELETE' }),
  clearShoppingHistory: () =>
    request<{ ok: boolean; deleted: number }>('/shopping/history', { method: 'DELETE' }),

  // Expenses
  listExpenses: (days = 30) => request<Expense[]>(`/expenses?days=${days}`),
  getExpenseSummary: (days = 30) => request<ExpenseSummary>(`/expenses/summary?days=${days}`),
  addExpense: (data: { description: string; amount: number; category?: string; child_member_id?: string }) =>
    request<Expense>('/expenses', { method: 'POST', body: data }),
  deleteExpense: (expenseId: string) =>
    request<{ ok: boolean }>(`/expenses/${expenseId}`, { method: 'DELETE' }),

  // Templates
  listTemplates: () => request<Template[]>('/templates'),
  createTemplate: (data: { title: string; description?: string; recurrence?: string; time_of_day?: string; assignee?: string }) =>
    request<Template>('/templates', { method: 'POST', body: data }),
  toggleTemplate: (templateId: string) =>
    request<Template>(`/templates/${templateId}`, { method: 'PATCH' }),
  deleteTemplate: (templateId: string) =>
    request<{ ok: boolean }>(`/templates/${templateId}`, { method: 'DELETE' }),
  generateFromTemplate: (templateId: string) =>
    request<Card>(`/templates/${templateId}/generate`, { method: 'POST' }),

  // Morning Routines
  listRoutines: () => request<Routine[]>('/routines'),
  createRoutine: (data: { name: string; steps: { label: string; duration_seconds: number }[]; member_id?: string }) =>
    request<Routine>('/routines', { method: 'POST', body: data }),
  deleteRoutine: (id: string) => request<{ ok: boolean }>(`/routines/${id}`, { method: 'DELETE' }),
  logRoutineCompletion: (id: string) =>
    request<{ ok: boolean; stars_awarded: number; member_id?: string }>(
      `/routines/${id}/log`, { method: 'POST' },
    ),

  // Meal Planner
  listMeals: () => request<MealPlan[]>('/meals'),
  createMeal: (data: { day: string; meal_type?: string; title: string; ingredients?: string[]; notes?: string; recipe_id?: string }) =>
    request<MealPlan>('/meals', { method: 'POST', body: data }),
  deleteMeal: (id: string) => request<{ ok: boolean }>(`/meals/${id}`, { method: 'DELETE' }),
  clearAllMeals: () => request<{ deleted: number }>('/meals/all', { method: 'DELETE' }),
  suggestMealsAI: (lang: string, variant = 0) =>
    request<{ meals: { day: string; title: string; uses: string[]; need: string[]; minutes: number }[] }>(
      `/meals/suggest-ai?lang=${encodeURIComponent(lang)}&variant=${variant}`,
      { method: 'POST' },
    ),
  generateMealRecipe: (mealId: string, lang: string, diet: Diet = '', variant = 0) =>
    request<{ recipe: AiRecipe; cached: boolean; diet: Diet }>(
      `/meals/${mealId}/recipe?lang=${encodeURIComponent(lang)}`
        + `&diet=${encodeURIComponent(diet)}&variant=${variant}`,
      { method: 'POST' },
    ),
  generateRecipe: (title: string, lang: string, diet: Diet = '', variant = 0) =>
    request<{ recipe: AiRecipe; diet: Diet }>(
      `/recipes/generate?lang=${encodeURIComponent(lang)}`,
      { method: 'POST', body: { title, diet, variant } },
    ),
  getMealDiet: () => request<{ diet: Diet }>('/meals/diet'),
  setMealDiet: (diet: Diet) =>
    request<{ diet: Diet }>('/meals/diet', { method: 'PUT', body: { diet } }),
  askChef: (title: string, question: string, lang: string) =>
    request<{ answer: string }>(`/recipes/chef?lang=${encodeURIComponent(lang)}`, {
      method: 'POST',
      body: { title, question },
    }),
  captureRecipe: (imageBase64: string) =>
    request<{
      captured: {
        title: string;
        minutes: number;
        servings: number;
        ingredients: { name: string; qty: number | null; unit: string }[];
        steps: string[];
      };
    }>('/recipes/capture', { method: 'POST', body: { image_base64: imageBase64 } }),
  addMealFromCapture: (day: string, recipe: object, lang: string) =>
    request<MealPlan>(`/meals/from-capture?lang=${encodeURIComponent(lang)}`, {
      method: 'POST',
      body: { day, recipe },
    }),
  syncMealsToShopping: () => request<{ ok: boolean; added: number }>('/meals/sync-shopping', { method: 'POST' }),
  saveMealPlan: (name: string) => request<SavedMealPlan>('/meals/save', { method: 'POST', body: { name } }),
  listSavedPlans: () => request<SavedMealPlan[]>('/meals/saved'),
  reuseSavedPlan: (id: string) => request<{ ok: boolean; added: number }>(`/meals/saved/${id}/reuse`, { method: 'POST' }),
  deleteSavedPlan: (id: string) => request<{ ok: boolean }>(`/meals/saved/${id}`, { method: 'DELETE' }),

  // Carpool
  listCarpools: () => request<Carpool[]>('/carpools'),
  createCarpool: (data: { title: string; day_of_week: string; time: string; driver_name: string; pickup_kids?: string[]; notes?: string }) =>
    request<Carpool>('/carpools', { method: 'POST', body: data }),
  deleteCarpool: (id: string) => request<{ ok: boolean }>(`/carpools/${id}`, { method: 'DELETE' }),

  // Allowance
  listAllowances: () => request<AllowanceConfig[]>('/allowances'),
  payAllowance: (member_id: string) =>
    request<{ ok: boolean; transaction: AllowanceTxn; allowance: AllowanceConfig }>(
      `/allowances/${member_id}/pay`, { method: 'POST' }),
  setAllowance: (data: { member_id: string; amount: number; frequency?: string }) =>
    request<AllowanceConfig>('/allowances', { method: 'POST', body: data }),
  deleteAllowance: (memberId: string) => request<{ ok: boolean }>(`/allowances/${memberId}`, { method: 'DELETE' }),
  allowanceTransactions: (memberId: string) => request<AllowanceTxn[]>(`/allowances/${memberId}/transactions`),
  addAllowanceTxn: (data: { member_id: string; amount: number; description: string; txn_type?: string }) =>
    request<AllowanceTxn>('/allowances/transaction', { method: 'POST', body: data }),
  allowanceBalance: (memberId: string) => request<{ member_id: string; balance: number }>(`/allowances/${memberId}/balance`),

  // Announcements
  listAnnouncements: () => request<Announcement[]>('/announcements'),
  createAnnouncement: (data: { text: string; priority?: string }) =>
    request<Announcement>('/announcements', { method: 'POST', body: data }),
  deleteAnnouncement: (id: string) => request<{ ok: boolean }>(`/announcements/${id}`, { method: 'DELETE' }),

  // Document Expiry
  vaultExpiryAlerts: () => request<ExpiryAlert[]>('/vault/expiry-alerts'),
  setVaultExpiry: (docId: string, expiryDate: string) =>
    request<{ ok: boolean }>(`/vault/${docId}/expiry?expiry_date=${encodeURIComponent(expiryDate)}`, { method: 'PATCH' }),

  // Weekly Report
  weeklyReport: () => request<WeeklyReport>('/report/weekly'),
  reportLite: () => request<{ tasks_done: number; stars_earned: number }>('/report/lite'),

  // Support
  submitSupportRequest: (data: { subject: string; message: string }) =>
    request<{ ok: boolean; ticket_id: string }>('/support/contact', { method: 'POST', body: data }),

  // Chore Wheel
  listChores: () => request<Chore[]>('/chores'),
  createChore: (data: { title: string; frequency?: string; assigned_members?: string[]; rotate?: boolean }) =>
    request<Chore>('/chores', { method: 'POST', body: data }),
  rotateChore: (id: string) => request<Chore>(`/chores/${id}/rotate`, { method: 'POST' }),
  // "Done": pays the current assignee, then hands the chore on.
  completeChore: (id: string) =>
    request<{ ok: boolean; chore: Chore; stars_awarded: number; member_id?: string }>(
      `/chores/${id}/complete`, { method: 'POST' },
    ),
  deleteChore: (id: string) => request<{ ok: boolean }>(`/chores/${id}`, { method: 'DELETE' }),
};
