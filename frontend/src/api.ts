import AsyncStorage from '@react-native-async-storage/async-storage';
import { logger } from './logger';

const RAW_API_BASE_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  'https://household-coo-production.up.railway.app';

const API_BASE_URL = RAW_API_BASE_URL.startsWith('http')
  ? RAW_API_BASE_URL.replace(/\/$/, '')
  : `https://${RAW_API_BASE_URL.replace(/\/$/, '')}`;

const TOKEN_KEY = 'coo_session_token';

let memoryToken: string | null | undefined = undefined;

export const tokenStore = {
  async get(): Promise<string | null> {
    if (memoryToken !== undefined) {
      return memoryToken;
    }

    try {
      const token = await AsyncStorage.getItem(TOKEN_KEY);
      memoryToken = token && token.length > 0 ? token : null;
      return memoryToken;
    } catch {
      memoryToken = null;
      return null;
    }
  },

  async set(token: string): Promise<void> {
    memoryToken = token;

    if (!token) {
      await AsyncStorage.removeItem(TOKEN_KEY);
      memoryToken = null;
      return;
    }

    await AsyncStorage.setItem(TOKEN_KEY, token);
  },

  async clear(): Promise<void> {
    memoryToken = null;
    await AsyncStorage.removeItem(TOKEN_KEY);
  },
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
  auth?: boolean;
  isFormData?: boolean;
};

function buildUrl(path: string): string {
  if (path === '/') return `${API_BASE_URL}/`;

  if (path.startsWith('/api/')) {
    return `${API_BASE_URL}${path}`;
  }

  if (path.startsWith('/')) {
    return `${API_BASE_URL}/api${path}`;
  }

  return `${API_BASE_URL}/api/${path}`;
}

async function request<T = any>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path);

  const token =
    options.auth === false
      ? null
      : options.token !== undefined
        ? options.token
        : await tokenStore.get();

  const headers: Record<string, string> = {
    Accept: 'application/json',
  };

  if (!options.isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body
        ? options.isFormData
          ? (options.body as BodyInit)
          : JSON.stringify(options.body)
        : undefined,
    });
  } catch (error: any) {
    logger.error('API network failure:', {
      url,
      name: error?.name,
      message: error?.message,
    });
    throw new Error(`Network request failed: ${url}`);
  }

  const text = await response.text();

  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    logger.warn('API error response:', response.status, data);

    if (response.status === 402) {
      const detail = data?.detail || data;
      const err: any = new Error(detail?.message || 'Plan limit reached');
      err.status = 402;
      err.planLimit = detail;
      throw err;
    }

    throw new Error(
      `${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`
    );
  }

  return data as T;
}

export type CardType = 'SIGN_SLIP' | 'RSVP' | 'TASK';
export type CardStatus = 'OPEN' | 'DONE';
export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly';

export interface User {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
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

export interface Card {
  card_id: string;
  family_id: string;
  type: CardType;
  title: string;
  description?: string | null;
  assignee?: string | null;
  due_date?: string | null;
  status: CardStatus;
  source: 'AI' | 'MANUAL' | 'VOICE' | 'CAMERA';
  image_base64?: string | null;
  recurrence: Recurrence;
  reminder_minutes: number;
  created_at: string;
  completed_at?: string | null;
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
  updated_at: string | null;
  ai_scans_used: number;
  ai_scans_period_start: string | null;
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
  health: () =>
    request<{
      status: string;
      message: string;
      api_configured?: boolean;
      db_configured?: boolean;
    }>('/', { auth: false }),

  exchangeSession: (googleIdToken: string, invite_token?: string) =>
    request<{ user: User; session_token: string }>('/auth/session', {
      method: 'POST',
      auth: false,
      body: invite_token
        ? { session_id: googleIdToken, invite_token }
        : { session_id: googleIdToken },
    }),

  me: () => request<User>('/auth/me'),

  logout: () =>
    request<{ ok: boolean }>('/auth/logout', {
      method: 'POST',
    }),

  setLanguage: (language: string) =>
    request<User>('/auth/language', {
      method: 'PATCH',
      body: { language },
    }),

  familyMembers: () => request<FamilyMember[]>('/family/members'),

  setMemberPin: (member_id: string, pin: string) =>
    request<{ ok: boolean; has_pin: boolean }>(`/family/members/${member_id}/pin`, {
      method: 'PUT',
      body: { pin },
    }),

