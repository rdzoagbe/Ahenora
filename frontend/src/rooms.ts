import { Room } from './api';

/**
 * The rooms a card can belong to, in the order they are offered.
 *
 * One list, mirroring ROOM_VALUES on the server. It lived inside AddCardModal
 * first, which was fine until the Feed needed the same order to lay out its
 * filter — and two copies of a vocabulary drift, quietly, in the direction of
 * one screen offering a room another screen cannot display.
 *
 * Ordered roughly by how much of a household's work happens there rather than
 * alphabetically, because this is a row of chips somebody reads left to right,
 * not an index.
 */
export const ROOMS: Room[] = [
  'kitchen', 'living', 'dining', 'bathroom', 'bedroom',
  'kids', 'utility', 'hallway', 'garden', 'garage',
];

/** The rooms actually in use across these cards, in ROOMS order. */
export function roomsInUse(cards: { room?: string | null }[]): Room[] {
  const seen = new Set(cards.map((c) => (c.room || '')).filter(Boolean));
  return ROOMS.filter((r) => seen.has(r));
}

/**
 * The room filter that should still be in force, given the rooms on offer.
 *
 * The filter row only appears once at least two rooms are in play, so ticking
 * off the last bathroom job takes the row away — and with it the only control
 * that could clear a "bathroom" filter. What is left is an empty list with no
 * visible reason and no way out, which reads as the app having broken.
 *
 * So a filter that is no longer offered is no longer a filter.
 */
export function keepRoomFilter(filter: Room | '', rooms: Room[]): Room | '' {
  if (!filter) return '';
  return rooms.includes(filter) ? filter : '';
}

/**
 * Whether the filter row is worth its place at the top of the Feed.
 *
 * One room is not a choice, and the Feed lost its Today/Upcoming/All tabs
 * precisely because a control costing 50px on the most-visited screen has to
 * earn the space every time it is drawn.
 */
export function roomFilterWorthShowing(rooms: Room[]): boolean {
  return rooms.length > 1;
}
