import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
import { useStore, RETURNING_USER_KEY } from '../store';
import { logger } from '../logger';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  inviteToken?: string | null;
}

type Mode = 'signup' | 'login';

export function EmailAuthModal({ visible, onClose, onSuccess, inviteToken }: Props) {
  const { theme, setUserFromAuth, t } = useStore();
  const c = theme.colors;

  // An invite is a join, so it opens on Sign Up. Otherwise default to Log In
  // for anyone who has signed in on this device before — the returning user
  // signing back in after a sign-out is the common case, and landing them on
  // Sign Up asked them to create a second account. A genuinely new device with
  // no history still opens on Sign Up.
  const [mode, setMode] = useState<Mode>(inviteToken ? 'signup' : 'login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Refine the default once we can read the device's history. Initial state
  // above is Log In (the common returning case, never flashing Sign Up at
  // them); this switches a genuinely new, uninvited device to Sign Up.
  useEffect(() => {
    if (!visible) return;
    // The invite loads asynchronously after mount, so `inviteToken` is null on
    // the first render and the initial state captured Log In. When it arrives
    // this effect re-runs (it's a dep) and flips to Sign Up — an invite is a
    // join. Early-returning on a truthy token used to leave an invited new
    // user stranded on the Log In tab, where their non-existent account failed.
    if (inviteToken) { setMode('signup'); return; }
    let cancelled = false;
    AsyncStorage.getItem(RETURNING_USER_KEY)
      .then((seen) => { if (!cancelled && !seen) setMode('signup'); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [visible, inviteToken]);

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

      await setUserFromAuth(result.user, result.session_token);
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
              {mode === 'signup' ? t('email_create_title') : t('email_welcome_back')}
            </Text>
            <PressScale
                  accessibilityRole="button"
                  accessibilityLabel={t('close')} onPress={close} style={[styles.closeBtn, { borderColor: c.cardBorder, backgroundColor: c.bgSoft }]}>
              <X color={c.text} size={18} />
            </PressScale>
          </View>

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
});
