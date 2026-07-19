import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { cache } from './cache';

const CACHE_TTL_MS = 30_000;

const PROD_BACKEND = "https://household-coo-production.up.railway.app";
const RAW_BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL;
// Guard against a stale/wrong env value baked in at bundle time (CI secrets or
// EAS environment variables carrying the retired "-backend-" Railway subdomain,
// which 404s "Application not found" and breaks every sign-in). Any value that
// doesn't resolve to the real backend falls back to the known-good URL.
export const BASE =
  typeof RAW_BACKEND === "string" &&
  RAW_BACKEND.trim().startsWith("https://") &&
  !RAW_BACKEND.includes("household-coo-backend-production")
    ? RAW_BACKEND.trim().replace(/\/+$/, "")
    : PROD_BACKEND;
if (BASE === PROD_BACKEND && RAW_BACKEND !== PROD_BACKEND) {
  console.warn("EXPO_PUBLIC_BACKEND_URL missing or invalid — using production fallback");
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

// The store registers a handler so an expired session (401) mid-session can
// clear auth state and route back to the landing screen, instead of leaving
// screens silently blank until the app is restarted.
let unauthorizedHandler: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

async function request<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown } = {}
): Promise<T> {
  const token = await tokenStore.get();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
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
        throw err;
      }
      // Network error or GET timeout — retry if we have attempts left.
      lastError = err;
      if (attempt < RETRY_MAX) continue;
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    // Retry on 5xx server errors
    if (res.status >= 500 && res.status < 600 && attempt < RETRY_MAX) {
      lastError = Object.assign(new Error(`${res.status}`), { status: res.status });
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      // A 401 on a non-auth endpoint means the session expired or was revoked.
      // Clear the token and let the app return to the landing screen. Auth
      // endpoints (login/register/session) use 401 for bad credentials, so
      // they must not trigger a global sign-out.
      if (res.status === 401 && !path.startsWith('/auth/')) {
        await tokenStore.clear().catch(() => undefined);
        cache.clear();
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
    return res.json() as Promise<T>;
  }

  // Should not be reached, but satisfies TypeScript
  throw lastError;
}

export type CardType = 'SIGN_SLIP' | 'RSVP' | 'TASK';
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
  google_event_id?: string | null;
  google_ical_uid?: string | null;
  external_source?: string | null;
  shared?: boolean;
  created_by_user_id?: string | null;
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
  created_at: string;
}

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
}

export interface FamilyMember {
  member_id: string;
  family_id: string;
  name: string;
  role: string;
  avatar?: string | null;
  stars: number;
  has_pin?: boolean;
  has_account?: boolean;
}

export interface Reward {
  reward_id: string;
  family_id: string;
  title: string;
  cost_stars: number;
  icon?: string | null;
  created_at: string;
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
}

export interface MetricRow {
  date: string;
  name: string;
  count: number;
}

export interface FamilyInvite {
  invite_id: string;
  family_id: string;
  email?: string | null;
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
  skipped: number;
  events_seen: number;
  contacts_found: number;
  contacts: CalendarContact[];
  days: number;
}

export interface VaultDoc {
  doc_id: string;
  family_id: string;
  title: string;
  category: string;
  image_base64: string;
  mime_type?: string;
  file_name?: string | null;
  created_at: string;
}

export type Plan = 'village' | 'executive' | 'family_office';
export type BillingCycle = 'monthly' | 'yearly';

