/**
 * The screen a tapped notification is owed, kept somewhere a reload cannot
 * reach.
 *
 * Reported three times in two days, in the same words each time: "it doesn't
 * take me to the place where it's located". The third report carried the
 * detail that explains the other two — "it blipped and reloaded but it did not
 * take me to the navigation".
 *
 * That blip is the app applying a downloaded update. `Updates.reloadAsync()`
 * throws the JavaScript context away and starts it again, and everything the
 * tap had set up went with it: the held target, the attempt counter, the
 * navigation already in flight.
 *
 * And it is not bad luck that it happened on a notification tap. The
 * auto-apply only fires when nobody has interacted yet (see autoApplyUpdate),
 * and tapping a system notification is not an interaction with the app — so a
 * notification-tap launch is the launch MOST likely to be interrupted by a
 * reload, every time an update happens to be waiting. The policy's own comment
 * says "nothing is lost, because at that moment there is nothing to lose". A
 * pending tap is exactly something to lose, and it was never counted.
 *
 * Two defences, because either alone still fails:
 *
 * - The reload is deferred while a tap is owed (autoApplyUpdate), so the
 *   common case never reloads at the wrong moment at all.
 * - The target is written to storage the moment it is read, so a reload from
 *   ANY cause — an update, a crash, a developer refresh — cannot lose it.
 *
 * Storage rather than memory is the whole point: a module-level variable is
 * re-initialised by the very event this exists to survive.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { logger } from './logger';

const KEY = 'coo_pending_notification_target';

export type NotificationTarget = { pathname: string; params?: Record<string, string> };

type Stored = { target: NotificationTarget; at: number };

/**
 * How long a stored target stays worth honouring.
 *
 * Long enough to cover a reload and a slow cold start, short enough that a
 * tap from this morning never yanks somebody somewhere this evening. A
 * notification opened and abandoned is not a standing instruction.
 */
export const PENDING_TTL_MS = 2 * 60 * 1000;

/**
 * Mirrors what is in storage, for the update policy to read synchronously.
 *
 * The policy runs in a render and cannot await. This is deliberately only a
 * hint: it is false after a reload even while storage still holds a target,
 * which is the safe direction — the worst case is a reload that the durable
 * copy then survives anyway.
 */
let pendingInMemory = false;

/** True when a tap is waiting to be honoured. Never blocks. */
export function hasPendingTarget(): boolean {
  return pendingInMemory;
}

/** Remember where a tap is owed, before anything tries to navigate. */
export async function rememberTarget(target: NotificationTarget): Promise<void> {
  pendingInMemory = true;
  try {
    const row: Stored = { target, at: Date.now() };
    await AsyncStorage.setItem(KEY, JSON.stringify(row));
  } catch (e) {
    // Storage being unavailable must not stop the tap working in this run;
    // it only costs the ability to survive a reload.
    logger.warn('could not store the pending notification target', e);
  }
}

/** The tap has been honoured, or abandoned. */
export async function clearTarget(): Promise<void> {
  pendingInMemory = false;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (e) {
    logger.warn('could not clear the pending notification target', e);
  }
}

/**
 * Take a target left behind by a previous run, if it is still fresh.
 *
 * Reads and clears in one go: a target this returns is the caller's to honour,
 * and leaving it behind would re-route on every subsequent start.
 */
export async function takeStoredTarget(now: number = Date.now()): Promise<NotificationTarget | null> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(KEY);
  } catch (e) {
    logger.warn('could not read the pending notification target', e);
    return null;
  }
  if (!raw) return null;
  // Whatever happens below, this one is spent. A row that cannot be parsed
  // would otherwise be read again on every launch forever.
  await clearTarget();
  const row = parseStored(raw);
  if (!row) return null;
  if (now - row.at > PENDING_TTL_MS) return null;
  return row.target;
}

/** Exported for its own test: what counts as a usable stored row. */
export function parseStored(raw: string): Stored | null {
  try {
    const row = JSON.parse(raw) as Partial<Stored>;
    const target = row?.target;
    // A row with no pathname is not a destination, and a non-numeric stamp
    // cannot be aged — both would otherwise be honoured forever.
    if (!target || typeof target.pathname !== 'string' || !target.pathname) return null;
    if (typeof row.at !== 'number' || !Number.isFinite(row.at)) return null;
    return { target: target as NotificationTarget, at: row.at };
  } catch {
    return null;
  }
}
