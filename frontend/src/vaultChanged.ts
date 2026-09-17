/**
 * "A document just landed in the vault" — for a screen that is already open.
 *
 * The scan sheet files a document AFTER it closes, so a failed vault save can
 * never tempt somebody into tapping Save again and creating a duplicate card.
 * That means the Vault tab can gain focus, load its list, and render — all
 * while the upload is still in flight. It then holds a list without the new
 * document, and nothing tells it otherwise: the cache was invalidated before
 * the request, the screen re-read an EMPTY cache from a server that had not
 * yet committed, and cached THAT. Restarting the app was the only fix, which
 * is exactly how it was reported.
 *
 * Same bridge as captureFocus: a transient signal, not household data, so it
 * stays out of the store rather than re-rendering every subscribed screen.
 * Several screens may care (the vault, a picker), so this one keeps a set.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe while mounted; the returned function unsubscribes. */
export function onVaultChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** A vault write has COMMITTED on the server. Called after the response, never
 *  before it — a listener that reloads on the optimistic side of the request
 *  reads the same stale list this exists to prevent. */
export function notifyVaultChanged(): void {
  for (const fn of Array.from(listeners)) {
    try { fn(); } catch { /* one listener's failure must not silence the rest */ }
  }
}
