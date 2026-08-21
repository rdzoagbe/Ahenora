import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Check, CalendarDays, LogOut, ListChecks, Lock, Star } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';
import { api, TeenHome } from '../src/api';
import { logger } from '../src/logger';
import { localeFor } from '../src/utils/date';

/**
 * A teen's whole app.
 *
 * Not the household with things hidden — a smaller, private thing: their own
 * tasks and their agenda (family-wide events plus their own). The family
 * calendar, the vault, the other members and every setting are not filtered
 * out on the device — they are unreachable: the login this screen holds is
 * refused by every other endpoint on the server (require_user 403s a teen).
 *
 * Parent ↔ teen chat lands here next.
 */
export default function TeenScreen() {
  const ui = useUI();
  const { user, logout, t, lang } = useStore();
  const router = useRouter();
  const styles = createStyles(ui);

  const [home, setHome] = useState<TeenHome | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  // Tasks the teen just ticked: kept visible in a "waiting for a star" state so
  // the finish isn't a silent disappearance — the star only lands once a parent
  // approves, and the teen should see that it's on its way.
  const [pending, setPending] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setHome(await api.teenHome());
    } catch (e) {
      logger.warn('teen home failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const finish = useCallback(async (cardId: string) => {
    setBusy(cardId);
    try {
      await api.teenFinishTask(cardId);
      setPending((p) => (p.includes(cardId) ? p : [...p, cardId]));
    } catch (e) {
      logger.warn('teen finish task failed', e);
    } finally {
      setBusy(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    router.replace('/');
  }, [logout, router]);

  const firstName = (home?.name || user?.name || '').split(' ')[0];

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.brand}>AHENORA</Text>
          <View style={styles.badge}><Text style={styles.badgeText}>Teen</Text></View>
        </View>
        <PressScale testID="teen-signout" onPress={signOut} style={styles.signOut} accessibilityLabel={t('teen_sign_out')}>
          <LogOut color={ui.muted} size={18} />
        </PressScale>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={ui.orange} size="large" /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.hello}>{firstName ? t('teen_greeting_name', { name: firstName }) : t('teen_greeting')}</Text>

          {/* Stars — earned when a parent approves a finished task */}
          <View style={styles.starsCard}>
            <View style={styles.starsIcon}><Star color={'#E8A93B'} size={22} fill={'#E8A93B'} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.starsCount}>{t('teen_stars_count', { count: home?.stars ?? 0 })}</Text>
              <Text style={styles.starsSub}>
                {home && home.week_earned > 0 ? t('teen_week_earned', { count: home.week_earned }) : t('teen_earn_hint')}
              </Text>
            </View>
          </View>

          {/* Your tasks */}
          <View style={styles.sectionHead}>
            <ListChecks color={ui.orangeText} size={18} />
            <Text style={styles.sectionTitle}>{t('teen_your_tasks')}</Text>
          </View>
          {home && home.tasks.length > 0 ? (
            <View style={styles.card}>
              {home.tasks.map((task, i) => {
                const waiting = pending.includes(task.card_id);
                return (
                  <View key={task.card_id} style={[styles.taskRow, i === 0 && { borderTopWidth: 0 }]}>
                    <PressScale
                      testID={`teen-task-${task.card_id}`}
                      onPress={() => finish(task.card_id)}
                      disabled={waiting || busy === task.card_id}
                      style={[styles.checkbox, waiting && styles.checkboxDone]}
                      accessibilityLabel={`${task.title} — ${waiting ? t('teen_waiting_star') : t('teen_your_tasks')}`}
                    >
                      {busy === task.card_id
                        ? <ActivityIndicator color={ui.orange} size="small" />
                        : <Check color={waiting ? '#fff' : ui.line} size={16} />}
                    </PressScale>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.taskTitle, waiting && styles.taskTitleDone]}>{task.title}</Text>
                      {waiting
                        ? <Text style={styles.waitingMeta}>{t('teen_waiting_star')}</Text>
                        : (task.due_date ? <Text style={styles.taskMeta}>{formatDay(task.due_date, localeFor(lang))}</Text> : null)}
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.empty}>{t('teen_no_tasks')}</Text>
          )}

          {/* Your agenda */}
          <View style={[styles.sectionHead, { marginTop: 26 }]}>
            <CalendarDays color={ui.orangeText} size={18} />
            <Text style={styles.sectionTitle}>{t('teen_your_agenda')}</Text>
          </View>
          {home && home.agenda.length > 0 ? (
            <View style={styles.card}>
              {home.agenda.map((ev, i) => (
                <View key={ev.card_id} style={[styles.evRow, i === 0 && { borderTopWidth: 0 }]}>
                  <View style={styles.dot} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.taskTitle}>{ev.title}</Text>
                    {ev.due_date ? <Text style={styles.taskMeta}>{formatDay(ev.due_date, localeFor(lang))}</Text> : null}
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>{t('teen_no_events')}</Text>
          )}

          {/* What stays private — the same honesty the kid screen shows */}
          <View style={styles.privacy}>
            <Lock color={ui.muted} size={14} />
            <Text style={styles.privacyText}>{t('teen_privacy')}</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function formatDay(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch { return ''; }
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
  brand: { fontFamily: 'Inter_800ExtraBold', fontSize: 13, letterSpacing: 1.6, color: ui.orangeText },
  badge: { alignSelf: 'flex-start', backgroundColor: ui.orangeSoft, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 4, marginTop: 8 },
  badgeText: { fontFamily: 'Inter_800ExtraBold', fontSize: 10, letterSpacing: 0.4, textTransform: 'uppercase', color: ui.orangeText },
  signOut: { width: 40, height: 40, borderRadius: 99, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, paddingBottom: 60 },
  hello: { fontFamily: 'PlayfairDisplay_700Bold', fontSize: 32, letterSpacing: -0.5, color: ui.text, marginTop: 6, marginBottom: 18 },
  starsCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: ui.card, borderRadius: 18, borderWidth: 1, borderColor: ui.line, padding: 16, marginBottom: 24 },
  starsIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: '#FEF6E6', alignItems: 'center', justifyContent: 'center' },
  starsCount: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, color: ui.text },
  starsSub: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: ui.muted, marginTop: 2 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, letterSpacing: -0.2, color: ui.text },
  card: { backgroundColor: ui.card, borderRadius: 20, borderWidth: 1, borderColor: ui.line, paddingHorizontal: 16 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#F1EFEA', minHeight: 48 },
  checkbox: { width: 28, height: 28, borderRadius: 99, borderWidth: 1.5, borderColor: ui.line, alignItems: 'center', justifyContent: 'center' },
  checkboxDone: { backgroundColor: ui.orange, borderColor: ui.orange },
  taskTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: ui.text },
  taskTitleDone: { color: ui.muted, textDecorationLine: 'line-through' },
  taskMeta: { fontFamily: 'Inter_500Medium', fontSize: 12.5, color: ui.muted, marginTop: 2 },
  waitingMeta: { fontFamily: 'Inter_700Bold', fontSize: 12, color: ui.orangeText, marginTop: 2 },
  evRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#F1EFEA', minHeight: 48 },
  dot: { width: 9, height: 9, borderRadius: 99, backgroundColor: ui.orange, marginLeft: 9 },
  empty: { fontFamily: 'Inter_500Medium', fontSize: 14, color: ui.muted, paddingVertical: 4 },
  privacy: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: ui.card, borderWidth: 1, borderColor: ui.line, borderRadius: 14, padding: 12, marginTop: 28 },
  privacyText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 12, lineHeight: 17, color: ui.muted },
});
