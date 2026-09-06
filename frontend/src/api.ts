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
      // ...except the ones under /auth/ where a 401 is not "wrong password" but
      // "this session is gone". /auth/me is the app's own session probe: a 401
      // there is the single clearest statement the server can make that the
      // token is dead. Sweeping it under the credential rule left the app
      // half-signed-in — the cached name and email still on screen while every
      // request failed — and the only way out was finding Log out by hand.
      //
      // Rare until today: sessions mostly ended by logging out. Now that
      // /auth/logout-everywhere exists, a session revoked from another device
      // is a normal thing to happen while the app is open.
      const SESSION_IS_GONE_PATHS = ['/auth/me'];
      const isCredentialCheck =
        CREDENTIAL_PATHS.some((p) => path.startsWith(p)) &&
        !SESSION_IS_GONE_PATHS.some((p) => path.startsWith(p));
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
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/**
 * A proposed event that has not been accepted yet. Produced by a calendar
 * sync today, and by a scanned document or a forwarded email later — the
 * review list does not care which, which is the point of the shape.
 */
export interface EventCandidate {
  candidate_id: string;
  type: CardType;
  title: string;
  description: string;
  due_date?: string | null;
  location: string;
  recurrence: Recurrence;
  source_kind: string;
  created_at: string;
}

export interface Card {
  card_id: string;
  /**
   * Only ever set on the reply to completing a RECURRING card: when the next
   * occurrence was spawned, and for when. The app says so — a chore that
   * reappears with a new date is otherwise indistinguishable from a tick that
   * did not save.
   */
  next_occurrence?: string;
  /**
   * Only on the reply to completing a TASK assigned to a child: who just
   * finished it. Nothing has been awarded — this used to pay them 5 stars
   * silently, which is how a parent came to find points on her daughter's page
   * that she had never given. The app offers; the parent decides.
   */
  child_finished?: { member_id: string; name: string };
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
  /** Where it happens. Always a string from the server, "" when unset. */
  location?: string;
  created_at: string;
  completed_at?: string | null;
  completed_by_name?: string | null;
  google_event_id?: string | null;
  google_ical_uid?: string | null;
  external_source?: string | null;
  shared?: boolean;
  created_by_user_id?: string | null;
  /** Who created/assigned the card — so an assigned task can say "by Roland". */
  created_by_name?: string | null;
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
  /** The tidied shop name — "Carrefour", not "CARREFOUR CITY 14EME". */
  merchant?: string | null;
  /** The date on the receipt (YYYY-MM-DD), which is not always the day it was added. */
  spent_on: string;
  created_at: string;
  /** Split 50/50 with the co-parent — counts toward the settle-up balance. */
  split?: boolean;
}

/** Shared-expense balance between the two parents, from the caller's view.
 *  `balance` > 0 means the other parent owes you; < 0 means you owe them. */
export interface SettlementInfo {
  enabled: boolean;
  balance: number;
  other_name?: string;
  other_user_id?: string;
  shared_count?: number;
}

export interface MerchantRow {
  merchant: string;
  total: number;
  visits: number;
  average: number;
}

export interface ExpenseMonth {
  month: string;            // YYYY-MM
  total: number;
  /** How many receipts this total is built from. A total without its coverage misleads. */
  count: number;
  /** False for the month still running — which is never compared to a finished one. */
  complete: boolean;
  by_merchant: MerchantRow[];
  /** Who paid, for co-parents settling up — the job this screen has always done. */
  by_person: Record<string, number>;
}

