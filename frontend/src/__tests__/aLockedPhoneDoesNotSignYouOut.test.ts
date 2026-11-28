/**
 * A locked phone does not sign you out.
 *
 * Roland, 2026-11-28: on the iPhone, people are logged out of their account
 * often. An iPhone will not hand over a keychain item while it is locked, and
 * the app can be running then (woken by a notification, or opened from one
 * while the phone is still unlocking). The read fails. That failure was
 * reported as "no token"; the next request went out without one; the server
 * said 401; and a 401 deletes the saved sign-in. One locked second, signed
 * out for good. This pins:
 *
 *  - a keychain that will not answer is an error, never "nobody signed in";
 *  - it is asked more than once before giving up;
 *  - once read, the token is remembered for the life of the app, so a phone
 *    locking later cannot make the app forget;
 *  - a request that could not read the token is not sent, and nothing is
 *    deleted;
 *  - a 401 to a request that carried no token deletes nothing;
 *  - a real 401, to a request that carried the token, still signs out.
 */
process.env.EXPO_PUBLIC_BACKEND_URL = 'https://test-backend.example.com';

const mockSecure = {
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
};
jest.mock('expo-secure-store', () => mockSecure);
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import fs from 'fs';
import path from 'path';
import { api, forgetTokenInMemory, isTokenUnreadable, tokenStore } from '../api';

const LOCKED = new Error('User interaction is not allowed.');
const respond = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: jest.fn().mockResolvedValue(JSON.stringify(body)),
  json: jest.fn().mockResolvedValue(body),
}) as unknown as Response;

beforeEach(() => {
  forgetTokenInMemory();
  mockSecure.getItemAsync.mockReset();
  mockSecure.deleteItemAsync.mockClear();
  global.fetch = jest.fn();
});

describe('reading the saved sign-in', () => {
  it('says the keychain did not answer, never that nobody is signed in', async () => {
    mockSecure.getItemAsync.mockRejectedValue(LOCKED);
    const outcome = await tokenStore.get().then((t) => ({ token: t }), (e) => ({ error: e }));
    expect('error' in outcome && isTokenUnreadable(outcome.error)).toBe(true);
  });

  it('asks again before giving up: a phone unlocks in a moment', async () => {
    mockSecure.getItemAsync.mockRejectedValueOnce(LOCKED).mockResolvedValueOnce('tok_abc');
    await expect(tokenStore.get()).resolves.toBe('tok_abc');
    expect(mockSecure.getItemAsync).toHaveBeenCalledTimes(2);
  });

  it('remembers it once read, so a phone locking later changes nothing', async () => {
    mockSecure.getItemAsync.mockResolvedValueOnce('tok_abc').mockRejectedValue(LOCKED);
    await expect(tokenStore.get()).resolves.toBe('tok_abc');
    await expect(tokenStore.get()).resolves.toBe('tok_abc');
    expect(mockSecure.getItemAsync).toHaveBeenCalledTimes(1);
  });

  it('knows a sign-out from a locked phone: none saved is still none', async () => {
    mockSecure.getItemAsync.mockResolvedValue(null);
    await expect(tokenStore.get()).resolves.toBeNull();
    await tokenStore.set('tok_new');
    await expect(tokenStore.get()).resolves.toBe('tok_new');
    await tokenStore.clear();
    await expect(tokenStore.get()).resolves.toBeNull();
  });
});

