/**
 * The app's side of "Free is for adults; children are on Family" and the new
 * prices (Family 4.99, Household 9.99). The server decides; these hold the
 * screens to what it decided.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { PLAN_PRICE } from '../planChange';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];

describe('the prices shown', () => {
  it('match the new catalogue', () => {
    expect(PLAN_PRICE.executive).toEqual({ monthly: '€4.99', yearly: '€39.99' });
    expect(PLAN_PRICE.household).toEqual({ monthly: '€9.99', yearly: '€99.99' });
    const pricing = read('components', 'PricingView.tsx');
    expect(pricing).toContain('executive: { monthly: 4.99, yearly: 39.99 }');
    expect(pricing).toContain('household: { monthly: 9.99, yearly: 99.99 }');
  });
});

describe('the Free card', () => {
  const pricing = read('components', 'PricingView.tsx');
  it('no longer lists children as included, and shows them locked on Family', () => {
    const free = pricing.slice(pricing.indexOf('village: {'), pricing.indexOf('duo: {', pricing.indexOf('village: {')));
    expect(free).not.toContain("'pf_free_3'");
    expect(pricing).toContain('testID="pricing-free-locked-children"');
  });
  it('says two adults and three scans in every language', () => {
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      expect(table.pf_free_6).toMatch(/^3 /);
      expect(table.pf_free_1).not.toMatch(/2 (kids|hijos|enfants|Kinder)/);
    }
  });
});

describe('families already on Free with children', () => {
  it('are told the date on Home, and after it find their children kept', () => {
    expect(read('..', 'app', '(tabs)', 'feed.tsx')).toContain('<FreeChangeCard />');
    expect(read('..', 'app', '(tabs)', 'kids.tsx')).toContain('<ChildrenLockedCard />');
    const card = read('components', 'FreeChangeCard.tsx');
    expect(card).toContain('subscription?.free_children_until');
    expect(card).toContain('subscription?.children_locked');
  });

  it('are told nothing is deleted, in every language', () => {
    const words: Record<string, RegExp> = {
      en: /Nothing is deleted/, es: /No se borra nada/, fr: /Rien n’est supprimé/, de: /Nichts wird gelöscht/,
    };
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      expect(table.free_change_msg).toMatch(words[lang]);
      expect(table.free_change_title).toContain('{date}');
      expect(table.children_locked_msg).toBeTruthy();
    }
  });
});
