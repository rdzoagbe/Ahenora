/**
 * The new sign-up: "who lives with you?", the plan that fits, and a free
 * trial that takes no card and charges nothing when it ends.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { PLAN_HIGHLIGHTS, PLAN_PRICE, recommendPlan } from '../planChange';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const onboarding = read('..', 'app', 'onboarding.tsx');

describe('the recommendation', () => {
  it('matches the server, which decides the trial', () => {
    expect(recommendPlan('solo', 0)).toBe('duo');
    expect(recommendPlan('couple', 0)).toBe('duo');
    expect(recommendPlan('family', 2)).toBe('executive');
    expect(recommendPlan('two_homes', 5)).toBe('executive');
    expect(recommendPlan('family', 6)).toBe('household');
    const server = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'backend', 'server.py'), 'utf8');
    expect(server).toContain('if living in ("solo", "couple"):\n        return "duo"');
  });

  it('every recommended plan has a price and highlights to show', () => {
    for (const plan of ['duo', 'executive', 'household'] as const) {
      expect(PLAN_PRICE[plan]?.monthly).toMatch(/^€\d/);
      expect(PLAN_HIGHLIGHTS[plan]?.length).toBeGreaterThan(0);
    }
  });
});

describe('the setup steps', () => {
  it('are only added for a household the server says is new', () => {
    expect(onboarding).toContain('subscription?.household_setup_due');
    expect(onboarding).toContain("['welcome', 'living', 'plan', 'setup', 'invite', 'ready']");
    expect(onboarding).toContain("['welcome', 'setup', 'invite', 'ready']");
  });

  it('offer the four ways a home is made up', () => {
    for (const k of ['solo', 'couple', 'family', 'two_homes']) expect(onboarding).toContain(`['${k}',`);
  });

  it('say no card and nothing charged, right under the trial button', () => {
    const trial = onboarding.indexOf('testID="onboarding-trial"');
    const note = onboarding.indexOf("t('ob_trial_note')");
    expect(trial).toBeGreaterThan(-1);
    expect(note).toBeGreaterThan(trial);
  });

  it('start the fourteen free days, and still let anyone buy straight away', () => {
    // The whole app is already free for fourteen days from sign-up, so there
    // is no separate "Start on Free" to choose.
    expect(onboarding).not.toContain('testID="onboarding-start-free"');
    expect(onboarding).toContain('testID="onboarding-trial"');
    expect(onboarding).toContain('testID="onboarding-subscribe-now"');
  });

  it('only ask about custody where there are two homes', () => {
    expect(onboarding).toContain("const askCustody = !askHousehold || living === 'two_homes';");
  });
});

describe('the end of a trial', () => {
  it('is announced on Home three days ahead', () => {
    expect(read('components', 'TrialCard.tsx')).toContain('export const TRIAL_WARN_DAYS = 3;');
    expect(read('..', 'app', '(tabs)', 'feed.tsx')).toContain('<TrialCard />');
  });

  it('never claims a charge', () => {
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      for (const k of ['ob_trial_note', 'trial_card_msg', 'pricing_trial_note']) {
        expect(table[k]).toBeTruthy();
      }
    }
    expect((TRANSLATIONS.en as Record<string, string>).trial_card_msg).toContain('Nothing is charged automatically');
  });
});

describe('every sign-up string exists in every language', () => {
  const keys = [
    'ob_living_title', 'ob_living_hint', 'ob_living_solo', 'ob_living_solo_sub', 'ob_living_couple',
    'ob_living_couple_sub', 'ob_living_family', 'ob_living_family_sub', 'ob_living_two_homes',
    'ob_living_two_homes_sub', 'ob_children_count', 'ob_plan_title', 'ob_plan_try_hint', 'ob_plan_price',
    'ob_trial_cta', 'ob_trial_note', 'ob_subscribe_to', 'trial_card_title',
    'trial_card_title_one', 'trial_card_msg', 'trial_card_cta', 'trial_card_later', 'pricing_trial_note',
  ];
  it.each(LANGS)('%s', (lang) => {
    const table = TRANSLATIONS[lang] as Record<string, string>;
    expect(keys.filter((k) => !table[k])).toEqual([]);
    expect(table.ob_plan_title).toContain('{plan}');
    expect(table.trial_card_title).toContain('{n}');
  });
});
