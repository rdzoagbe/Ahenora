/**
 * The shopping list's price hints, from the family's own receipts.
 *
 * Each test is about the hint never saying more than the receipts do: it must
 * not attach "Persil" to "sel", must not present one receipt as a habit, and
 * must say whose price it is when the receipt name is longer than the item.
 */
import fs from 'fs';
import path from 'path';
import type { ShopPrice } from '../api';
import {
  fold, suggestFromReceipts, priceForItem, priceLabel, lastPriceLine, whenLabel, splitTyped,
  groupByShop, placeItem, estimateList, parseNeed,
} from '../shopPrices';

const NOW = new Date('2026-11-04T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function p(name: string, extra: Partial<ShopPrice> = {}): ShopPrice {
  return {
    name, name_key: name.toLowerCase(), unit: 'piece', price: 1, per_unit: false,
    line_total: 1, qty: 1,
    shop: 'Carrefour', last_seen: daysAgo(14), seen: 2, cheapest: null, ...extra,
  };
}

const FR: Record<string, string> = {
  shop_price_today: 'aujourd’hui',
  shop_price_yesterday: 'hier',
  shop_price_days_ago: 'il y a {n} jours',
  shop_price_weeks_ago: 'il y a {n} semaines',
  shop_price_month_ago: 'il y a 1 mois',
  shop_price_months_ago: 'il y a {n} mois',
  shop_price_seen_once: 'vu une fois, {when}',
};
const t = (key: string, vars: Record<string, string | number> = {}) =>
  (FR[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));

const RECEIPTS = [
  p('Sel fin', { price: 0.89 }),
  p('Persil'),
  p('Sel de Guérande', { price: 2.15, shop: 'Marché Frais', last_seen: daysAgo(31) }),
  p('Tomates', { unit: 'kg', price: 2.99, per_unit: true, line_total: 3.69, qty: 1.234, shop: 'Lidl', seen: 1, last_seen: daysAgo(42) }),
];

describe('suggestions while typing', () => {
  it('finds products whose words start with what is typed, never inside a word', () => {
    const names = suggestFromReceipts('sel', RECEIPTS, []).map((s) => s.name);
    expect(names).toEqual(['Sel fin', 'Sel de Guérande']);
  });

  it('ignores accents and case', () => {
    expect(suggestFromReceipts('GUERANDE', RECEIPTS, []).map((s) => s.name)).toEqual(['Sel de Guérande']);
  });

  it('leaves out what is already on the list', () => {
    expect(suggestFromReceipts('sel', RECEIPTS, ['sel fin']).map((s) => s.name)).toEqual(['Sel de Guérande']);
  });

  it('suggests for the word after the last comma only', () => {
    expect(suggestFromReceipts('lait, tom', RECEIPTS, []).map((s) => s.name)).toEqual(['Tomates']);
  });

  it('a half-typed word is not stemmed: "pois" never offers "Poivre"', () => {
    const list = [p('Poivre noir'), p('Petits pois')];
    expect(suggestFromReceipts('pois', list, []).map((s) => s.name)).toEqual(['Petits pois']);
  });

  it('a decimal comma does not start a new item', () => {
    expect(suggestFromReceipts('volvic 6 x 1,5', [p('Volvic 6 x 1,5 L')], []).map((s) => s.name))
      .toEqual(['Volvic 6 x 1,5 L']);
  });

  it('says nothing for a single letter', () => {
    expect(suggestFromReceipts('s', RECEIPTS, [])).toEqual([]);
  });

  it('shows at most three', () => {
    const many = ['Sel a', 'Sel b', 'Sel c', 'Sel d'].map((n) => p(n));
    expect(suggestFromReceipts('sel', many, [])).toHaveLength(3);
  });
});

describe('the price under a list item', () => {
  it('an exact name wins', () => {
    const hit = priceForItem('Tomate', RECEIPTS);
    expect(hit?.exact).toBe(true);
    expect(hit?.price.name).toBe('Tomates');
  });

  it('a longer receipt name only when it starts with the item word for word', () => {
    const hit = priceForItem('sel', RECEIPTS);
    expect(hit?.exact).toBe(false);
    expect(hit?.price.name).toBe('Sel fin');
    expect(priceForItem('pers', RECEIPTS)).toBeNull();
    expect(priceForItem('Ginger', RECEIPTS)).toBeNull();
  });
});

