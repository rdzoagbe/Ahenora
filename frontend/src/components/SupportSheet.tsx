/**
 * Write to support, from Settings.
 *
 * The form lived on the Account screen, under a "Legal & support" heading
 * that Settings had come to carry as well; the merge of 2026-10-31 left one
 * copy, here, where Help and support is. It goes to the support inbox as a
 * support request (emailed, pushed to the admin's phone, listed on the
 * metrics screen) and says a reply will come, which is what distinguishes it
 * from feedback.
 */
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { Send, X } from 'lucide-react-native';
import { api } from '../api';
import { useStore } from '../store';
import KeyboardAwareBottomSheet from './KeyboardAwareBottomSheet';
import { useUI } from './Kit';
import { PressScale } from './PressScale';

export function SupportSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useStore();
  const ui = useUI();
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (sending) return;
    const subj = subject.trim();
    const msg = message.trim();
    if (!subj || !msg) {
      Alert.alert(t('acc_missing_fields_title'), t('acc_missing_fields_msg'));
      return;
    }
    setSending(true);
    try {
      await api.submitSupportRequest({ subject: subj, message: msg });
      setSubject('');
      setMessage('');
      onClose();
      Alert.alert(t('acc_sent_title'), t('acc_sent_msg'));
    } catch {
      Alert.alert(t('acc_error_title'), t('acc_send_error_msg'));
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAwareBottomSheet visible={visible} onClose={onClose}
      contentStyle={[styles.sheet, { backgroundColor: ui.card, borderColor: ui.line }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: ui.text }]}>{t('acc_contact_support')}</Text>
        <PressScale testID="support-close" accessibilityRole="button" accessibilityLabel={t('close')} onPress={onClose}
          style={[styles.iconBtn, { borderColor: ui.line }]}>
          <X color={ui.text} size={18} />
        </PressScale>
      </View>
      <Text style={[styles.label, { color: ui.muted }]}>{t('acc_subject')}</Text>
      <TextInput
        testID="support-subject"
        style={[styles.input, { color: ui.text, borderColor: ui.line, backgroundColor: ui.soft }]}
        value={subject}
        onChangeText={setSubject}
        placeholder={t('acc_subject_placeholder')}
        placeholderTextColor={ui.muted}
        maxLength={200}
        returnKeyType="next"
      />
      <Text style={[styles.label, { color: ui.muted }]}>{t('acc_message')}</Text>
      <TextInput
        testID="support-message"
        style={[styles.input, styles.textArea, { color: ui.text, borderColor: ui.line, backgroundColor: ui.soft }]}
        value={message}
        onChangeText={setMessage}
        placeholder={t('acc_message_placeholder')}
        placeholderTextColor={ui.muted}
        maxLength={5000}
        multiline
        textAlignVertical="top"
      />
      <PressScale testID="support-send" accessibilityRole="button" onPress={submit} disabled={sending}
        style={[styles.sendBtn, { backgroundColor: ui.orangeDeep, opacity: sending ? 0.6 : 1 }]}>
        <Send color="#FFFFFF" size={16} />
        <Text style={styles.sendText}>{sending ? t('acc_sending') : t('acc_send_message')}</Text>
      </PressScale>
    </KeyboardAwareBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, padding: 24, paddingBottom: 120 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  title: { fontFamily: 'Figtree_800ExtraBold', fontSize: 22 },
  iconBtn: { width: 40, height: 40, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: 'Figtree_600SemiBold', fontSize: 13, marginTop: 10, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Figtree_500Medium', fontSize: 15 },
  textArea: { minHeight: 120 },
  sendBtn: { marginTop: 18, minHeight: 52, borderRadius: 99, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  sendText: { color: '#FFFFFF', fontFamily: 'Figtree_800ExtraBold', fontSize: 15 },
});
