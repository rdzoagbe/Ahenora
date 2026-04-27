import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, RefreshCw, ShieldCheck, User, Users, X } from 'lucide-react-native';

import { AmbientBackground } from '../../src/components/AmbientBackground';
import { GlassCard } from '../../src/components/GlassCard';
import KeyboardAwareBottomSheet from '../../src/components/KeyboardAwareBottomSheet';
import { PressScale } from '../../src/components/PressScale';
import { useStore } from '../../src/store';
import { api, CalendarImportResult, Card } from '../../src/api';

WebBrowser.maybeCompleteAuthSession();

const TYPE_COLOR: Record<string, string> = {
  SIGN_SLIP: '#F26A1B',
  RSVP: '#202323',
  TASK: '#11B886',
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

  for (let i = leading; i > 0; i -= 1) {
    days.push({ date: new Date(baseDate.getFullYear(), baseDate.getMonth(), 1 - i), inMonth: false });
  }
  for (let day = 1; day <= last.getDate(); day += 1) {
    days.push({ date: new Date(baseDate.getFullYear(), baseDate.getMonth(), day), inMonth: true });
  }
  for (let i = 1; i <= trailing; i += 1) {
    days.push({ date: new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, i), inMonth: false });
  }
  return days;
}

function groupByDay(cards: Card[], selectedDay?: string | null) {
  const groups: Record<string, Card[]> = {};
  cards.forEach((card) => {
    const key = cardDateKey(card);
    if (!key) return;
    if (selectedDay && key !== selectedDay) return;
    groups[key] = groups[key] || [];
    groups[key].push(card);
  });

  return Object.keys(groups)
    .sort()
    .map((day) => ({
      day,
      items: groups[day].sort((a, b) => new Date(a.due_date || '').getTime() - new Date(b.due_date || '').getTime()),
    }));
}

