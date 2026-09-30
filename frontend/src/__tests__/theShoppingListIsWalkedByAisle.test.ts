import * as fs from 'fs';
import * as path from 'path';
import { AISLE_ORDER, AISLE_EMOJI, aisleKey, groupByAisle, splitQuantity, whereItWent } from '../shoppingAisles';
import { TRANSLATIONS, SUPPORTED_LANGS } from '../i18n';

// Roland, 2026-09-30: every shopping item went onto one long list with no
// aisle. The server now sorts each item; the list shows aisles in the order a
// shop is walked, each one folding away, with the amount in its own tag.

describe('the shopping list, by aisle', () => {
  it('walks the shop in the same aisles the server sorts into', () => {
    const server = fs.readFileSync(path.join(__dirname, '../../../backend/shopping_aisles.py'), 'utf8');
    const block = /AISLES = \[([\s\S]*?)\]/.exec(server)![1];
    const serverAisles = block.match(/"([A-Za-z]+)"/g)!.map((s) => s.replace(/"/g, ''));
    expect([...AISLE_ORDER]).toEqual(serverAisles);
    expect(AISLE_ORDER[0]).toBe('Produce');
    expect(AISLE_ORDER[AISLE_ORDER.length - 1]).toBe('Other');
  });

  it('groups items by aisle in walking order, keeping their order inside', () => {
    const groups = groupByAisle([
      { name: 'toilet paper', category: 'Household' },
      { name: 'tomatoes', category: 'Produce' },
      { name: 'present', category: 'Other' },
      { name: 'washing liquid', category: 'Household' },
      { name: 'mystery', category: 'Groceries' },
    ]);
    expect(groups.map((g) => g.aisle)).toEqual(['Produce', 'Household', 'Other']);
    expect(groups[1].items.map((i) => i.name)).toEqual(['toilet paper', 'washing liquid']);
    // An aisle this build does not know goes under Other, never disappears.
    expect(groups[2].items.map((i) => i.name)).toEqual(['present', 'mystery']);
  });

  it('names and pictures every aisle in every app language', () => {
    for (const aisle of AISLE_ORDER) {
      expect(AISLE_EMOJI[aisle]).toBeTruthy();
      for (const lang of SUPPORTED_LANGS) {
        expect([lang, aisle, TRANSLATIONS[lang][aisleKey(aisle)]]).toEqual([lang, aisle, expect.any(String)]);
      }
    }
    for (const key of ['shop_aisle_pick', 'shop_aisle_pick_sub', 'shop_aisle_change', 'shop_aisle_moved', 'shop_aisle_failed']) {
      for (const lang of SUPPORTED_LANGS) expect([lang, key, typeof TRANSLATIONS[lang][key]]).toEqual([lang, key, 'string']);
    }
  });

  it('puts the amount in its own tag, and only a real trailing amount', () => {
    expect(splitQuantity('Tomatoes 400g')).toEqual({ label: 'Tomatoes', qty: '400g' });
    expect(splitQuantity('Milk x2')).toEqual({ label: 'Milk', qty: 'x2' });
    expect(splitQuantity('Rice 1.5 kg')).toEqual({ label: 'Rice', qty: '1.5 kg' });
    expect(splitQuantity('Bin bags 30')).toEqual({ label: 'Bin bags', qty: '30' });
    // Left exactly as typed:
    expect(splitQuantity('7up')).toEqual({ label: '7up', qty: null });
    expect(splitQuantity('Pack of 2')).toEqual({ label: 'Pack of 2', qty: null });
    expect(splitQuantity('Lot de 3')).toEqual({ label: 'Lot de 3', qty: null });
    expect(splitQuantity('Bread')).toEqual({ label: 'Bread', qty: null });
    expect(splitQuantity('')).toEqual({ label: '', qty: null });
  });
});

describe('saying where an added item went', () => {
  const t = (key: string, p: Record<string, string | number> = {}) => {
    const en: Record<string, string> = {
      shop_added_to_aisle: 'Added to {aisle}: {name}',
      shop_added_many: '{n} added: {where}',
      shopcat_produce: 'Fruit & veg', shopcat_household: 'Cleaning & household', shopcat_other: 'Other',
    };
    return (en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''));
  };

  it('names the aisle for one item, without its amount', () => {
    expect(whereItWent(t, [{ name: 'Tomatoes 400g', category: 'Produce' }]))
      .toBe('Added to Fruit & veg: Tomatoes');
  });

  it('counts several by aisle, in walking order', () => {
    expect(whereItWent(t, [
      { name: 'toilet paper', category: 'Household' },
      { name: 'tomatoes', category: 'Produce' },
      { name: 'washing liquid', category: 'Household' },
    ])).toBe('3 added: Fruit & veg (1) · Cleaning & household (2)');
  });

  it('says nothing, rather than break the add, when there is nothing to say', () => {
    expect(whereItWent(t, [])).toBeNull();
    expect(whereItWent(t, undefined)).toBeNull();
    expect(whereItWent(t, [undefined, null])).toBeNull();
  });

  it('is written in every app language', () => {
    for (const lang of SUPPORTED_LANGS) {
      for (const key of ['shop_added_to_aisle', 'shop_added_many']) {
        expect([lang, key, TRANSLATIONS[lang][key]]).toEqual([lang, key, expect.stringContaining('{')]);
      }
    }
  });
});
