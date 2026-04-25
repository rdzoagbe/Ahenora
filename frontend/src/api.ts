const RAW_API_BASE_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ||
  'https://household-coo-production.up.railway.app';

const API_BASE_URL = RAW_API_BASE_URL.startsWith('http')
  ? RAW_API_BASE_URL
  : `https://${RAW_API_BASE_URL}`;

type RequestOptions = {
  method?: string;
  token?: string;
  body?: any;
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

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
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
      user: {
        user_id: string;
        email: string;
        name: string;
        picture?: string;
        family_id: string;
        language: string;
      };
      session_token: string;
    }>('/api/auth/session', {
      method: 'POST',
      body: {
        session_id: googleIdToken,
      },
    });
  },

  me: async (token: string) => {
    return request('/api/auth/me', {
      method: 'GET',
      token,
    });
  },

  logout: async (token: string) => {
    return request('/api/auth/logout', {
      method: 'POST',
      token,
    });
  },
};