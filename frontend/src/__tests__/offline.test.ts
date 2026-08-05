/**
 * The supermarket test: no signal, and the list has to still be there.
 *
 * These cover the two promises src/offline.ts makes — that a read served from
 * disk matches the last good response, and that a tick-off made with no
 * connection is replayed exactly once when the connection returns.
 */

// React Native injects __DEV__; the bare node test environment does not.
(globalThis as Record<string, unknown>).__DEV__ = false;

const store = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    setItem: jest.fn(async (k: string, v: string) => { store.set(k, v); }),
    removeItem: jest.fn(async (k: string) => { store.delete(k); }),
    getAllKeys: jest.fn(async () => Array.from(store.keys())),
    multiRemove: jest.fn(async (keys: string[]) => { keys.forEach((k) => store.delete(k)); }),
  },
}));

import {
  clearSnapshots,
  enqueueWrite,
  flushQueue,
  isQueueablePath,
  isSnapshotPath,
  loadSnapshot,
  queuedCount,
  saveSnapshot,
} from '../offline';

beforeEach(() => {
  store.clear();
});

describe('snapshots', () => {
  it('keeps only the lists a family needs in hand', () => {
    expect(isSnapshotPath('/shopping')).toBe(true);
    expect(isSnapshotPath('/cards?status=OPEN')).toBe(true);
    expect(isSnapshotPath('/vault')).toBe(false);
    expect(isSnapshotPath('/family/invites')).toBe(false);
  });

  it('returns the last saved copy of a list', async () => {
    await saveSnapshot('/shopping', [{ id: '1', name: 'Milk' }]);
    const snap = await loadSnapshot<{ id: string; name: string }[]>('/shopping');
    expect(snap?.data).toEqual([{ id: '1', name: 'Milk' }]);
    expect(typeof snap?.at).toBe('number');
  });

  it('has nothing to say about a list it never saw', async () => {
    expect(await loadSnapshot('/meals')).toBeNull();
  });

  it('leaves no household data behind on sign-out', async () => {
    await saveSnapshot('/shopping', [{ id: '1' }]);
    await enqueueWrite('/cards/c1', 'PATCH', { status: 'DONE' });
    await clearSnapshots();
    expect(await loadSnapshot('/shopping')).toBeNull();
    expect(await queuedCount()).toBe(0);
  });
});

describe('the write queue', () => {
  it('accepts only writes that are safe to repeat', () => {
    expect(isQueueablePath('/cards/c1', 'PATCH')).toBe(true);
    expect(isQueueablePath('/shopping/s1', 'PATCH')).toBe(true);
    // A create replayed twice is two of the same thing.
    expect(isQueueablePath('/cards', 'POST')).toBe(false);
    expect(isQueueablePath('/cards/c1', 'DELETE')).toBe(false);
    expect(isQueueablePath('/shopping/s1/notes', 'PATCH')).toBe(false);
  });

  it('remembers the last thing you said about an item, not every toggle', async () => {
    await enqueueWrite('/shopping/s1', 'PATCH', { checked: true });
    await enqueueWrite('/shopping/s1', 'PATCH', { checked: false });
    await enqueueWrite('/shopping/s1', 'PATCH', { checked: true });
    expect(await queuedCount()).toBe(1);
    const sent: unknown[] = [];
    await flushQueue(async (_p, _m, body) => { sent.push(body); });
    expect(sent).toEqual([{ checked: true }]);
  });

  it('merges partial edits to the same item so no field is lost', async () => {
    // Tick then rename the same item offline: the rename must not erase the
    // tick. Both are partial PATCH bodies, so the queued entry carries both.
    await enqueueWrite('/shopping/s1', 'PATCH', { checked: true });
    await enqueueWrite('/shopping/s1', 'PATCH', { name: 'Milk 2%' });
    expect(await queuedCount()).toBe(1);
    const sent: unknown[] = [];
    await flushQueue(async (_p, _m, body) => { sent.push(body); });
    expect(sent).toEqual([{ checked: true, name: 'Milk 2%' }]);
  });

  it('replays everything once the connection is back, oldest first', async () => {
    await enqueueWrite('/cards/c1', 'PATCH', { status: 'DONE' });
    await enqueueWrite('/shopping/s1', 'PATCH', { checked: true });
    const paths: string[] = [];
    const result = await flushQueue(async (p) => { paths.push(p); });
    expect(paths).toEqual(['/cards/c1', '/shopping/s1']);
    expect(result).toEqual({ sent: 2, left: 0 });
    expect(await queuedCount()).toBe(0);
  });

  it('keeps a write that failed on the wire for the next attempt', async () => {
    await enqueueWrite('/cards/c1', 'PATCH', { status: 'DONE' });
    const result = await flushQueue(async () => { throw new Error('Network request failed'); });
    expect(result).toEqual({ sent: 0, left: 1 });
    expect(await queuedCount()).toBe(1);
  });

  it('drops a write the server actually refused', async () => {
    await enqueueWrite('/cards/c1', 'PATCH', { status: 'DONE' });
    // The card was deleted on another device: retrying tomorrow changes nothing.
    const result = await flushQueue(async () => { throw new Error('404: not found'); });
    expect(result).toEqual({ sent: 1, left: 0 });
    expect(await queuedCount()).toBe(0);
  });

  it('keeps a write through a transient server error (5xx)', async () => {
    // The classic loss: ticked off in a basement, replayed the instant the
    // phone reconnects — exactly when the backend is mid-cold-start and
    // answering 503. That is not a refusal of the change; keep it.
    await enqueueWrite('/cards/c1', 'PATCH', { status: 'DONE' });
    const result = await flushQueue(async () => {
      throw Object.assign(new Error('503: service unavailable'), { status: 503 });
    });
    expect(result).toEqual({ sent: 0, left: 1 });
    expect(await queuedCount()).toBe(1);
  });

  it('keeps a write that was rate-limited (429)', async () => {
    await enqueueWrite('/shopping/s1', 'PATCH', { checked: true });
    const result = await flushQueue(async () => {
      throw Object.assign(new Error('429: too many requests'), { status: 429 });
    });
    expect(result).toEqual({ sent: 0, left: 1 });
  });

  it('drops a 4xx even when the error carries only a message', async () => {
    // drainQueue throws `${status}: ...` without a status field; the parse
    // fallback must still recognise a final refusal.
    await enqueueWrite('/cards/c1', 'PATCH', { status: 'DONE' });
    const result = await flushQueue(async () => { throw new Error('403: forbidden'); });
    expect(result).toEqual({ sent: 1, left: 0 });
  });

  it('does nothing at all when there is nothing waiting', async () => {
    const send = jest.fn();
    expect(await flushQueue(send)).toEqual({ sent: 0, left: 0 });
    expect(send).not.toHaveBeenCalled();
  });
});
