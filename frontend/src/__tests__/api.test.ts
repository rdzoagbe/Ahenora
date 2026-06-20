/**
 * Unit tests for the API module (src/api.ts).
 *
 * We mock `fetch` globally and stub out `tokenStore` so that the `request`
 * helper can run without real network or storage access.
 */

// Set the required env var before importing the module.
process.env.EXPO_PUBLIC_BACKEND_URL = 'https://test-backend.example.com';

// ---------- mocks for native modules the api module imports ----------
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

import { api, tokenStore } from '../api';

// ---------- helpers ----------

function mockFetch(status: number, body: unknown, ok?: boolean) {
  const response = {
    ok: ok ?? (status >= 200 && status < 300),
    status,
    text: jest.fn().mockResolvedValue(
      typeof body === 'string' ? body : JSON.stringify(body)
    ),
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;

  (global.fetch as jest.Mock).mockResolvedValue(response);
  return response;
}

// ---------- setup ----------

beforeEach(() => {
  global.fetch = jest.fn();
  // Default: no stored token
  jest.spyOn(tokenStore, 'get').mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------- exchangeSession ----------

describe('api.exchangeSession', () => {
  it('sends a POST with session_id in the body', async () => {
    const payload = {
      user: { user_id: 'u1', email: 'a@b.com', name: 'A', family_id: 'f1', language: 'en' },
      session_token: 'tok123',
    };
    mockFetch(200, payload);

    const result = await api.exchangeSession('sess-abc');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://test-backend.example.com/api/auth/session');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ session_id: 'sess-abc' });
    expect(result).toEqual(payload);
  });

  it('includes invite_token when provided', async () => {
    mockFetch(200, { user: {}, session_token: 'tok' });

    await api.exchangeSession('sess-abc', 'inv-xyz');

    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      session_id: 'sess-abc',
      invite_token: 'inv-xyz',
    });
  });
});

// ---------- error handling ----------

describe('API error handling', () => {
  it('throws on non-2xx responses', async () => {
    mockFetch(400, 'Bad Request', false);

    await expect(api.me()).rejects.toThrow('400: Bad Request');
  });

  it('attaches status property to error', async () => {
    mockFetch(403, 'Forbidden', false);

    try {
      await api.me();
      fail('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(403);
    }
  });

  it('handles 402 plan-limit errors', async () => {
    const body = {
      detail: {
        error: 'plan_limit',
        feature: 'ai_scans',
        message: 'AI scan limit reached',
      },
    };
    mockFetch(402, JSON.stringify(body), false);

    try {
      await api.me();
      fail('should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(402);
      expect(err.planLimit).toBeDefined();
    }
  });
});

// ---------- listCards with auth header ----------

describe('api.listCards', () => {
  it('sends Authorization header when token is available', async () => {
    jest.spyOn(tokenStore, 'get').mockResolvedValue('my-session-token');
    mockFetch(200, []);

    await api.listCards();

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://test-backend.example.com/api/cards');
    expect(opts.headers['Authorization']).toBe('Bearer my-session-token');
  });

  it('omits Authorization header when no token', async () => {
    jest.spyOn(tokenStore, 'get').mockResolvedValue(null);
    mockFetch(200, []);

    await api.listCards();

    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(opts.headers['Authorization']).toBeUndefined();
  });

  it('appends status query parameter', async () => {
    mockFetch(200, []);

    await api.listCards('OPEN');

    const [url] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://test-backend.example.com/api/cards?status=OPEN');
  });
});
