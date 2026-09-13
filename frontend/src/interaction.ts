/**
 * When somebody last touched the app.
 *
 * Exists for exactly one decision: whether it is safe to relaunch the app
 * under them to apply an update. A relaunch a second after the splash screen
 * costs nothing; the same relaunch while somebody is halfway through typing a
 * note throws their words away. The difference between those two is whether
 * they have touched anything, so something has to be keeping track.
 *
 * Deliberately a module-level number rather than React state: it is read from
 * an effect that must not re-run every time anybody taps anything, and a
 * re-render per touch across the whole app is a real cost for a value nothing
 * draws.
 *
 * Recorded from PressScale, which every button, row, chip and tile in the app
 * is built on. Typing is covered separately by the keyboard check in
 * `shouldAutoApplyUpdate` — a field has to be focused before it can be typed
 * into, and a focused field means a keyboard.
 */
let lastAt = 0;

/**
 * When this foreground session began.
 *
 * Initialised at module load, which is app start — NOT when any component
 * mounts. It lived on a ref inside UpdateNotice first, and a test caught what
 * that meant: a press landing before that component happened to mount was
 * invisible, because the session looked like it had started after the press.
 * The reference point for "has anybody done anything yet" has to be older than
 * every component that asks.
 */
let sessionAt = Date.now();

/** Somebody pressed something. */
export function noteInteraction(now: number = Date.now()): void {
  lastAt = now;
}

/** When the last press happened, or 0 if there has not been one. */
export function lastInteractionAt(): number {
  return lastAt;
}

/** When this foreground session began. */
export function foregroundStartedAt(): number {
  return sessionAt;
}

/**
 * A return to the foreground that counts as a fresh start — see `isFreshStart`.
 * Clears the interaction record with it: presses from the session before say
 * nothing about whether somebody is busy now.
 */
export function markForegroundStart(now: number = Date.now()): void {
  sessionAt = now;
  lastAt = 0;
}

/** Test seam. Never call these from app code. */
export function resetInteraction(now: number = Date.now()): void {
  lastAt = 0;
  sessionAt = now;
}
