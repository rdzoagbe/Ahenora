/**
 * Duo on the Plans page, and moving between plans without paying twice.
 *
 *  - every plan card says "Upgrade" above your plan and "Downgrade" below it;
 *  - moving down shows what changes first, and says nothing is deleted;
 *  - Google Play is told which subscription a purchase replaces (otherwise it
 *    starts a second one), with a move down waiting for the renewal date;
 *  - a plan is changed where it is billed, never started again elsewhere;
 *  - Duo hides the children's sections instead of deleting anything.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { lossesFor, PLAN_RANK } from '../planChange';

jest.mock('react-native', () => ({ Platform: { OS: 'android' }, StyleSheet: { create: (s: any) => s } }));
jest.mock('../logger', () => ({ logger: { warn: jest.fn() } }));

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');

describe('the order of plans', () => {
  it('Free, Duo, Family, Household', () => {
    const order = (['household', 'village', 'executive', 'duo'] as const)
      .slice().sort((a, b) => PLAN_RANK[a] - PLAN_RANK[b]);
    expect(order).toEqual(['village', 'duo', 'executive', 'household']);
  });

  it('the Plans page lists Duo second and labels buttons by that order', () => {
    const src = read('components', 'PricingView.tsx');
    expect(src).toContain("const PLAN_ORDER: Plan[] = ['village', 'duo', 'executive', 'household'];");
    expect(src).toContain("isDown ? t('pricing_downgrade')");
    expect(src).toContain("duo: { monthly: 1.99, yearly: 19.99 }");
  });
});

describe('what a move down costs', () => {
  it('Family to Duo with children lists the children’s side', () => {
    const l = lossesFor('executive', 'duo', true);
    expect(l).toEqual(expect.arrayContaining(
      ['chg_lose_kids', 'chg_lose_chores', 'chg_lose_money', 'chg_lose_custody', 'chg_lose_carpool']));
  });

  it('without children it only says children cannot be added', () => {
    expect(lossesFor('executive', 'duo', false)).toEqual(['chg_lose_add_child']);
  });

  it('Household to Family lists what only Household has', () => {
    expect(lossesFor('household', 'executive', true)).toEqual(
      ['chg_lose_helpers', 'chg_lose_vault', 'chg_lose_people', 'chg_lose_priority']);
  });

  it('a move up costs nothing', () => {
    expect(lossesFor('duo', 'executive', true)).toEqual([]);
  });

  it('the sheet always says nothing is deleted and when it lands', () => {
    const sheet = read('components', 'PlanChangeSheet.tsx');
    expect(sheet).toContain("t('chg_nothing_deleted')");
    expect(sheet).toContain("t('chg_when_renewal'");
  });
});

describe('Google Play never bills twice', () => {
  // Loaded after the react-native mock above.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { androidSubscriptionToReplace } = require('../billing');

  it('names the subscription being replaced, without its base plan', () => {
    expect(androidSubscriptionToReplace({
      entitlements: { active: { premium: { productIdentifier: 'premium_monthly:yearly' } } },
    })).toBe('premium_monthly');
    expect(androidSubscriptionToReplace({ activeSubscriptions: ['duo:monthly'] })).toBe('duo');
  });

  it('nothing to replace for someone on Free', () => {
    expect(androidSubscriptionToReplace({ entitlements: { active: {} }, activeSubscriptions: [] })).toBeNull();
    expect(androidSubscriptionToReplace(null)).toBeNull();
  });

  it('up is now with time credited, down waits for the renewal', () => {
    const src = read('billing.ts');
    expect(src).toContain("replacementMode: deferred ? 'DEFERRED' : 'WITH_TIME_PRORATION'");
    expect(src).toContain('purchasePackage(pkg, null, change)');
    expect(src).toContain("const DUO_OFFERING_ID = 'duo';");
  });
});

describe('a plan is changed where it is billed', () => {
  const src = read('components', 'PricingView.tsx');

  it('checks the billing rail before any store opens', () => {
    expect(src).toContain('if (!changeableHere(through))');
    expect(src.indexOf('if (!changeableHere(through))'))
      .toBeLessThan(src.indexOf('await performChange(plan, \'up\')'));
  });

  it('a card subscriber changes the subscription, never a second checkout', () => {
    const cardChange = src.indexOf('api.changeCardPlan(tier, cycle)');
    const checkout = src.indexOf('api.createStripeCheckout(tier, cycle)');
    expect(cardChange).toBeGreaterThan(-1);
    expect(cardChange).toBeLessThan(checkout);
  });

  it('Duo is refused for more than two people before any store opens', () => {
    expect(src).toContain("plan === 'duo' && subscription?.duo_eligible === false");
  });
});

describe('Duo hides, never deletes', () => {
  it('the Family hub, calendar, feed and More menu all read the same flag', () => {
    expect(read('..', 'app', '(tabs)', 'kids.tsx')).toContain('useKidsSectionsHidden()');
    expect(read('..', 'app', '(tabs)', 'calendar.tsx')).toContain('useKidsSectionsHidden()');
    expect(read('components', 'MoreSheet.tsx')).toContain('useKidsSectionsHidden()');
    expect(read('..', 'app', '(tabs)', 'feed.tsx')).toContain('subscription?.kids_sections_hidden');
    expect(read('kidsSections.ts')).toContain('subscription?.kids_sections_hidden');
  });

  it('a household can hide them in Settings, and not undo Duo from there', () => {
    const settings = read('..', 'app', '(tabs)', 'settings.tsx');
    expect(settings).toContain('testID="settings-kids-sections"');
    expect(settings).toContain('disabled={kidsOnDuo || kidsSaving}');
  });
});

describe('every Duo string exists in every language', () => {
  const keys = [
    'plan_duo', 'plan_duo_tag', 'plan_duo_desc',
    'pf_duo_1', 'pf_duo_2', 'pf_duo_3', 'pf_duo_4', 'pf_duo_5', 'pf_duo_6',
    'pricing_downgrade', 'duo_not_eligible_title', 'duo_not_eligible_msg', 'duo_not_eligible_card',
    'chg_title_down', 'chg_intro', 'chg_lose_kids', 'chg_lose_chores', 'chg_lose_money',
    'chg_lose_custody', 'chg_lose_carpool', 'chg_lose_add_child', 'chg_lose_helpers',
    'chg_lose_vault', 'chg_lose_people', 'chg_lose_priority', 'chg_nothing_deleted',
    'chg_when_renewal', 'chg_keep', 'chg_confirm', 'chg_pending', 'chg_pending_nodate',
    'chg_booked_title', 'chg_booked_msg', 'chg_failed', 'chg_elsewhere_title',
    'chg_elsewhere_app_store', 'chg_elsewhere_play', 'chg_elsewhere_card', 'chg_elsewhere_card_ios',
    'set_kids_sections', 'set_kids_sections_on', 'set_kids_sections_off', 'set_kids_sections_duo',
    'wn_duo', 'wn_duo_hide',
  ];
  it.each(LANGS)('%s', (lang) => {
    const table = TRANSLATIONS[lang] as Record<string, string>;
    const missing = keys.filter((k) => !table[k]);
    expect(missing).toEqual([]);
  });

  it('placeholders survive translation', () => {
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      expect(table.duo_not_eligible_msg).toContain('{count}');
      expect(table.chg_intro).toContain('{from}');
      expect(table.chg_intro).toContain('{to}');
      expect(table.chg_pending).toContain('{date}');
    }
  });

  it('the iPhone never gets a web address to change a card plan', () => {
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      expect(table.chg_elsewhere_card_ios).not.toMatch(/ahenora\.com|http|browser|navegador|navigateur|Browser/);
    }
  });
});

describe('Duo waits for the App Store on an iPhone', () => {
  it('is offered on an iPhone only once the store hands out the Duo products', () => {
    const hook = read('duoOffered.ts');
    expect(hook).toContain("Platform.OS !== 'ios'");
    expect(hook).toContain("tierReady(userId, 'duo')");
    expect(read('billing.ts')).toContain('offering?.availablePackages?.some(');
  });

  it('the Plans page, the setup step and the news all ask', () => {
    expect(read('components', 'PricingView.tsx')).toContain("p !== 'duo' || duoOffered || currentPlan === 'duo'");
    expect(read('..', 'app', 'onboarding.tsx')).toContain("recommended !== 'duo' || duoOffered");
    expect(read('components', 'UpdateNotice.tsx')).toContain("!k.startsWith('wn_duo')");
  });
});
