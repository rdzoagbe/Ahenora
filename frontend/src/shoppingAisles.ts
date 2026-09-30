/**
 * The shopping list, walked in aisle order.
 *
 * Roland, 2026-09-30: every item went onto one long list with no aisle. The
 * server now sorts each item into an aisle (see backend/shopping_aisles.py);
 * this puts the list in the order a shop is walked, fresh food first, so the
 * list reads top to bottom the way the trolley moves. "Other" is always last.
 *
 * Must list the same aisles as the backend's SHOPPING_CATEGORIES.
 */
export const AISLE_ORDER = [
  'Produce', 'Bakery', 'Meat', 'Dairy', 'Frozen', 'Pantry', 'Snacks',
  'Drinks', 'Household', 'Health', 'Baby', 'School', 'Other',
] as const;

export type Aisle = (typeof AISLE_ORDER)[number];

export const isAisle = (value: string | null | undefined): value is Aisle =>
  !!value && (AISLE_ORDER as readonly string[]).includes(value);

/** The translation key for an aisle's name. */
export const aisleKey = (aisle: string): string =>
  'shopcat_' + (isAisle(aisle) ? aisle : 'Other').toLowerCase();

/**
 * Items grouped by aisle, in walking order, each group keeping the order it was
 * given (newest first, as the server sends them). Empty aisles are left out, and
 * anything carrying an aisle this build does not know goes under "Other" rather
 * than disappearing.
 */
export function groupByAisle<T extends { category?: string | null }>(items: T[]): { aisle: Aisle; items: T[] }[] {
  const groups = new Map<Aisle, T[]>();
  for (const item of items) {
    const aisle: Aisle = isAisle(item.category) ? item.category : 'Other';
    const list = groups.get(aisle);
    if (list) list.push(item);
    else groups.set(aisle, [item]);
  }
  return AISLE_ORDER.filter((a) => groups.has(a)).map((aisle) => ({ aisle, items: groups.get(aisle)! }));
}

/** A picture for each aisle, so the list can be scanned without reading. */
export const AISLE_EMOJI: Record<Aisle, string> = {
  Produce: '🍎', Bakery: '🥖', Meat: '🥩', Dairy: '🧀', Frozen: '🧊', Pantry: '🥫',
  Snacks: '🍫', Drinks: '🧃', Household: '🧽', Health: '💊', Baby: '🍼',
  School: '✏️', Other: '🛒',
};

const JOINING_WORDS = new Set(['of', 'de', 'du', 'des', 'd', 'for', 'pour', 'à', 'a', 'x', 'von', 'für', 'para', 'con', 'with', 'avec', 'mit']);

// "400g", "1.5 kg", "x2", "2x", "12", "3 pcs" at the END of a name.
const TRAILING_QTY = /^(.*\S)[\s,]+((?:x\s?\d+(?:[.,]\d+)?)|(?:\d+(?:[.,]\d+)?\s?(?:x|g|kg|mg|ml|cl|dl|l|lb|lbs|oz|pcs?|pieces?|pack|packs|pk)?))$/i;

/**
 * The name and the amount of a list item, apart, so the amount can sit in its
 * own tag at the end of the row ("Tomatoes" · "400g"). Only a trailing amount
 * is taken off, and never the whole name: "7up" and "Pack of 2" stay as typed.
 */
export function splitQuantity(name: string): { label: string; qty: string | null } {
  const text = (name || '').trim();
  const m = TRAILING_QTY.exec(text);
  if (!m || !/[a-z]/i.test(m[1])) return { label: text, qty: null };
  // "Pack of 2", "Lot de 3", "Paquete de 4": the number belongs to the words.
  const lastWord = m[1].trim().split(/\s+/).pop()!.toLowerCase();
  if (JOINING_WORDS.has(lastWord)) return { label: text, qty: null };
  return { label: m[1].replace(/[\s,:-]+$/, ''), qty: m[2].replace(/\s+/g, ' ') };
}
