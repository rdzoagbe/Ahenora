/**
 * Which things on the shopping list a scanned receipt shows were bought.
 *
 * Shown to the parent on the receipt review, each one untickable, before
 * anything is changed. Conservative on purpose: a wrong tick hides something
 * still to buy, which is worse than a tick left to do by hand. So:
 *   - only items still to buy on the list, and only lines the parent kept;
 *   - never a line the scanner marked unsure;
 *   - the receipt line must be the item's name or start with it word for word
 *     (the same rule as the prices: "Sel" matches "Sel fin", never "Persil");
 *   - each receipt line ticks at most one item.
 */
import type { ShoppingItem } from './api';
import { splitQuantity } from './shoppingAisles';
import { findNameMatch } from './shopPrices';

export interface ReceiptLine { name: string; unsure?: boolean }

export interface ReceiptTick {
  item: ShoppingItem;
  /** The receipt line that shows it was bought, as printed. */
  line: string;
}

export function matchReceiptToList(lines: ReceiptLine[], items: ShoppingItem[]): ReceiptTick[] {
  const usable = lines.filter((l) => !l.unsure && l.name.trim());
  const used = new Set<number>();
  const out: ReceiptTick[] = [];
  for (const item of items) {
    if (item.checked) continue;
    const label = splitQuantity(item.name).label;
    // Lines already used are hidden from the match by blanking them.
    const names = usable.map((l, i) => (used.has(i) ? '' : l.name));
    const hit = findNameMatch(label, names);
    if (!hit) continue;
    used.add(hit.index);
    out.push({ item, line: usable[hit.index].name });
  }
  return out;
}
