/**
 * "À racheter bientôt": regular purchases due again, from receipts.
 *
 * The rhythm itself is worked out and tested on the server
 * (tests/test_due_to_rebuy.py). Here, the list's side: shown above the
 * regulars, three at most, and never for something already on the list.
 */
import fs from 'fs';
import path from 'path';
import { findNameMatch } from '../shopPrices';

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'kitchen.tsx'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '..', 'i18n.ts'), 'utf8');

describe('due again soon', () => {
  it('is left out when the list already has it, by the same name rule as prices', () => {
    // "Lait" on the list covers "Lait demi-écrémé" from the receipt.
    expect(findNameMatch('Lait', ['Lait demi-écrémé'])).not.toBeNull();
    expect(findNameMatch('Pain', ['Lait demi-écrémé'])).toBeNull();
    expect(src).toContain('!labels.some((l) => findNameMatch(l, [d.name]))');
  });

  it('shows three at most, above the regulars, and adds in one tap', () => {
    expect(src).toContain('.slice(0, 3);');
    expect(src.indexOf('testID="shop-due"')).toBeLessThan(src.indexOf('{!selectMode && regulars.length > 0 ? ('));
    expect(src).toContain('onPress={() => addDue(d.name)}');
  });

  it('is worded in all four languages', () => {
    for (const key of ['shop_due_title', 'shop_due_every_one', 'shop_due_every_n', 'shop_due_last_one', 'shop_due_last_n', 'shop_due_add']) {
      expect((i18n.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length).toBe(4);
    }
    expect(i18n).toContain('"À racheter bientôt"');
    // A daily purchase reads "tous les jours · dernier achat hier", not "~1 jours".
    expect(i18n).toContain('"tous les jours"');
    expect(src).toContain("d.every_days === 1 ? t('shop_due_every_one')");
  });

  it('a pack size in a receipt name is not read as a count in the total', () => {
    // "Oeufs x12" added from here is one box of twelve.
    expect(src).toContain('receiptNames.has(fold(i.name)) ? null : parseNeed(');
  });
});