export interface ExpenseOverview {
  category: string | null;
  months: ExpenseMonth[];
  current: ExpenseMonth;
  days_into_month: number;
  /** Null until three finished months exist to average. */
  comparison: {
    month: string;
    total: number;
    usual: number;
    difference: number;
    basis_months: string[];
  } | null;
  range: { months: number; total: number; count: number; by_merchant: MerchantRow[] };
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

export interface FrequentItem {
  name: string;
  count: number;
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
  /** The whole-household room. */
  is_household?: boolean;
  /** A teen's single conversation with their parents. */
  is_parents?: boolean;
  /** parent | co-parent | teen | helper | child — what the other side is. */
  role?: string;
  /** Which roster row this conversation belongs to, so the app matches a person
   *  to their thread instead of rebuilding thread ids and hoping they agree. */
  member_id?: string;
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
  /** A child's age, 1-17. Null when nobody has set one — children added before
   *  this existed have no age, and a guess would be worse than none. */
  age?: number | null;
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
  /** What the entry is: 'starting' | 'earn' | 'adjust' | 'spend' | 'refund'.
   *  Only 'earn' and 'adjust' move the weekly meter — a redeemed reward comes
   *  out of the saved bank and leaves the week alone. Null on entries written
   *  before the field existed. */
  kind?: string | null;
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
  /** Households with a second ADULT. Member rows include children, so a count
   *  of those answered a different question — and disagreed with retention. */
  two_plus_adult_households: number;
  sharing_households: number;
  active_1d: number;
  active_7d: number;
}

/**
 * Retention, counted in ADULTS rather than members: a child profile is a
 * family_members row but not an account, so a household is shared here only
 * when a second person actually holds one. The funnel counts it the same way
 * now — it used to count member rows, which made a lone parent with two kids
 * look shared and made the two halves of one screen disagree.
 */
export interface RetentionSummary {
  generated_at: string | null;
  window_weeks: number;
  accounts: { total: number; active_1d: number; active_7d: number; active_30d: number };
  households: {
    total: number;
    solo_adult: number;
    two_plus_adults: number;
    two_plus_adults_active_7d: number;
  };
  /** Null, not zero, when a population is empty — nothing to divide. */
  weekly_return_rate: { solo_adult_pct: number | null; two_plus_adults_pct: number | null };
  cohorts: { week: string; signups: number; still_active: number; retained_pct: number | null }[];
}

/**
 * Why invitations do not become co-parents. The outcome split is the point:
 * "never signed up" is a delivery/wording problem, "signed up but not joined"
 * is a broken join — opposite fixes, and the funnel's single acceptance
 * percentage cannot tell them apart.
 */
export interface InviteBreakdown {
  generated_at: string | null;
  window_days: number;
  status: {
    sent: number; accepted: number; pending: number; expired: number;
    oldest_pending_days: number | null;
  };
  outcome: {
    in_the_household: number;
    signed_up_but_not_joined: number;
    never_signed_up: number;
    joined_while_invite_still_pending: number;
  };
}

/** /api/health/push — admin only. Answers the question a silent morning
 *  raises: was there nothing to say, or is the sender broken? */
export interface PushHealth {
  scheduler: {
    state: 'alive' | 'stalled' | 'never_ran' | 'disabled' | string;
    enabled: boolean;
    interval_seconds: number;
    booted_at: string | null;
    last_tick_at: string | null;
    seconds_since_tick: number | null;
    ticks: number;
    last_error: string | null;
  };
  reach: {
    people_reachable: number;
    active_phone_tokens: number;
    active_web_subscriptions: number;
  };
  jobs: {
    key: string;
    at: string;
    grace_minutes: number;
    served_today: number;
    waiting_now: number;
  }[];
  you: {
    reachable: boolean;
    timezone: string | null;
    local_time: string | null;
    reminders_enabled: boolean;
    claims: Record<string, string | null>;
  };
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
  // Renamed server-side: it counts households that OPENED THE APP, which is
  // not the same as households that once registered a device. The screen kept
  // reading the old name and rendered a blank cell — a dashboard silently
  // showing nothing where a number belongs is worse than one showing zero.
  active_families: number;
  families_with_a_device: number;
  active_paying_families: number;
  pct_active_paying: number;
  active_free_premium_families: number;
}

/**
 * One thing a payment provider told us. The unmatched rows are the point: a
 * webhook we answered 200 to but could not place is a purchase that reached
 * nobody, and the provider will never send it again.
 */
export interface BillingEvent {
  source: 'revenuecat' | 'stripe' | 'sweep' | string;
  event_type: string;
  matched: boolean;
  family_id: string | null;
  app_user_id: string | null;
  product_id: string | null;
  plan: string | null;
  detail: string | null;
  received_at: string | null;
}

export interface BillingEventLog {
  revenuecat_configured: boolean;
  stripe_configured: boolean;
  sweep_enabled: boolean;
  /** False means nothing has EVER arrived — the webhook is not pointed at us. */
  ever_received: boolean;
  last_event_at: string | null;
  total: number;
  unmatched: number;
  by_source: Record<string, number>;
  events: BillingEvent[];
}

/** One line read off a till receipt, before anyone has confirmed it. */
export interface ScannedReceiptItem {
  name: string;
  /** null when the amount could not be read — then there is no unit price. */
  qty: number | null;
  unit: 'kg' | 'g' | 'l' | 'ml' | 'piece' | string;
  line_total: number;
  /** Only ever set when qty is real. A price with no amount cannot be compared. */
  unit_price: number | null;
  unsure: boolean;
}

export interface ScannedReceipt {
  shop: string;
  /** Empty when the date could not be read — the app asks rather than guessing. */
  date: string;
  total: number;
  lines_total: number;
  /** False means the lines disagree with the printed total: show both, fix neither. */
  reconciles: boolean;
  items: ScannedReceiptItem[];
}

/** What one shop charges this household for one thing, per unit. */
export interface PriceShop {
  shop: string;
  unit_price: number;
  /** Separate visits behind the figure. Below the server's minimum it is not reported at all. */
  visits: number;
  last_seen: string | null;
}

export interface PriceItem {
  name: string;
  name_key: string;
  unit: string;
  shops: PriceShop[];
  cheapest: string;
  /** null when only one shop qualifies — known, but nothing to compare against. */
  saving: { per_unit: number; against: string; percent: number } | null;
}

export interface PriceCompare {
  window_days: number;
  min_observations: number;
  items: PriceItem[];
  /** Only the rows that can actually advise. */
  comparable: PriceItem[];
}

export interface Subscriber {
  family_id: string;
  plan: string;
  paying: boolean;
  billing_source: 'stripe' | 'google_play' | null;
  billing_cycle: string | null;
  owner_name: string;
  owner_email: string;
  member_accounts: number;
  /** Has a live push token — reachable by notification. NOT "uses the app". */
  has_active_device: boolean;
  /**
   * When anyone in the household last used the app. Null only when nothing was
   * ever recorded — which is not the same as never having opened it, since
   * registering is opening it.
   */
  last_active: string | null;
  created_at: string | null;
  subscribed_at: string | null;
}

export interface SubscriberList {
  total: number;
  paying: number;
  subscribers: Subscriber[];
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
  chat_messages: boolean;
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
      | 'member_joined' | 'week_planned' | 'list_cleared' | 'doc_shared'
      | 'pot_pledge' | 'santa_opened';
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
  /**
   * The server's judgement that this belongs on the calendar: an event type
   * AND a date. Decided there rather than here so the rule is written once and
   * tested — a date alone is a deadline, and an event with no date is not
   * something anyone can be reminded of.
   */
  is_event?: boolean;
  /** When the DOCUMENT stops being valid — a passport, a policy, a permit. */
  expires_on?: string | null;
  /** Where it happens, when the document says. */
  location?: string | null;
  recipe?: CapturedRecipe;
}

export type Plan = 'village' | 'executive' | 'household' | 'family_office';
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
    gift_pot: boolean;
    secret_santa: boolean;
  };
  price_monthly: number;
  price_yearly: number;
  admin_unlocked?: boolean;
  // Alternating custody (garde alternée). Absent on older servers; off by
  // default. our_weeks is the ISO-week parity the children are in this home.
  custody?: CustodyConfig;
}

