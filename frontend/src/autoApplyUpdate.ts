/**
 * Applying an over-the-air update without asking.
 *
 * An OTA update downloads in the background and applies on the NEXT cold
 * start. So the sequence people actually live is: a release goes out
 * overnight, they open the app in the morning, and they get YESTERDAY's app
 * while the new one quietly downloads. The fix they were told about arrives on
 * their second open, which might be that evening, or next week, or never —
 * plenty of people never cold-start an app twice in a day.
 *
 * The banner asking them to relaunch is not the answer either. It only speaks
 * after three updates have piled up (see UpdateNotice), on purpose, because
 * asking every time trained one household to ignore it entirely.
 *
 * So: when an update finishes downloading in the first few seconds of a
 * launch, and nobody has done anything yet, apply it there and then. From the
 * outside it is a launch that took a beat longer. Nothing is lost, because at
 * that moment there is nothing to lose.
 *
 * Every guard here exists to protect that last clause, and the function is
 * pure so each one can be tested without a device:
 *
 *   - `enabled`     — web reloads itself and has its own banner; a build
 *                     without expo-updates has nothing to apply.
 *   - `pending`     — there is actually a downloaded update waiting.
 *   - `foregroundAt`— the moment this foreground session began: a cold start,
 *                     or a return from long enough in the background that
 *                     whatever they were doing is over.
 *   - GRACE_MS      — after this, assume they are using the app. Better to
 *                     leave the update for next launch than to yank the screen
 *                     out from under somebody.
 *   - interaction   — a single press means they are here and doing something.
 *   - keyboard      — a keyboard up means a field is focused, which means
 *                     there may be half-typed text on screen. Never reload
 *                     over that, whatever the clock says.
 */

/** How long after a foreground session begins a silent reload stays safe. */
export const GRACE_MS = 8000;

/**
 * How long away from the app makes a return count as a fresh start.
 *
 * Short enough that a morning open after an overnight release qualifies; long
 * enough that flipping out to the camera or a password manager and straight
 * back does not — that is the middle of a task, not the start of one.
 */
export const AWAY_MS = 20 * 60 * 1000;

export interface AutoApplyInput {
  /** expo-updates is on and this build can receive updates. */
  enabled: boolean;
  /** A downloaded update is staged and waiting. */
  pending: boolean;
  /** When this foreground session began. */
  foregroundAt: number;
  /** Now. */
  now: number;
  /** When the last press happened, or 0 for none. */
  lastInteractionAt: number;
  /** Whether a text field currently has the keyboard up. */
  keyboardVisible: boolean;
}

export function shouldAutoApplyUpdate(input: AutoApplyInput): boolean {
  const { enabled, pending, foregroundAt, now, lastInteractionAt, keyboardVisible } = input;
  if (!enabled || !pending) return false;
  if (keyboardVisible) return false;
  // A clock that has gone backwards (or a foregroundAt in the future) must not
  // read as "0ms since launch, go ahead" — it is not evidence of anything.
  const elapsed = now - foregroundAt;
  if (elapsed < 0 || elapsed > GRACE_MS) return false;
  // Only presses since this session began count. One from before the app was
  // backgrounded says nothing about whether they are busy now.
  if (lastInteractionAt >= foregroundAt) return false;
  return true;
}

/** Whether a return to the foreground counts as a fresh start. */
export function isFreshStart(backgroundedAt: number, now: number): boolean {
  if (!backgroundedAt) return true;
  return now - backgroundedAt >= AWAY_MS;
}