  verifyMemberPin: (member_id: string, pin: string) =>
    request<{ ok: boolean; has_pin: boolean }>(
      `/family/members/${member_id}/verify-pin`,
      {
        method: 'POST',
        body: { pin },
      }
    ),

  addMemberStars: (member_id: string, amount: number) =>
    request<FamilyMember>(`/family/members/${member_id}/stars`, {
      method: 'PATCH',
      body: { amount },
    }),

  invite: (email: string) =>
    request<{ ok?: boolean; sent?: boolean; message?: string; error?: string }>(
      '/family/invite',
      {
        method: 'POST',
        body: { email },
      }
    ),

  aiAssign: (title: string, description = '', type = 'TASK') =>
    request<{ assignee: string }>('/ai/assign', {
      method: 'POST',
      body: { title, description, type },
    }),

  listCards: (status?: string) =>
    request<Card[]>(`/cards${status ? `?status=${encodeURIComponent(status)}` : ''}`),

  createCard: (data: {
    type?: CardType;
    title: string;
    description?: string | null;
    assignee?: string | null;
    due_date?: string | null;
    source?: 'AI' | 'MANUAL' | 'VOICE' | 'CAMERA';
    image_base64?: string | null;
    recurrence?: Recurrence;
    reminder_minutes?: number;
  }) =>
    request<Card>('/cards', {
      method: 'POST',
      body: data,
    }),

  updateCard: (id: string, data: { status?: CardStatus }) =>
    request<Card>(`/cards/${id}`, {
      method: 'PATCH',
      body: data,
    }),

  deleteCard: (id: string) =>
    request<{ ok: boolean }>(`/cards/${id}`, {
      method: 'DELETE',
    }),

  conflicts: (due_date: string, exclude_id?: string) =>
    request<Card[]>(
      `/cards/conflicts?due_date=${encodeURIComponent(due_date)}${
        exclude_id ? `&exclude_id=${encodeURIComponent(exclude_id)}` : ''
      }`
    ),

  listVault: () => request<VaultDoc[]>('/vault'),

  createVaultDoc: (data: {
    title: string;
    category: string;
    image_base64: string;
  }) =>
    request<VaultDoc>('/vault', {
      method: 'POST',
      body: data,
    }),

  deleteVaultDoc: (id: string) =>
    request<{ ok: boolean }>(`/vault/${id}`, {
      method: 'DELETE',
    }),

  listRewards: () => request<Reward[]>('/rewards'),

  createReward: (data: { title: string; cost_stars: number; icon?: string }) =>
    request<Reward>('/rewards', {
      method: 'POST',
      body: data,
    }),

  updateReward: (
    id: string,
    data: { title?: string; cost_stars?: number; icon?: string }
  ) =>
    request<Reward>(`/rewards/${id}`, {
      method: 'PATCH',
      body: data,
    }),

  deleteReward: (id: string) =>
    request<{ ok: boolean }>(`/rewards/${id}`, {
      method: 'DELETE',
    }),

  redeemReward: (id: string, member_id: string) =>
    request<{ ok: boolean; member: FamilyMember }>(`/rewards/${id}/redeem`, {
      method: 'POST',
      body: { member_id },
    }),

  getSubscription: () => request<Subscription>('/subscription'),

  changeSubscription: (plan: Plan, billing_cycle: BillingCycle) =>
    request<Subscription>('/subscription/change', {
      method: 'POST',
      body: { plan, billing_cycle },
    }),

  weeklyBrief: () =>
    request<{ brief: string; generated_at: string }>('/brief/weekly', {
      method: 'POST',
    }),

  visionExtract: (image_base64: string) =>
    request<{
      type: CardType;
      title: string;
      description: string;
      assignee: string;
      due_date?: string | null;
    }>('/vision/extract', {
      method: 'POST',
      body: { image_base64 },
    }),

  voiceTranscribe: async (blob: Blob): Promise<{
    transcript: string;
    type: CardType;
    title: string;
    description: string;
    assignee: string;
  }> => {
    const form = new FormData();
    form.append('audio', blob as any);

    return request('/voice/transcribe', {
      method: 'POST',
      body: form,
      isFormData: true,
    });
  },
};







