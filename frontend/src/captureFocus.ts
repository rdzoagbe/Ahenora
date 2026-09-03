/**
 * A request from the tab bar to the Feed's capture bar: take the cursor.
 *
 * The centre ＋ and the capture bar both mean "add", and on the Feed they sit
 * inches apart — with the smaller one doing more, since the bar routes a typed
 * line to the shopping list, the week's menu or a task. Two gestures for one
 * idea on one screen.
 *
 * Rather than remove the ＋ (it is the primary create on Calendar, Family,
 * Kitchen and Vault, where nothing has replaced it), on the Feed it now points
 * at the bar instead of opening a second sheet.
 *
 * The ＋ lives in the tab bar, outside the Feed, so it cannot reach that
 * screen's input. This is the same shape of bridge as calendarSelection: one
 * subscriber, registered by the Feed while it is mounted, cleared when it is
 * not. Deliberately not in the store — it is a transient gesture, not household
 * data, and putting it there would re-render every subscribed screen.
 */
type Listener = () => void;

let listener: Listener | null = null;

/** The Feed registers while mounted; the returned function unregisters. */
export function onCaptureFocus(fn: Listener): () => void {
  listener = fn;
  return () => {
    // Only clear if it is still ours: a fast tab switch can mount the next
    // screen before the previous one has torn down, and blindly nulling would
    // leave the live Feed unreachable.
    if (listener === fn) listener = null;
  };
}

/**
 * Ask the Feed to focus its capture bar.
 *
 * Returns false when nobody is listening — the caller then falls back to the
 * normal capture sheet, so the ＋ never becomes a button that does nothing.
 */
export function requestCaptureFocus(): boolean {
  if (!listener) return false;
  listener();
  return true;
}
