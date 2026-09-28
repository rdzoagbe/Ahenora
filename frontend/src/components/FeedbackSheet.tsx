/**
 * Tell Roland what you think, from anywhere in the app.
 *
 * Lands in the same support inbox as "Contact support" — emailed, pushed to
 * the admin's phone and listed on the metrics screen — labelled as feedback,
 * so it is read in the one place that is already read. Feedback asks for no
 * reply, so it sends no "we'll get back to you".
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { X } from 'lucide-react-native';

import { api } from '../api';
import { logger } from '../logger';
import { useStore } from '../store';
import KeyboardAwareBottomSheet from './KeyboardAwareBottomSheet';
import { useUI } from './Kit';
import { PressScale } from './PressScale';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** "day7" is the week-in question; "feedback" is the open button. */
  kind?: 'feedback' | 'day7';
  /** Shown above the box instead of the general invitation to write. */
  prompt?: string;
  onSent?: () => void;
};

export function FeedbackSheet({ visible, onClose, kind = 'feedback', prompt, onSent }: Props) {
  const { t } = useStore();
  const ui = useUI();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on the way out, not on the way in, so the next opening starts clean.
  const close = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setSent(false);
    setFailed(false);
    onClose();
  };

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const send = async () => {
    const message = text.trim();
    if (!message || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await api.submitSupportRequest({
        subject: kind === 'day7' ? 'One week in: what would make it daily' : 'Feedback',
        message,
        kind,
      });
      setSent(true);
      setText('');
      onSent?.();
      closeTimer.current = setTimeout(close, 1400);
    } catch (e) {
      logger.warn('feedback not sent', e);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const canSend = !!text.trim() && !busy;

  return (
    <KeyboardAwareBottomSheet visible={visible} onClose={close}
      contentStyle={[styles.sheet, { backgroundColor: ui.card, borderColor: ui.line }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: ui.text }]}>{t('fb_title')}</Text>
        <PressScale testID="feedback-close" accessibilityRole="button" accessibilityLabel={t('close')}
          onPress={close} style={[styles.iconBtn, { borderColor: ui.line }]}>
          <X color={ui.text} size={20} />
        </PressScale>
      </View>
      {sent ? (
        <Text testID="feedback-thanks" style={[styles.thanks, { color: ui.mintText }]}>{t('fb_thanks')}</Text>
      ) : (
        <>
          <Text style={[styles.help, { color: ui.muted }]}>{prompt || t('fb_help')}</Text>
          <TextInput
            testID="feedback-input"
            value={text}
            onChangeText={setText}
            placeholder={t('fb_placeholder')}
            placeholderTextColor={ui.muted}
            multiline
            maxLength={5000}
            accessibilityLabel={prompt || t('fb_title')}
            style={[styles.input, { color: ui.text, backgroundColor: ui.soft, borderColor: ui.line }]}
          />
          {failed ? <Text style={[styles.error, { color: ui.danger }]}>{t('fb_error')}</Text> : null}
          <PressScale testID="feedback-send" accessibilityRole="button" onPress={send} disabled={!canSend}
            style={[styles.send, { backgroundColor: ui.orangeDeep, opacity: canSend ? 1 : 0.45 }]}>
            <Text style={styles.sendText}>{busy ? t('fb_sending') : t('fb_send')}</Text>
          </PressScale>
        </>
      )}
    </KeyboardAwareBottomSheet>
  );
}

const styles = StyleSheet.create({
  sheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, padding: 20, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 22 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  help: { fontFamily: 'Figtree_500Medium', fontSize: 14, lineHeight: 20 },
  input: {
    minHeight: 120, borderRadius: 16, borderWidth: 1, padding: 14,
    fontFamily: 'Figtree_500Medium', fontSize: 15, lineHeight: 21, textAlignVertical: 'top',
  },
  error: { fontFamily: 'Figtree_600SemiBold', fontSize: 13 },
  send: { height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#FFFFFF', fontFamily: 'Figtree_700Bold', fontSize: 16 },
  thanks: { fontFamily: 'Figtree_700Bold', fontSize: 16, paddingVertical: 24, textAlign: 'center' },
});
