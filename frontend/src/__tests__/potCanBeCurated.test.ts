/**
 * The organiser can take a pledge off, and shut the link.
 *
 * A gift pot's share link is public and unauthenticated, so anybody holding
 * the URL can chip in under any name. `removeContribution` and
 * `unshareGiftPot` both existed with no caller, so a duplicate, a typo or a
 * joke entry was permanent — and it counted, since `total_pledged` is the
 * number the organiser reads to decide whether the gift is covered.
 *
 * Source-level on purpose: rules about what the screen must offer, which
 * survive any refactor of how it renders.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const POT = readFileSync(
  join(__dirname, '..', '..', 'app', 'gift-pot.tsx'), 'utf8');
const PUBLIC_POT = readFileSync(
  join(__dirname, '..', '..', 'app', 'pot', '[token].tsx'), 'utf8');
const I18N = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');

const inEveryLanguage = (key: string) => I18N.split('\n')
  .filter((l) => new RegExp(`^\\s*["']?${key}["']?:`).test(l)).length;

describe('a pledge can be taken off', () => {
  it('puts a remove on every row', () => {
    expect(POT).toContain('testID={`gift-pot-remove-${c.contrib_id}`}');
    expect(POT).toContain('api.removeContribution(pot.pot_id, c.contrib_id)');
  });

  it('asks first, on both platforms', () => {
    expect(POT).toContain('onPress={() => confirmRemoveContribution(c)}');
    expect(POT).toContain("t('gp_remove_confirm', { name: c.name })");
    expect(POT).toContain('if (webConfirm(message)) go();');
    expect(POT).toMatch(/Alert\.alert\(t\('gp_remove'\), message, \[/);
  });

  it('stops offering it once the pot is closed', () => {
    // A closed pot is a record of what happened, not a thing to edit.
    expect(POT).toContain("{pot.status !== 'closed' ? (");
  });
});

describe('the link can be turned off', () => {
  it('offers it only while the pot is actually shared', () => {
    expect(POT).toContain('testID="gift-pot-unshare"');
    expect(POT).toContain('{pot.shared ? (');
    expect(POT).toContain('api.unshareGiftPot(pot.pot_id)');
  });

  it('asks first, and says what survives', () => {
    expect(POT).toContain('onPress={confirmUnshare}');
    expect(POT).toContain("t('gp_stop_sharing_confirm')");
    expect(POT).toMatch(/Alert\.alert\(t\('gp_stop_sharing'\), message, \[/);
  });
});

describe('why the owner has to be the one who can', () => {
  it('the public screen offers no way to correct a pledge', () => {
    // The ledger said a contribution is "corrected by the contributor". The
    // contributor over a link has no account, and this screen has exactly two
    // calls. If that ever stops being true, this test should be revisited
    // rather than deleted.
    const calls = [...PUBLIC_POT.matchAll(/\bapi\.(\w+)/g)].map((m) => m[1]);
    expect([...new Set(calls)].sort()).toEqual(['getPublicPot', 'joinPublicPot']);
  });
});

describe('the words', () => {
  it('are in every language the app ships', () => {
    for (const key of ['gp_remove', 'gp_remove_who', 'gp_remove_confirm',
                       'gp_stop_sharing', 'gp_stop_sharing_confirm',
                       'gp_sharing_stopped']) {
      expect(inEveryLanguage(key)).toBe(4);
    }
  });
});
