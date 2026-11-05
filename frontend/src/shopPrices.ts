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
import { formatMoney } from './money';

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
/**
 * The receipt name that is the list item, or begins with it word for word
 * ("Sel" -> "Sel fin"). Exact names win; otherwise the first in order. The
 * one matching rule for prices and for receipts ticking the list.
 */
export function findNameMatch(
  label: string,
  names: string[],
): { index: number; exact: boolean } | null {
  const want = words(label);
  if (want.length === 0) return null;
  const wantKey = want.join(' ');
  let prefix = -1;
  for (let i = 0; i < names.length; i++) {
    const name = words(names[i]);
    if (name.join(' ') === wantKey) return { index: i, exact: true };
    if (prefix < 0 && name.length > want.length && want.every((w, j) => name[j] === w)) {
      prefix = i;
    }
  }
  return prefix >= 0 ? { index: prefix, exact: false } : null;
}

export function priceForItem(
  label: string,
  items: ShopPrice[],
): { price: ShopPrice; exact: boolean } | null {
  const hit = findNameMatch(label, items.map((i) => i.name));
  return hit ? { price: items[hit.index], exact: hit.exact } : null;
}

// Grams and millilitres are shown per kilo and per litre: a "500 g" line is
// 0,0035 €/g, which rounds to a meaningless "0,00 €/g".
const PER_UNIT: Record<string, { label: string; factor: number }> = {
  kg: { label: 'kg', factor: 1 },
  g: { label: 'kg', factor: 1000 },
  l: { label: 'L', factor: 1 },
  ml: { label: 'L', factor: 1000 },
};

/** "2,99 €/kg" for a weighed price, "0,89 €" for a piece or a whole line. */
export function priceLabel(amount: number, unit: string, perUnit: boolean, lang: string): string {
  const per = perUnit ? PER_UNIT[unit] : undefined;
  return per ? `${formatMoney(amount * per.factor, lang)}/${per.label}` : formatMoney(amount, lang);
}

/**
 * The price as the ticket shows it. A packet or a weighed line leads with what
 * that line cost, the figure printed on the receipt, and gives the price per
 * kilo or litre beside it: "2,40 € (0,27 €/L)", "3,69 € (2,99 €/kg)".
 */
export function receiptPrice(item: ShopPrice, lang: string): string {
  const per = priceLabel(item.price, item.unit, item.per_unit, lang);
  if (item.per_unit && item.line_total) return `${formatMoney(item.line_total, lang)} (${per})`;
  return per;
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
  return [receiptPrice(item, lang), item.shop, date]
    .filter(Boolean)
    .join(' · ');
}

/** One shop's part of the list, for the "By shop" view. */
export interface ShopGroup<T> {
  /** null: no receipt price yet, so it can be bought anywhere. */
  shop: string | null;
  items: { item: T; estimate: number | null; cheapest: boolean }[];
  /** Sum of the estimates that exist. */
  total: number;
  /** How many items have an estimate; the total is "about" only for those. */
  priced: number;
}

/**
 * What one thing on the list is likely to cost, and where.
 *
 * The shop is the cheapest one only when the server's comparison is sure;
 * otherwise the shop it was last bought at. The estimate is what was paid
 * last time, the line on the ticket; at a cheaper shop it is that shop's
 * usual price for the same amount. Nothing is invented: a weighed line with
 * no amount has no estimate.
 */
/**
 * How much of something the list asks for, when it says so plainly:
 * "Lait x6" is six, "Tomates 400g" is 0.4 kg, "Riz 1,5 kg" is 1.5 kg.
 * A bare number ("Sacs poubelle 30") is not read: it may be the pack size.
 */
export type Need = { count: number } | { amount: number; dim: 'kg' | 'l' };

const DIM: Record<string, { dim: 'kg' | 'l'; factor: number }> = {
  kg: { dim: 'kg', factor: 1 }, g: { dim: 'kg', factor: 0.001 },
  l: { dim: 'l', factor: 1 }, ml: { dim: 'l', factor: 0.001 }, cl: { dim: 'l', factor: 0.01 },
};

