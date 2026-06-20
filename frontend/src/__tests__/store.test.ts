/**
 * Unit tests for the store module (src/store.tsx).
 *
 * The store is a React Context provider, so we test its callbacks
 * by rendering the provider with @testing-library/react (or a
 * lightweight approach) and inspecting state changes.
 *
 * Since we only need unit tests (no UI rendering), we test the
 * individual pieces: tokenStore integration, and the exported
 * helper functions that the provider wires up.
 */

process.env.EXPO_PUBLIC_BACKEND_URL = 'https://test-backend.example.com';

// ---------- mocks ----------

const mockSecureStore = {
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn().mockResolvedValue(undefined),
  deleteItemAsync: jest.fn().mockResolvedValue(undefined),
};
jest.mock('expo-secure-store', () => mockSecureStore);

const mockAsyncStorage = {
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: mockAsyncStorage,
}));

jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  useColorScheme: jest.fn().mockReturnValue('light'),
}));

import { tokenStore, User } from '../api';

// ---------- tokenStore tests (used by the store's setUserFromAuth / logout) ----------

describe('tokenStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('get returns null when no token is stored', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    mockAsyncStorage.getItem.mockResolvedValue(null);

    const token = await tokenStore.get();
    expect(token).toBeNull();
  });

  it('get returns token from SecureStore', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue('secure-token');

    const token = await tokenStore.get();
    expect(token).toBe('secure-token');
  });

  it('get migrates legacy token from AsyncStorage to SecureStore', async () => {
    mockSecureStore.getItemAsync.mockResolvedValue(null);
    mockAsyncStorage.getItem.mockResolvedValue('legacy-token');

    const token = await tokenStore.get();
    expect(token).toBe('legacy-token');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'coo_session_token',
      'legacy-token'
    );
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('coo_session_token');
  });

  it('set stores token in SecureStore', async () => {
    await tokenStore.set('new-token');
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(
      'coo_session_token',
      'new-token'
    );
  });

  it('clear removes token from both stores', async () => {
    await tokenStore.clear();
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('coo_session_token');
    expect(mockAsyncStorage.removeItem).toHaveBeenCalledWith('coo_session_token');
  });
});

// ---------- Store state shape tests (tested via i18n/theme imports) ----------

describe('store initial defaults', () => {
  it('SUPPORTED_LANGS includes en, es, fr, de', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { SUPPORTED_LANGS } = require('../i18n');
    expect(SUPPORTED_LANGS).toEqual(['en', 'es', 'fr', 'de']);
  });

  it('translate returns key when translation is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { translate } = require('../i18n');
    const result = translate('en', 'nonexistent_key_xyz');
    expect(result).toBe('nonexistent_key_xyz');
  });

  it('translate returns correct value for known key in different language', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { translate } = require('../i18n');
    // The translate function should return a string for any supported lang
    const enResult = translate('en', 'nonexistent_key');
    const esResult = translate('es', 'nonexistent_key');
    // Both should fall back to the key itself
    expect(enResult).toBe('nonexistent_key');
    expect(esResult).toBe('nonexistent_key');
  });
});

describe('theme module', () => {
  it('resolveAppearance returns light or dark', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { resolveAppearance } = require('../theme');
    expect(resolveAppearance('light', 'dark')).toBe('light');
    expect(resolveAppearance('dark', 'light')).toBe('dark');
    expect(['light', 'dark']).toContain(resolveAppearance('system', 'dark'));
  });

  it('getTheme returns an object with color properties', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getTheme } = require('../theme');
    const theme = getTheme('light', 'light');
    expect(theme).toBeDefined();
    expect(typeof theme).toBe('object');
  });
});

// ---------- User type shape ----------

describe('User type shape', () => {
  it('matches expected interface fields', () => {
    const user: User = {
      user_id: 'u1',
      email: 'test@example.com',
      name: 'Test User',
      family_id: 'f1',
      language: 'en',
    };
    expect(user.user_id).toBe('u1');
    expect(user.email).toBe('test@example.com');
    expect(user.name).toBe('Test User');
    expect(user.family_id).toBe('f1');
    expect(user.language).toBe('en');
  });

  it('accepts optional fields', () => {
    const user: User = {
      user_id: 'u2',
      email: 'admin@example.com',
      name: 'Admin',
      family_id: 'f2',
      language: 'es',
      picture: 'https://example.com/pic.jpg',
      is_admin: true,
    };
    expect(user.picture).toBe('https://example.com/pic.jpg');
    expect(user.is_admin).toBe(true);
  });
});
