import React, { useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { BlurView } from 'expo-blur';
import * as Crypto from 'expo-crypto';
import { X, Mail, Check, ShieldCheck } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { PasswordInput } from './PasswordInput';
import { useStore } from '../store';
import { logger } from '../logger';

type Mode = 'signup' | 'login';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  inviteToken?: string | null;
  /** Which form to open on — the landing has separate "Log in" and "Create
   *  account" doors. An invite always overrides this to Sign Up. */
  initialMode?: Mode;
  /** Pre-fill the email field — used by the "Welcome back, continue as X" tap. */
  initialEmail?: string;
}

export function EmailAuthModal({ visible, onClose, onSuccess, inviteToken, initialMode = 'login', initialEmail }: Props) {
  const { theme, setUserFromAuth, t } = useStore();
  const c = theme.colors;

  // An invite is a join, so it opens on Sign Up. Otherwise default to Log In
  // for anyone who has signed in on this device before — the returning user
  // signing back in after a sign-out is the common case, and landing them on
  // Sign Up asked them to create a second account. A genuinely new device with
  // no history still opens on Sign Up.
  const [mode, setMode] = useState<Mode>(inviteToken ? 'signup' : initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The forgot-password detour: 'auth' is the normal sign-up / log-in form;
  // 'forgot' swaps it for a two-step reset (send a code, then enter code + new
  // password). Kept in this same modal so the user never loses their place.
  const [view, setView] = useState<'auth' | 'forgot'>('auth');
  const [forgotStage, setForgotStage] = useState<'request' | 'verify'>('request');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [forgotBusy, setForgotBusy] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);
  const [forgotNote, setForgotNote] = useState<string | null>(null);

  // Default to Log In for everyone except an invite (which is a join → Sign
  // Up). We deliberately do NOT flip an "unseen" device to Sign Up: a reinstall
  // wipes local history, so the old flag made returning users — who far
  // outnumber genuinely new ones at an email form — land on Sign Up and get
  // asked to recreate an account they already have. New users just tap the
  // Sign Up toggle. An invite still opens on Sign Up (loads async, hence the
  // effect: it's null on first render and this re-runs when it arrives).
  useEffect(() => {
    if (!visible) return;
    setMode(inviteToken ? 'signup' : initialMode);
    if (initialEmail) setEmail(initialEmail);
  }, [visible, inviteToken, initialMode, initialEmail]);

  const hasLength = password.length >= 8;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const strengthCount = [hasLength, hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;

  const generateStrongPassword = () => {
    const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const lower = 'abcdefghjkmnpqrstuvwxyz';
    const digits = '23456789';
    const special = '!@#$%&*?';
    const all = upper + lower + digits + special;
    // Rejection sampling keeps the crypto draw uniform (no modulo bias).
    const randomInt = (max: number) => {
      const limit = Math.floor(0x100000000 / max) * max;
      const buf = new Uint32Array(1);
      let v = Crypto.getRandomValues(buf)[0];
      while (v >= limit) v = Crypto.getRandomValues(buf)[0];
      return v % max;
    };
    const pick = (s: string) => s[randomInt(s.length)];
    const parts = [pick(upper), pick(lower), pick(digits), pick(special)];
    for (let i = parts.length; i < 12; i++) parts.push(pick(all));
    for (let i = parts.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [parts[i], parts[j]] = [parts[j], parts[i]];
    }
    const strong = parts.join('');
    setPassword(strong);
  };

  const reset = () => {
    setName('');
    setEmail('');
    setPassword('');
    setError(null);
    setBusy(false);
    setView('auth');
    setForgotStage('request');
    setCode('');
    setNewPassword('');
    setForgotBusy(false);
    setForgotError(null);
    setForgotNote(null);
  };

  const openForgot = () => {
    setForgotError(null);
    setForgotNote(null);
    setForgotStage('request');
    setCode('');
    setNewPassword('');
    setView('forgot');
  };

  const readDetail = (e: any, fallback: string) => {
    const raw = String(e?.message || '');
    const match = raw.match(/\{.*"detail"\s*:\s*"([^"]+)"/);
    return match?.[1] || fallback;
  };

  // Step one: ask the server to email a code. The reply is deliberately the
  // same whether or not the account exists, so the message here never confirms
  // an email is registered — it just moves on to the code entry.
  const sendResetCode = async () => {
    setForgotError(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setForgotError(t('email_invalid_email'));
      return;
    }
    setForgotBusy(true);
    try {
      const { api } = await import('../api');
      await api.requestPasswordReset(trimmedEmail);
      setForgotStage('verify');
      setForgotNote(t('forgot_code_sent'));
    } catch (e: any) {
      logger.warn('reset request failed', e?.message || e);
      // Even on error, keep the flow moving — a failed send must not reveal
      // whether the address exists. Let them try the code / resend.
      setForgotStage('verify');
      setForgotNote(t('forgot_code_sent'));
    } finally {
      setForgotBusy(false);
    }
  };

  // Step two: prove the code and set a new password. Success signs the user in
  // (the endpoint returns a fresh session), same as a normal log-in.
  const submitReset = async () => {
    setForgotError(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (code.trim().length < 4) {
      setForgotError(t('forgot_code_invalid'));
      return;
    }
    if (newPassword.length < 8) {
      setForgotError(t('email_password_too_short'));
      return;
    }
    setForgotBusy(true);
    try {
      const { api } = await import('../api');
      const result = await api.resetPassword({
        email: trimmedEmail,
        code: code.trim(),
        new_password: newPassword,
      });
      await setUserFromAuth(result.user, result.session_token, 'email');
      reset();
      onSuccess();
    } catch (e: any) {
      logger.warn('reset failed', e?.message || e);
      setForgotError(readDetail(e, t('forgot_failed')));
      setForgotBusy(false);
    }
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = async () => {
    setError(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !trimmedEmail.includes('@')) {
      setError(t('email_invalid_email'));
      return;
    }
    if (password.length < 8) {
      setError(t('email_password_too_short'));
      return;
    }
    if (mode === 'signup' && !name.trim()) {
      setError(t('email_name_required'));
      return;
    }

    setBusy(true);
    try {
      const { api } = await import('../api');
      const result =
        mode === 'signup'
          ? await api.registerWithEmail({
              name: name.trim(),
              email: trimmedEmail,
              password,
              invite_token: inviteToken || undefined,
            })
          : await api.loginWithEmail({
              email: trimmedEmail,
              password,
              invite_token: inviteToken || undefined,
            });

      await setUserFromAuth(result.user, result.session_token, 'email');
      reset();
      onSuccess();
    } catch (e: any) {
      logger.warn('email auth failed', e?.message || e);
      const raw = String(e?.message || '');
      // request() throws `${status}: ${body}` — surface the readable detail when present.
      const match = raw.match(/\{.*"detail"\s*:\s*"([^"]+)"/);
      setError(match?.[1] || (mode === 'signup' ? t('email_signup_failed') : t('email_login_failed')));
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <BlurView intensity={40} tint={theme.mode === 'light' ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
      <View style={[styles.backdrop, { backgroundColor: theme.mode === 'light' ? 'rgba(246,247,251,0.55)' : 'rgba(8,9,16,0.6)' }]} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.center}
      >
        <View style={[styles.sheet, { backgroundColor: c.card, borderColor: c.cardBorder, shadowColor: c.shadow }]}>
          <View style={styles.header}>
            <View style={[styles.iconBubble, { backgroundColor: c.accentSoft }]}>
              <Mail color={c.accent} size={18} />
            </View>
            <Text style={[styles.title, { color: c.text }]}>
              {view === 'forgot'
                ? t('forgot_title')
                : mode === 'signup' ? t('email_create_title') : t('email_welcome_back')}
            </Text>
            <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={close} style={[styles.closeBtn, { borderColor: c.cardBorder, backgroundColor: c.bgSoft }]}>
              <X color={c.text} size={18} />
            </PressScale>
          </View>

          {view === 'forgot' ? (
            <>
              {forgotStage === 'request' ? (
                <>
                  <Text style={[styles.forgotIntro, { color: c.textMuted }]}>{t('forgot_intro')}</Text>
                  <Text style={[styles.label, { color: c.textMuted }]}>{t('email_email_label')}</Text>
                  <TextInput
                    testID="forgot-email"
                    style={[styles.input, { color: c.text, borderColor: c.cardBorder, backgroundColor: c.bgSoft }]}
                    value={email}
                    onChangeText={setEmail}
                    placeholder="you@example.com"
                    placeholderTextColor={c.textSoft}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    autoComplete="email"
                    returnKeyType="done"
                    onSubmitEditing={sendResetCode}
                  />
                  {forgotError ? <Text style={[styles.error, { color: c.danger }]}>{forgotError}</Text> : null}
                  <PressScale testID="forgot-send" onPress={sendResetCode} disabled={forgotBusy} style={[styles.submitBtn, { backgroundColor: c.primary, opacity: forgotBusy ? 0.6 : 1 }]}>
                    {forgotBusy ? <ActivityIndicator color={c.primaryText} size="small" /> : (
                      <Text style={[styles.submitText, { color: c.primaryText }]}>{t('forgot_send_code')}</Text>
                    )}
                  </PressScale>
                </>
              ) : (
                <>
                  {forgotNote ? <Text style={[styles.forgotIntro, { color: c.textMuted }]}>{forgotNote}</Text> : null}
                  <Text style={[styles.label, { color: c.textMuted }]}>{t('forgot_code_label')}</Text>
                  <TextInput
                    testID="forgot-code"
                    style={[styles.input, styles.codeInput, { color: c.text, borderColor: c.cardBorder, backgroundColor: c.bgSoft }]}
                    value={code}
                    onChangeText={(v) => setCode(v.replace(/[^0-9]/g, '').slice(0, 6))}
                    placeholder="123456"
                    placeholderTextColor={c.textSoft}
                    keyboardType="number-pad"
                    autoComplete="one-time-code"
                    textContentType="oneTimeCode"
                    maxLength={6}
                    returnKeyType="next"
                  />
                  <Text style={[styles.label, { color: c.textMuted }]}>{t('forgot_new_password_label')}</Text>
                  <PasswordInput
                    testID="forgot-new-password"
                    style={[styles.input, { color: c.text, borderColor: c.cardBorder, backgroundColor: c.bgSoft }]}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder={t('email_password_placeholder_signup')}
                    placeholderTextColor={c.textSoft}
                    initiallyVisible
                    eyeColor={c.textSoft}
                    showLabel={t('a11y_show_password')}
                    hideLabel={t('a11y_hide_password')}
                    returnKeyType="done"
                    onSubmitEditing={submitReset}
                  />
                  {forgotError ? <Text style={[styles.error, { color: c.danger }]}>{forgotError}</Text> : null}
                  <PressScale testID="forgot-submit" onPress={submitReset} disabled={forgotBusy} style={[styles.submitBtn, { backgroundColor: c.primary, opacity: forgotBusy ? 0.6 : 1 }]}>
                    {forgotBusy ? <ActivityIndicator color={c.primaryText} size="small" /> : (
                      <Text style={[styles.submitText, { color: c.primaryText }]}>{t('forgot_reset_password')}</Text>
                    )}
                  </PressScale>
                  <PressScale onPress={sendResetCode} disabled={forgotBusy} style={styles.forgotLinkBtn}>
                    <Text style={[styles.forgotLink, { color: c.accent }]}>{t('forgot_resend')}</Text>
                  </PressScale>
                </>
              )}
              <PressScale testID="forgot-back" onPress={() => { setView('auth'); setForgotError(null); }} style={styles.forgotLinkBtn}>
                <Text style={[styles.forgotLink, { color: c.textMuted }]}>{t('forgot_back_to_login')}</Text>
              </PressScale>
            </>
          ) : (
          <>
          <View style={[styles.modeToggle, { backgroundColor: c.bgSoft, borderColor: c.cardBorder }]}>
            <PressScale onPress={() => { setMode('signup'); setError(null); }} style={[styles.modeOption, mode === 'signup' && { backgroundColor: c.primary }]}>
              <Text style={[styles.modeText, { color: mode === 'signup' ? c.primaryText : c.textMuted }]}>{t('email_sign_up')}</Text>
            </PressScale>
            <PressScale onPress={() => { setMode('login'); setError(null); }} style={[styles.modeOption, mode === 'login' && { backgroundColor: c.primary }]}>
              <Text style={[styles.modeText, { color: mode === 'login' ? c.primaryText : c.textMuted }]}>{t('email_log_in')}</Text>
            </PressScale>
          </View>

          {mode === 'signup' ? (
            <>
              <Text style={[styles.label, { color: c.textMuted }]}>{t('email_name_label')}</Text>
              <TextInput
                style={[styles.input, { color: c.text, borderColor: c.cardBorder, backgroundColor: c.bgSoft }]}
                value={name}
                onChangeText={setName}
                placeholder={t('email_name_placeholder')}
                placeholderTextColor={c.textSoft}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </>
          ) : null}

          <Text style={[styles.label, { color: c.textMuted }]}>{t('email_email_label')}</Text>
          <TextInput
            style={[styles.input, { color: c.text, borderColor: c.cardBorder, backgroundColor: c.bgSoft }]}
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={c.textSoft}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            returnKeyType="next"
          />

          <View style={styles.labelRow}>
            <Text style={[styles.label, { color: c.textMuted, marginBottom: 0 }]}>{t('email_password_label')}</Text>
            {mode === 'signup' ? (
              <PressScale onPress={generateStrongPassword} style={[styles.suggestBtn, { backgroundColor: c.accentSoft }]}>
                <ShieldCheck color={c.accent} size={12} />
                <Text style={[styles.suggestText, { color: c.accent }]}>{t('email_use_strong_password')}</Text>
              </PressScale>
            ) : null}
          </View>
          <PasswordInput
            style={[styles.input, { color: c.text, borderColor: c.cardBorder, backgroundColor: c.bgSoft }]}
            value={password}
            onChangeText={setPassword}
            placeholder={mode === 'signup' ? t('email_password_placeholder_signup') : t('email_password_placeholder_login')}
            placeholderTextColor={c.textSoft}
            initiallyVisible={mode === 'signup'}
            eyeColor={c.textSoft}
            showLabel={t('a11y_show_password')}
            hideLabel={t('a11y_hide_password')}
            returnKeyType="done"
            onSubmitEditing={submit}
          />

          {mode === 'signup' && password.length > 0 ? (
            <View style={styles.hintsWrap}>
              <PasswordHint met={hasLength} label={t('email_hint_length')} color={c} />
              <PasswordHint met={hasUpper} label={t('email_hint_uppercase')} color={c} />
              <PasswordHint met={hasLower} label={t('email_hint_lowercase')} color={c} />
              <PasswordHint met={hasNumber} label={t('email_hint_number')} color={c} />
              <PasswordHint met={hasSpecial} label={t('email_hint_special')} color={c} />
              <View style={[styles.strengthBar, { backgroundColor: c.bgSoft }]}>
                <View style={[styles.strengthFill, { width: `${(strengthCount / 5) * 100}%`, backgroundColor: strengthCount <= 2 ? '#EF4444' : strengthCount <= 3 ? '#F59E0B' : '#22C55E' }]} />
              </View>
              <Text style={[styles.strengthLabel, { color: c.textMuted }]}>
                {strengthCount <= 2 ? t('email_strength_weak') : strengthCount <= 3 ? t('email_strength_fair') : strengthCount <= 4 ? t('email_strength_strong') : t('email_strength_very_strong')}
              </Text>
            </View>
          ) : null}

          {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}

          <PressScale onPress={submit} disabled={busy} style={[styles.submitBtn, { backgroundColor: c.primary, opacity: busy ? 0.6 : 1 }]}>
            {busy ? (
              <ActivityIndicator color={c.primaryText} size="small" />
            ) : (
              <Text style={[styles.submitText, { color: c.primaryText }]}>
                {mode === 'signup' ? t('email_create_account') : t('email_log_in')}
              </Text>
            )}
          </PressScale>

          {mode === 'login' ? (
            <PressScale testID="forgot-password-link" onPress={openForgot} style={styles.forgotLinkBtn}>
              <Text style={[styles.forgotLink, { color: c.accent }]}>{t('forgot_link')}</Text>
            </PressScale>
          ) : null}
          </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PasswordHint({ met, label, color }: { met: boolean; label: string; color: any }) {
  return (
    <View style={styles.hintRow}>
      <View style={[styles.hintDot, { backgroundColor: met ? '#22C55E' : color.bgSoft }]}>
        {met ? <Check color="#fff" size={9} /> : null}
      </View>
      <Text style={[styles.hintText, { color: met ? color.text : color.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 22 },
  sheet: {
    width: '100%',
    maxWidth: 400,
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 16,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  iconBubble: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: 'Inter_800ExtraBold', fontSize: 19, letterSpacing: -0.3 },
  closeBtn: { width: 34, height: 34, borderRadius: 99, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modeToggle: { flexDirection: 'row', borderRadius: 12, borderWidth: 1, padding: 4, marginBottom: 18, gap: 4 },
  modeOption: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  modeText: { fontFamily: 'Inter_700Bold', fontSize: 13.5 },
  label: { fontFamily: 'Inter_600SemiBold', fontSize: 12.5, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_500Medium', fontSize: 15, marginBottom: 14 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  suggestBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  suggestText: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  hintsWrap: { marginTop: -6, marginBottom: 14 },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 5 },
  hintDot: { width: 16, height: 16, borderRadius: 99, alignItems: 'center', justifyContent: 'center' },
  hintText: { fontFamily: 'Inter_500Medium', fontSize: 12 },
  strengthBar: { height: 4, borderRadius: 99, marginTop: 10, overflow: 'hidden' },
  strengthFill: { height: 4, borderRadius: 99 },
  strengthLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 4 },
  error: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18, marginBottom: 12 },
  submitBtn: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  submitText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  forgotLinkBtn: { alignSelf: 'center', paddingVertical: 12, paddingHorizontal: 8 },
  forgotLink: { fontFamily: 'Inter_700Bold', fontSize: 13 },
  forgotIntro: { fontFamily: 'Inter_500Medium', fontSize: 13.5, lineHeight: 19, marginBottom: 16 },
  codeInput: { letterSpacing: 6, fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
});
