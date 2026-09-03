/**
 * App Store guideline 3.1.2 requires the paywall itself — not Settings, not the
 * website — to show the title, length and price of each auto-renewing
 * subscription plus links to the Terms of Use and the privacy policy. Ahenora's
 * paywall shipped to review with the price and length but no legal links, which
 * is a rejection on its own. These are source-level checks because the rule is
 * about what the screen is REQUIRED to contain; it must survive refactors.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(
  join(__dirname, '..', 'components', 'PricingView.tsx'), 'utf8');
const I18N = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');

describe('paywall legal disclosure', () => {
  it('links out to the Terms of Use and the privacy policy', () => {
    expect(SOURCE).toContain("https://ahenora.com/terms.html");
    expect(SOURCE).toContain("https://ahenora.com/privacy.html");
    expect(SOURCE).toContain('Linking.openURL(TERMS_URL)');
    expect(SOURCE).toContain('Linking.openURL(PRIVACY_URL)');
  });

  it('states that the subscription renews automatically', () => {
    expect(SOURCE).toContain("t('pricing_autorenew_note')");
  });

  it('shows the billing period next to the price', () => {
    // Monthly reads "/month", yearly reads "/year". Both are the length.
    expect(SOURCE).toContain("t('pricing_per_month')");
    expect(SOURCE).toContain("t('pricing_per_year')");
  });

  it('makes the BILLED amount the headline, not a calculated monthly figure', () => {
    // Guideline 3.1.2(c), and the reason 1.1.0 was rejected: the yearly card
    // led with price/12 at 44px and put the actual charge underneath at 11px.
    // A calculated figure larger than the real one is the charge being made
    // less conspicuous than the estimate, which is exactly what the rule
    // forbids. This test replaced one that asserted the rejected layout.
    expect(SOURCE).toContain('const priceDisplay = price;');
    expect(SOURCE).not.toContain("const priceDisplay = cycle === 'yearly' ? perMonth : price;");
  });

  it('keeps the per-month equivalent subordinate in size', () => {
    // Apple names size explicitly, so measure it rather than trust the markup:
    // whatever renders the headline must be larger than the note carrying the
    // monthly equivalent. Sizes are read out of the stylesheet.
    const sizeOf = (name: string) => {
      const block = SOURCE.match(new RegExp(`${name}:\\s*\\{[^}]*\\}`));
      expect(block).toBeTruthy();
      const size = block![0].match(/fontSize:\s*(\d+)/);
      expect(size).toBeTruthy();
      return Number(size![1]);
    };
    expect(sizeOf('priceValue')).toBeGreaterThan(sizeOf('yearlyNote'));
    // ...and the monthly figure is only ever in that subordinate note.
    expect(SOURCE).toContain("t('pricing_billed_yearly_note', { amount: `€${perMonth.toFixed(2)}` })");
  });

  it('translates every new key in all four languages', () => {
    for (const key of [
      'pricing_autorenew_note',
      'pricing_terms_link',
      'pricing_privacy_link',
      'pricing_billed_yearly_note',
    ]) {
      const hits = I18N.match(new RegExp(`^\\s*${key}:`, 'gm')) || [];
      expect(hits).toHaveLength(4);
    }
  });
});
