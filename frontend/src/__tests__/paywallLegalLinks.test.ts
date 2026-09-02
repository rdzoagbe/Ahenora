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
    // Monthly reads "/month"; yearly reads a per-month figure with the real
    // yearly total beneath it. Both are the subscription's length.
    expect(SOURCE).toContain("t('pricing_per_month')");
    expect(SOURCE).toContain("t('pricing_billed_yearly')");
  });

  it('translates every new key in all four languages', () => {
    for (const key of [
      'pricing_autorenew_note',
      'pricing_terms_link',
      'pricing_privacy_link',
    ]) {
      const hits = I18N.match(new RegExp(`^\\s*${key}:`, 'gm')) || [];
      expect(hits).toHaveLength(4);
    }
  });
});
