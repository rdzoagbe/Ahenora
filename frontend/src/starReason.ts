/**
 * What a line of a child's star history says.
 *
 * The server writes a few lines itself, in English ("Starting stars", "Full
 * week", ...), and saved them like that for months, so a French family read
 * "Starting stars" in the middle of a French screen (found 2026-11-12). Those
 * fixed lines are shown in the reader's language; anything a parent typed is
 * shown as typed. Matching on the stored text, not on a new field, is what
 * also corrects the history already saved.
 */
type Translate = (key: string, params?: Record<string, string | number>) => string;

export const SERVER_STAR_REASONS: Record<string, string> = {
  'Starting stars': 'kids_starting_stars',
  'Full week': 'star_reason_full_week',
  'Parent added stars': 'star_reason_added',
  'Parent removed stars': 'star_reason_removed',
  'Reward redeemed': 'star_reason_redeemed',
};

export function starReasonText(reason: string | null | undefined, t: Translate, emptyKey: string): string {
  const said = (reason || '').trim();
  if (!said) return t(emptyKey);
  const key = SERVER_STAR_REASONS[said];
  return key ? t(key) : said;
}
