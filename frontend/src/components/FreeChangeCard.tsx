/**
 * Free became a plan for adults on 2026-09-29. A household that was already
 * on Free with children keeps them until a date, and is told so here — in
 * good time, on Home, in plain words — rather than finding them gone.
 *
 * Shown only while that date is in the future; after it the Family hub says
 * the children are kept (ChildrenLockedCard). "Later" hides it for a week.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { CalendarClock } from 'lucide-react-native';

import { useStore } from '../store';
import { localeFor } from '../utils/date';
import { useUI } from './Kit';
import { PressScale } from './PressScale';

const LATER_KEY = 'free_change_later_until';
const LATER_DAYS = 7;

export function FreeChangeCard() {
  const { t, lang, subscription } = useStore();
  const ui = useUI();
  const router = useRouter();
  const until = subscription?.free_children_until;
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (!until) return;
    let alive = true;
    AsyncStorage.getItem(LATER_KEY)
      .then((v) => { if (alive) setHidden(!!v && Number(v) > Date.now()); })
      .catch(() => { if (alive) setHidden(false); });
    return () => { alive = false; };
  }, [until]);

  if (!until || hidden) return null;
  const date = new Date(until).toLocaleDateString(localeFor(lang), { day: 'numeric', month: 'long' });
  const later = () => {
    setHidden(true);
    AsyncStorage.setItem(LATER_KEY, String(Date.now() + LATER_DAYS * 86400000)).catch(() => undefined);
  };

  return (
    <View testID="free-change-card" style={[styles.card, { backgroundColor: ui.card, borderColor: ui.line }]}>
      <View style={styles.row}>
        <View style={[styles.tile, { backgroundColor: ui.gold }]}>
          <CalendarClock color={ui.goldText} size={19} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: ui.text }]}>{t('free_change_title', { date })}</Text>
          <Text style={[styles.msg, { color: ui.muted }]}>{t('free_change_msg', { date })}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <PressScale testID="free-change-later" accessibilityRole="button" onPress={later}
          style={[styles.btn, { borderColor: ui.line, backgroundColor: ui.soft }]}>
          <Text style={[styles.btnText, { color: ui.text }]}>{t('trial_card_later')}</Text>
        </PressScale>
        <PressScale testID="free-change-plans" accessibilityRole="button" onPress={() => router.push('/pricing')}
          style={[styles.btn, { borderColor: ui.orangeDeep, backgroundColor: ui.orangeDeep }]}>
          <Text style={[styles.btnText, { color: '#FFFFFF' }]}>{t('children_locked_cta')}</Text>
        </PressScale>
      </View>
    </View>
  );
}

/** After the date: the children are kept, and one tap from coming back. */
export function ChildrenLockedCard() {
  const { t, subscription } = useStore();
  const ui = useUI();
  const router = useRouter();
  if (!subscription?.children_locked) return null;
  return (
    <View testID="children-locked-card" style={[styles.card, { backgroundColor: ui.card, borderColor: ui.line }]}>
      <Text style={[styles.title, { color: ui.text }]}>{t('children_locked_title')}</Text>
      <Text style={[styles.msg, { color: ui.muted }]}>{t('children_locked_msg')}</Text>
      <PressScale testID="children-locked-plans" accessibilityRole="button" onPress={() => router.push('/pricing')}
        style={[styles.btn, { borderColor: ui.orangeDeep, backgroundColor: ui.orangeDeep, flex: 0 }]}>
        <Text style={[styles.btnText, { color: '#FFFFFF' }]}>{t('children_locked_cta')}</Text>
      </PressScale>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: 1, padding: 16, gap: 12 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  tile: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Figtree_700Bold', fontSize: 16, lineHeight: 22 },
  msg: { fontFamily: 'Figtree_400Regular', fontSize: 13.5, lineHeight: 19, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  btnText: { fontFamily: 'Figtree_700Bold', fontSize: 14.5 },
});
