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
  '1.2.0': [
    'wn_120_scan',
    'wn_120_speed',
    'wn_120_health',
  ],
  '1.1.0': [
    'wn_110_look',
    'wn_110_nav',
    'wn_110_household',
  ],
  '1.0.3': [
    'wn_103_updates',
    'wn_103_calendar',
    'wn_103_kids',
  ],
  '1.0.2': [
    'wn_102_calendar',
    'wn_102_kids',
    'wn_102_recipes',
  ],
};

/**
 * Releases that ship over the air, announced by date.
 *
 * WHATS_NEW is keyed by the store version, which an over-the-air update does
 * not change — so everything shipped between store builds (most of what
 * ships) arrived in silence. A release here is announced once to anyone who
 * had the app before it, exactly like a store version: a first run records it
 * without announcing it.
 *
 * To announce a release: add its notes here and set CURRENT_RELEASE to its
 * date. Same rules as above — three bullets at most, i18n keys, the tab to
 * look on. Set it to '' to fall back to announcing store versions only.
 */
export const RELEASE_NOTES: Record<string, string[]> = {
  '2026-09-28': [
    'wn_2609_look',
    'wn_2609_links',
    'wn_2609_feedback',
  ],
};

export const CURRENT_RELEASE = '2026-09-28';

/** What the banner announces: the current release if one is set, else the store version. */
export function announcement(version: string): { key: string; items: string[]; byDate: boolean } {
  if (CURRENT_RELEASE && RELEASE_NOTES[CURRENT_RELEASE]?.length) {
    return { key: CURRENT_RELEASE, items: RELEASE_NOTES[CURRENT_RELEASE], byDate: true };
  }
  return { key: version, items: WHATS_NEW[version] || [], byDate: false };
}

