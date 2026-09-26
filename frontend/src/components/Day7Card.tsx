/**
 * The one question, a week in.
 *
 * "What's the one thing that would make you open Ahenora every day?" — asked
 * once, on Home, to someone who has had a week to form a view. Answered or
 * dismissed, it is recorded on the account and never asked again, on any
 * device. The answer goes to the support inbox like any other feedback.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MessageCircle } from 'lucide-react-native';

import { api } from '../api';
import { logger } from '../logger';
import { useStore } from '../store';
import { FeedbackSheet } from './FeedbackSheet';
import { useUI } from './Kit';
import { PressScale } from './PressScale';

export function Day7Card() {
  const { t, user, refreshUser } = useStore();
  const ui = useUI();
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);

  if (!user?.day7_feedback_due || hidden) return null;

  const later = () => {
    setHidden(true);
    api.dismissDay7Feedback()
      .then(() => refreshUser?.())
      .catch((e) => logger.warn('day7 dismiss failed', e));
  };

  return (
    <View testID="day7-card" style={[styles.card, { backgroundColor: ui.card, borderColor: ui.line }]}>
      <View style={styles.row}>
        <View style={[styles.tile, { backgroundColor: ui.orangeSoft }]}>
          <MessageCircle color={ui.orangeText} size={19} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.eyebrow, { color: ui.orangeText }]}>{t('fb_day7_eyebrow')}</Text>
          <Text style={[styles.question, { color: ui.text }]}>{t('fb_day7_q')}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <PressScale testID="day7-later" accessibilityRole="button" onPress={later}
          style={[styles.btn, { borderColor: ui.line, backgroundColor: ui.soft }]}>
          <Text style={[styles.btnText, { color: ui.text }]}>{t('fb_day7_later')}</Text>
        </PressScale>
        <PressScale testID="day7-answer" accessibilityRole="button" onPress={() => setOpen(true)}
          style={[styles.btn, { borderColor: ui.orangeDeep, backgroundColor: ui.orangeDeep }]}>
          <Text style={[styles.btnText, { color: '#FFFFFF' }]}>{t('fb_day7_answer')}</Text>
        </PressScale>
      </View>
      <FeedbackSheet
        visible={open}
        onClose={() => setOpen(false)}
        kind="day7"
        prompt={t('fb_day7_q')}
        onSent={() => { setHidden(true); refreshUser?.(); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: 1, padding: 16, gap: 14 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  tile: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: 'Figtree_800ExtraBold', fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase' },
  question: { fontFamily: 'Figtree_700Bold', fontSize: 16, lineHeight: 22, marginTop: 3 },
  actions: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: 'Figtree_700Bold', fontSize: 14.5 },
});
