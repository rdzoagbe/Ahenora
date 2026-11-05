/**
 * A scanned receipt ticks things off the shopping list.
 *
 * Every rule here leans towards ticking less: a wrong tick hides something
 * still to buy, which is worse than a tick left to do by hand.
 */
import fs from 'fs';
import path from 'path';
import type { ShoppingItem } from '../api';
import { matchReceiptToList } from '../receiptTicks';

const item = (name: string, extra: Partial<ShoppingItem> = {}): ShoppingItem => ({
  item_id: `id-${name}`, family_id: 'f', name, category: 'Other', checked: false,
  added_by: 'Roland', created_at: '2026-11-05T08:00:00Z', ...extra,
});
const line = (name: string, unsure = false) => ({ name, unsure });

const LIST = [item('Sel'), item('Tomates'), item('Lait'), item('Gingembre'), item('Persil')];
const TICKET = [line('Sel fin'), line('Tomates grappe'), line('Lait demi-écrémé'), line('Pâtes 500 g')];

describe('what a receipt ticks on the list', () => {
  it('ticks the items whose name starts a receipt line, word for word', () => {
    const got = matchReceiptToList(TICKET, LIST).map((m) => [m.item.name, m.line]);
    expect(got).toEqual([
      ['Sel', 'Sel fin'],
      ['Tomates', 'Tomates grappe'],
      ['Lait', 'Lait demi-écrémé'],
    ]);
  });

  it('never matches inside a word ("Sel" is not "Persil")', () => {
    expect(matchReceiptToList([line('Persil plat')], [item('Sel')])).toEqual([]);
  });

  it('never ticks from a line the scanner was unsure of', () => {
    expect(matchReceiptToList([line('Sel fin', true)], [item('Sel')])).toEqual([]);
  });

  it('leaves items already ticked alone', () => {
    expect(matchReceiptToList(TICKET, [item('Sel', { checked: true })])).toEqual([]);
  });

  it('one receipt line ticks one item', () => {
    const got = matchReceiptToList([line('Lait demi-écrémé')], [item('Lait'), item('Lait', { item_id: 'id-2' })]);
    expect(got).toHaveLength(1);
  });

  it('a quantity on the list does not stop the match ("Tomates x2")', () => {
    expect(matchReceiptToList([line('Tomates grappe')], [item('Tomates x2')])).toHaveLength(1);
  });

  it('accents and case do not matter', () => {
    expect(matchReceiptToList([line('PATES 500 G')], [item('Pâtes')])).toHaveLength(1);
  });
});

describe('the receipt review', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'SpendingView.tsx'), 'utf8');
  it('shows the matches before saving, each untickable', () => {
    expect(src).toContain('testID="exp-tick-box"');
    expect(src).toContain('accessibilityRole="checkbox"');
  });
  it('ticks only after the expense is saved, with the shop, and offers to undo', () => {
    const save = src.indexOf('await api.addExpense(');
    const tick = src.indexOf('ticked_from: shopName');
    expect(save).toBeGreaterThan(0);
    expect(tick).toBeGreaterThan(save);
    expect(src).toContain('testID="exp-ticked-undo"');
    expect(src).toContain('{ checked: false }');
  });
});
