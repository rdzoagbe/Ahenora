/**
 * Settings absorbs the Account.
 *
 * Roland, 2026-10-31, from the review of More and Settings: two screens for
 * one idea, and the sheet made a parent guess which held what. Log out was
 * on both; the terms and the privacy policy were on both; Contact support on
 * Settings jumped to the Account's form. This is the merge: the Account page
 * keeps what is personal (the picture, the sign-in and connections, the data
 * download, deleting the account) and Settings says everything else once —
 * Contact support and Send feedback under Help and support, the terms and
 * the privacy policy under Privacy and security, one Log out. This pins:
 *
 *  - the Account page has no legal section, no support form and no log out;
 *  - the support form is a sheet of its own, opened from Settings;
 *  - feedback is one row away on Settings as well as in More;
 *  - the flag that sent support to the Account is gone from the store;
 *  - every string the sheet shows exists in every language.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const account = read('app', '(tabs)', 'account.tsx');
const settings = read('app', '(tabs)', 'settings.tsx');
const store = read('src', 'store.tsx');
const sheet = read('src', 'components', 'SupportSheet.tsx');

describe('the Account page keeps what is personal', () => {
  it('still has the picture, the sign-in and connections, the data download and the deletion', () => {
    expect(account).toContain('testID="account-picture"');
    expect(account).toContain('testID="change-password"');
    expect(account).toContain('testID="export-data"');
    expect(account).toContain('testID="open-account-deletion"');
  });

  it('no longer repeats what Settings says', () => {
    expect(account).not.toContain("t('acc_section_legal')");
    expect(account).not.toContain('testID="open-terms-support"');
    expect(account).not.toContain('testID="open-privacy-policy"');
    expect(account).not.toContain('testID="account-logout"');
    expect(account).not.toContain('submitSupportRequest');
    expect(account).not.toContain('supportRequested');
  });
});

describe('Settings says it once', () => {
  it('opens the support form itself, as a sheet', () => {
    expect(settings).toContain("import { SupportSheet } from '../../src/components/SupportSheet';");
    expect(settings).toContain('testID="settings-contact-support"');
    expect(settings).toContain('onPress={() => setShowSupport(true)}');
    expect(settings).toContain('<SupportSheet visible={showSupport} onClose={() => setShowSupport(false)} />');
    expect(sheet).toContain('api.submitSupportRequest({ subject: subj, message: msg })');
    for (const id of ['support-subject', 'support-message', 'support-send', 'support-close']) {
      expect(sheet).toContain(`testID="${id}"`);
    }
  });

  it('offers feedback under Help and support', () => {
    expect(settings).toContain('testID="settings-send-feedback"');
    expect(settings).toContain('<FeedbackSheet visible={showFeedback} onClose={() => setShowFeedback(false)} />');
  });

  it('keeps the terms, the privacy policy and one log out', () => {
    expect(settings).toContain('testID="settings-terms"');
    expect(settings).toContain('testID="settings-privacy-policy"');
    expect(settings).toContain('testID="logout"');
  });

  it('needs no flag to reach support any more', () => {
    expect(store).not.toContain('supportRequested');
    expect(settings).not.toContain('requestSupport');
  });

  it('shows the sheet in every language', () => {
    for (const key of ['acc_contact_support', 'acc_subject', 'acc_subject_placeholder', 'acc_message', 'acc_message_placeholder',
      'acc_send_message', 'acc_sending', 'acc_sent_title', 'acc_sent_msg', 'acc_error_title', 'acc_send_error_msg',
      'acc_missing_fields_title', 'acc_missing_fields_msg', 'fb_title', 'fb_more_sub']) {
      for (const lang of LANGS) {
        expect([lang, key, typeof (TRANSLATIONS[lang] as Record<string, unknown>)[key]]).toEqual([lang, key, 'string']);
      }
    }
  });
});