export default function CalendarScreen() {
  const { t, lang, theme } = useStore();
  const [cards, setCards] = useState<Card[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<CalendarImportResult | null>(null);
  const [activeMonth, setActiveMonth] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<string | null>(dateKey(new Date()));
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
    } catch (e) {
      console.log('calendar load failed', e);
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
      } catch (e: any) {
        console.log('calendar sync failed', e);
        Alert.alert('Calendar sync failed', e?.message || 'Please try again.');
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

  const groups = useMemo(
    () => groupByDay(cards, selectedDay && countsByDay[selectedDay] ? selectedDay : null),
    [cards, countsByDay, selectedDay]
  );

  const locale = lang === 'es' ? 'es-ES' : lang === 'fr' ? 'fr-FR' : 'en-US';
  const monthTitle = activeMonth.toLocaleDateString(locale, { month: 'long', year: 'numeric' });

  const formatDay = (day: string) => {
    const date = new Date(`${day}T00:00:00`);
    const today = startOfLocalDay(new Date());
    const diffDays = Math.round((startOfLocalDay(date).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return lang === 'fr' ? "Aujourd'hui" : lang === 'es' ? 'Hoy' : 'Today';
    if (diffDays === 1) return lang === 'fr' ? 'Demain' : lang === 'es' ? 'Mañana' : 'Tomorrow';
    return date.toLocaleDateString(locale, { weekday: 'long', month: 'short', day: 'numeric' });
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString(locale, { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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
    setSelectedDay(null);
  };

  const onSelectDay = (key: string, date: Date) => {
    setSelectedDay(key);
    if (date.getMonth() !== activeMonth.getMonth() || date.getFullYear() !== activeMonth.getFullYear()) {
      setActiveMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.bg }]}>
      <AmbientBackground />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: theme.colors.text }]}>{t('calendar')}</Text>
              <Text style={[styles.sub, { color: theme.colors.textMuted }]}>{selectedDay && countsByDay[selectedDay] ? formatDay(selectedDay) : t('upcoming')}</Text>
            </View>
            <PressScale testID="sync-google-calendar" onPress={syncCalendar} disabled={syncing || !calendarRequest} style={[styles.syncBtn, { backgroundColor: theme.colors.primary }, (syncing || !calendarRequest) && { opacity: 0.55 }]}>
              {syncing ? <ActivityIndicator color={theme.colors.primaryText} size="small" /> : <RefreshCw color={theme.colors.primaryText} size={18} />}
              <Text style={[styles.syncText, { color: theme.colors.primaryText }]}>{syncing ? 'Syncing' : 'Sync'}</Text>
            </PressScale>
          </View>

          <GlassCard style={{ marginBottom: 18 }}>
            <View style={styles.privacyRow}>
              <ShieldCheck color={theme.colors.success} size={20} />
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

          <GlassCard style={{ marginBottom: 22 }}>
            <View style={styles.monthHeader}>
              <PressScale testID="prev-month" onPress={() => shiftMonth(-1)} style={[styles.monthNav, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <ChevronLeft color={theme.colors.text} size={24} />
              </PressScale>
              <Text style={[styles.monthTitle, { color: theme.colors.text }]}>{monthTitle}</Text>
              <PressScale testID="next-month" onPress={() => shiftMonth(1)} style={[styles.monthNav, { backgroundColor: theme.colors.bgSoft, borderColor: theme.colors.cardBorder }]}>
                <ChevronRight color={theme.colors.text} size={24} />
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
                    <Text
                      style={[
                        styles.dayNumber,
                        {
                          color: selected ? theme.colors.primaryText : theme.colors.text,
                          opacity: inMonth ? 1 : 0.34,
                        },
                      ]}
                    >
                      {date.getDate()}
                    </Text>
                    {count > 0 ? (
                      <View style={[styles.dayDot, { backgroundColor: selected ? theme.colors.primaryText : theme.colors.accent }]}>
                        <Text style={[styles.dayDotText, { color: selected ? theme.colors.primary : '#FFFFFF' }]}>{count}</Text>
                      </View>
                    ) : (
                      <View style={styles.dayDotSpacer} />
                    )}
                  </PressScale>
                );
              })}
            </View>
          </GlassCard>

          {loading ? (
            <ActivityIndicator color={theme.colors.text} style={{ marginTop: 40 }} />
          ) : groups.length === 0 ? (
            <GlassCard style={styles.empty}>
              <Text style={[styles.emptyText, { color: theme.colors.textMuted }]}>{selectedDay ? 'No events on this date.' : t('no_events')}</Text>
            </GlassCard>
          ) : groups.map((group) => (
            <View key={group.day} style={{ marginBottom: 20 }}>
              <Text style={[styles.dayLabel, { color: theme.colors.text }]}>{formatDay(group.day)}</Text>
              {group.items.map((card) => {
                const color = TYPE_COLOR[card.type] || theme.colors.success;
                const isGoogle = card.source === 'CALENDAR' || card.external_source === 'google_calendar';
                return (
                  <PressScale key={card.card_id} testID={`calendar-card-${card.card_id}`} onPress={() => setSelectedCard(card)}>
                    <GlassCard style={{ marginTop: 12 }}>
                      <View style={styles.row}>
                        <View style={[styles.dot, { backgroundColor: color }]} />
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.itemTitle, { color: theme.colors.text }]} numberOfLines={2}>{card.title}</Text>
                          <Text style={[styles.meta, { color: theme.colors.textMuted }]} numberOfLines={1}>{card.assignee || 'Unassigned'}{isGoogle ? ' · Google Calendar' : ''}</Text>
                        </View>
                        <Text style={[styles.typeLabel, { color }]}>{card.type === 'SIGN_SLIP' ? t('sign_slip') : card.type === 'RSVP' ? t('rsvp') : t('task')}</Text>
                      </View>
                    </GlassCard>
                  </PressScale>
                );
              })}
            </View>
          ))}

          <View style={{ height: 220 }} />
        </ScrollView>
      </SafeAreaView>

      <KeyboardAwareBottomSheet
        visible={!!selectedCard}
        onClose={() => setSelectedCard(null)}
        contentStyle={[styles.detailSheet, { backgroundColor: theme.colors.card, borderColor: theme.colors.cardBorder }]}
      >
        {selectedCard ? (
          <>
            <View style={styles.detailHeader}>
              <Text style={[styles.detailTitle, { color: theme.colors.text }]}>{selectedCard.title}</Text>
              <PressScale onPress={() => setSelectedCard(null)} style={[styles.closeBtn, { borderColor: theme.colors.cardBorder, backgroundColor: theme.colors.bgSoft }]}>
                <X color={theme.colors.text} size={20} />
              </PressScale>
            </View>
            <View style={styles.detailMetaRow}>
              <Clock color={theme.colors.textSoft} size={17} />
              <Text style={[styles.detailMetaText, { color: theme.colors.textMuted }]}>{formatDateTime(selectedCard.due_date)}</Text>
            </View>
            <View style={styles.detailMetaRow}>
              <User color={theme.colors.textSoft} size={17} />
              <Text style={[styles.detailMetaText, { color: theme.colors.textMuted }]}>{selectedCard.assignee || 'Unassigned'}</Text>
            </View>
            {selectedCard.description ? (
              <Text style={[styles.detailDescription, { color: theme.colors.text }]}>{selectedCard.description}</Text>
            ) : (
              <Text style={[styles.detailDescription, { color: theme.colors.textMuted }]}>No additional details.</Text>
            )}
          </>
        ) : null}
      </KeyboardAwareBottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingHorizontal: 22, paddingTop: 14 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 18 },
  title: { fontFamily: 'Inter_800ExtraBold', fontSize: 42, lineHeight: 48, letterSpacing: -1.0 },
  sub: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: 4 },
  syncBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 9999, paddingHorizontal: 18, paddingVertical: 14, minHeight: 52 },
  syncText: { fontFamily: 'Inter_800ExtraBold', fontSize: 15 },
  privacyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  privacyText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 15, lineHeight: 22 },
  syncSummaryRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  syncSummaryTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 17 },
  syncSummaryText: { fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 4 },
  contactsPreview: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 14 },
  contactsPreviewText: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 13, lineHeight: 18 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  monthTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 21, textTransform: 'capitalize' },
  monthNav: { width: 54, height: 54, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  weekHeader: { flexDirection: 'row', marginBottom: 8 },
  weekLabel: { flex: 1, textAlign: 'center', fontFamily: 'Inter_800ExtraBold', fontSize: 13 },
  monthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  dayCell: { width: '14.2857%', minHeight: 60, alignItems: 'center', justifyContent: 'center', borderRadius: 19, borderWidth: 1, paddingVertical: 5 },
  dayNumber: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, lineHeight: 22 },
  dayDot: { marginTop: 5, minWidth: 24, height: 24, borderRadius: 9999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  dayDotSpacer: { marginTop: 5, height: 24 },
  dayDotText: { fontFamily: 'Inter_800ExtraBold', fontSize: 12 },
  dayLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 22, letterSpacing: -0.3, marginBottom: 2, textTransform: 'capitalize' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  dot: { width: 12, height: 12, borderRadius: 9999 },
  itemTitle: { fontFamily: 'Inter_800ExtraBold', fontSize: 17, lineHeight: 23 },
  meta: { fontFamily: 'Inter_500Medium', fontSize: 14, marginTop: 3 },
  typeLabel: { fontFamily: 'Inter_800ExtraBold', fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  empty: { paddingVertical: 34, alignItems: 'center' },
  emptyText: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  detailSheet: { borderTopLeftRadius: 30, borderTopRightRadius: 30, borderWidth: 1, padding: 24, paddingBottom: 110 },
  detailHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  detailTitle: { flex: 1, fontFamily: 'Inter_800ExtraBold', fontSize: 25, lineHeight: 31, letterSpacing: -0.4 },
  closeBtn: { width: 42, height: 42, borderRadius: 9999, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  detailMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  detailMetaText: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15, lineHeight: 21 },
  detailDescription: { marginTop: 20, fontFamily: 'Inter_500Medium', fontSize: 16, lineHeight: 24 },
});
