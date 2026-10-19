/**
 * The end of a free trial: a recap and a thank-you, never a wall.
 *
 * The trial took no card and charges nothing, so its end is not a bill; it is
 * the household going back to Free, with everything it made and a monthly
 * taste of the paid features (7 meals, one weekly report). Roland, 2026-10-15:
 * "I do not want users to feel trapped about having to jump straight to
 * payment after trial."
 *
 * Two moments, one card:
 *   - The last TRIAL_WARN_DAYS days: what the family used so far, what stays
 *     theirs on Free, and the plan that fits. "Later" hides it until tomorrow.
 *   - After it ends (the server marks trial_ended_at for 30 days): a thank-you
 *     with the same recap, shown until "Got it", then never again.
 *
 * The recap lists only what the household actually did in the trial's own
 * dates; a family that did none of it sees the thank-you without a list.
 *
 * The kids come first (2026-10-19). Ahenora is sold on chores the kids want
 * to finish, so when the household has children the recap opens with each
 * child by name, their chores done and stars earned, and the household-wide
 * chores and stars lines step aside so nothing is counted twice on screen.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Clock, Heart } from 'lucide-react-native';

import { api, TrialRecap } from '../api';
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
  const endedAt = !trial ? subscription?.trial_ended_at ?? null : null;
  const mode: 'ending' | 'thanks' | null =
    trial && trial.days_left <= TRIAL_WARN_DAYS ? 'ending' : endedAt ? 'thanks' : null;
  // "Later" hides the countdown for a day; "Got it" closes the thank-you for good.
  const key = mode === 'ending' && trial
    ? `trial_card_later:${trial.ends_at}:${trial.days_left}`
    : mode === 'thanks' ? `trial_thanks_ok:${endedAt}` : '';
  const [hidden, setHidden] = useState(true);
  const [recap, setRecap] = useState<TrialRecap | null>(null);

  useEffect(() => {
    if (!mode) return;
    let alive = true;
    AsyncStorage.getItem(key)
      .then((v) => { if (alive) setHidden(v === '1'); })
      .catch(() => { if (alive) setHidden(false); });
    api.trialRecap()
      .then((r) => { if (alive) setRecap(r); })
      .catch(() => undefined);   // the card still says thank you without the list
    return () => { alive = false; };
  }, [mode, key]);

  if (!mode || hidden) return null;
  // What to suggest is the plan that fits what the household told us at setup
  // (Duo without children, Family with them).
  const keep = (mode === 'ending' ? trial?.recommended_plan ?? trial?.plan : recap?.recommended_plan) ?? 'executive';
  const plan = t(`plan_${keep}`);
  const price = PLAN_PRICE[keep]?.monthly ?? '';
  const kids = recap?.kids ?? [];
  // Named lines already carry the children's chores and stars.
  const items = (recap?.items ?? []).filter((it) => kids.length === 0 || (it.key !== 'chores' && it.key !== 'stars'));
  const count = (key: string, n: number) => (n === 1 ? t(`${key}_one`) : t(key, { n }));
  const close = () => {
    setHidden(true);
    AsyncStorage.setItem(key, '1').catch(() => undefined);
  };

  return (
    <View testID={mode === 'thanks' ? 'trial-thanks' : 'trial-card'}
      style={[styles.card, { backgroundColor: ui.card, borderColor: ui.line }]}>
      <View style={styles.row}>
        <View style={[styles.tile, { backgroundColor: ui.gold }]}>
          {mode === 'thanks' ? <Heart color={ui.goldText} size={19} /> : <Clock color={ui.goldText} size={19} />}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.title, { color: ui.text }]}>
            {mode === 'thanks'
              ? t('trial_thanks_title')
              : trial && trial.days_left <= 1
                ? t('trial_card_title_one')
                : t('trial_card_title', { n: trial?.days_left ?? TRIAL_WARN_DAYS })}
          </Text>
          {kids.length > 0 || items.length > 0 ? (
            <View testID="trial-recap" style={[styles.recap, { backgroundColor: ui.soft }]}>
              <Text style={[styles.recapTitle, { color: ui.muted }]}>{t('trial_recap_title')}</Text>
              {kids.map((kid) => (
                <View key={kid.member_id} testID={`trial-recap-kid-${kid.member_id}`} style={styles.recapRow}>
                  <Text style={[styles.recapNum, styles.kidName, { color: ui.text }]} numberOfLines={1}>{kid.name}</Text>
                  <Text style={[styles.recapLabel, styles.kidLine, { color: ui.text }]}>
                    {[kid.chores > 0 ? count('trial_recap_kid_chores', kid.chores) : null,
                      kid.stars > 0 ? count('trial_recap_kid_stars', kid.stars) : null]
                      .filter(Boolean).join(' · ')}
                  </Text>
                </View>
              ))}
              {items.map((it) => (
                <View key={it.key} testID={`trial-recap-${it.key}`} style={styles.recapRow}>
                  <Text style={[styles.recapNum, { color: ui.text }]}>{it.count}</Text>
                  <Text style={[styles.recapLabel, { color: ui.text }]}>{t(`trial_recap_${it.key}`)}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text style={[styles.msg, { color: ui.muted }]}>
            {mode === 'thanks' ? t('trial_thanks_msg', { plan, price }) : t('trial_card_msg', { plan, price })}
          </Text>
          {mode === 'thanks' && subscription?.children_locked ? (
            <Text testID="trial-thanks-children" style={[styles.msg, { color: ui.muted }]}>
              {t('trial_thanks_children', { plan })}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.actions}>
        <PressScale testID={mode === 'thanks' ? 'trial-thanks-ok' : 'trial-card-later'} accessibilityRole="button" onPress={close}
          style={[styles.btn, { borderColor: ui.line, backgroundColor: ui.soft }]}>
          <Text style={[styles.btnText, { color: ui.text }]}>
            {mode === 'thanks' ? t('trial_thanks_ok') : t('trial_card_later')}
          </Text>
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
  msg: { fontFamily: 'Figtree_400Regular', fontSize: 13.5, lineHeight: 19, marginTop: 6 },
  recap: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginTop: 10, gap: 4 },
  recapTitle: { fontFamily: 'Figtree_700Bold', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 2 },
  recapRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  recapNum: { fontFamily: 'Figtree_700Bold', fontSize: 16, minWidth: 24 },
  kidName: { maxWidth: 120 },
  kidLine: { flex: 1, flexShrink: 1 },
  recapLabel: { fontFamily: 'Figtree_400Regular', fontSize: 14 },
  actions: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, minHeight: 46, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontFamily: 'Figtree_700Bold', fontSize: 14.5 },
});
