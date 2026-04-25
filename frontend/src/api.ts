import AsyncStorage from '@react-native-async-storage/async-storage';

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
if (!BASE) {
  throw new Error("EXPO_PUBLIC_BACKEND_URL is not set");
}

const TOKEN_KEY = 'coo_session_token';

export const tokenStore = {
  async get(): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  async set(token: string) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  },
  async clear() {
    await AsyncStorage.removeItem(TOKEN_KEY);
  },
};

async function request<T = any>(
  path: string,
  opts: { method?: string; body?: any } = {}
): Promise<T> {
  const token = await tokenStore.get();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method || 'GET',
    headers,
    credentials: 'include',
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    // Attempt to parse 402 plan-limit payloads so UI can react
    if (res.status === 402) {
      try {
        const parsed = JSON.parse(text);
        const detail = parsed.detail || parsed;
        const err: any = new Error(detail?.message || 'Plan limit reached');
        err.status = 402;
        err.planLimit = detail;
        throw err;
      } catch (e: any) {
        if (e?.planLimit) throw e;
      }
    }
    const err: any = new Error(`${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return {} as T;
  return res.json();
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
  source: 'AI' | 'MANUAL' | 'VOICE' | 'CAMERA';
  image_base64?: string | null;
  recurrence: Recurrence;
  reminder_minutes: number;
  created_at: string;
  completed_at?: string | null;
}

export interface User {
  user_id: string;
  email: string;
  name: string;
  picture?: string;
  family_id: string;
  language: string;
}

export interface FamilyMember {
  member_id: string;
  family_id: string;
  name: string;
  role: string;
  avatar?: string | null;
  stars: number;
  has_pin?: boolean;
}

export interface Reward {
  reward_id: string;
  family_id: string;
  title: string;
  cost_stars: number;
  icon?: string | null;
  created_at: string;
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

export interface VaultDoc {
  doc_id: string;
  family_id: string;
  title: string;
  category: string;
  image_base64: string;
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
  };
  price_monthly: number;
  price_yearly: number;
}

export interface PlanLimitError {
  error: 'plan_limit';
  feature: string;
  current_plan?: Plan;
  limit?: number;
  used?: number;
  message: string;
}

export const api = {
  // Auth
  exchangeSession: (session_id: string, invite_token?: string) =>
    request<{ user: User; session_token: string }>('/auth/session', {
      method: 'POST',
      body: invite_token ? { session_id, invite_token } : { session_id },
    }),
  me: () => request<User>('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  setLanguage: (language: string) =>
    request('/auth/language', { method: 'PATCH', body: { language } }),
  invite: (email: string) =>
    request<{
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
    }),
  listInvites: () => request<FamilyInvite[]>('/family/invites'),
  getInvite: (token: string) =>
    request<{
      invite_id: string;
      status: string;
      inviter_name: string;
      email?: string;
      expires_at?: string | null;
    }>(`/family/invite/${token}`),
  // Family
  familyMembers: () => request<FamilyMember[]>('/family/members'),
  setMemberPin: (member_id: string, pin: string) =>
    request<{ ok: boolean; has_pin: boolean }>(`/family/members/${member_id}/pin`, {
      method: 'PUT',
      body: { pin },
    }),
  verifyMemberPin: (member_id: string, pin: string) =>
    request<{ ok: boolean; has_pin: boolean }>(`/family/members/${member_id}/verify-pin`, {
      method: 'POST',
      body: { pin },
    }),
  aiAssign: (title: string, description?: string, type?: string) =>
    request<{ assignee: string }>('/ai/assign', {
      method: 'POST',
      body: { title, description: description || '', type: type || 'TASK' },
    }),
  // Cards
  listCards: (status?: string) =>
    request<Card[]>(`/cards${status ? `?status=${status}` : ''}`),
  createCard: (data: Partial<Card>) =>
    request<Card>('/cards', { method: 'POST', body: data }),
  updateCard: (id: string, data: { status?: CardStatus }) =>
    request<Card>(`/cards/${id}`, { method: 'PATCH', body: data }),
  deleteCard: (id: string) => request(`/cards/${id}`, { method: 'DELETE' }),
  // Vault
  listVault: () => request<VaultDoc[]>('/vault'),
  createVaultDoc: (data: { title: string; category: string; image_base64: string }) =>
    request<VaultDoc>('/vault', { method: 'POST', body: data }),
  deleteVaultDoc: (id: string) => request(`/vault/${id}`, { method: 'DELETE' }),
  // Rewards
  listRewards: () => request<Reward[]>('/rewards'),
  createReward: (data: { title: string; cost_stars: number; icon?: string }) =>
    request<Reward>('/rewards', { method: 'POST', body: data }),
  deleteReward: (id: string) => request(`/rewards/${id}`, { method: 'DELETE' }),
  redeemReward: (id: string, member_id: string) =>
    request<{ ok: boolean; member: FamilyMember }>(`/rewards/${id}/redeem`, {
      method: 'POST',
      body: { member_id },
    }),
  // Conflicts
  conflicts: (due_date: string, exclude_id?: string) =>
    request<Card[]>(
      `/cards/conflicts?due_date=${encodeURIComponent(due_date)}${
        exclude_id ? `&exclude_id=${exclude_id}` : ''
      }`
    ),
  // Vision
  visionExtract: (image_base64: string) =>
    request<{
      type: CardType;
      title: string;
      description: string;
      assignee: string;
      due_date?: string | null;
      vault_category?: string;
      save_to_vault?: boolean;
    }>('/vision/extract', { method: 'POST', body: { image_base64 } }),
  // Brief
  weeklyBrief: () =>
    request<{ brief: string; generated_at: string }>('/brief/weekly', { method: 'POST' }),
  // Subscription
  getSubscription: () => request<Subscription>('/subscription'),
  changeSubscription: (plan: Plan, billing_cycle: BillingCycle) =>
    request<Subscription>('/subscription/change', {
      method: 'POST',
      body: { plan, billing_cycle },
    }),
  // Voice transcribe
  voiceTranscribe: async (blob: Blob): Promise<{
    transcript: string;
    type: CardType;
    title: string;
    description: string;
    assignee: string;
  }> => {
    const token = await tokenStore.get();
    const form = new FormData();
    const file = new File([blob], 'voice.webm', { type: blob.type || 'audio/webm' });
    form.append('audio', file);
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${BASE}/api/voice/transcribe`, {
      method: 'POST',
      headers,
      credentials: 'include',
      body: form,
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  },
};
