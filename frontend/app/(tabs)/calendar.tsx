import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { CalendarDays, RefreshCw, ShieldCheck, Users, X, Clock3 } from 'lucide-react-native';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { GlassCard } from '../../src/components/GlassCard';
import { PressScale } from '../../src/components/PressScale';
import { useStore } from '../../src/store';
import { api, CalendarImportResult, Card } from '../../src/api';

WebBrowser.maybeCompleteAuthSession();

const TYPE_COLOR: Record<string, string> = {
  SIGN_SLIP: '#F97316',
  RSVP: '#6366F1',
  TASK: '#10B981',
};

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';

function startOfLocalDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(date: Date) {
  const d = startOfLocalDay(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function cardDateKey(card: Card) {
  if (!card.due_date) return '';
  return dateKey(new Date(card.due_date));
}

function buildMonthDays(baseDate: Date) {
  const first = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1);
  const last = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0);
  const leading = first.getDay();
  const total = leading + last.getDate();
  const trailing = Math.ceil(total / 7) * 7 - total;
  const days: { date: Date; inMonth: boolean }[] = [];

  for (let i = leading; i > 0; i -= 1) days.push({ date: new Date(baseDate.getFullYear(), baseDate.getMonth(), 1 - i), inMonth: false });
  for (let day = 1; day <= last.getDate(); day += 1) days.push({ date: new Date(baseDate.getFullYear(), baseDate.getMonth(), day), inMonth: true });
  for (let i = 1; i <= trailing; i += 1) days.push({ date: new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, i), inMonth: false });

  return days;
}

