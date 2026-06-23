import React, { useState } from 'react';
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
import { X, Mail } from 'lucide-react-native';

import { PressScale } from './PressScale';
import { useStore } from '../store';
import { logger } from '../logger';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
  inviteToken?: string | null;
}

type Mode = 'signup' | 'login';

export function EmailAuthModal({ visible, onClose, onSuccess, inviteToken }: Props) {
  const { theme, setUserFromAuth } = useStore();
  const c = theme.colors;

  const [mode, setMode] = useState<Mode>('signup');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (mode === 'signup' && !name.trim()) {
      setError('Please enter your name.');
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
          : await api.loginWithEmail({ email: trimmedEmail, password });

      await setUserFromAuth(result.user, result.session_token);
      reset();
      onSuccess();
    } catch (e: any) {
      logger.warn('email auth failed', e?.message || e);
      const raw = String(e?.message || '');
      // request() throws `${status}: ${body}` — surface the readable detail when present.
      const match = raw.match(/\{.*"detail"\s*:\s*"([^"]+)"/);
      setError(match?.[1] || (mode === 'signup' ? 'Could not create your account. Please try again.' : 'Could not sign you in. Please try again.'));
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
              {mode === 'signup' ? 'Create your account' : 'Welcome back'}
            </Text>
            <PressScale onPress={close} style={[styles.closeBtn, { borderColor: c.cardBorder, backgroundColor: c.bgSoft }]}>
              <X color={c.text} size={18} />
            </PressScale>
          </View>

          <View style={[styles.modeToggle, { backgroundColor: c.bgSoft, borderColor: c.cardBorder }]}>
            <PressScale onPress={() => { setMode('signup'); setError(null); }} style={[styles.modeOption, mode === 'signup' && { backgroundColor: c.primary }]}>
              <Text style={[styles.modeText, { color: mode === 'signup' ? c.primaryText : c.textMuted }]}>Sign up</Text>
            </PressScale>
            <PressScale onPress={() => { setMode('login'); setError(null); }} style={[styles.modeOption, mode === 'login' && { backgroundColor: c.primary }]}>
              <Text style={[styles.modeText, { color: mode === 'login' ? c.primaryText : c.textMuted }]}>Log in</Text>
            </PressScale>
          </View>

          {mode === 'signup' ? (
            <>
              <Text style={[styles.label, { color: c.textMuted }]}>Name</Text>
              <TextInput
                style={[styles.input, { color: c.text, borderColor: c.cardBorder, backgroundColor: c.bgSoft }]}
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={c.textSoft}
                autoCapitalize="words"
                returnKeyType="next"
              />
            </>
          ) : null}

          <Text style={[styles.label, { color: c.textMuted }]}>Email</Text>
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

          <Text style={[styles.label, { color: c.textMuted }]}>Password</Text>
          <TextInput
            style={[styles.input, { color: c.text, borderColor: c.cardBorder, backgroundColor: c.bgSoft }]}
            value={password}
            onChangeText={setPassword}
            placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
            placeholderTextColor={c.textSoft}
            secureTextEntry
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={submit}
          />

          {error ? <Text style={[styles.error, { color: '#EF4444' }]}>{error}</Text> : null}

          <PressScale onPress={submit} disabled={busy} style={[styles.submitBtn, { backgroundColor: c.primary, opacity: busy ? 0.6 : 1 }]}>
            {busy ? (
              <ActivityIndicator color={c.primaryText} size="small" />
            ) : (
              <Text style={[styles.submitText, { color: c.primaryText }]}>
                {mode === 'signup' ? 'Create account' : 'Log in'}
              </Text>
            )}
          </PressScale>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
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
  error: { fontFamily: 'Inter_600SemiBold', fontSize: 13, lineHeight: 18, marginBottom: 12 },
  submitBtn: { height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  submitText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
});
