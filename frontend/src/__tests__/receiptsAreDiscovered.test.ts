/**
 * "Scannez vos tickets dans Dépenses": the one line that tells a family where
 * the list's prices, total and reminders come from, until they have any.
 *
 * The real browser check is scripts/e2e_shop_receipts.py; here, the rules.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'kitchen.tsx'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '..', 'i18n.ts'), 'utf8');

describe('the receipt hint on the list', () => {
  it('shows only once prices loaded and came back empty', () => {
    // null is a helper or a child (403) or a failed load: no hint for them.
    expect(src).toContain('!selectMode && !receiptHintOff && shopPrices && shopPrices.items.length === 0 ? (');
  });

  it('starts hidden, so it never flashes before the saved choice is read', () => {
    expect(src).toContain('const [receiptHintOff, setReceiptHintOff] = useState(true);');
    expect(src).toContain("setReceiptHintOff(v === '1')");
  });

  it('leads to Dépenses, where the scan button is, and can be closed for good', () => {
    expect(src).toContain("onPress={() => selectView('spend')}");
    expect(src).toContain("AsyncStorage.setItem(RECEIPT_HINT_KEY, '1')");
  });

  it('draws a receipt with lines, not lucide\'s "Receipt", which carries a dollar sign', () => {
    expect(src).toContain('<ReceiptText color={ui.orange} size={20} />');
    expect(src).not.toMatch(/[{,]\s*Receipt\s*[,}]/);
  });

  it('sits above the total, which takes its place once prices exist', () => {
    expect(src.indexOf('testID="shop-receipt-hint"')).toBeLessThan(src.indexOf('testID="shop-total"'));
  });

  it('is worded in all four languages and names the tab as the tab is named', () => {
    for (const key of ['shop_receipt_hint', 'shop_receipt_hint_go', 'shop_receipt_hint_close']) {
      expect((i18n.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length).toBe(4);
    }
    expect(i18n).toContain('"Scannez vos tickets dans Dépenses : les prix, le total et les rappels apparaîtront ici."');
    expect(i18n).toContain("kit_tab_spending: 'Dépenses'");
    expect(i18n).toContain('in Spending:');
    expect(i18n).toContain("kit_tab_spending: 'Spending'");
    expect(i18n).toContain('en Gastos:');
    expect(i18n).toContain('unter Ausgaben:');
  });
});
