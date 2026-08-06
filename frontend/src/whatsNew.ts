/**
 * What changed, in the words of someone who uses the app.
 *
 * Keyed by the store version it belongs to, so a release announces itself once
 * and only to people who were already on an older one. The values are i18n
 * keys rather than sentences, because a family reading the app in French
 * should read this in French too.
 *
 * The rule for writing these: name the thing that changed and the tab it lives
 * on. "Fixed a race in the offline queue" is true and useless to a parent;
 * "Ticking something off with no signal no longer goes missing" is the same
 * fix, said usefully. Three bullets at most — a longer list gets dismissed
 * unread, which costs more than saying less.
 *
 * A version with no entry here simply shows nothing.
 */
export const WHATS_NEW: Record<string, string[]> = {
  '1.0.2': [
    'wn_102_calendar',
    'wn_102_kids',
    'wn_102_recipes',
  ],
};
