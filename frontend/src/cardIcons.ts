/**
 * The icon a card is about.
 *
 * The server stores a KEY ("birthday"), never the glyph, and guesses one from
 * the title when nobody chose (backend/card_icons.py). This is the app's side
 * of that contract: the same twenty keys, in the same order the picker shows
 * them, and the glyph each one is drawn with today. Changing a glyph here
 * changes it on every card at once; a card the server labelled with a key
 * this list does not know renders as it did before icons existed.
 */
export const CARD_ICONS: { key: string; glyph: string; labelKey: string }[] = [
  { key: 'birthday', glyph: '🎂', labelKey: 'icon_birthday' },
  { key: 'cleaning', glyph: '🧹', labelKey: 'icon_cleaning' },
  { key: 'bed', glyph: '🛏️', labelKey: 'icon_bed' },
  { key: 'car', glyph: '🚗', labelKey: 'icon_car' },
  { key: 'school', glyph: '🎒', labelKey: 'icon_school' },
  { key: 'sport', glyph: '⚽', labelKey: 'icon_sport' },
  { key: 'doctor', glyph: '🩺', labelKey: 'icon_doctor' },
  { key: 'dentist', glyph: '🦷', labelKey: 'icon_dentist' },
  { key: 'shopping', glyph: '🛒', labelKey: 'icon_shopping' },
  { key: 'cooking', glyph: '🍳', labelKey: 'icon_cooking' },
  { key: 'laundry', glyph: '🧺', labelKey: 'icon_laundry' },
  { key: 'bins', glyph: '🗑️', labelKey: 'icon_bins' },
  { key: 'pet', glyph: '🐶', labelKey: 'icon_pet' },
  { key: 'music', glyph: '🎵', labelKey: 'icon_music' },
  { key: 'party', glyph: '🎉', labelKey: 'icon_party' },
  { key: 'travel', glyph: '✈️', labelKey: 'icon_travel' },
  { key: 'money', glyph: '💶', labelKey: 'icon_money' },
  { key: 'homework', glyph: '📚', labelKey: 'icon_homework' },
  { key: 'bath', glyph: '🛁', labelKey: 'icon_bath' },
  { key: 'gift', glyph: '🎁', labelKey: 'icon_gift' },
];

const BY_KEY: Record<string, string> = Object.fromEntries(CARD_ICONS.map((i) => [i.key, i.glyph]));

/** The glyph for a stored key, or null when there is nothing to draw. */
export function glyphFor(icon: string | null | undefined): string | null {
  if (!icon) return null;
  return BY_KEY[icon] ?? null;
}
