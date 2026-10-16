/**
 * A tap that failed says so, in the person's own language.
 *
 * Two audits of 2026-10-15 found the ways a family is left guessing: a sign-in
 * error shown as the server's English `401: {"detail": ...}`, a child's chore
 * that vanishes and comes back without a word, a Spending screen that reads
 * "£0" over a month that simply failed to load, a cancelled Google sheet
 * reported as a failure. These hold the fixes in place at the source level,
 * the way the rest of this suite does.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { TRANSLATIONS } from '../i18n';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const LANGS = ['en', 'es', 'fr', 'de'] as const;
const table = (lang: string) => (TRANSLATIONS as unknown as Record<string, Record<string, string>>)[lang];

describe('what a failed sign-in says', () => {
  const modal = read('components', 'EmailAuthModal.tsx');
  const landing = read('..', 'app', 'index.tsx');

  it('never shows the server detail string for email sign-in or sign-up', () => {
    expect(modal).not.toContain('"detail"\\s*:\\s*"([^"]+)"');
    expect(modal).not.toContain('readDetail(');
    expect(modal).toContain("status === 401 ? t('email_wrong_credentials')");
    expect(modal).toContain("status === 429 ? t('email_too_many')");
  });

  it('drops an invitation that was already accepted instead of refusing the sign-in', () => {
    expect(modal).toContain("e?.status === 409 && /invite/i.test(String(e?.message || ''))");
    expect(modal).toContain('await clearStoredInvite();');
  });

  it('does not promise a reset code when the request never left the phone', () => {
    const block = modal.slice(modal.indexOf("logger.warn('reset request failed'"), modal.indexOf("logger.warn('reset request failed'") + 500);
    expect(block).toContain("if (!e?.status) {");
    expect(block).toContain("setForgotError(t('err_offline'))");
  });

  it('shows Google failures as a sentence, never as status plus JSON', () => {
    expect(landing).not.toMatch(/error\?\.message \|\| t\('land_try_again'\)/);
    expect(landing).toContain('signInFailureText(error)');
    expect(landing).not.toContain("'Google returned an authentication error.'");
  });

  it('treats a closed Google sheet on Android as nothing, not a failure', () => {
    expect(landing).toContain("?.type === 'cancelled'");
  });

  it('sends a returning Apple user to Apple, not to the password form', () => {
    expect(landing).toContain("if (loginHint.method === 'apple') signInWithApple();");
  });

  it('says a used invitation link no longer stands and keeps nothing from it', () => {
    expect(landing).toContain("if (invite.status && invite.status !== 'pending') {");
    expect(landing).toContain('testID="invite-gone"');
    const join = read('components', 'InviteJoinPrompt.tsx');
    expect(join).toContain("if (status === 404 || status === 410) {");
    expect(join).toContain("setError(t('invite_join_gone'))");
    expect(join).not.toMatch(/setError\(detail \|\|/);
  });

  it('brings somebody sent to sign in from Plans back to Plans', () => {
    expect(landing).toContain("window.sessionStorage.getItem('post_auth_redirect')");
  });
});

describe('no screen shows the server\'s raw error text', () => {
  it('every toast and alert goes through apiErrorText', () => {
    const files = [
      ['..', 'app', '(tabs)', 'kids.tsx'], ['..', 'app', '(tabs)', 'calendar.tsx'], ['..', 'app', '(tabs)', 'vault.tsx'],
      ['..', 'app', '(tabs)', 'settings.tsx'], ['..', 'app', '(tabs)', 'feed.tsx'], ['..', 'app', '(tabs)', 'account.tsx'],
      ['..', 'app', 'member.tsx'], ['..', 'app', 'gift-pot.tsx'], ['..', 'app', 'index.tsx'],
    ];
    for (const f of files) {
      const src = read(...f).split('\n').filter((l) => !l.includes('registerForPushNotificationsAsync'));
      const raw = src.filter((l) => /\b(e|err|error)\?\.message \|\| t\(/.test(l));
      expect([f.join('/'), raw]).toEqual([f.join('/'), []]);
    }
  });
});

describe('a tap that did nothing says so', () => {
  it('in kid mode, for a chore or a reward', () => {
    const kid = read('..', 'app', 'kid.tsx');
    expect(kid).toContain("setSaveNote(t('kid_couldnt_save'))");
    expect(kid).toContain('testID="kid-save-note"');
  });

  it('when a teen acknowledges a note', () => {
    const teen = read('..', 'app', 'teen.tsx');
    const block = teen.slice(teen.indexOf("logger.warn('teen note ack failed'"), teen.indexOf("logger.warn('teen note ack failed'") + 200);
    expect(block).toContain("Alert.alert(t('teen_couldnt_save'))");
  });

  it('when stars, an expense, a gift pot or a pocket-money amount do not go through', () => {
    expect(read('..', 'app', 'member.tsx')).toContain("Alert.alert(t('rec_title'), apiErrorText(e, t, 'rec_save_failed'))");
    expect(read('components', 'SpendingView.tsx')).toContain("Alert.alert(t('exp_save_failed'), apiErrorText(e, t, 'err_please_try_again'))");
    expect(read('..', 'app', 'gift-pot.tsx')).toContain("showToast(apiErrorText(e, t, 'vault_could_not_update'), 'error')");
    expect(read('..', 'app', '(tabs)', 'kids.tsx')).toContain("showToast(t('kids_valid_money'), 'error'); return;");
    expect(read('components', 'CoParentNudge.tsx')).toContain('testID="cp-nudge-failed"');
  });

  it('when the household setup at onboarding did not save', () => {
    const onb = read('..', 'app', 'onboarding.tsx');
    expect(onb).toContain("Alert.alert(t('onb_setup_failed'))");
    // And the step list is decided before the first step shows, not while
    // the person is on step two.
    expect(onb).toContain('if (!ready) {');
    expect(onb).toContain("if (ready && setupDue && !askHousehold && step === 0) setAskHousehold(true);");
  });
});

describe('a failed load is not an empty one', () => {
  it.each([
    ['components/SpendingView.tsx', 'loadFailed && !overview'],
    ['components/ChatThread.tsx', 'ListEmptyComponent={loadFailed'],
    ['../app/(tabs)/chat.tsx', 'loadFailed && threads.length === 0'],
    ['../app/history.tsx', 'loadFailed && groups.length === 0'],
  ])('%s shows an error with a retry instead', (file, marker) => {
    const src = read(...file.split('/'));
    expect(src).toContain(marker);
    expect(src).toContain('<ErrorState onRetry=');
  });
});

describe('every new sentence exists in all four languages', () => {
  const keys = ['kid_couldnt_save', 'kids_valid_money', 'onb_setup_failed', 'cp_resend_failed', 'set_invite_failed',
    'email_wrong_credentials', 'email_exists', 'email_too_many', 'forgot_code_bad', 'invite_join_gone'];
  it.each(LANGS)('%s', (lang) => {
    for (const k of keys) expect([lang, k, typeof table(lang)[k]]).toEqual([lang, k, 'string']);
  });
});
