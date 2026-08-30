/**
 * iOS must never point a buyer at a purchase outside the app.
 *
 * App Store guideline 3.1.1 forbids steering a user to any external purchase
 * mechanism, and this screen had three alerts that did exactly that — two of
 * them opening GOOGLE PLAY, a competitor's store, and one sending the buyer to
 * ahenora.com to pay. Every one of them fires precisely when billing is
 * unavailable, which on iOS is the normal state until the RevenueCat key and
 * the App Store Connect products exist. In other words the first iOS build
 * would have shipped straight into a rejection.
 *
 * This is a source-level check on purpose: the rule is about what the file is
 * ALLOWED to contain, and that survives refactors of the component itself.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SOURCE = readFileSync(
  join(__dirname, '..', 'components', 'PricingView.tsx'), 'utf8');

describe('iOS purchase steering', () => {
  it('sends every unavailable-billing path through one guarded helper', () => {
    // Three call sites; if a fourth appears it must use the helper too.
    const guarded = SOURCE.match(/unavailableAlert\(t\)/g) || [];
    expect(guarded.length).toBeGreaterThanOrEqual(3);
  });

  it('opens the Play Store from exactly one place, and that place checks the platform', () => {
    const opens = SOURCE.match(/Linking\.openURL\(ANDROID_STORE_URL\)/g) || [];
    expect(opens).toHaveLength(1);
    const helper = SOURCE.slice(
      SOURCE.indexOf('function unavailableAlert'),
      SOURCE.indexOf('Linking.openURL(ANDROID_STORE_URL)'));
    expect(helper).toContain("Platform.OS === 'ios'");
  });

  it('never sends an iOS buyer to the website to pay', () => {
    // The household-plan fallback used to do this unconditionally.
    const idx = SOURCE.indexOf("price_household_web_msg");
    expect(idx).toBeGreaterThan(-1);
    const before = SOURCE.slice(Math.max(0, idx - 400), idx);
    expect(before).toContain("Platform.OS === 'ios'");
  });

  it('has the neutral wording in every language the app speaks', () => {
    const i18n = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');
    const found = i18n.match(/price_unavailable_title:/g) || [];
    expect(found).toHaveLength(4);
    const msgs = i18n.match(/price_unavailable_msg:/g) || [];
    expect(msgs).toHaveLength(4);
  });

  it('the neutral wording names no store and no website', () => {
    const i18n = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');
    for (const line of i18n.split('\n').filter((l) => l.includes('price_unavailable_msg:'))) {
      expect(line.toLowerCase()).not.toContain('google');
      expect(line.toLowerCase()).not.toContain('play');
      expect(line.toLowerCase()).not.toContain('ahenora.com');
    }
  });
});
