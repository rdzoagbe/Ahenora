/**
 * What a line of a child's star history says.
 *
 * Some lines are fixed phrases rather than a parent's own words: the server
 * writes a few in English ("Starting stars", "Full week", ...), and the app
 * itself saves a few in the language of whoever tapped ("Bravo !",
 * "Étoiles ajoutées par le parent", ...). So a French family read "Starting
 * stars" in a French screen (found 2026-11-12), and a co-parent reading in
 * another language read the other one's language.
 *
 * Each fixed phrase, in any language it was saved in, is shown in the
 * reader's language; anything a parent typed is shown as typed. Matching on
 * the stored text is what also corrects the history already saved.
 */
import { SUPPORTED_LANGS, TRANSLATIONS } from './i18n';

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** What the server writes, in English, and the key that says it. */
export const SERVER_STAR_REASONS: Record<string, string> = {
  'Starting stars': 'kids_starting_stars',
  'Full week': 'star_reason_full_week',
  'Parent added stars': 'kids_parent_added_stars',
  'Parent removed stars': 'kids_parent_removed_stars',
  'Reward redeemed': 'star_reason_redeemed',
};

/** The keys whose text the app itself saves as a reason (KidPageTop, kids,
 *  member), so whichever language it was saved in can be recognised. */
export const APP_STAR_REASON_KEYS = [
  'hub_well_done', 'kids_parent_added_stars', 'kids_parent_removed_stars', 'kids_balance_correction',
];

let known: Map<string, string> | null = null;
function knownPhrases(): Map<string, string> {
  if (known) return known;
  known = new Map(Object.entries(SERVER_STAR_REASONS));
  const keys = new Set([...Object.values(SERVER_STAR_REASONS), ...APP_STAR_REASON_KEYS]);
  for (const lang of SUPPORTED_LANGS) {
    const dict = TRANSLATIONS[lang] as Record<string, string | undefined>;
    for (const key of keys) {
      const said = (dict[key] || '').trim();
      if (said && !known.has(said)) known.set(said, key);
    }
  }
  return known;
}

export function starReasonText(reason: string | null | undefined, t: Translate, emptyKey: string): string {
  const said = (reason || '').trim();
  if (!said) return t(emptyKey);
  const key = knownPhrases().get(said);
  return key ? t(key) : said;
}