describe('a request made while the phone is locked', () => {
  it('is not sent without the token, and deletes nothing', async () => {
    mockSecure.getItemAsync.mockRejectedValue(LOCKED);
    const outcome = await api.me().then(() => 'sent', (e) => e);
    expect(isTokenUnreadable(outcome)).toBe(true);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockSecure.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('a 401 to a request that carried no token deletes nothing', async () => {
    mockSecure.getItemAsync.mockResolvedValue(null);
    (global.fetch as jest.Mock).mockResolvedValue(respond(401, { detail: 'Not authenticated' }));
    await api.listCards().catch(() => undefined);
    expect(mockSecure.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('a real 401, to a request that carried the token, still signs out', async () => {
    mockSecure.getItemAsync.mockImplementation(
      async (key: string) => (key === 'coo_parent_token' ? null : 'tok_dead'));
    (global.fetch as jest.Mock).mockResolvedValue(respond(401, { detail: 'Session expired' }));
    await api.listCards().catch(() => undefined);
    expect(mockSecure.deleteItemAsync).toHaveBeenCalledWith('coo_session_token');
    await expect(tokenStore.get()).resolves.toBeNull();
  });
});

describe('a phone handed to a child', () => {
  // The second cause the review found, and the likelier one. In kid mode the
  // saved token is the child's. Coming back to the app asks for the chat
  // count; that door refuses a child's token with a 401; and a 401 signed
  // the whole household out. The parent took the phone back to a sign-in page.
  const parentWaits = () => mockSecure.getItemAsync.mockImplementation(
    async (key: string) => (key === 'coo_parent_token' ? 'tok_parent' : 'tok_child'));

  it('a parent-only door refusing the child does not sign the household out', async () => {
    parentWaits();
    (global.fetch as jest.Mock).mockResolvedValue(respond(401, { detail: 'Invalid or expired session' }));
    await api.chatThreads().catch(() => undefined);
    expect(mockSecure.deleteItemAsync).not.toHaveBeenCalled();
    await expect(tokenStore.get()).resolves.toBe('tok_child');
  });

  it('with nobody in kid mode, the same refusal still signs out', async () => {
    mockSecure.getItemAsync.mockImplementation(
      async (key: string) => (key === 'coo_parent_token' ? null : 'tok_dead'));
    (global.fetch as jest.Mock).mockResolvedValue(respond(401, { detail: 'Invalid or expired session' }));
    await api.chatThreads().catch(() => undefined);
    expect(mockSecure.deleteItemAsync).toHaveBeenCalledWith('coo_session_token');
  });

  it('restarted in a child’s hands, the app opens the child’s screen as the parent’s household', () => {
    const store = fs.readFileSync(path.join(__dirname, '..', 'store.tsx'), 'utf8');
    expect(store).toContain('const parentToken = await kidMode.storedParentToken();');
    expect(store).toContain('const parent = await userForToken(parentToken);');
    expect(store).toContain('setKidResume(true);');
    // The parent's token is asked about, never swapped in: a child must not
    // get the parent's app by closing and reopening it.
    const resume = store.slice(store.indexOf('const parentToken = await kidMode.storedParentToken();'), store.indexOf('let u: User;'));
    expect(resume).not.toContain('kidMode.leave');
    expect(resume).not.toContain('tokenStore.set');
    const index = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'index.tsx'), 'utf8');
    expect(index).toContain("if (kidResume) { router.replace('/kid'); return; }");
    // The flag is cleared by the child's screen once it is up. Cleared where
    // it redirects, the same effect ran again and sent them to the parent's
    // Home (caught in a real browser, 2026-11-28).
    expect(index).not.toContain('clearKidResume');
    const kid = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'kid.tsx'), 'utf8');
    expect(kid).toContain('useEffect(() => { clearKidResume(); }, [clearKidResume]);');
    const tabs = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', '_layout.tsx'), 'utf8');
    expect(tabs).toContain('if (!loading && user && kidResume) {');
  });

  it('handing the phone back loads the parent’s account afresh', () => {
    const kid = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'kid.tsx'), 'utf8');
    expect((kid.match(/backToParent\(\);/g) || []).length).toBe(3);
  });
});

describe('why a session ended', () => {
  it('is written down when the app signs somebody out, and nothing personal with it', async () => {
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    AsyncStorage.setItem.mockClear();
    mockSecure.getItemAsync.mockImplementation(
      async (key: string) => (key === 'coo_parent_token' ? null : 'tok_dead'));
    (global.fetch as jest.Mock).mockResolvedValue(respond(401, { detail: 'Session expired' }));
    await api.listCards().catch(() => undefined);
    const note = AsyncStorage.setItem.mock.calls.find((c: string[]) => c[0] === 'coo_last_signout');
    expect(note).toBeTruthy();
    const body = JSON.parse(note[1]);
    expect(body.reason).toBe('session_refused');
    expect(body.path).toBe('/cards');
    expect(JSON.stringify(body)).not.toContain('tok_dead');
  });

  it('is sent with the next sign-in', () => {
    const store = fs.readFileSync(path.join(__dirname, '..', 'store.tsx'), 'utf8');
    expect(store).toContain('reportLastSignOut().catch(() => undefined);');
  });
});

describe('a browser', () => {
  it('re-reads its storage every time: another tab may have signed in again', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'api.ts'), 'utf8');
    expect(src).toContain("if (Platform.OS !== 'web' && memoryToken !== undefined) return memoryToken;");
  });
});

describe('starting the app', () => {
  const store = fs.readFileSync(path.join(__dirname, '..', 'store.tsx'), 'utf8');

  it('waits for the keychain instead of showing the sign-in page', () => {
    expect(store).toContain('if (isTokenUnreadable(error)) {');
    expect(store).toContain('if (!waiting) setLoading(false);');
    // And clears nothing on that path: the only clear is behind a real 401.
    const unreadable = store.slice(store.indexOf('if (isTokenUnreadable(error)) {'), store.indexOf('// Only sign out on a real 401'));
    expect(unreadable).not.toContain('tokenStore.clear');
    expect(unreadable).not.toContain('setUser(null)');
  });

  it('asks again when the app is opened, which is when the phone is unlocked', () => {
    expect(store).toContain("if (state === 'active' && tokenWaits.current > 0) {");
  });
});
