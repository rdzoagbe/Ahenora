import React, { useState } from 'react';
import { Alert, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { LegalPage } from '../src/components/LegalPage';
import { PressScale } from '../src/components/PressScale';
import { useStore } from '../src/store';

const SUPPORT_EMAIL = 'rolanddzoagbe@gmail.com';

export default function DeleteAccountScreen() {
  const { user, theme } = useStore();
  const [email, setEmail] = useState(user?.email || '');
  const [reason, setReason] = useState('');

  const sendDeletionRequest = async () => {
    const accountEmail = email.trim();
    if (!accountEmail || !accountEmail.includes('@')) {
      Alert.alert('Email required', 'Enter the Google account email used for Household COO.');
      return;
    }

    const subject = encodeURIComponent('Household COO account deletion request');
    const body = encodeURIComponent(
      `Hello Household COO Support,\n\nI request deletion of my Household COO account and associated data.\n\nAccount email: ${accountEmail}\nReason: ${reason.trim() || 'Not provided'}\n\nPlease confirm once the deletion request has been processed.\n\nThank you.`
    );

    const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (!canOpen) {
      Alert.alert('Could not open email app', `Please email ${SUPPORT_EMAIL} with your account email and deletion request.`);
      return;
    }
    await Linking.openURL(url);
  };

  return (
    <>
      <LegalPage
        title="Delete account"
        subtitle="Request deletion of your Household COO account and associated household data."
        updatedAt="May 2026"
        sections={[
          {
            title: 'What deletion means',
            body: [
              'Your account profile and active session records will be removed or deactivated.',
              'Household records associated only with your account may be removed, including cards, invites, notification tokens, vault records, kids rewards, and related settings where applicable.',
              'Some records may be retained where required for legal, security, abuse-prevention, or operational reasons.',
            ],
          },
          {
            title: 'How to request deletion',
            body: 'Use the request form below to open a pre-filled email. Include the Google account email used for Household COO so the correct account can be located.',
          },
          {
            title: 'Processing time',
            body: 'Deletion requests are reviewed manually during the current testing phase. You will receive a confirmation or follow-up question by email.',
          },
        ]}
      />
      <View style={[styles.floatingForm, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder, shadowColor: theme.colors.shadow }]}>
        <Text style={[styles.formTitle, { color: theme.colors.text }]}>Deletion request</Text>
        <TextInput
          testID="delete-account-email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          placeholder="your.email@example.com"
          placeholderTextColor={theme.colors.textSoft}
          style={[styles.input, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}
        />
        <TextInput
          testID="delete-account-reason"
          value={reason}
          onChangeText={setReason}
          placeholder="Reason, optional"
          placeholderTextColor={theme.colors.textSoft}
          style={[styles.input, styles.reasonInput, { color: theme.colors.text, backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}
          multiline
        />
        <PressScale testID="send-delete-account-request" onPress={sendDeletionRequest} style={[styles.button, { backgroundColor: theme.colors.primary }]}>
          <Text style={[styles.buttonText, { color: theme.colors.primaryText }]}>Email deletion request</Text>
        </PressScale>
        <Text style={[styles.help, { color: theme.colors.textMuted }]}>Support: {SUPPORT_EMAIL}</Text>
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
  formTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, marginBottom: 10 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    marginTop: 8,
  },
  reasonInput: { minHeight: 72, paddingTop: 12, textAlignVertical: 'top' },
  button: { minHeight: 50, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  buttonText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  help: { fontFamily: 'Inter_500Medium', fontSize: 12, textAlign: 'center', marginTop: 9 },
});
