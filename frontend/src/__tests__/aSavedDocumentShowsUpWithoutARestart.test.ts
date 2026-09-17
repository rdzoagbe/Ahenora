/**
 * A scanned letter was filed in the vault and did not appear there until the
 * app was restarted. Roland, 2026-09-17: "the document wasn't saved directly.
 * I had to close and open the app to see it."
 *
 * It WAS saved. The scan sheet files the document after it closes (so a failed
 * vault save can never tempt a second tap on Save and a duplicate card), which
 * means the Vault tab can be focused, load, and render while that upload is
 * still in flight. createVaultDoc invalidated the list cache BEFORE the
 * request only; the tab re-read an empty cache from a server that had not
 * committed yet, cached that, and held it. createCard already guarded against
 * exactly this by invalidating again after the write — the vault calls did not.
 *
 * Two halves, both needed: invalidate after commit, and tell a vault screen
 * that is already open to reload.
 */
process.env.EXPO_PUBLIC_BACKEND_URL = 'https://test-backend.example.com';

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
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));

import { readFileSync } from 'fs';
import { join } from 'path';
import { api, tokenStore } from '../api';
import { cache } from '../cache';
import { onVaultChanged, notifyVaultChanged } from '../vaultChanged';

const DOC = { doc_id: 'doc_1', family_id: 'f', title: 'Dentist letter', category: 'health',
  image_base64: 'data:image/jpeg;base64,AAAA', created_at: '2026-09-17T06:00:00Z' };

/** A server that only commits when we say so — the shape of the race. */
function fetchThatCommitsLater() {
  let commit!: () => void;
  const committed = new Promise<void>((resolve) => { commit = resolve; });
  (global.fetch as jest.Mock).mockImplementation(async () => {
    await committed;
    return {
      ok: true, status: 200,
      text: async () => JSON.stringify(DOC),
      json: async () => DOC,
    } as unknown as Response;
  });
  return commit;
}

beforeEach(() => {
  global.fetch = jest.fn();
  cache.clear();
  jest.spyOn(tokenStore, 'get').mockResolvedValue(null);
});
afterEach(() => jest.restoreAllMocks());

describe('a vault write invalidates the list AFTER it commits, not only before', () => {
  it('createVaultDoc: a list cached mid-flight is dropped once the write lands', async () => {
    const commit = fetchThatCommitsLater();
    const saving = api.createVaultDoc({ title: 'x', category: 'health', image_base64: 'data:,' });
    // The Vault tab focuses while the upload is in flight and caches the
    // pre-write list. This is the exact sequence that was reported.
    cache.set('listVault', [], 60_000);
    expect(cache.get('listVault')).toEqual([]);
    commit();
    await saving;
    expect(cache.get('listVault')).toBeNull();
  });

  it('deleteVaultDoc and setVaultVisibility do the same', async () => {
    for (const call of [
      () => api.deleteVaultDoc('doc_1'),
      () => api.setVaultVisibility('doc_1', 'shared'),
    ]) {
      const commit = fetchThatCommitsLater();
      const p = call();
      cache.set('listVault', [DOC], 60_000);
      commit();
      await p;
      expect(cache.get('listVault')).toBeNull();
    }
  });
});

describe('a vault screen that is already open is told', () => {
  it('hears about the write only after it has committed', async () => {
    const heard: string[] = [];
    const off = onVaultChanged(() => heard.push('changed'));
    const commit = fetchThatCommitsLater();
    const saving = api.createVaultDoc({ title: 'x', category: 'health', image_base64: 'data:,' });
    await Promise.resolve();
    expect(heard).toEqual([]);         // not on the optimistic side
    commit();
    await saving;
    expect(heard).toEqual(['changed']);
    off();
  });

  it('unsubscribing stops the signal, and one broken listener does not silence the rest', () => {
    const heard: string[] = [];
    const off = onVaultChanged(() => heard.push('a'));
    onVaultChanged(() => { throw new Error('boom'); });
    onVaultChanged(() => heard.push('b'));
    notifyVaultChanged();
    expect(heard).toEqual(['a', 'b']);
    off();
    notifyVaultChanged();
    expect(heard).toEqual(['a', 'b', 'b']);
  });

  it('and the Vault tab actually subscribes, with the same loader focus uses', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'app', '(tabs)', 'vault.tsx'), 'utf8');
    expect(src).toContain("from '../../src/vaultChanged'");
    expect(src).toMatch(/useEffect\(\(\) => onVaultChanged\(\(\) => \{ load\(\); \}\), \[load\]\)/);
  });
});
