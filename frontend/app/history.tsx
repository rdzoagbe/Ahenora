import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronLeft, Eye, RotateCcw, Trash2 } from 'lucide-react-native';

import { PressScale } from '../src/components/PressScale';
import { MiniRow, useUI, UIColors } from '../src/components/Kit';
import { useStore } from '../src/store';
import { api, ActivityEntry, Card } from '../src/api';
import { activityPhrase } from '../src/activityPhrase';
import { groupByWeek } from '../src/completedHistory';
import { localeFor } from '../src/utils/date';
import { logger } from '../src/logger';

/**
 * Everything that left Home, in one place, with a way back.
 *
 * Two kinds of thing leave Home: a card somebody ticked off, and a household
 * line somebody cleared with the X. The first used to live under Settings ›
 * More › Completed history, the second nowhere at all. Both are here, reached
 * from the Done card on Home, so what you removed from the feed page is found
 * from the feed page.
 */
export default function HistoryRoute() {
  const ui = useUI();
  const router = useRouter();
  const { t, lang } = useStore();
  const styles = useMemo(() => createStyles(ui), [ui]);

  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState<Card[]>([]);
  const [hidden, setHidden] = useState<ActivityEntry[]>([]);

  const load = useCallback(async () => {
    try {
      const [cards, lines] = await Promise.all([
        api.listCards('DONE').catch(() => [] as Card[]),
        api.listHiddenActivity().catch(() => [] as ActivityEntry[]),
      ]);
      setDone(cards);
      setHidden(lines);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => groupByWeek(done, t), [done, t]);

  const restore = (card: Card) => {
    Alert.alert(t('set_restore_card_title'), `"${card.title}" ${t('set_restore_card_msg')}`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('set_restore'),
        onPress: async () => {
          setDone((prev) => prev.filter((c) => c.card_id !== card.card_id));
          try {
            await api.updateCard(card.card_id, { status: 'OPEN' });
          } catch (e) {
            logger.warn('restore failed', e);
            Alert.alert(t('set_error'), t('set_restore_error'));
            load();
          }
        },
      },
    ]);
  };

  // Permanent removal — the card AND its "done" line go. Restore un-completes;
  // this erases, which is why it asks.
  const remove = (card: Card) => {
    Alert.alert(t('set_delete_card_title'), `"${card.title}" ${t('set_delete_card_msg')}`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('set_delete'),
        style: 'destructive',
        onPress: async () => {
          setDone((prev) => prev.filter((c) => c.card_id !== card.card_id));
          try {
            await api.deleteCard(card.card_id);
          } catch (e) {
            logger.warn('delete failed', e);
            Alert.alert(t('set_error'), t('set_delete_error'));
            load();
          }
        },
      },
    ]);
  };

  const unhide = async (entry: ActivityEntry) => {
    setHidden((prev) => prev.filter((e) => e.activity_id !== entry.activity_id));
    try {
      await api.unhideActivity(entry.activity_id);
    } catch (e) {
      logger.warn('unhide failed', e);
      Alert.alert(t('set_error'), t('feed_change_not_saved'));
      load();
    }
  };

  const dateLine = (card: Card) => {
    const who = card.completed_by_name || card.assignee || t('set_family');
    const when = card.completed_at
      ? new Date(card.completed_at).toLocaleDateString(localeFor(lang), { weekday: 'short', day: 'numeric', month: 'short' })
      : '';
    return [who, when].filter(Boolean).join(' · ');
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <PressScale
          testID="history-back"
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)/feed' as never))}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t('back')}
        >
          <ChevronLeft color={ui.text} size={22} />
        </PressScale>
        <Text style={styles.headTitle} numberOfLines={1}>{t('hist_title')}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <ActivityIndicator color={ui.orange} style={{ paddingVertical: 32 }} />
        ) : groups.length === 0 ? (
          <Text style={styles.empty} testID="history-empty">{t('hist_empty')}</Text>
        ) : groups.map((group) => (
          <View key={group.key} style={styles.group} testID={`history-week-${group.key}`}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            <View style={styles.card}>
              {group.cards.map((card, i) => (
                <View key={card.card_id} style={[styles.row, i > 0 && styles.rowLine]} testID={`history-card-${card.card_id}`}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <MiniRow
                      initial={card.type === 'TASK' ? 'T' : card.type === 'RSVP' ? 'R' : 'S'}
                      name={card.title}
                      sub={dateLine(card)}
                    />
                  </View>
                  <PressScale
                    testID={`history-restore-${card.card_id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('set_restore')}
                    onPress={() => restore(card)}
                    style={styles.ghostBtn}
                  >
                    <RotateCcw color={ui.text} size={14} />
                    <Text style={styles.ghostBtnText}>{t('set_restore')}</Text>
                  </PressScale>
                  <PressScale
                    testID={`history-delete-${card.card_id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('set_delete')}
                    onPress={() => remove(card)}
                    hitSlop={8}
                    style={styles.deleteBtn}
                  >
                    <Trash2 color={ui.danger} size={15} />
                  </PressScale>
                </View>
              ))}
            </View>
          </View>
        ))}

        {!loading && hidden.length > 0 ? (
          <View style={styles.group} testID="history-hidden">
            <Text style={styles.groupLabel}>{t('hist_hidden_title')}</Text>
            <Text style={styles.groupSub}>{t('hist_hidden_sub')}</Text>
            <View style={styles.card}>
              {hidden.map((entry, i) => (
                <View key={entry.activity_id} style={[styles.row, i > 0 && styles.rowLine]} testID={`history-hidden-${entry.activity_id}`}>
                  <Text style={styles.lineText} numberOfLines={2}>
                    <Text style={styles.lineActor}>{entry.actor_name || t('feed_activity_someone')}</Text>
                    {' '}
                    {activityPhrase(entry, t)}
                  </Text>
                  <PressScale
                    testID={`history-unhide-${entry.activity_id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('hist_unhide')}
                    onPress={() => unhide(entry)}
                    style={styles.ghostBtn}
                  >
                    <Eye color={ui.text} size={14} />
                    <Text style={styles.ghostBtnText}>{t('hist_unhide')}</Text>
                  </PressScale>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (ui: UIColors) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: ui.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: ui.line,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headTitle: { flex: 1, textAlign: 'center', fontFamily: 'Figtree_800ExtraBold', fontSize: 18, color: ui.text },
  scroll: { padding: 16, paddingBottom: 48, gap: 18 },
  empty: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 14, textAlign: 'center', paddingVertical: 32 },
  group: { gap: 8 },
  groupLabel: {
    color: ui.muted, fontFamily: 'Figtree_800ExtraBold', fontSize: 11.5,
    letterSpacing: 1.2, textTransform: 'uppercase', paddingHorizontal: 4,
  },
  groupSub: { color: ui.muted, fontFamily: 'Figtree_500Medium', fontSize: 12.5, paddingHorizontal: 4, marginTop: -4 },
  card: {
    backgroundColor: ui.card, borderRadius: 18, borderWidth: 1, borderColor: ui.line,
    paddingHorizontal: 14, paddingVertical: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  rowLine: { borderTopWidth: 1, borderTopColor: ui.line },
  ghostBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 10,
    borderRadius: 15, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft,
  },
  ghostBtnText: { color: ui.text, fontFamily: 'Figtree_700Bold', fontSize: 12 },
  deleteBtn: { padding: 8, borderRadius: 99, borderWidth: 1, borderColor: ui.line, backgroundColor: ui.soft },
  lineText: { flex: 1, minWidth: 0, color: ui.text, fontFamily: 'Figtree_500Medium', fontSize: 13.5, lineHeight: 19 },
  lineActor: { fontFamily: 'Figtree_700Bold' },
});
