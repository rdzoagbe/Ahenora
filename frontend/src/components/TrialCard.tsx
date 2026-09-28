/**
 * Three days before a free trial ends, say so — plainly, once a day.
 *
 * The trial took no card and charges nothing, so the end of it is not a bill
 * arriving; it is the household going back to Free. That still deserves
 * warning: the meal plan they built on it closes on a given day, and hearing
 * it from the app beats finding it shut. "Later" hides it until tomorrow.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Clock } from 'lucide-react-native';

import { useStore } from '../store';
import { PLAN_PRICE } from '../planChange';
import { useUI } from './Kit';
import { PressScale } from './PressScale';

export const TRIAL_WARN_DAYS = 3;

export function TrialCard() {
  const { t, subscription } = useStore();
  const ui = useUI();
  const router = useRouter();
  const trial = subscription?.trial;
  const due = !!trial && trial.days_left <= TRIAL_WARN_DAYS;
  const key = trial ? `trial_card_later:${trial.ends_at}:${trial.days_left}` : '';
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (!due) return;
    let alive = true;
    AsyncStorage.getItem(key)
      .then((v) => { if (alive) setHidden(v === '1'); })
      .catch(() => { if (alive) setHidden(false); });
    return () => { alive = false; };
  }, [due, key]);

  if (!due || hidden || !trial) return null;
  const plan = t(`plan_${trial.plan}`);
  const later = () => {
    setHidden(true);
    AsyncStorage.setItem(key, '1').catch(() => undefined);
  };

  return (
    <View testID="trial-card" style={[styles.card, { backgroundColor: ui.card, borderColor: ui.line }]}>
      <View style={styles.row}>
        <View style={[styles.tile, { backgroundColor: ui.gold }]}>
          <Clock color={ui.goldText} size={19} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: ui.text }]}>
            {trial.days_left <= 1
              ? t('trial_card_title_one', { plan })
              : t('trial_card_title', { plan, n: trial.days_left })}
          </Text>
          <Text style={[styles.msg, { color: ui.muted }]}>
            {t('trial_card_msg', { price: PLAN_PRICE[trial.plan]?.monthly ?? '' })}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <PressScale testID="trial-card-later" accessibilityRole="button" onPress={later}
          style={[styles.btn, { borderColor: ui.line, backgroundColor: ui.soft }]}>
          <Text style={[styles.btnText, { color: ui.text }]}>{t('trial_card_later')}</Text>
        </PressScale>
        <PressScale testID="trial-card-plans" accessibilityRole="button" onPress={() => router.push('/pricing')}
          style={[styles.btn, { borderColor: ui.orangeDeep, backgroundColor: ui.orangeDeep }]}>
          <Text style={[styles.btnText, { color: '#FFFFFF' }]}>{t('trial_card_cta')}</Text>
        </PressScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, borderWidth: 1, padding: 16, gap: 14 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  tile: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: 'Figtree_700Bold', fontSize: 16, lineHeight: 22 },
  msg: { fontFamily: 'Figtree_400Regular', fontSize: 13.5, lineHeight: 19, marginTop: 4 },
  actions: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: 'Figtree_700Bold', fontSize: 14.5 },
});
