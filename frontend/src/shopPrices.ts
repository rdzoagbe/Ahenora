/**
 * Price hints on the shopping list, from the household's own receipts.
 *
 * Two places use this: the "From your receipts" suggestions under the add box
 * while typing, and the small grey line under each thing on the list. Both are
 * deliberately conservative. A hint that names the wrong product or the wrong
 * shop is worse than no hint, because the family acts on it before leaving the
 * house. So:
 *
 *   - a row only gets a price when the receipt name IS the item, or starts with
 *     it word for word; when it is not the exact same name, the receipt's own
 *     name is shown in front of the price so nobody mistakes whose price it is;
 *   - one receipt is labelled "seen once", never presented as a habit;
 *   - "cheapest" comes only from the server's comparison, which already insists
 *     on the same unit and several visits at each shop.
 */
import type { ShopPrice } from './api';

/** Lower case, no accents, single spaces: "Pâtes  Bio" -> "pates bio". */
export function fold(text: string): string {
  return (text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "tomates" and "tomate" are the same thing on a list; plural s/x dropped. */
function stem(word: string): string {
  return word.length > 3 ? word.replace(/[sx]$/, '') : word;
}

// Folding is a normalize plus three regexes, and the list asks for the same
// few hundred receipt names on every keystroke. Remember them; cleared
// wholesale so typed queries cannot grow it without bound.
const RAW = new Map<string, string[]>();
function rawWords(text: string): string[] {
  let out = RAW.get(text);
  if (!out) {
    if (RAW.size > 2000) RAW.clear();
    out = fold(text).split(' ').filter(Boolean);
    RAW.set(text, out);
  }
  return out;
}

/** Folded, plural-stripped words: for comparing whole names. */
function words(text: string): string[] {
  return rawWords(text).map(stem);
}

/**
 * A typed line split into items: "lait, oeufs; pain" -> three. A comma
 * between two digits is a decimal ("Volvic 6 x 1,5 L"), not a separator.
 */
export function splitTyped(text: string): string[] {
  return (text || '')
    .replace(/(\d),(?=\d)/g, '$1\u0000')
    .split(/[,;\n]/)
    .map((part) => part.replace(/\u0000/g, ','));
}

/** Most recent first, one per product name (the server already sorts newest first). */
function newestPerName(items: ShopPrice[]): ShopPrice[] {
  const seen = new Set<string>();
  const out: ShopPrice[] = [];
  for (const item of items) {
    const key = fold(item.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export const SUGGESTIONS_SHOWN = 3;

/**
 * Receipt products for what is being typed. Every typed word must start a
 * word of the product's name: "sel" finds "Sel fin" and "Sel de Guérande",
 * never "Persil". Things already on the list are left out. Names starting with the typed text
 * come first; otherwise newest first.
 */
export function suggestFromReceipts(
  query: string,
  items: ShopPrice[],
  alreadyOnList: string[],
  limit = SUGGESTIONS_SHOWN,
): ShopPrice[] {
  // Only the part being typed now: "lait, sel" suggests for "sel".
  const current = splitTyped(query).pop() ?? '';
  // Typed words are matched UNSTEMMED: the word is half-typed, and dropping a
  // final s would turn "pois" into "poi" and offer "Poivre".
  const typed = rawWords(current);
  if (typed.length === 0 || fold(current).length < 2) return [];
  const onList = new Set(alreadyOnList.map((n) => words(n).join(' ')));
  const typedFold = typed.join(' ');

  const matches = newestPerName(items).filter((item) => {
    if (onList.has(words(item.name).join(' '))) return false;
    const name = rawWords(item.name);
    return typed.every((w) => name.some((n) => n.startsWith(w) || stem(n) === stem(w)));
  });
  const starts = matches.filter((m) => rawWords(m.name).join(' ').startsWith(typedFold));
  const rest = matches.filter((m) => !starts.includes(m));
  return [...starts, ...rest].slice(0, limit);
}

/**
 * The receipt price for a thing on the list, or null. The receipt name must be
 * the item's name, or begin with it word for word ("Sel" -> "Sel fin"). Exact
 * names win; otherwise the newest receipt.
 */
export function priceForItem(
  label: string,
  items: ShopPrice[],
): { price: ShopPrice; exact: boolean } | null {
  const want = words(label);
  if (want.length === 0) return null;
  const wantKey = want.join(' ');
  let prefix: ShopPrice | null = null;
  for (const item of items) {
    const name = words(item.name);
    const key = name.join(' ');
    if (key === wantKey) return { price: item, exact: true };
    if (!prefix && name.length > want.length && want.every((w, i) => name[i] === w)) {
      prefix = item;
    }
  }
  return prefix ? { price: prefix, exact: false } : null;
}

/** "0,89 €" in French, Spanish and German; "€0.89" in English. */
export function money(amount: number, lang: string): string {
  const fixed = amount.toFixed(2);
  return lang === 'en' ? `€${fixed}` : `${fixed.replace('.', ',')} €`;
}

const UNIT_LABEL: Record<string, string> = { kg: 'kg', g: 'g', l: 'L', ml: 'mL' };

/** "2,99 €/kg" for a weighed price, "0,89 €" for a piece or a whole line. */
export function priceLabel(amount: number, unit: string, perUnit: boolean, lang: string): string {
  const base = money(amount, lang);
  return perUnit && UNIT_LABEL[unit] ? `${base}/${UNIT_LABEL[unit]}` : base;
}

type T = (key: string, vars?: Record<string, string | number>) => string;

/** "today", "5 days ago", "2 weeks ago", "1 month ago". */
export function whenLabel(iso: string, t: T, now: Date = new Date()): string {
  // The receipt's own calendar date against today's local date. Subtracting
  // instants instead made a receipt from today read "yesterday" in the
  // evening anywhere west of UTC, because the date is stored as UTC midnight.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  if (!m) return '';
  const then = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // Rounded, not floored: a daylight-saving change makes a day 23 or 25 hours.
  const days = Math.max(0, Math.round((today.getTime() - then.getTime()) / 86_400_000));
  if (days === 0) return t('shop_price_today');
  if (days === 1) return t('shop_price_yesterday');
  if (days < 14) return t('shop_price_days_ago', { n: days });
  if (days < 60) return t('shop_price_weeks_ago', { n: Math.floor(days / 7) });
  const months = Math.floor(days / 30);
  return t(months === 1 ? 'shop_price_month_ago' : 'shop_price_months_ago', { n: months });
}

/** "0,89 € · Carrefour · il y a 2 semaines" (with "seen once" for one receipt). */
export function lastPriceLine(item: ShopPrice, t: T, lang: string, now?: Date): string {
  const when = whenLabel(item.last_seen, t, now);
  const date = item.seen === 1 ? t('shop_price_seen_once', { when }) : when;
  return [priceLabel(item.price, item.unit, item.per_unit, lang), item.shop, date]
    .filter(Boolean)
    .join(' · ');
}
