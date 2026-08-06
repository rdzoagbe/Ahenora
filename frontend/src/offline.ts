import AsyncStorage from '@react-native-async-storage/async-storage';

import { logger } from './logger';

/**
 * Survive a dead connection.
 *
 * The app read everything from the server through a memory-only cache that
 * died with the process, so a phone with no signal — a supermarket aisle, a
 * basement car park, a village with one bar — showed an empty shopping list
 * and an empty day. Two halves fix that:
 *
 *   1. SNAPSHOTS. Successful reads of a few small, high-value lists are
 *      written to disk. When the network fails, the last known copy is served
 *      instead of an error.
 *   2. A QUEUE. Ticking something off with no signal is remembered and
 *      replayed when the connection returns.
 *
 * Deliberately narrow: only the lists a family needs in hand (tasks, the
 * shopping list, meals, members), and only IDEMPOTENT writes — setting a
 * status to a named value. Replaying "set checked = true" twice is harmless;
 * replaying "create item" is not, so creates are never queued.
 */

const SNAP_PREFIX = 'coo_snap:';
const QUEUE_KEY = 'coo_offline_queue';
const QUEUE_MAX = 50;

/**
 * Paths whose successful responses are worth keeping on disk.
 *
 * `/auth/me` and `/subscription` are here for a reason that only shows up in
 * the shop: the app had been killed, so it launched cold with no signal, could
 * not fetch the signed-in user, and showed the welcome carousel to someone who
 * has been a member for months. Remembering who is signed in is what makes the
 * cached lists reachable at all.
 */
const SNAPSHOT_PATHS = [
  '/auth/me', '/subscription',
  '/cards', '/shopping', '/meals', '/family/members', '/activity',
];

export function isSnapshotPath(path: string): boolean {
  const base = path.split('?')[0];
  return SNAPSHOT_PATHS.some((p) => base === p);
}

export async function saveSnapshot(path: string, data: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(
      SNAP_PREFIX + path,
      JSON.stringify({ at: Date.now(), data }),
    );
  } catch (e) {
    logger.warn('snapshot not saved', path, e);
  }
}

export async function loadSnapshot<T = unknown>(
  path: string,
): Promise<{ data: T; at: number } | null> {
  try {
    const raw = await AsyncStorage.getItem(SNAP_PREFIX + path);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: T };
    return { data: parsed.data, at: parsed.at };
  } catch (e) {
    logger.warn('snapshot not read', path, e);
    return null;
  }
}

/** Wipe every snapshot — used on sign-out so a device keeps nobody's data. */
export async function clearSnapshots(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter((k) => k.startsWith(SNAP_PREFIX) || k === QUEUE_KEY);
    if (mine.length) await AsyncStorage.multiRemove(mine);
  } catch (e) {
    logger.warn('snapshots not cleared', e);
  }
}

export interface QueuedWrite {
  id: string;
  path: string;
  method: string;
  body?: unknown;
  at: number;
}

/** Only these may be replayed: each states a final value, so a repeat is a no-op. */
export function isQueueablePath(path: string, method: string): boolean {
  if (method.toUpperCase() !== 'PATCH') return false;
  const base = path.split('?')[0];
  return /^\/cards\/[^/]+$/.test(base) || /^\/shopping\/[^/]+$/.test(base);
}

async function readQueue(): Promise<QueuedWrite[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueuedWrite[]): Promise<void> {
  try {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-QUEUE_MAX)));
  } catch (e) {
    logger.warn('offline queue not saved', e);
  }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

// Every read-modify-write of the queue goes through one chain.
//
// enqueueWrite reads, mutates and writes with awaits in between, and flushQueue
// writes back a list it computed before sending anything. Two ticks made a
// second apart in a basement both timed out at once, both read an empty queue,
// and the second write erased the first — a change the badge still claimed was
// pending. `.then(fn, fn)` keeps the chain alive after a rejection.
let queueLock: Promise<unknown> = Promise.resolve();
function withQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueLock.then(fn, fn);
  queueLock = run.catch(() => undefined);
  return run;
}

export async function enqueueWrite(path: string, method: string, body?: unknown): Promise<void> {
  return withQueue(() => enqueueWriteUnlocked(path, method, body));
}

async function enqueueWriteUnlocked(path: string, method: string, body?: unknown): Promise<void> {
  const items = await readQueue();
  const base = path.split('?')[0];
  // One entry per target: replaying three toggles of the same checkbox is
  // noise. But these are *partial* PATCH bodies — a later {name} must not erase
  // an earlier {checked} for the same item — so merge the fields (newest wins
  // per field) rather than replacing the whole body. Ticking then renaming a
  // shopping item offline used to drop the tick on reconnect.
  const prior = items.find((i) => i.path.split('?')[0] === base);
  const kept = items.filter((i) => i.path.split('?')[0] !== base);
  const mergedBody =
    prior && isPlainObject(prior.body) && isPlainObject(body)
      ? { ...prior.body, ...body }
      : body;
  kept.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, path, method, body: mergedBody, at: Date.now() });
  await writeQueue(kept);
}

export async function queuedCount(): Promise<number> {
  return (await readQueue()).length;
}

/**
 * A replayed write is dropped only when the server gives a FINAL answer — a
 * 4xx that says this request is wrong and always will be (gone, forbidden,
 * a bad value). A 5xx or a 429 is temporary: the backend was down, deploying,
 * cold-starting or rate-limiting, and the same request will succeed once it
 * recovers. Those must stay queued.
 *
 * This was the bug: any 3-digit status counted as "the server had an opinion",
 * so a checkbox ticked off in a basement and replayed the instant the phone
 * reconnected — exactly when the backend is most likely mid-cold-start and
 * answering 503 — was silently discarded. The tick reverted and nothing said
 * so. 429 is deliberately kept too: being rate-limited is not a refusal of the
 * change.
 */
function isFinalRefusal(status: number): boolean {
  if (status === 429) return false;      // rate-limited: try again later
  return status >= 400 && status < 500;  // 4xx: a permanent client-side no
}

/**
 * Replay what was done offline, oldest first. A final 4xx refusal is dropped;
 * a transient server error (5xx/429) and any on-the-wire failure stay queued
 * for the next attempt.
 */
export async function flushQueue(
  send: (path: string, method: string, body?: unknown) => Promise<unknown>,
): Promise<{ sent: number; left: number }> {
  const items = await readQueue();
  if (items.length === 0) return { sent: 0, left: 0 };

  const seen = new Set(items.map((i) => i.id));
  const remaining: QueuedWrite[] = [];
  let sent = 0;
  for (const item of items) {
    try {
      await send(item.path, item.method, item.body);
      sent += 1;
    } catch (e: any) {
      const status = Number(e?.status ?? String(e?.message || '').match(/^(\d{3}):/)?.[1]);
      if (Number.isFinite(status) && isFinalRefusal(status)) {
        // A permanent no: replaying it tomorrow will not change the answer.
        logger.warn('queued write refused, dropping', item.path, status);
        sent += 1;
      } else {
        // Transient (5xx/429) or a network failure: keep it for next time.
        remaining.push(item);
      }
    }
  }
  // Anything enqueued WHILE this was sending is not in `remaining`, and
  // writing it back wholesale erased it — a tick made during the drain simply
  // vanished. Re-read and keep whatever arrived since the snapshot.
  await withQueue(async () => {
    const now = await readQueue();
    const arrivedDuringFlush = now.filter((i) => !seen.has(i.id));
    await writeQueue([...remaining, ...arrivedDuringFlush]);
  });
  return { sent, left: remaining.length };
}
