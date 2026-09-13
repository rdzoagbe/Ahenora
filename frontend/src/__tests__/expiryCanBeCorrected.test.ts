/**
 * A document's expiry can be set, corrected, and taken away.
 *
 * Expiry dates reach the Vault one way: a camera scan reading a passport.
 * `setVaultExpiry` had no caller, so whatever the scan read was permanent —
 * including a date read off a document that does not expire, which put a
 * standing "expired" row on the Vault and a recurring push behind it.
 *
 * Source-level on purpose: these are rules about what the screen must offer,
 * which survive any refactor of how it renders.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const VAULT = readFileSync(
  join(__dirname, '..', '..', 'app', '(tabs)', 'vault.tsx'), 'utf8');
const API = readFileSync(join(__dirname, '..', 'api.ts'), 'utf8');
const I18N = readFileSync(join(__dirname, '..', 'i18n.ts'), 'utf8');

const inEveryLanguage = (key: string) => I18N.split('\n')
  .filter((l) => new RegExp(`^\\s*["']?${key}["']?:`).test(l)).length;

describe('the document preview says when it runs out', () => {
  it('shows the date, or says there is none', () => {
    expect(VAULT).toContain("t('vault_expires')");
    expect(VAULT).toContain("t('vault_no_expiry')");
    expect(VAULT).toContain('expiryLabel(preview)');
  });

  it('offers the control on every document, not only dated ones', () => {
    // A passport with no expiry recorded is exactly the case the alerts exist
    // for, so a control that only appeared once a date was set could never
    // create the first one.
    expect(VAULT).toContain('testID="preview-expiry"');
    expect(VAULT).toContain('onPress={() => setExpiryFor(preview)}');
    expect(VAULT).toContain("preview.expiry_date ? t('vault_change_expiry') : t('vault_set_expiry')");
  });
});

describe('the alert itself is the way in', () => {
  it('makes an expiry alert tappable', () => {
    // The alert is where a wrong date is noticed. These were inert rows: you
    // could read "expired 40 days ago" on a birth certificate and have
    // nowhere to go from there.
    expect(VAULT).toContain('testID={`vault-alert-${alert.doc_id}`}');
    expect(VAULT).toContain('onPress={() => doc && setExpiryFor(doc)}');
  });

  it('does not offer a row it cannot open', () => {
    // The alert list and the document list are separate reads; a private
    // document belonging to somebody else appears in neither.
    expect(VAULT).toContain('disabled={!doc}');
  });
});

describe('saving', () => {
  it('turns the picker string into a date the server takes', () => {
    expect(VAULT).toContain('parseDisplayDate(chosen, localeFor(lang))');
    expect(VAULT).toContain('parsed.toISOString()');
  });

  it('passes null through to clear rather than skipping the call', () => {
    expect(VAULT).toContain('api.setVaultExpiry(doc.doc_id, iso)');
    expect(API).toContain('setVaultExpiry: (docId: string, expiryDate: string | null)');
  });

  it('re-reads the alerts instead of patching them', () => {
    // They are derived server-side. Clearing a date has to take its alert
    // with it, and a locally patched list would keep showing the alert for a
    // document that no longer has an expiry at all.
    expect(VAULT).toContain('setExpiryAlerts(await api.vaultExpiryAlerts()');
  });

  it('says which of the two things happened', () => {
    expect(VAULT).toContain("iso ? t('vault_expiry_saved') : t('vault_expiry_cleared')");
  });

  it('has its words in every language the app ships', () => {
    for (const key of ['vault_expires', 'vault_no_expiry', 'vault_set_expiry',
                       'vault_change_expiry', 'vault_expiry_saved',
                       'vault_expiry_cleared']) {
      expect(inEveryLanguage(key)).toBe(4);
    }
  });
});

describe('the type the screen reads it from', () => {
  it('declares the field the server has always sent', () => {
    // public_vault_doc has always returned expiry_date; VaultDoc never
    // declared it, so no screen could show or correct one.
    expect(API).toMatch(/expiry_date\?: string \| null;/);
  });
});