export function parseNeed(qty: string | null | undefined): Need | null {
  const text = (qty || '').trim().toLowerCase().replace(',', '.');
  const count = /^(?:[x×]\s?(\d+)|(\d+)\s?[x×])$/.exec(text);
  if (count) {
    const n = Number(count[1] ?? count[2]);
    return n >= 1 && n <= 50 ? { count: n } : null;
  }
  const weight = /^(\d+(?:\.\d+)?)\s?(kg|g|l|ml|cl)$/.exec(text);
  if (weight) {
    const unit = DIM[weight[2]];
    const amount = Number(weight[1]) * unit.factor;
    return amount > 0 ? { amount, dim: unit.dim } : null;
  }
  return null;
}

export function placeItem(
  p: ShopPrice,
  need?: Need | null,
): { shop: string; estimate: number | null; cheapest: boolean } {
  const sure = p.cheapest;
  const elsewhere = !!sure && sure.shop !== p.shop;
  const shop = sure ? sure.shop : p.shop;
  // The price per receipt unit at the shop the item goes to: the surely
  // cheaper shop's usual price, or the last line's own unit price.
  const perUnit = elsewhere
    ? sure!.shops.find((s) => s.shop === sure!.shop)?.unit_price ?? null
    : (p.qty != null ? p.price : null);
  const round = (n: number) => Math.round(n * 100) / 100;

  // The list says how much: priced for that much, when the units agree.
  if (need && perUnit != null) {
    if ('count' in need && p.unit === 'piece') {
      return { shop, estimate: round(perUnit * need.count), cheapest: !!sure };
    }
    const unit = DIM[p.unit];
    if ('amount' in need && unit && unit.dim === need.dim) {
      return { shop, estimate: round(perUnit * (need.amount / unit.factor)), cheapest: !!sure };
    }
  }
  // Otherwise the same amount as last time.
  if (!elsewhere) {
    return { shop, estimate: p.line_total ?? (p.per_unit ? null : p.price), cheapest: !!sure };
  }
  // A piece line with no count was one piece; a weighed line needs its weight.
  const amount = p.qty ?? (p.unit === 'piece' ? 1 : null);
  return { shop, estimate: perUnit != null && amount != null ? round(perUnit * amount) : null, cheapest: true };
}

/**
 * The list grouped by where to buy it. Busiest shop first; things with no
 * receipt price yet last, under "anywhere".
 */
export function groupByShop<T>(
  items: T[],
  labelOf: (item: T) => string,
  prices: ShopPrice[],
  needOf?: (item: T) => Need | null,
): ShopGroup<T>[] {
  const byShop = new Map<string | null, ShopGroup<T>>();
  for (const item of items) {
    const hit = priceForItem(labelOf(item), prices);
    const place = hit ? placeItem(hit.price, needOf?.(item)) : null;
    const key = place ? place.shop : null;
    let group = byShop.get(key);
    if (!group) {
      group = { shop: key, items: [], total: 0, priced: 0 };
      byShop.set(key, group);
    }
    const estimate = place ? place.estimate : null;
    group.items.push({ item, estimate, cheapest: !!place?.cheapest });
    if (estimate != null) {
      group.total = Math.round((group.total + estimate) * 100) / 100;
      group.priced += 1;
    }
  }
  return [...byShop.values()].sort((a, b) => {
    if (a.shop === null) return 1;
    if (b.shop === null) return -1;
    return b.items.length - a.items.length || a.shop.localeCompare(b.shop);
  });
}

/** What the whole list will roughly cost, and what has no price to count. */
export interface ListEstimate<T> {
  total: number;
  /** How many items the total covers. */
  priced: number;
  /** Items with no receipt price (or no estimate), in list order. */
  missing: T[];
}

/**
 * The list's rough cost: the shop groups' estimates, summed, so it always
 * equals the "By shop" totals. Only items with an estimate count; the rest are
 * returned, in list order, so the screen can name them.
 */
export function estimateFromGroups<T>(groups: ShopGroup<T>[], items: T[]): ListEstimate<T> {
  let total = 0;
  let priced = 0;
  const unpriced = new Set<T>();
  for (const group of groups) {
    for (const { item, estimate } of group.items) {
      if (estimate == null) {
        unpriced.add(item);
      } else {
        total = Math.round((total + estimate) * 100) / 100;
        priced += 1;
      }
    }
  }
  return { total, priced, missing: items.filter((i) => unpriced.has(i)) };
}

export function estimateList<T>(
  items: T[],
  labelOf: (item: T) => string,
  prices: ShopPrice[],
  needOf?: (item: T) => Need | null,
): ListEstimate<T> {
  return estimateFromGroups(groupByShop(items, labelOf, prices, needOf), items);
}