export interface CustodyConfig {
  enabled: boolean;
  our_weeks: 'even' | 'odd';
  away_label: string;
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
    gift_pot: boolean;
    secret_santa: boolean;
  };
}

export type GiftMethod = 'cash' | 'transfer' | 'gift' | 'other';

export interface GiftContribution {
  contrib_id: string;
  /** null for an outsider who joined via the share link (no account). */
  user_id: string | null;
  name: string;
  amount: number;
  method: GiftMethod | null;
  paid: boolean;
  source: 'member' | 'link';
  at: string | null;
}

export interface GiftPot {
  pot_id: string;
  family_id: string;
  card_id: string | null;
  for_member_id: string | null;
  title: string;
  occasion: string;
  per_head: number;
  target_total: number | null;
  status: 'open' | 'closed';
  note: string | null;
  contributions: GiftContribution[];
  total_pledged: number;
  paid_total: number;
  contributor_count: number;
  /** What THIS viewer has already pledged (null if they haven't). */
  your_amount: number | null;
  /** The share token, once the organiser has turned on the link (else null). */
  share_token: string | null;
  shared: boolean;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string | null;
  updated_at: string | null;
}

/** The minimal, safe view an invited outsider sees from the share link — no
 *  household data, no per-person amounts. Mirrors the backend allow-list. */
