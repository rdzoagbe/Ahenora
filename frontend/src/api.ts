import * as SecureStore from 'expo-secure-store';

const RAW_API_BASE_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  'https://household-coo-production.up.railway.app';

const API_BASE_URL = RAW_API_BASE_URL.startsWith('http')
  ? RAW_API_BASE_URL
  : `https://${RAW_API_BASE_URL}`;

const SESSION_TOKEN_KEY = 'household_coo_session_token';

export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  family_id: string;
  language: string;
};

export type Subscription = {
  plan: string;
  billing_cycle: string;
  grandfathered?: boolean;
  updated_at?: string | null;
  ai_scans_used?: number;
  ai_scans_period_start?: string | null;
  vault_bytes_used?: number;
  members_count?: number;
  limits?: Record<string, any>;
  price_monthly?: number;
  price_yearly?: number;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  token?: string | null;
};

export const tokenStore = {
  async get(): Promise<string | null> {
    return SecureStore.getItemAsync(SESSION_TOKEN_KEY);
  },

  async set(token: string): Promise<void> {
    if (!token) {
      await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
      return;
    }

    await SecureStore.setItemAsync(SESSION_TOKEN_KEY, token);
  },

  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY);
  },
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const base = API_BASE_URL.replace(/\/$/, '');
  const url = `${base}${path}`;

  console.log('API_BASE_URL:', API_BASE_URL);
  console.log('API request:', url);

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const storedToken = options.token ?? (await tokenStore.get());

  if (storedToken) {
    headers.Authorization = `Bearer ${storedToken}`;
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error: any) {
    console.error('API network failure:', {
      url,
      message: error?.message,
      name: error?.name,
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
    console.log('API error response:', response.status, data);
    throw new Error(
      `${response.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`
    );
  }

  return data as T;
}

export const api = {
  health: async () => {
    return request<{
      status: string;
      message: string;
      api_configured?: boolean;
      db_configured?: boolean;
    }>('/');
  },

  exchangeSession: async (googleIdToken: string) => {
    return request<{
      user: User;
      session_token: string;
    }>('/api/auth/session', {
      method: 'POST',
      body: {
        session_id: googleIdToken,
      },
    });
  },

  me: async () => {
    return request<User>('/api/auth/me');
  },

  logout: async () => {
    return request<{ ok: boolean }>('/api/auth/logout', {
      method: 'POST',
    });
  },

  setLanguage: async (language: string) => {
    return request<User>('/api/auth/language', {
      method: 'PATCH',
      body: {
        language,
      },
    });
  },

  getSubscription: async () => {
    return request<Subscription>('/api/subscription');
  },
};