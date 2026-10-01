/**
 * Where an incoming link lands in the app.
 *
 * From version 1.2.1 the app opens invitation links itself: tapping
 * https://ahenora.com/join/?invite=… (or /fr/join, /es/join, /de/join) on a
 * phone with Ahenora installed opens the app instead of the browser (Android
 * App Links, iOS Universal Links; see docs/.well-known). The app has no
 * /join screen, so without this the link would open "page not found". It is
 * the welcome screen, carrying the invitation, which reads it from the link
 * exactly as it does for the app's own householdcoo:// links.
 *
 * Every other link — the sign-in redirects above all — passes through
 * untouched. This must never throw: a crash here is a crash on launch.
 */
const JOIN_PATH = /^(?:https?:\/\/(?:www\.)?ahenora\.com)?\/(?:(?:fr|es|de)\/)?join\/?(?:[?#]|$)/i;

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (!path || !JOIN_PATH.test(path)) return path;
    const m = /[?&#]invite=([A-Za-z0-9_-]+)/.exec(path);
    return m ? `/?invite=${m[1]}` : '/';
  } catch {
    return path;
  }
}