describe('how a price reads', () => {
  it('French and English money', () => {
    expect(priceLabel(0.89, 'piece', false, 'fr')).toBe('0,89 €');
    expect(priceLabel(2.99, 'kg', true, 'fr')).toBe('2,99 €/kg');
    expect(priceLabel(0.27, 'l', true, 'en')).toBe('€0.27/L');
  });

  it('grams and millilitres read per kilo and per litre, never 0,00 €/g', () => {
    expect(priceLabel(0.0035, 'g', true, 'fr')).toBe('3,50 €/kg');
    expect(priceLabel(0.0012, 'ml', true, 'fr')).toBe('1,20 €/L');
  });

  it('leads with the price printed on the ticket', () => {
    const pasta = p('Pâtes 500 g', { unit: 'g', price: 0.0035, per_unit: true, line_total: 1.75, qty: 500 });
    expect(lastPriceLine(pasta, t, 'fr', NOW)).toBe('1,75 € (3,50 €/kg) · Carrefour · il y a 2 semaines');
    const water = p('Volvic', { unit: 'l', price: 2.4 / 9, per_unit: true, line_total: 2.4, qty: 9 });
    expect(lastPriceLine(water, t, 'fr', NOW)).toBe('2,40 € (0,27 €/L) · Carrefour · il y a 2 semaines');
  });

  it('one receipt says so, with its date', () => {
    expect(lastPriceLine(RECEIPTS[3], t, 'fr', NOW)).toBe('3,69 € (2,99 €/kg) · Lidl · vu une fois, il y a 6 semaines');
    expect(lastPriceLine(RECEIPTS[0], t, 'fr', NOW)).toBe('0,89 € · Carrefour · il y a 2 semaines');
  });

  it('dates', () => {
    expect(whenLabel(daysAgo(0), t, NOW)).toBe('aujourd’hui');
    expect(whenLabel(daysAgo(5), t, NOW)).toBe('il y a 5 jours');
    expect(whenLabel(daysAgo(31), t, NOW)).toBe('il y a 4 semaines');
    expect(whenLabel(daysAgo(65), t, NOW)).toBe('il y a 2 mois');
  });

  it('a receipt from today is "today" whatever the hour or time zone', () => {
    const lateEvening = new Date(2026, 10, 4, 23, 30);
    expect(whenLabel('2026-11-04T00:00:00+00:00', t, lateEvening)).toBe('aujourd’hui');
    expect(whenLabel('2026-11-03T00:00:00+00:00', t, lateEvening)).toBe('hier');
  });

  it('splits typed items, keeping decimal commas', () => {
    expect(splitTyped('lait, Volvic 6 x 1,5 L; pain')).toEqual(['lait', ' Volvic 6 x 1,5 L', ' pain']);
    expect(splitTyped('lait,oeufs')).toEqual(['lait', 'oeufs']);
  });

  it('fold', () => {
    expect(fold('  Pâtes  Bio ')).toBe('pates bio');
  });
});

describe('the list page uses it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'kitchen.tsx'), 'utf8');
  it('loads the receipt prices and shows both pieces', () => {
    expect(src).toContain('api.getShopPrices()');
    expect(src).toContain('testID="shop-suggest-panel"');
    expect(src).toContain('testID="shop-add-typed"');
    expect(src).toContain('{priceLine(label, item.item_id)}');
    expect(src).toContain("prefix = 'shop-price'");
  });
});

describe('picking a suggestion', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'kitchen.tsx'), 'utf8');
  it('adds the product name whole, even with a comma in it ("Volvic 6 x 1,5 L")', () => {
    // Passed as a list, never re-joined with commas and split again.
    expect(src).toContain('addShopItem(parts);');
    expect(src).not.toContain("addShopItem(parts.join(','))");
  });
});

describe('the list by shop', () => {
  const sure = (shop: string, against: string, a: number, b: number) => ({
    shop, saving: b - a, against,
    shops: [{ shop, unit_price: a, visits: 2 }, { shop: against, unit_price: b, visits: 2 }],
  });

  it('goes to the cheapest shop only when the comparison is sure, else where it was last bought', () => {
    expect(placeItem(p('Sel fin', { price: 0.89, line_total: 0.89, shop: 'Carrefour' })))
      .toEqual({ shop: 'Carrefour', estimate: 0.89, cheapest: false });
    const carrots = p('Carottes', {
      unit: 'kg', per_unit: true, price: 1.59, line_total: 1.59, qty: 1, shop: 'Carrefour',
      cheapest: sure('Marché Frais', 'Carrefour', 1.29, 1.54),
    });
    // Last bought at Carrefour, but Marché Frais is surely cheaper: the same
    // kilo at Marché Frais' usual price.
    expect(placeItem(carrots)).toEqual({ shop: 'Marché Frais', estimate: 1.29, cheapest: true });
  });

  it('never invents an estimate: a weighed line with no weight has none', () => {
    const apples = p('Pommes', {
      unit: 'kg', per_unit: true, price: 2.1, line_total: null, qty: null, shop: 'Lidl',
      cheapest: sure('Aldi', 'Lidl', 1.9, 2.1),
    });
    expect(placeItem(apples).estimate).toBeNull();
  });

  it('groups, totals what it can, busiest shop first, unknown prices last', () => {
    const prices = [
      p('Sel fin', { price: 0.89, line_total: 0.89, shop: 'Carrefour' }),
      p('Oignons', { unit: 'kg', per_unit: true, price: 1.49, line_total: 2.24, qty: 1.5, shop: 'Carrefour' }),
      p('Volvic', { unit: 'l', per_unit: true, price: 0.2667, line_total: 2.4, qty: 9, shop: 'Marché Frais' }),
    ];
    const groups = groupByShop(['Sel', 'Oignons', 'Volvic', 'Gingembre'], (x) => x, prices);
    expect(groups.map((g) => g.shop)).toEqual(['Carrefour', 'Marché Frais', null]);
    expect(groups[0].total).toBeCloseTo(3.13);
    expect(groups[0].priced).toBe(2);
    expect(groups[2].items.map((i) => i.item)).toEqual(['Gingembre']);
    expect(groups[2].priced).toBe(0);
  });
});