export interface PublicPot {
  title: string;
  occasion: string;
  per_head: number;
  target_total: number | null;
  total_pledged: number;
  contributor_count: number;
  status: 'open' | 'closed';
  note: string | null;
  organiser_name: string;
  contributors: { name: string; paid: boolean }[];
}

// ── Secret Santa ────────────────────────────────────────────────────────────

export type SantaStatus = 'draft' | 'matched' | 'sent' | 'closed';

export interface SantaParticipant {
  pid: string;
  name: string;
  source: 'member' | 'link';
  member_id: string | null;
  is_member: boolean;
  /** Optional phone OR email for an outsider, so the organiser can send their
   *  link from their own device. */
  contact: string | null;
  opened: boolean;
  /** The private one-match link token — outsiders only, and only once sent. */
  token: string | null;
}

export interface SantaDraw {
  draw_id: string;
  family_id: string;
  title: string;
  budget: number | null;
  draw_by: string | null;
  status: SantaStatus;
  participants: SantaParticipant[];
  /** "Keep apart" pairs, as pairs of names (for display). */
  exclusions: [string, string][];
  participant_count: number;
  opened_count: number;
  viewer_is_participant: boolean;
  viewer_can_reveal: boolean;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string | null;
  updated_at: string | null;
  sent_at: string | null;
}

/** The single match one person sees — nothing else about the draw. */
export interface SantaMatch {
  draw_title: string;
  budget: number | null;
  draw_by: string | null;
  organiser_name: string;
  giver_name: string;
  giftee_name: string;
}

