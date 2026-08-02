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

export async function enqueueWrite(path: string, method: string, body?: unknown): Promise<void> {
  const items = await readQueue();
  const base = path.split('?')[0];
  // One entry per target: the last thing you said about an item is what you
  // meant, and replaying three toggles of the same checkbox is noise.
  const kept = items.filter((i) => i.path.split('?')[0] !== base);
  kept.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, path, method, body, at: Date.now() });
  await writeQueue(kept);
}

export async function queuedCount(): Promise<number> {
  return (await readQueue()).length;
}

/**
 * Replay what was done offline, oldest first. Anything the server answers —
 * success or a real refusal — is dropped; only entries that fail on the wire
 * stay queued for the next attempt.
 */
export async function flushQueue(
  send: (path: string, method: string, body?: unknown) => Promise<unknown>,
): Promise<{ sent: number; left: number }> {
  const items = await readQueue();
  if (items.length === 0) return { sent: 0, left: 0 };

  const remaining: QueuedWrite[] = [];
  let sent = 0;
  for (const item of items) {
    try {
      await send(item.path, item.method, item.body);
      sent += 1;
    } catch (e: any) {
      const message = String(e?.message || '');
      if (/^\d{3}:/.test(message)) {
        // The server had an opinion (gone, forbidden, invalid): replaying it
        // again tomorrow will not change that answer.
        logger.warn('queued write rejected, dropping', item.path, message);
        sent += 1;
      } else {
        remaining.push(item);
      }
    }
  }
  await writeQueue(remaining);
  return { sent, left: remaining.length };
}