export interface Subscription {
  plan: Plan;
  billing_cycle: BillingCycle;
  grandfathered: boolean;
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
      body: invite_token ? { session_id, invite_token } : { session_id },
    }),
  registerWithEmail: (data: { name: string; email: string; password: string; invite_token?: string }) =>
    request<{ user: User; session_token: string }>('/auth/register', { method: 'POST', body: data }),
  loginWithEmail: (data: { email: string; password: string }) =>
    request<{ user: User; session_token: string }>('/auth/login', { method: 'POST', body: data }),
  me: () => request<User>('/auth/me'),
  logout: () => {
    cache.clear();
    return request('/auth/logout', { method: 'POST' });
  },
  setLanguage: (language: string) =>
    request('/auth/language', { method: 'PATCH', body: { language } }),
  completeOnboarding: () =>
    request<User>('/auth/complete-onboarding', { method: 'POST' }),
  invite: (email: string) => {
    invalidateUsageCaches();
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
      body: { email },
    });
  },
  createInviteLink: () => {
    invalidateUsageCaches();
    return request<{ ok: boolean; invite: FamilyInvite; invite_url: string }>('/family/invite/link', {
      method: 'POST',
    });
  },
  getMetricsSummary: (days = 14) =>
    request<{ days: number; rows: MetricRow[] }>(`/metrics/summary?days=${days}`),
  listInvites: () => request<FamilyInvite[]>('/family/invites'),
  deleteInvite: (inviteId: string) => {
    invalidateUsageCaches();
    return request<{ ok: boolean }>(`/family/invites/${inviteId}`, { method: 'DELETE' });
  },
  getInvite: (token: string) =>
    request<{
      invite_id: string;
      status: string;
      inviter_name: string;
      email?: string;
      expires_at?: string | null;
    }>(`/family/invite/${token}`),
  importGoogleCalendar: (access_token: string, days = 30) =>
    request<CalendarImportResult>('/calendar/import', {
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
  adjustMemberStars: (member_id: string, data: { delta: number; reason?: string }) => {
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
  sharedWithCoparent: () => request<Card[]>('/cards/shared'),
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
  listVault: () => {
    const cacheKey = 'listVault';
    const cached = cache.get<VaultDoc[]>(cacheKey);
    if (cached) return Promise.resolve(cached);
    return request<VaultDoc[]>('/vault').then((data) => {
      cache.set(cacheKey, data, CACHE_TTL_MS);
      return data;
    });
  },
  createVaultDoc: (data: { title: string; category: string; image_base64: string; mime_type?: string; file_name?: string }) => {
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
  createReward: (data: { title: string; cost_stars: number; icon?: string }) => {
    cache.invalidate('listRewards');
    return request<Reward>('/rewards', { method: 'POST', body: data });
  },
  updateReward: (id: string, data: { title?: string; cost_stars?: number; icon?: string }) => {
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
    return request<{ ok: boolean; member: FamilyMember }>(`/rewards/${id}/redeem`, {
      method: 'POST',
      body: { member_id },
    });
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
    return request<{
      type: CardType;
      title: string;
      description: string;
      assignee: string;
      due_date?: string | null;
      vault_category?: string;
      save_to_vault?: boolean;
    }>('/vision/extract', { method: 'POST', body: { image_base64 } });
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
  registerNotificationToken: (token: string, platform?: string) =>
    request<{ ok: boolean }>('/notifications/register', {
      method: 'POST',
      body: { token, platform },
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
  bulkAddShopping: (names: string[]) =>
    request<{ ok: boolean; added: number }>('/shopping/bulk', { method: 'POST', body: { names } }),
  // Wipes the whole list (it's archived to history first, so it's recoverable).
  clearAllShopping: () => request<{ deleted: number }>('/shopping/all', { method: 'DELETE' }),
  listShoppingHistory: () => request<ShoppingHistoryEntry[]>('/shopping/history'),
  reuseShoppingHistory: (id: string) =>
    request<{ ok: boolean; added: number }>(`/shopping/history/${id}/reuse`, { method: 'POST' }),
  deleteShoppingHistory: (id: string) =>
    request<{ ok: boolean }>(`/shopping/history/${id}`, { method: 'DELETE' }),

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
  logRoutineCompletion: (id: string) => request<{ ok: boolean }>(`/routines/${id}/log`, { method: 'POST' }),

  // Meal Planner
  listMeals: () => request<MealPlan[]>('/meals'),
  createMeal: (data: { day: string; meal_type?: string; title: string; ingredients?: string[]; notes?: string }) =>
    request<MealPlan>('/meals', { method: 'POST', body: data }),
  deleteMeal: (id: string) => request<{ ok: boolean }>(`/meals/${id}`, { method: 'DELETE' }),
  clearAllMeals: () => request<{ deleted: number }>('/meals/all', { method: 'DELETE' }),
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
  deleteChore: (id: string) => request<{ ok: boolean }>(`/chores/${id}`, { method: 'DELETE' }),
};
