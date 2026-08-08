import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LegalPage } from '../src/components/LegalPage';
import { PressScale } from '../src/components/PressScale';
import { PasswordInput } from '../src/components/PasswordInput';
import { useStore } from '../src/store';
import { logger } from '../src/logger';

/**
 * Deleting your own account — self-service, immediate, and honest about what
 * goes. The old screen opened a support email and waited for a human; the
 * store requires the real thing, and so does anyone who ever wants out.
 *
 * The confirmation is deliberate friction, not a formality: a password account
 * re-enters its password; a Google account types DELETE. Either way the server
 * decides what leaves — the whole household if you are the last account, only
 * you if a co-parent remains — and this screen only has to send them home
 * afterwards.
 */
export default function DeleteAccountScreen() {
  const { user, theme, t, deleteAccount } = useStore();
  const router = useRouter();
  const c = theme.colors;

  const hasPassword = user?.has_password;
  const [password, setPassword] = useState('');
  const [confirmWord, setConfirmWord] = useState('');
  const [busy, setBusy] = useState(false);

  const ready = hasPassword ? password.length > 0 : confirmWord.trim().toUpperCase() === 'DELETE';

  const runDelete = async () => {
    setBusy(true);
    try {
      const out = await deleteAccount(
        hasPassword ? { password } : { confirm: true },
      );
      // Signed out already by the store. Land on the home / sign-up screen —
      // there is no account to come back to.
      router.replace('/');
      return out;
    } catch (error: any) {
      setBusy(false);
      Alert.alert(t('del_failed_title'), error?.message || t('del_failed_body'));
    }
  };

  const confirmThenDelete = () => {
    if (!ready || busy) return;
    // The last gate: a plain-language warning naming exactly what is destroyed.
    Alert.alert(
      t('del_confirm_title'),
      t('del_confirm_body'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('del_confirm_cta'), style: 'destructive', onPress: () => { runDelete().catch((e) => logger.warn('delete failed', e)); } },
      ],
    );
  };

  return (
    <>
      <LegalPage
        title={t('del_title')}
        subtitle={t('del_subtitle')}
        updatedAt="August 2026"
        sections={[
          {
            title: t('del_what_title'),
            body: [
              t('del_what_1'),
              t('del_what_2'),
              t('del_what_3'),
            ],
          },
          {
            title: t('del_now_title'),
            body: t('del_now_body'),
          },
        ]}
      />
      <View style={[styles.floatingForm, { backgroundColor: c.card, borderColor: c.cardBorder, shadowColor: c.shadow }]}>
        <Text style={[styles.formTitle, { color: c.danger }]}>{t('del_form_title')}</Text>
        <Text style={[styles.formSub, { color: c.textMuted }]}>
          {hasPassword ? t('del_password_prompt') : t('del_type_prompt')}
        </Text>
        {hasPassword ? (
          <PasswordInput
            testID="delete-account-password"
            value={password}
            onChangeText={setPassword}
            placeholder={t('del_password_ph')}
            placeholderTextColor={c.textMuted}
            eyeColor={c.textMuted}
            showLabel={t('a11y_show_password')}
            hideLabel={t('a11y_hide_password')}
            style={[styles.input, { color: c.text, backgroundColor: c.bgSoft, borderColor: c.cardBorder }]}
          />
        ) : (
          <TextInput
            testID="delete-account-confirm"
            value={confirmWord}
            onChangeText={setConfirmWord}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="DELETE"
            placeholderTextColor={c.textMuted}
            style={[styles.input, { color: c.text, backgroundColor: c.bgSoft, borderColor: c.cardBorder }]}
          />
        )}
        <PressScale
          testID="delete-account-submit"
          accessibilityRole="button"
          disabled={!ready || busy}
          onPress={confirmThenDelete}
          style={[styles.button, { backgroundColor: c.danger, opacity: !ready || busy ? 0.5 : 1 }]}
        >
          <Text style={styles.buttonText}>{busy ? t('del_deleting') : t('del_button')}</Text>
        </PressScale>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  floatingForm: {
    position: 'absolute',
    left: 22,
    right: 22,
    bottom: 22,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.14,
    shadowRadius: 20,
    elevation: 6,
  },
  formTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18 },
  formSub: { fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18, marginTop: 4, marginBottom: 4 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    marginTop: 8,
  },
  button: { minHeight: 50, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  buttonText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15, color: '#FFFFFF' },
});
