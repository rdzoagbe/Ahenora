/**
 * A tapped notification is owed its screen even if the app restarts underneath.
 *
 * Reported three times in two days. The third report named the cause: "it
 * blipped and reloaded but it did not take me to the navigation". That blip is
 * the app applying a downloaded update, which throws the JavaScript context
 * away and starts it again — taking the held target with it.
 *
 * Two defences are tested here and in autoApplyUpdate.test: the reload is
 * deferred while a tap is owed, and the target is written down so a reload
 * from ANY cause cannot lose it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// A real key-value store in memory rather than jest.fn stubs: these tests are
// about what SURVIVES being written and read back, so a mock that forgets
// would prove nothing.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: (k: string) => Promise.resolve(store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v); return Promise.resolve(); },
      removeItem: (k: string) => { store.delete(k); return Promise.resolve(); },
      clear: () => { store.clear(); return Promise.resolve(); },
    },
  };
});

import {
  PENDING_TTL_MS,
  clearTarget,
  hasPendingTarget,
  parseStored,
  rememberTarget,
  takeStoredTarget,
} from '../pendingNotificationTarget';

const KEY = 'coo_pending_notification_target';
const TARGET = { pathname: '/(tabs)/kitchen' };

beforeEach(async () => {
  await AsyncStorage.clear();
  await clearTarget();
});

describe('The target outlives the JavaScript that read it', () => {
  it('is written down, not only held in memory', async () => {
    // A module-level variable is re-initialised by the very event this exists
    // to survive, so storage is the whole point.
    await rememberTarget({ pathname: '/(tabs)/feed', params: { cardId: 'c1' } });
    const raw = await AsyncStorage.getItem(KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).target).toEqual({
      pathname: '/(tabs)/feed', params: { cardId: 'c1' },
    });
  });

  it('comes back after a restart, params and all', async () => {
    await rememberTarget({ pathname: '/(tabs)/feed', params: { cardId: 'c1' } });
    expect(await takeStoredTarget()).toEqual({
      pathname: '/(tabs)/feed', params: { cardId: 'c1' },
    });
  });

  it('is spent by being taken, so it does not re-route on every launch', async () => {
    await rememberTarget(TARGET);
    expect(await takeStoredTarget()).toEqual(TARGET);
    expect(await takeStoredTarget()).toBeNull();
  });

  it('returns nothing when none was stored', async () => {
    expect(await takeStoredTarget()).toBeNull();
  });

  it('is gone once it has been honoured', async () => {
    await rememberTarget(TARGET);
    await clearTarget();
    expect(await takeStoredTarget()).toBeNull();
  });
});

describe('An old tap is not a standing instruction', () => {
  it('honours one from moments ago', async () => {
    await rememberTarget(TARGET);
    const now = Date.now() + PENDING_TTL_MS - 1000;
    expect(await takeStoredTarget(now)).toEqual(TARGET);
  });

  it('ignores one from this morning', async () => {
    // A notification opened and abandoned must not yank somebody somewhere
    // hours later.
    await rememberTarget(TARGET);
    const now = Date.now() + PENDING_TTL_MS + 1000;
    expect(await takeStoredTarget(now)).toBeNull();
  });

  it('spends an expired one rather than leaving it to be read forever', async () => {
    await rememberTarget(TARGET);
    await takeStoredTarget(Date.now() + PENDING_TTL_MS + 1000);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });
});

describe('The update policy can ask without waiting', () => {
  it('says nothing is owed before a tap', () => {
    expect(hasPendingTarget()).toBe(false);
  });

  it('says one is owed the moment a target is remembered', async () => {
    await rememberTarget(TARGET);
    expect(hasPendingTarget()).toBe(true);
  });

  it('says nothing is owed again once it is cleared', async () => {
    await rememberTarget(TARGET);
    await clearTarget();
    expect(hasPendingTarget()).toBe(false);
  });
});

describe('Nonsense in storage is discarded, never honoured', () => {
  it('refuses a row that is not JSON', () => {
    expect(parseStored('{oh no')).toBeNull();
  });

  it('refuses a row with no destination', () => {
    expect(parseStored(JSON.stringify({ at: Date.now() }))).toBeNull();
    expect(parseStored(JSON.stringify({ target: {}, at: Date.now() }))).toBeNull();
    expect(parseStored(JSON.stringify({ target: { pathname: '' }, at: Date.now() }))).toBeNull();
  });

  it('refuses a row that cannot be aged', () => {
    // Without a usable stamp there is no way to tell a tap from ten seconds
    // ago from one from last week, so it would be honoured forever.
    const t = { pathname: '/(tabs)/feed' };
    expect(parseStored(JSON.stringify({ target: t }))).toBeNull();
    expect(parseStored(JSON.stringify({ target: t, at: 'soon' }))).toBeNull();
    expect(parseStored(JSON.stringify({ target: t, at: Infinity }))).toBeNull();
  });

  it('accepts a well formed row', () => {
    const row = { target: { pathname: '/(tabs)/vault' }, at: 123 };
    expect(parseStored(JSON.stringify(row))).toEqual(row);
  });

  it('clears an unreadable row so it is not retried on every launch', async () => {
    await AsyncStorage.setItem(KEY, 'not json at all');
    expect(await takeStoredTarget()).toBeNull();
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
  });
});