export interface SantaParticipantInput {
  name: string;
  member_id?: string;
  contact?: string;
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

// Force the next getSubscription() to hit the network. Used when polling for a
// plan change that just happened elsewhere (a Stripe webhook after checkout),
// where the cached copy would otherwise mask the update.
export function bustSubscriptionCache() {
  invalidateUsageCaches();
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

/**
 * Fire-and-forget duration, in milliseconds. Same contract as logEvent: never
 * throws, never retries, and an unknown name is quietly dropped by the server
 * rather than surfaced here — an app build ahead of the server must not show a
 * person an error about telemetry.
 */
export function logTiming(name: string, ms: number): void {
  // Guard here as well as on the server: a NaN from a clock that misbehaved
  // would be sent as null and counted as zero, which reads as "instant".
  if (!Number.isFinite(ms) || ms < 0) return;
  const rounded = Math.round(ms);
  tokenStore.get().then((token) => {
    if (!token) return;
    fetch(`${BASE}/api/metrics/timing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name, ms: rounded }),
    }).catch(() => undefined);
  }).catch(() => undefined);
}

/**
 * The device's IANA zone, e.g. "Europe/Paris". Sent with the push token because
 * the server needs it to fire a 07:30 digest at 07:30 where the person is —
 * nothing else in the app ever had to know. Empty if the platform will not say,
 * and the server falls back rather than guessing wrong.
 */
function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export const api = {
  // Auth
  // Sign in with Apple — required by the App Store in any app that also offers
  // Google sign-in. Apple hands over the name only on the FIRST authorisation,
  // so it rides along when present and is never sent blank afterwards.
  exchangeAppleSession: (identity_token: string, full_name?: string, invite_token?: string) =>
    request<{ user: User; session_token: string }>('/auth/apple', {
      method: 'POST',
      body: {
        identity_token,
        ...(full_name ? { full_name } : {}),
        ...(invite_token ? { invite_token } : {}),
        language: detectDeviceLang(),
      },
    }),
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
  invite: (email: string, relationship?: string, opts?: { is_teen?: boolean; age?: number; is_helper?: boolean; member_id?: string }) => {
    invalidateUsageCaches();
    const body: Record<string, unknown> = { email };
    if (relationship) body.relationship = relationship;
    if (opts?.is_teen) {
      body.is_teen = true;
      if (opts.age != null) body.age = opts.age;
      // Names the child, so the server can check the age claimed here against
      // the age already on record instead of trusting the form.
      if (opts.member_id) body.member_id = opts.member_id;
    }
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
  getMetricsRetention: (weeks = 8) =>
    request<RetentionSummary>(`/metrics/retention?weeks=${weeks}`),
  /** People this household invited who never made it in — feeds the re-send nudge. */
  strandedInvites: () =>
    request<{ email: string; relationship: string | null; reason: 'signed_up' | 'expired'; invited_at: string | null }[]>(
      '/family/invites/stranded'),
  getInviteBreakdown: (days = 30) =>
    request<InviteBreakdown>(`/metrics/invites?days=${days}`),
  // AI reliability probe (admin). probe=0 is free (reports configured state);
  // probe=1 does one tiny real generation. The Metrics screen uses probe=0.
  getAiHealth: () =>
    request<AiHealth>('/health/ai'),
  getPushHealth: () =>
    request<PushHealth>('/health/push'),
  getVersionAdoption: () =>
    request<VersionAdoption>('/admin/version-adoption'),
  getPlanAdoption: () =>
    request<PlanAdoption>('/admin/plan-adoption'),
  getSubscribers: () =>
    request<SubscriberList>('/admin/subscribers'),
  getBillingEvents: (limit = 40) =>
    request<BillingEventLog>(`/admin/billing-events?limit=${limit}`),
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
  // `review` stages the events instead of writing them straight into the
  // calendar; the app then shows what was found and the person keeps or drops
  // each one. Passed explicitly rather than defaulted server-side so an older
  // build, which cannot show the review list, keeps its old behaviour instead
  // of importing into a queue nobody can open.
  importGoogleCalendar: (access_token: string, days = 30, review = false) =>
    request<CalendarImportResult>('/calendar/import', {
      method: 'POST',
      body: { access_token, days, review },
    }),
  importMicrosoftCalendar: (access_token: string, days = 30, review = false) =>
    request<CalendarImportResult>('/calendar/import-microsoft', {
      method: 'POST',
      body: { access_token, days, review },
    }),
  // A scanned document the model read as an appointment. Staged, not created:
  // it joins the same review list a calendar sync fills, so the keep-or-share
  // decision is made in one place.
  stageScannedEvent: (body: {
    title: string;
    description?: string;
    due_date: string;
    type?: string;
    location?: string | null;
    reminder_minutes?: number;
  }) =>
    request<{ ok: boolean; staged: boolean; candidate_id?: string; reason?: string }>(
      '/calendar/candidates/from-scan', { method: 'POST', body }),
  listEventCandidates: () =>
    request<{ candidates: EventCandidate[]; count: number }>('/calendar/candidates'),
  decideEventCandidates: (body: {
    keep: string[];
    drop: string[];
    shared: boolean;
    assignee?: string | null;
  }) =>
    request<{ ok: boolean; created: number; dropped: number; remaining: number }>(
      '/calendar/candidates/decide', { method: 'POST', body }),
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
  updateFamilyMember: (
    member_id: string,
    // weekly_target: how many stars this child's week is measured against.
    // Send 0 to go back to the household default.
    data: { name?: string; avatar?: string; age?: number; weekly_target?: number },
  ) => {
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
  /** Completing a TASK assigned to a child returns `child_finished`. It does
   *  NOT award anything — the app offers the stars and the parent decides. */
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

  // ---- The Gift Pot (pool for a birthday/occasion; a Family feature) -------
  listGiftPots: () => request<GiftPot[]>('/gift-pots'),
  getGiftPot: (id: string) => request<GiftPot>(`/gift-pots/${id}`),
  createGiftPot: (data: {
    card_id?: string; for_member_id?: string; title?: string;
    occasion?: string; per_head?: number; target_total?: number; note?: string;
  }) => {
    cache.invalidatePrefix('listGiftPots');
    return request<GiftPot>('/gift-pots', { method: 'POST', body: data }).then((r) => {
      cache.invalidatePrefix('listGiftPots');
      return r;
    });
  },
  // Edit a pot's details (organiser only). Only sent fields change; pass
  // clear_target to wipe the target rather than raise it.
  editGiftPot: (id: string, data: {
    title?: string; per_head?: number; target_total?: number; note?: string; clear_target?: boolean;
  }) => {
    cache.invalidatePrefix('listGiftPots');
    return request<GiftPot>(`/gift-pots/${id}`, { method: 'PATCH', body: data }).then((r) => {
      cache.invalidatePrefix('listGiftPots');
      return r;
    });
  },
  chipInGiftPot: (id: string, amount: number, method?: GiftMethod) => {
    cache.invalidatePrefix('listGiftPots');
    return request<GiftPot>(`/gift-pots/${id}/chip-in`, { method: 'POST', body: { amount, ...(method ? { method } : {}) } }).then((r) => {
      cache.invalidatePrefix('listGiftPots');
      return r;
    });
  },
  // Turn the share link on/off (invite the outer circle). Returns the pot with
  // its share_token.
  shareGiftPot: (id: string) => {
    cache.invalidatePrefix('listGiftPots');
    return request<GiftPot>(`/gift-pots/${id}/share`, { method: 'POST' });
  },
  unshareGiftPot: (id: string) => {
    cache.invalidatePrefix('listGiftPots');
    return request<GiftPot>(`/gift-pots/${id}/unshare`, { method: 'POST' });
  },
  // Organiser-only money controls.
  setContributionPaid: (potId: string, contribId: string, paid: boolean) => {
    cache.invalidatePrefix('listGiftPots');
    return request<GiftPot>(`/gift-pots/${potId}/contributions/${contribId}/paid`, { method: 'POST', body: { paid } });
  },
  removeContribution: (potId: string, contribId: string) => {
    cache.invalidatePrefix('listGiftPots');
    return request<GiftPot>(`/gift-pots/${potId}/contributions/${contribId}`, { method: 'DELETE' });
  },
  // The PUBLIC share link — no auth. Anyone with the token can view and join.
  getPublicPot: (token: string) => request<PublicPot>(`/pot/${encodeURIComponent(token)}`),
  joinPublicPot: (token: string, data: { name: string; amount: number; method?: GiftMethod }) =>
    request<PublicPot>(`/pot/${encodeURIComponent(token)}/join`, { method: 'POST', body: data }),
  closeGiftPot: (id: string) => {
    cache.invalidatePrefix('listGiftPots');
    return request<GiftPot>(`/gift-pots/${id}/close`, { method: 'POST' }).then((r) => {
      cache.invalidatePrefix('listGiftPots');
      return r;
    });
  },
  deleteGiftPot: (id: string) => {
    cache.invalidatePrefix('listGiftPots');
    return request<{ ok: boolean }>(`/gift-pots/${id}`, { method: 'DELETE' });
  },

  // ── Secret Santa ──────────────────────────────────────────────────────────
  listSantaDraws: () => request<SantaDraw[]>('/santa'),
  getSantaDraw: (id: string) => request<SantaDraw>(`/santa/${id}`),
  createSantaDraw: (data: {
    title?: string; budget?: number | null; draw_by?: string | null;
    participants: SantaParticipantInput[]; exclusions?: [string, string][];
  }) => {
    cache.invalidatePrefix('listSantaDraws');
    return request<SantaDraw>('/santa', { method: 'POST', body: data });
  },
  editSantaDraw: (id: string, data: {
    title?: string; budget?: number | null; draw_by?: string | null;
    participants?: SantaParticipantInput[]; exclusions?: [string, string][]; clear_budget?: boolean;
  }) => {
    cache.invalidatePrefix('listSantaDraws');
    return request<SantaDraw>(`/santa/${id}`, { method: 'PATCH', body: data });
  },
  shuffleSantaDraw: (id: string) => {
    cache.invalidatePrefix('listSantaDraws');
    return request<SantaDraw>(`/santa/${id}/shuffle`, { method: 'POST' });
  },
  sendSantaDraw: (id: string) => {
    cache.invalidatePrefix('listSantaDraws');
    return request<SantaDraw>(`/santa/${id}/send`, { method: 'POST' });
  },
  deleteSantaDraw: (id: string) => {
    cache.invalidatePrefix('listSantaDraws');
    return request<{ ok: boolean }>(`/santa/${id}`, { method: 'DELETE' });
  },
  /** The calling member's own match (once sent). */
  getMySantaMatch: (id: string) => request<SantaMatch>(`/santa/${id}/my-match`),
  /** The PUBLIC one-match reveal for an outsider's link token — no auth. */
  getPublicSantaMatch: (token: string) =>
    request<SantaMatch>(`/santa/match/${encodeURIComponent(token)}`),
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
    request<{ approvals: {
      card_id: string; title: string;
      /** The name older builds read. `who` is the same value, under a name that
       *  is true of a young child as well — kid-mode chores queue here too. */
      teen_name: string; who?: string;
      completed_at: string | null;
    }[] }>('/family/teen-approvals'),
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
  signOutEverywhere: () => request<{ ok: boolean; ended: number }>('/auth/sign-out-everywhere', { method: 'POST' }),
  chatRead: (thread: string) =>
    request<{ ok: boolean }>(`/family/chat/${encodeURIComponent(thread)}/read`, { method: 'POST' }),
  teenChatGet: () => request<{ messages: ChatMessage[] }>('/teen/chat'),
  teenChatSend: (text: string) =>
    request<{ ok: boolean; message: ChatMessage }>('/teen/chat', { method: 'POST', body: { text } }),
  teenChatRead: () => request<{ ok: boolean }>('/teen/chat/read', { method: 'POST' }),

  kidHome: () => request<KidHome>('/kid/home'),
  /** Notes a parent has written to this child, read in kid mode. */
  kidNotes: () => request<{ messages: ChatMessage[] }>('/kid/notes'),
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
  createVaultDoc: (data: { title: string; category: string; image_base64: string; mime_type?: string; file_name?: string; visibility?: VaultVisibility; expiry_date?: string | null }) => {
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
      body: { token, platform, app_version: appVersion, runtime_version: runtimeVersion,
              timezone: deviceTimeZone() },
    }),
  // Teens live on the /teen/* allowlist; the parent register route 403s them,
  // so they register here or they never receive a single push.
  registerTeenNotificationToken: (token: string, platform?: string, appVersion?: string, runtimeVersion?: string) =>
    request<{ ok: boolean }>('/teen/notifications/register', {
      method: 'POST',
      body: { token, platform, app_version: appVersion, runtime_version: runtimeVersion,
              timezone: deviceTimeZone() },
    }),
  // Deactivate this device's token on logout so a shared/resold phone stops
  // receiving the last household's pushes.
  unregisterNotificationToken: (token: string) =>
    request<{ ok: boolean }>('/notifications/unregister', {
      method: 'POST',
      body: { token },
    }),
  // Web Push (browser notifications when the tab is closed).
  getWebPushConfig: () =>
    request<{ enabled: boolean; vapid_public_key: string }>('/notifications/web-config'),
  webPushSubscribe: (subscription: unknown) =>
    request<{ ok: boolean }>('/notifications/web-subscribe', {
      method: 'POST',
      // The zone matters here too: browser subscribers get the same daily
      // reminders, at the same local hours.
      body: { subscription, timezone: deviceTimeZone() },
    }),
  webPushUnsubscribe: (endpoint?: string) =>
    request<{ ok: boolean }>('/notifications/web-unsubscribe', {
      method: 'POST',
      body: { endpoint },
    }),
  testNotification: () =>
    request<{
      ok: boolean;
      /** Expo push tokens — phones. Zero on the web app, which is normal. */
      tokens: number;
      /** Subscribed browsers. The rail the first version of this forgot. */
      browsers: number;
      devices: number;
      reminders_enabled: boolean;
      result: unknown;
    }>('/notifications/test', {
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
  // Card checkout — the way in for web/iPhone, where store billing does not
  // exist. `enabled` is false until the server has its Stripe keys.
  getStripeConfig: () =>
    request<{
      enabled: boolean; currency: string; price_monthly: number; price_yearly: number;
      tiers?: Record<string, { plan: string; price_monthly: number; price_yearly: number; buyable: boolean }>;
    }>('/billing/stripe/config'),
  createStripeCheckout: (tier: 'family' | 'household', cycle: BillingCycle) =>
    request<{ url: string; session_id?: string }>('/billing/stripe/checkout', {
      method: 'POST',
      body: { tier, cycle },
    }),
  changeSubscription: (plan: Plan, billing_cycle: BillingCycle) => {
    invalidateUsageCaches();
    return request<Subscription>('/subscription/change', {
      method: 'POST',
      body: { plan, billing_cycle },
    });
  },
  setCustody: (config: CustodyConfig) => {
    // The subscription payload carries custody, so drop its cache to force the
    // fresh copy the server returns to take effect on the next read.
    cache.invalidate('getSubscription');
    return request<Subscription>('/family/custody', {
      method: 'PUT',
      body: config,
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
  // The household's regulars — items bought on several past trips and not on the
  // list right now. Powers the "Your regulars" quick-add row.
  listFrequentShopping: () => request<{ items: FrequentItem[] }>('/shopping/frequent'),
  reuseShoppingHistory: (id: string) =>
    request<{ ok: boolean; added: number }>(`/shopping/history/${id}/reuse`, { method: 'POST' }),
  deleteShoppingHistory: (id: string) =>
    request<{ ok: boolean }>(`/shopping/history/${id}`, { method: 'DELETE' }),
  clearShoppingHistory: () =>
    request<{ ok: boolean; deleted: number }>('/shopping/history', { method: 'DELETE' }),

  // Expenses
  scanReceipt: (imageBase64: string) =>
    request<ScannedReceipt>('/expenses/scan-receipt', {
      method: 'POST',
      body: { image_base64: imageBase64 },
    }),
  getPriceCompare: () => request<PriceCompare>('/expenses/price-compare'),
  listExpenses: (days = 30) => request<Expense[]>(`/expenses?days=${days}`),
  getExpenseSummary: (days = 30) => request<ExpenseSummary>(`/expenses/summary?days=${days}`),
  getExpenseOverview: (months = 6, category?: string) =>
    request<ExpenseOverview>(
      `/expenses/overview?months=${months}` + (category ? `&category=${encodeURIComponent(category)}` : '')),
  addExpense: (data: {
    description?: string; amount: number; category?: string; child_member_id?: string;
    merchant?: string; spent_on?: string; split?: boolean;
    /** Receipt lines, when a receipt was read. A typed expense has none. */
    items?: { name: string; qty: number | null; unit: string; line_total: number }[];
  }) =>
    request<Expense>('/expenses', { method: 'POST', body: data }),
  deleteExpense: (expenseId: string) =>
    request<{ ok: boolean }>(`/expenses/${expenseId}`, { method: 'DELETE' }),
  // Shared-expense settle-up between the two parents.
  getSettlement: () => request<SettlementInfo>('/expenses/settlement'),
  settleUp: () => request<SettlementInfo>('/expenses/settlement/settle', { method: 'POST' }),

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
  createRoutine: (data: {
    name: string; steps: { label: string; duration_seconds: number }[]; member_id?: string;
    /** Stars for finishing the whole routine. The server defaults it to 2. */
    star_reward?: number;
  }) =>
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
  createChore: (data: {
    title: string; frequency?: string; assigned_members?: string[]; rotate?: boolean;
    /** Stars the assignee earns for finishing it. Per chore, so the bins can be
     *  worth more than feeding the cat. The server defaults it to 3. */
    star_reward?: number;
  }) =>
    request<Chore>('/chores', { method: 'POST', body: data }),
  rotateChore: (id: string) => request<Chore>(`/chores/${id}/rotate`, { method: 'POST' }),
  // "Done": pays the current assignee, then hands the chore on.
  completeChore: (id: string) =>
    request<{ ok: boolean; chore: Chore; stars_awarded: number; member_id?: string }>(
      `/chores/${id}/complete`, { method: 'POST' },
    ),
  deleteChore: (id: string) => request<{ ok: boolean }>(`/chores/${id}`, { method: 'DELETE' }),
};
