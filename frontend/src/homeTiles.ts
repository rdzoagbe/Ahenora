import type { CardType } from './api';

/**
 * The coloured squares on Home, as in the reference Roland chose on
 * 2026-10-31: every row of the day starts with a tile in the colour of what it
 * is, and the four quick actions are tiles too.
 *
 * `solid` carries a white glyph, so each one is held at 3:1 or better against
 * white (WCAG 1.4.11 for a graphic that identifies something); `soft` is the
 * light-mode tile behind the solid colour used as ink, and is light enough for
 * that ink to keep 3:1 on it. src/__tests__/homeLikeTheReference.test.ts
 * measures every pair.
 */
export type Tile = { solid: string; soft: string };

export const TILE = {
  orange: { solid: '#C2410C', soft: '#FDEBDD' },
  plum: { solid: '#7E3AA8', soft: '#F1E6F8' },
  green: { solid: '#1F7A4D', soft: '#E1F2E8' },
  amber: { solid: '#A15C07', soft: '#FBEFD9' },
  blue: { solid: '#2F5FB3', soft: '#E3EBF8' },
  rose: { solid: '#B42E64', soft: '#FBE4EE' },
} as const satisfies Record<string, Tile>;

export const QUICK_TILE = {
  event: TILE.orange,
  chore: TILE.green,
  meal: TILE.rose,
  scan: TILE.blue,
} as const;

export type TileIconKey = 'calendar' | 'task' | 'sign' | 'rsvp' | 'school' | 'birthday' | 'travel' | 'imported';

/** What a card is, as a tile: the icon to draw and its colour. */
export function tileFor(card: { type: CardType; source?: string | null }): { icon: TileIconKey; tile: Tile } {
  if (card.source === 'CALENDAR') return { icon: 'imported', tile: TILE.blue };
  switch (card.type) {
    case 'APPOINTMENT': return { icon: 'calendar', tile: TILE.orange };
    case 'SIGN_SLIP': return { icon: 'sign', tile: TILE.plum };
    case 'RSVP': return { icon: 'rsvp', tile: TILE.rose };
    case 'SCHOOL': return { icon: 'school', tile: TILE.blue };
    case 'BIRTHDAY': return { icon: 'birthday', tile: TILE.amber };
    case 'VACATION': return { icon: 'travel', tile: TILE.blue };
    default: return { icon: 'task', tile: TILE.green };
  }
}
