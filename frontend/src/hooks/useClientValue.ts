import { useSyncExternalStore } from 'react';

/**
 * A value the server could not know, applied once the page is hydrated.
 *
 * The web app is prerendered to static HTML, in English, with no URL
 * parameters; the browser then hydrates it. Anything the first client render
 * reads from the browser — the URL, navigator.language — that the prerender
 * could not read makes the two trees differ, and React throws the mismatch
 * away and renders the whole screen again from scratch (error #418/#423).
 *
 * React's answer is `useSyncExternalStore` with a server snapshot: while
 * hydrating, the snapshot the server would have had is used, and the real
 * value takes over right after. Outside hydration — on the phones, and on a
 * client-side navigation on the web — the real value is used at once.
 */
const subscribeToNothing = () => () => {};

export function useClientValue<T>(value: T, duringHydration: T): T {
  return useSyncExternalStore(subscribeToNothing, () => value, () => duringHydration);
}
