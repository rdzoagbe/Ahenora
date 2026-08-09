// In-app review prompt — asked only after the app has actually helped.
//
// Two rules drive the design:
//   1. Ask on a WIN, never on launch or after an error. A parent who just
//      completed a chore or synced a calendar is the one who'll leave 5 stars.
//   2. Never nag. We ask once per install, after several wins, and if the OS
//      declines to show the sheet we don't retry aggressively.
//
// expo-store-review is a NATIVE module, so this file follows the same
// graceful-fallback rule as src/billing.ts: it no-ops cleanly on builds that
// don't contain it yet, which makes it safe to ship OTA ahead of the build.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import { logger } from './logger';

const WINS_KEY = 'coo_review_wins';
const ASKED_KEY = 'coo_review_asked_at';

/** The public listing — where the native review sheet can't be shown (web, or
 *  a device the OS won't prompt on), we open this instead. */
export const ANDROID_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.householdcoo.app';

/** Wins required before we ask. Enough that the app has clearly delivered. */
const WINS_BEFORE_ASK = 5;

async function getStoreReview(): Promise<any | null> {
  if (Platform.OS === 'web') return null;
  try {
    const mod: any = await import('expo-store-review');
    const StoreReview = mod.default ?? mod;
    if (typeof StoreReview?.requestReview !== 'function') return null;
    return StoreReview;
  } catch {
    // Build predates the native module — nothing to do.
    return null;
  }
}

/**
 * Record a positive moment (chore completed, task done, calendar synced).
 * Once enough have accumulated, asks the OS to show its review sheet.
 *
 * Safe to call from anywhere: never throws, never blocks the UI, and silently
 * does nothing on builds without the native module.
 */
export async function recordWin(): Promise<void> {
  try {
    const asked = await AsyncStorage.getItem(ASKED_KEY);
    if (asked) return; // already asked once — never nag again

    const raw = await AsyncStorage.getItem(WINS_KEY);
    const wins = (parseInt(raw || '0', 10) || 0) + 1;
    await AsyncStorage.setItem(WINS_KEY, String(wins));
    if (wins < WINS_BEFORE_ASK) return;

    const StoreReview = await getStoreReview();
    if (!StoreReview) return;

    // hasAction() is false when the OS won't show a sheet (quota reached,
    // unsupported device). Don't burn the one-time flag in that case.
    const available = await StoreReview.hasAction?.();
    if (available === false) return;

    await StoreReview.requestReview();
    await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString());
  } catch (e) {
    logger.warn('review prompt skipped', e);
  }
}

/**
 * A deliberate, user-initiated "Rate the app" — for the happy parent who goes
 * looking to leave a review rather than waiting for the automatic prompt.
 *
 * On a native build it shows the OS review sheet; everywhere else (web, or a
 * device the OS won't prompt on) it opens the store listing so there is always
 * a way through. Marks the one-time flag so the automatic prompt won't also
 * fire later.
 */
export async function openReview(): Promise<void> {
  try {
    const StoreReview = await getStoreReview();
    if (StoreReview && (await StoreReview.hasAction?.()) !== false) {
      await StoreReview.requestReview();
      await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString());
      return;
    }
  } catch (e) {
    logger.warn('in-app review unavailable, opening store', e);
  }
  // Fallback: the public listing (works on web and anywhere the sheet won't).
  await Linking.openURL(ANDROID_STORE_URL).catch((e) =>
    logger.warn('could not open store listing', e));
}
