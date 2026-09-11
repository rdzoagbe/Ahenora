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
/** The App Store listing (App Store Connect id, from eas.json). The review
 *  action used to send an iPhone to Google Play. */
export const IOS_STORE_URL = 'https://apps.apple.com/app/id6806811163';
/** The "write a review" deep link on iOS opens the review sheet directly. */
export const IOS_REVIEW_URL = `${IOS_STORE_URL}?action=write-review`;

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
 * Asked once per install, and that has to survive the request going wrong.
 *
 * Reported from a real phone: every task she ticked off brought up "a survey".
 * The one-time flag was written AFTER the request — so a request that rejected
 * (the Play in-app review flow rejects for its own reasons) left the flag
 * unwritten while the win count was already past the threshold, and every
 * completed task asked again. The code read as "ask once"; what it did was
 * "ask once if nothing goes wrong, and forever if anything does".
 *
 * Two guards now, because the flag itself is a write that can fail:
 *   - askedThisSession stops it dead for the rest of the app session, whatever
 *     storage does;
 *   - the stored flag is written BEFORE the request, so one attempt is one
 *     attempt across sessions too.
 *
 * The hasAction() check stays ahead of both: when the OS says it will not show
 * a sheet, nothing was asked and the one chance is not spent.
 */
let askedThisSession = false;

/**
 * Record a positive moment (chore completed, task done, calendar synced).
 * Once enough have accumulated, asks the OS to show its review sheet.
 *
 * Safe to call from anywhere: never throws, never blocks the UI, and silently
 * does nothing on builds without the native module.
 *
 * `getReview` is injectable ONLY so this can be tested. The real one reaches
 * the native module through a dynamic import, which jest cannot intercept —
 * so without this seam the whole decision below was untestable, which is how
 * it came to ship asking on every tick.
 */
export async function recordWin(
  getReview: () => Promise<any | null> = getStoreReview,
): Promise<void> {
  try {
    if (askedThisSession) return;
    const asked = await AsyncStorage.getItem(ASKED_KEY);
    if (asked) return; // already asked once — never nag again

    const raw = await AsyncStorage.getItem(WINS_KEY);
    const wins = (parseInt(raw || '0', 10) || 0) + 1;
    await AsyncStorage.setItem(WINS_KEY, String(wins));
    if (wins < WINS_BEFORE_ASK) return;

    const StoreReview = await getReview();
    if (!StoreReview) return;

    // hasAction() is false when the OS won't show a sheet (quota reached,
    // unsupported device). Don't burn the one-time flag in that case.
    const available = await StoreReview.hasAction?.();
    if (available === false) return;

    // Before the request, not after. Whatever requestReview does — resolve,
    // reject, hang — this parent has now been asked.
    //
    // The flag write swallows its own failure rather than sharing the outer
    // catch: writing it first is what stops the nagging, but letting a failed
    // write skip the request would mean a parent with full storage is never
    // asked at all. askedThisSession covers that case instead.
    askedThisSession = true;
    await AsyncStorage.setItem(ASKED_KEY, new Date().toISOString())
      .catch((e) => logger.warn('could not record that we asked', e));
    await StoreReview.requestReview();
  } catch (e) {
    logger.warn('review prompt skipped', e);
  }
}

/** Test seam: forget that this session already asked. */
export function resetReviewPromptForTests(): void {
  askedThisSession = false;
}

/**
 * A deliberate, user-initiated "Rate the app" — for the happy parent who goes
 * looking to leave a review.
 *
 * This deliberately does NOT use the native in-app review sheet. That API is
 * silent by design: Google quotas it hard and simply shows nothing on test
 * builds, repeat asks, or when it feels like it — which, on a button the user
 * tapped on purpose, reads as "nothing happened / it's broken". So a manual tap
 * always opens the store listing, where they can actually leave a review. The
 * automatic prompt (recordWin, above) still uses the quiet in-app sheet, which
 * is the right tool for an unprompted moment. Opens the Play Store app directly
 * (market://) when possible, falling back to the web listing (web, or no Play
 * app installed).
 */
export async function openReview(): Promise<void> {
  if (Platform.OS === 'ios') {
    await Linking.openURL(IOS_REVIEW_URL).catch((e) =>
      logger.warn('could not open App Store listing', e));
    return;
  }
  const marketUrl = 'market://details?id=com.householdcoo.app';
  try {
    if (await Linking.canOpenURL(marketUrl)) {
      await Linking.openURL(marketUrl);
      return;
    }
  } catch (e) {
    logger.warn('could not open Play Store app, using web listing', e);
  }
  await Linking.openURL(ANDROID_STORE_URL).catch((e) =>
    logger.warn('could not open store listing', e));
}