export default function CalendarScreen() {
  const { t, lang, theme } = useStore();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<CalendarImportResult | null>(null);
  const [activeMonth, setActiveMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string>(dateKey(new Date()));
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const handledCalendarResponseRef = useRef(false);

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;

  const [calendarRequest, calendarResponse, promptCalendarAsync] = Google.useAuthRequest({
    androidClientId,
    webClientId,
    scopes: ['openid', 'profile', 'email', GOOGLE_CALENDAR_SCOPE],
  });

  const load = useCallback(async () => {
    try {
      const result = await api.listCards();
      setCards(result.filter((card) => card.status === 'OPEN' && card.due_date));
    } catch (error) {
      console.log('calendar load failed', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const importCalendar = async () => {
      if (!calendarResponse || handledCalendarResponseRef.current) return;
      if (calendarResponse.type !== 'success') {
        if (calendarResponse.type === 'error') Alert.alert('Calendar sync failed', 'Google Calendar permission was not granted.');
        return;
      }
      handledCalendarResponseRef.current = true;
      const accessToken = calendarResponse.authentication?.accessToken || calendarResponse.params?.access_token;
      if (!accessToken) {
        Alert.alert('Calendar sync failed', 'Google did not return a calendar access token.');
        handledCalendarResponseRef.current = false;
        return;
      }
      setSyncing(true);
      try {
        const result = await api.importGoogleCalendar(accessToken, 30);
        setSyncResult(result);
        await load();
        Alert.alert('Calendar synced', `${result.imported} events imported. ${result.contacts_found} people found.`);
      } catch (error: any) {
        console.log('calendar sync failed', error);
        Alert.alert('Calendar sync failed', error?.message || 'Please try again.');
      } finally {
        setSyncing(false);
        handledCalendarResponseRef.current = false;
      }
    };
    importCalendar();
  }, [calendarResponse, load]);

  const monthDays = useMemo(() => buildMonthDays(activeMonth), [activeMonth]);

  const countsByDay = useMemo(() => {
    const counts: Record<string, number> = {};
    cards.forEach((card) => {
      const key = cardDateKey(card);
      if (!key) return;
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [cards]);

  const selectedItems = useMemo(() => {
    return cards
      .filter((card) => cardDateKey(card) === selectedDay)
      .sort((a, b) => new Date(a.due_date || '').getTime() - new Date(b.due_date || '').getTime());
  }, [cards, selectedDay]);

  const upcomingGroups = useMemo(() => {
    const groups: Record<string, Card[]> = {};
    cards.forEach((card) => {
      const key = cardDateKey(card);
      if (!key || key === selectedDay) return;
      groups[key] = groups[key] || [];
      groups[key].push(card);
    });
    return Object.keys(groups).sort().slice(0, 5).map((day) => ({
      day,
      items: groups[day].sort((a, b) => new Date(a.due_date || '').getTime() - new Date(b.due_date || '').getTime()),
    }));
  }, [cards, selectedDay]);

  const monthTitle = activeMonth.toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US', { month: 'long', year: 'numeric' });

  const formatDay = (day: string) => {
    const date = new Date(`${day}T00:00:00`);
    const today = startOfLocalDay(new Date());
    const diffDays = Math.round((startOfLocalDay(date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return lang === 'fr' ? "Aujourd'hui" : lang === 'es' ? 'Hoy' : 'Today';
    if (diffDays === 1) return lang === 'fr' ? 'Demain' : lang === 'es' ? 'Mañana' : 'Tomorrow';
    return date.toLocaleDateString(lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US', { weekday: 'long', month: 'short', day: 'numeric' });
  };

  const syncCalendar = async () => {
    if (!webClientId || !androidClientId) {
      Alert.alert('Google Calendar not configured', 'Missing Google OAuth client IDs.');
      return;
    }
    if (!calendarRequest) {
      Alert.alert('Google Calendar not ready', 'Please try again in a moment.');
      return;
    }
    setSyncResult(null);
    handledCalendarResponseRef.current = false;
    await promptCalendarAsync();
  };

  const shiftMonth = (amount: number) => {
    setActiveMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  };

  const onSelectDay = (key: string, date: Date) => {
    setSelectedDay(key);
    if (date.getMonth() !== activeMonth.getMonth() || date.getFullYear() !== activeMonth.getFullYear()) {
      setActiveMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  };

  const renderAgendaCard = (card: Card) => {
    const color = TYPE_COLOR[card.type] || theme.colors.success;
    const isGoogle = card.source === 'CALENDAR' || card.external_source === 'google_calendar';
    return (
      <PressScale key={card.card_id} testID={`calendar-item-${card.card_id}`} onPress={() => setSelectedCard(card)} style={{ marginTop: 12 }}>
        <GlassCard>
          <View style={styles.itemRow}>
            <View style={[styles.dot, { backgroundColor: color }]} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemTitle, { color: theme.colors.text }]} numberOfLines={2}>{card.title}</Text>
              <Text style={[styles.meta, { color: theme.colors.textMuted }]} numberOfLines={1}>
                {card.assignee || 'Unassigned'}{isGoogle ? ' · Google Calendar' : ''}
              </Text>
            </View>
            <Text style={[styles.typeLabel, { color }]}>{card.type === 'SIGN_SLIP' ? t('sign_slip') : card.type === 'RSVP' ? t('rsvp') : t('task')}</Text>
          </View>
        </GlassCard>
      </PressScale>
    );
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <AmbientBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.colors.text }]}>{t('calendar')}</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>{formatDay(selectedDay)}</Text>
            </View>
            <PressScale testID="sync-google-calendar" onPress={syncCalendar} disabled={syncing || !calendarRequest} style={[styles.syncBtn, { backgroundColor: theme.colors.primary }, (syncing || !calendarRequest) && { opacity: 0.55 }]}>
              {syncing ? <ActivityIndicator color={theme.colors.primaryText} size="small" /> : <RefreshCw color={theme.colors.primaryText} size={20} />}
              <Text style={[styles.syncText, { color: theme.colors.primaryText }]}>{syncing ? 'Syncing' : 'Sync'}</Text>
            </PressScale>
          </View>

          <GlassCard style={{ marginBottom: 18 }}>
            <View style={styles.privacyRow}>
              <ShieldCheck color={theme.colors.success} size={22} />
              <Text style={[styles.privacyText, { color: theme.colors.textMuted }]}>Calendar sync is read-only. Household COO imports reminders and suggests invitees; it does not edit your Google Calendar.</Text>
            </View>
          </GlassCard>

          {syncResult ? (
            <GlassCard style={{ marginBottom: 18 }}>
              <View style={styles.syncSummaryRow}>
                <CalendarDays color={theme.colors.accent} size={22} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.syncSummaryTitle, { color: theme.colors.text }]}>Google Calendar imported</Text>
                  <Text style={[styles.syncSummaryText, { color: theme.colors.textMuted }]}>{syncResult.imported} events imported · {syncResult.skipped} skipped · {syncResult.contacts_found} people found</Text>
                </View>
              </View>
              {syncResult.contacts.length > 0 ? (
                <View style={styles.contactsPreview}>
                  <Users color={theme.colors.textSoft} size={16} />
                  <Text style={[styles.contactsPreviewText, { color: theme.colors.textSoft }]} numberOfLines={2}>{syncResult.contacts.slice(0, 3).map((c) => c.email).join(', ')}</Text>
                </View>
              ) : null}
            </GlassCard>
          ) : null}

          <GlassCard style={{ marginBottom: 24 }}>
            <View style={styles.monthHeader}>
              <PressScale testID="prev-month" onPress={() => shiftMonth(-1)} style={[styles.monthNav, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <Text style={[styles.monthNavText, { color: theme.colors.text }]}>‹</Text>
              </PressScale>
              <Text style={[styles.monthTitle, { color: theme.colors.text }]}>{monthTitle}</Text>
              <PressScale testID="next-month" onPress={() => shiftMonth(1)} style={[styles.monthNav, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <Text style={[styles.monthNavText, { color: theme.colors.text }]}>›</Text>
              </PressScale>
            </View>

            <View style={styles.weekHeader}>
              {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                <Text key={`${day}-${index}`} style={[styles.weekLabel, { color: theme.colors.textSoft }]}>{day}</Text>
              ))}
            </View>

            <View style={styles.monthGrid}>
              {monthDays.map(({ date, inMonth }) => {
                const key = dateKey(date);
                const count = countsByDay[key] || 0;
                const isToday = key === dateKey(new Date());
                const selected = selectedDay === key;

                return (
                  <PressScale
                    key={key}
                    testID={`calendar-day-${key}`}
                    onPress={() => onSelectDay(key, date)}
                    style={[
                      styles.dayCell,
                      selected && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
                      !selected && isToday && { backgroundColor: theme.colors.accentSoft, borderColor: theme.colors.accent },
                      !selected && { borderColor: 'transparent' },
                    ]}
                  >
                    <Text style={[styles.dayNumber, { color: selected ? theme.colors.primaryText : inMonth ? theme.colors.text : theme.colors.textSoft, opacity: inMonth ? 1 : 0.42 }]}>
                      {date.getDate()}
                    </Text>
                    {count > 0 ? (
                      <View style={[styles.dayCount, { backgroundColor: selected ? theme.colors.primaryText : theme.colors.accent }]}>
                        <Text style={[styles.dayCountText, { color: selected ? theme.colors.primary : '#FFFFFF' }]}>{count}</Text>
                      </View>
                    ) : <View style={styles.dayCountSpacer} />}
                  </PressScale>
                );
              })}
            </View>
          </GlassCard>

          <Text style={[styles.dayLabel, { color: theme.colors.text }]}>{formatDay(selectedDay)}</Text>
          {loading ? (
            <ActivityIndicator color={theme.colors.text} style={{ marginTop: 30 }} />
          ) : selectedItems.length === 0 ? (
            <GlassCard style={{ marginTop: 12 }}>
              <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>No events on this date.</Text>
            </GlassCard>
          ) : selectedItems.map(renderAgendaCard)}

          {upcomingGroups.length > 0 ? (
            <View style={{ marginTop: 24 }}>
              <Text style={[styles.dayLabel, { color: theme.colors.text }]}>Upcoming</Text>
              {upcomingGroups.map((group) => (
                <View key={group.day} style={{ marginTop: 14 }}>
                  <Text style={[styles.groupLabel, { color: theme.colors.textMuted }]}>{formatDay(group.day)}</Text>
                  {group.items.slice(0, 2).map(renderAgendaCard)}
                </View>
              ))}
            </View>
          ) : null}

          <View style={{ height: 220 }} />
        </ScrollView>
      </SafeAreaView>

      <Modal visible={!!selectedCard} transparent animationType="fade" onRequestClose={() => setSelectedCard(null)}>
        <View style={styles.modalBackdrop}>
          <PressScale onPress={() => setSelectedCard(null)} style={StyleSheet.absoluteFill} />
          <View style={[styles.detailSheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}>
            <View style={styles.detailHeader}>
              <Text style={[styles.detailTitle, { color: theme.colors.text }]} numberOfLines={2}>{selectedCard?.title}</Text>
              <PressScale testID="close-calendar-detail" onPress={() => setSelectedCard(null)} style={[styles.closeBtn, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <X color={theme.colors.text} size={20} />
              </PressScale>
            </View>
            <View style={styles.detailMetaRow}>
              <Clock3 color={theme.colors.accent} size={18} />
              <Text style={[styles.detailMeta, { color: theme.colors.textMuted }]}>
                {selectedCard?.due_date ? new Date(selectedCard.due_date).toLocaleString() : 'No due date'}
              </Text>
            </View>
            <Text style={[styles.detailDescription, { color: theme.colors.textMuted }]}>
              {selectedCard?.description || 'No extra details for this item.'}
            </Text>
            <Text style={[styles.detailMeta, { color: theme.colors.textSoft }]}>
              {selectedCard?.assignee ? `Assigned to ${selectedCard.assignee}` : 'Unassigned'}
              {selectedCard?.source === 'CALENDAR' || selectedCard?.external_source === 'google_calendar' ? ' · Google Calendar' : ''}
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 20, paddingTop: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 42, lineHeight: 48, letterSpacing: -1 },
  sub: { fontFamily: 'Inter_500Medium', fontSize: 16, marginTop: 4 },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 9999, paddingHorizontal: 18, paddingVertical: 14, minHeight: 54 },
  syncText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  privacyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  privacyText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22 },
  syncSummaryRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  syncSummaryTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  syncSummaryText: { fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 4 },
  contactsPreview: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 14 },
  contactsPreviewText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  monthTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 21, textTransform: 'capitalize' },
  monthNav: { width: 54, height: 54, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  monthNavText: { fontFamily: 'Inter_800ExtraBold', fontSize: 30, lineHeight: 34 },
  weekHeader: { flexDirection: 'row', marginBottom: 10 },
  weekLabel: { flex: 1, textAlign: 'center', fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.2857%', minHeight: 62, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, paddingVertical: 7 },
  dayNumber: { fontFamily: 'Inter_800ExtraBold', fontSize: 18, lineHeight: 22 },
  dayCount: { marginTop: 6, minWidth: 24, height: 24, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  dayCountSpacer: { marginTop: 6, height: 24 },
  dayCountText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  dayLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, letterSpacing: -0.4, textTransform: 'capitalize', marginBottom: 2 },
  groupLabel: { fontFamily: 'Inter_700Bold', fontSize: 15, marginTop: 4 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dot: { width: 12, height: 12, borderRadius: 9999 },
  itemTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, lineHeight: 23 },
  meta: { fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 3 },
  typeLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  emptyText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, textAlign: 'center' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.35)' },
  detailSheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, padding: 24, paddingBottom: 54 },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  detailTitle: { flex: 1, fontFamily: 'Inter_800ExtraBold', fontSize: 24, lineHeight: 30 },
  closeBtn: { width: 42, height: 42, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 },
  detailMeta: { fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 22 },
  detailDescription: { fontFamily: 'Inter_500Medium', fontSize: 16, lineHeight: 24, marginTop: 18, marginBottom: 18 },
});
