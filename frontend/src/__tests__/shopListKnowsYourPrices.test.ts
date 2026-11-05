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
    expect(src).toContain('shop-price-${item.item_id}');
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