describe('both views show the prices', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'kitchen.tsx'), 'utf8');
  it('offers the by-shop switch and prices the Repas preview', () => {
    expect(src).toContain('testID={`shop-view-${v}`}');
    expect(src).toContain("priceLine(label, item.item_id, 'kitchen-buy-price', true)");
  });
});

describe('the cheapest shop says by how much', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'kitchen.tsx'), 'utf8');
  const i18n = fs.readFileSync(path.join(__dirname, '..', 'i18n.ts'), 'utf8');
  it('the row uses the saving wording, from the comparison itself', () => {
    expect(src).toContain("t('shop_price_cheapest_by', { amount: priceLabel(p.cheapest.saving");
  });
  it('in all four languages', () => {
    expect((i18n.match(/^\s*shop_price_cheapest_by:/gm) || []).length).toBe(4);
    expect(i18n).toContain('"le moins cher, {amount} de moins"');
  });
});

describe('what the list will roughly cost', () => {
  const prices = [
    p('Sel fin', { price: 0.89, line_total: 0.89, shop: 'Carrefour' }),
    p('Oignons', { unit: 'kg', per_unit: true, price: 1.49, line_total: 2.24, qty: 1.5, shop: 'Carrefour' }),
    p('Pommes', { unit: 'kg', per_unit: true, price: 2.1, line_total: null, qty: null, shop: 'Lidl' }),
  ];

  it('sums the same estimates as By shop, and names what it could not count', () => {
    const out = estimateList(['Gingembre', 'Sel', 'Oignons', 'Pommes'], (x) => x, prices);
    expect(out.total).toBeCloseTo(3.13);
    expect(out.priced).toBe(2);
    // Ginger has no receipt; apples were weighed with no weight: no guess.
    expect(out.missing).toEqual(['Gingembre', 'Pommes']);
  });

  it('nothing priced, nothing counted', () => {
    expect(estimateList(['Gingembre'], (x) => x, prices)).toEqual({ total: 0, priced: 0, missing: ['Gingembre'] });
  });

  it('the list shows it only when something is priced, and names at most three missing', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'kitchen.tsx'), 'utf8');
    expect(src).toContain('listEstimate && listEstimate.priced > 0 ?');
    expect(src).toContain('listEstimate.missing.slice(0, 3)');
    // One grouping for the shop sections and the total, so they agree.
    expect(src).toContain('estimateFromGroups(shopGroups, uncheckedItems)');
  });

  it('reads a quantity only when the list says it plainly', () => {
    expect(parseNeed('x6')).toEqual({ count: 6 });
    expect(parseNeed('2x')).toEqual({ count: 2 });
    expect(parseNeed('400g')).toEqual({ amount: 0.4, dim: 'kg' });
    expect(parseNeed('1,5 kg')).toEqual({ amount: 1.5, dim: 'kg' });
    expect(parseNeed('75 cl')).toEqual({ amount: 0.75, dim: 'l' });
    // A bare number may be the pack size ("Sacs poubelle 30"): not read.
    expect(parseNeed('30')).toBeNull();
    expect(parseNeed(null)).toBeNull();
  });

  it('prices that quantity when the units agree', () => {
    const milk = p('Lait', { price: 1.15, line_total: 1.15, qty: 1 });
    expect(placeItem(milk, { count: 6 }).estimate).toBeCloseTo(6.9);
    const tomatoes = p('Tomates', { unit: 'kg', per_unit: true, price: 2.99, line_total: 3.69, qty: 1.234 });
    expect(placeItem(tomatoes, { amount: 0.4, dim: 'kg' }).estimate).toBeCloseTo(1.2);
    // Grams on the receipt, kilos on the list.
    const pasta = p('Pâtes', { unit: 'g', per_unit: true, price: 0.0035, line_total: 1.75, qty: 500 });
    expect(placeItem(pasta, { amount: 1, dim: 'kg' }).estimate).toBeCloseTo(3.5);
    // Units that do not agree: last time's amount, as before.
    expect(placeItem(tomatoes, { count: 3 }).estimate).toBeCloseTo(3.69);
  });

  it('a quantity follows the item into the total', () => {
    const out = estimateList(['Lait x6', 'Sel'], (x) => x.replace(/ x6$/, ''),
      [p('Lait', { price: 1.15, line_total: 1.15, qty: 1 }), p('Sel fin', { price: 0.89, line_total: 0.89 })],
      (x) => parseNeed(x.endsWith('x6') ? 'x6' : null));
    expect(out.total).toBeCloseTo(7.79);
  });
});
