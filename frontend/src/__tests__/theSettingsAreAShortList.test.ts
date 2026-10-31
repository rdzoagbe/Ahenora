/**
 * Settings is a short list again.
 *
 * The final design Roland chose (2026-10-26): the profile in the person's own
 * colour with the door to their account, then Family, App, and Help and
 * privacy as three panels of rows, each row saying its value before it is
 * opened. Nothing was removed: every toggle, the invitations, the children's
 * sections, the history, the version, sign-out are all one row down. This
 * pins:
 *
 *  - the custody row reads "Odd weeks", "Even weeks" or "Off";
 *  - the household row names the other parent, and falls back to the summary;
 *  - the three panels and the rows the design puts in them;
 *  - the doors other screens and harnesses rely on are still there;
 *  - custody and support are reached by a flag the Calendar and the Account
 *    act on when they arrive;
 *  - every new string exists in all four languages.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { coParentLine, custodyValue } from '../settingsHub';
import type { FamilyMember } from '../api';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const screen = read('app', '(tabs)', 'settings.tsx');
const store = read('src', 'store.tsx');
const calendar = read('app', '(tabs)', 'calendar.tsx');
const t = (key: string) => key;
const member = (name: string, is_me = false) => ({ name, is_me, role: 'parent', has_account: true }) as unknown as FamilyMember;

describe('what the rows say', () => {
  it('reads custody the way the calendar sets it', () => {
    expect(custodyValue({ enabled: true, our_weeks: 'odd', away_label: '' }, t)).toBe('custody_odd_weeks');
    expect(custodyValue({ enabled: true, our_weeks: 'even', away_label: '' }, t)).toBe('custody_even_weeks');
    expect(custodyValue({ enabled: false, our_weeks: 'even', away_label: '' }, t)).toBe('set_off');
    expect(custodyValue(undefined, t)).toBe('set_off');
  });

  it('names the other parent beside the household, and nobody when you parent alone', () => {
    expect(coParentLine([member('Jordan Sim', true), member('Sam Sim')])).toBe('Sam');
    expect(coParentLine([member('Jordan', true), member('Sam'), member('Alex')])).toBe('Sam & Alex');
    expect(coParentLine([member('Jordan', true)])).toBeNull();
    expect(coParentLine([])).toBeNull();
  });
});

describe('the screen', () => {
  it('opens on the profile, in the person’s own colour, with the door to their account', () => {
    expect(screen).toContain('testID="settings-open-account"');
    expect(screen).toContain("{t('set_manage_account')}");
    expect(screen).toContain('const myTone = personTone(');
  });

  it('is three panels of rows', () => {
    for (const id of ['family', 'app', 'help']) expect(screen).toContain(`testID="settings-section-${id}"`);
    for (const key of ['set_section_family', 'set_section_app', 'set_section_help']) expect(screen).toContain(`t('${key}')`);
    const family = screen.indexOf('testID="settings-section-family"');
    const app = screen.indexOf('testID="settings-section-app"');
    const help = screen.indexOf('testID="settings-section-help"');
    expect(family).toBeGreaterThan(0);
    expect(app).toBeGreaterThan(family);
    expect(help).toBeGreaterThan(app);
  });

  it('puts the household, custody, an invitation and the plan under Family', () => {
    expect(screen).toContain("t('set_household_coparents')");
    expect(screen).toContain('coParentLine(coParents) || householdSummary');
    expect(screen).toContain('testID="settings-custody"');
    expect(screen).toContain('custodyValue(subscription?.custody, t)');
    expect(screen).toContain('testID="settings-invite"');
    expect(screen).toContain('testID="open-pricing"');
  });

  it('puts notifications, appearance, language and the history under App, each saying its value', () => {
    expect(screen).toContain("notificationPrefs.card_reminders ? t('set_on') : t('set_off')");
    expect(screen).toContain("t('set_appearance_' + appearanceMode)");
    expect(screen).toContain('value={LANG_NAMES[lang]}');
    expect(screen).toContain('testID="settings-group-more"');
  });

  it('keeps every door one row down', () => {
    for (const id of ['settings-household-toggle', 'invite-coparent', 'invite-helper', 'settings-kids-sections',
      'notif-push', 'notif-deadlines', 'notif-sign', 'notif-chat', 'notif-digest', 'notif-send-test',
      'settings-completed-history', 'check-updates',
      'update-diagnostics', 'sign-out-everywhere', 'settings-replay-setup', 'settings-rate-app', 'logout']) {
      expect(screen).toContain(`testID="${id}"`);
    }
    expect(screen).toContain('testID="settings-lang"');
    expect(screen).toContain('testID={`appearance-${mode}`}');
  });

  it('reaches custody on the Calendar by a flag it acts on, and opens support itself', () => {
    expect(screen).toContain("onPress={() => { requestCustody(); router.push('/(tabs)/calendar'); }}");
    for (const name of ['custodyRequested', 'requestCustody', 'clearCustodyRequest']) {
      expect(store).toContain(`${name},`);
    }
    expect(calendar).toContain('if (!custodyRequested) return;');
    expect(calendar).toContain('openCustody();\n    clearCustodyRequest();\n  }, [custodyRequested');
    // Support was reached by a flag the Account acted on; since 2026-10-31
    // the form is a sheet on Settings itself (see settingsAbsorbsTheAccount).
    expect(screen).toContain('onPress={() => setShowSupport(true)}');
    expect(store).not.toContain('supportRequested');
  });

  it('says every new thing in all four languages', () => {
    for (const key of ['set_manage_account', 'set_section_family', 'set_section_app', 'set_section_help',
      'set_household_coparents', 'set_custody_weeks', 'set_invite_someone', 'set_privacy_security', 'set_help_support']) {
      for (const lang of LANGS) {
        expect([lang, key, typeof (TRANSLATIONS[lang] as Record<string, unknown>)[key]]).toEqual([lang, key, 'string']);
      }
    }
  });
});
